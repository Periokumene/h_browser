/**
 * Video.js 自定义控件：测试按钮，点击后切换右侧侧边面板的显隐。
 * 遵循 Video.js 组件规范：继承 Button，注册后通过 ControlBar.addChild 加入。
 * 面板内容可通过 options.panelContent 自定义，默认为「测试面板」。
 *
 * @see https://videojs.com/guides/components/
 */

import videojs from "video.js";
import type { VideoJsPlayer } from "../types";

const Button = videojs.getComponent("Button");

/** 挂在 player 上用于存放侧边面板实例的 key */
const TEST_PANEL_REF = "_testPanelRef";

export interface TestPanelButtonOptions {
  /** 面板内显示的文本或 DOM 内容，默认「测试面板」 */
  panelContent?: string | (() => string) | DocumentFragment;
  /** 面板宽度（px），默认 320 */
  panelWidth?: number;
  /** 按钮图标风格：'menu' 菜单/列表 | 'bookmark' 书签，默认 'menu' */
  icon?: "menu" | "bookmark";
  /**
   * 外部控制面板显隐时传入；点击按钮会调用 onToggle(newState)，不再使用内置 TestPanel。
   * 外部关闭面板后应触发 player.trigger('testpanelclose')，以便按钮状态同步。
   */
  onToggle?: (open: boolean) => void;
}

interface TestPanelInstance {
  toggle: () => void;
  isDisposed: () => boolean;
}

class TestPanelButton extends Button {
  /** 当使用 onToggle 时，记录外部面板是否打开 */
  private _externalOpen = false;

  constructor(player: VideoJsPlayer, options: TestPanelButtonOptions = {}) {
    super(player, options);
    this.on(player, "testpanelclose", () => {
      this._externalOpen = false;
    });
  }

  buildCSSClass(): string {
    const opts = (this.options_ || {}) as TestPanelButtonOptions;
    const icon = opts.icon === "bookmark" ? "bookmark" : "menu";
    return `vjs-test-panel-button vjs-test-panel-button--${icon} ${super.buildCSSClass()}`;
  }

  handleClick(_event: Event): void {
    const opts = (this.options_ || {}) as TestPanelButtonOptions;
    if (opts.onToggle) {
      this._externalOpen = !this._externalOpen;
      opts.onToggle(this._externalOpen);
      return;
    }
    const player = this.player_ as VideoJsPlayer & { [TEST_PANEL_REF]?: TestPanelInstance };
    let panel = player[TEST_PANEL_REF];
    if (!panel || panel.isDisposed()) {
      panel = player.addChild("TestPanel", {
        panelContent: opts.panelContent ?? "测试面板",
        width: opts.panelWidth ?? 320,
      }) as unknown as TestPanelInstance;
      player[TEST_PANEL_REF] = panel;
    }
    panel.toggle();
  }
}

export default TestPanelButton;
