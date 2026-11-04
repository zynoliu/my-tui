# OpenCode TUI 架构简报

> 代码库：`opencode/`（github.com/anomalyco/opencode，dev 分支，v2.2.0，commit `7b1e54a`，2026-10-27）
> 本文档关注点：`packages/tui`（后续"魔改"对象）。最后更新：2026-10-27

## 1. 技术栈与总体结构

- **Bun + SolidJS + OpenTUI（`@opentui/core`）+ Effect**，约 6.6 万行 TS/TSX
- 包入口 `src/index.tsx` → `src/app.tsx` 的 `run()`：创建 CliRenderer，搭 Provider 树，挂载路由
- 路由只有两种核心页面 + 插件自定义路由（`src/context/route.tsx`）：
  - `routes/home.tsx` —— 首页
  - `routes/session/` —— 会话主界面（核心）

## 2. session 主界面（魔改主战场）

`src/routes/session/index.tsx` 的 `Session` 组件（3820 行）撑起整个聊天界面。

### 组件层级

```
Session (index.tsx:147)
├── scrollbox (index.tsx:1518)
│   └── For visibleRows → SessionRowView (index.tsx:1665)
│       ├── group → SessionGroupView (group-view.tsx:33) → Group → GroupContent/ActivityGroup/InstructionsGroup（递归）
│       └── 其他 → SessionEntryView (index.tsx:1682)
│           ├── message → UserMessage / ShellMessage / CompactionMessage 等
│           ├── part → TextPart / ReasoningPart / ToolPart (message-parts.tsx)
│           ├── assistant-footer → AssistantFooter
│           └── turn-usage → TurnTokenUsage
└── 底部区域 (index.tsx:1593-1660)
    ├── QueuedPromptDock
    ├── <Slot path="session.composer.top" />     ← 插件注入点
    ├── Composer（可展开抽屉：subagents/shell/terminals 三个 tab）
    └── Switch：PermissionPrompt → FormPrompt → SessionLocationMissing → <Prompt />
```

### 行模型与分组

- `rows.ts`：`createSessionRows()` 把服务器消息投影为 `SessionRow`（`reconcile({key})` 增量更新），订阅事件：
  流式（`session.text.delta`、`session.reasoning.delta`…）、生命周期（`session.step.started/ended/failed`）、inbox/compaction 等
- `grouping/session.ts`：分组策略
  - `partPath()`：reasoning 聚成 `reasoning`；读/搜/抓工具聚成 `exploration`；低 verbosity 下套 `activity`；question 独立
  - `messagePath()`：instruction 加载聚成 `instructions`
- `grouping/tree.ts`：通用分组树引擎 `groupEntries()` / `mergeGroups()` / `splitGroups()`

### 滚动与虚拟化

- 只挂载尾部 `TRANSCRIPT_TAIL_ROWS=40` 行，向上回填 `TRANSCRIPT_BACKFILL_CHUNK=60` 行（`mount-budget.ts` 按权重计算）
- 锚点系统（`anchors.ts` + `anchor-view.tsx`）：tab 切换滚动恢复、消息级跳转

### 输入编辑器

- **Prompt 组件**：`src/component/prompt/index.tsx`（textarea + extmarks 高亮 + 自动补全）
- `submit()` (index.tsx:1098)：处理 slash 命令、shell 模式（`!`）、乐观提交（`data.session.prompt(...)`，支持 `delivery="queue"` 排队）
- 解析逻辑在 `src/prompt/`：
  | 文件 | 职责 |
  |---|---|
  | `display.ts` | `@`/`/` 触发位置检测 |
  | `parse.ts` | slash 头解析、文件行范围 `file#L12-L34` |
  | `mention.ts` | 编辑/粘贴后 mention 重新对齐（DP 匹配） |
  | `history.tsx` | 历史上限 50 条，`prompt-history.jsonl` |
  | `frecency.tsx` | 文件频率×时衰计分，`frecency.jsonl` |
  | `stash.tsx` | 临时草稿栈，上限 50 条 |
  | `attachment.ts` / `codec.ts` / `content.ts` / `traits.ts` | 附件、投影互转、换行归一化、特征计算 |
  | `directory-completion.ts` / `directory-recents.ts` | 目录补全、最近目录 |

