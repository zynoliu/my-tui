import { basename } from "node:path"
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Portal, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { BoxRenderable, CliRenderEvents, InputRenderable, MouseButton, ScrollBoxRenderable, TextAttributes, type Renderable } from "@opentui/core"
import type { SessionInfo, SessionsResponse } from "@opencode/client"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { useRoute } from "../context/route"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { useEvent } from "../context/event"
import { useLocal } from "../context/local"
import { useSessionTabs } from "../context/session-tabs"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { useClipboard } from "../context/clipboard"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { filterNavEntries, groupSessions } from "../context/session-tabs-model"
import { DialogSessionRename } from "./dialog-session-rename"
import { timeAgo } from "./dialog-open"
import { projectName } from "../util/project"
import { errorMessage } from "../util/error"
import { stringWidth } from "../util/string-width"
import { SESSION_SIDEBAR_WIDTH } from "../ui/layout"

const REFETCH_EVENTS = ["session.created", "session.archived", "session.unarchived", "session.deleted", "session.moved", "session.renamed"]
type NavEntry = { key: string; group: string; session?: SessionInfo }
type NavAction = { title: string; run: () => void }
type MenuState = { x: number; y: number; sessionID: string }

export function SessionNav(props: { width?: number }) {
  const route = useRoute()
  const data = useData()
  const client = useClient()
  const event = useEvent()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const theme = useTheme()
  const config = useConfig()
  const renderer = useRenderer()
  const clipboard = useClipboard()
  const dialog = useDialog()
  const toast = useToast()
  const width = () => props.width ?? SESSION_SIDEBAR_WIDTH
  const [revision, setRevision] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [archived, setArchived] = createSignal(false)
  const [keyboard, setKeyboard] = createSignal(false)
  const [focusedTarget, setFocusedTarget] = createSignal<Renderable | null>(renderer.currentFocusedRenderable)
  const [focus, setFocus] = createSignal("")
  const [list, setList] = createSignal<BoxRenderable>()
  const [input, setInput] = createSignal<InputRenderable>()
  const [menu, setMenu] = createSignal<MenuState>()
  const [loadError, setLoadError] = createSignal<string>()
  const [deleted, setDeleted] = createSignal<ReadonlySet<string>>(new Set())
  const [membership, setMembership] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const [more, setMore] = createSignal<{ data: SessionInfo[]; next?: SessionsResponse["cursor"]["next"]; loaded: boolean }>({ data: [], loaded: false })
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [collapsed, setCollapsed] = useStorage().store<Record<string, boolean>>("session-nav-collapsed", { initial: {} })
  let scroll: ScrollBoxRenderable | undefined
  let previousFocus: Renderable | null = null
  const request = createMemo(() => ({ search: query().trim(), archived: archived(), revision: revision() }))
  const fail = (action: string, error: unknown) => toast.show({ message: `${action}: ${errorMessage(error)}`, variant: "error", duration: 5000 })
  const refresh = () => setRevision((value) => value + 1)
  const [remote] = createResource(request, async (source) => {
    setLoadError(undefined)
    setMore({ data: [], loaded: false })
    try {
      const response = await client.api.session.list({
        limit: 50, order: "desc", parentID: null, archived: source.archived, search: source.search || undefined,
      })
      // These small pending-request caches also expose attention on sessions not open in tabs.
      void Promise.all(response.data.map((session) => Promise.all([
        data.session.permission.sync(session.id), data.session.form.sync(session.id),
      ]))).catch((error) => fail("Could not load session attention", error))
      return response
    } catch (error) {
      if (request() === source) {
        setLoadError(errorMessage(error))
        fail("Could not load sessions", error)
      }
    }
  })
  onMount(() => { void data.project.sync().catch((error) => fail("Could not load projects", error)) })
  onCleanup(event.subscribe((evt) => {
    if (evt.type === "session.archived" || evt.type === "session.unarchived") {
      setMembership((current) => new Map(current).set(evt.data.sessionID, evt.type === "session.archived"))
    }
    if (evt.type === "session.deleted") {
      setDeleted((current) => new Set([...current, evt.data.sessionID]))
      if (local.session.isPinned(evt.data.sessionID)) local.session.togglePin(evt.data.sessionID)
    }
    if (REFETCH_EVENTS.includes(evt.type)) refresh()
  }))
  const page = createMemo(() => [...(remote()?.data ?? []), ...more().data])
  const missingPins = createMemo(() => archived() ? [] : local.session.pinned().filter((id) => !page().some((session) => session.id === id) && !deleted().has(id)))
  const [pinned] = createResource(missingPins, async (ids) => {
    const sessions = await Promise.all(ids.map((sessionID) => client.api.session.get({ sessionID }).catch((error) => {
      fail("Could not load pinned session", error)
      return undefined
    })))
    return sessions.filter((session): session is SessionInfo => Boolean(session))
  })
  const all = createMemo(() => {
    const seen = new Set<string>()
    return [
      ...page(),
      ...(pinned() ?? []),
      ...sessionTabs.tabs().flatMap((tab) => {
        const session = data.session.get(tab.sessionID)
        return session ? [session] : []
      }),
    ].filter((session) => {
      if (session.parentID || deleted().has(session.id) || seen.has(session.id)) return false
      seen.add(session.id)
      return (membership().get(session.id) ?? (session.time.archived !== undefined)) === archived()
    })
  })
  const filtered = createMemo(() => filterNavEntries(all(), query(), (session) => [
    withTimestampedFallback(data.session.get(session.id) ?? session),
    projectName(data.project.get(session.projectID), session.location.directory),
    session.location.directory,
  ].join(" ")))
  const groups = createMemo(() => {
    const pins = archived() ? [] : local.session.pinned().flatMap((id) => {
      const session = filtered().find((session) => session.id === id)
      return session ? [session] : []
    })
    return [
      ...(pins.length ? [{ key: "pinned", title: "Pinned", sessions: pins }] : []),
      ...groupSessions(filtered().filter((session) => !pins.some((pin) => pin.id === session.id)), { cap: Infinity }).map((group) => ({
        key: group.key,
        title: projectName(data.project.get(group.key), group.sessions[0]?.location.directory),
        sessions: group.sessions,
      })),
    ]
  })
  const entries = createMemo<NavEntry[]>(() => groups().flatMap((group) => [
    { key: `session-nav-group-${group.key}`, group: group.key },
    ...(!query().trim() && collapsed[group.key] ? [] : group.sessions.map((session) => ({
      key: `session-nav-row-${session.id}`, group: group.key, session,
    }))),
  ]))
  const selected = () => sessionTabs.current()
  const focused = () => entries().find((entry) => entry.key === focus())
  const next = () => more().loaded ? more().next : remote()?.cursor.next
  const overlay = () => dialog.stack.length > 0 || Boolean(menu())
  const ownsFocus = () => renderer.currentFocusedRenderable === list() || renderer.currentFocusedRenderable === input()
  onMount(() => {
    const changed = () => {
      const current = renderer.currentFocusedRenderable
      const previous = focusedTarget()
      if ((current === list() || current === input()) && previous && previous !== list() && previous !== input() && !previous.isDestroyed && !overlay()) {
        previousFocus = previous
      }
      setFocusedTarget(current)
    }
    renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, changed)
    onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, changed))
  })
  createEffect(() => {
    const items = entries()
    if (!items.some((entry) => entry.key === focus())) {
      setFocus(items.find((entry) => entry.session?.id === selected())?.key ?? items[0]?.key ?? "")
    }
  })
  useKeyboard(() => setKeyboard(true))

  function rememberFocus() {
    if (!ownsFocus()) previousFocus = renderer.currentFocusedRenderable
  }
  function focusList() {
    rememberFocus()
    setKeyboard(true)
    list()?.focus()
    if (focus()) scroll?.scrollChildIntoView(focus())
  }
  function focusSearch() {
    rememberFocus()
    input()?.focus()
  }
  function restoreFocus() {
    input()?.blur()
    list()?.blur()
    if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus()
  }
  function clearSearch() {
    setQuery("")
    const field = input()
    if (field) field.value = ""
  }
  function move(key: string) {
    setKeyboard(true)
    setFocus(key)
    scroll?.scrollChildIntoView(key)
  }
  function fold(group: string) {
    move(`session-nav-group-${group}`)
    void setCollapsed((current) => { current[group] = !current[group] }).catch((error) => fail("Could not save project folding", error))
  }
  function open(session: SessionInfo) {
    restoreFocus()
    sessionTabs.select(session.id)
  }
  function toggleArchive() {
    clearSearch()
    setArchived((value) => !value)
    focusList()
  }
  async function loadMore() {
    const cursor = next()
    if (!cursor || loadingMore()) return
    const source = request()
    setLoadingMore(true)
    try {
      const response = await client.api.session.list({
        limit: 50, order: "desc", parentID: null, archived: source.archived,
        search: source.search || undefined, cursor,
      })
      if (request() === source) setMore((current) => ({ data: [...current.data, ...response.data], next: response.cursor.next, loaded: true }))
    } catch (error) {
      fail("Could not load more sessions", error)
    } finally {
      setLoadingMore(false)
    }
  }
  async function newSession() {
    try {
      await data.project.sync()
      const ids = new Set([...data.project.list().map((project) => project.id), ...all().map((session) => session.projectID)])
      const options = [...ids].flatMap((id) => {
        const project = data.project.get(id)
        const session = all().find((session) => session.projectID === id && session.id === selected()) ?? all().find((session) => session.projectID === id)
        const directory = session?.location.directory ?? project?.canonical
        if (!directory) return []
        return [{ title: projectName(project, directory) ?? directory, description: directory, value: session?.location ?? { directory } }]
      })
      if (!options.length) { restoreFocus(); sessionTabs.add(); return }
      const current = data.session.get(focused()?.session?.id ?? selected() ?? "")?.location.directory
      dialog.replace(() => <DialogSelect title="New session in project" options={options}
        current={options.find((option) => option.value.directory === current)?.value}
        onSelect={(option) => {
          dialog.clear()
          restoreFocus()
          route.navigate({ type: "home", location: option.value })
        }} />)
    } catch (error) {
      fail("Could not open project picker", error)
    }
  }
  function confirm(title: string, message: string, label: string) {
    return new Promise<boolean>((resolve) => {
      dialog.replace(() => {
        onCleanup(() => resolve(false))
        return <DialogSelect title={title} description={message} renderFilter={false} current={false}
          options={[{ title: "Cancel", value: false }, { title: label, value: true, description: message }]}
          onSelect={(option) => { resolve(option.value); dialog.clear() }} onCancel={() => resolve(false)} />
      }, () => resolve(false))
    })
  }
  async function archiveSession(session: SessionInfo) {
    const live = data.session.get(session.id) ?? session
    const status = sessionTabs.status(session.id)
    const working = data.session.status(session.id) === "running" || data.session.family(session.id).some((id) => data.session.status(id) === "running")
    try {
      if (working || status.attention) {
        if (!await confirm("Stop and archive session?", "Stop current activity and dismiss pending requests before archiving.", "Stop and archive")) return
        await client.api.session.interrupt({ sessionID: session.id })
        for (const sessionID of new Set([session.id, ...data.session.family(session.id)])) {
          await Promise.all([data.session.permission.sync(sessionID), data.session.form.sync(sessionID)])
          await Promise.all([
            ...(data.session.permission.list(sessionID) ?? []).map((permission) => data.session.permission.reply({
              sessionID, requestID: permission.id, decision: "reject", message: "Session archived by the user",
            })),
            ...(data.session.form.list(sessionID) ?? []).map((form) => data.session.form.cancel({
              sessionID, formID: form.id, message: "Session archived by the user",
            })),
          ])
        }
      }
      await client.api.session.update({ sessionID: live.id, archived: true })
      await data.session.sync(live.id)
      refresh()
      sessionTabs.close(live.id)
      toast.show({ message: "Session archived", variant: "success" })
    } catch (error) {
      fail("Could not archive session", error)
    }
  }
  async function restoreSession(session: SessionInfo) {
    try {
      await client.api.session.update({ sessionID: session.id, archived: false })
      await data.session.sync(session.id)
      setArchived(false)
      clearSearch()
      refresh()
      open(session)
      toast.show({ message: "Session restored", variant: "success" })
    } catch (error) {
      fail("Could not restore session", error)
    }
  }
  async function deleteSession(session: SessionInfo) {
    if (!await confirm("Delete session?", "Delete this session and its child sessions? This cannot be undone.", "Delete session")) return
    try {
      await client.api.session.remove({ sessionID: session.id })
      setDeleted((current) => new Set([...current, session.id]))
      if (local.session.isPinned(session.id)) local.session.togglePin(session.id)
      sessionTabs.close(session.id)
      refresh()
      toast.show({ message: "Session deleted", variant: "success" })
    } catch (error) {
      fail("Could not delete session", error)
    }
  }
  function showMenu(session: SessionInfo, point?: { x: number; y: number }) {
    const row = renderer.root.findDescendantById(`session-nav-row-${session.id}`)
    const position = point ?? (row ? { x: row.x, y: row.y + 1 } : undefined)
    if (!position) return
    focusList()
    setFocus(`session-nav-row-${session.id}`)
    setMenu({ ...position, sessionID: session.id })
  }
  const actions = createMemo<NavAction[]>(() => {
    const state = menu()
    const session = all().find((item) => item.id === state?.sessionID)
    if (!session) return []
    return [
      { title: local.session.isPinned(session.id) ? "Unpin" : "Pin", run: () => local.session.togglePin(session.id) },
      { title: "Rename", run: () => DialogSessionRename.show(dialog, session.id, withTimestampedFallback(data.session.get(session.id) ?? session)) },
      ...(session.time.archived === undefined
        ? [{ title: "Archive", run: () => { void archiveSession(session) } }]
        : [{ title: "Restore", run: () => { void restoreSession(session) } }]),
      { title: "Delete", run: () => { void deleteSession(session) } },
      { title: "Copy session ID", run: () => { void clipboard.write(session.id).then(() => toast.show({ message: "Session ID copied", variant: "success" })).catch((error) => fail("Could not copy session ID", error)) } },
      ...(sessionTabs.tabs().some((tab) => tab.sessionID === session.id) ? [{ title: "Close tab", run: () => sessionTabs.close(session.id) }] : []),
    ]
  })
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => !overlay(),
    commands: [
      { id: "session.nav.focus", title: "Focus session navigation", group: "Session", palette: true, run: focusList },
      { id: "session.nav.search", title: "Search sessions", group: "Session", palette: true, run: focusSearch },
      { id: "session.nav.archived", title: "Show active or archived sessions", group: "Session", palette: true, run: toggleArchive },
      { id: "session.pin.toggle", title: "Pin / unpin session", group: "Session", palette: true,
        run: () => {
          const sessionID = renderer.currentFocusedRenderable === list() ? focused()?.session?.id : selected()
          if (sessionID) local.session.togglePin(sessionID)
        } },
    ],
  }))
  Keymap.createLayer(() => ({
    mode: "global", priority: 1, target: input, enabled: () => !overlay(),
    commands: [
      { bind: "escape", title: "Clear search and return", run: () => { clearSearch(); restoreFocus() } },
      { bind: "return", title: "Focus search results", run: focusList },
      { bind: "down", title: "Focus search results", run: focusList },
      { bind: "tab", title: "Focus session list", run: focusList },
      { bind: "shift+tab", title: "Return to editor", run: restoreFocus },
    ],
  }))
  Keymap.createLayer(() => ({
    mode: "global", priority: 1, target: list, enabled: () => !overlay(),
    commands: [
      ...(["up", "down", "home", "end"] as const).map((key) => ({
        bind: key, title: "Move session navigation focus", run: () => {
          const items = entries()
          const index = items.findIndex((entry) => entry.key === focus())
          const next = key === "home" ? 0 : key === "end" ? items.length - 1
            : Math.max(0, Math.min(items.length - 1, index + (key === "down" ? 1 : -1)))
          const item = items[next]
          if (item) move(item.key)
        },
      })),
      { bind: "left", title: "Collapse project or focus heading", run: () => {
        const entry = focused()
        if (!entry) return
        move(`session-nav-group-${entry.group}`)
        if (!entry.session && !collapsed[entry.group]) fold(entry.group)
      } },
      { bind: "right", title: "Expand project or enter it", run: () => {
        const entry = focused()
        if (!entry || entry.session) return
        if (collapsed[entry.group]) { fold(entry.group); return }
        const session = groups().find((group) => group.key === entry.group)?.sessions[0]
        if (session) move(`session-nav-row-${session.id}`)
      } },
      ...(["return", "space"] as const).map((key) => ({ bind: key, title: "Open session or toggle project", run: () => {
        const entry = focused()
        if (!entry) return
        if (!entry.session || key === "space") { fold(entry.group); return }
        open(entry.session)
      } })),
      { bind: "escape", title: "Return to editor", run: restoreFocus },
      { bind: "tab", title: "Return to editor", run: restoreFocus },
      { bind: "shift+tab", title: "Focus search", run: focusSearch },
      { bind: "/", title: "Search sessions", run: focusSearch },
      { bind: "n", title: "New session in project", run: () => { void newSession() } },
      { bind: "a", title: "Show archived or active sessions", run: toggleArchive },
      { bind: "g", title: "Expand all projects", run: () => { void setCollapsed((current) => { Object.keys(current).forEach((key) => delete current[key]) }).catch((error) => fail("Could not save project folding", error)) } },
      { bind: "p", title: "Pin focused session", run: () => { const session = focused()?.session; if (session) local.session.togglePin(session.id) } },
      { bind: "shift+f10", title: "Open session actions", run: () => { const session = focused()?.session; if (session) showMenu(session) } },
      { bind: "ctrl+down", title: "Load more sessions", run: () => { void loadMore() } },
    ],
  }))

  function Row(row: { session: SessionInfo }) {
    const [hovered, setHovered] = createSignal(false)
    const live = () => data.session.get(row.session.id) ?? row.session
    const current = () => selected() === row.session.id
    const active = () => keyboard() && focusedTarget() === list() && focus() === `session-nav-row-${row.session.id}` && !overlay()
    const status = () => sessionTabs.status(row.session.id)
    const busy = () => data.session.status(row.session.id) === "running" || data.session.family(row.session.id).some((id) => data.session.status(id) === "running")
    const label = () => status().attention === "permission" ? "Needs approval" : status().attention === "question" ? "Needs answer" : timeAgo(live().time.updated)
    const dot = () => status().attention || busy() ? "●" : live().outcome === "failed" ? "×" : status().unread !== undefined ? "○" : ""
    const dotColor = () => status().attention ? theme.text.feedback.warning.base : busy() ? theme.text.feedback.success.base
      : live().outcome === "failed" ? theme.text.feedback.error.base : theme.text.muted
    return <box id={`session-nav-row-${row.session.id}`} height={3} flexShrink={0} paddingLeft={1} paddingRight={1}
      backgroundColor={current() || hovered() ? theme.background.raised.high : active() ? theme.background.action.primary.focused : undefined}
      onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
      onMouseDown={(mouse) => {
        if (mouse.button !== MouseButton.RIGHT) return
        mouse.preventDefault(); mouse.stopPropagation()
        setKeyboard(false)
        showMenu(row.session, { x: mouse.x, y: mouse.y + 1 })
      }}
      onMouseUp={(mouse) => {
        if (mouse.button === MouseButton.LEFT) { mouse.stopPropagation(); open(row.session) }
        if (mouse.button === MouseButton.MIDDLE) sessionTabs.close(row.session.id)
      }}>
      <box flexDirection="row" height={1}>
        <text width={2} flexShrink={0} fg={theme.text.formfield.focused}>{active() ? "› " : "  "}</text>
        <text attributes={current() ? TextAttributes.BOLD : undefined} fg={theme.text.base} truncate wrapMode="none" flexGrow={1} minWidth={0}>
          {withTimestampedFallback(live())}
        </text>
        <text width={2} flexShrink={0} fg={dotColor()}>{dot()}</text>
      </box>
      <box flexDirection="row" height={1} paddingLeft={2} gap={1}>
        <text fg={theme.text.muted} truncate wrapMode="none" minWidth={0} flexGrow={1}>
          {data.location.vcs.info(live().location)?.branch.current ?? basename(live().location.directory)}
        </text>
        <text fg={theme.text.muted} flexShrink={0}>{label()}</text>
      </box>
    </box>
  }
  function Button(button: { id: string; children: JSX.Element; run: () => void }) {
    const [hovered, setHovered] = createSignal(false)
    return <box id={button.id} onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
      backgroundColor={hovered() ? theme.background.action.secondary.hovered : undefined}
      onMouseUp={(mouse) => { if (mouse.button === MouseButton.LEFT) button.run() }}>
      <text fg={theme.text.action.secondary.base}>{button.children}</text>
    </box>
  }
  return <box width={width()} flexShrink={0} minHeight={0} backgroundColor={theme.background.raised.base}
    onMouseDown={() => setKeyboard(false)} onMouseMove={() => setKeyboard(false)}>
    <box height={2} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={theme.text.base} attributes={TextAttributes.BOLD}>{archived() ? "Archived" : "Sessions"}</text>
      <Button id="session-nav-new" run={() => { void newSession() }}>+ New</Button>
    </box>
    <box id="session-nav-search-block" height={3} flexShrink={0} marginLeft={2} marginRight={2} marginBottom={1} padding={1}
      backgroundColor={theme.background.formfield.base} onMouseDown={focusSearch}>
      <input id="session-nav-search" ref={setInput} onInput={setQuery} placeholder="Search sessions"
        backgroundColor={theme.background.formfield.base} focusedBackgroundColor={theme.background.formfield.focused}
        textColor={theme.text.formfield.base} focusedTextColor={theme.text.formfield.focused}
        placeholderColor={theme.text.muted} cursorColor={theme.text.base} cursorStyle={config.data.cursor} />
    </box>
    <box id="session-nav-list" focusable ref={setList} flexGrow={1} minHeight={0}
      onMouseDown={() => { rememberFocus(); list()?.focus() }}>
      <scrollbox ref={(value) => { scroll = value }} flexGrow={1} minHeight={0}>
        <For each={groups()}>{(group) => {
          const closed = () => !query().trim() && collapsed[group.key]
          const active = () => keyboard() && focusedTarget() === list() && focus() === `session-nav-group-${group.key}` && !overlay()
          return <box flexShrink={0}>
            <box id={`session-nav-group-${group.key}`} height={2} paddingLeft={1} paddingRight={2} justifyContent="flex-end"
              onMouseUp={(mouse) => { if (mouse.button === MouseButton.LEFT) { focusList(); setKeyboard(false); fold(group.key) } }}>
              <box height={1} flexDirection="row" gap={1}>
                <text fg={theme.text.base}>{closed() ? "▶" : "▼"}</text>
                <text fg={theme.text.base} flexGrow={1} minWidth={0} wrapMode="none" truncate>
                  <b>{group.title}</b><Show when={closed()}><span style={{ fg: theme.text.muted }}> ({group.sessions.length})</span></Show>
                </text>
                <text fg={theme.text.formfield.focused} width={1}>{active() ? "›" : ""}</text>
              </box>
            </box>
            <Show when={!closed()}><For each={group.sessions}>{(session) => <Row session={session} />}</For></Show>
          </box>
        }}</For>
        <Show when={loadError()}>
          <box padding={2} gap={1}><text fg={theme.text.feedback.error.base}>Could not load sessions</text>
            <Button id="session-nav-retry" run={refresh}>Retry</Button></box>
        </Show>
        <Show when={!loadError() && !remote.loading && filtered().length === 0}>
          <text fg={theme.text.muted} padding={2}>{query().trim() ? "No matching sessions" : archived() ? "No archived sessions" : "No sessions yet"}</text>
        </Show>
        <Show when={next()}>
          <box padding={1}><Button id="session-nav-more" run={() => { void loadMore() }}>{loadingMore() ? "Loading…" : "Load more · Ctrl+↓"}</Button></box>
        </Show>
      </scrollbox>
    </box>
    <box height={2} flexShrink={0} paddingLeft={2} paddingRight={2} justifyContent="center">
      <Button id="session-nav-archive" run={toggleArchive}>{archived() ? "‹ Active sessions" : "Archived sessions"}</Button>
    </box>
    <Show when={menu()}>{(state) => <NavContextMenu state={state()} actions={actions()} onClose={() => setMenu(undefined)} />}</Show>
  </box>
}

