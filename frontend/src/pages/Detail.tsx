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

// ---------- 详情页设计尺度（与 theme 语义色搭配） ----------
const detailTokens = {
  space: { section: 5, block: 4, tight: 2, inline: 3 } as const,
  /** 组与组之间的间距（简介 / 类型·标签 / 导演·制片·上映 / 演员） */
  groupGap: 5,
  /** 组内项之间的间距（统一数值，空项不渲染故不产生多余空白） */
  itemGap: 2,
  fontSize: { sectionLabel: "xs", body: "sm", meta: "xs", title: "lg" } as const,
  bar: { minH: 80, py: 3 } as const,
  fanart: { h: 200 } as const,
  radius: { card: "lg", badge: "md", avatar: "full" } as const,
  playIcon: { size: 10 } as const,
  actor: { avatar: 10, cardP: 3, cardGap: 3 } as const,
};

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
    <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg">
      <Text as="span" color="app.muted" mr={detailTokens.space.tight}>
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
      <Stack spacing={detailTokens.space.section}>
        <Flex gap={detailTokens.space.section} align="flex-start">
          <Skeleton w="min(280px, 26vw)" aspectRatio={2 / 3} borderRadius={detailTokens.radius.card} flexShrink={0} />
          <Stack flex={1} spacing={detailTokens.space.block}>
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
      <Box py={detailTokens.space.section}>
        <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg">{msg}</Text>
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
  const BAR_TOP_VH = 0.2;
  /** 海报高度占视口比例，约 0.75 = 75vh，可按需调整 */
  const POSTER_HEIGHT_VH = 0.75;
  /** 未滚动时海报垂直居中：海报中心在视口中的比例，0.5 = 居中；改此值可整体上下移动海报与栏 */
  const POSTER_CENTER_VH = 0.45;
  /** 1️⃣ 海报与内容区左边的间距（Chakra space 数字，如 6 = 1.5rem） */
  const POSTER_INSET_LEFT = 16;
  /** 2️⃣ 海报与右侧标题/评分/元数据/演员等内容之间的间距（Chakra space 数字，如 6 = 1.5rem） */
  const POSTER_CONTENT_GAP = 32;
  // ------------------------------------
  const posterTopVH = POSTER_CENTER_VH - POSTER_HEIGHT_VH / 2;
  const posterWidthVh = POSTER_HEIGHT_VH * (2 / 3);
  const barH = detailTokens.bar.minH;
  const fanartH = detailTokens.fanart.h;
  /** 与 Layout 的 px/py 一致，用于 full-bleed 负边距（突破主内容区内边距） */
  const layoutGutter = 6;
  const layoutPx = `var(--chakra-space-${layoutGutter}, 1.5rem)`;
  const posterContentGapCss = `var(--chakra-space-${POSTER_CONTENT_GAP}, 1.5rem)`;
  /** 桌面端下层内容（栏、详情）左侧留白 = 海报宽 + 海报与内容间距，避免被上层海报遮挡 */
  const contentLeftMd = `calc(${posterWidthVh * 100}vh + ${posterContentGapCss})`;

  return (
    <Stack spacing={0} position="relative" marginTop={-layoutGutter}>
      {/* ---------- 下层：fanart、重点交互栏、简介/元数据（文档流） ---------- */}
      {/* fanart：突破 Layout 的 px/py，与页面左右及顶边填满 */}
      <Box
        w={`calc(100% + 2 * var(--chakra-space-${layoutGutter}, 1.5rem))`}
        marginLeft={-layoutGutter}
        marginRight={-layoutGutter}
        h={{ base: `${fanartH}px`, md: `${BAR_TOP_VH * 100}vh` }}
        bg="app.surface.subtle"
        flexShrink={0}
        overflow="hidden"
      >
        <Flex h="100%" align="center" justify="center" color="app.muted" fontSize={detailTokens.fontSize.body}>
          fanart 占位
        </Flex>
      </Box>

      {/* ---------- 上层：仅海报；桌面端绝对定位叠在下层之上，小屏在文档流中 ---------- */}
      <Box
        position={{ base: "relative", md: "absolute" }}
        top={{ base: undefined, md: `${posterTopVH * 100}vh` }}
        left={{ base: 0, md: POSTER_INSET_LEFT }}
        w={{ base: "100%", md: `calc(${posterWidthVh * 100}vh)` }}
        h={{ base: "auto", md: `calc(${POSTER_HEIGHT_VH * 100}vh)` }}
        maxW={{ base: "320px", md: "none" }}
        mx={{ base: "auto", md: 0 }}
        zIndex={10}
        flexShrink={0}
        borderRadius={detailTokens.radius.card}
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
            <Flex h="100%" align="center" justify="center" color="app.muted" fontSize={detailTokens.fontSize.body}>
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
                w={detailTokens.playIcon.size}
                h={detailTokens.playIcon.size}
                borderRadius={detailTokens.radius.avatar}
                bg="app.accent"
                color="app.accent.fg"
                align="center"
                justify="center"
                fontSize="4xl"
                pl="6px"
                boxShadow="xl"
              >
                ▶
              </Flex>
            </Flex>
          )}
        </Box>
      </Box>

      {/* 重点交互栏：突破 Layout 的 px，与页面左右填满；内边距补偿使文案与内容区对齐 */}
      <Flex
        w={`calc(100% + 2 * var(--chakra-space-${layoutGutter}, 1.5rem))`}
        marginLeft={-layoutGutter}
        marginRight={-layoutGutter}
        minH={`${barH}px`}
        direction="column"
        justify="center"
        py={detailTokens.bar.py}
        pl={{ base: detailTokens.space.block, md: `calc(${layoutPx} + ${contentLeftMd})` }}
        pr={{ base: detailTokens.space.block, md: layoutGutter }}
        bg="app.surface"
        flexShrink={0}
      >
        <Flex align="center" justify="space-between" gap={detailTokens.space.inline} flexWrap="wrap">
          <Heading size={detailTokens.fontSize.title} noOfLines={1} flex="1 1 auto" minW="120px">
            {detail.title || detail.code}
          </Heading>
          {detail.video_type && (
            <Badge variant="outline" colorScheme="gray" fontSize={detailTokens.fontSize.body} borderRadius={detailTokens.radius.badge}>
              {detail.video_type}
            </Badge>
          )}
        </Flex>
        <Flex align="center" justify="space-between" gap={detailTokens.space.inline} flexWrap="wrap" mt={detailTokens.space.tight}>
          <Flex align="center" gap={detailTokens.space.inline} flexWrap="wrap">
            {meta?.rating != null && (
              <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg">
                评分 {meta.rating}
                {meta.votes != null && meta.votes > 0 && (
                  <Text as="span" color="app.muted" ml={1}>({meta.votes})</Text>
                )}
              </Text>
            )}
            {meta?.year != null && <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg">{meta.year}</Text>}
            {meta?.runtime != null && (
              <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg">{meta.runtime} 分钟</Text>
            )}
            <Text fontSize={detailTokens.fontSize.body} color="app.muted">番号 {detail.code}</Text>
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
            <Badge colorScheme="red" borderRadius={detailTokens.radius.badge}>无视频</Badge>
          )}
        </Flex>
      </Flex>

      {/* 四组信息：简介 | 类型·标签 | 导演·制片·上映 | 演员；组间 groupGap，组内 itemGap；空组不渲染避免多余空白 */}
      <Box pt={detailTokens.space.block} pb={detailTokens.space.block} pl={{ base: detailTokens.space.block, md: contentLeftMd }} pr={detailTokens.space.block}>
        <Stack spacing={detailTokens.groupGap}>
          {/* 第一组：简介 */}
          {meta?.outline ? (
            <Box maxW="calc(100% - 10vw)">
              <Text fontSize={detailTokens.fontSize.body} color="app.muted.fg" noOfLines={4} lineHeight="tall">
                {meta.outline}
              </Text>
            </Box>
          ) : null}

          {/* 第二组：类型 / 标签（仅在有内容时渲染整组，组内 itemGap） */}
          {(meta?.genres?.length || meta?.tags?.length) ? (
            <Stack spacing={detailTokens.itemGap}>
              {meta?.genres?.length ? (
                <Flex align="center" flexWrap="wrap" gap={detailTokens.space.tight}>
                  <Text as="span" fontSize={detailTokens.fontSize.body} color="app.muted" flexShrink={0}>
                    类型:
                  </Text>
                  <Wrap spacing={detailTokens.space.tight}>
                    {meta.genres.map((g) => (
                      <WrapItem key={g}>
                        <Badge colorScheme="orange" variant="subtle" borderRadius={detailTokens.radius.badge} fontSize={detailTokens.fontSize.meta}>
                          {g}
                        </Badge>
                      </WrapItem>
                    ))}
                  </Wrap>
                </Flex>
              ) : null}
              {meta?.tags?.length ? (
                <Flex align="center" flexWrap="wrap" gap={detailTokens.space.tight}>
                  <Text as="span" fontSize={detailTokens.fontSize.body} color="app.muted" flexShrink={0}>
                    标签:
                  </Text>
                  <Wrap spacing={detailTokens.space.tight}>
                    {meta.tags.map((t) => (
                      <WrapItem key={t}>
                        <Badge variant="outline" colorScheme="gray" borderRadius={detailTokens.radius.badge} fontSize={detailTokens.fontSize.meta}>
                          {t}
                        </Badge>
                      </WrapItem>
                    ))}
                  </Wrap>
                </Flex>
              ) : null}
            </Stack>
          ) : null}

          {/* 第三组：导演 / 制片 / 国家·地区 / 上映（仅渲染有值的项，组内 itemGap） */}
          {[meta?.country, meta?.director, meta?.studio, meta?.premiered].some((v) => v != null && v !== "") ? (
            <Stack spacing={detailTokens.itemGap}>
              <MetaLine label="国家/地区" value={meta?.country} />
              <MetaLine label="导演" value={meta?.director} />
              <MetaLine label="制片" value={meta?.studio} />
              <MetaLine label="上映" value={meta?.premiered} />
            </Stack>
          ) : null}

          {/* 第四组：演员（仅在有数据时渲染） */}
          {meta?.actors?.length ? (
            <Box>
              <Text fontSize={detailTokens.fontSize.body} color="app.muted" mb={detailTokens.itemGap}>
                演员:
              </Text>
              <SimpleGrid columns={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing={detailTokens.space.block}>
            {meta.actors.map((actor) => (
              <Flex
                key={actor.name}
                align="center"
                gap={detailTokens.actor.cardGap}
                p={detailTokens.actor.cardP}
                borderRadius={detailTokens.radius.badge}
                bg="app.surface.subtle"
                _hover={{ bg: "whiteAlpha.100" }}
                transition="background 0.2s ease"
              >
                <Box
                  w={detailTokens.actor.avatar}
                  h={detailTokens.actor.avatar}
                  borderRadius={detailTokens.radius.avatar}
                  overflow="hidden"
                  bg="app.surface"
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
                      color="app.muted"
                      fontSize={detailTokens.fontSize.sectionLabel}
                    >
                      {actor.name.slice(0, 1)}
                    </Flex>
                  )}
                </Box>
                <Box minW={0}>
                  <Text fontSize={detailTokens.fontSize.body} fontWeight="medium" noOfLines={1}>
                    {actor.name}
                  </Text>
                  {actor.role ? (
                    <Text fontSize={detailTokens.fontSize.meta} color="app.muted" noOfLines={1}>
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
      </Box>
    </Stack>
  );
}
