import {
  Badge,
  Box,
  Flex,
  Heading,
  Image,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Wrap,
  WrapItem
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { fetchItem } from "../api/calls";
import { getBaseUrl } from "../api/client";
import type { MediaDetail } from "../types/api";

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
    <Text fontSize="sm" color="app.muted.fg">
      <Text as="span" color="app.muted" mr={2}>
        {label}:
      </Text>
      {String(value)}
    </Text>
  );
}

export default function DetailPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const { data: item, isLoading: loading, isError, error } = useQuery({
    queryKey: ["item", code],
    queryFn: () => fetchItem(code!),
    enabled: !!code,
  });

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

  if (!code || (!loading && !item)) {
    const msg = isError && error
      ? (error as { response?: { data?: { error?: string } } })?.response?.data?.error || "加载详情失败"
      : "加载失败或条目不存在";
    return (
      <Box>
        <Text>{msg}</Text>
      </Box>
    );
  }

  const detail = item as MediaDetail;
  const posterUrl = detail.poster_url
    ? `${getBaseUrl()}${detail.poster_url}`
    : undefined;
  const meta = detail.metadata;

  return (
    <Stack spacing={6}>
      <Flex
        direction={{ base: "column", md: "row" }}
        gap={6}
        align="flex-start"
        flexWrap="nowrap"
      >
        {/* 海报：悬停缩放 + 播放图标，点击跳转播放页 */}
        <Box
          w={{ base: "100%", md: "min(280px, 26vw)" }}
          maxW="320px"
          flexShrink={0}
          borderRadius="lg"
          overflow="hidden"
          bg="app.surface"
          boxShadow="lg"
          position="relative"
          cursor={detail.has_video ? "pointer" : "default"}
          onClick={() => detail.has_video && navigate(`/play/${encodeURIComponent(detail.code)}`)}
          role={detail.has_video ? "button" : undefined}
          aria-label={detail.has_video ? "播放" : undefined}
          sx={{
            "& .poster-img": {
              transition: "transform 0.3s ease",
            },
            ...(detail.has_video && {
              "&:hover .poster-img": { transform: "scale(1.05)" },
            }),
            "& .play-overlay": {
              opacity: 0,
              transition: "opacity 0.2s ease",
            },
            ...(detail.has_video && {
              "&:hover .play-overlay": { opacity: 1 },
            }),
          }}
        >
          <Box aspectRatio={2 / 3} position="relative">
            {posterUrl ? (
              <Image
                className="poster-img"
                src={posterUrl}
                alt={detail.title || detail.code}
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
                color="app.muted"
                fontSize="sm"
              >
                无海报
              </Flex>
            )}
            {detail.has_video && (
              <Flex
                className="play-overlay"
                position="absolute"
                inset={0}
                align="center"
                justify="center"
                bg="blackAlpha.65"
                pointerEvents="none"
              >
                <Flex
                  w="24"
                  h="24"
                  borderRadius="full"
                  bg="app.accent"
                  color="app.accent.fg"
                  align="center"
                  justify="center"
                  fontSize="5xl"
                  pl="8px"
                  boxShadow="xl"
                >
                  ▶
                </Flex>
              </Flex>
            )}
          </Box>
        </Box>

        {/* 右侧信息 */}
        <Stack spacing={4} flex={1} minW={0}>
          <Heading size="lg" noOfLines={2}>
            {detail.title || detail.code}
          </Heading>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text fontSize="sm" color="app.muted">
              番号：{detail.code}
            </Text>
            {detail.has_video ? (
              <Badge colorScheme="green">有视频</Badge>
            ) : (
              <Badge colorScheme="red">无视频</Badge>
            )}
            {detail.video_type && (
              <Badge variant="outline" colorScheme="gray">{detail.video_type}</Badge>
            )}
          </Flex>

          {/* 评分、年份、时长等 */}
          <Flex gap={4} flexWrap="wrap">
            {meta?.rating != null && (
              <Text fontSize="sm" color="gray.300">
                评分 {meta.rating}
                {meta.votes != null && meta.votes > 0 && (
                  <Text as="span" color="app.muted" ml={1}>
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

          {/* 类型、标签：分两行 */}
          {meta?.genres?.length ? (
            <Box>
              <Text fontSize="xs" color="app.muted" mb={2}>
                类型
              </Text>
              <Wrap spacing={2}>
                {meta.genres.map((g) => (
                  <WrapItem key={g}>
                    <Badge colorScheme="orange" variant="subtle">
                      {g}
                    </Badge>
                  </WrapItem>
                ))}
              </Wrap>
            </Box>
          ) : null}
          {meta?.tags?.length ? (
            <Box>
              <Text fontSize="xs" color="app.muted" mb={2}>
                标签
              </Text>
              <Wrap spacing={2}>
                {meta.tags.map((t) => (
                  <WrapItem key={t}>
                    <Badge variant="outline" colorScheme="gray">
                      {t}
                    </Badge>
                  </WrapItem>
                ))}
              </Wrap>
            </Box>
          ) : null}

          {/* 简短概述 */}
          {meta?.outline && (
            <Text fontSize="sm" color="app.muted.fg" noOfLines={3}>
              {meta.outline}
            </Text>
          )}
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
