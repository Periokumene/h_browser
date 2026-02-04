/**
 * 个人影音库主题：温馨家庭向、深色为主
 * 通过 Chakra 全局主题统一配色、动效与组件样式，避免科技感冷色。
 */
import { extendTheme } from "@chakra-ui/react";

/** 暖色深色中性色：带一点棕/米色调，避免冷灰（可导出供 Layout 等使用） */
export const warmNeutrals = {
  bg: "#1c1917",       // 页面底（偏暖深色）
  surface: "#292524",  // 卡片/浮层
  subtle: "#363330",   // 卡片内次级区（如海报占位）
};

const theme = extendTheme({
  config: {
    initialColorMode: "dark",
    useSystemColorMode: false,
  },

  colors: {
    /** 暖色中性：深色模式下用于背景与表面 */
    warm: {
      bg: warmNeutrals.bg,
      surface: warmNeutrals.surface,
      subtle: warmNeutrals.subtle,
    },
  },

  /** 语义化颜色：页面与组件统一使用，便于维护 */
  semanticTokens: {
    colors: {
      "app.bg": { default: "gray.50", _dark: "warm.bg" },
      "app.surface": { default: "white", _dark: "warm.surface" },
      "app.surface.subtle": { default: "gray.50", _dark: "warm.subtle" },
      "app.border": { default: "gray.200", _dark: "whiteAlpha.200" },
      "app.border.hover": { default: "gray.300", _dark: "whiteAlpha.400" },
      "app.muted": { default: "gray.500", _dark: "gray.400" },
      "app.muted.fg": { default: "gray.600", _dark: "gray.500" },
      "app.accent": { default: "orange.500", _dark: "orange.400" },
      "app.accent.fg": { default: "white", _dark: "gray.900" },
    },
  },

  /** 全局样式：过渡、字体、滚动条占位防抖动 */
  styles: {
    global: (props: { colorMode: string }) => ({
      "html": {
        scrollbarGutter: "stable",
      },
      "html, body": {
        bg: props.colorMode === "dark" ? warmNeutrals.bg : "gray.50",
        transition: "background-color 0.2s ease",
      },
    }),
  },

  /** 组件默认样式：统一温馨感与动效 */
  components: {
    Button: {
      defaultProps: {
        colorScheme: "orange",
      },
      baseStyle: {
        transition: "all 0.2s ease",
        _active: { transform: "scale(0.98)" },
      },
      variants: {
        outline: (props: Record<string, unknown>) => ({
          borderColor: props.colorMode === "dark" ? "whiteAlpha.300" : "gray.300",
          _hover: {
            bg: props.colorMode === "dark" ? "whiteAlpha.100" : "gray.100",
            borderColor: props.colorMode === "dark" ? "whiteAlpha.400" : "gray.400",
          },
        }),
      },
    },
    Input: {
      defaultProps: {
        focusBorderColor: "orange.400",
      },
      variants: {
        outline: (props: Record<string, unknown>) => ({
          field: {
            bg: props.colorMode === "dark" ? "whiteAlpha.50" : "white",
            borderColor: props.colorMode === "dark" ? "whiteAlpha.200" : "gray.200",
            _hover: { borderColor: props.colorMode === "dark" ? "whiteAlpha.300" : "gray.300" },
            _focus: {
              borderColor: "orange.400",
              boxShadow: "0 0 0 1px var(--chakra-colors-orange-400)",
            },
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          },
        }),
      },
    },
    Badge: {
      baseStyle: {
        transition: "opacity 0.2s ease, background 0.2s ease",
      },
      variants: {
        subtle: (props: Record<string, unknown>) => {
          const { colorScheme } = props;
          const isOrange = colorScheme === "orange";
          return {
            bg: isOrange
              ? props.colorMode === "dark"
                ? "orange.900"
                : "orange.100"
              : props.colorMode === "dark"
                ? "whiteAlpha.200"
                : "gray.200",
            color: isOrange
              ? props.colorMode === "dark"
                ? "orange.200"
                : "orange.800"
              : props.colorMode === "dark"
                ? "gray.200"
                : "gray.700",
          };
        },
      },
    },
    Card: {
      baseStyle: (props: Record<string, unknown>) => ({
        container: {
          bg: props.colorMode === "dark" ? "warm.surface" : "white",
          transition: "background-color 0.2s ease, box-shadow 0.2s ease",
        },
      }),
    },
    Popover: {
      baseStyle: (props: Record<string, unknown>) => ({
        content: {
          bg: props.colorMode === "dark" ? "warm.surface" : "white",
          borderColor: props.colorMode === "dark" ? "whiteAlpha.200" : "gray.200",
          boxShadow: "lg",
        },
      }),
    },
    Heading: {
      baseStyle: {
        letterSpacing: "normal",
      },
    },
  },
});

export default theme;
