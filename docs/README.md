# 文档索引

本目录包含项目计划、路线图、API 与前端主题说明，便于后续查阅。

| 文档 | 说明 |
|------|------|
| [PLAN_AND_ROADMAP.md](PLAN_AND_ROADMAP.md) | 项目概述、架构、目录说明、开发阶段与 Roadmap、配置与环境变量、风险与注意点 |
| [API.md](API.md) | 后端 REST API 文档：认证方式、各接口的请求/响应格式及示例 |
| [THEME.md](THEME.md) | 前端主题与样式规范：Chakra 主题结构、暖色中性色、语义化颜色（app.*）、组件默认与动效、迭代与维护指南 |
| [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md) | 项目用途分析、术语说明，以及**与 NSFW 相关的暗示说明**（测试示例番号等）与对外展示建议 |
| [DATA_ACCESS_ARCHITECTURE.md](DATA_ACCESS_ARCHITECTURE.md) | 数据访问架构：统一数据访问层（media_service）设计、职责划分、数据流向、未来扩展点 |

代码内文档以模块与函数的 docstring 为主，见 `backend/` 下各 Python 文件；主题实现见 `frontend/src/theme/index.ts`。
