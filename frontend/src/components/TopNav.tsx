import {
  Button,
  Flex,
  Heading,
  Spacer,
  useColorModeValue,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import SidePanel from "./SidePanel";

function TopNav() {
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
  const menuHoverBg = useColorModeValue("gray.100", "whiteAlpha.100");
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsEntries = [
    { id: "media", label: "媒体库配置" },
    { id: "metadata", label: "元数据管理" },
    { id: "dev", label: "开发者模式" },
  ] as const;

  return (
    <>
      <Flex
        as="header"
        position="relative"
        zIndex={10}
        px={6}
        py={4}
        borderBottomWidth="1px"
        borderColor={borderColor}
        align="center"
        gap={4}
      >
        <Heading
          size="md"
          cursor="pointer"
          onClick={() => navigate("/")}
          _hover={{ opacity: 0.85 }}
          transition="opacity 0.2s ease"
        >
          个人影音库
        </Heading>
        <Spacer />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSettingsOpen(true)}
          aria-label="设置"
        >
          设置
        </Button>
      </Flex>

      <SidePanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        placement="right"
        title="设置"
      >
        <VStack align="stretch" spacing={0} py={2}>
          {settingsEntries.map(({ id, label }) => (
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
                // 具体行为待定，可后续接入路由或弹窗
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
