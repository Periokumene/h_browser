import { Box, Heading, Spinner, Text, useToast } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import { useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { fetchItem } from "../api/calls";
import { getBaseUrl } from "../api/client";

type HlsErrorData = {
  fatal?: boolean;
  type?: string;
  details?: string;
  reason?: string;
  response?: { code?: number };
};

function showHlsFatalToast(
  toast: ReturnType<typeof useToast>,
  data: HlsErrorData
) {
  const detail = [
    data.type,
    data.details,
    data.response?.code != null ? `HTTP ${data.response.code}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.error("HLS fatal error:", data);
  toast({
    title: "HLS 加载失败",
    description: detail || undefined,
    status: "error",
    duration: 8000,
  });
}

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const reinitDoneRef = useRef(false);
  const toast = useToast();

  const { data: item, isLoading: loading, isError, error } = useQuery({
    queryKey: ["item", code],
    queryFn: () => fetchItem(code!),
    enabled: !!code,
  });

  useEffect(() => {
    if (!item) return;
    document.title = item.title || item.code || "个人影音库";
    return () => {
      document.title = "个人影音库";
    };
  }, [item]);

  const videoType = item?.video_type ?? null;

  const streamUrl = useCallback(() => {
    const base = getBaseUrl();
    return `${base}/api/stream/${encodeURIComponent(code || "")}`;
  }, [code]);

  const m3u8Url = useCallback(() => {
    const base = getBaseUrl();
    return `${base}/api/stream/${encodeURIComponent(code || "")}/playlist.m3u8`;
  }, [code]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !code || loading || isError) return;

    const isTs = (videoType || "").toLowerCase() === "ts";

    if (isTs) {
      const url = m3u8Url();
      if (Hls.isSupported()) {
        reinitDoneRef.current = false;

        const createHls = (startPosition?: number): Hls => {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            fragLoadingMaxRetry: 3,
            manifestLoadingMaxRetry: 2,
            startPosition: startPosition ?? -1,
            xhrSetup: (xhr) => {
              xhr.withCredentials = true;
            },
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          return hls;
        };

        const onReady = () => video.play().catch(() => {});

        const setupHlsListeners = (hls: Hls) => {
          hls.off(Hls.Events.MANIFEST_PARSED, onReady);
          hls.off(Hls.Events.ERROR, onError);
          hls.on(Hls.Events.MANIFEST_PARSED, onReady);
          hls.on(Hls.Events.ERROR, onError);
        };

        const onError = (_event: string, data: HlsErrorData) => {
          if (!data.fatal) return;
          const isFragParsingError =
            data.type === "mediaError" && data.details === "fragParsingError";
          if (isFragParsingError && !reinitDoneRef.current) {
            reinitDoneRef.current = true;
            const current = hlsRef.current;
            if (current) {
              try {
                current.detachMedia();
                current.destroy();
              } catch (_) {
                /* ignore */
              }
              hlsRef.current = null;
            }
            const newHls = createHls(video.currentTime);
            hlsRef.current = newHls;
            setupHlsListeners(newHls);
            toast({
              title: "正在从当前位置恢复播放…",
              status: "info",
              duration: 3000,
            });
            return;
          }
          showHlsFatalToast(toast, data);
        };

        const hls = createHls();
        hlsRef.current = hls;
        setupHlsListeners(hls);

        return () => {
          const current = hlsRef.current;
          if (current) {
            try {
              current.detachMedia();
            } catch (_) {
              /* ignore */
            }
            current.destroy();
            hlsRef.current = null;
          }
        };
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        const onCanPlay = () => video.play().catch(() => {});
        video.addEventListener("canplay", onCanPlay);
        return () => {
          video.removeEventListener("canplay", onCanPlay);
          video.src = "";
        };
      }
      toast({
        title: "当前浏览器不支持 HLS，请使用 Chrome/Edge 等",
        status: "warning",
      });
      return;
    }

    video.src = streamUrl();
    const onCanPlay = () => video.play().catch(() => {});
    video.addEventListener("canplay", onCanPlay);
    return () => {
      video.removeEventListener("canplay", onCanPlay);
      video.src = "";
    };
  }, [code, videoType, loading, isError, streamUrl, m3u8Url, toast]);

  if (!code) {
    return (
      <Box>
        <Text>缺少番号参数。</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box>
        <Heading size="md" mb={4}>
          播放：{code}
        </Heading>
        <Box display="flex" alignItems="center" gap={3}>
          <Spinner size="sm" />
          <Text>加载中…</Text>
        </Box>
      </Box>
    );
  }

  if (isError && error) {
    const msg = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || "加载媒体信息失败";
    return (
      <Box>
        <Heading size="md" mb={4}>
          播放：{code}
        </Heading>
        <Text color="red.400">{msg}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="md" mb={4}>
        播放：{code}
        {(videoType || "").toLowerCase() === "ts" && (
          <Text as="span" fontSize="sm" fontWeight="normal" color="app.muted.fg" ml={2}>
            (HLS)
          </Text>
        )}
      </Heading>
      <Box>
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          style={{ width: "100%", maxHeight: "80vh" }}
        />
      </Box>
    </Box>
  );
}
