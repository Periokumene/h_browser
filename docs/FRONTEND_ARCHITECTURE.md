# 前端架构与数据层

本文档说明前端的依赖、目录结构、以及本次重构引入的**服务端状态管理**与 **API 封装**，便于后续维护与扩展。

---

## 一、技术栈与依赖

| 类别 | 技术/库 | 说明 |
|------|---------|------|
| 框架 | React 18 | 组件与路由 |
| 构建 | Vite + TypeScript | 开发/构建与类型 |
| UI | Chakra UI | 组件库与主题 |
| 路由 | react-router-dom | 路由与守卫 |
| HTTP | axios | 请求客户端，带 baseURL 与 Authorization 注入 |
| **服务端状态** | **@tanstack/react-query** | 统一请求、缓存、loading/error，替代手写 useState/useEffect |
| 播放 | hls.js | TS 格式 HLS 播放 |
| 动效 | framer-motion | 可选动效 |

**原则**：仅引入必要运行时依赖；类型与 API 封装不新增第三方包，使用现有 TypeScript + axios。

---

## 二、目录与模块

```
frontend/src/
├── api/
│   ├── client.ts    # Axios 实例、getBaseUrl/getToken、请求拦截器
│   └── calls.ts     # 接口薄封装：fetchItem、fetchItems、fetchFilters、postScan
├── types/
│   └── api.ts       # 与后端一致的共享类型（MediaItem、MediaDetail、ListFilters 等）
├── theme/
│   └── index.ts     # Chakra 主题
├── pages/           # 页面组件，使用 useQuery/useInfiniteQuery/useMutation + api/calls
├── App.tsx
└── main.tsx         # QueryClientProvider 包裹根组件
```

---

## 三、API 层

### 3.1 `api/client.ts`

- **getBaseUrl()**：返回 `VITE_API_BASE_URL` 或默认 `http://localhost:5000`，用于拼海报/流媒体 URL（如 `<img src={base + poster_url}?token=...>`）。
- **getToken()**：返回 `localStorage.getItem("authToken")`，供需要 token 的 URL 或逻辑使用。
- **apiClient**：axios 实例，`baseURL` 同上；请求拦截器自动在 Header 中注入 `Authorization: Bearer <token>`。

页面与 `calls.ts` 统一从本文件引用 `getBaseUrl`、`getToken`，不再在页面内重复实现。

### 3.2 `api/calls.ts`（接口薄封装）

所有与后端交互的请求集中在此，参数与返回类型与 `types/api.ts` 一致，便于改接口时只改一处。

| 函数 | 说明 | 对应后端 |
|------|------|----------|
| **fetchItem(code)** | 单条媒体详情 | GET /api/items/\<code\> |
| **fetchItems(params)** | 分页列表，支持 q、filters（genre/tag、filter_mode） | GET /api/items |
| **fetchFilters()** | 筛选可选值（类型、标签） | GET /api/filters |
| **postScan()** | 触发全量扫描 | POST /api/scan |

- 列表请求使用 `paramsSerializer` 将数组序列化为重复 key（如 `genre=a&genre=b`），与后端 `getlist("genre")` 约定一致。
- 页面只调用上述函数，并配合 TanStack Query 使用，不直接写 `apiClient.get/post`。

---

## 四、共享类型 `types/api.ts`

与后端 API 响应保持一致，供 api 层与页面复用，避免在各页面重复定义。

| 类型 | 说明 |
|------|------|
| **MediaItem** | 列表项：code、title、video_type、has_video、poster_url |
| **MediaDetail** | 详情：含 metadata（rating、year、actors、genres、outline 等） |
| **Actor** / **Metadata** | 详情内嵌结构 |
| **ListFilters** | 列表筛选：genres、tags、filterMode（"and" \| "or"） |
| **FilterOptions** | 筛选可选值：genres、tags |
| **ItemsListResponse** | 列表响应：page、page_size、total、items |

新增或修改后端字段时，同步更新本文件以保持前后端类型一致。

---

## 五、TanStack Query（服务端状态）

### 5.1 配置

- 在 `main.tsx` 使用 **QueryClientProvider** 包裹应用，单例 **QueryClient**，默认 `staleTime: 60_000`（1 分钟内不重复请求）。
- 页面通过 `useQuery`、`useInfiniteQuery`、`useMutation` 消费上述 `calls.ts` 中的函数。

### 5.2 Query Key 约定

固定少量键，便于 invalidate 与维护：

| 键 | 用途 | 使用页面 |
|----|------|----------|
| **["item", code]** | 单条详情 | Detail、Play |
| **["items", search, filters]** | 分页列表（search 为提交后的关键词，filters 为当前筛选） | VideoLib |
| **["filters"]** | 筛选可选值（类型、标签） | VideoLib |

- Detail 与 Play 共用 `["item", code]`，从详情进入播放时可直接复用缓存。
- 扫描成功后对 `["filters"]`、`["items"]` 做 `invalidateQueries`，自动刷新列表与筛选选项。

### 5.3 使用方式摘要

| 场景 | Hook | 说明 |
|------|------|------|
| 详情 / 播放取 media 信息 | **useQuery** | queryKey `["item", code]`，queryFn `() => fetchItem(code)`，用 `data`/`isLoading`/`isError` 渲染 |
| 筛选选项 | **useQuery** | queryKey `["filters"]`，queryFn `fetchFilters` |
| 列表 + 加载更多 | **useInfiniteQuery** | queryKey 含 search、filters；queryFn 用 `fetchItems`，initialPageParam 1，getNextPageParam 与后端 page/total 一致 |
| 扫描 | **useMutation** | mutationFn `postScan`，onSuccess 里 `invalidateQueries(["filters"], ["items"])` |

列表若需「每次进入都拉最新」，可在对应 `useInfiniteQuery` 上设 `staleTime: 0` 或 `refetchOnMount: "always"`。

---

## 六、扩展与维护

- **新增接口**：在 `types/api.ts` 增加或调整类型 → 在 `calls.ts` 增加对应 `fetchXxx`，使用 `apiClient` 与类型 → 在页面用 `useQuery`/`useMutation` 调用并选定 queryKey。
- **修改后端字段**：优先改 `types/api.ts`，再检查 `calls.ts` 与页面是否需适配。
- **不引入**：Zustand、React Context（认证）、React Hook Form 等；认证与表单维持现状，保持轻量。

---

## 七、参考

- [TanStack Query 文档](https://tanstack.com/query/latest)
- 后端接口详见 [API.md](API.md)；数据访问层见 [DATA_ACCESS_ARCHITECTURE.md](DATA_ACCESS_ARCHITECTURE.md)。
