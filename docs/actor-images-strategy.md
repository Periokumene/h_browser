# 演员图片功能：策略与框架说明

## 1. 目标与约束

- **目标**：在扫描完成后为库内演员拉取、缓存头像，并在前端（演员侧栏、详情页演员列表）展示。
- **数据源**：当前实现采用「指定 URL 的头像仓库」：需提供 `Filetree.json` 与 `Content` 目录结构（与常见 Filetree 格式兼容）。
- **约束**：功能需**高度模块化**，便于日后剥离为独立包/插件或更换数据源。

## 2. 架构概览

### 2.1 模块划分

| 层级 | 位置 | 职责 |
|------|------|------|
| **接口** | `backend/services/actor_images/interface.py` | 定义 `ActorImageProvider` 抽象基类：`resolve(actor_name, cache_dir)`、可选 `update_all(...)`。与具体图源无关。 |
| **实现** | `backend/services/actor_images/avatars_provider.py` | 基于配置 URL 的 Filetree.json 与 Content 的实现：拉取索引、按「最新 + 质量优先」选图、下载到本地。 |
| **入口** | `backend/services/actor_images/__init__.py` | 根据 `config.avatar_source_url` 选择提供方、暴露 `sync_actor_images(session_actors)`，供扫描流程调用。 |
| **配置** | `config.avatar_source_url`（config.json） | 头像仓库根 URL；为空则禁用同步。 |

### 2.2 数据流

1. **扫描完成**：`POST /api/scan` 或启动时扫描 → `scan_media()` → `sync_actor_images(db_actors)` → 拉取 Filetree、为库内所有演员解析并下载图片到 `data/resources/avatars/`。
2. **前端展示**：
   - 演员侧栏（ActorInfo）：`GET /api/actors/<name>` 返回 `image_url`（指向 `/api/actors/<name>/image`）。
   - 详情页演员列表：`GET /api/items/<code>` 的 `metadata.actors[].thumb` 优先使用库内缓存图，若无则回退 NFO 中的 thumb。
3. **图片服务**：`GET /api/actors/<path:name>/image` 从 `AVATARS_DIR` 按演员名解析文件并返回。

### 2.3 选图策略

- **索引**：解析 Filetree.json 的 `Content`，按「显示名」建索引；同一演员可能对应多组、多文件（含 `-1`、`-2` 等变体）。
- **候选**：按演员名精确匹配逻辑名（去掉 `.jpg`），并匹配 `姓名-1`、`姓名-2` 等变体。
- **择优**：在候选中按 **时间戳 t 降序**（最新优先），再按 **质量序** 排序，取第一张。
- **AI-Fix**：仓库中部分条目为 `AI-Fix-xxx.jpg`。可通过 `use_ai_fix=True`（默认）使用优化图，或 `False` 仅用原始图。

## 3. 配置

- **avatar_source_url**（config.json，或 PUT /api/config）：头像仓库根 URL。须能访问 `{url}/Filetree.json` 与 `{url}/Content/...`。留空或未配置时，不进行头像同步。

## 4. 文件与存储

- **缓存目录**：由数据根派生，即 `DATA_ROOT/resources/avatars/`。开发时数据根为项目根下 `data/`。
- **本地文件名**：`safe_avatar_basename(actor_name)` + 扩展名（.jpg/.png），避免路径穿越与非法字符。

## 5. 与主程序解耦方式

- **接口唯一依赖**：业务层只依赖 `ActorImageProvider` 的 `resolve` / `update_all` 和 `sync_actor_images(session_actors)`，不依赖任何具体图源或 URL 名称。
- **配置外置**：通过 config 的 `avatar_source_url` 控制；为空则跳过同步。
- **可选依赖**：当前实现使用 `requests`，已在 `backend/requirements.txt` 中声明；若完全移除该功能，可删除 `actor_images` 包及对 `sync_actor_images` 的调用。

## 6. API 行为小结

| 接口 | 说明 |
|------|------|
| `POST /api/scan` | 扫描完成后若已配置 `avatar_source_url`，则提交异步演员头像同步任务。 |
| `GET /api/actors/<name>` | 返回 `image_url`（当有缓存时指向 `/api/actors/<name>/image`）。 |
| `GET /api/actors/<name>/image` | 从 `AVATARS_DIR` 按演员名解析并返回头像文件。 |
| `GET /api/items/<code>` | `metadata.actors[].thumb` 优先使用库内缓存图，若无则用 NFO 的 thumb。 |

## 7. 依赖与版本

- Python 依赖：`requests>=2.28`（仅当前头像提供方实现使用）。
- 无新增前端依赖。

---

以上为演员图片功能的策略与框架说明，便于后续查阅、扩展或剥离该能力。
