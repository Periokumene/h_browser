/**
 * VideoJsPlayer：统一使用 Video.js 作为唯一播放器。
 * - MP4/直链：Video.js 原生 + VHS
 * - HLS（m3u8）：Video.js UI，hls.js 接管同一 video 元素加载（见 hlsIntegration）
 * - 进度条缩略图：自研 spriteThumbnails 插件（VTT + 雪碧图），配合 ThumbnailDisplay 组件
 * - 书签：自研 bookmarks 插件，在进度条显示书签标记，功能面板管理书签 CRUD
 *
 * @see https://videojs.org/guides/react/
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "./playerOverrides.css";
import "./spriteThumbnails";
import "./bookmarks";
import FeaturePanelChakra from "./featurePanel/FeaturePanelChakra";
import { Box, useToast } from "@chakra-ui/react";
import type { Bookmark } from "./bookmarks";
import type { ThumbnailCueCss } from "./spriteThumbnails";
import { DEFAULT_PLAYER_OPTIONS } from "./constants";
import { createAndAttachHls } from "./hlsIntegration";
import { isHlsSource, type VideoJsSource, type VideoJsPlayer, type VideoJsPlayerOptions } from "./types";
import * as usageApi from "../../api/usage";
import { getBaseUrl } from "../../api/client";

export type { VideoJsSource };

export interface VideoJsPlayerProps {
  sources: VideoJsSource[];
  poster?: string;
  /** 视频编码（编号），用于书签等功能的 API 请求 */
  videoCode?: string;
  /** 缩略图 VTT 的完整 URL（由 useThumbnails 提供）。有值时悬停显示雪碧图，无值时悬停显示纯黑矩形；组件始终挂载 */
  thumbnailsVttUrl?: string;
  options?: VideoJsPlayerOptions;
}

type PlayerWithBookmarks = VideoJsPlayer & {
  bookmarks?: (opts?: { bookmarks?: Bookmark[] }) => { updateBookmarks: (b: Bookmark[]) => void };
};

