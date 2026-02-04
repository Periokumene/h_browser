# 播放器布局与网页全屏说明

本文档说明播放器组件、其容器与播放页的关系，以及如何实现「不受视频原尺寸影响的网页全屏」效果。

---

## 一、结构关系

### 1. DOM 层级（播放页 Play.tsx）

```
页面根
└── Box（外层：minH=100vh, w=100%, flex 居中, bg=black）
    └── Box（内层：w=100%, h=100%, maxH=100vh, overflow=visible）
        └── VideoJsPlayer
            └── <div data-vjs-player>
                └── <div ref={containerRef}>   ← 播放器挂载点
                    └── <video-js class="vjs-big-play-centered vjs-fluid ...">   ← Video.js 根
                        ├── <video class="vjs-tech">   ← 实际 <video> 元素
                        ├── .vjs-control-bar
                        └── ...
```

- **外层 Box**：占满视口高度（minH="100vh"）、宽度 100%，黑色背景，flex 使内容居中。
- **内层 Box**：宽高 100%（继承外层）、最大高度 100vh，并**通过 sx 约束内部 `.video-js` 的尺寸**（见下）。
- **VideoJsPlayer**：只提供一层包裹和挂载点（`data-vjs-player` + `containerRef`），**自身不设宽高**，尺寸完全由父级和内层 Box 的 sx 决定。

### 2. 播放器组件本身（VideoJsPlayer.tsx）

- 根节点：`<div data-vjs-player>` 内只有一个 `<div ref={containerRef} />`，没有 className、没有内联样式。
- Video.js 实例挂到 `containerRef.current`，生成的根元素是 `<video-js>`（即 `.video-js`）。
- 默认配置（`constants.ts`）中有 **`fluid: true`**，Video.js 会加上 `vjs-fluid`，默认行为是「宽度 100% + 用 padding-top 比例留出高度」，但在本项目中**被播放页的 sx 覆盖**。

---

## 二、网页全屏与「不受视频原尺寸影响」的实现方式

### 1. 谁在决定「占满一屏」

- **尺寸约束发生在播放页**，而不是播放器组件内部。  
- 内层 Box 的 `sx` 中有：
  ```js
  "& .video-js": { width: "100%", height: "100%", maxHeight: "100vh" }
  ```
  即：**任意后代中的 `.video-js` 都被强制为「宽 100%、高 100%、最大高度 100vh」**。

- 内层 Box 自身是 `w="100%"`、`h="100%"`、`maxH="100vh"`，因此：
  - 在视口内，它占满可用宽高，且高度不超过 100vh。
  - 这样一来，**.video-js 的 100% 宽高就是相对于这个「视口内的满屏区域」**，而不是相对于视频本身。

### 2. 为何不会随视频原尺寸变化

- 视频的**内在尺寸**（如 1920×1080、720×480）只影响 `<video>` 的渲染内容，**不再参与决定外层容器或 .video-js 的布局**。
- 布局顺序是：
  1. **先**由页面 + 内层 Box 定出「一块固定逻辑区域」（100% × 100%，且 maxH=100vh）。
  2. **再**让 `.video-js` 填满这块区域（width/height 100%）。
  3. Video.js 内部用 **`.vjs-tech`（即 `<video>`）** 的样式：`position: absolute; top: 0; left: 0; width: 100%; height: 100%`，让视频层铺满整个 .video-js。
  4. 浏览器在绘制 `<video>` 时，会在**这个固定大小的框内**按比例缩放视频（多数浏览器对 video 的默认行为类似「保持比例、完整显示」），所以无论原片是竖屏还是横屏、分辨率多少，**都不会把容器撑大或撑小**。

因此：**「不受视频原尺寸影响」** = 容器尺寸由页面和 CSS 固定，视频只在给定框内缩放显示，而不是由视频尺寸反推容器大小。

### 3. 小结

| 层级           | 作用 |
|----------------|------|
| 页面外层 Box   | 提供至少 100vh 高、100% 宽的黑色全屏区域并居中内容。 |
| 页面内层 Box   | 限定「播放器可用区域」为 100%×100% 且 maxH=100vh，并通过 `sx` 强制 `.video-js` 填满该区域。 |
| VideoJsPlayer  | 只提供挂载点，不设尺寸；尺寸完全由父级和页面 sx 决定。 |
| .video-js      | 被页面 sx 设为 100%×100%、maxHeight 100vh，成为「固定大小的播放器框」。 |
| .vjs-tech      | 绝对定位填满 .video-js；视频画面在此框内由浏览器按比例缩放，实现「网页全屏且不随视频原尺寸变化」。 |

---

## 三、视频缩放方式（已实现）

项目中通过 `playerOverrides.css` 为 `.vjs-tech`（即 `<video>`）设置了 `object-fit: contain`，由 VideoJsPlayer 引入。这样视频会**始终在 .video-js 的固定框内等比缩放**，保证：

- 宽度不会超出容器（不会为铺满高度而把宽度撑出去）；
- 高度不会超出容器（不会为铺满宽度而把高度撑出去）；
- 横屏、竖屏、任意分辨率下都是「完整显示、留黑边」，与视频原尺寸无关。
