import { Box, Heading, Spinner, Text, useToast } from "@chakra-ui/react";
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";

const getBaseUrl = () =>
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const getToken = () => localStorage.getItem("authToken");

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [videoType, setVideoType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const streamUrl = useCallback(() => {
    const base = getBaseUrl();
    const token = getToken();
    const path = `${base}/api/stream/${encodeURIComponent(code || "")}`;
    if (token) return `${path}?token=${encodeURIComponent(token)}`;
    return path;
  }, [code]);

  const m3u8Url = useCallback(() => {
    const base = getBaseUrl();
    const token = getToken();
    const path = `${base}/api/stream/${encodeURIComponent(code || "")}/playlist.m3u8`;
    if (token) return `${path}?token=${encodeURIComponent(token)}`;
    return path;
  }, [code]);

  useEffect(() => {
    if (!code) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get(`/api/items/${encodeURIComponent(code)}`);
        if (cancelled) return;
        setVideoType(res.data.video_type ?? null);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data
            ?.error || "加载媒体信息失败";
        setError(msg);
        toast({ title: msg, status: "error" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, toast]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !code || loading || error) return;

    const isTs = (videoType || "").toLowerCase() === "ts";

    if (isTs) {
      const url = m3u8Url();
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event: string, data: { fatal?: boolean }) => {
          if (data.fatal) {
            toast({ title: "HLS 加载失败", status: "error" });
          }
        });
        return () => {
          hls.destroy();
          hlsRef.current = null;
        };
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        return () => {
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
    return () => {
      video.src = "";
    };
  }, [code, videoType, loading, error, streamUrl, m3u8Url, toast]);

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

  if (error) {
    return (
      <Box>
        <Heading size="md" mb={4}>
          播放：{code}
        </Heading>
        <Text color="red.400">{error}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Heading size="md" mb={4}>
        播放：{code}
        {(videoType || "").toLowerCase() === "ts" && (
          <Text as="span" fontSize="sm" fontWeight="normal" color="gray.400" ml={2}>
            (HLS)
          </Text>
        )}
      </Heading>
      <Box>
        <video
          ref={videoRef}
          controls
          style={{ width: "100%", maxHeight: "80vh" }}
        />
      </Box>
    </Box>
  );
}
