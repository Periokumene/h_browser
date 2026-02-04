/**
 * 测试面板：在控制栏添加「测试」按钮，点击后从右侧滑出侧边面板（非全屏 Modal）。
 * 使用方式：在 player ready 后调用 addTestPanelButton(player) 即可。
 */

import videojs from "video.js";
import type { VideoJsPlayer } from "../types";
import "./testPanel.css";
import TestPanel from "./TestPanel";
import TestPanelButton, { type TestPanelButtonOptions } from "./TestPanelButton";

const BUTTON_COMPONENT_NAME = "TestPanelButton";
const PANEL_COMPONENT_NAME = "TestPanel";

if (!videojs.getComponent(PANEL_COMPONENT_NAME)) {
  videojs.registerComponent(PANEL_COMPONENT_NAME, TestPanel);
}
if (!videojs.getComponent(BUTTON_COMPONENT_NAME)) {
  videojs.registerComponent(BUTTON_COMPONENT_NAME, TestPanelButton);
}

/**
 * 在播放器控制栏末尾添加测试面板按钮。
 * @param player - Video.js 播放器实例
 * @param options - 可选，面板内容、宽度、按钮图标等，见 TestPanelButtonOptions
 * @returns 添加的按钮组件实例
 */
export function addTestPanelButton(
  player: VideoJsPlayer,
  options?: TestPanelButtonOptions
): ReturnType<VideoJsPlayer["getChild"]> {
  const controlBar = player.getChild("ControlBar");
  if (!controlBar) return null;
  const btn = controlBar.addChild(BUTTON_COMPONENT_NAME, {
    controlText: "测试面板",
    className: "vjs-test-panel-button vjs-control",
    ...options,
  });
  return btn;
}

export { TestPanel, TestPanelButton, type TestPanelButtonOptions };
