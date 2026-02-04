# 前端主题与样式规范

本文档描述个人影音库前端的主题配置、配色与动效规范，便于迭代和维护。样式以 **Chakra UI** 的全局主题为核心，统一管理深色模式、暖色配色与组件默认样式。

---

## 1. 设计定位与原则

- **定位**：温馨的家庭视频播放器，避免「科技感」冷色与过于刺眼的高对比。
- **配色**：深色模式为主（`initialColorMode: "dark"`），背景与表面使用**偏暖的深色中性色**（带棕/米色调），主色为 **橙色（orange）** 作为强调。
- **动效**：过渡时长约 `0.2s`～`0.3s`，缓动 `ease`；交互反馈轻微（如按钮按下略缩放），不喧宾夺主。
- **维护原则**：能通过主题配置的尽量放在主题里；页面与组件优先使用**语义化颜色 token**（`app.*`），避免硬编码 `gray.800`、`blue.500` 等。

---

## 2. 技术栈与入口

| 项目 | 说明 |
|------|------|
| UI 库 | Chakra UI v2 |
| 主题定义 | `frontend/src/theme/index.ts`（`extendTheme` 导出 theme + `warmNeutrals`） |
| 注入方式 | `frontend/src/main.tsx` 中 `<ChakraProvider theme={theme}>` |
| 色模式 | 仅深色，`useSystemColorMode: false`，不随系统切换 |

---

## 3. 主题结构概览

主题文件按以下块组织，修改时尽量在对应块内扩展，避免散落写死样式。

```
theme/index.ts
├── warmNeutrals（导出常量）
├── config（色模式）
├── colors.warm（暖色中性色）
├── semanticTokens.colors（app.* 语义化颜色）
├── styles.global（html/body 等全局）
└── components（Button、Input、Badge、Card、Popover、Heading）
```

---

## 4. 暖色中性色（warm neutrals）

用于深色模式下的**背景与表面**，替代冷灰，使整体偏暖。

| 变量 | 色值 | 用途 |
|------|------|------|
| `warmNeutrals.bg` | `#1c1917` | 页面底层背景 |
| `warmNeutrals.surface` | `#292524` | 卡片、浮层、登录框等「表面」 |
| `warmNeutrals.subtle` | `#363330` | 表面内的次级区域（如卡片内海报占位区） |

- **定义位置**：`theme/index.ts` 顶部 `warmNeutrals`，并挂到 `theme.colors.warm`（`bg` / `surface` / `subtle`）。
- **使用方式**：
  - 在主题内：`semanticTokens`、`styles.global`、`components` 中通过 `warm.bg` / `warm.surface` / `warm.subtle` 引用。
  - 在 Layout 等需与主题同步的组件中：`import { warmNeutrals } from "./theme"`，用 `warmNeutrals.bg` 等（如 `useColorModeValue("gray.50", warmNeutrals.bg)`）。
- **迭代**：若要整体更暖/更冷，只改 `warmNeutrals` 三个色值即可，语义 token 与组件会随之生效。

---

## 5. 语义化颜色（app.*）

页面与组件**优先使用**以下 token，保证深/浅色一致且便于整体换肤。

| Token | 浅色 | 深色 | 建议用途 |
|-------|------|------|----------|
| `app.bg` | gray.50 | warm.bg | 页面背景、全屏底 |
| `app.surface` | white | warm.surface | 卡片、弹层、输入区容器 |
| `app.surface.subtle` | gray.50 | warm.subtle | 卡片内次级块（如无图占位） |
| `app.border` | gray.200 | whiteAlpha.200 | 边框 |
| `app.border.hover` | gray.300 | whiteAlpha.400 | 悬停边框（如卡片） |
| `app.muted` | gray.500 | gray.400 | 次要文字、说明、占位符 |
| `app.muted.fg` | gray.600 | gray.500 | 比 muted 略深的辅助文字 |
| `app.accent` | orange.500 | orange.400 | 主色（按钮、高亮） |
| `app.accent.fg` | white | gray.900 | 主色上的文字 |

