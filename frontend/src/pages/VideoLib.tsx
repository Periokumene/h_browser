import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Input,
  Portal,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Skeleton,
  Spinner,
  Stack,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { fetchFilters, fetchItems, postScan } from "../api/calls";
import { getBaseUrl } from "../api/client";
import type { FilterRuleMode, ListFilters, ListScope, MediaItem } from "../types/api";

const PAGE_SIZE = 24;

export type { FilterRuleMode, ListFilters };

function filtersFromSearchParams(searchParams: URLSearchParams): ListFilters {
  const genres = searchParams.getAll("genre").filter(Boolean);
  const tags = searchParams.getAll("tag").filter(Boolean);
  const filterMode = searchParams.get("filter_mode") === "or" ? "or" : "and";
  return { genres, tags, filterMode };
}

function searchParamsFromFilters(prev: URLSearchParams, filters: ListFilters): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.delete("genre");
  next.delete("tag");
  filters.genres.forEach((g) => next.append("genre", g));
  filters.tags.forEach((t) => next.append("tag", t));
  next.set("filter_mode", filters.filterMode);
  return next;
}

const SCROLL_STORAGE_KEY = "videolib_scroll";

const CARD_MAX_W = "min(320px, 26vw)";
const GRID_SX = {
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, min(320px, 26vw)))",
  justifyContent: "center",
};

/** 卡片骨架：与真实卡片布局一致，用于首屏与加载更多占位 */
function CardSkeleton() {
  return (
    <Box w="100%" maxW={CARD_MAX_W} borderWidth="1px" borderColor="app.border" borderRadius="md" overflow="hidden" bg="app.surface" display="flex" flexDirection="column">
      <Skeleton aspectRatio="2/3" flexShrink={0} startColor="app.surface.subtle" endColor="whiteAlpha.200" />
      <Box p={3} flex={1} display="flex" flexDirection="column" minH={0}>
        <Skeleton height="4" width="90%" borderRadius="md" mb={2} startColor="app.surface.subtle" endColor="whiteAlpha.200" />
        <Box mt="auto" pt={2} display="flex" flexDirection="column" gap={2}>
          <Skeleton height="3" width="70%" borderRadius="md" startColor="app.surface.subtle" endColor="whiteAlpha.200" />
          <Skeleton height="3" width="50%" borderRadius="md" startColor="app.surface.subtle" endColor="whiteAlpha.200" />
        </Box>
      </Box>
    </Box>
  );
}

/** 海报图：未加载完成前显示 Skeleton */
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

