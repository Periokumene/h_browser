import { Flex, Text, useColorModeValue } from "@chakra-ui/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ROUTES } from "../config/routes";
import type { ListScope } from "../types/api";

/**
 * 媒体库页 TopNav 中部：总表 / 收藏 切换，保留 actor 等查询参数。
 */
export default function VideoLibScopeSwitcher() {
  const scopeInactiveColor = useColorModeValue("gray.500", "whiteAlpha.800");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scope: ListScope = searchParams.get("scope") === "favorites" ? "favorites" : "all";

  return (
    <Flex role="group" aria-label="列表范围" align="center" gap={3}>
      <Text
        as="button"
        type="button"
        fontSize="sm"
        color={scope === "all" ? "app.accent" : scopeInactiveColor}
        fontWeight={scope === "all" ? 600 : 400}
        _hover={{ opacity: 0.9 }}
        onClick={() => {
          const actor = searchParams.get("actor") || searchParams.get("actor_name");
          const search = actor ? `?actor=${encodeURIComponent(actor)}` : "";
          navigate(`${ROUTES.VIDEO_LIB}${search}`);
        }}
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
        onClick={() => {
          const actor = searchParams.get("actor") || searchParams.get("actor_name");
          const params = new URLSearchParams();
          params.set("scope", "favorites");
          if (actor) params.set("actor", actor);
          navigate(`${ROUTES.VIDEO_LIB}?${params.toString()}`);
        }}
      >
        收藏
      </Text>
    </Flex>
  );
}
