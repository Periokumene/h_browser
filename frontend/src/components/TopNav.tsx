import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Spacer,
  Text,
  useColorModeValue,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { FaBars, FaSync } from "react-icons/fa";
import { IoIosArrowBack } from "react-icons/io";
import { MdVideoLibrary } from "react-icons/md";
import { fetchItem, postScan, createTask } from "../api/calls";
import { warmNeutrals } from "../theme";
import { getRouteConfig, ROUTES } from "../config/routes";
import SidePanel from "./SidePanel";
import VideoLibScopeSwitcher from "./VideoLibScopeSwitcher";

const SETTINGS_ENTRIES = [
  { id: "media", label: "媒体库配置", path: ROUTES.CONFIG_MEDIA },
  { id: "tasks", label: "任务中心", path: ROUTES.TASKS },
  { id: "metadata", label: "元数据管理", path: null },
  { id: "dev", label: "开发者模式", path: null },
] as const;

/** 播放页 TopNav：鼠标移开后保留显示时长（ms） */
const PLAY_NAV_HIDE_DELAY_MS = 2500;
const PLAY_NAV_TRANSITION = "opacity 0.25s ease";

function TopNav() {
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
  const menuHoverBg = useColorModeValue("gray.100", "whiteAlpha.100");
  /** 播放页返回详情按钮 hover：更强的高亮，在透明导航上更醒目 */
  const playBackHoverBg = useColorModeValue("blue.100", "whiteAlpha.400");
  const navBg = useColorModeValue("gray.50", warmNeutrals.bg);
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const pathname = location.pathname;
  const routeConfig = getRouteConfig(pathname);
  const playMatch = matchPath(ROUTES.PLAY, pathname);
  const playCode = playMatch?.params?.code;

  /** 播放页：仅悬浮时显示，移开后保留若干秒再淡出 */
  const [playNavVisible, setPlayNavVisible] = useState(false);
  const playNavHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playCode) return;
    const show = () => {
      setPlayNavVisible(true);
      if (playNavHideTimerRef.current) {
        clearTimeout(playNavHideTimerRef.current);
        playNavHideTimerRef.current = null;
      }
      playNavHideTimerRef.current = setTimeout(() => {
        setPlayNavVisible(false);
        playNavHideTimerRef.current = null;
      }, PLAY_NAV_HIDE_DELAY_MS);
    };
    document.addEventListener("mousemove", show);
    return () => {
      document.removeEventListener("mousemove", show);
      if (playNavHideTimerRef.current) clearTimeout(playNavHideTimerRef.current);
    };
  }, [playCode]);

  const { data: playItem } = useQuery({
    queryKey: ["item", playCode],
    queryFn: () => fetchItem(playCode!),
    enabled: !!playCode,
  });

  const isTransparent = routeConfig.topNavVariant === "transparent-overlay";
  const isPlayPage = !!playCode;

  /** 播放页右侧 Badge：ts / mp4 / ts/mp4 */
  const playFormatBadge =
    isPlayPage && playItem
      ? playItem.has_ts && playItem.has_mp4
        ? "ts/mp4"
        : playItem.has_mp4
          ? "mp4"
          : playItem.has_ts
            ? "ts"
            : null
      : null;

  const genAllThumbnailsMutation = useMutation({
    mutationFn: () => createTask({ type: "gen_all_thumbnails" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "已提交", description: "可在任务中心查看进度", status: "success", duration: 3000 });
      setSettingsOpen(false);
      navigate(ROUTES.TASKS);
    },
    onError: (err: { response?: { data?: { error?: string; message?: string } } }) => {
      const msg = err?.response?.data?.error === "duplicate"
        ? "已有全部缩略图任务在进行中"
        : err?.response?.data?.message ?? err?.response?.data?.error ?? "提交失败";
      toast({ title: msg, status: "error", duration: 3000 });
    },
  });

  const scanMutation = useMutation({
    mutationFn: postScan,
    onSuccess: (res) => {
      toast({ title: "扫描完成", description: `本次处理 ${res.processed} 条记录`, status: "success" });
      queryClient.invalidateQueries({ queryKey: ["filters"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["actor"] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast({ title: err?.response?.data?.error || "触发扫描失败", status: "error" });
    },
  });

  return (
    <>
      <Flex
        as="header"
        position={routeConfig.topNavPosition}
        top={0}
        left={0}
        right={0}
        zIndex={20}
        px={6}
        py={4}
        bg={isTransparent ? "transparent" : navBg}
        borderBottomWidth="1px"
        borderColor={isTransparent ? "transparent" : borderColor}
        align="center"
        gap={4}
        transition={
          isPlayPage
            ? PLAY_NAV_TRANSITION
            : "background 0.2s ease, border-color 0.2s ease"
        }
        opacity={isPlayPage ? (playNavVisible ? 1 : 0) : undefined}
        pointerEvents={isPlayPage ? (playNavVisible ? "auto" : "none") : undefined}
      >
        {isPlayPage ? (
          <Flex align="center" gap={3}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/detail/${playCode}`)}
              aria-label="返回详情页"
              _hover={{
                bg: playBackHoverBg,
                opacity: 1,
                transform: "scale(1.05)",
              }}
              _active={{ bg: playBackHoverBg, transform: "scale(0.98)" }}
              transition="background 0.15s ease, transform 0.15s ease, opacity 0.15s ease"
            >
              <Icon as={IoIosArrowBack} boxSize={5} />
            </Button>
            <Text fontSize="md" fontWeight="bold" noOfLines={1} maxW="40ch">
              {playItem?.title || playCode || "播放"}
            </Text>
          </Flex>
        ) : (
          <Heading
            size="md"
            cursor="pointer"
            onClick={() => navigate(ROUTES.VIDEO_LIB)}
            _hover={{ opacity: 0.85 }}
            transition="opacity 0.2s ease"
          >
            Zako~
          </Heading>
        )}
        <Spacer />
        <Flex align="center" gap={3} position="absolute" left="50%" transform="translateX(-50%)">
          {routeConfig.topNavCenter === "videolib-scope" && <VideoLibScopeSwitcher />}
          {routeConfig.topNavCenter === "title" && routeConfig.topNavCenterTitle && (
            <Text fontSize="sm" color="app.muted" fontWeight="medium">
              {routeConfig.topNavCenterTitle}
            </Text>
          )}
        </Flex>
        <Spacer />
        {routeConfig.showScanButton && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => scanMutation.mutate()}
            isDisabled={scanMutation.isPending}
            aria-label="刷新库（扫描）"
          >
            <Icon as={FaSync} boxSize={4} aria-hidden />
          </Button>
        )}
        {playFormatBadge && (
          <Badge colorScheme="gray" variant="subtle" fontSize="sm" px={2} py={1}>
            {playFormatBadge}
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
        >
          <Icon as={FaBars} boxSize={4} aria-hidden />
        </Button>
      </Flex>

      <SidePanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        placement="right"
        title="设置"
      >
        <VStack align="stretch" spacing={0} py={2}>
          <Box px={4} pt={2} pb={1}>
            <Text fontSize="xs" fontWeight="semibold" color="app.muted">
              快捷操作
            </Text>
          </Box>
          <Button
            variant="ghost"
            justifyContent="flex-start"
            size="md"
            borderRadius={0}
            py={3}
            px={4}
            _hover={{ bg: menuHoverBg }}
            leftIcon={<Icon as={MdVideoLibrary} />}
            onClick={() => genAllThumbnailsMutation.mutate()}
            isDisabled={genAllThumbnailsMutation.isPending}
            isLoading={genAllThumbnailsMutation.isPending}
          >
            为全部视频生成缩略图
          </Button>
          <Box px={4} pt={4} pb={1}>
            <Text fontSize="xs" fontWeight="semibold" color="app.muted">
              设置
            </Text>
          </Box>
          {SETTINGS_ENTRIES.map(({ id, label, path }) => (
            <Button
              key={id}
              variant="ghost"
              justifyContent="flex-start"
              size="md"
              borderRadius={0}
              py={3}
              px={4}
              _hover={{ bg: menuHoverBg }}
              onClick={() => {
                if (path) {
                  setSettingsOpen(false);
                  navigate(path);
                }
              }}
            >
              {label}
            </Button>
          ))}
        </VStack>
      </SidePanel>
    </>
  );
}

export default TopNav;
