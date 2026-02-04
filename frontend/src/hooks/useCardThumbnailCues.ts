/**
 * 卡片悬浮缩略图数据 Hook：根据当前预览卡片 code 拉取 VTT 并解析为 cues + duration。
 * 供 VideoGallery 的 rAF 按 progress 取帧，避免在画廊组件内散落 fetch/effect 逻辑。
 *
 * 与 useThumbnails 分工：useThumbnails 负责轮询拿到 vtt_url；本 Hook 在 URL 就绪后请求并解析 VTT。
 */

import { useEffect, useRef, useState } from "react";
import { useThumbnails } from "./useThumbnails";
import { fetchAndParseVtt } from "../components/player/spriteThumbnails/vttCueUtils";
import type { SpriteThumbnailCue } from "../components/player/spriteThumbnails/vttCueUtils";

export interface CardThumbnailCuesData {
  cues: SpriteThumbnailCue[];
  duration: number;
}

/**
 * @param previewCode 当前处于预览模式的卡片 code，null 时清空 cues
 * @returns cuesData 供 UI 只读；cuesRef 供 rAF 等闭包同步读取，避免闭包陈旧
 */
export function useCardThumbnailCues(previewCode: string | null): {
  cuesData: CardThumbnailCuesData | null;
  cuesRef: React.MutableRefObject<CardThumbnailCuesData | null>;
} {
  const [cuesData, setCuesData] = useState<CardThumbnailCuesData | null>(null);
  const cuesRef = useRef<CardThumbnailCuesData | null>(null);
  cuesRef.current = cuesData;

  const { ready: thumbnailsReady, vttUrl } = useThumbnails(previewCode ?? undefined);

  useEffect(() => {
    if (!previewCode) {
      setCuesData(null);
      return;
    }
    if (!vttUrl || !thumbnailsReady) {
      setCuesData(null);
      return;
    }
    let cancelled = false;
    fetchAndParseVtt(vttUrl).then(({ cues, duration }) => {
      if (!cancelled) setCuesData({ cues, duration });
    });
    return () => {
      cancelled = true;
    };
  }, [previewCode, vttUrl, thumbnailsReady]);

  return { cuesData, cuesRef };
}
