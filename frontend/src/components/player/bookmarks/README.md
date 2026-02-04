# 书签功能 (bookmarks)

## 插件 vs 直接代码

**采用插件方式**，理由：

1. **与项目一致**：spriteThumbnails 已采用 Video.js 插件模式，书签沿用可保持架构统一
2. **DOM 访问**：需在 `.vjs-progress-holder` 内挂载 marker，插件可直接操作 Video.js 内部 DOM
3. **生命周期**：随 player dispose 自动清理，无泄漏
4. **动态更新**：支持 `updateBookmarks(bookmarks)` 实时刷新进度条标记
5. **参考 videojs-markers**：思路类似，自建以贴合项目（时间戳 + 注释、主题色、无 break overlay）

若用直接代码：需在 React 中 overlay 进度条，要监听 resize、精确计算位置，复杂度高且易与 Video.js 布局冲突。

## 使用方式

```ts
// 初始化（player.ready 时）
player.bookmarks({ bookmarks: [] });

// 更新书签
const instance = player.bookmarks?.({ bookmarks: [] });
instance?.updateBookmarks(bookmarks);
```

## API（与后端通信）

- `fetchBookmarks(videoCode)`：GET 书签列表
- `addBookmark(videoCode, time, comment)`：POST 新增书签
- `updateBookmark(videoCode, bookmarkId, { comment })`：PATCH 更新书签注释
- `deleteBookmark(videoCode, bookmarkId)`：DELETE 删除书签

后端：`/api/items/<code>/bookmarks`，书签存于 media.db，id 以字符串形式返回。

## 稳定性与可维护性（与 Video.js / 前后端最佳实践对齐）

- **插件生命周期**：`dispose()` 中清除重试定时器、置空 DOM 引用；`renderMarkers` / `updatePositions` / `updateBookmarks` 入口处检查 `player.isDisposed()`，避免 dispose 后误触 DOM。
- **重试可取消**：进度条未就绪时的 `setupDom` 重试使用可存储的 `retryTimeoutId`，dispose 时 `clearTimeout`，避免组件销毁后仍执行回调。
- **请求竞态**：BookmarksTab 拉取书签时用 `cancelled` + `videoCodeRef.current === videoCode` 丢弃过期响应，避免切换视频后旧请求覆盖新列表。
- **错误与回滚**：拉取失败 toasts「加载书签失败」；添加/保存失败 toasts 并保持或恢复状态；删除采用乐观更新，失败时恢复原列表并 toasts。
- **后端**：书签 `comment` 长度上限 2000 字符，防止滥用与存储膨胀。
