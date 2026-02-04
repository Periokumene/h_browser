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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

const getBaseUrl = () =>
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const getToken = () => localStorage.getItem("authToken");

interface MediaItem {
  code: string;
  title?: string;
  video_type?: string;
  has_video: boolean;
  poster_url?: string;
}

export default function ListPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const toast = useToast();
  const navigate = useNavigate();

  const load = async (pageNumber: number, keyword: string) => {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/items", {
        params: {
          page: pageNumber,
          page_size: pageSize,
          q: keyword || undefined
        }
      });
      setItems(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "加载列表失败";
      toast({ title: msg, status: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async () => {
    try {
      const res = await apiClient.post("/api/scan");
      toast({
        title: "扫描完成",
        description: `本次处理 ${res.data.processed} 条记录`,
        status: "success"
      });
      load(page, search);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "触发扫描失败";
      toast({ title: msg, status: "error" });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
        <Button
          size="sm"
          onClick={() => load(1, search)}
          ml={2}
          variant="outline"
        >
          搜索
        </Button>
      </Flex>

      {loading ? (
        <Flex align="center" justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : (
        <>
          <SimpleGrid minChildWidth="200px" spacing={4}>
            {items.map((item) => {
              const token = getToken();
              const posterUrl = item.poster_url
                ? `${getBaseUrl()}${item.poster_url}${token ? `?token=${encodeURIComponent(token)}` : ""}`
                : undefined;
              return (
                <Box
                  key={item.code}
                  borderWidth="1px"
                  borderRadius="md"
                  overflow="hidden"
                  cursor="pointer"
                  _hover={{ shadow: "md" }}
                  onClick={() => navigate(`/detail/${encodeURIComponent(item.code)}`)}
                  bg="gray.800"
                >
                  <Box aspectRatio="2/3" bg="gray.700" position="relative">
                    {posterUrl ? (
                      <Image
                        src={posterUrl}
                        alt={item.title || item.code}
                        objectFit="cover"
                        w="100%"
                        h="100%"
                        fallbackSrc=""
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
          <Flex align="center" justify="space-between" pt={2}>
            <Text fontSize="sm" color="gray.500">
              共 {total} 条，第 {page} / {totalPages} 页
            </Text>
            <Flex gap={2}>
              <Button
                size="sm"
                onClick={() => load(page - 1, search)}
                isDisabled={page <= 1}
              >
                上一页
              </Button>
              <Button
                size="sm"
                onClick={() => load(page + 1, search)}
                isDisabled={page >= totalPages}
              >
                下一页
              </Button>
            </Flex>
          </Flex>
        </>
      )}
    </Stack>
  );
}

