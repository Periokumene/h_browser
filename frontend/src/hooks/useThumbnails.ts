/**
 * 缩略图状态 Hook：请求该编号的进度条缩略图，若后端返回 202 则轮询直至就绪或超时。
 * 用于播放页在进度条上展示悬停缩略图。
 *
 * --- 与后端约定 ---
 * - GET /api/items/<code>/thumbnails：200 表示已就绪，body 含 vtt_url、sprite_url（相对或绝对）；202 表示生成中，前端轮询。
 * - 轮询间隔 POLL_INTERVAL_MS，超过 MAX_POLL_COUNT 次未得到 200 则视为超时，不再请求。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchThumbnails } from "../api/calls";
import { getBaseUrl } from "../api/client";

/** 首次轮询间隔（毫秒）：在后端返回 202 后更快地再次确认，减小「已生成但前端未感知」的空窗期 */
const FIRST_POLL_INTERVAL_MS = 400;
/** 后续轮询间隔（毫秒）：在首次快速重试之后采用稍长的间隔，控制整体请求频率 */
const POLL_INTERVAL_MS = 600;
/** 最大轮询次数，超时后不再请求 */
const MAX_POLL_COUNT = 120; // 约 5 分钟

export interface ThumbnailsState {
  /** 是否已拿到可用的 vtt / sprite URL */
  ready: boolean;
  /** 完整 VTT URL（仅当 ready 时有效） */
  vttUrl: string | undefined;
  /** 完整雪碧图 URL（仅当 ready 时有效，供插件内部使用） */
  spriteUrl: string | undefined;
  /** 是否正在请求或轮询中 */
  loading: boolean;
  /** 后端报错信息（如无视频、未找到编号等） */
  error: string | null;
}

/**
 * 根据 code 获取缩略图 URL。若后端返回 202（生成中），会自动轮询直到 200 或超时。
 * 返回的 vttUrl/spriteUrl 已拼接 baseUrl，可直接用于 Video.js 插件。
 */
export function useThumbnails(code: string | undefined): ThumbnailsState {
  const [state, setState] = useState<ThumbnailsState>({
    ready: false,
    vttUrl: undefined,
    spriteUrl: undefined,
    loading: false,
    error: null,
  });
  const pollCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const request = useCallback(async () => {
    if (!code) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fetchThumbnails(code);
      if (result.status === 200) {
        const base = getBaseUrl().replace(/\/$/, "");
        const vttUrl = result.vtt_url.startsWith("http") ? result.vtt_url : `${base}${result.vtt_url}`;
        const spriteUrl = result.sprite_url.startsWith("http") ? result.sprite_url : `${base}${result.sprite_url}`;
        setState({ ready: true, vttUrl, spriteUrl, loading: false, error: null });
        return;
      }
      // 202：生成中，安排轮询；首次采用较短间隔，之后使用正常间隔，减少用户首次悬浮时的黑屏体感
      pollCountRef.current = 0;
      const poll = () => {
        pollCountRef.current += 1;
        if (pollCountRef.current > MAX_POLL_COUNT) {
          setState((s) => ({ ...s, loading: false, error: "缩略图生成超时" }));
          return;
        }
        fetchThumbnails(code)
          .then((next) => {
            if (next.status === 200) {
              const base = getBaseUrl().replace(/\/$/, "");
              const vttUrl = next.vtt_url.startsWith("http") ? next.vtt_url : `${base}${next.vtt_url}`;
              const spriteUrl = next.sprite_url.startsWith("http") ? next.sprite_url : `${base}${next.sprite_url}`;
              setState({ ready: true, vttUrl, spriteUrl, loading: false, error: null });
              return;
            }
            timeoutRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          })
          .catch((err) => {
            const msg =
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "请求缩略图失败";
            setState((s) => ({ ...s, loading: false, error: msg }));
          });
      };
      timeoutRef.current = setTimeout(poll, FIRST_POLL_INTERVAL_MS);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "请求缩略图失败";
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [code]);

  useEffect(() => {
    if (!code) {
      setState({ ready: false, vttUrl: undefined, spriteUrl: undefined, loading: false, error: null });
      return;
    }
    request();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [code, request]);

  return state;
}
