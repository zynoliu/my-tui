export const variants = ["baseline", "list", "projects"] as const
export type Variant = (typeof variants)[number]
export const states = ["running", "approval", "question", "unread", "idle", "failed"] as const
export type SessionState = (typeof states)[number]
export type Session = {
  readonly id: string
  readonly title: string
  readonly project: string
  readonly branch: string
  readonly age: string
  readonly state: SessionState
  readonly pinned: boolean
}

export const sessions: readonly Session[] = [
  { id: "nav", title: "重新设计会话导航", project: "my-tui", branch: "dev", age: "now", state: "running", pinned: false },
  { id: "adapter", title: "Backend adapter design", project: "bridge-tui", branch: "main", age: "12m", state: "idle", pinned: true },
  { id: "keys", title: "Review keyboard shortcuts", project: "my-tui", branch: "dev", age: "4m", state: "approval", pinned: false },
  { id: "question", title: "Choose navigation behavior", project: "my-tui", branch: "interaction", age: "8m", state: "question", pinned: false },
  { id: "scroll", title: "Fix scroll restoration", project: "my-tui", branch: "scroll-fix", age: "24m", state: "unread", pinned: false },
  { id: "long", title: "检查中文长标题与终端字符宽度：切换项目时不要丢失当前任务上下文", project: "my-tui", branch: "long-title-experiment", age: "38m", state: "idle", pinned: false },
  { id: "provider", title: "Add provider discovery", project: "bridge-tui", branch: "providers", age: "1h", state: "failed", pinned: false },
  { id: "events", title: "Inspect session events", project: "bridge-tui", branch: "main", age: "2h", state: "idle", pinned: false },
]

export const overflowSessions: readonly Session[] = [
  ...sessions,
  ...Array.from({ length: 24 }, (_, index): Session => ({
    id: `extra-${index}`,
    title: `Review task ${index + 1}: preserve context`,
    project: index % 2 === 0 ? "my-tui" : "bridge-tui",
    branch: "main",
    age: "Yesterday",
    state: "idle",
    pinned: false,
  })),
]

export const stateLabels: Record<SessionState, string> = {
  running: "Running",
  approval: "Needs approval",
  question: "Needs answer",
  unread: "New result",
  idle: "Ready",
  failed: "Failed",
}

export type Group = {
  readonly key: string
  readonly label: string
  readonly sessions: readonly Session[]
}

export function groupSessions(items: readonly Session[], variant: Variant, query: string): Group[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const filtered = items.filter((item) => {
    const text = `${item.title} ${item.project} ${item.branch}`.toLowerCase()
    return tokens.every((token) => text.includes(token))
  })
  const pinned = filtered.filter((item) => item.pinned)
  const rest = filtered.filter((item) => !item.pinned)
  const working = variant === "baseline" ? rest.filter((item) => item.state === "running" || item.state === "approval" || item.state === "question") : []
  const projects = rest.filter((item) => !working.includes(item))
  return [
    { key: "pins", label: "Pinned", sessions: pinned },
    { key: "working", label: "Working", sessions: working },
    ...(variant === "list"
      ? [{ key: "recent", label: "Recent", sessions: rest }]
      : [...new Set(projects.map((item) => item.project))].map((project) => ({
          key: project,
          label: project,
          sessions: projects.filter((item) => item.project === project),
        }))),
  ].filter((group) => group.sessions.length > 0)
}

export function truncate(text: string, width: number) {
  if (Bun.stringWidth(text) <= width) return text
  return `${Bun.sliceAnsi(text, 0, Math.max(0, width - 1))}…`
}
