# 播放器模块 (player)

统一使用 **Video.js** 作为唯一播放器；HLS（m3u8）由 **hls.js** 在 Video.js 内部接管同一 video 元素。

## 文件职责

| 文件 | 职责 |
|------|------|
| `VideoJsPlayer.tsx` | 唯一播放器组件：创建 Video.js 实例，按源类型走 VHS 或 hlsIntegration |
| `spriteThumbnails/` | 自研进度条缩略图插件（VTT + 雪碧图），符合 Video.js 扩展最佳实践 |
| `types.ts` | 播放源类型、HLS 判定、错误数据结构 |
| `constants.ts` | Video.js 默认配置 |
| `hlsIntegration.ts` | hls.js 的创建、绑定、错误恢复与销毁，与 VHS 解耦 |
| `buildPlaySources.ts` | 根据条目与后端 API 约定生成 `sources` / `poster`，供 Play 页使用 |
| `testPanel/` | 测试侧边面板：React + Chakra 悬浮面板，鼠标靠近右侧自动展开；另含纯 Video.js 版 TestPanel/TestPanelButton 供参考，见 `testPanel/VIDEOJS_ARCHITECTURE.md` |

## 扩展与维护

- **新增插件（字幕、播放列表等）**：在 `VideoJsPlayer.tsx` 的 `useEffect` 中在 `player` 创建后注册，并在 cleanup 中注销。
- **更换 HLS 实现**：只改 `hlsIntegration.ts`，对外仍提供 `createAndAttachHls(mediaEl, m3u8Url, callbacks)` 与 `destroy()`。
- **后端 URL 变更**：改 `buildPlaySources.ts` 中的路径与 `types` 中的 MIME 常量即可。

## 依赖

- `video.js`：UI 与控件
- `hls.js`：仅用于 HLS（m3u8）加载，与后端 `/api/stream/<code>/playlist.m3u8` 及 `segment/<i>` 对应

## 进度条缩略图（spriteThumbnails）

自研插件，支持 WebVTT + 雪碧图格式（`#xywh=x,y,w,h`）。无后端 URL 时使用占位符演示。

- `player.spriteThumbnails({ src: vttUrl })`：从 URL 加载 VTT
- `player.spriteThumbnails({ vttContent, spriteBaseUrl })`：内联模式（占位/测试）
