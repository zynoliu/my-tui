import { BoxRenderable, InputRenderable, MouseButton, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { groupSessions, overflowSessions, sessions, stateLabels, states, truncate, variants, type Session, type SessionState, type Variant } from "./fixtures"

const palettes = {
  dark: { canvas: "#15181c", sidebar: "#1b1f24", text: "#e4e7ec", muted: "#a0a8b4", faint: "#88919f", selected: "#2b394c", hover: "#262c35", field: "#242a33", running: "#91c9a1", attention: "#dfbd80", failed: "#e9a4a4" },
  light: { canvas: "#fafafa", sidebar: "#f0f1f3", text: "#20242b", muted: "#586273", faint: "#636d7b", selected: "#dce6f3", hover: "#e4e7ec", field: "#e5e8ed", running: "#2a6540", attention: "#825600", failed: "#a13232" },
} as const
const variantLabels = { baseline: "Baseline", list: "List / T3", projects: "Projects / VS Code" } as const
const statusMarkers: Readonly<Record<SessionState, string>> = { running: "●", approval: "●", question: "●", unread: "○", idle: "", failed: "×" }
type Region = "search" | "list" | "detail"
type Entry =
  | { readonly kind: "group"; readonly key: string; readonly group: string }
  | { readonly kind: "session"; readonly key: string; readonly group: string; readonly session: Session }
type MenuAction = "pin" | "rename" | "archive" | "restore" | "delete"
type Modal =
  | { readonly kind: "new" }
  | { readonly kind: "menu"; readonly id: string; readonly anchor: { readonly x: number; readonly y: number } }
  | { readonly kind: "rename"; readonly id: string; readonly title: string }
  | { readonly kind: "confirm"; readonly id: string; readonly action: "archive" | "delete" }

export function App(props: { initialVariant?: Variant; initialTheme?: "dark" | "light"; initialDataset?: number; initialStatusStyle?: "dots" | "text" } = {}) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const initialRecords = props.initialDataset === 2 ? [] : props.initialDataset === 1 ? overflowSessions : sessions
  const [records, setRecords] = createSignal<readonly Session[]>(initialRecords)
  const [variant, setVariant] = createSignal<Variant>(props.initialVariant ?? "projects")
  const [theme, setTheme] = createSignal<"dark" | "light">(props.initialTheme ?? "dark")
  const [dataset, setDataset] = createSignal(props.initialDataset ?? 0)
  const [statusStyle, setStatusStyle] = createSignal<"dots" | "text">(props.initialStatusStyle ?? "dots")
  const [activeID, setActiveID] = createSignal("nav")
  const [focusKey, setFocusKey] = createSignal("session-nav")
  const [region, setRegion] = createSignal<Region>("list")
  const [query, setQuery] = createSignal("")
  const [collapsed, setCollapsed] = createSignal<readonly string[]>([])
  const [pins, setPins] = createSignal<readonly string[]>(["adapter"])
  const [overrides, setOverrides] = createSignal<Readonly<Record<string, SessionState>>>({})
  const [archived, setArchived] = createSignal<readonly string[]>([])
  const [archiveView, setArchiveView] = createSignal(false)
  const [modal, setModal] = createSignal<Modal>()
  const [modalIndex, setModalIndex] = createSignal(0)
  const [notice, setNotice] = createSignal("")
  const [keyboardMode, setKeyboardMode] = createSignal(false)
  // These refs belong to the currently mounted regions/dialog; no external state.
  let input: InputRenderable | undefined
  let listBox: BoxRenderable | undefined
  let detailBox: BoxRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let dialogInput: InputRenderable | undefined
  let modalOrigin: Region = "list"
  let draftNumber = 0
  const colors = () => palettes[theme()]
  const narrow = () => dimensions().width < 92
  const sidebarWidth = () => narrow() ? dimensions().width : 38
  const showList = () => !narrow() || region() !== "detail"
  const items = createMemo(() => records().map((item) => ({
    ...item, pinned: pins().includes(item.id), state: overrides()[item.id] ?? item.state,
  })))
  const projects = createMemo(() => [...new Set([...sessions, ...records()].map((item) => item.project))])
  const displayed = createMemo(() => items().filter((item) => archived().includes(item.id) === archiveView()))
  const groups = createMemo(() => groupSessions(displayed(), variant(), query()))
  const entries = createMemo<Entry[]>(() => groups().flatMap((group): Entry[] => [
    { kind: "group", key: `group-${group.key}`, group: group.key },
    ...(query().trim() || !collapsed().includes(group.key)
      ? group.sessions.map((session): Entry => ({ kind: "session", key: `session-${session.id}`, group: group.key, session }))
      : []),
  ]))
  const focused = createMemo(() => entries().find((item) => item.key === focusKey()))
  const active = createMemo(() => items().find((item) => item.id === activeID()))
  const focusedSession = () => {
    if (region() === "detail") return active()
    const entry = focused()
    return entry?.kind === "session" ? entry.session : undefined
  }
  const statusColor = (item: Session) => item.state === "failed" ? colors().failed
    : item.state === "approval" || item.state === "question" ? colors().attention
    : item.state === "running" ? colors().running : colors().muted
  const isWaiting = (item: Session) => item.state === "running" || item.state === "approval" || item.state === "question"

  function focusRegion(next: Region) {
    input?.blur()
    setRegion(next)
    if (next === "search" && showList()) input?.focus()
  }
  function clearSearch() {
    setQuery("")
    if (input) input.value = ""
  }
  function moveFocus(key: string) {
    setFocusKey(key)
    scroll?.scrollChildIntoView(key)
  }
  function open(id: string) {
    setActiveID(id)
    setFocusKey(`session-${id}`)
    focusRegion("detail")
  }
  function toggleGroup(key: string) {
    moveFocus(`group-${key}`)
    setCollapsed((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }
  function toggleArchiveView() {
    clearSearch()
    setArchiveView((value) => !value)
    setCollapsed([])
    focusRegion("list")
  }
  createEffect(() => {
    const list = entries()
    if (!list.some((entry) => entry.key === focusKey())) setFocusKey(list[0]?.key ?? "")
  })
  createEffect(() => {
    if (modal()) return
    switch (region()) {
      case "search": input?.focus(); return
      case "list": listBox?.focus(); return
      case "detail": detailBox?.focus(); return
    }
  })

  function showModal(next: Modal, index = 0) {
    modalOrigin = region()
    input?.blur()
    setModalIndex(index)
    setModal(next)
  }
  function closeModal() {
    dialogInput?.blur()
    dialogInput = undefined
    setModal(undefined)
    focusRegion(modalOrigin)
  }
  function newSession() {
    const entry = region() === "list" ? focused() : undefined
    const project = entry?.kind === "session" ? entry.session.project
      : entry?.kind === "group" && projects().includes(entry.group) ? entry.group
      : active()?.project ?? projects()[0]
    showModal({ kind: "new" }, Math.max(0, projects().findIndex((item) => item === project)))
  }
  function createDraft(project: string) {
    const draft: Session = {
      id: `draft-${++draftNumber}`, title: "New session", project,
      branch: records().find((item) => item.project === project)?.branch ?? "main",
      age: "now", state: "idle", pinned: false,
    }
    closeModal()
    setRecords((current) => [draft, ...current])
    setArchiveView(false)
    setCollapsed([])
    clearSearch()
    open(draft.id)
    setNotice("Local draft created · R resets all changes")
  }
  function menuFor(id: string, anchor?: { x: number; y: number }) {
    const row = renderer.root.findDescendantById(`session-${id}`)
    const target = row && listBox && row.y >= listBox.y && row.y < listBox.y + listBox.height ? row : detailBox
    const position = anchor ?? (target ? { x: target.x, y: target.y } : undefined)
    if (!position) return
    setFocusKey(`session-${id}`)
    showModal({ kind: "menu", id, anchor: position })
  }
  const menuActions = createMemo<readonly { action: MenuAction; label: string }[]>(() => {
    const current = modal()
    if (current?.kind !== "menu") return []
    return [
      { action: "pin", label: pins().includes(current.id) ? "Unpin" : "Pin" },
      { action: "rename", label: "Rename" },
      archived().includes(current.id) ? { action: "restore", label: "Restore" } : { action: "archive", label: "Archive" },
      { action: "delete", label: "Delete" },
    ]
  })
  function removeFromCurrentView(id: string) {
    const remaining = displayed().filter((item) => item.id !== id)
    if (activeID() === id) setActiveID(remaining[0]?.id ?? "")
    setFocusKey(remaining[0] ? `session-${remaining[0].id}` : "")
    focusRegion("list")
  }
  function archiveSession(id: string) {
    removeFromCurrentView(id)
    setOverrides((current) => ({ ...current, [id]: "idle" }))
    setPins((current) => current.filter((item) => item !== id))
    setArchived((current) => [...current, id])
    setNotice("Session archived · A opens archived sessions")
  }
  function deleteSession(id: string) {
    removeFromCurrentView(id)
    setRecords((current) => current.filter((item) => item.id !== id))
    setArchived((current) => current.filter((item) => item !== id))
    setPins((current) => current.filter((item) => item !== id))
    setNotice("Local session deleted · R restores fixture data")
  }
  function runMenu(action: MenuAction, id: string) {
    const item = items().find((item) => item.id === id)
    if (!item) return
    switch (action) {
      case "pin":
        setPins((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
        closeModal()
        return
      case "rename":
        setModal({ kind: "rename", id, title: item.title })
        return
      case "archive":
        if (isWaiting(item)) {
          setModalIndex(0)
          setModal({ kind: "confirm", id, action: "archive" })
          return
        }
        closeModal()
        archiveSession(id)
        return
      case "restore":
        closeModal()
        setArchived((current) => current.filter((value) => value !== id))
        setArchiveView(false)
        setCollapsed([])
        clearSearch()
        open(id)
        setNotice("Session restored to active list")
        return
      case "delete":
        setModalIndex(0)
        setModal({ kind: "confirm", id, action: "delete" })
        return
    }
  }
  function confirmAction(current: Extract<Modal, { kind: "confirm" }>) {
    closeModal()
    if (current.action === "archive") archiveSession(current.id)
    else deleteSession(current.id)
  }
  function submitModal() {
    const current = modal()
    if (!current) return
    switch (current.kind) {
      case "new": {
        const project = projects()[modalIndex()]
        if (project) createDraft(project)
        return
      }
      case "menu": {
        const action = menuActions()[modalIndex()]
        if (action) runMenu(action.action, current.id)
        return
      }
      case "rename": {
        const title = dialogInput?.value.trim()
        if (!title) return
        setRecords((records) => records.map((item) => item.id === current.id ? { ...item, title } : item))
        closeModal()
        return
      }
      case "confirm":
        if (modalIndex() === 0) closeModal()
        else confirmAction(current)
        return
    }
  }
  useKeyboard((key) => {
    setKeyboardMode(true)
    const current = modal()
    if (current) {
      if (key.name === "escape") { key.preventDefault(); closeModal(); return }
      if (key.name === "return") { key.preventDefault(); submitModal(); return }
      if (current.kind === "rename") return
      const count = current.kind === "menu" ? menuActions().length : current.kind === "new" ? projects().length : 2
      if (["up", "down", "left", "right", "tab"].includes(key.name)) {
        key.preventDefault()
        const delta = key.name === "up" || key.name === "left" || (key.name === "tab" && key.shift) ? -1 : 1
        setModalIndex((value) => (value + delta + count) % count)
      }
      return
    }
    if (key.name === "tab") {
      key.preventDefault()
      const regions: readonly Region[] = ["search", "list", "detail"]
      const next = regions[(regions.indexOf(region()) + (key.shift ? 2 : 1)) % 3]
      if (next) focusRegion(next)
      return
    }
    if (key.name === "escape") {
      key.preventDefault()
      if (region() === "search" || query()) {
        clearSearch()
        setFocusKey(`session-${activeID()}`)
      }
      focusRegion("list")
      return
    }
    if (region() === "search") {
      if (key.name === "return" || key.name === "down") { key.preventDefault(); focusRegion("list") }
      return
    }
    if (key.name === "/") { key.preventDefault(); focusRegion("search"); return }
    if (key.name === "n") { key.preventDefault(); newSession(); return }
    if (key.name === "a") { toggleArchiveView(); return }
    if (key.name === "f10" && key.shift) {
      key.preventDefault()
      const item = focusedSession()
      if (item) menuFor(item.id)
      return
    }
    if (key.name === "1" || key.name === "2" || key.name === "3") {
      const next = variants[Number(key.name) - 1]
      if (next) setVariant(next)
      return
    }
    if (key.name === "t") { setTheme((value) => value === "dark" ? "light" : "dark"); return }
    if (key.name === "i") { setStatusStyle((value) => value === "dots" ? "text" : "dots"); return }
    if (key.name === "f4" || key.name === "r") {
      const next = key.name === "r" ? 0 : (dataset() + 1) % 3
      setDataset(next)
      setRecords(next === 2 ? [] : next === 1 ? overflowSessions : sessions)
      setPins(["adapter"]); setArchived([]); setOverrides({}); setCollapsed([])
      setActiveID("nav"); setFocusKey("session-nav"); setArchiveView(false)
      draftNumber = 0
      clearSearch(); focusRegion("list"); setNotice("")
      return
    }
    if (region() !== "list") return
    if (key.name === "g") { setCollapsed([]); return }
    if (key.name === "up" || key.name === "down" || key.name === "home" || key.name === "end") {
      key.preventDefault()
      const list = entries()
      const index = list.findIndex((entry) => entry.key === focusKey())
      const target = key.name === "home" ? 0 : key.name === "end" ? list.length - 1
        : Math.max(0, Math.min(list.length - 1, index + (key.name === "down" ? 1 : -1)))
      const next = list[target]
      if (next) moveFocus(next.key)
      return
    }
    const entry = focused()
    if (!entry) return
    if (key.name === "left") {
      key.preventDefault()
      moveFocus(`group-${entry.group}`)
      if (entry.kind === "group" && !collapsed().includes(entry.group)) setCollapsed((values) => [...values, entry.group])
      return
    }
    if (key.name === "right" && entry.kind === "group") {
      key.preventDefault()
      if (collapsed().includes(entry.group)) setCollapsed((values) => values.filter((value) => value !== entry.group))
      else {
        const first = groups().find((group) => group.key === entry.group)?.sessions[0]
        if (first) moveFocus(`session-${first.id}`)
      }
      return
    }
    if (key.name === "return" || key.name === "space") {
      key.preventDefault()
      if (entry.kind === "group" || key.name === "space") toggleGroup(entry.group)
      else open(entry.session.id)
      return
    }
    if (entry.kind !== "session") return
    if (key.name === "p") {
      const id = entry.session.id
      setPins((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id])
      return
    }
    if (key.name === "s") {
      const next = states[(states.indexOf(entry.session.state) + 1) % states.length]
      if (next) setOverrides((current) => ({ ...current, [entry.session.id]: next }))
    }
  })

  function Row(props: { item: Session }) {
    const [hovered, setHovered] = createSignal(false)
    const selected = () => activeID() === props.item.id
    const keyboardFocus = () => keyboardMode() && focusKey() === `session-${props.item.id}` && region() === "list" && !modal()
    const label = () => props.item.state === "idle" || (statusStyle() === "dots" && !["approval", "question"].includes(props.item.state))
      ? props.item.age : stateLabels[props.item.state]
    return (
      <box id={`session-${props.item.id}`} height={variant() === "baseline" ? 1 : 3} flexShrink={0} paddingLeft={1} paddingRight={1}
        backgroundColor={selected() ? colors().selected : hovered() || keyboardFocus() ? colors().hover : colors().sidebar}
        onMouseOver={() => setHovered(true)} onMouseOut={() => setHovered(false)}
        onMouseDown={(event) => {
          setKeyboardMode(false)
          if (event.button !== MouseButton.RIGHT) return
          event.stopPropagation()
          menuFor(props.item.id, { x: event.x, y: event.y })
        }}
        onMouseUp={(event) => {
          if (event.button !== MouseButton.LEFT || modal()) return
          event.stopPropagation()
          open(props.item.id)
        }}>
        <box flexDirection="row" height={1}>
          <text width={2} fg={colors().text}>{keyboardFocus() ? "› " : "  "}</text>
          <text flexGrow={1} minWidth={0} attributes={selected() ? TextAttributes.BOLD : undefined} fg={colors().text}>
            {truncate(props.item.title, sidebarWidth() - 8)}
          </text>
          <text width={2} flexShrink={0} fg={statusColor(props.item)}>{statusStyle() === "dots" ? statusMarkers[props.item.state] : ""}</text>
        </box>
        <Show when={variant() !== "baseline"}>
          <box height={1} paddingLeft={2} flexDirection="row" justifyContent="space-between">
            <text fg={colors().muted}>{truncate(variant() === "list" || props.item.pinned ? `${props.item.project} / ${props.item.branch}` : props.item.branch, Math.max(6, sidebarWidth() - 8 - Bun.stringWidth(label())))}</text>
            <text fg={statusStyle() === "text" ? statusColor(props.item) : colors().muted}>{label()}</text>
          </box>
        </Show>
      </box>
    )
  }
  function ActionRow(props: { id: string; label: string; index: number; run: () => void; destructive?: boolean; compact?: boolean }) {
    const [hovered, setHovered] = createSignal(false)
    return (
      <box id={props.id} height={1} width="100%" paddingLeft={1} paddingRight={1}
        backgroundColor={props.compact
          ? modalIndex() === props.index || hovered() ? colors().selected : undefined
          : modalIndex() === props.index ? colors().selected : hovered() ? colors().hover : colors().sidebar}
        onMouseOver={() => { setKeyboardMode(false); setHovered(true); setModalIndex(props.index) }} onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => { event.stopPropagation(); if (event.button === MouseButton.LEFT) props.run() }}>
        <text fg={props.destructive ? colors().failed : colors().text}>
          {props.compact ? "" : modalIndex() === props.index ? "› " : "  "}{props.label}
        </text>
      </box>
    )
  }
  function ContextMenu(props: { current: Extract<Modal, { kind: "menu" }> }) {
    const width = () => Math.min(dimensions().width, Math.max(20, ...menuActions().map((action) => Bun.stringWidth(action.label) + 2)))
    const height = () => Math.min(menuActions().length, dimensions().height)
    return (
      <scrollbox id="session-menu" position="absolute"
        left={Math.max(0, Math.min(props.current.anchor.x, dimensions().width - width()))}
        top={Math.max(0, Math.min(props.current.anchor.y + 1, dimensions().height - height()))}
        width={width()} height={height()} scrollX={false} scrollbarOptions={{ visible: false }}
        backgroundColor={colors().field}
        onMouseDown={(event) => {
          if (event.button === MouseButton.RIGHT) closeModal()
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseUp={(event) => event.stopPropagation()}>
        <For each={menuActions()}>{(action, index) =>
          <ActionRow id={`menu-${action.action}`} label={action.label} index={index()} compact
            destructive={action.action === "delete"} run={() => runMenu(action.action, props.current.id)} />
        }</For>
      </scrollbox>
    )
  }
  function ModalBody(props: { current: Exclude<Modal, { kind: "menu" }> }) {
    const current = props.current
    switch (current.kind) {
      case "new":
        return (
          <>
            <text fg={colors().muted}>Choose a project for the local draft.</text>
            <For each={projects()}>{(project, index) => <ActionRow id={`project-choice-${project}`} label={project} index={index()} run={() => createDraft(project)} />}</For>
          </>
        )
      case "rename":
        return (
          <>
            <text fg={colors().muted}>Session title</text>
            <input id="rename-input" ref={(value) => { dialogInput = value; value.value = current.title; value.focus() }}
              backgroundColor={colors().field} focusedBackgroundColor={colors().selected}
              textColor={colors().text} focusedTextColor={colors().text} cursorColor={colors().text} />
            <text fg={colors().muted}>Enter saves · Esc cancels</text>
          </>
        )
      case "confirm":
        return (
          <>
            <text fg={colors().text}>{truncate(items().find((item) => item.id === current.id)?.title ?? "", Math.min(52, dimensions().width - 10))}</text>
            <text fg={colors().muted}>{current.action === "archive" ? "This mock task is running or waiting for you." : "Delete this local session?"}</text>
            <text fg={colors().muted}>{current.action === "archive" ? "Confirming stops the mock task before archiving." : "This is in memory only. R restores fixture data."}</text>
            <ActionRow id="confirm-cancel" label="Cancel" index={0} run={closeModal} />
            <ActionRow id="confirm-accept" label={current.action === "archive" ? "Stop and archive" : "Delete session"} index={1}
              destructive={current.action === "delete"} run={() => confirmAction(current)} />
          </>
        )
    }
  }

  return (
    <box width="100%" height="100%" backgroundColor={colors().canvas} flexDirection="column"
      onMouseDown={() => setKeyboardMode(false)} onMouseMove={() => setKeyboardMode(false)}>
      <box height={2} flexShrink={0} paddingLeft={2} paddingRight={2} justifyContent="center" backgroundColor={colors().sidebar}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors().text} attributes={TextAttributes.BOLD}>Navigation lab</text>
          <text fg={colors().muted}>{variantLabels[variant()]} · {statusStyle() === "dots" ? "Dots" : "Text"}</text>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <Show when={showList()}>
          <box width={sidebarWidth()} flexShrink={0} minHeight={0} backgroundColor={colors().sidebar}>
            <box height={2} paddingLeft={2} paddingRight={2} flexDirection="row" alignItems="center" justifyContent="space-between" flexShrink={0}>
              <text fg={colors().text} attributes={TextAttributes.BOLD}>{archiveView() ? "Archived sessions" : "Sessions"}</text>
              <box id="new-session-button" paddingLeft={1} paddingRight={1}
                onMouseUp={(event) => { if (event.button === MouseButton.LEFT) newSession() }}>
                <text fg={colors().text}>+ New</text>
              </box>
            </box>
            <box id="search-block" height={3} marginLeft={2} marginRight={2} marginBottom={1} padding={1} flexShrink={0}
              backgroundColor={region() === "search" ? colors().selected : colors().field}
              onMouseDown={() => { if (!modal()) focusRegion("search") }}>
              <input id="session-search"
                ref={(value) => { input = value; if (region() === "search" && !modal()) value.focus() }}
                onInput={setQuery} placeholder="/  Search sessions"
                backgroundColor={region() === "search" ? colors().selected : colors().field}
                focusedBackgroundColor={colors().selected} textColor={colors().text} focusedTextColor={colors().text}
                placeholderColor={colors().faint} cursorColor={colors().text} />
            </box>
            <box id="session-list" focusable ref={(value) => { listBox = value; if (region() === "list" && !modal()) value.focus() }}
              flexGrow={1} minHeight={0} onMouseDown={() => { if (!modal()) focusRegion("list") }}>
              <scrollbox ref={(value) => { scroll = value }} flexGrow={1} minHeight={0}>
                <For each={groups()}>{(group) => {
                  const closed = () => !query().trim() && collapsed().includes(group.key)
                  const keyboardFocus = () => keyboardMode() && region() === "list" && focusKey() === `group-${group.key}` && !modal()
                  return (
                    <box flexShrink={0}>
                      <box id={`group-${group.key}`} height={2} paddingLeft={1} paddingRight={2} justifyContent="flex-end"
                        onMouseUp={(event) => { if (event.button === MouseButton.LEFT) { focusRegion("list"); toggleGroup(group.key) } }}>
                        <box flexDirection="row" gap={1} height={1}>
                          <text fg={colors().text}>{closed() ? "▶" : "▼"}</text>
                          <text fg={colors().text} flexGrow={1} minWidth={0} wrapMode="none" truncate>
                            <b>{group.label}</b>
                            <Show when={closed()}><span style={{ fg: colors().muted }}> ({group.sessions.length})</span></Show>
                          </text>
                          <text fg={colors().text} width={1}>{keyboardFocus() ? "›" : ""}</text>
                        </box>
                      </box>
                      <Show when={!closed()}><For each={group.sessions}>{(item) => <Row item={item} />}</For></Show>
                    </box>
                  )
                }}</For>
                <Show when={groups().length === 0}>
                  <box padding={2} gap={1}>
                    <text fg={colors().text}>{query() ? "No matching sessions" : archiveView() ? "No archived sessions" : "No sessions in this fixture"}</text>
                    <text fg={colors().muted}>{query() ? "Esc clears the search." : archiveView() ? "A returns to active sessions." : "N creates a local session."}</text>
                  </box>
                </Show>
              </scrollbox>
            </box>
            <box id="archive-toggle" height={2} flexShrink={0} paddingLeft={2} paddingRight={2} justifyContent="center"
              onMouseUp={(event) => { if (event.button === MouseButton.LEFT) toggleArchiveView() }}>
              <text fg={colors().muted}>{archiveView() ? "‹ Active sessions" : `Archived (${archived().length})`} · A</text>
            </box>
          </box>
        </Show>
        <Show when={!narrow() || region() === "detail"}>
          <box id="detail-pane" focusable ref={(value) => { detailBox = value; if (region() === "detail" && !modal()) value.focus() }}
            flexGrow={1} minWidth={0} paddingLeft={narrow() ? 2 : 4} paddingRight={2} paddingTop={2} gap={1}
            onMouseDown={() => { if (!modal()) focusRegion("detail") }}>
            <text fg={region() === "detail" ? colors().text : colors().muted}>{narrow() ? "Esc · Back to sessions" : region() === "detail" ? "› SELECTED SESSION" : "SELECTED SESSION"}</text>
            <text fg={colors().text} attributes={TextAttributes.BOLD}>{truncate(active()?.title ?? "No session selected", Math.max(8, dimensions().width - (narrow() ? 4 : 44)))}</text>
            <Show when={active()}>{(item) => <>
              <text fg={colors().muted}>{item().project} / {item().branch}</text>
              <text fg={statusColor(item())}>{archived().includes(item().id) ? "Archived · " : ""}{stateLabels[item().state]}</text>
            </>}</Show>
            <box marginTop={2} gap={1}>
              <text fg={colors().text}>Only navigation is under design.</text>
              <text fg={colors().muted}>正文只是比例参照，不接入模型或后端。</text>
              <text fg={colors().muted}>Tab 切换区域，Shift+F10 打开会话菜单。</text>
            </box>
            <box flexGrow={1} />
            <box paddingBottom={1} gap={1}>
              <text fg={colors().muted}>1 Baseline   2 List   3 Projects</text>
              <text fg={colors().faint}>Same fixtures. Same selection. No saved state.</text>
            </box>
          </box>
        </Show>
      </box>
      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={1}>
        <text fg={colors().text}>{truncate(notice() || `Focus: ${region()} · N new · A archive · Shift+F10 actions`, dimensions().width - 3)}</text>
        <text fg={colors().muted}>{dimensions().width < 92 ? "Tab areas · / search · ↑↓ ←→ Enter · Esc" : "Tab areas · / search · ↑↓ move · ←→ fold · Enter open · Shift+F10 actions"}</text>
        <text fg={colors().faint}>{dimensions().width < 92 ? "1/2/3 view · I dots · T theme · R reset · Ctrl+C" : "N new · A archived · P pin · S state · I dots/text · T theme · F4 fixture · R reset · Ctrl+C"}</text>
      </box>
      <Show when={modal()} keyed>{(current) => {
        const width = () => Math.min(60, dimensions().width - 4)
        const id = current.kind === "new" ? "new-session" : current.kind === "rename" ? "rename-session" : "confirm-action"
        return (
          <box id="modal-overlay" position="absolute" left={0} top={0} width="100%" height="100%" zIndex={100}
            alignItems="center" justifyContent="center" shouldFill={false}
            onMouseDown={(event) => {
              if (current.kind !== "menu") return
              closeModal()
              event.preventDefault()
              event.stopPropagation()
            }}
            onMouseUp={(event) => { if (event.button === MouseButton.LEFT) closeModal() }}>
            {current.kind === "menu" ? <ContextMenu current={current} /> : <box id={id} width={width()} maxHeight={Math.max(12, dimensions().height - 2)} backgroundColor={colors().sidebar}
              border borderColor={colors().faint} padding={1} gap={1}
              onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
              <text attributes={TextAttributes.BOLD} fg={colors().text}>
                {current.kind === "new" ? "New session" : current.kind === "rename" ? "Rename session" : current.action === "archive" ? "Stop and archive?" : "Delete session?"}
              </text>
              <ModalBody current={current} />
              <Show when={current.kind !== "rename"}><text fg={colors().muted}>↑↓ choose · Enter select · Esc cancel</text></Show>
            </box>}
          </box>
        )
      }}</Show>
    </box>
  )
}
