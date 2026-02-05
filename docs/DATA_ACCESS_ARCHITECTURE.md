# 数据访问架构说明

本文档说明媒体库、数据库与元数据的统一数据访问层设计，便于未来扩展缓存、增量同步、数据一致性等功能。

---

## 一、架构概览

### 1.1 分层职责

```
┌─────────────────────────────────────────────────────────┐
│  API 层 (routes/api.py)                                  │
│  - 处理 HTTP 请求/响应                                    │
│  - 调用 media_service 获取数据                           │
└────────────────────┬──────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────┐
│  统一数据访问层 (services/media_service.py)                │
│  - 封装数据库操作（MediaItem、Genre、Tag CRUD）            │
│  - 封装磁盘操作（NFO 解析、视频查找、海报路径）             │
│  - 提供统一接口：get_item_by_code、sync_item_from_disk 等  │
└────────────────────┬──────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  models.py  │ │ metadata.py │ │  scanner.py │
│  数据库模型  │ │  NFO 解析   │ │  扫描逻辑   │
└─────────────┘ └─────────────┘ └─────────────┘
```

### 1.2 设计原则

- **单一入口**：所有媒体数据的读写统一通过 `media_service`，避免在 API、scanner 中直接操作数据库或磁盘。
- **职责分离**：
  - `metadata.py`：纯 NFO 解析，不涉及数据库。
  - `media_service.py`：统一数据访问，协调数据库与磁盘。
  - `scanner.py`：扫描流程编排，调用 `media_service` 同步。
  - `api.py`：HTTP 处理，调用 `media_service` 查询。
- **便于扩展**：未来添加缓存、增量同步、数据校验时，只需修改 `media_service`，上层代码无需改动。

---

## 二、核心模块说明

### 2.1 `services/media_service.py`（统一数据访问层）

**职责**：提供统一的接口访问媒体数据，封装数据库与磁盘操作。

#### 磁盘操作函数

| 函数 | 说明 |
|------|------|
| `find_video_file(nfo_dir, code)` | 在同目录查找 `{code}.mp4` 或 `{code}.ts` |
| `get_file_info(file_path)` | 获取文件的 mtime 和 size |
| `load_metadata_from_nfo(nfo_path)` | 从 NFO 文件解析元数据（调用 `metadata.parse_nfo`） |

#### 数据库操作函数

| 函数 | 说明 |
|------|------|
| `get_or_create_genre(session, name)` | 获取或创建 Genre |
| `get_or_create_tag(session, name)` | 获取或创建 Tag |
| `get_item_by_code(session, code)` | 从数据库根据番号获取 MediaItem |
| `create_or_update_item(...)` | 创建或更新 MediaItem，同步 genres/tags |

#### 统一元数据获取

| 函数 | 说明 |
|------|------|
| `get_item_full_metadata(session, code)` | 返回完整元数据字典：`{db_item, nfo_metadata, nfo_path, video_path}` |
| `get_poster_path_for_item(session, code)` | 获取海报路径（从 DB 读取 NFO 路径，解析海报） |
| `get_fanart_path_for_item(session, code)` | 获取 fanart 路径 |
| `get_thumb_path_for_item(session, code)` | 获取 thumb 路径 |

#### 磁盘 → 数据库同步

| 函数 | 说明 |
|------|------|
| `sync_item_from_disk(session, code, nfo_path, ...)` | 从磁盘同步单个媒体条目到数据库（查找视频、解析 NFO、更新 DB） |

---

### 2.2 `services/metadata.py`（NFO 解析）

**职责**：纯 NFO 文件解析，不涉及数据库。

- `parse_nfo(nfo_path)`：解析 NFO，返回 `VideoMetadata` 对象。
- `get_poster_path(...)`、`get_fanart_path(...)`、`get_thumb_path(...)`：海报/缩略图路径解析（基于 NFO 路径与元数据）。

**不变**：该模块保持纯函数式，不依赖数据库，便于测试与复用。

---

### 2.3 `scanner.py`（扫描流程）

**职责**：遍历媒体目录，发现 NFO 文件，调用 `media_service.sync_item_from_disk` 同步到数据库。

**重构后**：
- 不再直接操作数据库（`MediaItem`、`Genre`、`Tag`）。
- 不再直接解析 NFO（不再调用 `parse_nfo`）。
- 不再直接查找视频文件。
- **仅负责**：目录遍历、模板文件过滤、重复番号去重、调用 `sync_item_from_disk`。

**示例**：
```python
# 旧代码（分散在各处）
item = session.query(MediaItem).filter(...).one_or_none()
metadata = parse_nfo(nfo_path)
video_path = _find_video_for_code(...)
# ... 大量数据库操作

# 新代码（统一调用）
sync_item_from_disk(session, code, nfo_path, last_scanned_at=now)
```

---

### 2.4 `routes/api.py`（API 路由）

**职责**：处理 HTTP 请求，调用 `media_service` 获取数据，返回 JSON。

**重构后**：
- `get_item(code)`：使用 `get_item_full_metadata(db, code)` 获取完整元数据。
- `get_item_poster(code)`：使用 `get_poster_path_for_item(db, code)` 获取海报路径。
- `stream_video(code)`：使用 `get_item_by_code(db, code)` 获取 MediaItem。
- `list_items()`：仍直接查询 `MediaItem`（列表查询逻辑复杂，暂不封装）。

---

## 三、数据流向

### 3.1 扫描流程（磁盘 → 数据库）