export default function VideoLibPage() {
  const [search, setSearch] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const scope: ListScope = searchParams.get("scope") === "favorites" ? "favorites" : "all";
  const [filters, setFiltersState] = useState<ListFilters>(() => filtersFromSearchParams(searchParams));
  const [contextMenu, setContextMenu] = useState<{ code: string; x: number; y: number } | null>(null);
  const isFirstFilterMount = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const setFilters = useCallback(
    (next: ListFilters | ((prev: ListFilters) => ListFilters)) => {
      setFiltersState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        setSearchParams((p) => searchParamsFromFilters(p, resolved), { replace: true });
        return resolved;
      });
    },
    [setSearchParams]
  );

  // 从详情页点击类型/标签跳转时带入的筛选，应用一次并写入 URL 后清除 state
  useEffect(() => {
    const initial = (location.state as { initialFilters?: ListFilters } | null)?.initialFilters;
    if (initial) {
      setFiltersState(initial);
      const nextParams = searchParamsFromFilters(searchParams, initial);
      navigate({ pathname: location.pathname, search: nextParams.toString() }, { replace: true, state: {} });
    }
  }, [location.state?.initialFilters]);

  // 返回本页时恢复滚动位置
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

  // 右键菜单：点击页面任意处关闭
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  const { data: filterOptions } = useQuery({
    queryKey: ["filters"],
    queryFn: fetchFilters,
  });

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["items", scope, searchSubmitted, filters],
    queryFn: ({ pageParam }) =>
      fetchItems({
        page: pageParam,
        page_size: PAGE_SIZE,
        q: searchSubmitted || undefined,
        filters,
        scope,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return allPages.length + 1;
    },
  });

  const scanMutation = useMutation({
    mutationFn: postScan,
    onSuccess: (res) => {
      toast({ title: "扫描完成", description: `本次处理 ${res.processed} 条记录`, status: "success" });
      queryClient.invalidateQueries({ queryKey: ["filters"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast({ title: err?.response?.data?.error || "触发扫描失败", status: "error" });
    },
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

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

  const loadInitial = () => {
    setSearchSubmitted(search);
  };

  const handleFilterChange = (next: ListFilters) => {
    setFilters(next);
    if (isFirstFilterMount.current) {
      isFirstFilterMount.current = false;
    }
  };

  const toggleGenre = (g: string) => {
    handleFilterChange({
      ...filters,
      genres: filters.genres.includes(g) ? filters.genres.filter((x) => x !== g) : [...filters.genres, g],
    });
  };
  const toggleTag = (t: string) => {
    handleFilterChange({
      ...filters,
      tags: filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t],
    });
  };
  const setFilterMode = (mode: FilterRuleMode) => {
    handleFilterChange({ ...filters, filterMode: mode });
  };

  const hasActiveFilters = filters.genres.length > 0 || filters.tags.length > 0;
  const activeGenreLabels = filters.genres.map((g) => `[${g}]`);
  const activeTagLabels = filters.tags.map((t) => `${t}`);
  const allFilterLabels = [...activeGenreLabels, ...activeTagLabels];
  const filterSummaryText =
    !hasActiveFilters
      ? null
      : allFilterLabels.length > 3
        ? `筛选：多个过滤项（${filters.filterMode === "and" ? "交集" : "并集"}）`
        : `筛选：${allFilterLabels.join("、")}（${filters.filterMode === "and" ? "交集" : "并集"}）`;

  return (
    <Stack spacing={4}>
      <Flex align="center" gap={4} flexWrap="wrap">
        <Button size="sm" onClick={() => scanMutation.mutate()} isDisabled={scanMutation.isPending}>
          刷新库（扫描）
        </Button>
        <Box flex="1" />

        <Popover placement="bottom-start" closeOnBlur>
          <PopoverTrigger>
            <Button
              size="sm"
              variant={hasActiveFilters ? "solid" : "outline"}
              colorScheme={hasActiveFilters ? "orange" : undefined}
            >
              过滤器
              {hasActiveFilters && ` (${filters.genres.length + filters.tags.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent w="auto" minW="280px" maxW="400px" _focus={{ outline: 0 }}>
            <PopoverBody>
              <Stack spacing={4}>
                <Flex align="center" justify="space-between" gap={2}>
                  <Flex align="center" gap={2}>
                    <Button
                      size="xs"
                      variant={filters.filterMode === "and" ? "solid" : "outline"}
                      colorScheme="orange"
                      onClick={() => setFilterMode("and")}
                    >
                      交集
                    </Button>
                    <Button
                      size="xs"
                      variant={filters.filterMode === "or" ? "solid" : "outline"}
                      colorScheme="orange"
                      onClick={() => setFilterMode("or")}
                    >
                      并集
                    </Button>
                  </Flex>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="gray"
                    onClick={() => handleFilterChange({ genres: [], tags: [], filterMode: "and" })}
                  >
                    清空过滤器
                  </Button>
                </Flex>
                <Box>
                  <Text fontSize="xs" color="app.muted" mb={2}>
                    类型
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {(filterOptions?.genres?.length ?? 0) === 0 ? (
                      <Text fontSize="sm" color="app.muted">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      (filterOptions?.genres ?? []).map((g) => (
                        <Badge
                          key={g.name}
                          variant={filters.genres.includes(g.name) ? "solid" : "subtle"}
                          colorScheme="orange"
                          cursor="pointer"
                          onClick={() => toggleGenre(g.name)}
                          _hover={{ opacity: 0.9 }}
                        >
                          {g.name}
                          {g.count > 0 && (
                            <Text as="span" ml={1} opacity={0.8}>({g.count})</Text>
                          )}
                        </Badge>
                      ))
                    )}
                  </Flex>
                </Box>
                <Box>
                  <Text fontSize="xs" color="app.muted" mb={2}>
                    标签
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {(filterOptions?.tags?.length ?? 0) === 0 ? (
                      <Text fontSize="sm" color="app.muted">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      (filterOptions?.tags ?? []).map((t) => (
                        <Badge
                          key={t.name}
                          variant={filters.tags.includes(t.name) ? "solid" : "outline"}
                          colorScheme="gray"
                          cursor="pointer"
                          onClick={() => toggleTag(t.name)}
                          _hover={{ opacity: 0.9 }}
                        >
                          {t.name}
                          {t.count > 0 && (
                            <Text as="span" ml={1} opacity={0.8}>({t.count})</Text>
                          )}
                        </Badge>
                      ))
                    )}
                  </Flex>
                </Box>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </Popover>

        <Input
          placeholder="按番号或标题搜索（Enter 提交）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") loadInitial();
          }}
          maxW="260px"
          size="sm"
        />
      </Flex>

      {filterSummaryText && (
        <Text fontSize="sm" color="app.muted.fg">
          {filterSummaryText}
        </Text>
      )}

      {loading ? (
        <SimpleGrid
          minChildWidth="200px"
          spacing={4}
          justifyItems="center"
          sx={GRID_SX}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </SimpleGrid>
      ) : (
        <>
          <SimpleGrid
            minChildWidth="200px"
            spacing={4}
            justifyItems="center"
            sx={GRID_SX}
          >
            {items.map((item: MediaItem) => {
              const posterUrl = item.poster_url
                ? `${getBaseUrl()}${item.poster_url}`
                : undefined;
              return (
                <Box
                  key={item.code}
                  w="100%"
                  maxW={CARD_MAX_W}
                  borderWidth="1px"
                  borderColor="app.border"
                  borderRadius="md"
                  overflow="hidden"
                  cursor="pointer"
                  bg="app.surface"
                  display="flex"
                  flexDirection="column"
                  transition="all 0.28s ease"
                  _hover={{
                    shadow: "xl",
                    borderWidth: "2px",
                    borderColor: "app.border.hover",
                  }}
                  sx={{
                    "&:hover .poster-img": { transform: "scale(1.08)" },
                  }}
                  onClick={() => {
                    sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
                    navigate(`/detail/${encodeURIComponent(item.code)}`);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ code: item.code, x: e.clientX, y: e.clientY });
                  }}
                >
                  <Box
                    aspectRatio="2/3"
                    bg="app.surface.subtle"
                    position="relative"
                    overflow="hidden"
                    flexShrink={0}
                  >
                    {posterUrl ? (
                      <PosterWithSkeleton
                        className="poster-img"
                        src={posterUrl}
                        alt={item.title || item.code}
                        transition="transform 0.35s ease"
                        sx={{ transformOrigin: "center center" }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Flex
                        h="100%"
                        align="center"
                        justify="center"
                        color="app.muted"
                        fontSize="sm"
                      >
                        无海报
                      </Flex>
                    )}
                  </Box>
                  <Box
                    p={3}
                    flex={1}
                    display="flex"
                    flexDirection="column"
                    minH={0}
                  >
                    <Heading size="sm" noOfLines={2} mb={1}>
                      {item.title || item.code}
                    </Heading>
                    <Box mt="auto" pt={2} display="flex" flexDirection="column" gap={1}>
                      <Text
                        fontSize="xs"
                        color="app.muted.fg"
                        noOfLines={1}
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                      >
                        {[item.code, item.actors?.length ? item.actors.join("、") : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <Flex gap={2} align="center" flexWrap="wrap">
                        {item.has_video ? (
                          <Badge colorScheme="green" size="sm">有视频</Badge>
                        ) : (
                          <Badge colorScheme="red" size="sm">无视频</Badge>
                        )}
                        {item.video_type && (
                          <Badge variant="outline" size="sm" colorScheme="gray">{item.video_type}</Badge>
                        )}
                      </Flex>
                    </Box>
                  </Box>
                </Box>
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
        </>
      )}

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
            <Button
              size="sm"
              variant="ghost"
              w="100%"
              justifyContent="flex-start"
              px={3}
              onClick={() => {
                window.open(`/detail/${encodeURIComponent(contextMenu.code)}`, "_blank");
                setContextMenu(null);
              }}
            >
              新标签页打开
            </Button>
          </Box>
        </Portal>
      )}
    </Stack>
  );
}
