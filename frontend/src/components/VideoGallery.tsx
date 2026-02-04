/**
 * VideoGallery：与后端通信并展示视频卡片网格，支持无限滚动。
 * 不包含过滤器、搜索等 UI，由上层 VideoBrowser 提供。
 *
 * 性能与可维护性：
 * - 单卡抽离为 VideoCard + React.memo，仅 isPreview/isPlayButtonNear 变化的卡片重绘。
 * - 进度条更新用 ref + requestAnimationFrame，不触发整表 state 更新。
 * - 卡片动效 sx、常量置于模块级，避免每次渲染创建新对象。
 * - 事件处理用 useCallback 稳定引用，便于 memo 生效。
 */
import {
  Badge,
  Box,
  Flex,
  Icon,
  Image,
  Portal,
  SimpleGrid,
  Skeleton,
  Spinner,
  Text,
} from "@chakra-ui/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPlay } from "react-icons/fa";
import { fetchItems } from "../api/calls";
import { getBaseUrl } from "../api/client";
import type { ListFilters, ListScope, MediaItem, SortMode } from "../types/api";
import { useCardThumbnailCues } from "../hooks/useCardThumbnailCues";
import { getCueForTime } from "./player/spriteThumbnails/vttCueUtils";
import { THUMB_CELL_WIDTH, THUMB_CELL_HEIGHT } from "./player/spriteThumbnails/constants";

const PAGE_SIZE = 24;
const SCROLL_STORAGE_KEY = "videolib_scroll";
const CARD_MAX_W = "min(320px, 26vw)";
const GRID_SX = {
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, min(320px, 26vw)))",
  justifyContent: "center",
};

const MotionBox = motion(Box);
const MotionBoxThumb = motion(Box);

/** 新加载卡片的入场动效：淡入 + 自下而上 */
const CARD_ENTER_DURATION = 0.35;
const CARD_ENTER_STAGGER = 0.04;

/** 鼠标与海报中心距离小于此值（px）时显示播放按钮 */
const PLAY_BUTTON_NEAR_RADIUS = 80;

/** 悬浮展开卡片时的周围阴影（亮色，适配深色模式）。可调：模糊改大更柔和、spread 负值变小光晕更宽、透明度提高更明显 */
const CARD_EXPANDED_SHADOW =
  "0 20px 40px -8px rgba(255, 255, 255, 0.2), 0 8px 20px -4px rgba(255, 255, 255, 0.12)";
/** 悬浮时的 2px 轮廓描边（与 _hover 一致），展开时与 CARD_EXPANDED_SHADOW 一起使用 */
const CARD_HOVER_RING = "0 0 0 2px var(--chakra-colors-app-border-hover)";
/** 悬浮时海报缩放与卡片伸长（缩略图插入）共用动效时长，保证一致 */
const CARD_HOVER_EXPAND_DURATION = 0.28;
/** 卡片缩略图预览区顶部进度条粗细（px） */
const CARD_PREVIEW_PROGRESS_BAR_HEIGHT = 2;

/** 卡片 MotionBox 的 sx（keyframes + 海报/标题动效），抽离到模块级避免每次渲染创建新对象 */
const CARD_MOTION_SX = {
  transition: "box-shadow 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  "&:hover .poster-img": { transform: "scale(1.06)" },
  ".poster-img": {
    transition: `transform ${CARD_HOVER_EXPAND_DURATION}s cubic-bezier(0.25, 0.46, 0.45, 0.94)`,
    transformOrigin: "center center",
    willChange: "transform",
  },
  "&:hover .card-title-inner[data-scroll='true']": {
    animationName: "videocard-title-marquee",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    animationDuration: "var(--marquee-duration, 8s)",
  },
  ".card-title-inner": {
    display: "inline-block",
    whiteSpace: "nowrap",
    willChange: "transform",
  },
  "@keyframes videocard-title-marquee": {
    "0%": { transform: "translateX(0)" },
    "100%": { transform: "translateX(-100%)" },
  },
} as const;

