/**
 * Video.js 进度条缩略图插件（VTT + 雪碧图）
 *
 * 遵循 Video.js 扩展最佳实践，使用 Advanced Plugin 模式。
 * 支持 WebVTT 格式：时间区间 + 雪碧图坐标 (#xywh=x,y,w,h) 或单图 URL。
 *
 * --- 产品意图与设计原则 ---
 *
 * 缩略图显隐为「纯前端行为」：任意视频（ts/mp4、有无雪碧图、后端是否返回 VTT），只要鼠标悬浮在进度条上，
 * 都应显示缩略图组件。有有效 cue 时显示缩略图内容，无有效 cue 时显示纯黑色矩形，不因后端未就绪而整块不显示。
 *
 * --- 排查过程与修复汇总 ---
 *
 * 1) 仅后端返回 VTT 时才显示缩略图
 *    - 原因：调用方仅在 ready 时传 thumbnailsVttUrl，无 URL 时未传 vttContent，插件在 src/vttContent 皆无时直接 return，不挂载 DOM。
 *    - 修复：src 与 vttContent 均未提供时，使用空 VTT（"WEBVTT\n\n"）继续执行，仍挂载缩略图组件，悬停显示黑块。
 *
 * 2) opts 为 undefined 导致 Cannot read properties of undefined (reading 'src')
 *    - 原因：首次调用未传参或 options 未合并时 this.options 为 undefined。
 *    - 修复：init 内使用 opts = (this.options ?? {}) 做默认值，避免读 undefined 属性。
 *
 * 3) this.log.info is not a function
 *    - 原因：部分环境或 updateOptions 再次 init 时，Video.js 的 this.log 无 info/error 方法。
 *    - 修复：新增 _log(level, ...args)，优先用 this.log[level]，否则回退到 console.log/console.error。
 *
 * 4) 部分页面/时机下未创建 vjs-sprite-thumbnail-display
 *    - 原因：player.ready() 触发时 .vjs-progress-control 可能尚未挂到 DOM，setupDom() 中 get 为 null 直接 return。
 *    - 修复：setupDom(retryCount) 在未找到进度条时延迟重试（SETUPDOM_RETRY_MAX 次、SETUPDOM_RETRY_DELAY_MS 间隔），并在 reset 时清除重试定时器；进入时若 player 已 dispose 则直接 return。
 *
 * 5) VTT 请求失败时完全不显示缩略图
 *    - 原因：fetchVtt 抛错后 init 内 return，不执行 setupDom。
 *    - 修复：catch 中改为使用空 VTT 并继续执行，与「无 src/vttContent」行为一致。
 *
 * --- 开发过程中遇到的问题与设计决策 ---
 *
 * 1) 缩略图不显示（opacity 始终为 0）
 *    - 原因：.vjs-control-bar 在 vjs-user-inactive 时 pointer-events: none，绑在进度条上收不到事件。
 *    - 解决：在 player.el() 上监听 mousemove，用 progressEl.getBoundingClientRect() 判断 inBar。
 *
 * 2) 显隐与内容的职责分离：框的显隐仅由 inBar 决定；框的内容由 cue 决定，无 cue 显示纯黑矩形。
 *
 * 3) 布局：.vjs-progress-control 需 position: relative、overflow: visible；外层容器也需 overflow: visible。
 *
 * 4) duration 未就绪时用 cues 最大 end 或 30 作为 fallback。
 *
 * 5) 不对缩略图 transform 做 transition，仅对 opacity 做短过渡，避免跟随延迟。
 *
 * 6) 通过 .vjs-sprite-thumbnails-container 隐藏原生 .vjs-mouse-display，由缩略图底部时间替代。
 *
 * 7) BAR_HIT_PADDING_PX 垂直扩展 8px，使悬停判定更贴近进度条。
 *
 * --- 已做 ---
 * - init 内 fetch 后、ready 前做 isDisposed() 判断；onMouseMove 入口与 rect.width/duration/parseInt 做防御性校验。
 * - 尺寸与 scale 抽离到 constants.ts，单源维护。
 *
 * @see https://videojs.org/guides/plugins/
 * @see https://developer.bitmovin.com/playback/docs/webvtt-based-thumbnails
 */

import videojs from "video.js";
import type { VideoJsPlayer } from "../types";
import { ThumbnailDisplay } from "./ThumbnailDisplay";
import {
  getBaseUrlFromVttUrl,
  getCueForTime,
  parseVtt,
  type SpriteThumbnailCue,
} from "./vttCueUtils";

const Plugin = videojs.getPlugin("plugin");

export type { SpriteThumbnailCue };

export interface SpriteThumbnailsOptions {
  /** VTT 文件 URL，与 vttContent 二选一 */
  src?: string;
  /** 内联 VTT 内容（占位/测试用），与 src 二选一 */
  vttContent?: string;
  /** 解析 VTT 中相对 URL 时的基准地址，vttContent 模式下建议传入 */
  spriteBaseUrl?: string;
}

const VERSION = "1.0.0";

/** 将秒数格式化为 MM:SS 或 HH:MM:SS */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 占位用：内联 VTT + 雪碧图 data URL
 * 用于无后端时的前端演示
 */
