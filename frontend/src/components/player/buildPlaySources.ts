/**
 * 根据当前条目与后端约定，生成播放页所需的 sources 与 poster。
 * 与 /api/stream/<code>、/api/stream/<code>/playlist.m3u8 对应。
 */

import type { VideoJsSource } from "./types";
import type { MediaDetail } from "../../types/api";

export interface PlaySourcesResult {
  sources: VideoJsSource[];
  poster?: string;
}

export function buildPlaySources(
  code: string,
  item: MediaDetail,
  baseUrl: string
): PlaySourcesResult {
  const hasMp4 = item.has_mp4 ?? false;
  const hasTs = item.has_ts ?? false;
  const useHls = hasTs && !hasMp4;
  const enc = encodeURIComponent(code);

  const streamUrl = (format: "mp4" | "ts") =>
    `${baseUrl}/api/stream/${enc}?format=${format}`;
  const m3u8Url = `${baseUrl}/api/stream/${enc}/playlist.m3u8`;

  if (useHls) {
    return {
      sources: [{ src: m3u8Url, type: "application/x-mpegURL" }],
      poster: item.poster_url ? `${baseUrl}${item.poster_url}` : undefined,
    };
  }
  return {
    sources: [
      {
        src: streamUrl(hasMp4 ? "mp4" : "ts"),
        type: hasMp4 ? "video/mp4" : "video/mp2t",
      },
    ],
    poster: item.poster_url ? `${baseUrl}${item.poster_url}` : undefined,
  };
}
