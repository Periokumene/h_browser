/**
 * 进度条缩略图插件（VTT + 雪碧图）
 *
 * 使用方式：
 * - player.spriteThumbnails({ src: vttUrl })：从 URL 加载 VTT
 * - player.spriteThumbnails({ vttContent: "WEBVTT\n\n", spriteBaseUrl: "" })：空 VTT，悬停显示黑块
 * - 不传 src/vttContent：插件 fallback 到空 VTT，仍挂载缩略图组件（悬停显示黑块）
 *
 * 设计原则：缩略图显隐为纯前端行为，任意视频悬停进度条都会显示 .vjs-sprite-thumbnail-display；
 * 有 cue 显示雪碧图，无 cue 显示纯黑矩形。详见 plugin.ts 顶部注释。
 */

import "./spriteThumbnails.css";
export {
  default,
  PLACEHOLDER_VTT,
  PLACEHOLDER_SPRITE_DATA_URL,
  type SpriteThumbnailsOptions,
  type SpriteThumbnailCue,
} from "./plugin";
export {
  THUMB_DISPLAY_SCALE,
  THUMB_CELL_WIDTH,
  THUMB_CELL_HEIGHT,
  THUMB_DISPLAY_WIDTH,
  THUMB_DISPLAY_HEIGHT,
} from "./constants";
export type { ThumbnailCueCss } from "./ThumbnailDisplay";
export {
  default as ThumbnailFrame,
  THUMB_FRAME_SMALL_WIDTH,
  THUMB_FRAME_SMALL_HEIGHT,
} from "./ThumbnailFrame";
export type { ThumbnailFrameProps } from "./ThumbnailFrame";
