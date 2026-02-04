# 个人影音库 — API 文档

**Base URL**：`http://<host>:5000`（本机示例：`http://127.0.0.1:5000`）

除「健康检查」和「登录」外，其余接口均需在请求头中携带有效 token。

---

## 一、认证说明

- 登录成功后，响应体中的 `token` 需在后续请求中放入 Header：
  - **Authorization**: `Bearer <token>`
  - 或 **X-Auth-Token**: `<token>`
- Token 默认有效期为 7 天，过期后需重新登录。

---

## 二、接口列表

### 1. 健康检查

**GET** `/api/health`

无需认证。

**响应示例（200）**

```json
{
  "status": "ok"
}
```

---

### 2. 登录

**POST** `/api/auth/login`

**Request Headers**

- `Content-Type: application/json`

**Request Body**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**示例**

```json
{
  "username": "admin",
  "password": "admin"
}
```

**响应**

- **200**：成功  
  - `token`: string，用于后续请求  
  - `expires_at`: string，ISO 8601 过期时间  
  - `username`: string  

- **400**：用户名或密码为空  
  - `error`: string  

- **401**：用户名或密码错误  
  - `error`: string  

**响应示例（200）**

```json
{
  "token": "xxx...",
  "expires_at": "2026-02-11T10:00:00",
  "username": "admin"
}
```

---

### 3. 媒体列表（分页 + 搜索）

**GET** `/api/items`

需要认证。

**Query 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | int | 1 | 页码，从 1 开始 |
| page_size | int | 20 | 每页条数，最大 100 |
| q | string | - | 搜索关键字（番号或标题模糊匹配） |

**示例**

- `GET /api/items`
- `GET /api/items?page=2&page_size=10`
- `GET /api/items?q=IPX`

**响应**

- **200**：成功  
  - `page`: int  
  - `page_size`: int  
  - `total`: int，总条数  
  - `items`: array，见下表  

**items 元素**

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 番号（唯一） |
| title | string \| null | 标题（来自 NFO） |
| video_type | string \| null | 视频扩展名，如 mp4、ts |
| has_video | boolean | 是否存在对应视频文件 |

**响应示例（200）**

```json
{
  "page": 1,
  "page_size": 20,
  "total": 5,
  "items": [
    {
      "code": "movie",
      "title": "示例标题",
      "video_type": "mp4",
      "has_video": true
    }
  ]
}
```

- **401**：未提供 token 或 token 无效/过期  
  - `error`: string  

---

### 4. 媒体详情

**GET** `/api/items/<code>`

需要认证。`code` 为番号（URL 编码，若含特殊字符）。

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| code | string | 媒体番号 |

**响应**

- **200**：成功  
  - `code`: string  
  - `title`: string \| null  
  - `description`: string \| null，NFO 中的 plot  
  - `video_type`: string \| null  
  - `has_video`: boolean  

**响应示例（200）**

```json
{
  "code": "movie",
  "title": "示例标题",
  "description": "剧情简介...",
  "video_type": "mp4",
  "has_video": true
}
```

- **404**：未找到该番号  
  - `error`: string  

- **401**：未认证或 token 无效  
  - `error`: string  

---

### 5. 触发扫描

**POST** `/api/scan`

需要认证。对配置的媒体根目录执行一次全量扫描，更新数据库中的媒体条目。

**Request Body**

无。

**响应**

- **200**：成功  
  - `processed`: int，本次扫描处理的条目数  

**响应示例（200）**

```json
{
  "processed": 12
}
```

- **401**：未认证或 token 无效  
  - `error`: string  

---

### 6. 视频流

**GET** `/api/stream/<code>`

需要认证。返回番号对应视频文件的字节流，供 `<video src="...">` 或播放器使用。

**认证**：因 `<video>` 无法携带请求头，支持通过 **Query 参数** 传 token：  
`GET /api/stream/<code>?token=<token>`。也可使用 Header：`Authorization: Bearer <token>`。

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| code | string | 媒体番号 |

**响应**

- **200** 或 **206**：成功  
  - 无 Range 请求时返回 200 全量；有 `Range: bytes=...` 时返回 206 分片，便于快速起播与拖动  
  - Content-Type: video/mp4（.mp4）、video/mp2t（.ts）  
  - Body: 视频二进制流（或请求的字节范围）  

- **404**：未找到该番号或对应视频文件  
  - Body: JSON `{ "error": "未找到对应视频文件" }`  

- **401**：未认证或 token 无效  
  - Body: JSON `{ "error": "..." }`  

**说明**：已支持 HTTP Range（分片/断点续传）；路径经 Path 解析，兼容 Windows 下含中文的路径。

---

### 7. HLS 播放列表（仅 TS）

**GET** `/api/stream/<code>/playlist.m3u8`

需要认证。仅当该番号对应视频为 **.ts** 时使用。返回单段 m3u8，供前端 **hls.js** 等播放（浏览器多不原生支持 `video/mp2t`）。认证方式同视频流，支持 query 参数 `token`。

**路径参数**：`code` — 媒体番号。

**响应**：200，`Content-Type: application/vnd.apple.mpegurl`，Body 为 m3u8 文本，其中段地址指向 `GET /api/stream/<code>?token=...`。  
400：该番号不是 TS。401/404：同视频流。

---

## 三、错误响应统一格式

业务错误时返回 JSON：

```json
{
  "error": "错误描述信息"
}
```

常见 HTTP 状态码：

- **400**：请求参数错误  
- **401**：未登录或 token 无效/过期  
- **404**：资源不存在  
- **500**：服务器内部错误（应尽量避免暴露细节）  

---

## 四、Postman 测试简要

1. **GET** `/api/health` — 确认服务正常  
2. **POST** `/api/auth/login`，Body: `{"username":"admin","password":"admin"}` — 获取 token  
3. 后续请求在 Headers 中增加：`Authorization: Bearer <token>`  
4. **POST** `/api/scan` → **GET** `/api/items` → **GET** `/api/items/<code>` → **GET** `/api/stream/<code>` 依次验证  

详见项目内说明或 `docs/` 下其他文档。
