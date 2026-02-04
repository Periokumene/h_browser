import { Box, Spinner, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import VideoJsPlayer from "../components/player/VideoJsPlayer";
import { buildPlaySources } from "../components/player/buildPlaySources";
import type { VideoJsSource } from "../components/player/types";
import { fetchItem } from "../api/calls";
import { getBaseUrl } from "../api/client";
import { useThumbnails } from "../hooks/useThumbnails";

function getErrorMessage(error: unknown): string {
  const err = error as { response?: { data?: { error?: string } } };
  return err?.response?.data?.error ?? "加载媒体信息失败";
}

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();

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

  const { sources, poster } = useMemo(() => {
    if (!code || !item) return { sources: [] as VideoJsSource[], poster: undefined };
    return buildPlaySources(code, item, getBaseUrl());
  }, [code, item]);

  // 进度条缩略图：useThumbnails 请求后端；有 vttUrl 时悬停显示雪碧图，无/未就绪时悬停显示纯黑矩形（显隐为纯前端行为）
  const { ready: thumbnailsReady, vttUrl: thumbnailsVttUrl } = useThumbnails(code);

  if (!code) {
    return (
      <Box>
        <Text>缺少编号参数。</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box>
        <Box display="flex" alignItems="center" gap={3}>
          <Spinner size="sm" />
          <Text>加载中…</Text>
        </Box>
      </Box>
    );
  }

  if (isError && error) {
    return (
      <Box>
        <Text color="red.400">{getErrorMessage(error)}</Text>
      </Box>
    );
  }

  if (sources.length === 0) {
    return (
      <Box>
        <Text color="red.400">无法生成播放地址。</Text>
      </Box>
    );
  }

  return (
    <Box outline="none" _focus={{ outline: "none" }} sx={{ outline: "none" }}>
      <Box
        h="100vh"
        minH="100vh"
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg="black"
        outline="none"
        _focus={{ outline: "none" }}
        sx={{ "&:focus": { outline: "none" } }}
      >
        <Box
          w="100%"
          h="100%"
          minH={0}
          maxH="100vh"
          overflow="visible"
          sx={{ "& .video-js": { width: "100%", height: "100%", maxHeight: "100%" } }}
        >
          {/* overflow="visible" 避免进度条上方缩略图被裁切 */}
          <VideoJsPlayer
            sources={sources}
            poster={poster}
            videoCode={code}
            thumbnailsVttUrl={thumbnailsReady ? thumbnailsVttUrl : undefined}
          />
        </Box>
      </Box>
    </Box>
  );
}