```
scanner.py
  └─> 遍历目录，发现 NFO
      └─> media_service.sync_item_from_disk(code, nfo_path)
          ├─> find_video_file(nfo_dir, code)          # 磁盘：查找视频
          ├─> load_metadata_from_nfo(nfo_path)        # 磁盘：解析 NFO
          ├─> get_file_info(video_path or nfo_path)   # 磁盘：文件信息
          └─> create_or_update_item(...)              # 数据库：写入/更新
              ├─> get_or_create_genre/tag(...)        # 数据库：Genre/Tag
              └─> item.genres/tags.append(...)         # 数据库：关联
```

### 3.2 查询流程（数据库 + 磁盘）

```
api.py (get_item)
  └─> media_service.get_item_full_metadata(db, code)
      ├─> get_item_by_code(db, code)                  # 数据库：读取 MediaItem
      └─> load_metadata_from_nfo(nfo_path)            # 磁盘：解析 NFO（如果需要）
          └─> metadata.parse_nfo(nfo_path)            # metadata.py：解析
```

### 3.3 海报路径获取

```
api.py (get_item_poster)
  └─> media_service.get_poster_path_for_item(db, code)
      ├─> get_item_full_metadata(db, code)            # 获取完整元数据
      └─> metadata.get_poster_path(nfo_path, code, metadata)  # 解析路径
```

---

## 四、未来扩展点

### 4.1 缓存层

在 `media_service` 中添加缓存逻辑：

```python
def get_item_full_metadata(session, code):
    # 1. 先查缓存（Redis/内存）
    cached = cache.get(f"item:{code}")
    if cached:
        return cached
    
    # 2. 查数据库 + NFO
    full = _load_from_db_and_nfo(session, code)
    
    # 3. 写入缓存
    cache.set(f"item:{code}", full, ttl=3600)
    return full
```

### 4.2 增量同步

在 `sync_item_from_disk` 中添加增量判断：

```python
def sync_item_from_disk(session, code, nfo_path, ...):
    item = get_item_by_code(session, code)
    
    # 增量：比较 file_mtime，未变更则跳过
    if item and item.file_mtime:
        current_mtime, _ = get_file_info(nfo_path)
        if current_mtime == item.file_mtime:
            return item  # 无需更新
    
    # 继续同步...
```

### 4.3 数据校验与修复

在 `media_service` 中添加校验函数：

```python
def validate_item_consistency(session, code):
    """校验数据库与磁盘的一致性。"""
    item = get_item_by_code(session, code)
    if not item:
        return {"status": "missing_in_db"}
    
    nfo_path = Path(item.nfo_path)
    if not nfo_path.exists():
        return {"status": "nfo_missing"}
    
    # 检查视频文件是否存在
    # 检查海报是否存在
    # ...
```

### 4.4 批量操作

添加批量同步函数：

```python
def sync_batch_from_disk(session, codes_and_paths: list[tuple[str, Path]]):
    """批量同步多个条目。"""
    results = []
    for code, nfo_path in codes_and_paths:
        try:
            item = sync_item_from_disk(session, code, nfo_path)
            results.append({"code": code, "status": "ok", "item": item})
        except Exception as e:
            results.append({"code": code, "status": "error", "error": str(e)})
    return results
```

---

## 五、迁移检查清单

重构完成后，确保：

- [x] `scanner.py` 不再直接操作 `MediaItem`、`Genre`、`Tag`。
- [x] `scanner.py` 不再直接调用 `parse_nfo`。
- [x] `api.py` 的 `get_item`、`get_item_poster`、`stream_video` 使用 `media_service`。
- [x] `api.py` 的 `list_items` 仍直接查询（列表查询复杂，暂不封装）。
- [x] 所有数据库操作通过 `media_service` 或明确的查询函数。
- [x] 所有 NFO 解析通过 `metadata.parse_nfo` 或 `media_service.load_metadata_from_nfo`。

---

## 六、文件与模块一览

| 文件 | 职责 | 依赖 |
|------|------|------|
| `services/media_service.py` | 统一数据访问层 | `models`, `metadata` |
| `services/metadata.py` | NFO 解析（纯函数） | 无（仅标准库） |
| `scanner.py` | 扫描流程编排 | `media_service` |
| `routes/api.py` | HTTP API | `media_service`, `models`（列表查询） |
| `models.py` | 数据库模型定义 | SQLAlchemy |

---

## 七、使用示例

### 7.1 扫描单个文件

```python
from backend.services.media_service import sync_item_from_disk
from backend.models import get_session

db = get_session()
try:
    item = sync_item_from_disk(db, "MOVIE-001", Path("/path/to/MOVIE-001.nfo"))
    db.commit()
finally:
    db.close()
```

### 7.2 获取完整元数据

```python
from backend.services.media_service import get_item_full_metadata
from backend.models import get_session

db = get_session()
try:
    full = get_item_full_metadata(db, "MOVIE-001")
    if full:
        db_item = full["db_item"]        # MediaItem
        nfo_metadata = full["nfo_metadata"]  # VideoMetadata
        nfo_path = full["nfo_path"]      # Path
finally:
    db.close()
```

### 7.3 获取海报路径

```python
from backend.services.media_service import get_poster_path_for_item
from backend.models import get_session

db = get_session()
try:
    poster_path = get_poster_path_for_item(db, "MOVIE-001")
    if poster_path:
        # 使用 poster_path
        pass
finally:
    db.close()
```

---

## 八、注意事项

1. **Session 管理**：`media_service` 的函数接受 `session` 参数，调用方负责创建与关闭 session（通过 `get_session()` 和 `db.close()`）。
2. **事务**：`create_or_update_item` 和 `sync_item_from_disk` 会 `flush` 但不会 `commit`，调用方（如 `scanner.py`）负责 `commit`。
3. **错误处理**：`media_service` 的函数可能抛出异常，调用方应捕获并记录。
4. **性能**：未来可添加批量操作、缓存、增量同步等优化，但接口保持不变。
