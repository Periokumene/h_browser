/**
 * 进度条缩略图展示组件（纯前端）
 *
 * 由 spriteThumbnails 插件在 .vjs-progress-control 下创建并驱动，不依赖后端是否返回 VTT。
 *
 * 职责：
 * - 显隐：由插件根据「鼠标是否在进度条上」调用 show()/hide()。
 * - 内容：setContent(cueCss)，有 cue 时展示雪碧图/单图，无 cue 时展示纯黑矩形（#000）。
 * - 时间：setTimeText() 更新底部时间文案。
 *
 * DOM 结构：
 * - .vjs-sprite-thumbnail-display：外层，显示尺寸 THUMB_DISPLAY_*（如 240×135），用于定位与占位。
 * - .vjs-sprite-thumbnail-inner：内层，格子尺寸 THUMB_CELL_*（160×90）+ scale(THUMB_DISPLAY_SCALE)，承载 background。
 * - .vjs-sprite-thumbnail-time：底部时间，绝对定位在 display 底部。
 */

import {
  THUMB_CELL_WIDTH,
  THUMB_CELL_HEIGHT,
  THUMB_DISPLAY_SCALE,
  THUMB_DISPLAY_WIDTH,
  THUMB_DISPLAY_HEIGHT,
} from "./constants";

export interface ThumbnailCueCss {
  background: string;
  width: string;
  height: string;
}

export class ThumbnailDisplay {
  private readonly el: HTMLDivElement;
  private readonly innerEl: HTMLDivElement;
  private readonly timeLabelEl: HTMLDivElement;
  /** 上次设置的 cueCss，用于避免重复写 DOM（同一 cue 引用只写一次） */
  private lastCss: ThumbnailCueCss | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "vjs-sprite-thumbnail-display";
    this.el.setAttribute("aria-hidden", "true");

    this.innerEl = document.createElement("div");
    this.innerEl.className = "vjs-sprite-thumbnail-inner";
    this.innerEl.style.width = `${THUMB_CELL_WIDTH}px`;
    this.innerEl.style.height = `${THUMB_CELL_HEIGHT}px`;
    this.innerEl.style.transform = `scale(${THUMB_DISPLAY_SCALE})`;
    this.innerEl.style.transformOrigin = "0 0";
    this.el.appendChild(this.innerEl);

    this.timeLabelEl = document.createElement("div");
    this.timeLabelEl.className = "vjs-sprite-thumbnail-time";
    this.timeLabelEl.setAttribute("aria-hidden", "true");
    this.el.appendChild(this.timeLabelEl);

    container.appendChild(this.el);
  }

  /** 显示组件（进度条悬停时） */
  show(): void {
    this.el.style.opacity = "1";
  }

  /** 隐藏组件（离开进度条时） */
  hide(): void {
    this.el.style.opacity = "0";
  }

  /**
   * 更新水平位置：进度条上的 x 像素 + 占位宽度的一半，使缩略图中心对齐 x。
   */
  updatePosition(xPx: number, halfWidthPx: number): void {
    this.el.style.transform = `translateX(${xPx}px)`;
    this.el.style.marginLeft = `-${halfWidthPx}px`;
  }

  /**
   * 设置内容：有 cue 时显示雪碧图/单图，无 cue 时显示纯黑矩形。
   * 外层固定为 THUMB_DISPLAY_*，内层用 cue 的 background（格子坐标），通过 scale 放大显示。
   */
  setContent(cueCss: ThumbnailCueCss | null): void {
    this.el.style.width = `${THUMB_DISPLAY_WIDTH}px`;
    this.el.style.height = `${THUMB_DISPLAY_HEIGHT}px`;
    if (cueCss) {
      this.el.classList.remove("vjs-sprite-thumbnail-display--empty");
      if (this.lastCss !== cueCss) {
        this.lastCss = cueCss;
        this.innerEl.style.background = cueCss.background;
      }
    } else {
      this.el.classList.add("vjs-sprite-thumbnail-display--empty");
      this.innerEl.style.background = "#000";
      this.lastCss = null;
    }
  }

  /** 设置底部时间文本 */
  setTimeText(text: string): void {
    this.timeLabelEl.textContent = text;
  }

  /** 获取显示宽高的一半，供插件在无 cue 或解析失败时做水平居中定位 */
  static getDefaultHalfSize(): { halfW: number; halfH: number } {
    return { halfW: THUMB_DISPLAY_WIDTH / 2, halfH: THUMB_DISPLAY_HEIGHT / 2 };
  }

  destroy(): void {
    this.el.remove();
  }
}
