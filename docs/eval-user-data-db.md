# 将 Task 迁入独立「使用库」评估

> **现状**：已实现，库文件命名为 **`usage.db`**（使用库），代码中为 `USAGE_DB_PATH`、`session_scope_usage()`、`UsageBase` 等。下文为评估时的设计描述，命名已统一为 usage。

## 目标

- 将 Task 表从 media.db 迁出，与未来可能的「播放进度/统计数据」统一放入新库，保持 media.db 只存媒体元数据（数据纯粹性）。
- 新库命名为 **`usage.db`**（使用库）。

---

## 开发成本

### 1. config.py

- 新增常量：`USAGE_DB_PATH = DATA_ROOT / "usage.db"`，`USAGE_DATABASE_URL = f"sqlite:///{USAGE_DB_PATH}"`。
- 在 `Config` 类中增加 `USAGE_DB_PATH` / `USAGE_DATABASE_URL` 属性。

**量级**：约 5 分钟。

### 2. models.py

- 新增 engine / SessionLocal：仿照 `engine_actors` / `SessionLocalActors`，为 `USAGE_DATABASE_URL` 创建 `engine_usage`、`SessionLocalUsage`，SQLite 时 `connect_args={"check_same_thread": False}`。
- 新增 `UsageBase = declarative_base()`，将 `Task` 从 `Base` 改为继承 `UsageBase`，表名仍为 `"tasks"`；`TimestampMixin` 可复制一份或从现有复用（仅含 created_at/updated_at 列定义）。
- `init_db()`：增加 `UsageBase.metadata.create_all(bind=engine_usage)`。
- 新增 `session_scope_usage()` 上下文管理器（同 `session_actors_scope` 写法）。
- 所有任务 CRUD 的 **session 参数类型** 仍为 `Session`，调用方使用 `session_scope_usage()`。

**量级**：约 20–30 分钟。

### 3. task_runner.py

- 将全部任务相关 session 改为 `session_scope_usage()`（约 8 处），用于：消费线程事件更新、`_run_task` 加载任务、`start()` 重置 running、`submit_task`、`cancel_task`、`list_tasks`、`get_task`、`check_duplicate_ts_to_mp4`。
- **唯一逻辑变更**：消费线程中当 `event.get("status") == "success"` 时，拆库后需：
  - 先用 `session_scope_usage()` 更新 Task 为 success 并 commit；
  - 再单独用 `session_scope()` 根据 payload 中的 code 更新 MediaItem.has_mp4 并 commit。
- 若希望「先写 media 再写 task」也可，但推荐「先 task 后 media」：任务状态先落库，再同步媒体状态；media 更新失败时至少任务记录正确，便于后续补偿。

**量级**：约 15–20 分钟。

### 4. 其他

- **routes/api.py**：无直接 DB 访问，仅调 task_runner，无需修改。
- **services/ffmpeg.py**：仅使用 `session_scope()` 调用 `get_video_path_for_item`（只读 media），无需修改。
- **测试**：若有依赖「Task 在 media.db」的测试，需改为使用 usage 的 session 或 mock；无则无需改。
- **迁移**：若已有线上 media.db 且存在 tasks 表数据需要保留，需编写一次性脚本：从 media.db 的 tasks 表 SELECT 出数据，INSERT 到 usage.db 的 tasks 表；并在确认无误后从 media.db 中 DROP tasks 表（可选）。新部署可直接使用空 usage.db，无需迁移。

**总开发成本**：约 **1–1.5 小时**（不含迁移脚本与测试扩展）。若包含迁移脚本与回归测试，约 **2 小时**。

---

## 优点

| 点 | 说明 |
|----|------|
| **media.db 数据纯粹** | 仅保留媒体元数据（MediaItem、Genre、Tag、Favorite、media_item_actors），任务与未来行为/统计均不混入，符合「媒体库」语义。 |
| **职责清晰、易扩展** | 用户行为库可独立增加表（如播放记录、收藏时间、统计汇总等），与媒体库解耦，schema 演进互不影响。 |
| **写锁隔离** | 任务中心频繁更新 Task 时不再与媒体库的扫描、收藏等写操作争同一 SQLite 锁，降低 "database is locked" 概率。 |
| **备份与清理独立** | 可单独备份/归档/清理 usage.db（如只保留近期任务），或仅复制 media.db 做「纯净媒体库」备份。 |
| **与 actors.db 风格一致** | 项目已存在「媒体库 + 演员库」双库，再增加「用户行为库」结构清晰，维护心智一致。 |

---

## 风险与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| **跨库无事务** | 「任务成功」与「更新 MediaItem.has_mp4」分属两库，无法在一个事务中原子提交。 | 先提交 Task 为 success，再提交 MediaItem；若第二步失败，记录日志并可选：重试 1–2 次、或定时/手动任务根据「status=success 且 task_type=ts_to_mp4」但 media 未更新的记录补写 has_mp4。 |
| **成功但 has_mp4 未更新** | 极端情况下 Task 已 success，media 更新失败或进程崩溃，导致界面仍显示「无 MP4」。 | 同上：补偿逻辑（重试或后台修复任务）；或在前端/API 层：若本地已存在 `{code}.mp4` 文件，可结合文件系统状态做显示修正（可选）。 |
| **多一个 DB 文件** | 部署与备份清单多一项 usage.db。 | 文档中说明三库职责；备份脚本同时包含 media.db、actors.db、usage.db。 |
| **迁移与历史数据** | 若已有 tasks 表数据，需一次性迁移。 | 提供迁移脚本，在低峰执行；或新环境直接使用空 usage.db，旧任务可放弃（按产品决定）。 |

---

## 小结

- **开发成本**：约 1–2 小时，改动集中在 models（新 engine/session/UsageBase + Task 挪库）、task_runner（全部改用 session_scope_usage + 成功时「先 Task 后 MediaItem」两段提交）。
- **优点**：media 数据纯粹、行为数据易扩展、写锁隔离、备份/清理独立、与现有双库风格一致。
- **主要风险**：跨库无法原子提交，需接受「先更新任务、再更新媒体」的顺序，并对 media 更新失败做日志与可选补偿，整体可控。

若采纳，建议在 task_runner 消费线程的「success」分支中显式写清两段 commit 的顺序与失败处理（日志 + 可选重试），便于后续维护。