### 权限弹窗

`permission.tsx`：PermissionPrompt / SessionQuestion / EditBody（diff 预览）/ RejectPrompt → `data.session.permission.reply()`

## 3. context 层（30 个 Solid Context）

重点：

| Context | 文件 | 职责 |
|---|---|---|
| Route | `context/route.tsx` | home / session / plugin 路由，`useRouteData()` |
| Keymap | `context/keymap.tsx` | 命令与键位系统：`Keymap.createLayer`、`dispatch`、mode 栈；`COMMAND_PALETTE_COMMAND` |
| Client | `context/client.tsx` | HTTP client + SSE 事件总线 + 重连 + 持久 PTY |
| Data | `context/data.tsx` | `@opencode/client/solid` 数据同步，`data.session.*`、`data.on(...)` |
| Theme | `context/theme.tsx` | 主题加载/token/mode 切换，系统调色板探测（OSC 997） |
| SessionTabs | `context/session-tabs.tsx` + `session-tabs-model.ts` | tab 状态：持久化、切换、未读/忙碌 |
| Storage | `context/storage.tsx` | flock JSON 持久化 + 进程内 memory store |
| Local | `context/local.tsx` | 本地 UI 状态：当前 agent、模型偏好/收藏 |
| Permission | `context/panel.tsx` `permission.tsx` | 面板状态 / 权限模式（prompt/autoaccept） |
| Editor | `context/editor.ts` | 编辑器集成（选区、@mentioned 事件） |
| ClientMcp | `context/client-mcp.tsx` | 把 TUI 终端能力作为 MCP server 暴露给模型 |

## 4. 配置系统

- `config/index.tsx`：`Config.Info`（Effect Schema：theme/keybinds/plugins/scroll/terminal/prompt/tabs/mini/experimental…）、`Config.resolve()`、`useConfig()`；自导出模式 `export * as ConfigFoo from "./foo.js"`
- `config/keybind.ts`：全部命令默认键位 `Definitions`、覆盖解析
- `config/v1/`：旧实现，已无引用，忽略

## 5. 插件系统（官方扩展机制）

SDK 在 `packages/plugin/src/tui/`（`Plugin.define({id, setup})`，`context.ui.slot/router/keymap`），宿主实现在 `src/plugin/`：

| 文件 | 职责 |
|---|---|
| `context.tsx` | 插件发现/解析/激活/热重载 |
| `discovery.ts` | 扫描 `~/.config/opencode/plugins`、`.opencode/plugins`、服务器插件 |
| `render.tsx` | `Slot`、`PluginRoute`、`PluginBoundary`（崩溃隔离） |
| `structure.ts` | `resolveSlots()`：before/prepend/append/after/replace 归属（同级 last-enabled-wins，祖先替换压制后代） |
| `builtins.ts` | 内置插件清单 |

**Slot 树**：`app`、`home.footer(.status)`、`prompt.footer(.status/.file)`、`session.composer.top`、`session.panel`、`sidebar.content/footer`

**内置插件范例**（`src/feature-plugins/`）：
- `sidebar/`：context（token 用量）、limit、mcp、todo、footer → `sidebar.content/footer`
- `prompt/`：footer（子代理/shell/成本）、btw（`/btw` 旁问）
- `home/`：footer（MCP/插件失败/版本）
- `system/`：notifications、plugins（`/plugins`）、stats（`/stats`）、diff-viewer（`/diff`）、storybook（仅 OPENCODE_STORY）

**实验注册表**：`component/dialog-experiments.tsx`（当前：`new-designs`、`client-mcp`），gate 用 `config.experimental[id]`，框架本身不可删。

## 6. 其他子系统

