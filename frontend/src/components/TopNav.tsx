import {
  Button,
  Flex,
  Heading,
  Spacer,
  Text,
  useColorModeValue,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ListScope } from "../types/api";
import SidePanel from "./SidePanel";

const PAGE_CENTER: Record<string, string> = {
  "/": "首页",
  "/videolib": "媒体库",
  "/config/media": "媒体库配置",
};

function TopNav() {
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
  const menuHoverBg = useColorModeValue("gray.100", "whiteAlpha.100");
  /** 总表/收藏 未激活项：亮色模式用灰，暗色模式用浅白 */
  const scopeInactiveColor = useColorModeValue("gray.500", "whiteAlpha.800");
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = location.pathname;
  const isVideoLib = pathname === "/videolib";
  const scope: ListScope = isVideoLib && searchParams.get("scope") === "favorites" ? "favorites" : "all";

  const settingsEntries = [
    { id: "media", label: "媒体库配置", path: "/config/media" },
    { id: "metadata", label: "元数据管理", path: null },
    { id: "dev", label: "开发者模式", path: null },
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
        {/* 中部：按路由显示当前页标题或 VideoLib 的 总表/收藏 切换（仅文字，高亮激活项） */}
        <Flex align="center" gap={3} position="absolute" left="50%" transform="translateX(-50%)">
          {isVideoLib ? (
            <Flex role="group" aria-label="列表范围" align="center" gap={3}>
              <Text
                as="button"
                type="button"
                fontSize="sm"
                color={scope === "all" ? "app.accent" : scopeInactiveColor}
                fontWeight={scope === "all" ? 600 : 400}
                _hover={{ opacity: 0.9 }}
                onClick={() => navigate("/videolib")}
              >
                媒体
              </Text>
              <Text
                as="button"
                type="button"
                fontSize="sm"
                color={scope === "favorites" ? "app.accent" : scopeInactiveColor}
                fontWeight={scope === "favorites" ? 600 : 400}
                _hover={{ opacity: 0.9 }}
                onClick={() => navigate("/videolib?scope=favorites")}
              >
                收藏
              </Text>
            </Flex>
          ) : (
            <Text fontSize="sm" color="app.muted" fontWeight="medium">
              {PAGE_CENTER[pathname] ?? ""}
            </Text>
          )}
        </Flex>
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
          {settingsEntries.map(({ id, label, path }) => (
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
