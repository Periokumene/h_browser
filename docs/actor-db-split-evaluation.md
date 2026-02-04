# 将 Actor 表分离为独立数据库的可行性评估

## 目标方案

- **actors.db**：仅存放 `actors` 表（name, intro, image_filename）
- **media.db**：保留 `media_items`、genres、tags、favorites 等，**并保留 code-actor 关联表**（即 `media_item_actors`），仅存储 (media_item_id, actor_name)，不再对 `actors` 表做外键引用

## 结论：可行，需做少量架构与代码调整

---

## 1. 当前结构简述

| 库/表 | 说明 |
|-------|------|
| media.db | media_items, actors, media_item_actors, media_item_genres, media_item_tags, favorites, genres, tags |
| media_item_actors | (media_item_id → media_items.id, actor_name → **actors.name**)，含 FK + CASCADE |

读写点：

- **扫描入库**：`media_service.create_or_update_item` 内 `get_or_create_actor(session, name)` + `item.actors.append(actor)`（同库、同一 session）
- **按演员筛列表**：`api.py` 中 `query.join(media_item_actors).filter(actor_name == actor)`，仅用 media.db
- **演员详情/图片**：`get_actor_info(session, name)` 查 Actor 并透过 `actor.items` 拿编号列表，需同时用到 actors 表与关联表

---

## 2. 分离后的设计

### 2.1 库与表职责

| 库 | 表 | 说明 |
|----|-----|------|
| **media.db** | media_items, media_item_genres, media_item_tags, favorites, genres, tags | 不变 |
| **media.db** | **media_item_actors** | 保留，但去掉对 `actors.name` 的 FK；仅存 (media_item_id, actor_name)，actor_name 为普通字符串 |
| **actors.db** | **actors** | name (PK), intro, image_filename |

这样「code–actor 索引」仍在 media.db（通过 media_item_actors + media_items），满足「索引保留在 media.db」的要求；演员的扩展信息（intro、图片）在 actors.db。

### 2.2 为何必须去掉 media_item_actors → actors 的外键

- SQLite 不支持跨库外键；若 actors 迁到另一库，media.db 中无法再声明 FK 到 actors。
- 去掉 FK 后，**应用层**保证：写入 `media_item_actors.actor_name` 时，在 actors.db 中已存在或同时创建对应演员即可。删除演员时由应用决定是否同步清理 media_item_actors 中的引用。

---

## 3. 对现有代码的影响

### 3.1 双库配置与 Session

- 增加 `actors.db` 路径与 `ACTORS_DATABASE_URL`（或等价配置）。
- 两套 engine / SessionLocal：`engine_media`、`engine_actors`；或使用 SQLAlchemy 的 `bind_key` / `__bind_key__` 将 `Actor` 绑定到 actors 的 engine，其余模型绑定 media。

### 3.2 模型与 ORM 关系

- **MediaItem.actors**：当前是跨表 relationship。分离后无法在同一 SQL 中 join 另一库，有两种做法：
  - **方案 A**：MediaItem 不再有 `relationship("Actor", ...)`；改为通过 `media_item_actors` 仅得到 `actor_name` 列表（仅查 media.db）。需要演员详情/图片时，用 name 列表再查 actors.db。
  - **方案 B**：保留一个「逻辑上的」actor 列表（仅名字），再提供辅助函数，按 name 列表从 actors.db 批量查 Actor，在应用层拼成「MediaItem + 完整 Actor 信息」。
- **Actor.items**：不再能作为跨库 relationship。`get_actor_info` 中「该演员的编号列表」改为：**先查 media.db**（media_item_actors + media_items），按 actor_name 得到 code 列表；**再查 actors.db** 取 intro、image_filename，在应用层组装返回。

### 3.3 扫描逻辑（media_service）

- 当前：同一 session 内 `get_or_create_actor(session, name)` 然后 `item.actors.append(actor)`。
- 分离后：
  1. 用 **actors 的 session** 做 get_or_create_actor，确保 actors.db 中有该 name。
  2. 用 **media 的 session** 维护 media_item_actors：先 `item.actors.clear()` 若当前是通过某种「仅名字」的接口维护；再插入 (item.id, name) 到 media_item_actors（或封装成「按名字列表设置 item 的演员」的接口，内部只写 media_item_actors）。
- 若仍希望用 ORM 风格，可在 media 侧为 MediaItem 做一个「仅名字」的只读视图或 property（从 media_item_actors 读），不映射到 Actor 表。

### 3.4 API 与路由

- **GET /api/items?actor=xxx**：仅查 media.db（join media_item_actors + media_items），**无需改动**。
- **GET /api/items/:code** 返回的 actors：可从 media_item_actors 取 actor_name 列表（media.db）；若需 intro/image，再按 name 列表查 actors.db（可选，看产品是否要在列表里带演员详情）。
- **GET /api/actors/<name>**、**GET /api/actors/<name>/image**：改为用 **actors 的 session** 查 Actor；编号列表改为用 **media 的 session** 查 media_item_actors + media_items，再拼进返回 payload。

### 3.5 数据一致性

- **无跨库 FK**：删除 actors 表中某条记录时，media_item_actors 中可能仍保留该 actor_name。可接受策略：保留冗余 name；展示时若 actors.db 无此人则只显示名字或「无详情」。
- 若希望「删演员即删关联」，需在应用层先删/更新 media_item_actors，再删 actors 记录。

---

## 4. 优点与风险

### 优点

- **媒体库与演员数据解耦**：可单独备份/迁移/恢复 actors（如共享演员库、只读副本）。
- **code–actor 索引仍在 media.db**：按演员筛列表、按编号查演员名均只动 media.db，性能与现在一致；仅「演员详情/图片」才访问 actors.db。
- **扩展性**：未来若演员数据来源增多（多库、远程 API），只需在 actors 侧扩展。

### 风险与代价

- **双写与事务**：扫描时需先写 actors 再写 media_item_actors；若不做分布式事务，可能出现「media 有关联、actors 无此人」的短暂不一致，可通过「先写 actors 再写 media」的顺序与重试降低概率。
- **代码路径变多**：所有「既要演员信息又要媒体信息」的地方都要显式访问两个 session 并组装，关系不再由 ORM 自动 join。

---

## 5. 实施建议（简要）

1. **配置**：增加 `ACTORS_DB_PATH` / `ACTORS_DATABASE_URL`，初始化 `engine_actors` 与 `SessionLocalActors`。
2. **模型**：Actor 与 actors 表只绑定 actors engine；media 的 metadata 中保留 media_item_actors 表定义，去掉 `ForeignKey("actors.name", ...)`，保留 `(media_item_id, actor_name)` 主键与对 media_items 的 FK。
3. **media_service**：扫描时用 actors session 做 get_or_create_actor；用 media session 更新 media_item_actors（按名字列表写入/清空）。
4. **get_actor_info**：actors session 取 intro/image；media session 查 media_item_actors + media_items 得到 codes，合并返回。
5. **列表/详情 API**：按上面 3.4 调整；若详情页不需要演员 intro/图，可继续只从 media_item_actors 取名字，零额外成本。

整体上，**将 actor 表分离到独立库、code–actor 索引保留在 media.db 的方案可行**，改动集中在配置、双 session 使用方式以及「演员详情」的组装逻辑，列表与筛选可保持单库查询。
