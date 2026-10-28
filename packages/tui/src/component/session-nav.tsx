import { For, Show, createMemo, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { Portal, useTerminalDimensions } from "@opentui/solid"
import { BoxRenderable, MouseButton, TextAttributes } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
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
import { Keymap } from "../context/keymap"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { groupSessions, partitionWorking } from "../context/session-tabs-model"
import { DialogSessionRename } from "./dialog-session-rename"
import { Spinner } from "./spinner"
import { timeAgo } from "./dialog-open"
import { projectName } from "../util/project"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { SESSION_SIDEBAR_WIDTH } from "../ui/layout"

const GROUP_CAP = 10
const REFETCH_EVENTS = ["session.created", "session.archived", "session.deleted", "session.moved"]

type NavContextMenuState = { x: number; y: number; sessionID: string }

export function SessionNav(props: { width?: number }) {
  const route = useRoute()
  const data = useData()
  const client = useClient()
  const event = useEvent()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const theme = useTheme()
  const toast = useToast()
  const width = () => props.width ?? SESSION_SIDEBAR_WIDTH
  const background = () => theme.background.raised.base
  const hoveredBackground = () => theme.background.raised.high

  const [refetch, bumpRefetch] = createSignal(0)
  const [addHovered, setAddHovered] = createSignal(false)
  const [contextMenu, setContextMenu] = createSignal<NavContextMenuState>()
  const [remote] = createResource(refetch, () =>
    client.api.session
      .list({ limit: 50, order: "desc", parentID: null })
      .then((response) => response.data)
      .catch(() => [] as SessionInfo[]),
  )
  onCleanup(
    event.subscribe((evt) => {
      if (REFETCH_EVENTS.includes(evt.type)) bumpRefetch((count) => count + 1)
    }),
  )

  // Synced copies (active location, live event updates) win over the remote list.
  const sessions = createMemo(() => {
    const seen = new Set<string>()
    return [...data.session.list(), ...(remote() ?? [])].filter((session) => {
      if (session.parentID || seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
  })

  // Pinned sessions older than the remote window still resolve individually.
  const missingPins = createMemo(() => {
    const have = new Set(sessions().map((session) => session.id))
    return local.session.pinned().filter((sessionID) => !have.has(sessionID))
  })
  const [fetchedPins] = createResource(missingPins, async (ids) => {
    const resolved = await Promise.all(ids.map((sessionID) => client.api.session.get({ sessionID }).catch(() => undefined)))
    return resolved.filter((session): session is SessionInfo => session !== undefined && !session.parentID)
  })

  const all = createMemo(() => {
    const seen = new Set(sessions().map((session) => session.id))
    return [...sessions(), ...(fetchedPins() ?? []).filter((session) => !seen.has(session.id))]
  })

  const isWorking = (session: SessionInfo) =>
    Boolean(sessionTabs.status(session.id).attention) ||
    data.session.status(session.id) === "running" ||
    data.session.family(session.id).some((id) => data.session.status(id) === "running")

  const nav = createMemo(() => {
    const list = all()
    const pinnedIDs = new Set(local.session.pinned())
    const pinned = local.session
      .pinned()
      .map((sessionID) => list.find((session) => session.id === sessionID))
      .filter((session): session is SessionInfo => session !== undefined)
    const { working, rest } = partitionWorking(
      list.filter((session) => !pinnedIDs.has(session.id)),
      isWorking,
    )
    return { pinned, working, rest }
  })

  const groups = createMemo(() => groupSessions(nav().rest, { cap: GROUP_CAP }))

  // Collapsed groups surface how many sessions inside still need attention.
  const badges = createMemo(() => {
    const counts = new Map<string, number>()
    for (const session of nav().rest) {
      const status = sessionTabs.status(session.id)
      if (!status.attention && status.unread === undefined) continue
      counts.set(session.projectID, (counts.get(session.projectID) ?? 0) + 1)
    }
    return counts
  })

  const [collapsed, setCollapsed] = useStorage().store<Record<string, boolean>>("session-nav-collapsed", {
    initial: {},
  })
  const toggleGroup = (key: string) => void setCollapsed((draft) => void (draft[key] = !draft[key]))

  const openTabIDs = createMemo(() => new Set(sessionTabs.tabs().map((tab) => tab.sessionID)))
  const currentID = () => (route.data.type === "session" ? data.session.root(route.data.sessionID) : undefined)

  const open = (sessionID: string) => route.navigate({ type: "session", sessionID })
  const close = (sessionID: string) => {
    if (openTabIDs().has(sessionID)) sessionTabs.close(sessionID)
  }

  const groupLabel = (key: string, fallback: string | undefined) =>
    Locale.truncate(
      projectName(data.project.get(key), fallback ?? "") ?? "Unknown project",
      Math.max(4, width() - 8),
    )

  const statusGlyph = (session: SessionInfo) => {
    const status = sessionTabs.status(session.id)
    if (status.attention) {
      return (
        <text fg={theme.text.feedback.warning.base} attributes={TextAttributes.BOLD}>
          {status.attention === "permission" ? "!" : "?"}
        </text>
      )
    }
    const running =
      data.session.status(session.id) === "running" ||
      data.session.family(session.id).some((id) => data.session.status(id) === "running")
    if (running) return <Spinner color={theme.text.base} />
    if (session.outcome === "failed") return <text fg={theme.text.feedback.error.base}>✗</text>
    if (openTabIDs().has(session.id)) return <text fg={theme.text.formfield.selected}>▪</text>
    return undefined
  }

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => route.data.type === "session",
    commands: [
      {
        id: "session.pin.toggle",
        title: "Pin or unpin session",
        group: "Session",
        palette: true,
        run: () => {
          if (route.data.type !== "session") return
          const sessionID = data.session.root(route.data.sessionID)
          local.session.togglePin(sessionID)
          toast.show({
            message: local.session.isPinned(sessionID) ? "Session pinned" : "Session unpinned",
            variant: "info",
          })
        },
      },
    ],
  }))

  return (
    <box width={width()} flexShrink={0} flexDirection="column" backgroundColor={background()} minHeight={0}>
      <scrollbox flexGrow={1} minHeight={0}>
        <Show when={nav().pinned.length > 0}>
          <text fg={theme.text.muted} paddingLeft={1} paddingRight={1} attributes={TextAttributes.BOLD}>
            ★ Pinned
          </text>
          <For each={nav().pinned}>
            {(session) => (
              <NavRow
                session={session}
                active={() => currentID() === session.id}
                glyph={() => statusGlyph(session)}
                onOpen={() => open(session.id)}
                onClose={() => close(session.id)}
                onMenu={(x, y) => setContextMenu({ x, y, sessionID: session.id })}
              />
            )}
          </For>
        </Show>
        <Show when={nav().working.length > 0}>
          <text fg={theme.text.muted} paddingLeft={1} paddingRight={1} attributes={TextAttributes.BOLD}>
            ● Working {nav().working.length}
          </text>
          <For each={nav().working}>
            {(session) => (
              <NavRow
                session={session}
                active={() => currentID() === session.id}
                glyph={() => statusGlyph(session)}
                onOpen={() => open(session.id)}
                onClose={() => close(session.id)}
                onMenu={(x, y) => setContextMenu({ x, y, sessionID: session.id })}
              />
            )}
          </For>
        </Show>
        <For each={groups()}>
          {(group) => {
            const isCollapsed = () => collapsed[group.key] ?? false
            const badge = () => badges().get(group.key) ?? 0
            return (
              <>
                <box
                  height={1}
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="row"
                  onMouseUp={(mouseup) => {
                    if (mouseup.button !== MouseButton.LEFT) return
                    toggleGroup(group.key)
                  }}
                >
                  <text fg={theme.text.muted} attributes={TextAttributes.BOLD}>
                    {isCollapsed() ? "▸" : "▼"} {groupLabel(group.key, group.sessions[0]?.location.directory)}
                  </text>
                  <Show when={isCollapsed() && badge() > 0}>
                    <text fg={theme.text.feedback.warning.base}> ⚠{badge()}</text>
                  </Show>
                </box>
                <Show when={!isCollapsed()}>
                  <For each={group.sessions}>
                    {(session) => (
                      <NavRow
                        session={session}
                        active={() => currentID() === session.id}
                        glyph={() => statusGlyph(session)}
                        onOpen={() => open(session.id)}
                        onClose={() => close(session.id)}
                        onMenu={(x, y) => setContextMenu({ x, y, sessionID: session.id })}
                      />
                    )}
                  </For>
                  <Show when={group.overflow > 0}>
                    <text fg={theme.text.muted} paddingLeft={2}>
                      +{group.overflow} more
                    </text>
                  </Show>
                </Show>
              </>
            )
          }}
        </For>
        <Show when={all().length === 0 && !remote.loading}>
          <text fg={theme.text.muted} paddingLeft={1} paddingRight={1}>
            No sessions yet
          </text>
        </Show>
      </scrollbox>
      <box
        height={1}
        paddingLeft={1}
        flexShrink={0}
        backgroundColor={addHovered() ? hoveredBackground() : undefined}
        onMouseOver={() => setAddHovered(true)}
        onMouseOut={() => setAddHovered(false)}
        onMouseUp={(mouseup) => {
          if (mouseup.button !== MouseButton.LEFT) return
          sessionTabs.newTab()
        }}
      >
        <text fg={theme.text.muted}>+ New session</text>
      </box>
      <Show when={contextMenu()}>
        {(state) => <NavContextMenu state={state()} onClose={() => setContextMenu(undefined)} />}
      </Show>
    </box>
  )
}

function NavRow(props: {
  session: SessionInfo
  active: () => boolean
  glyph: () => JSX.Element | undefined
  onOpen: () => void
  onClose: () => void
  onMenu: (x: number, y: number) => void
}) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const rowBackground = () =>
    props.active() ? theme.background.action.primary.selected : hovered() ? theme.background.raised.high : undefined
  return (
    <box
      height={1}
      width="100%"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={rowBackground()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(mouseup) => {
        if (mouseup.button === MouseButton.MIDDLE) return props.onClose()
        if (mouseup.button === MouseButton.LEFT) return props.onOpen()
      }}
      onMouseDown={(mousedown) => {
        if (mousedown.button !== MouseButton.RIGHT) return
        mousedown.preventDefault()
        mousedown.stopPropagation()
        props.onMenu(mousedown.x, mousedown.y)
      }}
    >
      <box width={2} flexShrink={0}>
        {props.glyph()}
      </box>
      <text flexGrow={1} truncate fg={theme.text.base}>
        {withTimestampedFallback(props.session)}
      </text>
      <text fg={theme.text.muted}>{timeAgo(props.session.time.updated)}</text>
    </box>
  )
}

