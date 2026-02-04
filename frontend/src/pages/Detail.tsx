import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Image,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  useToast,
  Wrap,
  WrapItem
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

const getBaseUrl = () =>
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const getToken = () => localStorage.getItem("authToken");

interface Actor {
  name: string;
  role?: string;
  thumb?: string | null;
}

interface Metadata {
  rating?: number | null;
  userrating?: number | null;
  votes?: number | null;
  year?: number | null;
  premiered?: string | null;
  runtime?: number | null;
  genres?: string[];
  tags?: string[];
  country?: string | null;
  director?: string | null;
  studio?: string | null;
  actors?: Actor[];
  outline?: string | null;
}

interface MediaDetail {
  code: string;
  title?: string | null;
  description?: string | null;
  video_type?: string | null;
  has_video: boolean;
  poster_url?: string;
  metadata?: Metadata;
}

function MetaLine({
  label,
  value,
  hideIfEmpty = true
}: {
  label: string;
  value?: string | number | null;
  hideIfEmpty?: boolean;
}) {
  if (hideIfEmpty && (value === undefined || value === null || value === ""))
    return null;
  return (
    <Text fontSize="sm" color="gray.400">
      <Text as="span" color="gray.500" mr={2}>
        {label}:
      </Text>
      {String(value)}
    </Text>
  );
}

export default function DetailPage() {
  const { code } = useParams<{ code: string }>();
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await apiClient.get(`/api/items/${encodeURIComponent(code || "")}`);
        setItem(res.data);
      } catch (err: any) {
        const msg = err?.response?.data?.error || "加载详情失败";
        toast({ title: msg, status: "error" });
      } finally {
        setLoading(false);
      }
    };
    if (code) load();
  }, [code, toast]);

  if (loading) {
    return (
      <Stack spacing={4}>
        <Flex gap={6} align="flex-start">
          <Skeleton w="min(280px, 26vw)" aspectRatio={2 / 3} borderRadius="md" flexShrink={0} />
          <Stack flex={1} spacing={3}>
            <Skeleton h="32px" w="70%" />
            <Skeleton h="20px" w="40%" />
            <Skeleton h="80px" w="100%" />
          </Stack>
        </Flex>
      </Stack>
    );
  }

  if (!item) {
    return (
      <Box>
        <Text>加载失败或条目不存在</Text>
      </Box>
    );
  }

  const token = getToken();
  const posterUrl = item.poster_url
    ? `${getBaseUrl()}${item.poster_url}${token ? `?token=${encodeURIComponent(token)}` : ""}`
    : undefined;
  const meta = item.metadata;

  return (
    <Stack spacing={6}>
      <Flex
        direction={{ base: "column", md: "row" }}
        gap={6}
        align="flex-start"
        flexWrap="nowrap"
      >
        {/* 海报 */}
        <Box
          w={{ base: "100%", md: "min(280px, 26vw)" }}
          maxW="320px"
          flexShrink={0}
          borderRadius="lg"
          overflow="hidden"
          bg="gray.800"
          boxShadow="lg"
        >
          <Box aspectRatio={2 / 3} position="relative">
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={item.title || item.code}
                objectFit="cover"
                w="100%"
                h="100%"
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
        </Box>

        {/* 右侧信息 */}
        <Stack spacing={4} flex={1} minW={0}>
          <Heading size="lg" noOfLines={2}>
            {item.title || item.code}
          </Heading>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text fontSize="sm" color="gray.500">
              番号：{item.code}
            </Text>
            {item.has_video ? (
              <Badge colorScheme="green">有视频</Badge>
            ) : (
              <Badge colorScheme="red">无视频</Badge>
            )}
            {item.video_type && (
              <Badge variant="outline">{item.video_type}</Badge>
            )}
          </Flex>

          {/* 评分、年份、时长等 */}
          <Flex gap={4} flexWrap="wrap">
            {meta?.rating != null && (
              <Text fontSize="sm" color="gray.300">
                评分 {meta.rating}
                {meta.votes != null && meta.votes > 0 && (
                  <Text as="span" color="gray.500" ml={1}>
                    ({meta.votes})
                  </Text>
                )}
              </Text>
            )}
            <MetaLine label="年份" value={meta?.year} />
            <MetaLine label="时长" value={meta?.runtime != null ? `${meta.runtime} 分钟` : undefined} />
            <MetaLine label="上映" value={meta?.premiered} />
          </Flex>

          <MetaLine label="国家/地区" value={meta?.country} />
          <MetaLine label="导演" value={meta?.director} />
          <MetaLine label="制片" value={meta?.studio} />

          {/* 类型、标签 */}
          {(meta?.genres?.length || meta?.tags?.length) ? (
            <Wrap spacing={2}>
              {meta?.genres?.map((g) => (
                <WrapItem key={g}>
                  <Badge colorScheme="blue" variant="subtle">
                    {g}
                  </Badge>
                </WrapItem>
              ))}
              {meta?.tags?.map((t) => (
                <WrapItem key={t}>
                  <Badge variant="outline" colorScheme="gray">
                    {t}
                  </Badge>
                </WrapItem>
              ))}
            </Wrap>
          ) : null}

          {/* 简短概述 */}
          {meta?.outline && (
            <Text fontSize="sm" color="gray.400" noOfLines={3}>
              {meta.outline}
            </Text>
          )}


          {/* 播放按钮 */}
          <Button
            colorScheme="teal"
            size="lg"
            isDisabled={!item.has_video}
            onClick={() => navigate(`/play/${encodeURIComponent(item.code)}`)}
          >
            播放
          </Button>
        </Stack>
      </Flex>

      {/* 演员表 */}
      {meta?.actors?.length ? (
        <Box>
          <Heading size="sm" mb={3} color="gray.400">
            演员
          </Heading>
          <SimpleGrid columns={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing={4}>
            {meta.actors.map((actor) => (
              <Flex
                key={actor.name}
                align="center"
                gap={3}
                p={3}
                borderRadius="md"
                bg="blackAlpha.400"
                _hover={{ bg: "whiteAlpha.100" }}
              >
                <Box
                  w="10"
                  h="10"
                  borderRadius="full"
                  overflow="hidden"
                  bg="gray.600"
                  flexShrink={0}
                >
                  {actor.thumb ? (
                    <Image
                      src={actor.thumb}
                      alt={actor.name}
                      objectFit="cover"
                      w="100%"
                      h="100%"
                    />
                  ) : (
                    <Flex
                      w="100%"
                      h="100%"
                      align="center"
                      justify="center"
                      color="gray.500"
                      fontSize="xs"
                    >
                      {actor.name.slice(0, 1)}
                    </Flex>
                  )}
                </Box>
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight="medium" noOfLines={1}>
                    {actor.name}
                  </Text>
                  {actor.role ? (
                    <Text fontSize="xs" color="gray.500" noOfLines={1}>
                      {actor.role}
                    </Text>
                  ) : null}
                </Box>
              </Flex>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}
    </Stack>
  );
}