**使用示例**（在 JSX 中）：

```tsx
<Box bg="app.surface" borderColor="app.border">
  <Text color="app.muted">说明文字</Text>
  <Button colorScheme="orange">主操作</Button>
</Box>
```

**扩展**：新增语义色时在 `semanticTokens.colors` 中加一项，例如 `"app.success": { default: "green.500", _dark: "green.400" }`，再在页面中用 `color="app.success"` 等。

---

## 6. 组件默认样式与动效

以下组件在主题中做了统一配置，**无特殊需求时不必在页面里重复写**。

| 组件 | 说明 |
|------|------|
| **Button** | 默认 `colorScheme: "orange"`；全局 `transition` + 按下 `scale(0.98)`；outline 变体悬停有背景与边框过渡。 |
| **Input** | 默认 `focusBorderColor: "orange.400"`；outline 变体带背景/边框/焦点环过渡。 |
| **Badge** | 全局过渡；subtle 变体对 orange/灰有区分（深色下 orange 为 orange.900/200，灰为 whiteAlpha.200 / gray.200）。 |
| **Card** | 容器深色用 `warm.surface`，浅色用 white，带过渡。 |
| **Popover** | content 深色用 `warm.surface`，边框与阴影统一。 |
| **Heading** | 字间距 `normal`。 |

**动效规范**（便于统一迭代）：

- 颜色/背景/边框：`transition: "… 0.2s ease"`。
- 缩放/位移动效：约 `0.2s～0.35s`，如卡片悬浮图片缩放 `0.35s ease`。
- 避免过长或弹跳过强的动画，保持「温馨、不抢戏」。

---

## 7. 全局样式（styles.global）

当前仅控制：

- **html, body**：背景色（深色用 `warmNeutrals.bg`，浅色用 `gray.50`），以及 `transition` 以便色模式切换时平滑。

不在全局对 `*` 做大面积边框等覆盖，以免影响组件默认样式。

---

## 8. 各层职责与修改指南

| 层级 | 位置 | 职责 | 修改建议 |
|------|------|------|----------|
| 主题配置 | `frontend/src/theme/index.ts` | 色板、语义 token、组件默认、全局样式 | 改主色、暖色色板、新 token、通用组件风格时只改此处。 |
| 布局与壳 | `frontend/src/App.tsx` | 整页背景、顶栏、主内容区 | 布局背景与主题一致时可使用 `warmNeutrals` 或 `app.bg`。 |
| 页面 | `frontend/src/pages/*.tsx` | 列表、详情、登录、播放等 | 使用 `app.*`、`colorScheme="orange"` 等，避免新的硬编码 gray/blue。 |

**常见迭代场景**：

- **整体更暖/更冷**：改 `theme/index.ts` 中 `warmNeutrals` 三个色值。
- **换主色（如改为绿色/琥珀）**：在 theme 中把 `orange` 替换为其他 Chakra 色（如 `green` / `amber`），并同步 `app.accent`、Button/Input 的 `colorScheme` / `focusBorderColor`。
- **新增一种语义色**：在 `semanticTokens.colors` 增加 `"app.xxx"`，再在页面用 `bg="app.xxx"` 等。
- **统一所有圆角/阴影**：在 `components` 的 `baseStyle` 或 `theme` 的 `radii` / `shadows` 中扩展。

---

## 9. 文件与导出一览

| 路径 | 导出 | 说明 |
|------|------|------|
| `frontend/src/theme/index.ts` | `default theme` | 给 ChakraProvider 使用。 |
| `frontend/src/theme/index.ts` | `warmNeutrals` | 供 Layout 等需要与主题一致背景的组件使用。 |
| `frontend/src/main.tsx` | — | 引入 `theme` 并传入 `ChakraProvider`。 |

---

## 10. 与 API / 后端的关系

主题与样式仅作用于前端展示，与后端 API 无耦合。后端不提供主题或样式配置；前端通过环境变量（如 `VITE_API_BASE_URL`）连接 API，与主题文件互不影响。
