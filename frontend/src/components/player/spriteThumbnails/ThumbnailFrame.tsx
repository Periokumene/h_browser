/**
 * 可复用的缩略图展示组件（React）
 * 根据 spriteThumbnails 的 cue CSS 渲染缩略图，用于书签列表等。
 * 内层固定为后端约定的格子尺寸（THUMB_CELL_*），外层容器尺寸可灵活指定，内容自适应拉伸填满。
 */

import { Box } from "@chakra-ui/react";
import { THUMB_CELL_WIDTH, THUMB_CELL_HEIGHT } from "./constants";
import type { ThumbnailCueCss } from "./ThumbnailDisplay";

/** 书签列表等场景下的小缩略图尺寸（仅作默认值，可通过 width/height 覆盖） */
export const THUMB_FRAME_SMALL_WIDTH = 80;
export const THUMB_FRAME_SMALL_HEIGHT = 45;

export interface ThumbnailFrameProps {
  /** 由 getThumbnailCssForTime(time) 取得，null 时显示黑块 */
  cueCss: ThumbnailCueCss | null;
  /** 容器宽度（px），可任意指定，内容会拉伸填满 */
  width?: number;
  /** 容器高度（px），可任意指定，内容会拉伸填满 */
  height?: number;
  borderRadius?: string | number;
  flexShrink?: number;
}

export default function ThumbnailFrame({
  cueCss,
  width = THUMB_FRAME_SMALL_WIDTH,
  height = THUMB_FRAME_SMALL_HEIGHT,
  borderRadius = "md",
  flexShrink = 0,
}: ThumbnailFrameProps) {
  const scaleX = width / THUMB_CELL_WIDTH;
  const scaleY = height / THUMB_CELL_HEIGHT;

  return (
    <Box
      w={`${width}px`}
      h={`${height}px`}
      borderRadius={borderRadius}
      overflow="hidden"
      bg="black"
      flexShrink={flexShrink}
    >
      <Box
        w={`${THUMB_CELL_WIDTH}px`}
        h={`${THUMB_CELL_HEIGHT}px`}
        transformOrigin="0 0"
        transform={`scale(${scaleX}, ${scaleY})`}
        background={cueCss?.background ?? "#000"}
        bgColor={cueCss ? undefined : "black"}
      />
    </Box>
  );
}
