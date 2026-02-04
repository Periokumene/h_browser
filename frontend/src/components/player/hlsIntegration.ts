/**
 * 在 Video.js 使用的同一 video 元素上挂载 hls.js，处理 HLS（m3u8）加载与错误恢复。
 * 与 VHS 解耦，便于单独测试与后续替换实现。
 */

import Hls from "hls.js";
import type { HlsErrorData } from "./types";

export interface HlsCallbacks {
  onFatalError: (message: string) => void;
  onRecover: () => void;
}

const DEFAULT_HLS_CONFIG: Partial<ConstructorParameters<typeof Hls>[0]> = {
  enableWorker: true,
  lowLatencyMode: false,
  fragLoadingMaxRetry: 3,
  manifestLoadingMaxRetry: 2,
  xhrSetup: (xhr) => {
    xhr.withCredentials = true;
  },
};

function formatHlsErrorDetail(data: HlsErrorData): string {
  return [data.type, data.details, data.response?.code != null ? `HTTP ${data.response.code}` : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * 创建 hls 实例并绑定到 mediaEl，注册错误与恢复逻辑。
 * 恢复播放时会替换内部实例，组件卸载时调用返回的 destroy() 即可清理当前实例。
 * 【备忘】若传入非 <video> 元素（如 video-js 根节点），attachMedia 可能异常；调用方应保证 mediaEl 为已挂载的 HTMLVideoElement，必要时可在此处增加 tagName === "VIDEO" 校验并提前 return。
 */
export function createAndAttachHls(
  mediaEl: HTMLVideoElement,
  m3u8Url: string,
  callbacks: HlsCallbacks,
  startPosition?: number
): { destroy: () => void } {
  const hls = new Hls({
    ...DEFAULT_HLS_CONFIG,
    startPosition: startPosition ?? -1,
  });
  hls.loadSource(m3u8Url);
  hls.attachMedia(mediaEl);

  let currentDestroy: () => void = () => {
    try {
      hls.detachMedia();
    } catch {
      /* ignore */
    }
    hls.destroy();
  };

  let reinitDone = false;
  const onReady = () => mediaEl.play().catch(() => {});

  const onError = (_event: string, data: HlsErrorData) => {
    if (!data.fatal) return;
    const isFragParsingError =
      data.type === "mediaError" && data.details === "fragParsingError";
    if (isFragParsingError && !reinitDone) {
      reinitDone = true;
      currentDestroy();
      const next = createAndAttachHls(mediaEl, m3u8Url, callbacks, mediaEl.currentTime);
      currentDestroy = next.destroy;
      callbacks.onRecover();
      return;
    }
    callbacks.onFatalError(formatHlsErrorDetail(data));
  };

  hls.on(Hls.Events.MANIFEST_PARSED, onReady);
  hls.on(Hls.Events.ERROR, onError);

  return {
    destroy: () => currentDestroy(),
  };
}
