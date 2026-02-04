/**
 * Video.js 书签插件：在进度条上显示书签标记，点击可跳转。
 * 参考 videojs-markers 思路，自建实现以贴合项目需求。
 *
 * 使用方式：
 * - player.bookmarks(bookmarks)：初始化或更新书签列表
 * - player.bookmarks()：获取当前书签列表
 *
 * 插件 vs 直接代码：采用插件方式，与 spriteThumbnails 一致，可访问 .vjs-progress-holder，
 * 随 player dispose 自动清理，支持动态 updateBookmarks。
 */

import videojs from "video.js";
import type { VideoJsPlayer } from "../types";

export interface BookmarkItem {
  id: string;
  time: number;
  comment: string;
}

const Plugin = videojs.getPlugin("plugin");
const MARKER_CLASS = "vjs-bookmark-marker";
const CONTAINER_CLASS = "vjs-bookmarks-container";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

class BookmarksPlugin extends Plugin {
  private bookmarks: BookmarkItem[] = [];
  private containerEl: HTMLElement | null = null;
  private progressHolder: Element | null = null;
  private retryCount = 0;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private static readonly RETRY_MAX = 10;
  private static readonly RETRY_DELAY_MS = 100;

  constructor(player: VideoJsPlayer, options: { bookmarks?: BookmarkItem[] } = {}) {
    super(player, options);
    this.bookmarks = options?.bookmarks ?? [];
    this.player.ready(() => this.setupDom());
    this.player.on("loadedmetadata", () => this.updatePositions());
    this.player.on("resize", () => this.updatePositions());
  }

  private setupDom(): void {
    if (this.player.isDisposed()) return;

    const progressHolder = this.player.$(".vjs-progress-holder");
    if (!progressHolder) {
      if (this.retryCount < BookmarksPlugin.RETRY_MAX) {
        this.retryCount++;
        this.retryTimeoutId = setTimeout(() => {
          this.retryTimeoutId = null;
          this.setupDom();
        }, BookmarksPlugin.RETRY_DELAY_MS);
      }
      return;
    }

    this.progressHolder = progressHolder;
    const holder = progressHolder as HTMLElement;
    holder.style.position = "relative";

    let container = holder.querySelector(`.${CONTAINER_CLASS}`) as HTMLElement | null;
    if (!container) {
      container = document.createElement("div");
      container.className = CONTAINER_CLASS;
      container.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:4;";
      holder.appendChild(container);
    }
    this.containerEl = container;

    this.renderMarkers();
  }

  private renderMarkers(): void {
    if (this.player.isDisposed() || !this.containerEl || !this.progressHolder) return;

    this.containerEl.innerHTML = "";
    const duration = this.player.duration();
    if (!duration || !Number.isFinite(duration) || duration <= 0) return;

    for (const bm of this.bookmarks) {
      const ratio = bm.time / duration;
      if (ratio < 0 || ratio > 1) continue;

      const dot = document.createElement("div");
      dot.className = MARKER_CLASS;
      dot.dataset.bookmarkId = bm.id;
      dot.dataset.bookmarkTime = String(bm.time);
      dot.title = `${formatTime(bm.time)} - ${bm.comment}`;
      dot.style.cssText = `
        position:absolute;left:${ratio * 100}%;top:50%;
        transform:translate(-50%,-50%);
        width:8px;height:8px;border-radius:50%;
        background:var(--chakra-colors-orange-400, #ed8936);
        pointer-events:auto;cursor:pointer;
        transition:transform 0.15s ease;
      `;
      dot.addEventListener("mouseenter", () => {
        dot.style.transform = "translate(-50%,-50%) scale(1.3)";
      });
      dot.addEventListener("mouseleave", () => {
        dot.style.transform = "translate(-50%,-50%) scale(1)";
      });
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        this.player.currentTime(bm.time);
      });

      this.containerEl.appendChild(dot);
    }
  }

  private updatePositions(): void {
    if (!this.player.isDisposed() && this.containerEl && this.bookmarks.length > 0) {
      this.renderMarkers();
    }
  }

  /** 更新书签列表并重绘 */
  updateBookmarks(bookmarks: BookmarkItem[]): void {
    if (this.player.isDisposed()) return;
    this.bookmarks = [...bookmarks];
    this.renderMarkers();
  }

  /** 获取当前书签列表 */
  getBookmarks(): BookmarkItem[] {
    return [...this.bookmarks];
  }

  dispose(): void {
    if (this.retryTimeoutId != null) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    this.containerEl = null;
    this.progressHolder = null;
    super.dispose();
  }
}

videojs.registerPlugin("bookmarks", BookmarksPlugin);

export default BookmarksPlugin;