function NavContextMenu(props: { state: MenuState; actions: NavAction[]; onClose: () => void }) {
  const theme = useTheme().surface("dialog")
  const size = useTerminalDimensions()
  const keymap = Keymap.use()
  const [index, setIndex] = createSignal(0)
  const removeMode = keymap.mode.push("menu")
  onCleanup(removeMode)
  const width = () => Math.min(size().width, Math.max(20, ...props.actions.map((action) => stringWidth(action.title) + 2)))
  const height = () => Math.min(size().height, props.actions.length)
  const run = (index: number) => {
    const action = props.actions[index]
    if (!action) return
    props.onClose()
    action.run()
  }
  Keymap.createLayer(() => ({
    mode: "menu",
    commands: [
      { bind: "escape", title: "Close session menu", run: props.onClose },
      { bind: "ctrl+c", title: "Close session menu", run: props.onClose },
      { bind: "up", title: "Previous session action", run: () => setIndex((value) => (value + props.actions.length - 1) % props.actions.length) },
      { bind: "down", title: "Next session action", run: () => setIndex((value) => (value + 1) % props.actions.length) },
      { bind: "return", title: "Run session action", run: () => run(index()) },
    ],
  }))
  return <Portal ref={(container) => {
    if (!(container instanceof BoxRenderable)) return
    container.position = "absolute"
    container.left = 0
    container.top = 0
    container.zIndex = 2500
  }}>
    <box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={2500} shouldFill={false}
      onMouseDown={(mouse) => { mouse.preventDefault(); mouse.stopPropagation(); props.onClose() }}>
      <box id="session-nav-menu"
        position="absolute" left={Math.max(0, Math.min(props.state.x, size().width - width()))}
        top={Math.max(0, Math.min(props.state.y, size().height - height()))} width={width()} height={height()}
        backgroundColor={theme.background.raised.base}
        onMouseDown={(mouse) => { mouse.preventDefault(); mouse.stopPropagation(); if (mouse.button === MouseButton.RIGHT) props.onClose() }}>
        <For each={props.actions}>{(action, item) =>
          <box id={`session-nav-menu-${action.title.toLowerCase().replaceAll(" ", "-")}`} height={1} paddingLeft={1} paddingRight={1}
            backgroundColor={index() === item() ? theme.background.raised.high : undefined}
            onMouseOver={() => setIndex(item())}
            onMouseUp={(mouse) => { mouse.stopPropagation(); if (mouse.button === MouseButton.LEFT) run(item()) }}>
            <text fg={theme.text.base}>{action.title}</text>
          </box>
        }</For>
      </box>
    </box>
  </Portal>
}
