/**
 * Video.js 自定义组件：侧边面板（抽屉），从右侧滑出，不遮挡整屏。
 * 作为 Player 的子组件挂载，绝对定位于播放器右侧。
 *
 * @see https://videojs.com/guides/components/
 */

import videojs from "video.js";
import type { VideoJsPlayer } from "../types";

const Component = videojs.getComponent("Component");
const CloseButton = videojs.getComponent("CloseButton");

export interface TestPanelOptions {
  /** 面板内显示的文本或 DOM，默认「测试面板」 */
  panelContent?: string | (() => string) | DocumentFragment;
  /** 面板宽度（px），默认 320 */
  width?: number;
}

const DEFAULT_WIDTH = 320;

class TestPanel extends Component {
  private _open = false;

  constructor(player: VideoJsPlayer, options: TestPanelOptions = {}) {
    super(player, options);
    this.on(player, "dispose", () => this.dispose());
  }

  buildCSSClass(): string {
    return `vjs-test-panel ${super.buildCSSClass()}`;
  }

  createEl(): HTMLElement {
    const opts = (this.options_ || {}) as TestPanelOptions;
    const width = opts.width ?? DEFAULT_WIDTH;
    const el = super.createEl("div", {
      className: this.buildCSSClass(),
      dir: "ltr",
    }) as HTMLElement;
    el.style.width = `${width}px`;
    el.setAttribute("aria-label", "测试面板");
    el.setAttribute("aria-hidden", "true");
    el.classList.add("vjs-hidden");

    const header = document.createElement("div");
    header.className = "vjs-test-panel-header";

    const title = document.createElement("span");
    title.className = "vjs-test-panel-title";
    title.textContent = "测试面板";
    header.appendChild(title);

    const closeBtn = new (CloseButton as any)(this.player_, {
      controlText: "关闭面板",
    });
    closeBtn.addClass("vjs-test-panel-close");
    closeBtn.on("click", () => this.close());
    header.appendChild(closeBtn.el()!);

    el.appendChild(header);

    const contentWrap = document.createElement("div");
    contentWrap.className = "vjs-test-panel-content";
    this.contentEl_ = contentWrap;
    el.appendChild(contentWrap);

    this.fillContent();

    return el;
  }

  private fillContent(): void {
    if (!this.contentEl_) return;
    const opts = (this.options_ || {}) as TestPanelOptions;
    const content = opts.panelContent ?? "测试面板";
    const resolved =
      typeof content === "function" ? content() : content;
    this.contentEl_.innerHTML = "";
    if (typeof resolved === "string") {
      this.contentEl_.textContent = resolved;
    } else if (resolved instanceof DocumentFragment) {
      this.contentEl_.appendChild(resolved);
    } else {
      this.contentEl_.textContent = "测试面板";
    }
  }

  open(): void {
    if (this._open) return;
    this._open = true;
    this.removeClass("vjs-hidden");
    this.el().setAttribute("aria-hidden", "false");
    this.trigger("panelopen");
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.addClass("vjs-hidden");
    this.el().setAttribute("aria-hidden", "true");
    this.trigger("panelclose");
  }

  toggle(): void {
    this._open ? this.close() : this.open();
  }

  isOpen(): boolean {
    return this._open;
  }

  dispose(): void {
    this.contentEl_ = null;
    super.dispose();
  }
}

(TestPanel as any).prototype.contentEl_ = null;

export default TestPanel;
