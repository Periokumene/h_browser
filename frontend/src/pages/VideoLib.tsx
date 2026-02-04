import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Image,
  Input,
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

interface MediaItem {
  code: string;
  title?: string;
  video_type?: string;
  has_video: boolean;
  poster_url?: string;
}

export default function VideoLibPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [nextPage, setNextPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const loadPage = useCallback(
    async (pageNumber: number, keyword: string, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await apiClient.get("/api/items", {
          params: {
            page: pageNumber,
            page_size: PAGE_SIZE,
            q: keyword || undefined
          }
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

  // 初始加载与搜索：从第一页开始，不追加
  const loadInitial = useCallback(() => {
    setNextPage(1);
    setHasMore(true);
    loadPage(1, search, false);
  }, [search, loadPage]);

  useEffect(() => {
    loadInitial();
  }, []);

  // 加载更多（下一页）
  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    loadPage(nextPage, search, true);
  }, [loading, loadingMore, hasMore, nextPage, search, loadPage]);

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
      loadInitial();
    } catch (err: any) {
      const msg = err?.response?.data?.error || "触发扫描失败";
      toast({ title: msg, status: "error" });
    }
  };

  return (
    <Stack spacing={4}>
      <Flex align="center" gap={4}>
        <Heading size="md">媒体列表</Heading>
        <Button size="sm" onClick={handleScan}>
          刷新库（扫描）
        </Button>
        <Box flex="1" />
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
