import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  useToast
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

const getBaseUrl = () =>
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const getToken = () => localStorage.getItem("authToken");

const PAGE_SIZE = 24;

/** 将 params 中数组序列化为重复 key（genre=a&genre=b）供后端 getlist 使用 */
function serializeParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((vv) => parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(vv))}`));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

interface MediaItem {
  code: string;
  title?: string;
  video_type?: string;
  has_video: boolean;
  poster_url?: string;
}

/** 过滤规则：交集 = 同时满足类型与标签；并集 = 满足类型或标签其一即可 */
export type FilterRuleMode = "and" | "or";

/** 可扩展的列表筛选/排序配置，便于后续新增规则（如排序） */
export interface ListFilters {
  genres: string[];
  tags: string[];
  filterMode: FilterRuleMode;
  // sortBy?: string;
  // sortOrder?: "asc" | "desc";
}

/** 从 ListFilters 生成列表 API 的 query params（便于扩展） */
function filtersToParams(filters: ListFilters): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (filters.genres?.length) params.genre = filters.genres;
  if (filters.tags?.length) params.tag = filters.tags;
  params.filter_mode = filters.filterMode;
  // if (filters.sortBy) params.sort_by = filters.sortBy;
  // if (filters.sortOrder) params.sort_order = filters.sortOrder;
  return params;
}

interface FilterOptions {
  genres: string[];
  tags: string[];
}

export default function VideoLibPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [nextPage, setNextPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ genres: [], tags: [] });
  const [filters, setFilters] = useState<ListFilters>({ genres: [], tags: [], filterMode: "and" });
  const isFirstFilterMount = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const loadPage = useCallback(
    async (
      pageNumber: number,
      keyword: string,
      append: boolean,
      filterState: ListFilters
    ) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params: Record<string, unknown> = {
          page: pageNumber,
          page_size: PAGE_SIZE,
          q: keyword || undefined,
          ...filtersToParams(filterState),
        };
        const res = await apiClient.get("/api/items", {
          params,
          paramsSerializer: (p: Record<string, unknown>) => serializeParams(p),
        });
        const list = res.data.items as MediaItem[];
        const totalCount = res.data.total as number;
        setTotal(totalCount);
        if (append) {
          setItems((prev) => {
            const codes = new Set(prev.map((i) => i.code));
            const added = list.filter((i) => !codes.has(i.code));
            return prev.concat(added);
          });
        } else {
          setItems(list);
        }
        setNextPage(pageNumber + 1);
        setHasMore(list.length === PAGE_SIZE && items.length + list.length < totalCount);
      } catch (err: any) {
        const msg = err?.response?.data?.error || "加载列表失败";
        toast({ title: msg, status: "error" });
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [toast]
  );

  const loadInitial = useCallback(() => {
    setNextPage(1);
    setHasMore(true);
    loadPage(1, search, false, filters);
  }, [search, filters, loadPage]);

  useEffect(() => {
    loadInitial();
  }, []);

  // 任何过滤项或规则变化都立即刷新列表（不依赖浮窗关闭）
  useEffect(() => {
    if (isFirstFilterMount.current) {
      isFirstFilterMount.current = false;
      return;
    }
    setNextPage(1);
    setHasMore(true);
    loadPage(1, search, false, filters);
  }, [filters]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    loadPage(nextPage, search, true, filters);
  }, [loading, loadingMore, hasMore, nextPage, search, filters, loadPage]);

  useEffect(() => {
    apiClient
      .get<{ genres: string[]; tags: string[] }>("/api/filters")
      .then((res) => setFilterOptions({ genres: res.data.genres || [], tags: res.data.tags || [] }))
      .catch(() => {});
  }, []);

  // 滚动到底部时加载更多
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

  const handleScan = async () => {
    try {
      const res = await apiClient.post("/api/scan");
      toast({
        title: "扫描完成",
        description: `本次处理 ${res.data.processed} 条记录`,
        status: "success"
      });
      const filterRes = await apiClient.get<{ genres: string[]; tags: string[] }>("/api/filters");
      setFilterOptions({ genres: filterRes.data.genres || [], tags: filterRes.data.tags || [] });
      loadInitial();
    } catch (err: any) {
      const msg = err?.response?.data?.error || "触发扫描失败";
      toast({ title: msg, status: "error" });
    }
  };

  const toggleGenre = (g: string) => {
    setFilters((prev) => ({
      ...prev,
      genres: prev.genres.includes(g) ? prev.genres.filter((x) => x !== g) : [...prev.genres, g],
    }));
  };
  const toggleTag = (t: string) => {
    setFilters((prev) => ({
      ...prev,
      tags: prev.tags.includes(t) ? prev.tags.filter((x) => x !== t) : [...prev.tags, t],
    }));
  };

  const setFilterMode = (mode: FilterRuleMode) => {
    setFilters((prev) => ({ ...prev, filterMode: mode }));
  };

  const hasActiveFilters = filters.genres.length > 0 || filters.tags.length > 0;

  return (
    <Stack spacing={4}>
      <Flex align="center" gap={4} flexWrap="wrap">
        <Button size="sm" onClick={handleScan}>
          刷新库（扫描）
        </Button>
        <Box flex="1" />

        {/* 单一过滤器按钮：点击弹出浮窗，Badge 切换启用，任意修改即刷新 */}
        <Popover placement="bottom-start" closeOnBlur>
          <PopoverTrigger>
            <Button
              size="sm"
              variant={hasActiveFilters ? "solid" : "outline"}
              colorScheme={hasActiveFilters ? "blue" : undefined}
            >
              过滤器
              {hasActiveFilters && ` (${filters.genres.length + filters.tags.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent w="auto" minW="280px" maxW="400px" _focus={{ outline: 0 }}>
            <PopoverBody>
              <Stack spacing={4}>
                {/* 交集 / 并集 */}
                <Flex align="center" gap={2}>
                  <Button
                    size="xs"
                    variant={filters.filterMode === "and" ? "solid" : "outline"}
                    colorScheme="blue"
                    onClick={() => setFilterMode("and")}
                  >
                    交集
                  </Button>
                  <Button
                    size="xs"
                    variant={filters.filterMode === "or" ? "solid" : "outline"}
                    colorScheme="blue"
                    onClick={() => setFilterMode("or")}
                  >
                    并集
                  </Button>
                </Flex>
                {/* 类型：与 Detail 一致用 blue 基础色 */}
                <Box>
                  <Text fontSize="xs" color="gray.500" mb={2}>
                    类型
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {filterOptions.genres.length === 0 ? (
                      <Text fontSize="sm" color="gray.500">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      filterOptions.genres.map((g) => {
                        const on = filters.genres.includes(g);
                        return (
                          <Badge
                            key={g}
                            variant={on ? "solid" : "subtle"}
                            colorScheme="blue"
                            cursor="pointer"
                            onClick={() => toggleGenre(g)}
                            _hover={{ opacity: 0.9 }}
                          >
                            {g}
                          </Badge>
                        );
                      })
                    )}
                  </Flex>
                </Box>
                {/* 标签：与 Detail 一致用 gray 基础色 */}
                <Box>
                  <Text fontSize="xs" color="gray.500" mb={2}>
                    标签
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {filterOptions.tags.length === 0 ? (
                      <Text fontSize="sm" color="gray.500">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      filterOptions.tags.map((t) => {
                        const on = filters.tags.includes(t);
                        return (
                          <Badge
                            key={t}
                            variant={on ? "solid" : "outline"}
                            colorScheme="gray"
                            cursor="pointer"
                            onClick={() => toggleTag(t)}
                            _hover={{ opacity: 0.9 }}
                          >
                            {t}
                          </Badge>
                        );
                      })
                    )}
                  </Flex>
                </Box>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </Popover>

        <Input
          placeholder="按番号或标题搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxW="260px"
          size="sm"
        />
        <Button size="sm" onClick={() => loadInitial()} ml={2} variant="outline">
          搜索
        </Button>
      </Flex>

      {loading ? (
        <Flex align="center" justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : (
        <>
          <SimpleGrid
            minChildWidth="200px"
            spacing={4}
            justifyItems="center"
            sx={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, min(320px, 26vw)))" }}
          >
            {items.map((item) => {
              const token = getToken();
              const posterUrl = item.poster_url
                ? `${getBaseUrl()}${item.poster_url}${token ? `?token=${encodeURIComponent(token)}` : ""}`
                : undefined;
              return (
                <Box
                  key={item.code}
                  w="100%"
                  maxW="min(320px, 26vw)"
                  borderWidth="1px"
                  borderColor="whiteAlpha.200"
                  borderRadius="md"
                  overflow="hidden"
                  cursor="pointer"
                  bg="gray.800"
                  transition="all 0.28s ease"
                  _hover={{
                    shadow: "xl",
                    borderWidth: "2px",
                    borderColor: "whiteAlpha.500"
                  }}
                  sx={{
                    "&:hover .poster-img": { transform: "scale(1.08)" }
                  }}
                  onClick={() => navigate(`/detail/${encodeURIComponent(item.code)}`)}
                >
                  <Box
                    aspectRatio="2/3"
                    bg="gray.700"
                    position="relative"
                    overflow="hidden"
                  >
                    {posterUrl ? (
                      <Image
                        className="poster-img"
                        src={posterUrl}
                        alt={item.title || item.code}
                        objectFit="cover"
                        w="100%"
                        h="100%"
                        fallbackSrc=""
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
                        color="gray.500"
                        fontSize="sm"
                      >
                        无海报
                      </Flex>
                    )}
                  </Box>
                  <Box p={3}>
                    <Heading size="sm" noOfLines={2} mb={1}>
                      {item.title || item.code}
                    </Heading>
                    <Text fontSize="xs" color="gray.400" noOfLines={1}>
                      {item.code}
                    </Text>
                    <Flex mt={2} gap={2} align="center" flexWrap="wrap">
                      {item.has_video ? (
                        <Badge colorScheme="green" size="sm">有视频</Badge>
                      ) : (
                        <Badge colorScheme="red" size="sm">无视频</Badge>
                      )}
                      {item.video_type && (
                        <Badge variant="outline" size="sm">{item.video_type}</Badge>
                      )}
                    </Flex>
                  </Box>
                </Box>
              );
            })}
          </SimpleGrid>

          {/* 底部哨兵：进入视口时触发加载更多 */}
          <Box ref={sentinelRef} h="1px" w="100%" aria-hidden />

          <Flex align="center" justify="center" py={4} gap={2}>
            <Text fontSize="sm" color="gray.500">
              已加载 {items.length} 条{total > 0 ? `，共 ${total} 条` : ""}
            </Text>
            {loadingMore && <Spinner size="sm" />}
            {!hasMore && items.length > 0 && (
              <Text fontSize="sm" color="gray.500">
                已加载全部
              </Text>
            )}
          </Flex>
        </>
      )}
    </Stack>
  );
}
