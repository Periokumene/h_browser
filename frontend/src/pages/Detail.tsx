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
  Wrap,
  WrapItem,
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

  // ---------- 布局参数（可调） ----------
  /** 重点交互栏距视口顶部的比例，约 0.4 = 栏顶在 40vh 处，可按需调整 */
  const BAR_TOP_VH = 0.4;
  /** 海报高度占视口比例，约 0.75 = 75vh，可按需调整 */
  const POSTER_HEIGHT_VH = 0.75;
  /** 未滚动时海报垂直居中：海报中心在视口中的比例，0.5 = 居中；改此值可整体上下移动海报与栏 */
  const POSTER_CENTER_VH = 0.5;
  // ------------------------------------
  const posterTopVH = POSTER_CENTER_VH - POSTER_HEIGHT_VH / 2;
  /** 海报宽度（与高度 2:3），用于栏/详情的左侧留白与 full-bleed 计算 */
  const posterWidthVh = POSTER_HEIGHT_VH * (2 / 3);
  const barH = 72;
  const fanartH = 180;
  const layoutPx = "var(--chakra-space-6, 1.5rem)";
  /** 桌面端下层内容（栏、详情）左侧留白 = 海报宽 + 布局边距，避免被上层海报遮挡 */
  const contentLeftMd = `calc(${posterWidthVh * 100}vh + ${layoutPx})`;

  return (
    <Stack spacing={0} position="relative">
      {/* ---------- 下层：fanart、重点交互栏、简介/元数据（文档流） ---------- */}
      {/* fanart：桌面端高度使栏顶落在 BAR_TOP_VH(40vh)，小屏固定高度 */}
      <Box
        w="100%"
        h={{ base: `${fanartH}px`, md: `${BAR_TOP_VH * 100}vh` }}
        bg="gray.700"
        flexShrink={0}
        overflow="hidden"
      >
        <Flex h="100%" align="center" justify="center" color="gray.500" fontSize="sm">
          fanart 占位
        </Flex>
      </Box>

      {/* ---------- 上层：仅海报；桌面端绝对定位叠在下层之上，小屏在文档流中 ---------- */}
      <Box
        position={{ base: "relative", md: "absolute" }}
        top={{ base: undefined, md: `${posterTopVH * 100}vh` }}
        left={{ base: 0, md: layoutPx }}
        w={{ base: "100%", md: `calc(${posterWidthVh * 100}vh)` }}
        h={{ base: "auto", md: `calc(${POSTER_HEIGHT_VH * 100}vh)` }}
        maxW={{ base: "320px", md: "none" }}
        mx={{ base: "auto", md: 0 }}
        zIndex={10}
        flexShrink={0}
        borderRadius="lg"
        overflow="hidden"
        bg="app.surface"
        boxShadow="lg"
        cursor={detail.has_video ? "pointer" : "default"}
        onClick={() => detail.has_video && navigate(`/play/${encodeURIComponent(detail.code)}`)}
        role={detail.has_video ? "button" : undefined}
        aria-label={detail.has_video ? "播放" : undefined}
        sx={{
          "& .poster-img": { transition: "transform 0.3s ease" },
          ...(detail.has_video && { "&:hover .poster-img": { transform: "scale(1.05)" } }),
          "& .play-overlay": { opacity: 0, transition: "opacity 0.2s ease" },
          ...(detail.has_video && { "&:hover .play-overlay": { opacity: 1 } }),
        }}
      >
        <Box
          position="relative"
          w="100%"
          h="100%"
          sx={{ aspectRatio: { base: "2/3", md: "unset" } }}
        >
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
            <Flex h="100%" align="center" justify="center" color="app.muted" fontSize="sm">
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

      {/* 重点交互栏：全宽，下层；桌面端左侧留白使文字从海报右侧开始 */}
      <Flex
        minH={`${barH}px`}
        direction="column"
        justify="center"
        py={2}
        pl={{ base: 4, md: contentLeftMd }}
        pr={4}
        bg="gray.700"
        flexShrink={0}
      >
        <Flex align="center" justify="space-between" gap={3} flexWrap="wrap">
          <Heading size="md" noOfLines={1} flex="1 1 auto" minW="120px">
            {detail.title || detail.code}
          </Heading>
          {detail.video_type && (
            <Badge variant="outline" colorScheme="gray" fontSize="sm">
              {detail.video_type}
            </Badge>
          )}
        </Flex>
        <Flex align="center" justify="space-between" gap={3} flexWrap="wrap" mt={1}>
          <Flex align="center" gap={3} flexWrap="wrap">
            {meta?.rating != null && (
              <Text fontSize="sm" color="gray.300">
                评分 {meta.rating}
                {meta.votes != null && meta.votes > 0 && (
                  <Text as="span" color="gray.500" ml={1}>({meta.votes})</Text>
                )}
              </Text>
            )}
            {meta?.year != null && <Text fontSize="sm" color="gray.400">{meta.year}</Text>}
            {meta?.runtime != null && (
              <Text fontSize="sm" color="gray.400">{meta.runtime} 分钟</Text>
            )}
            <Text fontSize="sm" color="gray.500">番号 {detail.code}</Text>
          </Flex>
          {detail.has_video ? (
            <Button
              size="sm"
              colorScheme="orange"
              leftIcon={<Text>▶</Text>}
              onClick={() => navigate(`/play/${encodeURIComponent(detail.code)}`)}
            >
              播放
            </Button>
          ) : (
            <Badge colorScheme="red">无视频</Badge>
          )}
        </Flex>
      </Flex>

      {/* 简介、类型、标签、元数据：下层，桌面端与栏对齐 */}
      <Stack spacing={4} pt={4} pb={4} pl={{ base: 4, md: contentLeftMd }} pr={4}>
        {meta?.outline && (
          <Text fontSize="sm" color="app.muted.fg" noOfLines={4}>
            {meta.outline}
          </Text>
        )}
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
        <MetaLine label="国家/地区" value={meta?.country} />
        <MetaLine label="导演" value={meta?.director} />
        <MetaLine label="制片" value={meta?.studio} />
        <MetaLine label="上映" value={meta?.premiered} />
      </Stack>

      {/* 演员表 */}
      {meta?.actors?.length ? (
        <Box pl={{ base: 4, md: contentLeftMd }} pr={4} pb={4}>
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
