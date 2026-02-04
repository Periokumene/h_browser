import { Box, useColorModeValue } from "@chakra-ui/react";

const OVERLAY_Z = 100;
const PANEL_Z = 101;
const PANEL_WIDTH = 320;
const TRANSITION_MS = 250;

export type SidePanelPlacement = "left" | "right";

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  placement?: SidePanelPlacement;
  /** 可选标题，显示在 panel 顶部 */
  title?: string;
}

export default function SidePanel({
  isOpen,
  onClose,
  children,
  placement = "right",
  title,
}: SidePanelProps) {
  const overlayBg = useColorModeValue("blackAlpha.600", "blackAlpha.700");
  const panelBg = useColorModeValue("white", "warm.surface");
  const panelBorder = useColorModeValue("gray.200", "whiteAlpha.200");
  const isRight = placement === "right";

  return (
    <>
      {/* 遮罩：挡住下层 UI 交互，点击关闭 */}
      <Box
        aria-hidden={!isOpen}
        position="fixed"
        inset={0}
        zIndex={OVERLAY_Z}
        bg={overlayBg}
        opacity={isOpen ? 1 : 0}
        visibility={isOpen ? "visible" : "hidden"}
        transition={`opacity ${TRANSITION_MS}ms ease, visibility 0s linear ${isOpen ? "0s" : `${TRANSITION_MS}ms`}`}
        onClick={onClose}
        pointerEvents={isOpen ? "auto" : "none"}
      />
      {/* 主体：带阴影与滑入动效 */}
      <Box
        position="fixed"
        top={0}
        bottom={0}
        right={isRight ? 0 : undefined}
        left={isRight ? undefined : 0}
        width={`${PANEL_WIDTH}px`}
        maxWidth="100vw"
        zIndex={PANEL_Z}
        bg={panelBg}
        borderWidth="0"
        borderLeftWidth={isRight ? "1px" : 0}
        borderRightWidth={isRight ? 0 : "1px"}
        borderColor={panelBorder}
        boxShadow={isRight ? "-4px 0 24px rgba(0,0,0,0.15)" : "4px 0 24px rgba(0,0,0,0.15)"}
        transform={isRight
          ? isOpen ? "translateX(0)" : "translateX(100%)"
          : isOpen ? "translateX(0)" : "translateX(-100%)"}
        transition={`transform ${TRANSITION_MS}ms ease`}
        overflowY="auto"
        display="flex"
        flexDirection="column"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <Box px={4} py={4} borderBottomWidth="1px" borderColor={panelBorder} fontWeight="semibold">
            {title}
          </Box>
        )}
        <Box flex={1} overflowY="auto">
          {children}
        </Box>
      </Box>
    </>
  );
}