- **mini/**（`opencode mini` 的 split-footer 轻量前端，与主 TUI 并行）：
  `runtime.ts` 编排、`runtime.boot.ts` 启动解析、`footer.ts` RunFooter 控制器、`footer.view.tsx` 及 `footer.prompt/command/menu/permission/form/subagent.tsx` 子面板
- **ui/**：对话框原语——`dialog.tsx`（DialogProvider/useDialog 堆栈）、`dialog-select.tsx`、`dialog-prompt.tsx`、`toast.tsx`、`layout.ts`（`SESSION_SIDEBAR_WIDTH`）、`pane-resize.ts`+`pane-resize-handle.tsx`
- **component/**（57+ 文件）：全部 dialog-*（model/agent/mcp/theme/session-list…）、`session-tabs.tsx`（横/竖布局）、`command-palette.tsx`、prompt/ 子目录、spinner/fade-in-text 等视觉件
- **theme/**：`index.ts` 注册中心、`assets/` 主题 JSON（v2/opencode2.json 是新设计实验主题）、`resolve.ts` V1 颜色解析
- **devtools/**：`DevTools.register` 运行时调试值注册表

## 7. 主题规则（AGENTS.md 强制）

- 按**语义角色**取 token，不用 `theme.hue` 裸值、不借用无关 token
- `text.feedback`/`background.feedback` 只用于错误/警告/成功/提示；表单用 `formfield` 状态；动作用 `action` 状态
- 缺角色就扩展 theme schema/defaults/resolution/types，不要挪用近似 token

## 8. 开发流程（AGENTS.md 规定）

- 跑 TUI：`bun run dev:live`（连本机已安装的 opencode server，可传目录参数）
- 单组件：`OPENCODE_STORY=<story-id> bun run dev:live`
- 类型检查：包目录 `bun run typecheck`；tsc 是最终裁决（`bun run typecheck:tsc`）；repo 根 `bun run check`
- 测试：包目录 `bun test --timeout 30000`（**禁止从 repo 根跑**）
- 风格：禁 else/any/导入别名/star 导入；const 优先；早返回；Effect 服务先绑定再调用
- 分支：默认 `dev`；分支名 ≤3 词连字符；conventional commits（`type(scope): summary`）；不用 changesets

## 9. 魔改速查：改什么去哪里

| 需求 | 位置 |
|---|---|
| 改整体布局/消息卡片 | `routes/session/index.tsx` 的 context.Provider JSX、`SessionRowView`、`SessionEntryView`、`UserMessage` |
| 改分组行为 | `grouping/session.ts` 的 `partPath()`/`messagePath()`；视觉在 `group-view.tsx` |
| 改滚动/虚拟化 | `index.tsx` 预算常量 + `mount-budget.ts` |
| 改输入编辑器 | `component/prompt/index.tsx`、`submitInner()`、`prompt/` 解析层 |
| 改权限弹窗 | `routes/session/permission.tsx` |
| 注入插件 UI | claim `session.composer.top` / `prompt.footer.*` / `sidebar.*` Slot |
| 改 tab/侧边栏 | `component/session-tabs.tsx`、`context/session-tabs-model.ts` |
| 新对话框 | 基于 `ui/dialog.tsx` + `dialog-select.tsx`，参考 `dialog-mcp.tsx` |
| 新主题/颜色 | `theme/assets/` + `theme/index.ts` |
| 新配置项 | `config/index.tsx` 的 `Info`/`Resolved`/`resolve()` |
| 新命令/键位 | `context/keymap.tsx` + `config/keybind.ts` |

## 9.1 魔改记录

- `d5011f7b5c feat(tui): default session tabs to vertical layout`：tabs 默认 layout 从 horizontal 改为 vertical（`config/index.tsx` resolve 默认值）；≥106 列显示左侧边栏，窄终端自动回退顶部横条。用户仍可用 `tabs.layout` 配置覆盖
- `9adeb0abcb feat(tui): session nav grouping model` + `c801827b95 feat(tui): three-layer session nav sidebar`：垂直栏从平坦 tab 列表改造为三层导航（★ Pinned 置顶区 / ● Working 动态区 / ▼ 项目分组区）。要点：
  - 新组件 `component/session-nav.tsx`；app.tsx 垂直分支已替换（水平横条保留给窄终端）
  - 数据：api session.list（跨项目 50 条，created/archived/deleted/moved 事件触发 refetch）+ data 层 merge（已同步副本优先）+ pin 复用 `local.session.pinned()`（持久化 state/session.json，>50 条的 pin 逐个 session.get 补取）
  - 行 = 状态符（attention !/?、busy spinner、failed ✗、open ▪）+ 回退标题（withTimestampedFallback）+ timeAgo
  - 分区顺序：Pinned → Working → 项目分组。Working 只按执行态（自身或子会话 `data.session.status === "running"`）分区；等待审批/回答的会话留在项目组内，靠琥珀色状态点标识——把 attention 或 tab 状态并入分组会在权限快照异步到达、未读脉冲变化时重建整张列表，导致交互抖动。对应 `partitionWorking` + `groupSessions`（`session-tabs-model.ts`）
  - 交互：点击打开/聚焦、中键关 tab、右键菜单（Pin/Close/Rename/CopyID）、组折叠持久化 session-nav-collapsed、折叠组 ⚠N 角标（attention+unread 计数）、`alt+p` pin 键位（原 ctrl+f 与 input.move.right 冲突）
  - 模型纯函数 partitionWorking/groupSessions 在 session-tabs-model.ts（7 单测，变异验证过）
  - 运行时证据：`.omo/qa-evidence/session-nav-2026-10-28/`（xterm.js  harness 截图+转录：三层渲染/点击打开/pin 持久化重启保持/窄终端回退/新世界单会话）
  - Working 区真实运行证据已补（2026-10-28 本地 ollama qwen25-3b，模型保留在 ~/.ollama）：sc7-working-during（● Working + spinner 运行中）→ sc7-working-settled（完成后区消失、回复 "1 2 3"、9.3s 元数据、footer 上下文用量）
  - 已知问题：TUI 在 harness PTY 中跑真实模型时进程树间歇性被整组杀死（3 次中 2 次，无输出无退出码，机器无内存压力）——复现配方：harness PTY + ollama 真实运行完成前后数分钟内；待查（疑似 OpenTUI native 或运行时信号）
  - 已知限制："No sessions yet" 字面分支不可达（删会话即跳首页）

## 9.2 Session Tabs 扩展性调研结论（2026-10-28）

**现状：tabs 是纯核心组件，插件系统无法注入任何 tabs UI。** SlotMap 里没有任何 tabs 相关插槽；`UI.tabs` API 只有查询/打开/聚焦/移动/关闭（`plugin/src/tui/context.ts`）。

- 视觉/交互全硬编码于 `component/session-tabs.tsx`（1801 行）：`TabIndicator`（132 行，数字/状态图标）、`TabContextMenu`（370 行，菜单项硬编码）、拖拽重排、marquee 标题、`TAB_SPINNERS`/`TAB_UNREAD_MARKERS` 常量
- tab 状态机：`context/session-tabs.tsx` `status()` 产生 unread/busy/attention/promptPulse，全部来自 data.session.*，无可扩展字段；模型 `SessionTab = { sessionID, title? }`（session-tabs-model.ts:1），无 pin/分组/标签概念
- 轻量定制（改 marker/spinner 字符、数字 vs 状态模式）：改 `session-tabs.tsx` 顶部常量 + `TabIndicator`
- 结构扩展的最小侵入路径：
  1. **加 SlotMap 条目**（`session.tabs.tab` / `session.tabs.strip`）+ 在两个渲染循环（`VerticalSessionTabs` ~584、`HorizontalSessionTabs` ~1306）插 `<Slot>`——最符合现有架构，改完插件即可扩展 tabs
  2. 或扩展 `SessionTabsController`（session-tabs.tsx:111）加可选 `detail?/actions?/contextMenu?/renderTab?`，storybook fixture 已示范构造方式
- storybook 有现成 tabs fixture：`feature-plugins/system/storybook/session-tabs.tsx:141-201`，改 tabs 前可用 `OPENCODE_STORY` 预览

## 9.3 社区痛点调研（2026-10-28，来源：anomalyco/opencode GitHub issues）

结论：会话导航是 opencode 社区最高频的诉求区之一，用户想法与市场验证一致。
- [#37273](https://github.com/anomalyco/opencode/issues/37273)（open）：1.18 移除项目侧栏改用 tab 后的回归抱怨——无法一眼看出 session 属于哪个项目，希望"项目+会话侧栏与 tab 并存"
- [#24451](https://github.com/anomalyco/opencode/issues/24451)（pinned sessions）：并行会话编排痛点——只能靠多开终端窗口、会话列表弹窗选完就关、看不到后台会话状态；提出 pin + 临时条目 + 实时状态行（lanes.sh 风格）
- [#12548](https://github.com/anomalyco/opencode/issues/12548)：Chrome 式 tab（多会话工作流、切换丢上下文、需要 per-tab 状态指示）
- [#36942](https://github.com/anomalyco/opencode/issues/36942)（vertical tabs，已实现）、[#36936](https://github.com/anomalyco/opencode/issues/36936)（tab 标题显示不下）、[#48972](https://github.com/anomalyco/opencode/issues/48972)（求恢复左侧栏）
- 需求聚类：项目分组/身份标识、常驻+实时的会话总览（pin、running/attention 状态）、不丢上下文的快速切换
- 设计启示：分组之上还要有「置顶区」和「正在工作」动态区；终端高度有限，默认折叠非当前项目的组

## 10. 仓库管理与魔改策略（2026-10-27 已定）

### 会话侧栏后续进展（2026-10-28）

- 侧栏新增本地筛选：标题、项目名、目录，不区分大小写；空白分隔的词必须全部匹配。范围是已同步会话、最近 50 条远端会话及置顶会话，不是全历史搜索。
- `Alt+F` 聚焦筛选，`Escape` 清空并恢复先前焦点。筛选时临时展开项目组并取消每组 10 条上限，不改持久折叠状态；无结果显示空态。
- 修复侧栏 `+ New session` 错调状态 getter，改为 `sessionTabs.add()`。
- 拖拽与编号的处理建议：项目区按更新时间排序，不适合拖拽；旧横向 tab 的拖拽、编号及配置保留。纵向侧栏暂不恢复这两项，未来若加入置顶排序，应单独设计持久顺序；此处是实现建议，不是用户已确认的删除决定。
- 稳定性实验：独立 tmux 中的 TUI 已观察存活超过 15 分钟，且完成一次本地 Ollama 响应。原监控有匹配自身的缺陷，不能用其结果作证；后端曾中断，重启后 TUI 自动重连。内核 PTY 新启动过程记录到 SIGTERM，但尚不能确定是谁发出，不能据此断言产品崩溃或 OOM。
- 本轮验证：模型及旧标签栏测试 10 项通过，新增整应用筛选焦点回归 1 项通过，`typecheck:tsc` 通过；真实 tmux 验证 Alt+F 输入、无结果状态、Escape 清空及返回 composer 后继续输入。独立稳定性进程最后记录存活 19 分 39 秒。浏览器截图通道被宿主拒绝，未完成本轮颜色、裁切等视觉检查。
- 较宽回归曾为 47 通过、2 失败：`app-lifecycle.test.tsx` 的旧纵栏位置及紧凑搜索图标断言与此前三层侧栏改造不符，本轮未修改这些旧测试；不将其算作全绿。

### git 工作流（2026-11-04 已 rebase 到上游最新 dev）
- `origin = https://github.com/anomalyco/opencode.git`；`dev` 已 rebase 到 `origin/dev`（`93f30caaa4`，tui 2.2.5），其上 6 个魔改提交：纵向默认 → 分组模型 → 三层侧栏 → 生命周期集成 → QA harness → prompt 焦点修复
- `upstream` 分支跟踪 `origin/dev`，tag `upstream/2.2.5` 指向当前基线；旧 tarball 基线 `0cc4a06`（tag `upstream/2.2.0`）仅作历史，不再作为合并目标
- 上游更新改为远程 fetch + rebase：`git fetch origin dev` → `git rebase origin/dev`，不再走 tarball 快照分支；rebase 前的状态保存在 `backup/dev-pre-upstream-rebase`
- 本机 bun 1.3.14 与仓库 `packageManager: bun@1.4.4` 不符：跑 install/typecheck 可用，但**跑测试必须用 1.4.4**——1.3.14 下插件加载相关用例（`plugin-keymap`、`plugin-slot-output`、`session-media-refs`、`plugin-source` 等）会报 `Plugin failed` 假阳性。OmO 内置的 bun 因签名限制无法 dlopen OpenTUI 0.8.1 的 `libopentui.dylib`，同样不能跑测试。建议 `brew upgrade bun`；临时可用 `/tmp/bun144/bun-darwin-aarch64/bun`（官方 1.4.4 解包）
- 测试基线（bun 1.4.4，2026-11-04）：1674 通过 / 2 跳过（现有 skip）/ 0 失败（194 文件）
- 2026-11-04 修复的已知问题：prompt 焦点守卫回退为上游无条件 reclaim（`/diff` 面板返回后失焦）；anchors 用例写死第 8 列点击会落到纵栏上，改为按转录区坐标点；Working 区接到渲染层（之前 `partitionWorking` 无调用者）。侧栏列表增删分组会重建行节点，菜单用例在抓取行坐标前多渲染一帧
- node_modules 已被上游 .gitignore 忽略；bun.lock 已入库；husky 只有 pre-push（检查 bun 版本），commit 无钩子
- 外层 my-tui 仓库的 .gitignore 已忽略 `opencode/`，魔改历史全在嵌套仓库

### 魔改范围与架构决策
- **魔改只针对 `packages/tui`**，但版本历史覆盖整仓（workspace 依赖决定了 tui 不能脱离 monorepo）
- **后端接缝 = `context/client.tsx` + `context/data.tsx`**：后续多后端桥接层（opencode、pi 等）为每个后端写 adapter，对上暴露 opencode client+事件协议、对下翻译原生协议；UI 只消费 `useClient()`/`useData()`，不改协议类型
- 桥接层计划放 `packages/bridge-*` 新包（上游合并永不冲突）
- UI 插槽/插件机制覆盖不到的盲区（transcript 行渲染、Prompt 编辑器内部、SessionTabs、主题 token、主布局）才是直接改核心代码的部分

### 环境验证结果

- 代码来自 codeload tarball，**没有 .git**
- 依赖已装：`bun install --registry https://registry.npmmirror.com`（3968 包，11 秒；npmmirror 源在国内明显快于 npmjs）
- 类型检查：`packages/tui` 下 `bun run typecheck:tsc` 通过。本机 bun 1.3.14 无 `bun check` 子命令，官方 `bun run typecheck` 不可用
- **本机已装的 opencode 是 v1.19.4（旧版），与 V2 源码不兼容，dev:live 的 service 发现不可用**。实测可行的前后端分离配方：
  1. 后台起 V2 源码 server：`cd opencode && OPENCODE_PASSWORD=<dev密码> bun run dev -- serve --port 4096`
  2. tmux 里跑 TUI（后台 bash 会话无 PTY）：`OPENCODE_TUI_CHANNEL=dev OPENCODE_PASSWORD=<dev密码> bun run dev -- --server http://127.0.0.1:4096`
  3. 健康检查：`curl -u opencode:<dev密码> http://127.0.0.1:4096/api/info`
  4. 冒烟测试已通过：首页渲染、ctrl+p 命令面板、Ctrl+C 干净退出
- 已知噪音：全局插件 oh-my-openagent@latest 加载失败（与源码无关）
