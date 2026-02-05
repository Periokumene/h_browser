# 个人影音库

前后端分离的个人影音库：React + TypeScript + Chakra UI 前端，Flask + SQLite 后端，以「番号 + .nfo」为元数据基准，支持局域网访问。

## 快速开始

- **后端**：`python -m backend.app`（默认 `http://0.0.0.0:5000`）
- **前端**：`cd frontend && npm install && npm run dev`（开发时 API 通过 proxy 访问后端）

默认账号：`admin` / `admin`（可通过环境变量修改）。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/PLAN_AND_ROADMAP.md](docs/PLAN_AND_ROADMAP.md) | 计划与路线图、架构、配置、阶段说明 |
| [docs/API.md](docs/API.md) | 后端 API 文档（认证、接口、请求/响应） |
| [docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md) | 前端架构与数据层（TanStack Query、api/calls、共享类型、Query Key） |
| [docs/README.md](docs/README.md) | 文档索引 |

代码说明见各模块 docstring（`backend/` 下）。