function NavContextMenu(props: { state: NavContextMenuState; onClose: () => void }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const dialog = useDialog()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()
  const sessionTabs = useSessionTabs()
  const [selected, setSelected] = createSignal<number>()
  onCleanup(Keymap.use().mode.push("menu"))
  Keymap.createLayer(() => ({
    mode: "menu",
    commands: [{ bind: "escape,ctrl+c", title: "Close session menu", group: "Sessions", run: props.onClose }],
  }))
  const actions = createMemo<Array<{ title: string; run?: () => void }>>(() => {
    const sessionID = props.state.sessionID
    const pinned = local.session.isPinned(sessionID)
    const open = sessionTabs.tabs().some((tab) => tab.sessionID === sessionID)
    return [
      {
        title: pinned ? "Unpin" : "Pin to top",
        run: () => local.session.togglePin(sessionID),
      },
      ...(open ? [{ title: "Close tab", run: () => sessionTabs.close(sessionID) }] : []),
      {
        title: "Rename",
        run: () => DialogSessionRename.show(dialog, sessionID),
      },
      {
        title: "Copy session ID",
        run: () =>
          void clipboard
            .write(sessionID)
            .then(() => toast.show({ message: "Session ID copied to clipboard", variant: "info" }))
            .catch(toast.error),
      },
    ]
  })
  const width = () =>
    Math.min(
      dimensions().width,
      Math.max(20, ...actions().map((action) => Math.min(50, stringWidth(action.title) + 2))),
    )
  const height = () => Math.min(actions().length, dimensions().height)
  const top = () => Math.max(0, Math.min(props.state.y + 1, dimensions().height - height()))
  const left = () => Math.max(0, Math.min(props.state.x, dimensions().width - width()))
  const run = (index: number) => {
    const action = actions()[index]
    if (!action?.run) return
    props.onClose()
    action.run()
  }
  return (
    <Portal
      ref={(container) => {
        if (!(container instanceof BoxRenderable)) return
        container.position = "absolute"
        container.left = 0
        container.top = 0
        container.zIndex = 2500
      }}
    >
      <box
        position="absolute"
        left={0}
        top={0}
        width={dimensions().width}
        height={dimensions().height}
        zIndex={2500}
        onMouseDown={(mousedown) => {
          props.onClose()
          mousedown.preventDefault()
          mousedown.stopPropagation()
        }}
      >
        <scrollbox
          position="absolute"
          left={left()}
          top={top()}
          height={height()}
          width={width()}
          scrollX={false}
          scrollbarOptions={{ visible: false }}
          backgroundColor={theme.background.raised.base}
          onMouseDown={(mousedown) => {
            if (mousedown.button === MouseButton.RIGHT) props.onClose()
            mousedown.preventDefault()
            mousedown.stopPropagation()
          }}
        >
          <For each={actions()}>
            {(action, index) => (
              <box
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                height={1}
                flexShrink={0}
                backgroundColor={action.run && selected() === index() ? theme.background.raised.high : undefined}
                onMouseOver={() => setSelected(action.run ? index() : undefined)}
                onMouseOut={() => setSelected(undefined)}
                onMouseUp={(mouseup) => {
                  mouseup.preventDefault()
                  mouseup.stopPropagation()
                  if (mouseup.button === MouseButton.RIGHT) return
                  run(index())
                }}
              >
                <text fg={action.run ? theme.text.base : theme.text.muted} selectable={false} truncate>
                  {action.title}
                </text>
              </box>
            )}
          </For>
        </scrollbox>
      </box>
    </Portal>
  )
}
