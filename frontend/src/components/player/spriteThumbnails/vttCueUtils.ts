/**
 * VTT 缩略图解析工具：与 plugin 共用同一套解析逻辑，供播放页进度条与卡片预览等复用。
 * 不依赖 Video.js，仅解析 VTT 文本与按时间取 cue。
 */

import { THUMB_DISPLAY_WIDTH, THUMB_DISPLAY_HEIGHT } from "./constants";

export interface ThumbnailCueCss {
  background: string;
  width: string;
  height: string;
}

export interface SpriteThumbnailCue {
  start: number;
  end: number;
  css: ThumbnailCueCss;
}

function parseTimestamp(ts: string): number {
  const trimmed = ts.trim();
  const parts = trimmed.split(/[:.]/).map(Number);
  if (parts.length < 3) return 0;
  const h = parts.length === 4 ? parts[0] : 0;
  const m = parts.length === 4 ? parts[1] : parts[0];
  const s = parts.length === 4 ? parts[2] : parts[1];
  const ms = parts.length === 4 ? parts[3] : parts[2] ?? 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

function parseImageDef(def: string, baseUrl: string): ThumbnailCueCss {
  const trimmed = def.trim();
  const xywhMatch = trimmed.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/i);
  const urlPart = trimmed.replace(/#xywh=.*$/i, "").trim();

  let fullUrl: string;
  if (urlPart.startsWith("http") || urlPart.startsWith("data:")) {
    fullUrl = urlPart;
  } else if (
    (urlPart === "placeholder" || !urlPart) &&
    (baseUrl.startsWith("data:") || baseUrl.startsWith("http"))
  ) {
    fullUrl = baseUrl;
  } else if (urlPart) {
    const base = baseUrl.replace(/\/[^/]*$/, "/");
    fullUrl = base + urlPart.replace(/^\//, "");
  } else {
    fullUrl = baseUrl;
  }

  const dispW = THUMB_DISPLAY_WIDTH;
  const dispH = THUMB_DISPLAY_HEIGHT;

  if (!xywhMatch) {
    return {
      background: `url("${fullUrl}") no-repeat 0 0`,
      width: `${dispW}px`,
      height: `${dispH}px`,
    };
  }

  const [, x, y] = xywhMatch;
  return {
    background: `url("${fullUrl}") no-repeat -${x}px -${y}px`,
    width: `${dispW}px`,
    height: `${dispH}px`,
  };
}

/**
 * 解析 VTT 文本为时间区间 + CSS 数组
 */
export function parseVtt(vttText: string, baseUrl: string): SpriteThumbnailCue[] {
  const cues: SpriteThumbnailCue[] = [];
  const blocks = vttText.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    const timingMatch = lines[0].match(
      /(\d{1,2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})/
    );
    if (!timingMatch) continue;

    const start = parseTimestamp(timingMatch[1]);
    const end = parseTimestamp(timingMatch[2]);
    const imageDef = lines[1];

    cues.push({
      start,
      end,
      css: parseImageDef(imageDef, baseUrl),
    });
  }

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * 根据时间（秒）取对应缩略图 CSS；不在任意 cue 内返回 null
 */
export function getCueForTime(
  cues: SpriteThumbnailCue[],
  time: number
): ThumbnailCueCss | null {
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) return cue.css;
  }
  return null;
}

/**
 * 从 cues 得到有效时长（用于 progress 0-1 映射到 time）
 */
export function getDurationFromCues(cues: SpriteThumbnailCue[]): number {
  if (cues.length === 0) return 0;
  return Math.max(...cues.map((c) => c.end));
}

/**
 * VTT URL 所在目录作为解析相对路径的 baseUrl
 */
export function getBaseUrlFromVttUrl(vttUrl: string): string {
  try {
    const u = new URL(vttUrl);
    const path = u.pathname;
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash >= 0) {
      u.pathname = path.slice(0, lastSlash + 1);
    }
    return u.toString();
  } catch {
    return window.location.origin + "/";
  }
}

/**
 * 请求 VTT 并解析，返回 cues 与 duration；失败返回 { cues: [], duration: 0 }
 */
export async function fetchAndParseVtt(
  vttUrl: string
): Promise<{ cues: SpriteThumbnailCue[]; duration: number }> {
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) return { cues: [], duration: 0 };
    const text = await res.text();
    const baseUrl = getBaseUrlFromVttUrl(vttUrl);
    const cues = parseVtt(text, baseUrl);
    const duration = getDurationFromCues(cues);
    return { cues, duration };
  } catch {
    return { cues: [], duration: 0 };
  }
}
