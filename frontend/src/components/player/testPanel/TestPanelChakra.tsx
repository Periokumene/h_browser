/**
 * 测试侧边面板（Chakra UI）：侧滑悬浮样式，上下留白，不顶满。
 * 由 VideoJsPlayer 渲染，通过右侧悬停或关闭按钮控制显隐。
 */

import {
  Box,
  IconButton,
  Text,
  useColorModeValue,
  VStack,
} from "@chakra-ui/react";
import { FiX } from "react-icons/fi";

const PANEL_WIDTH = 320;
const GAP = 6;
/** 鼠标离开判定缓冲：面板左侧该宽度内仍视为「在面板内」，减少误触收合 */
const LEAVE_BUFFER_LEFT = 28;
const TRANSITION_OPEN_MS = 240;
const TRANSITION_CLOSE_MS = 320;
const EASING_SLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

export interface TestPanelChakraProps {
  isOpen: boolean;
  onClose: () => void;
  /** 鼠标进入面板时调用（用于取消自动关闭计时） */
  onMouseEnter?: () => void;
  /** 鼠标离开面板时调用（用于启动自动关闭计时） */
  onMouseLeave?: () => void;
  children?: React.ReactNode;
}

export default function TestPanelChakra({
  isOpen,
  onClose,
  onMouseEnter,
  onMouseLeave,
  children,
}: TestPanelChakraProps) {
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
        aria-label="测试面板"
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
        {/* 标题栏 */}
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          flexShrink={0}
          px={4}
          py={3}
          borderBottomWidth="1px"
          borderColor="app.border"
          bg="app.surface.subtle"
        >
          <Text fontWeight="600" fontSize="md">
            测试面板
          </Text>
          <IconButton
            aria-label="关闭面板"
            variant="ghost"
            size="sm"
            icon={<FiX />}
            onClick={onClose}
            _hover={{ bg: headerHoverBg }}
          />
        </Box>

        {/* 内容区 */}
        <Box
          flex={1}
          overflowY="auto"
          overflowX="hidden"
          px={4}
          py={4}
          color="app.muted.fg"
          fontSize="sm"
          lineHeight="tall"
        >
          {children ?? (
            <VStack align="stretch" spacing={2}>
              <Text>用于调试与测试的侧边面板。</Text>
            </VStack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
