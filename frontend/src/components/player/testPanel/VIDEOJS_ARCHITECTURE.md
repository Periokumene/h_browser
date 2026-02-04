# 测试面板与 Video.js 架构说明

## 当前实现方式

- **触发**：鼠标移入播放器右侧 32px 热区时展开面板，移出面板约 400ms 后自动收起；也可点击面板内关闭按钮立即关闭。
- **UI**：侧边面板由 **React + Chakra UI** 实现（`TestPanelChakra.tsx`），作为 `VideoJsPlayer` 的子节点渲染，绝对定位于播放器容器内，不参与 Video.js 的组件树。
- **状态**：显隐由 React `useState` 控制，与播放器生命周期解耦；播放器 dispose 时仅需在 cleanup 中清除自动关闭的 timer。

## 与 Video.js 最佳实践的关系

### 1. 官方推荐：控件作为 Video.js 组件

Video.js 推荐将播放器相关 UI 做成 **Component** 并挂到 player 上（如 `ControlBar`、自定义 `Button`），这样：

- 随 player 一起 dispose，无泄漏；
- 能直接访问 `player`、事件与 API；
- 样式与层级在 `.video-js` 内，便于统一管理。

本项目的 **TestPanel / TestPanelButton**（`TestPanel.ts`、`TestPanelButton.ts`）即按此方式实现，可作为“纯 Video.js 控件”的参考；当前播放页已不再使用按钮，仅保留“右侧悬停 + React 面板”的交互。

### 2. React 应用中的常见做法：React 负责叠加层 UI

在 React 里用 Video.js 时，常见做法是：

- **核心播放**：仍用 Video.js（`<video>`、tech、基础控制条）；
- **叠加层 / 浮层**：用 React 组件渲染在播放器容器之上，通过 `playerRef` 或事件与播放器通信。

这样做的原因包括：

- 便于使用现有 React 组件库（如 Chakra UI）和设计系统；
- 浮层状态（如面板开/关）用 React state 更自然，且不污染 Video.js 的 DOM 树；
- 与路由、主题、全局状态等 React 生态更好结合。

当前测试面板采用的就是这种“React 叠加层”方式，与 [Video.js React 指南](https://videojs.com/guides/react/) 中“用 React 包一层、内部创建 player”的思路一致。

### 3. 本项目的取舍

| 方面           | 做法                         | 说明 |
|----------------|------------------------------|------|
| 播放与基础控件 | Video.js 原生                | 符合官方推荐，便于升级与插件生态。 |
| 进度条缩略图   | Video.js 插件（spriteThumbnails） | 作为 Component 挂到 player，随 player 销毁。 |
| 测试侧边面板   | React + Chakra，右侧悬停触发 | 叠加层由 React 完全控制，不增加控制栏复杂度。 |

结论：**当前“Video.js 负责播放与基础 UI + React 负责侧边浮层”的划分，符合在 React 应用中使用 Video.js 的常见实践**；测试面板不放在 Video.js 组件树内是刻意为之，便于用 Chakra 做现代化 UI 并独立管理显隐逻辑。

## 可选：恢复按钮入口

若需在控制栏加回“测试面板”按钮，可再次在 `VideoJsPlayer` 的 `player.ready()` 中调用：

```ts
import { addTestPanelButton } from "./testPanel";
// ...
player.ready(() => {
  addTestPanelButton(player, { onToggle: (open) => setTestPanelOpen(open) });
});
```

并保证关闭时调用 `player.trigger("testpanelclose")`，以便按钮与面板状态同步（参见 `TestPanelButton` 的 `onToggle` 与 `testpanelclose` 逻辑）。
