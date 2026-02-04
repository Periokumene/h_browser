/**
 * 功能面板（Chakra UI）：侧滑悬浮，支持书签/播放清单/播放推荐等子页切换。
 * 由 VideoJsPlayer 渲染，通过右侧悬停或关闭按钮控制显隐。
 */

import {
  Box,
  IconButton,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { FiX } from "react-icons/fi";
import BookmarksTab from "./BookmarksTab";
import SubtitlesTab from "./SubtitlesTab";
import type { Bookmark } from "../bookmarks/api";
import type { ThumbnailCueCss } from "../spriteThumbnails";
import type { VideoJsPlayer } from "../types";

const PANEL_WIDTH = 320;
const GAP = 6;
const LEAVE_BUFFER_LEFT = 28;
const TRANSITION_OPEN_MS = 240;
const TRANSITION_CLOSE_MS = 320;
const EASING_SLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

export interface FeaturePanelChakraProps {
  isOpen: boolean;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  videoCode: string;
  player: VideoJsPlayer | null;
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
  /** 根据时间获取缩略图 CSS，由 VideoJsPlayer 从 spriteThumbnails 插件实例传入 */
  getThumbnailCssForTime?: (time: number) => ThumbnailCueCss | null;
}

export default function FeaturePanelChakra({
  isOpen,
  onClose,
  onMouseEnter,
  onMouseLeave,
  videoCode,
  player,
  onBookmarksChange,
  getThumbnailCssForTime,
}: FeaturePanelChakraProps) {
  const headerHoverBg = useColorModeValue("blackAlpha.100", "whiteAlpha.200");
  const hitAreaWidth = PANEL_WIDTH + LEAVE_BUFFER_LEFT;

  return (
    <Box
      position="absolute"
      top={GAP}
      right={GAP}
      bottom={GAP}
      w={`min(${hitAreaWidth}px, calc(100% - ${GAP * 2}px))`}
      maxW={`calc(100% - ${GAP * 2}px)`}
      zIndex={50}
      pointerEvents={isOpen ? "auto" : "none"}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Box
        role="dialog"
        aria-label="功能面板"
        aria-hidden={!isOpen}
        position="absolute"
        right={0}
        top={0}
        bottom={0}
        w={`min(${PANEL_WIDTH}px, 100%)`}
        bg="app.surface"
        borderRadius="lg"
        boxShadow="lg"
        borderWidth="1px"
        borderColor="app.border"
        display="flex"
        flexDirection="column"
        overflow="hidden"
        transform={isOpen ? "translateX(0)" : "translateX(100%)"}
        opacity={isOpen ? 1 : 0}
        transition={
          isOpen
            ? `transform ${TRANSITION_OPEN_MS}ms ${EASING_SLIDE}, opacity ${TRANSITION_OPEN_MS}ms ease-out`
            : `transform ${TRANSITION_CLOSE_MS}ms ${EASING_SLIDE}, opacity ${Math.round(TRANSITION_CLOSE_MS * 0.85)}ms ease-out`
        }
      >
        <Tabs flex={1} display="flex" flexDirection="column" minH={0} size="sm">
          {/* 头部容器：保留深色头，只去掉“功能面板”文案，将页签移入此容器内 */}
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            flexShrink={0}
            px={2}
            pl={3}
            py={2}
            borderBottomWidth="1px"
            borderColor="app.border"
            bg="app.surface.subtle"
            gap={2}
          >
            <TabList borderBottomWidth="0" flexShrink={0}>
              <Tab _selected={{ color: "app.accent", borderColor: "app.accent" }}>
                书签
              </Tab>
              <Tab _selected={{ color: "app.accent", borderColor: "app.accent" }}>
                字幕
              </Tab>
              <Tab _selected={{ color: "app.accent", borderColor: "app.accent" }}>
                清单
              </Tab>
              <Tab _selected={{ color: "app.accent", borderColor: "app.accent" }}>
                推荐
              </Tab>
            </TabList>
            <IconButton
              aria-label="关闭面板"
              variant="ghost"
              size="sm"
              icon={<FiX />}
              onClick={onClose}
              flexShrink={0}
              _hover={{ bg: headerHoverBg }}
            />
          </Box>

          <TabPanels flex={1} overflowY="auto" overflowX="hidden" px={2} py={2}>
            <TabPanel px={0} py={2}>
              <BookmarksTab
                videoCode={videoCode}
                player={player}
                onBookmarksChange={onBookmarksChange}
                getThumbnailCssForTime={getThumbnailCssForTime}
              />
            </TabPanel>
            <TabPanel px={0} py={2}>
              <SubtitlesTab player={player} videoCode={videoCode} />
            </TabPanel>
            <TabPanel px={0} py={2}>
              <Text fontSize="sm" color="app.muted">
                播放清单功能开发中
              </Text>
            </TabPanel>
            <TabPanel px={0} py={2}>
              <Text fontSize="sm" color="app.muted">
                播放推荐功能开发中
              </Text>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </Box>
  );
}