export const PLACEHOLDER_VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000 placeholder#xywh=0,0,160,90
00:00:05.000 --> 00:00:10.000 placeholder#xywh=160,0,160,90
00:00:10.000 --> 00:00:15.000 placeholder#xywh=320,0,160,90
00:00:15.000 --> 00:00:20.000 placeholder#xywh=0,90,160,90
00:00:20.000 --> 00:00:25.000 placeholder#xywh=160,90,160,90
00:00:25.000 --> 00:00:30.000 placeholder#xywh=320,90,160,90
`;

/** 未找到 .vjs-progress-control 时重试 setupDom 的最大次数（player.ready 时控制条可能尚未挂载） */
const SETUPDOM_RETRY_MAX = 40;
/** 每次重试间隔（ms） */
const SETUPDOM_RETRY_DELAY_MS = 50;

/** 占位雪碧图：480x180 灰色网格，6 格 160x90 */
export const PLACEHOLDER_SPRITE_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180">' +
      '<rect width="480" height="180" fill="#333"/>' +
      '<g fill="#555" stroke="#444" stroke-width="1">' +
      '<rect x="0" y="0" width="160" height="90"/><text x="80" y="50" fill="#888" text-anchor="middle" font-size="12">0-5s</text>' +
      '<rect x="160" y="0" width="160" height="90"/><text x="240" y="50" fill="#888" text-anchor="middle" font-size="12">5-10s</text>' +
      '<rect x="320" y="0" width="160" height="90"/><text x="400" y="50" fill="#888" text-anchor="middle" font-size="12">10-15s</text>' +
      '<rect x="0" y="90" width="160" height="90"/><text x="80" y="140" fill="#888" text-anchor="middle" font-size="12">15-20s</text>' +
      '<rect x="160" y="90" width="160" height="90"/><text x="240" y="140" fill="#888" text-anchor="middle" font-size="12">20-25s</text>' +
      '<rect x="320" y="90" width="160" height="90"/><text x="400" y="140" fill="#888" text-anchor="middle" font-size="12">25-30s</text>' +
      "</g></svg>"
  );

class SpriteThumbnailsPlugin extends Plugin {
  private cues: SpriteThumbnailCue[] = [];
  /** 缩略图展示组件：悬停进度条时始终显示，有 cue 显示缩略图，无 cue 显示纯黑矩形 */
  private thumbnailDisplay: ThumbnailDisplay | null = null;
  /** 进度条容器：挂载缩略图 DOM，并用于 getBoundingClientRect() 做 inBar 判定 */
  private progressEl: Element | null = null;
  private boundHandlers: {
    move?: (e: MouseEvent) => void;
  } = {};
  /** 用于在 reset 时取消未执行的 setupDom 重试定时器 */
  private setupDomRetryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(player: VideoJsPlayer, options: SpriteThumbnailsOptions) {
    super(player, options);
    this.init();
  }

  /** 使用新选项重新初始化（如从占位符切换到后端 URL）。调用后先 reset 再 init，避免重复 DOM/监听。 */
  updateOptions(options: SpriteThumbnailsOptions): void {
    this.reset();
    this.options = { ...this.options, ...options };
    this.init();
  }

  /** 移除 mousemove 监听、清理进度条样式与 class、销毁缩略图组件，清空 cues；并取消未执行的 setupDom 重试。 */
  private reset(): void {
    if (this.setupDomRetryTimeoutId != null) {
      clearTimeout(this.setupDomRetryTimeoutId);
      this.setupDomRetryTimeoutId = null;
    }
    if (this.boundHandlers.move) {
      const el = this.player?.el();
      if (el) el.removeEventListener("mousemove", this.boundHandlers.move!);
    }
    if (this.progressEl) {
      (this.progressEl as HTMLElement).classList.remove("vjs-sprite-thumbnails-container");
      (this.progressEl as HTMLElement).style.overflow = "";
    }
    this.thumbnailDisplay?.destroy();
    this.thumbnailDisplay = null;
    this.progressEl = null;
    this.cues = [];
  }

  /** 安全输出日志：Video.js 的 this.log 在某些环境下无 info/error 方法，回退到 console */
  private _log(level: "info" | "warn" | "error", ...args: unknown[]): void {
    const log = this.log as { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void } | undefined;
    const fn = log?.[level];
    if (typeof fn === "function") {
      fn.apply(log, args);
    } else if (level === "error") {
      console.error("[spriteThumbnails]", ...args);
    } else {
      console.log("[spriteThumbnails]", ...args);
    }
  }

  /**
   * 加载 VTT（src 或 vttContent）、解析 cues，在 player.ready 后调用 setupDom。
   * 无 src 且无 vttContent 时使用空 VTT，仍挂载缩略图组件（悬停显示黑块）；VTT 请求失败时同样 fallback 到空 VTT。
   */
  private async init(): Promise<void> {
    const opts = (this.options ?? {}) as SpriteThumbnailsOptions;
    this._log(
      "info",
      `init: src=${opts.src ?? "(none)"}, vttContent=${opts.vttContent != null ? `(length=${opts.vttContent.length})` : "(none)"}`
    );
    let vttText: string;
    let baseUrl: string;

    if (opts.vttContent) {
      vttText = opts.vttContent;
      baseUrl = opts.spriteBaseUrl ?? window.location.origin + "/";
    } else if (opts.src) {
      try {
        vttText = await this.fetchVtt(opts.src);
        if (this.player.isDisposed()) return;
        baseUrl = getBaseUrlFromVttUrl(opts.src);
      } catch (err) {
        this._log("error", "Failed to load VTT", err);
        vttText = "WEBVTT\n\n";
        baseUrl = window.location.origin + "/";
      }
    } else {
      /* 无 src 且无 vttContent：使用空 VTT，仍挂载缩略图组件，悬停显示纯黑矩形（满足「纯前端显隐」意图） */
      vttText = "WEBVTT\n\n";
      baseUrl = window.location.origin + "/";
    }

    this.cues = parseVtt(vttText, baseUrl);
    if (this.cues.length === 0) {
      this._log("info", "no cues (未生成或空 VTT)，悬停时显示纯黑矩形");
    }
    if (this.player.isDisposed()) return;
    this.player.ready(() => this.setupDom());
  }

  /** 插件内部请求 VTT 内容；同源或后端已 CORS 时使用。 */
  private async fetchVtt(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`VTT fetch failed: ${res.status}`);
    return res.text();
  }

  /**
   * 在 .vjs-progress-control 下挂载缩略图组件并绑定 mousemove。
   * player.ready 时控制条可能尚未挂载，故未找到进度条时延迟重试（由 retryCount 控制），避免漏建 vjs-sprite-thumbnail-display。
   */
  private setupDom(retryCount = 0): void {
    if (this.player.isDisposed()) return;

    const progressControl = this.player.$(".vjs-progress-control");
    if (!progressControl) {
      if (retryCount < SETUPDOM_RETRY_MAX) {
        this.setupDomRetryTimeoutId = setTimeout(() => {
          this.setupDomRetryTimeoutId = null;
          this.setupDom(retryCount + 1);
        }, SETUPDOM_RETRY_DELAY_MS);
      }
      return;
    }

    const el = progressControl as HTMLElement;
    el.style.position = "relative";
    el.style.overflow = "visible";
    el.classList.add("vjs-sprite-thumbnails-container");
    this.progressEl = progressControl;
    this.thumbnailDisplay = new ThumbnailDisplay(el);

    this.boundHandlers.move = (e: MouseEvent) => this.onMouseMove(e);
    this.player.el().addEventListener("mousemove", this.boundHandlers.move);
  }

  /** 垂直方向扩展的像素数，仅做轻微容差，使判定更贴近进度条（曾用 128 导致判定范围过大） */
  private static readonly BAR_HIT_PADDING_PX = 8;

  /**
   * 根据鼠标是否在进度条内显隐缩略图，按 x/width*duration 取 cue 并更新内容或纯黑矩形。
   * 含防御性校验：dispose 后、无进度条/宽度为 0、duration 异常时提前 return 或使用 fallback。
   */
  /**
   * 根据时间获取对应缩略图 CSS，供书签列表等复用。
   * 无 cue 或 time 不在任意区间内时返回 null。
   */
  getThumbnailCssForTime(time: number): SpriteThumbnailCue["css"] | null {
    return this.cues.length > 0 ? getCueForTime(this.cues, time) : null;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.player.isDisposed() || !this.thumbnailDisplay || !this.progressEl) return;

    const rect = this.progressEl.getBoundingClientRect();
    const { clientX, clientY } = e;
    const pad = SpriteThumbnailsPlugin.BAR_HIT_PADDING_PX;
    const inBar =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad;

    if (!inBar) {
      this.thumbnailDisplay.hide();
      return;
    }

    this.thumbnailDisplay.show();

    const width = rect.width;
    if (!width || !Number.isFinite(width)) return;

    const x = clientX - rect.left;
    let duration = this.player.duration();
    if (!duration || !Number.isFinite(duration) || duration <= 0) {
      duration = this.cues.length > 0 ? Math.max(...this.cues.map((c) => c.end), 30) : 30;
    }

    const time = (x / width) * duration;
    const css = this.cues.length > 0 ? getCueForTime(this.cues, time) : null;

    const { halfW } = ThumbnailDisplay.getDefaultHalfSize();
    const parsedW = css ? Number.parseInt(css.width, 10) : NaN;
    const halfWidthPx = Number.isFinite(parsedW) ? parsedW / 2 : halfW;
    const xPos = Math.max(halfWidthPx, Math.min(width - halfWidthPx, x));

    this.thumbnailDisplay.updatePosition(xPos, halfWidthPx);
    this.thumbnailDisplay.setContent(css);
    this.thumbnailDisplay.setTimeText(formatTime(time));
  }

  dispose(): void {
    this.reset();
    super.dispose();
  }
}

SpriteThumbnailsPlugin.VERSION = VERSION;
videojs.registerPlugin("spriteThumbnails", SpriteThumbnailsPlugin);

export default SpriteThumbnailsPlugin;
