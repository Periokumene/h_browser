import type { VideoJsPlayer, VideoJsPlayerOptions } from "./types";

/**
 * Video.js 默认配置，与后端能力无关，仅影响控件与响应式行为。
 * 使用 fill: true 使播放器填满父容器（宽高 100%），配合固定高度容器与 object-fit: contain 避免溢出。
 * fluid 与 fill 同时开启时 fluid 优先，故关闭 fluid。
 *
 * 键盘快捷键：使用 Video.js 8 的 userActions.hotkeys，在播放器获得焦点时：
 * - 空格：播放 / 暂停
 * - 左箭头：后退 5 秒
 * - 右箭头：前进 5 秒
 * 并避免在输入框等交互元素上误触。
 */

export const DEFAULT_PLAYER_OPTIONS: VideoJsPlayerOptions = {
  controls: true,
  autoplay: true,
  playsinline: true,
  responsive: true,
  fluid: false,
  fill: true,
  userActions: {
    // 参考 Video.js 官方 userActions.hotkeys 文档，自定义基础快捷键
    hotkeys: function (event) {
      const player = this as VideoJsPlayer;
      const target = event.target as HTMLElement | null;

      if (target) {
        const tag = target.tagName.toLowerCase();
        const isEditable = (target as HTMLElement).isContentEditable;
        if (tag === "input" || tag === "textarea" || tag === "select" || isEditable) {
          return;
        }
      }

      const key = event.key;

      if (key === " " || key === "Spacebar") {
        event.preventDefault();
        if (player.paused()) {
          player.play();
        } else {
          player.pause();
        }
        return;
      }

      const SEEK_SECONDS = 5;

      if (key === "ArrowRight") {
        event.preventDefault();
        const next = player.currentTime() + SEEK_SECONDS;
        player.currentTime(next);
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        const next = Math.max(0, player.currentTime() - SEEK_SECONDS);
        player.currentTime(next);
      }
    },
  },
};