/** 视频标题：默认单行省略，超长时仅在 hover 时按统一速度滚动 */
function VideoTitle({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [scrollState, setScrollState] = useState<{ shouldScroll: boolean; duration: number }>({
    shouldScroll: false,
    duration: 8,
  });

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const containerWidth = container.offsetWidth;
    const innerWidth = inner.scrollWidth;

    // 不超出一行，则不滚动
    if (innerWidth <= containerWidth + 2) {
      setScrollState({ shouldScroll: false, duration: 8 });
      return;
    }

    // 统一像素速度（px/s）：数值越小滚动越慢；时长限制在 6～20 秒
    const BASE_SPEED_PX_PER_SEC = 25;
    const duration = Math.max(6, Math.min(20, innerWidth / BASE_SPEED_PX_PER_SEC));

    setScrollState({
      shouldScroll: true,
      duration,
    });
  }, [text]);

  return (
    <Box
      ref={containerRef}
      as="h3"
      fontSize="md"
      fontWeight="semibold"
      mb={0.5}
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      <Box
        as="span"
        ref={innerRef}
        className="card-title-inner"
        data-scroll={scrollState.shouldScroll ? "true" : "false"}
        style={
          scrollState.shouldScroll
            ? ({ "--marquee-duration": `${scrollState.duration}s` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </Box>
    </Box>
  );
}

function CardSkeleton() {
  return (
    <Box
      w="100%"
      maxW={CARD_MAX_W}
      borderWidth="1px"
      borderColor="app.border"
      borderRadius="md"
      overflow="hidden"
      bg="app.surface"
      display="flex"
      flexDirection="column"
    >
      <Skeleton
        aspectRatio="2/3"
        flexShrink={0}
        startColor="app.surface.subtle"
        endColor="whiteAlpha.200"
      />
      <Box p={2} flex={1} display="flex" flexDirection="column" minH={0}>
        <Skeleton
          height="4"
          width="90%"
          borderRadius="md"
          mb={1}
          startColor="app.surface.subtle"
          endColor="whiteAlpha.200"
        />
        <Box mt="auto" pt={1} display="flex" flexDirection="column" gap={1}>
          <Skeleton
            height="3"
            width="70%"
            borderRadius="md"
            startColor="app.surface.subtle"
            endColor="whiteAlpha.200"
          />
          <Skeleton
            height="3"
            width="50%"
            borderRadius="md"
            startColor="app.surface.subtle"
            endColor="whiteAlpha.200"
          />
        </Box>
      </Box>
    </Box>
  );
}

function PosterWithSkeleton({
  src,
  alt,
  ...rest
}: { src: string; alt: string } & React.ComponentProps<typeof Image>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Box position="relative" w="100%" h="100%">
      <Skeleton
        position="absolute"
        inset={0}
        w="100%"
        h="100%"
        startColor="app.surface.subtle"
        endColor="whiteAlpha.200"
      />
      <Image
        {...rest}
        src={src}
        alt={alt}
        position="absolute"
        inset={0}
        w="100%"
        h="100%"
        objectFit="cover"
        opacity={loaded ? 1 : 0}
        transition="opacity 0.2s ease"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </Box>
  );
}

/**
 * 卡片内缩略图预览块：顶部进度条 + 16:9 雪碧图。与卡片左右下无间隙（负边距抵掉父级 padding）。
 * 内层 160x90 由父级通过 registerThumbnailDisplayRef 设置 background，本组件负责测量容器并 scale 填满。
 */
function ThumbnailPreviewBlock({
  registerProgressBarRef,
  registerThumbnailDisplayRef,
}: {
  registerProgressBarRef?: (el: HTMLDivElement | null) => void;
  registerThumbnailDisplayRef?: (el: HTMLDivElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState({ x: 1, y: 1 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        setScale({ x: w / THUMB_CELL_WIDTH, y: h / THUMB_CELL_HEIGHT });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <MotionBoxThumb
      mt={2}
      mx={-2}
      mb={-2}
      w="calc(100% + 1rem)"
      maxW="calc(100% + 1rem)"
      aspectRatio="16/9"
      bg="black"
      overflow="hidden"
      flexShrink={0}
      display="flex"
      flexDirection="column"
      borderBottomLeftRadius="md"
      borderBottomRightRadius="md"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: CARD_HOVER_EXPAND_DURATION,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      <Box h={`${CARD_PREVIEW_PROGRESS_BAR_HEIGHT}px`} bg="whiteAlpha.300" overflow="hidden" flexShrink={0}>
        <Box ref={registerProgressBarRef} h="100%" w="100%" bg="orange.400" />
      </Box>
      <Flex ref={containerRef} flex={1} minH={0} align="center" justify="center" overflow="hidden">
        <Box
          ref={registerThumbnailDisplayRef}
          w={`${THUMB_CELL_WIDTH}px`}
          h={`${THUMB_CELL_HEIGHT}px`}
          flexShrink={0}
          bg="black"
          overflow="hidden"
          transform={`scale(${scale.x}, ${scale.y})`}
          transformOrigin="center center"
        />
      </Flex>
    </MotionBoxThumb>
  );
}

/** 单张视频卡片 props，用于 memo 与可维护性 */
export interface VideoCardProps {
  item: MediaItem;
  isPreview: boolean;
  isPlayButtonNear: boolean;
  isNewCard: boolean;
  newCardStaggerIndex: number;
  posterUrl: string | undefined;
  onNavigateDetail: (code: string) => void;
  onNavigatePlay: (code: string) => void;
  onMouseEnter: (code: string) => void;
  onMouseLeave: (code: string) => void;
  onMouseMove: (code: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (code: string, x: number, y: number) => void;
  /** 仅 isPreview 时传入，用于进度条 DOM 直接更新 */
  registerProgressBarRef?: (el: HTMLDivElement | null) => void;
  /** 仅 isPreview 时传入，用于缩略图雪碧图 DOM 直接更新（真实预览） */
  registerThumbnailDisplayRef?: (el: HTMLDivElement | null) => void;
}

/** 单张视频卡片：抽离为组件便于 React.memo 减少重渲染（仅 isPreview/isPlayButtonNear 变化的卡片会重绘） */
const VideoCard = memo(function VideoCard({
  item,
  isPreview,
  isPlayButtonNear,
  isNewCard,
  newCardStaggerIndex,
  posterUrl,
  onNavigateDetail,
  onNavigatePlay,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onContextMenu,
  registerProgressBarRef,
  registerThumbnailDisplayRef,
}: VideoCardProps) {
  return (
    <Box position="relative" w="100%" maxW={CARD_MAX_W} overflow="visible">
      <Box
        w="100%"
        display="flex"
        flexDirection="column"
        aria-hidden
        visibility="hidden"
        pointerEvents="none"
      >
        <Box aspectRatio="2/3" flexShrink={0} />
        <Box p={2} minH="56px" flexShrink={0} />
      </Box>
      <MotionBox
        position="absolute"
        top={0}
        left={0}
        right={0}
        role="group"
        w="100%"
        borderWidth="1px"
        borderColor="app.border"
        borderRadius="md"
        overflow={isPreview ? "visible" : "hidden"}
        zIndex={isPreview ? 10 : 1}
        cursor="pointer"
        bg="app.surface"
        display="flex"
        flexDirection="column"
        boxShadow={isPreview ? `${CARD_HOVER_RING}, ${CARD_EXPANDED_SHADOW}` : undefined}
        initial={isNewCard ? { opacity: 0, y: 14 } : { opacity: 1, y: 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: CARD_ENTER_DURATION,
          delay: isNewCard ? newCardStaggerIndex * CARD_ENTER_STAGGER : 0,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
        _hover={{
          boxShadow: isPreview
            ? `${CARD_HOVER_RING}, ${CARD_EXPANDED_SHADOW}`
            : "0 0 0 2px var(--chakra-colors-app-border-hover), 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        }}
        sx={CARD_MOTION_SX}
        onClick={() => onNavigateDetail(item.code)}
        onMouseEnter={() => onMouseEnter(item.code)}
        onMouseLeave={() => onMouseLeave(item.code)}
        onMouseMove={(e) => onMouseMove(item.code, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(item.code, e.clientX, e.clientY);
        }}
      >
        <Box
          data-poster-area
          aspectRatio="2/3"
          bg="app.surface.subtle"
          position="relative"
          overflow="hidden"
          flexShrink={0}
          isolation="isolate"
          borderTopLeftRadius="md"
          borderTopRightRadius="md"
        >
          {posterUrl ? (
            <PosterWithSkeleton
              className="poster-img"
              src={posterUrl}
              alt={item.title || item.code}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Flex h="100%" align="center" justify="center" color="app.muted" fontSize="sm">
              无海报
            </Flex>
          )}
          {item.has_video && (
            <Flex
              position="absolute"
              inset={0}
              zIndex={1}
              align="center"
              justify="center"
              bg="blackAlpha.400"
              opacity={isPlayButtonNear ? 1 : 0}
              transition="opacity 0.2s ease"
              pointerEvents="none"
            >
              <Flex
                as="button"
                type="button"
                aria-label="直接播放"
                pointerEvents="auto"
                w="14"
                h="14"
                borderRadius="full"
                bg="whiteAlpha.600"
                color="gray.400"
                align="center"
                justify="center"
                boxShadow="lg"
                transition="all 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
                _hover={{
                  bg: "orange.400",
                  color: "white",
                  transform: "scale(1.12)",
                  boxShadow: "xl",
                }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onNavigatePlay(item.code);
                }}
              >
                <Icon as={FaPlay} boxSize={6} ml={1} />
              </Flex>
            </Flex>
          )}
        </Box>
        <Box p={2} flex={1} display="flex" flexDirection="column" minH={0}>
          <VideoTitle text={item.title || item.code} />
          <Box mt="auto" pt={1}>
            <Flex align="center" gap={1.5} minW={0}>
              <Text
                fontSize="xs"
                color="app.muted.fg"
                noOfLines={1}
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                flex={1}
                minW={0}
                mr={1}
                opacity={0.8}
              >
                {[item.code, item.actors?.length ? item.actors.join("、") : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Flex gap={1} align="center" flexShrink={0}>
                {!item.has_video && (
                  <Badge colorScheme="red" size="sm">
                    无视频
                  </Badge>
                )}
                {item.has_mp4 && (
                  <Badge variant="outline" size="sm" colorScheme="gray">
                    mp4
                  </Badge>
                )}
                {item.has_ts && (
                  <Badge variant="outline" size="sm" colorScheme="gray">
                    ts
                  </Badge>
                )}
              </Flex>
            </Flex>
          </Box>
          {isPreview && (
            <ThumbnailPreviewBlock
              registerProgressBarRef={registerProgressBarRef}
              registerThumbnailDisplayRef={registerThumbnailDisplayRef}
            />
          )}
        </Box>
      </MotionBox>
    </Box>
  );
});

export interface VideoGalleryProps {
  scope: ListScope;
  search: string;
  filters: ListFilters;
  actor?: string;
  sortMode?: SortMode;
  seed?: string;
}

export default function VideoGallery({
  scope,
  search,
  filters,
  actor,
  sortMode,
  seed,
}: VideoGalleryProps) {
  const navigate = useNavigate();
  const [contextMenu, setContextMenu] = useState<{ code: string; x: number; y: number } | null>(null);
  /** 当前处于缩略图预览模式的卡片（进度由 ref + 直接 DOM 更新，避免整表重渲染） */
  const [previewCard, setPreviewCard] = useState<{ code: string } | null>(null);
  /** 鼠标靠近播放按钮的卡片 code，仅此时显示并可点击播放按钮 */
  const [playButtonNearCode, setPlayButtonNearCode] = useState<string | null>(null);
  /** 缩略图进度 0～1，用于进度条；不放入 state 以免每次 mousemove 触发整表重渲染 */
  const progressRef = useRef(0.5);
  /** 当前预览卡片的进度条填充元素，直接改 style.width 更新 */
  const progressBarFillRef = useRef<HTMLDivElement | null>(null);
  /** 待刷新的“靠近”状态，在 rAF 中一次性写回 state */
  const pendingNearCodeRef = useRef<string | null>(null);
  /** 与 previewCard 同步，供 rAF 闭包读取 */
  const previewCodeRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);
  /** 当前预览卡片的缩略图雪碧图 DOM，rAF 中直接写 style 更新帧 */
  const thumbnailDisplayRef = useRef<HTMLDivElement | null>(null);

  previewCodeRef.current = previewCard?.code;
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { cuesData: thumbnailCuesData, cuesRef: thumbnailCuesRef } = useCardThumbnailCues(previewCard?.code ?? null);
  const prevItemsLengthRef = useRef(0);

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["items", scope, search, filters, actor ?? null, sortMode ?? "code", seed ?? "0"],
    queryFn: ({ pageParam }) =>
      fetchItems({
        page: pageParam,
        page_size: PAGE_SIZE,
        q: search || undefined,
        filters,
        scope,
        actor: actor || undefined,
        sort_mode: sortMode,
        seed: sortMode === "random" ? seed ?? "0" : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return allPages.length + 1;
    },
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // 仅在实际「加载更多」时对新卡片播放入场动效；初次展示或从缓存/后退恢复时直接可见，避免卡片卡在 opacity:0
  const newCardsStartIndex =
    prevItemsLengthRef.current > 0 && items.length > prevItemsLengthRef.current
      ? prevItemsLengthRef.current
      : -1;
  useEffect(() => {
    prevItemsLengthRef.current = items.length;
  }, [items.length]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMore) fetchNextPage();
  }, [loading, loadingMore, hasMore, fetchNextPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (saved) {
      sessionStorage.removeItem(SCROLL_STORAGE_KEY);
      const y = parseInt(saved, 10);
      if (!isNaN(y)) {
        const id = setTimeout(() => window.scrollTo({ top: y, behavior: "auto" }), 0);
        return () => clearTimeout(id);
      }
    }
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  const handleCardMouseEnter = useCallback((code: string) => {
    progressRef.current = 0.5;
    setPreviewCard({ code });
  }, []);

  const handleCardMouseLeave = useCallback((code: string) => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setPreviewCard((prev) => {
      if (prev?.code === code) {
        progressBarFillRef.current = null;
        thumbnailDisplayRef.current = null;
        return null;
      }
      return prev;
    });
    setPlayButtonNearCode((prev) => (prev === code ? null : prev));
  }, []);

  const handleCardMouseMove = useCallback((code: string, e: React.MouseEvent<HTMLDivElement>) => {
    const poster = (e.currentTarget as HTMLElement).querySelector("[data-poster-area]");
    if (!poster) return;
    const rect = poster.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    pendingNearCodeRef.current = dist < PLAY_BUTTON_NEAR_RADIUS ? code : null;

    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    progressRef.current = progress;

    if (rafIdRef.current == null) {
      const currentCode = code;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        // 仅在当前预览卡片仍是本次 mousemove 对应的卡片时更新缩略图，避免跨卡竞争
        if (previewCodeRef.current === currentCode) {
          if (progressBarFillRef.current) {
            progressBarFillRef.current.style.width = `${progressRef.current * 100}%`;
          }
          const cuesData = thumbnailCuesRef.current;
          if (thumbnailDisplayRef.current && cuesData && cuesData.cues.length > 0 && cuesData.duration > 0) {
            const time = progressRef.current * cuesData.duration;
            const css = getCueForTime(cuesData.cues, time);
            const el = thumbnailDisplayRef.current;
            if (css) {
              el.style.background = css.background;
              el.style.width = `${THUMB_CELL_WIDTH}px`;
              el.style.height = `${THUMB_CELL_HEIGHT}px`;
            }
          }
        }
        setPlayButtonNearCode(pendingNearCodeRef.current);
      });
    }
  }, []);

  const registerProgressBarRef = useCallback((el: HTMLDivElement | null) => {
    progressBarFillRef.current = el;
    if (el) el.style.width = `${progressRef.current * 100}%`;
  }, []);

  const registerThumbnailDisplayRef = useCallback((el: HTMLDivElement | null) => {
    thumbnailDisplayRef.current = el;
    if (el && thumbnailCuesRef.current && thumbnailCuesRef.current.cues.length > 0 && thumbnailCuesRef.current.duration > 0) {
      const time = progressRef.current * thumbnailCuesRef.current.duration;
      const css = getCueForTime(thumbnailCuesRef.current.cues, time);
      if (css) {
        el.style.background = css.background;
        el.style.width = `${THUMB_CELL_WIDTH}px`;
        el.style.height = `${THUMB_CELL_HEIGHT}px`;
      }
    }
  }, []);

  // 当当前预览卡片的 VTT/cues 数据异步就绪时，如果 DOM 已经挂载，则主动绘制一帧，避免用户悬停不动时一直看到黑块
  useEffect(() => {
    const cuesData = thumbnailCuesData;
    const el = thumbnailDisplayRef.current;
    if (!cuesData || !el) return;
    if (cuesData.cues.length === 0 || cuesData.duration <= 0) return;

    const time = progressRef.current * cuesData.duration;
    const css = getCueForTime(cuesData.cues, time);
    if (!css) return;

    el.style.background = css.background;
    el.style.width = `${THUMB_CELL_WIDTH}px`;
    el.style.height = `${THUMB_CELL_HEIGHT}px`;
  }, [thumbnailCuesData]);

  const handleNavigateDetail = useCallback(
    (code: string) => {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
      navigate(`/detail/${encodeURIComponent(code)}`);
    },
    [navigate]
  );

  const handleNavigatePlay = useCallback(
    (code: string) => {
      sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
      navigate(`/play/${encodeURIComponent(code)}`);
    },
    [navigate]
  );

  const handleContextMenu = useCallback((code: string, x: number, y: number) => {
    setContextMenu({ code, x, y });
  }, []);

  if (loading) {
    return (
      <SimpleGrid minChildWidth="200px" spacing={4} justifyItems="center" sx={GRID_SX}>
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </SimpleGrid>
    );
  }

  return (
    <>
      <SimpleGrid minChildWidth="200px" spacing={4} justifyItems="center" sx={GRID_SX}>
        {items.map((item: MediaItem, index: number) => {
          const posterUrl = item.poster_url ? `${getBaseUrl()}${item.poster_url}` : undefined;
          const isNewCard = newCardsStartIndex >= 0 && index >= newCardsStartIndex;
          const newCardStaggerIndex = isNewCard ? index - newCardsStartIndex : 0;
          const isPreview = previewCard?.code === item.code;
          return (
            <VideoCard
              key={item.code}
              item={item}
              isPreview={isPreview}
              isPlayButtonNear={playButtonNearCode === item.code}
              isNewCard={isNewCard}
              newCardStaggerIndex={newCardStaggerIndex}
              posterUrl={posterUrl}
              onNavigateDetail={handleNavigateDetail}
              onNavigatePlay={handleNavigatePlay}
              onMouseEnter={handleCardMouseEnter}
              onMouseLeave={handleCardMouseLeave}
              onMouseMove={handleCardMouseMove}
              onContextMenu={handleContextMenu}
              registerProgressBarRef={isPreview ? registerProgressBarRef : undefined}
              registerThumbnailDisplayRef={isPreview ? registerThumbnailDisplayRef : undefined}
            />
          );
        })}
        {loadingMore &&
          Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={`loading-more-${i}`} />
          ))}
      </SimpleGrid>

      <Box ref={sentinelRef} h="1px" w="100%" aria-hidden />

      <Flex align="center" justify="center" py={4} gap={2}>
        <Text fontSize="sm" color="app.muted">
          已加载 {items.length} 条{total > 0 ? `，共 ${total} 条` : ""}
        </Text>
        {loadingMore && <Spinner size="sm" color="orange.400" />}
        {!hasMore && items.length > 0 && (
          <Text fontSize="sm" color="app.muted">
            已加载全部
          </Text>
        )}
      </Flex>

      {contextMenu && (
        <Portal>
          <Box
            position="fixed"
            left={contextMenu.x}
            top={contextMenu.y}
            zIndex={9999}
            bg="app.surface"
            borderWidth="1px"
            borderColor="app.border"
            borderRadius="md"
            shadow="lg"
            py={1}
            minW="120px"
            onClick={(e) => e.stopPropagation()}
          >
            <Box
              as="button"
              type="button"
              w="100%"
              textAlign="left"
              px={3}
              py={2}
              fontSize="sm"
              _hover={{ bg: "whiteAlpha.200" }}
              onClick={() => {
                window.open(`/detail/${encodeURIComponent(contextMenu.code)}`, "_blank");
                setContextMenu(null);
              }}
            >
              新标签页打开
            </Box>
          </Box>
        </Portal>
      )}
    </>
  );
}
