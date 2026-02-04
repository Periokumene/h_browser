/**
 * 播放器相关类型与常量，供 VideoJsPlayer 及后续插件复用。
 */

import videojs from "video.js";

/** Video.js 播放器实例类型（统一别名，避免直接依赖内部 Player 类型） */
export type VideoJsPlayer = ReturnType<typeof videojs>;

/** Video.js 播放器初始化参数类型 */
export type VideoJsPlayerOptions = Parameters<typeof videojs>[1];

/** 单条播放源，与后端 /api/stream、playlist.m3u8 对应 */
export interface VideoJsSource {
  src: string;
  type?: string;
}

/** hls.js 错误回调中的 data 结构 */
export interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
  response?: { code?: number };
}

/** 判定为 HLS 的 MIME 类型（m3u8） */
export const HLS_SOURCE_TYPES = [
  "application/x-mpegURL",
  "application/vnd.apple.mpegurl",
] as const;

export function isHlsSourceType(type?: string): boolean {
  return type != null && (HLS_SOURCE_TYPES as readonly string[]).includes(type);
}

/** 是否应使用 hls.js 加载（当前为 m3u8 源） */
export function isHlsSource(sources: VideoJsSource[]): boolean {
  return sources.length > 0 && isHlsSourceType(sources[0].type);
}
