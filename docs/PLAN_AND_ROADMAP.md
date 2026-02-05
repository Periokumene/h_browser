# 个人影音库 — 计划与路线图

## 一、项目概述

个人使用的影音库系统，前后端分离：前端 React + TypeScript + Chakra UI，后端 Flask + SQLite。以「番号 + .nfo」为元数据基准，同目录下匹配 `.mp4` / `.ts` 视频，通过扫描将元数据与路径缓存到数据库，支持局域网访问与简单登录。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Vite + React 18 + TS + Chakra UI)                         │
│  路由: /login, /, /detail/:code, /play/:code                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (REST API + Bearer Token)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  后端 (Flask)                                                     │
│  - 认证: POST /api/auth/login → token                            │
│  - 媒体: GET /api/items, GET /api/items/<code>                   │
│  - 扫描: POST /api/scan                                           │
│  - 流媒体: GET /api/stream/<code>                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  SQLite       │   │  扫描器        │   │  媒体根目录    │
│  media_items  │   │  scanner.py   │   │  MEDIA_ROOT   │
│  users        │   │  NFO 解析     │   │  *.nfo +      │
│  sessions     │   │  入库/更新    │   │  *.mp4 / *.ts │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

## 三、目录与模块说明

| 路径 | 说明 |
|------|------|
| `backend/` | 后端 Flask 应用 |
| `backend/app.py` | 应用入口、蓝本注册、默认用户与启动扫描 |
| `backend/config.py` | 配置（MEDIA_ROOT、DB、SECRET_KEY、SCAN_ON_STARTUP） |
| `backend/models.py` | SQLAlchemy 模型（MediaItem、User、Session）与 DB 初始化 |
| `backend/scanner.py` | 媒体目录扫描、NFO 解析、写入/更新 media_items |
| `backend/routes/api.py` | 媒体列表/详情/扫描/流媒体 API 及登录校验装饰器 |
| `backend/routes/auth.py` | 登录接口，签发 token 写入 sessions |
| `frontend/` | Vite + React 前端 |
| `frontend/src/api/client.ts` | Axios 实例、getBaseUrl/getToken、baseURL、Authorization 注入 |
| `frontend/src/api/calls.ts` | 接口薄封装：fetchItem、fetchItems、fetchFilters、postScan |
| `frontend/src/types/api.ts` | 与后端一致的共享类型（MediaItem、MediaDetail、ListFilters 等） |
| `frontend/src/pages/` | 登录、列表、详情、播放页（使用 TanStack Query + api/calls） |
| `docs/` | 计划、API、前端架构等文档 |

---

## 四、开发阶段与 Roadmap

### 阶段 0：环境与仓库（已完成）

- 前后端分目录，依赖与启动命令就绪
- 后端：`python -m backend.app`，绑定 `0.0.0.0:5000`
- 前端：`npm install` + `npm run dev`，proxy `/api` 到后端

### 阶段 1：后端 — 数据库与扫描（已完成）

- [x] 建表：media_items、users、sessions
- [x] 扫描脚本：遍历 MEDIA_ROOT、解析 .nfo、匹配 .mp4/.ts、写入 SQLite
- [x] 同次扫描内番号去重，避免 UNIQUE 冲突

### 阶段 2：后端 — API 与认证（已完成）

- [x] GET /api/items（分页、搜索）、GET /api/items/<code>
- [x] POST /api/auth/login，Bearer token 校验，login_required 装饰器
- [x] GET /api/stream/<code> 流式返回视频
- [x] SQLite 多环境下 datetime 比较与异常保护（api.py）

### 阶段 3：前端 — 最小可用（已完成）

- [x] 登录页 → token 存 localStorage → 列表/详情/播放
- [x] 列表分页与搜索、详情页、播放页 video src 指向 /api/stream/<code>
- [x] 路由守卫 RequireAuth、Layout 与退出

### 阶段 4：扫描集成与体验（已完成）

- [x] POST /api/scan 手动触发扫描
- [x] 前端「刷新库」按钮调用扫描
- [ ] 可选：增量扫描（基于 mtime 只处理变更）、定时任务（APScheduler/cron）
- [ ] 可选：NFO 更多字段（封面路径、时长等）并写入 DB / 详情展示

### 阶段 5：体验增强（待办）

- [ ] 列表：封面缩略图、排序选项
- [ ] 详情：封面图、更多元数据
- [ ] 播放：进度记忆、断点续传（Range 支持）
- [ ] 大库：扫描进度 API、后台任务

### 阶段 6：运维与部署（待办）

- [ ] 生产 WSGI（如 gunicorn）
- [ ] 前端 build 后由 nginx 或 Flask 静态托管
- [ ] 环境变量与密钥管理说明

---

## 五、配置与环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| MEDIA_ROOT | 媒体根目录 | F:\TestLib |
| DB_PATH | SQLite 文件路径 | backend/media.db |
| DATABASE_URL | 数据库 URL | sqlite:///&lt;DB_PATH&gt; |
| SECRET_KEY | Flask 密钥 | dev-secret-change-me |
| SCAN_ON_STARTUP | 启动时是否执行一次扫描 | 1 |
| DEFAULT_ADMIN_USERNAME | 默认管理员用户名 | admin |
| DEFAULT_ADMIN_PASSWORD | 默认管理员密码 | admin |

---

## 六、风险与注意点

- **路径与权限**：MEDIA_ROOT 需对运行进程可读；stream 仅限 MEDIA_ROOT 下路径，防止路径注入。
- **大库扫描**：全量扫描可能较慢，可做后台任务 + 进度 API 或仅扫描顶层目录。
- **CORS**：开发/局域网需允许前端 origin；生产可收紧。
- **NFO 格式**：当前解析 `<title>` / `<plot>`，格式不一需容错与扩展字段映射。

---

## 七、参考

- 设计参考 Jellyfin：库 → 扫描 → 元数据 → 媒体项；本方案简化为单库、番号维度、NFO 驱动。
