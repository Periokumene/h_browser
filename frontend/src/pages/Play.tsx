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
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          fragLoadingMaxRetry: 3,
          manifestLoadingMaxRetry: 2,
          xhrSetup: (xhr) => {
            xhr.withCredentials = true;
          },
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        const onReady = () => video.play().catch(() => {});
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.on(Hls.Events.ERROR, (_event: string, data: HlsErrorData) => {
          // 可能是高并发期间引发的
          // 若恢复后仍经常失败，可以再考虑：
          // 在后端对 /api/stream/<code> 的 Range 处理做校验（确保返回范围与 playlist 中 byterange 一致），或
          // 在前端在恢复失败时做一次 重新 loadSource + 恢复 currentTime 的二次兜底（需要再加一层状态/计时逻辑）。
          if (!data.fatal) return;
          const isFragParsingError =
            data.type === "mediaError" && data.details === "fragParsingError";
          if (isFragParsingError) {
            console.warn("HLS fragParsingError (e.g. seek), attempting recovery:", data.reason ?? data.details);
            try {
              hls.recoverMediaError();
              toast({
                title: "正在重试播放…",
                status: "info",
                duration: 3000,
              });
            } catch {
              showHlsFatalToast(toast, data);
            }
          } else {
            showHlsFatalToast(toast, data);
          }
        });
        return () => {
          hls.off(Hls.Events.MANIFEST_PARSED, onReady);
          hls.destroy();
          hlsRef.current = null;
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
