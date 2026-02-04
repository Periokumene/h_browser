# 书签功能：后端方案与前后端对接说明

## 一、当前书签功能特点（前端）

### 1. 数据模型

| 字段   | 类型   | 说明 |
|--------|--------|------|
| `id`   | string | 唯一标识，前端添加时由后端生成并返回 |
| `time` | number | 时间点（秒，浮点或整型） |
| `comment` | string | 注释，可编辑，可为「未命名书签」 |

- 书签**按视频维度**组织：同一 `videoCode`（编号）下多条书签，列表按 `time` 升序展示。
- 前端不区分用户：当前无登录，书签视为「当前设备/当前库」下该视频的列表。

### 2. 前端已具备的与后端通信能力

所有能力均集中在 **`bookmarks/api.ts`**，通过四个异步函数与后端交互：

| 能力 | 函数签名 | 调用时机 | 期望后端行为 |
|------|----------|----------|--------------|
| **拉取列表** | `fetchBookmarks(videoCode: string): Promise<Bookmark[]>` | 进入书签 Tab、切换视频（videoCode 变化）时 | 返回该视频下全部书签，按 time 升序 |
| **添加** | `addBookmark(videoCode, time, comment): Promise<Bookmark>` | 用户点击「在当前时间添加书签」 | 持久化一条书签，返回带 `id` 的完整 Bookmark |
| **更新** | `updateBookmark(videoCode, bookmarkId, { comment }): Promise<void>` | 用户编辑 comment 后失焦或回车 | 仅更新该书签的 comment |
| **删除** | `deleteBookmark(videoCode, bookmarkId): Promise<void>` | 用户点击某条书签的删除按钮 | 删除该书签 |

- **videoCode**：即编号 `code`（如 `ABC-123`），来自播放页路由 `:code`，经 `VideoJsPlayer` → `FeaturePanelChakra` → `BookmarksTab` 传入。
- 前端使用 **axios**（`apiClient`），baseURL 为 `VITE_API_BASE_URL`（默认 `http://localhost:5000`），与现有 `/api/items/...` 等接口同源。
- 前端会**先更新本地 state**（如增删改列表），再调用上述接口；若后端返回错误，前端目前未做统一 toast，可后续在 `api.ts` 或调用处加错误处理。

### 3. 前端未做的（可留给后端或后续迭代）

- **鉴权**：无 token，不传用户信息；书签可先做成「按 code 维度的全局列表」或「单用户/单设备」。
- **分页**：列表一次拉全，书签数量通常不大；若后端限制单条视频书签上限，可文档约定并在前端加提示。
- **冲突与乐观更新**：无多端同步；若后端要支持多设备，可后续加版本号或 last_updated 做冲突检测。

---

## 二、后端方案建议

### 1. 存储与库选择

- **建议库**：**usage.db**（与现有 Task 等「使用数据」一致，便于扩展播放进度、统计等）。
- **表**：新增 `bookmarks`，不依赖 media.db 的 MediaItem 主键，仅用 **编号 code** 做逻辑关联，避免跨库 FK。

**表结构建议：**

```text
bookmarks (usage.db)
  id          INTEGER PRIMARY KEY AUTOINCREMENT  -- 或 UUID 字符串，与前端 id 一致
  code        VARCHAR(255) NOT NULL               -- 编号，与 /api/items/<code> 一致
  time_seconds REAL NOT NULL                     -- 时间点（秒）
  comment     TEXT NOT NULL DEFAULT ''           -- 注释
  created_at  DATETIME
  updated_at  DATETIME
  UNIQUE(code, id) 或仅 id 为主键；按 code 建索引便于按视频查
```

- `id`：后端生成，返回给前端；若用整型，前端可约定转为 string 使用（与当前 `Bookmark.id` 一致）。
- 可选：对 `(code, time_seconds)` 做唯一约束，避免同一秒重复添加；若允许，可不加。

### 2. API 设计（REST，与现有 /api/items/<code>/... 风格一致）

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| GET | `/api/items/<code>/bookmarks` | - | `200` `{ "bookmarks": [ { "id", "time", "comment" }, ... ] }` | 按 time 升序返回该书签列表 |
| POST | `/api/items/<code>/bookmarks` | `{ "time": number, "comment": string }` | `201` `{ "id", "time", "comment" }` | 新增一条，返回完整书签 |
| PATCH | `/api/items/<code>/bookmarks/<bookmark_id>` | `{ "comment": string }` | `200` 或 `204` | 仅更新 comment |
| DELETE | `/api/items/<code>/bookmarks/<bookmark_id>` | - | `200` 或 `204` | 删除该书签 |

- **code**：路径参数，与前端 `videoCode` 一致。
- **bookmark_id**：路径参数，对应前端 `Bookmark.id`（建议与后端主键一致，如整型则前端用 `String(id)`）。
- 若条目不存在：GET 可返回空数组；POST/PATCH/DELETE 可校验 code 是否在 media 中存在再操作（可选），或仅按 code 存书签不校验（实现简单）。

### 3. 错误与边界

- **404**：code 不存在（若做校验）、或 bookmark_id 不存在 / 不属于该 code。
- **400**：缺少 `time`/`comment`、类型错误、comment 过长等。
- **可选**：单视频书签数量上限（如 200 条），超过时 POST 返回 400 或 409，前端可提示。

---

## 三、前端对接后端时需要改动的点

1. **`bookmarks/api.ts`**  
   - 将 `fetchBookmarks` 改为 `GET /api/items/${code}/bookmarks`，解析 `res.data.bookmarks`（或 `res.data` 若后端直接返回数组）。  
   - 将 `addBookmark` 改为 `POST /api/items/${code}/bookmarks`，body `{ time, comment }`，返回 `res.data` 作为 `Bookmark`（需含 `id`）。  
   - 将 `updateBookmark` 改为 `PATCH /api/items/${code}/bookmarks/${bookmarkId}`，body `{ comment }`。  
   - 将 `deleteBookmark` 改为 `DELETE /api/items/${code}/bookmarks/${bookmarkId}`。  
   - 使用项目已有的 `apiClient`（`src/api/client.ts`），与其它接口一致；错误时可用 `toast` 或统一错误处理。

2. **类型**  
   - 保持 `Bookmark` 的 `id: string`；若后端返回整型 `id`，在 api 层做 `id: String(res.data.id)` 即可。

3. **调用方**  
   - `BookmarksTab` 等已按 `videoCode` 和上述四个函数调用，**无需改组件**，只改 api 实现即可。

---

## 四、小结

| 维度 | 说明 |
|------|------|
| **前端能力** | 四个异步接口：拉取列表、添加、更新 comment、删除；入参为 videoCode（及 bookmarkId、time、comment）；使用 axios + 现有 baseURL。 |
| **后端建议** | usage.db 新表 `bookmarks`，字段：id、code、time_seconds、comment、时间戳；REST：GET/POST/PATCH/DELETE `/api/items/<code>/bookmarks[/<id>]`。 |
| **对接** | 仅需在 `bookmarks/api.ts` 中把桩实现替换为真实请求，并统一错误处理与 `id` 类型即可。 |

按此方案实现后端后，前端只需替换 api 层即可完成书签的持久化与多端（若后续加用户）扩展基础。