export default function VideoJsPlayer({
  sources,
  poster,
  videoCode = "",
  thumbnailsVttUrl,
  options = {},
}: VideoJsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoJsPlayer | null>(null);
  const hlsDestroyRef = useRef<(() => void) | null>(null);
  const toast = useToast();
  const panelCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPanelCloseTimeout = () => {
    if (panelCloseTimeoutRef.current != null) {
      clearTimeout(panelCloseTimeoutRef.current);
      panelCloseTimeoutRef.current = null;
    }
  };

  const schedulePanelClose = () => {
    clearPanelCloseTimeout();
    panelCloseTimeoutRef.current = setTimeout(() => {
      panelCloseTimeoutRef.current = null;
      setFeaturePanelOpen(false);
    }, 280);
  };

  const [featurePanelOpen, setFeaturePanelOpen] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const bookmarksPluginRef = useRef<{ updateBookmarks: (b: Bookmark[]) => void } | null>(null);
  const pendingBookmarksRef = useRef<Bookmark[]>([]);
  const spriteThumbnailsInstanceRef = useRef<{
    getThumbnailCssForTime: (time: number) => ThumbnailCueCss | null;
  } | null>(null);
  const usageSessionIdRef = useRef<number | null>(null);
  const usageHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usageCodeRef = useRef<string>("");
  const watchedSecondsRef = useRef(0);
  const lastHeartbeatPositionRef = useRef<number | null>(null);

  const getThumbnailCssForTime = useCallback((time: number): ThumbnailCueCss | null => {
    return spriteThumbnailsInstanceRef.current?.getThumbnailCssForTime?.(time) ?? null;
  }, []);

  const handleBookmarksChange = useCallback((bookmarks: Bookmark[]) => {
    pendingBookmarksRef.current = bookmarks;
    bookmarksPluginRef.current?.updateBookmarks(bookmarks);
  }, []);

  useEffect(() => {
    if (!containerRef.current || sources.length === 0) return;

    const useHls = isHlsSource(sources);
    const videoEl = document.createElement("video-js");
    // 使用自定义主题类，按 Video.js 官方推荐方式做 UI 主题覆盖
    videoEl.classList.add("vjs-big-play-centered", "vjs-theme-zako-media");
    containerRef.current.appendChild(videoEl);

    const opts: VideoJsPlayerOptions = {
      ...DEFAULT_PLAYER_OPTIONS,
      ...options,
      poster,
      ...(useHls ? {} : { sources }),
    };
    const player = (playerRef.current = videojs(videoEl, opts, () => {}));

    if (useHls) {
      const m3u8Url = sources[0].src;
      const mediaEl =
        (player.tech(true)?.el() as HTMLVideoElement) || (videoEl as HTMLVideoElement);
      // 【备忘】若 tech 未就绪则 mediaEl 可能为 video-js 根元素而非 <video>，传入 hls.attachMedia 可能异常；可考虑在 tech 就绪后再挂 HLS 或校验 tagName === "VIDEO"

      if (Hls.isSupported()) {
        const { destroy } = createAndAttachHls(mediaEl, m3u8Url, {
          onFatalError: (detail) => {
            console.error("HLS fatal error:", detail);
            toast({ title: "HLS 加载失败", description: detail || undefined, status: "error", duration: 8000 });
          },
          onRecover: () => {
            toast({ title: "正在从当前位置恢复播放…", status: "info", duration: 3000 });
          },
        });
        hlsDestroyRef.current = destroy;
      } else if (mediaEl.canPlayType("application/vnd.apple.mpegurl")) {
        mediaEl.src = m3u8Url;
        mediaEl.addEventListener("canplay", () => mediaEl.play().catch(() => {}));
      } else {
        toast({ title: "当前浏览器不支持 HLS，请使用 Chrome/Edge 等", status: "warning" });
      }
    } else {
      player.src(sources);
    }

    player.ready(() => {
      const instance = (player as PlayerWithBookmarks).bookmarks?.({ bookmarks: [] });
      bookmarksPluginRef.current = instance ?? null;
      if (pendingBookmarksRef.current.length > 0) {
        instance?.updateBookmarks(pendingBookmarksRef.current);
      }
      setPlayerReady(true);
    });

    return () => {
      bookmarksPluginRef.current = null;
      pendingBookmarksRef.current = [];
      setPlayerReady(false);
      clearPanelCloseTimeout();
      hlsDestroyRef.current?.();
      hlsDestroyRef.current = null;
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!playerRef.current || playerRef.current.isDisposed() || sources.length === 0) return;
    if (isHlsSource(sources)) return;
    playerRef.current.src(sources);
  }, [sources]);

  // 全局快捷键：在 Play 页内，无需先点击播放器即可响应常用键盘操作
  useEffect(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 在输入框/可编辑区域中输入时不拦截
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const isEditable =
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          (target as HTMLElement).isContentEditable;
        if (isEditable) return;
      }

      // 带组合键的操作交给浏览器/系统
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const p = playerRef.current;
      if (!p || p.isDisposed()) return;

      const key = event.key;

      // 常用快捷键设计对齐视频站点惯例
      switch (key) {
        case " ": // 空格：播放/暂停
        case "k":
        case "K": {
          event.preventDefault();
          if (p.paused()) {
            void p.play();
          } else {
            p.pause();
          }
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          const current = p.currentTime() ?? 0;
          p.currentTime(Math.max(0, current - 5));
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          const current = p.currentTime() ?? 0;
          const duration = p.duration() ?? Number.POSITIVE_INFINITY;
          p.currentTime(Math.min(duration, current + 5));
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const v = p.volume();
          p.volume(Math.min(1, v + 0.05));
          break;
        }
        case "ArrowDown": {
          event.preventDefault();
          const v = p.volume();
          p.volume(Math.max(0, v - 0.05));
          break;
        }
        case "m":
        case "M": {
          event.preventDefault();
          p.muted(!p.muted());
          break;
        }
        case "f":
        case "F": {
          event.preventDefault();
          if (p.isFullscreen()) {
            p.exitFullscreen();
          } else {
            p.requestFullscreen();
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [playerReady]);

  // 使用行为：进度拉取与续播、会话开始/结束、心跳（单用户）
  // 心跳间隔：每 10s 上报一次当前播放位置，供后端 play_position_log 做「每部影片内热门片段」统计。
  // 硬性规则：视频暂停时禁止任何心跳上报（不受节流窗影响）；仅在 player 处于播放中时上报，避免重复标记同一片段。
  // 若未来遇到高并发/性能问题：可适当调大 HEARTBEAT_INTERVAL_MS 降低请求频率，或在后端加大节流窗以减少写入。
  const HEARTBEAT_INTERVAL_MS = 10000;
  useEffect(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed() || !playerReady || !videoCode.trim()) return;

    usageCodeRef.current = videoCode;

    let seekedFromProgress = false;
    const trySeekToProgress = (positionSeconds: number) => {
      if (seekedFromProgress) return;
      const d = player.duration();
      if (typeof d === "number" && Number.isFinite(d) && d > 0) {
        player.currentTime(Math.min(positionSeconds, d));
        seekedFromProgress = true;
      }
    };

    const clearHeartbeat = () => {
      if (usageHeartbeatRef.current != null) {
        clearInterval(usageHeartbeatRef.current);
        usageHeartbeatRef.current = null;
      }
    };

    const flushSessionAndProgress = (opts?: { useKeepalive?: boolean; markEnded?: boolean }) => {
      const sid = usageSessionIdRef.current;
      const code = usageCodeRef.current;
      const p = playerRef.current;
      if (sid != null && code && p && !p.isDisposed()) {
        const pos = p.currentTime() ?? 0;
        // 尝试补上一段未被心跳覆盖的观看时长（从上次心跳到当前停留点）
        const lastPos = lastHeartbeatPositionRef.current;
        const MAX_DELTA = (HEARTBEAT_INTERVAL_MS / 1000) * 3;
        if (typeof lastPos === "number") {
          const delta = pos - lastPos;
          if (delta > 0 && delta < MAX_DELTA) {
            watchedSecondsRef.current += delta;
          }
        }
        lastHeartbeatPositionRef.current = pos;
        const watched = watchedSecondsRef.current;
        if (opts?.markEnded) {
          // 认为本次会话结束：写入最终观看时长，并刷新 ended_at
          const payload = { watched_seconds: watched };
          if (opts?.useKeepalive && typeof fetch === "function") {
            const base = getBaseUrl();
            const url = `${base}/api/items/${encodeURIComponent(code)}/play/session/${sid}`;
            void fetch(url, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              keepalive: true,
            }).catch(() => {});
          } else {
            usageApi.endSession(code, sid, payload).catch(() => {});
          }
        } else {
          // 会话仍然存活，仅更新累计观看时长
          if (opts?.useKeepalive && typeof fetch === "function") {
            const base = getBaseUrl();
            const url = `${base}/api/items/${encodeURIComponent(code)}/play/session/${sid}/watched`;
            void fetch(url, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ watched_seconds: watched }),
              keepalive: true,
            }).catch(() => {});
          } else {
            usageApi.updateSessionWatched(code, sid, watched).catch(() => {});
          }
        }
      }
      if (code && p && !p.isDisposed()) {
        const pos = p.currentTime() ?? 0;
        const dur = p.duration();
        const progressPayload = {
          position_seconds: pos,
          ...(Number.isFinite(dur) && dur != null ? { duration_seconds: dur } : {}),
        };
        if (opts?.useKeepalive && typeof fetch === "function") {
          const base = getBaseUrl();
          const url = `${base}/api/items/${encodeURIComponent(code)}/progress`;
          void fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(progressPayload),
            keepalive: true,
          }).catch(() => {});
        } else {
          usageApi.saveProgress(code, progressPayload).catch(() => {});
        }
      }
      clearHeartbeat();
    };

    void usageApi.getProgress(videoCode).then((progress) => {
      if (!playerRef.current || playerRef.current.isDisposed() || usageCodeRef.current !== videoCode) return;
      if (progress && progress.position_seconds > 0) {
        trySeekToProgress(progress.position_seconds);
        player.one("loadedmetadata", () => {
          if (usageCodeRef.current === videoCode && !seekedFromProgress) {
            trySeekToProgress(progress.position_seconds);
          }
        });
      }
    });

    const startHeartbeat = () => {
      clearHeartbeat();
      usageHeartbeatRef.current = setInterval(() => {
        const p = playerRef.current;
        const c = usageCodeRef.current;
        if (!p || p.isDisposed() || !c) return;
        // 暂停时一律不上报（即使超出节流窗也不许上报）；若发现已暂停则清除定时器
        if (p.paused()) {
          clearHeartbeat();
          return;
        }
        const t = p.currentTime() ?? 0;
        const lastPos = lastHeartbeatPositionRef.current;
        const MAX_DELTA = (HEARTBEAT_INTERVAL_MS / 1000) * 3;
        if (typeof lastPos === "number") {
          const delta = t - lastPos;
          if (delta > 0 && delta < MAX_DELTA) {
            watchedSecondsRef.current += delta;
          }
        }
        lastHeartbeatPositionRef.current = t;
        // 更新热门片段统计
        usageApi.sendHeartbeat(c, { position_seconds: t }).catch(() => {});
        // 刷新当前会话的累计观看时长（非 keepalive）
        const sid = usageSessionIdRef.current;
        if (sid != null) {
          usageApi.updateSessionWatched(c, sid, watchedSecondsRef.current).catch(() => {});
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    const onPlay = () => {
      if (usageCodeRef.current !== videoCode) return;
      const p = playerRef.current;
      if (!p || p.isDisposed()) return;
      const hasSession = usageSessionIdRef.current != null;
      const hasHeartbeat = usageHeartbeatRef.current != null;

      if (!hasSession) {
        // 首次播放：创建会话并从当前进度开始累计
        watchedSecondsRef.current = 0;
        lastHeartbeatPositionRef.current = p.currentTime() ?? 0;
        void usageApi
          .startSession(videoCode)
          .then((res) => {
            if (usageCodeRef.current !== videoCode) return;
            usageSessionIdRef.current = res.id;
            startHeartbeat();
          })
          .catch(() => {});
      } else if (!hasHeartbeat) {
        // 已有会话但当前无心跳：恢复播放时仅重启心跳，继续累计时长
        lastHeartbeatPositionRef.current = p.currentTime() ?? 0;
        startHeartbeat();
      }
    };

    const onPause = () => {
      flushSessionAndProgress();
    };

    const onEnded = () => {
      flushSessionAndProgress();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSessionAndProgress({ useKeepalive: true });
    };

    player.on("play", onPlay);
    player.on("pause", onPause);
    player.on("ended", onEnded);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      player.off("play", onPlay);
      player.off("pause", onPause);
      player.off("ended", onEnded);
      flushSessionAndProgress({ useKeepalive: true, markEnded: true });
    };
  }, [playerReady, videoCode]);

  /* 缩略图：始终挂载。无 thumbnailsVttUrl 时传 vttContent 空 VTT，有 URL 时传 src；保证插件在任何情况下都会创建 vjs-sprite-thumbnail-display。 */
  useEffect(() => {
    const player = playerRef.current;
    if (!player || player.isDisposed() || sources.length === 0) return;
    const spriteThumbnails = (player as VideoJsPlayer & {
      spriteThumbnails?: (opts?: unknown) => { updateOptions?: (opts: unknown) => void; getThumbnailCssForTime?: (time: number) => ThumbnailCueCss | null };
    }).spriteThumbnails;
    if (typeof spriteThumbnails !== "function") return;

    const opts = thumbnailsVttUrl
      ? { src: thumbnailsVttUrl }
      : { vttContent: "WEBVTT\n\n", spriteBaseUrl: "" };

    const instance = spriteThumbnails.call(player, opts);
    spriteThumbnailsInstanceRef.current =
      instance && typeof instance.getThumbnailCssForTime === "function" ? instance : null;
    if (instance?.updateOptions && thumbnailsVttUrl) {
      instance.updateOptions(opts);
    }
    return () => {
      spriteThumbnailsInstanceRef.current = null;
    };
  }, [thumbnailsVttUrl, sources.length]);

  return (
    <Box
      data-vjs-player
      className="vjs-player-wrapper"
      position="relative"
      w="100%"
      h="100%"
      minW={0}
      overflowX="hidden"
    >
      <div ref={containerRef} className="vjs-player-container" />
      {/* 右侧悬停热区：鼠标靠近右边缘时展开功能面板 */}
      <Box
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        w="32px"
        zIndex={40}
        onMouseEnter={() => {
          clearPanelCloseTimeout();
          setFeaturePanelOpen(true);
        }}
        aria-hidden
      />
      <FeaturePanelChakra
        isOpen={featurePanelOpen}
        onClose={() => setFeaturePanelOpen(false)}
        onMouseEnter={clearPanelCloseTimeout}
        onMouseLeave={schedulePanelClose}
        videoCode={videoCode}
        player={playerReady ? playerRef.current : null}
        onBookmarksChange={handleBookmarksChange}
        getThumbnailCssForTime={getThumbnailCssForTime}
      />
    </Box>
  );
}
