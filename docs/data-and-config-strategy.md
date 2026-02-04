# 数据与配置管理策略建议

## 路径与存储形式示意（本项目）

### 当前实现：所有路径基于 backend 目录

假设项目根目录为 `F:\NewVideoLib`，则 `BASE_DIR = F:\NewVideoLib\backend`。当前数据与配置的**实际路径**与**存储形式**如下。

| 用途 | 当前路径（示例） | 存储形式 | 说明 |
|------|------------------|----------|------|
| 应用配置 | `F:\NewVideoLib\backend\config.json` | **JSON 文件** | 媒体库路径 `media_roots`、可选 `ffmpeg_path` / `ffprobe_path`；可被环境变量 `CONFIG_FILE` 覆盖。 |
| 媒体库元数据 | `F:\NewVideoLib\backend\media.db` | **SQLite 单文件** | 媒体条目、类型、标签、收藏、任务以外的业务表。 |
| 演员库 | `F:\NewVideoLib\backend\actors.db` | **SQLite 单文件** | 演员名、简介、图片文件名等。 |
| 使用数据/任务 | `F:\NewVideoLib\backend\usage.db` | **SQLite 单文件** | 异步任务（如 ts_to_mp4）、播放进度、统计等。 |
| 演员图片等资源 | `F:\NewVideoLib\backend\data\actors\` | **目录 + 普通文件** | 图片文件（jpg/png 等），文件名由 DB 中 `image_filename` 引用。 |
| HLS 缓存（若启用） | `F:\NewVideoLib\backend\hls_cache\` | **目录** | 运行期缓存，已在 .gitignore。 |

**当前目录树示意（仅数据与配置相关）：**

```
F:\NewVideoLib\
├── backend\                    # 源码目录（BASE_DIR）
│   ├── config.json             # JSON 配置
│   ├── media.db                 # SQLite
│   ├── actors.db                # SQLite
│   ├── usage.db                 # SQLite
│   ├── data\                    # 资源根
│   │   └── actors\              # 演员图片目录
│   │       └── *.jpg, *.png …
│   └── hls_cache\               # 可选，运行期缓存
├── frontend\                    # 前端源码（与数据无关）
└── docs\
```

**存储形式小结：**

- **配置**：单个 JSON 文件，键值对（如 `media_roots` 数组、`ffmpeg_path` 字符串）。
- **结构化数据**：三个独立的 SQLite 数据库文件（`.db`），无外部依赖，由 SQLAlchemy 读写。
- **资源文件**：普通文件系统目录，内存放图片等二进制或静态资源，路径规则由代码约定（如 `resources/actors/<filename>`）。

---

## 当前状态（与策略的关系）

- **配置**：`backend/config.json`，路径可通过环境变量 `CONFIG_FILE` 覆盖。
- **数据库**：`backend/media.db`、`backend/actors.db`、`backend/usage.db`，路径在 config 模块中由 `BASE_DIR` 或数据根派生。
- **资源目录**：`backend/data/`（如 `data/actors` 演员图片）为旧布局；现为数据根下 `resources/actors`，基于 `DATA_ROOT`。
- **Git**：三个 `.db` 和 `backend/hls_cache/` 已忽略；`config.json` 若在仓库内且含本机路径，不利于多环境与协作。

问题在于：**代码与运行时数据/配置都挂在「backend 源码目录」下**，对打包、部署、多实例和备份都不友好。

---

## 是否算「最佳实践」

- **开发阶段**：把 DB 和 config 放在 backend 下很常见，改代码就能顺手改配置、看 DB，无需额外目录。
- **工程化 / 正式部署**：通常不把「可变的、与环境相关的」内容放在会被构建/覆盖的源码树下，否则：
  - 构建或重新部署会覆盖/忽略这些文件；
  - 备份、迁移「仅数据」时要单独排除代码目录；
  - 多实例或不同环境（开发/测试/生产）难以共用同一套代码、不同数据。

所以：**当前方式适合开发；若考虑 build、部署和未来资源文件增多，建议向「数据与代码分离」演进**。

---

## 推荐策略：单一「数据根」目录

### 核心思路

- 定义**一个**与「代码树」解耦的**数据根目录**（state / data root），所有**运行时产生的、用户相关的、可变的**内容都放在其下。
- 代码里**不再**用 `backend/` 作为 DB、config、资源文件的基准路径，而是用「数据根」派生路径。
- 数据根通过**环境变量**指定（如 `VIDEOLIB_DATA_DIR`），未设置时用**默认值**（开发友好）。

这样：

- 开发：不设环境变量时，默认数据根可设为 `backend/data` 或项目根下 `data`，行为与现在接近。
- 部署：设 `VIDEOLIB_DATA_DIR` 或使用默认（如 Windows `%LOCALAPPDATA%\ZakoData`），代码不变，仅换根。
- 构建：Docker/安装包只包含代码；数据根在宿主机挂载或由用户指定，升级应用不会覆盖数据。
- 未来新增资源（缓存、导出、统计文件等）一律放在数据根下子目录，规则统一。

### 建议的目录布局（数据根下）

采用数据根后，**同一套存储形式**（JSON、SQLite、目录）不变，只是**基准路径**从 `backend/` 改为 `VIDEOLIB_DATA_DIR`。

**推荐数据根目录树示意（Windows 示例 `%LOCALAPPDATA%\ZakoData`）：**

```
%LOCALAPPDATA%\ZakoData\          # 正式环境数据根（或 VIDEOLIB_DATA_DIR 覆盖）
├── config.json                    # JSON，同当前格式（media_roots、ffmpeg_path 等）
├── media.db                       # SQLite，媒体元数据
├── actors.db                      # SQLite，演员库
├── usage.db                       # SQLite，任务、播放进度、统计等
├── resources\                     # 资源根
│   └── actors\                   # 演员图片
│       └── *.jpg, *.png …
├── hls_cache\                     # 可选，HLS 运行期缓存
├── cache\                         # 未来：通用缓存
└── export\                        # 未来：导出文件等
```

**与当前路径的对应关系（存储形式不变）：**

| 用途 | 当前路径 | 推荐路径（设 VIDEOLIB_DATA_DIR 时） |
|------|----------|--------------------------------------|
| 配置 | `backend/config.json` | `<数据根>/config.json` |
| 媒体库 DB | `backend/media.db` | `<数据根>/media.db` |
| 演员库 DB | `backend/actors.db` | `<数据根>/actors.db` |
| 使用库 DB | `backend/usage.db`（旧） | `<数据根>/usage.db` |
| 演员图片目录 | `backend/data/actors/`（旧） | `<数据根>/resources/actors/` |

代码中只需将原先基于 `BASE_DIR` 的路径改为基于「数据根」的派生：

- `CONFIG_FILE` = 数据根 / `config.json`（或继续用 `CONFIG_FILE` 覆盖）。
- 三个 DB 的路径 = 数据根 / `media.db` 等。
- `RESOURCES_DIR` / `ACTOR_IMAGES_DIR` = 数据根 / `resources`、数据根 / `resources/actors`。
- 以后新资源同理：都从数据根派生，不写死到 `backend/`。

### 环境变量约定（统一在 `backend/env.py` 管理）

所有 backend 用到的环境变量在 **`backend/env.py`** 中集中定义与读取，便于查询和生成 `.env.example`。代码中通过 `from backend.env import env` 或 `get_*` 函数访问，避免散落 `os.environ.get`。

| 变量 | 含义 | 默认/说明 |
|------|------|------------|
| `VIDEOLIB_DATA_DIR` | 数据根目录覆盖 | 未设时由 FLASK_DEBUG 或平台默认（ZakoData）决定 |
| `FLASK_DEBUG` | 开发模式（1/true/yes 时数据根=项目根/data） | 未设或 0 时使用正式环境数据根 |
| `CONFIG_FILE` | config.json 路径覆盖 | 未设时为 `<数据根>/config.json` |
| `FFMPEG_PATH` | ffmpeg 可执行路径 | `"ffmpeg"` |
| `FFPROBE_PATH` | ffprobe 可执行路径 | `"ffprobe"` |
| `SECRET_KEY` | Flask 密钥 | `"dev-secret-change-me"` |
| `SCAN_ON_STARTUP` | 启动时是否扫描媒体库（1/0） | `"1"` |
| `HLS_SEGMENT_BYTES` | HLS 分片字节数 | `2097152` |
| `LOG_LEVEL` | 日志级别 | `"INFO"`（DEBUG/INFO/WARNING/ERROR） |

### 开发 vs 正式环境：数据根放在哪（你的需求）

**需求归纳**：正式环境数据根不要放在 backend 下，希望自动落在「用户路径」；开发时希望数据根与 backend、frontend **并列**，便于在 IDE 里直接查看。

这种设计**存在且是常见做法**，无需依赖 IDE 黑科技，在应用层用「环境区分 + 不同默认路径」即可实现。

| 环境 | 数据根位置 | 说明 |
|------|------------|------|
| **开发** | 项目根下的 `data/`（与 backend、frontend 并列） | 如 `F:\NewVideoLib\data\`，在 IDE 中与源码同树，方便检查 config、db、资源。 |
| **正式** | 操作系统约定的「每用户应用数据目录」 | 自动创建；Windows / macOS / Linux 各有惯例，见下表。 |

**正式环境下的「用户路径」（数据根目录名：ZakoData）：**

| 平台 | 目录 | 说明 |
|------|------|------|
| **Windows** | `%LOCALAPPDATA%\ZakoData` | 即 `C:\Users\<用户>\AppData\Local\ZakoData`，应用可写、不漫游。 |
| **macOS** | `~/Library/Application Support/ZakoData` | 系统约定应用数据目录。 |
| **Linux** | `$XDG_DATA_HOME/zakodata` 或 `~/.local/share/zakodata` | 遵循 XDG Base Directory；未设时用后者。 |

应用启动时若该目录不存在，应**自动创建**（含父级），无需用户手动建目录。

**在代码里如何选数据根（优先级）：**

1. **显式覆盖**：若设置了 `VIDEOLIB_DATA_DIR`，则一律使用该路径（开发/正式都可用）。
2. **开发模式**：若设置 **`FLASK_DEBUG=1`**（或 `true`/`yes`），则使用**项目根下的 `data`**，即与 backend、frontend 并列的目录（项目根 = `backend` 的父目录）。
3. **默认（正式）**：否则使用上述平台「用户应用数据目录」下的 **ZakoData**（Linux 为 `zakodata`），并自动创建。

这样：

- **开发**：在工程里设 **`FLASK_DEBUG=1`**（或 .env / launch 配置），数据根为 `F:\NewVideoLib\data\`，IDE 中与 backend、frontend 同级，直接检查。
- **正式**：不设 FLASK_DEBUG 或只设 `VIDEOLIB_DATA_DIR`，数据落在用户路径下的 ZakoData，不依赖项目目录。

**IDE 层面**：不需要额外操作。开发时数据根就在工作区内（项目根下的 `data/`），自然出现在资源管理器；若希望「在 IDE 里看到正式环境路径」，可在本机建一个指向 `%LOCALAPPDATA%\ZakoData` 的符号链接到项目下（如 `data_prod`），仅作查看用。

---

未设置 `VIDEOLIB_DATA_DIR` 时，通过 **`FLASK_DEBUG`** 或平台默认（ZakoData）决定数据根；见上。

### 与 build 的配合

- **Docker**：镜像内只复制代码；启动时挂载宿主机某目录为 `VIDEOLIB_DATA_DIR`，config 与 DB 均在挂载点，重启/重建容器数据不丢。
- **安装包 / 绿色版**：安装目录只放代码与可执行文件；首次运行若检测不到数据根，可提示用户选择目录或使用默认（如 ZakoData 用户目录）。
- **CI/测试**：设置 `VIDEOLIB_DATA_DIR=$WORKSPACE/test_data` 或 `FLASK_DEBUG=1`，与生产数据隔离。

### Git 与配置模板

- **不纳入 Git**：数据根下的 `config.json`、所有 `.db`、`resources/` 内容、缓存目录等（通过 `.gitignore` 忽略**数据根**或其中固定子目录名）。
- **纳入 Git**：`config.json.example` 或 `config.sample.json`，仅含示例/占位路径和注释，供新环境复制为 `config.json` 再改。
- 若数据根在 repo 内（如开发时项目根 `data/`），则 `.gitignore` 已忽略该数据根；旧布局下可忽略 `backend/data/`、`backend/*.db` 等。

---

## 实施状态与后续

**已实现**（见 `backend/config.py`、`backend/env.py` 与上文「开发 vs 正式环境」一节）：

- **环境变量**：在 **`backend/env.py`** 统一管理；所有读取通过 `env` 或 `get_*`，便于查询与维护。
- **数据根**：由 `_resolve_data_root()` 决定：`VIDEOLIB_DATA_DIR` > **`FLASK_DEBUG=1`**（项目根/data）> 平台用户目录 **ZakoData**（Linux 为 `zakodata`），自动创建。
- `CONFIG_FILE`、各 DB 路径、`RESOURCES_DIR`、`ACTOR_IMAGES_DIR` 均基于 `DATA_ROOT` 派生。
- 开发时设 **`FLASK_DEBUG=1`** 即可使用项目根下 `data/`，与 backend、frontend 并列；正式环境不设则使用 ZakoData。
- `.gitignore` 已包含项目根 `data/`，避免开发数据被提交。

**后续建议：**

- 在 README 或部署文档中说明：生产建议不设 `FLASK_DEBUG`（或设 `VIDEOLIB_DATA_DIR`），并给出目录布局和 `config.json.example` 用法。
- 新增环境变量时在 `backend/env.py` 增加常量与 getter，并在本文档上表补充一行。
- 新增资源（缓存、导出等）一律放在数据根下子目录，不再在 `backend/` 下新增与数据相关的路径。
