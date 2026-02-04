/**
 * 路由路径与页面元数据：TopNav 变体、Layout 主区内边距等由此处统一配置。
 */

import { matchPath } from "react-router-dom";

/** 路由路径常量，避免散落硬编码 */
export const ROUTES = {
  HOME: "/",
  VIDEO_LIB: "/videolib",
  DETAIL: "/detail/:code",
  PLAY: "/play/:code",
  CONFIG_MEDIA: "/config/media",
  TASKS: "/tasks",
} as const;

/** TopNav 中部展示类型 */
export type TopNavCenterType = "title" | "videolib-scope" | "none";

/** TopNav 视觉变体：default 实色底，transparent-overlay 透明叠在内容上 */
export type TopNavVariant = "default" | "transparent-overlay";

/** 单页路由配置（精确路径） */
export interface PageRouteConfig {
  path: string;
  /** 用于 Layout main 的 px（Chakra space），0 表示无水平内边距（如播放页） */
  mainPx: number;
  /** 用于 Layout main 的 pt（Chakra space），0 表示无顶内边距（如 Detail/Play） */
  mainPt: number;
  /** 用于 Layout main 的 pb（Chakra space），0 表示无底内边距（如播放页，避免下方 24px 空隙） */
  mainPb?: number;
  topNavVariant: TopNavVariant;
  /** 播放页使用 fixed，其余 sticky */
  topNavPosition: "sticky" | "fixed";
  topNavCenter: TopNavCenterType;
  /** 仅当 topNavCenter === "title" 时使用 */
  topNavCenterTitle?: string;
  showScanButton: boolean;
}

const EXACT_ROUTE_CONFIGS: PageRouteConfig[] = [
  {
    path: ROUTES.HOME,
    mainPx: 6,
    mainPt: 6,
    topNavVariant: "default",
    topNavPosition: "sticky",
    topNavCenter: "title",
    topNavCenterTitle: "首页",
    showScanButton: false,
  },
  {
    path: ROUTES.VIDEO_LIB,
    mainPx: 6,
    mainPt: 6,
    topNavVariant: "default",
    topNavPosition: "sticky",
    topNavCenter: "videolib-scope",
    showScanButton: true,
  },
  {
    path: ROUTES.CONFIG_MEDIA,
    mainPx: 6,
    mainPt: 6,
    topNavVariant: "default",
    topNavPosition: "sticky",
    topNavCenter: "title",
    topNavCenterTitle: "媒体库配置",
    showScanButton: false,
  },
  {
    path: ROUTES.TASKS,
    mainPx: 6,
    mainPt: 6,
    topNavVariant: "default",
    topNavPosition: "sticky",
    topNavCenter: "title",
    topNavCenterTitle: "任务中心",
    showScanButton: false,
  },
];

/** 按模式匹配的路由（如 /detail/:code, /play/:code） */
const PATTERN_ROUTE_CONFIGS: { pattern: string; config: Omit<PageRouteConfig, "path"> }[] = [
  {
    pattern: ROUTES.DETAIL,
    config: {
      mainPx: 6,
      mainPt: 0,
      topNavVariant: "transparent-overlay",
      topNavPosition: "sticky",
      topNavCenter: "none",
      showScanButton: false,
    },
  },
  {
    pattern: ROUTES.PLAY,
    config: {
      mainPx: 0,
      mainPt: 0,
      mainPb: 0,
      topNavVariant: "transparent-overlay",
      topNavPosition: "fixed",
      topNavCenter: "none",
      showScanButton: false,
    },
  },
];

const DEFAULT_CONFIG: PageRouteConfig = {
  path: "",
  mainPx: 6,
  mainPt: 6,
  topNavVariant: "default",
  topNavPosition: "sticky",
  topNavCenter: "none",
  topNavCenterTitle: "",
  showScanButton: false,
};

/**
 * 根据当前 pathname 解析出页面路由配置（用于 Layout 与 TopNav）。
 */
export function getRouteConfig(pathname: string): PageRouteConfig {
  const exact = EXACT_ROUTE_CONFIGS.find((c) => c.path === pathname);
  if (exact) return exact;

  for (const { pattern, config } of PATTERN_ROUTE_CONFIGS) {
    if (matchPath(pattern, pathname)) {
      return { ...config, path: pathname };
    }
  }

  return { ...DEFAULT_CONFIG, path: pathname };
}
