/**
 * 缩略图模块常量（与后端 THUMB_W/THUMB_H 及 VTT #xywh 格子一致）
 *
 * 修改显示尺寸时只需改 THUMB_DISPLAY_SCALE，DISPLAY_* 会随之计算；
 * 若后端格子尺寸变更，需同步改 THUMB_CELL_*。
 */

/** 雪碧图单格宽高（px），与后端 thumbnail_task 的 THUMB_W/THUMB_H 一致 */
export const THUMB_CELL_WIDTH = 160;
export const THUMB_CELL_HEIGHT = 90;

/** 显示尺寸相对格子的放大比例，1.5 表示调大 50%（160×90 → 240×135） */
export const THUMB_DISPLAY_SCALE = 1.5;

/** 显示区域宽高（px），用于定位与占位，由 THUMB_CELL_* × THUMB_DISPLAY_SCALE 计算 */
export const THUMB_DISPLAY_WIDTH = Math.round(THUMB_CELL_WIDTH * THUMB_DISPLAY_SCALE);
export const THUMB_DISPLAY_HEIGHT = Math.round(THUMB_CELL_HEIGHT * THUMB_DISPLAY_SCALE);

/** 显示宽度的一半，用于进度条上水平居中 */
export const THUMB_DISPLAY_HALF_WIDTH = THUMB_DISPLAY_WIDTH / 2;
