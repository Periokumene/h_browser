/**
 * ActorInfo：在指定演员时于 Browser 左侧展示演员图片与介绍。
 * 专用容器组织：头像卡片（大尺寸）+ 信息与选项（博客个人介绍式居中对齐）。
 * 由父级侧边栏控制 sticky 与垂直居中，滚动时不受影响。
 */
import { Box, Flex, Image, Link, Skeleton, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchActorInfo } from "../api/calls";
import { getBaseUrl } from "../api/client";

/** 与 VideoGallery 视频卡片一致：min(320px, 26vw)，侧栏取 320px 以对齐 */
const CARD_MAX_W = 320;
/** 侧栏宽度，容纳与视频卡片同尺寸的头像卡片与居中信息 */
const SIDEBAR_W = "340px";
/** 头像卡片与视频海报同尺寸：宽 320px，比例 2/3 */
const AVATAR_W = CARD_MAX_W;
const AVATAR_ASPECT = 2 / 3;

export interface ActorInfoProps {
  actorName: string;
}

export default function ActorInfo({ actorName }: ActorInfoProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data, isLoading } = useQuery({
    queryKey: ["actor", actorName],
    queryFn: () => fetchActorInfo(actorName),
    enabled: !!actorName,
  });

  const clearActorKeepRest = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("actor");
    next.delete("actor_name");
    const path = "/videolib";
    const search = next.toString();
    navigate({ pathname: path, search: search ? `?${search}` : "" });
  };

  if (!actorName) return null;

  const cardPadding = 4; // 上/左/右一致留白

  return (
    <Box
      w={SIDEBAR_W}
      flexShrink={0}
      mr={4}
      display="flex"
      flexDirection="column"
      alignSelf="stretch"
      minH={0}
      flex={1}
    >
      {isLoading ? (
        <Stack spacing={4} align="center" w="full" py={cardPadding} px={cardPadding}>
          <Skeleton
            w={AVATAR_W}
            h={AVATAR_W / AVATAR_ASPECT}
            borderRadius="lg"
            startColor="app.surface.subtle"
            endColor="whiteAlpha.200"
          />
          <Box w="full" px={2}>
            <Skeleton height="4" width="60%" mx="auto" mb={2} borderRadius="md" />
            <Skeleton height="3" width="100%" borderRadius="md" noOfLines={3} />
          </Box>
        </Stack>
      ) : data ? (
        <>
          {/* 头像卡片：与顶部留白再大一些，上/左/右间隔一致，与介绍之间无间距 */}
          <Box pt={24} px={cardPadding} flexShrink={0}>
            <Box
              w={AVATAR_W}
              maxW="100%"
              aspectRatio={AVATAR_ASPECT}
              bg="app.surface"
              borderWidth="1px"
              borderColor="app.border"
              borderRadius="lg"
              overflow="hidden"
              boxShadow="sm"
            >
              {data.image_url ? (
                <Image
                  src={`${getBaseUrl()}${data.image_url}`}
                  alt={data.name}
                  w="100%"
                  h="100%"
                  objectFit="cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <Flex
                  w="100%"
                  h="100%"
                  align="center"
                  justify="center"
                  bg="app.surface.subtle"
                >
                  <Text fontSize="sm" color="app.muted">
                    暂无
                  </Text>
                </Flex>
              )}
            </Box>
          </Box>

          {/* 介绍 + 选项：在下方剩余区域的 1/4 位置（非垂直居中） */}
          <Flex
            flex={1}
            minH={0}
            flexDirection="column"
            px={cardPadding}
            w="full"
          >
            <Box flex={1} minH={0} aria-hidden />
            <Stack
              spacing={0}
              align="center"
              textAlign="center"
              w="full"
              flexShrink={0}
            >
              <Stack spacing={1.5} w="full" align="center" px={1}>
                <Text as="h2" fontWeight="600" fontSize="xl" lineHeight="tight" noOfLines={2}>
                  {data.name}
                </Text>
                <Text fontSize="xs" color="app.muted">
                  {data.codes.length} 部作品
                </Text>
                {data.intro ? (
                  <Text
                    fontSize="xs"
                    color="app.muted.fg"
                    lineHeight="tall"
                    noOfLines={6}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    display="-webkit-box"
                    sx={{ WebkitLineClamp: 6, WebkitBoxOrient: "vertical" }}
                  >
                    {data.intro}
                  </Text>
                ) : (
                  <Text fontSize="xs" color="app.muted">
                    暂无介绍
                  </Text>
                )}
              </Stack>
              <Box pt={4} mt={4} borderTopWidth="1px" borderColor="app.border" w="full">
                <Link
                  as="button"
                  type="button"
                  fontSize="sm"
                  color="app.muted"
                  _hover={{ color: "app.accent", textDecoration: "underline" }}
                  onClick={clearActorKeepRest}
                >
                  清除指定演员
                </Link>
              </Box>
            </Stack>
            <Box flex={3} minH={0} aria-hidden />
          </Flex>
        </>
      ) : (
        <Flex flex={1} align="center" justify="center" px={cardPadding}>
          <Stack spacing={3} align="center" textAlign="center">
            <Text fontSize="sm" color="app.muted">
              未找到演员信息
            </Text>
            <Link
              as="button"
              type="button"
              fontSize="sm"
              color="app.muted"
              _hover={{ color: "app.accent", textDecoration: "underline" }}
              onClick={clearActorKeepRest}
            >
              清除指定演员
            </Link>
          </Stack>
        </Flex>
      )}
    </Box>
  );
}
