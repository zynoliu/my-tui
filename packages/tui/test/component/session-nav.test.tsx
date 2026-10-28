import { expect, test } from "bun:test"
// allow: SIZE_OK - Single-file integration deliverable; scenarios share one wire-level app fixture.
import { InputRenderable, MouseButton, TextareaRenderable } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { Schema } from "effect"
import type { Config } from "../../src/config"
import { createAppFixture } from "../fixture/app"
import { directory, json, type FetchHandler } from "../fixture/tui-client"

function session(id: string, projectID: string): SessionInfo {
  return {
    id, projectID, title: id === "ses_alpha" ? "Alpha task" : "Beta task",
    location: { directory: projectID === "proj_alpha" ? directory : "/fixture/beta" },
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    outcome: "failed", time: { created: 1, updated: 30, idle: 20, viewed: 10 },
  }
}

async function fixture(override?: FetchHandler, config?: Config.Info) {
  // Mutable wire state is the authoritative server, not a mocked client.
  const records = new Map(["alpha", "beta"].map((key) => [`ses_${key}`, session(`ses_${key}`, `proj_${key}`)]))
  const writes: string[] = []
  const setup = await createAppFixture({
    width: 140, height: 42, args: { sessionID: "ses_alpha" },
    config: { animations: false, tabs: { mode: "on", layout: "vertical", scope: "global" }, ...config },
    fetch: async (url, request) => {
      if (request.method !== "GET") writes.push(`${request.method} ${url.pathname}`)
      const response = await override?.(url, request)
      if (response) return response
      if (url.pathname === "/api/project") return json(["alpha", "beta"].map((key) => ({
        id: `proj_${key}`, name: `${key} project`, canonical: key === "alpha" ? directory : "/fixture/beta",
        time: { created: 1, updated: 2, active: 2 }, sandboxes: [],
      })))
      if (url.pathname === "/api/session" && request.method === "GET") return json({
        data: url.searchParams.get("parentID") && url.searchParams.get("parentID") !== "null" ? [] :
          [...records.values()].filter((item) => (item.time.archived !== undefined) === (url.searchParams.get("archived") === "true")),
        cursor: {},
      })
      const id = url.pathname.split("/")[3] ?? ""
      const record = records.get(id)
      if (!record) return undefined
      if (/\/(message|inbox|permission|form)$/.test(url.pathname)) return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/view")) {
        const body = Schema.decodeUnknownSync(Schema.Struct({ idle: Schema.Number }))(await request.json())
        records.set(id, { ...record, time: { ...record.time, viewed: body.idle } })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${id}`) {
        if (request.method === "DELETE") { records.delete(id); return new Response(null, { status: 204 }) }
        if (request.method === "PATCH") {
          const body = Schema.decodeUnknownSync(Schema.Struct({
            archived: Schema.optional(Schema.Boolean), title: Schema.optional(Schema.String),
          }))(await request.json())
          const { archived, ...time } = record.time
          records.set(id, { ...record, title: body.title ?? record.title,
            time: body.archived === undefined ? record.time : body.archived ? { ...time, archived: 40 } : time })
          return new Response(null, { status: 204 })
        }
        return json({ data: records.get(id) })
      }
      return undefined
    },
  })
  const node = (id: string) => {
    const result = setup.renderer.root.findDescendantById(id)
    if (!result) throw new Error(`Missing renderable: ${id}\n${setup.captureCharFrame()}`)
    return result
  }
  const click = async (id: string) => {
    await setup.renderOnce()
    const target = node(id)
    setup.renderer.clearSelection()
    await setup.mockMouse.click(target.x + 1, target.y)
  }
  const menu = async (action: string, id = "ses_beta") => {
    await setup.renderOnce()
    const row = node(`session-nav-row-${id}`)
    setup.renderer.clearSelection()
    await setup.mockMouse.click(row.x + 2, row.y, MouseButton.RIGHT)
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById(`session-nav-menu-${action}`)))
    const index = node("session-nav-menu").getChildren().findIndex((child) => child.id === `session-nav-menu-${action}`)
    expect(index).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < index; i++) setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await setup.waitForFrame(() => !setup.renderer.root.findDescendantById("session-nav-menu"))
  }
  try {
    await setup.ready
    await setup.waitForFrame(() => Boolean(setup.renderer.root.findDescendantById("session-nav-row-ses_beta")) &&
      setup.renderer.currentFocusedEditor !== null)
  } catch (error) {
    await setup[Symbol.asyncDispose]()
    throw error
  }
  return Object.assign(setup, { records, writes, node, click, menu })
}

test.each(["default", "configured"] as const)("%s shortcuts preserve composer focus and search Escape restores it", async (binding) => {
  // Given
  await using app = await fixture(undefined, binding === "configured"
    ? { keybinds: { "session.nav.focus": "alt+j", "session.nav.search": "alt+k" } } : {})
  const editor = app.renderer.currentFocusedRenderable
  // When
  await app.mockInput.typeText("nag p")
  app.mockInput.pressTab()
  await app.renderOnce()
  // Then
  expect(app.renderer.currentFocusedRenderable).toBe(editor)
  expect(app.captureCharFrame()).toContain("nag p")
  app.mockInput.pressKey(binding === "configured" ? "j" : "o", { meta: true })
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-list")
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable === editor)
  app.mockInput.pressKey(binding === "configured" ? "k" : "f", { meta: true })
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-search")
  await app.mockInput.typeText("Beta")
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable === editor)
  const search = app.node("session-nav-search")
  if (!(search instanceof InputRenderable)) throw new Error("Search must be an input")
  expect(search.value).toBe("")
  expect(app.captureCharFrame()).toContain("Alpha task")
})

test("keyboard headings reopen when every project is folded and G expands all", async () => {
  // Given
  await using app = await fixture()
  app.mockInput.pressKey("o", { meta: true })
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-list")
  // When
  app.mockInput.pressKey("HOME")
  await app.renderOnce()
  expect(app.renderer.currentFocusedRenderable?.id).toBe("session-nav-list")
  await app.waitForFrame((frame) => frame.split("\n").some((line) => line.includes("alpha project") && line.includes("›")))
  app.mockInput.pressArrow("left")
  await app.waitForFrame(() => !app.renderer.root.findDescendantById("session-nav-row-ses_alpha"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressKey(" ")
  await app.waitForFrame((frame) => !frame.includes("Alpha task") && !frame.includes("Beta task"))
  // Then
  expect(app.renderer.currentFocusedRenderable?.id).toBe("session-nav-list")
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Beta task"))
  app.mockInput.pressKey("g")
  await app.waitForFrame((frame) => frame.includes("Alpha task") && frame.includes("Beta task"))
})

test("question and permission APIs produce distinct native attention labels", async () => {
  // Given
  await using app = await fixture((url) => {
    if (url.pathname === "/api/session/ses_alpha/form") return json({ data: [{
      id: "frm_alpha", sessionID: "ses_alpha", title: "Choose", fields: [{ key: "answer", type: "string", title: "Answer" }],
    }] })
    if (url.pathname === "/api/session/ses_beta/permission") return json({ data: [{
      id: "per_beta", sessionID: "ses_beta", action: "shell", resources: ["pwd"],
    }] })
  })
  // When / Then
  await app.waitForFrame((frame) => frame.includes("Needs answer") && frame.includes("Needs approval"))
  expect(app.captureCharFrame()).toContain("Needs answer")
  expect(app.captureCharFrame()).toContain("Needs approval")
})

test("server search and Ctrl-Down append the authoritative cursor page", async () => {
  // Given
  const requested = Promise.withResolvers<URL>()
  const late = { ...session("ses_late", "proj_beta"), title: "Beta remote" }
  await using app = await fixture((url) => {
    if (url.pathname !== "/api/session" || url.searchParams.get("search") !== "Beta") return
    if (url.searchParams.has("cursor")) { requested.resolve(url); return json({ data: [late], cursor: {} }) }
    return json({ data: [session("ses_beta", "proj_beta")], cursor: { next: "beta-page-2" } })
  })
  // When
  app.mockInput.pressKey("f", { meta: true })
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-search")
  await app.mockInput.typeText("Beta")
  await app.waitForFrame(() => Boolean(app.renderer.root.findDescendantById("session-nav-more")))
  app.mockInput.pressEnter()
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-list")
  app.mockInput.pressArrow("down", { ctrl: true })
  // Then
  await app.waitForFrame((frame) => frame.includes("Beta remote"))
  const url = await requested.promise
  expect(url.searchParams.get("cursor")).toBe("beta-page-2")
  expect(url.searchParams.get("search")).toBe("Beta")
  expect(url.searchParams.get("archived")).toBe("false")
  expect(app.captureCharFrame()).toContain("Beta task")
  expect(app.renderer.root.findDescendantById("session-nav-more")).toBeUndefined()
})

test("New chooses a project's canonical directory without creating a fake session", async () => {
  // Given
  const location = Promise.withResolvers<string>()
  await using app = await fixture((url) => {
    if (url.pathname === "/api/location" && url.searchParams.get("location[directory]") === "/fixture/beta") {
      location.resolve("/fixture/beta")
      return json({ directory: "/fixture/beta", project: { id: "proj_beta", directory: "/fixture/beta", canonical: "/fixture/beta" } })
    }
  })
  app.records.delete("ses_beta")
  app.events.emit({ id: "evt_project_only", created: 40, type: "session.deleted",
    durable: { aggregateID: "ses_beta", seq: 1, version: 2 }, data: { sessionID: "ses_beta" } })
  await app.waitForFrame(() => !app.renderer.root.findDescendantById("session-nav-row-ses_beta"))
  // When
  await app.click("session-nav-new")
  await app.waitForFrame((frame) => frame.includes("New session in project") && app.renderer.currentFocusedRenderable instanceof InputRenderable)
  await app.mockInput.typeText("beta project")
  await app.renderOnce()
  app.mockInput.pressEnter()
  // Then
  expect(await location.promise).toBe("/fixture/beta")
  await app.waitForFrame((frame) => !frame.includes("New session in project"))
  expect(app.writes).not.toContain("POST /api/session")
})

test.each(["mouse", "keyboard"] as const)("native %s menu anchors to its row and Escape cancels", async (method) => {
  // Given
  await using app = await fixture()
  const row = app.node("session-nav-row-ses_alpha")
  // When
  if (method === "mouse") await app.mockMouse.click(row.x + 2, row.y, MouseButton.RIGHT)
  if (method === "keyboard") {
    app.mockInput.pressKey("o", { meta: true })
    await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-nav-list")
    app.mockInput.pressKey("F10", { shift: true })
  }
  await app.waitForFrame(() => Boolean(app.renderer.root.findDescendantById("session-nav-menu")))
  await app.renderOnce()
  const position = { x: app.node("session-nav-menu").x, y: app.node("session-nav-menu").y }
  // Then
  expect(app.node("session-nav-menu-copy-session-id")).toBeDefined()
  expect(app.node("session-nav-menu-close-tab")).toBeDefined()
  app.mockInput.pressEscape()
  await app.waitForFrame(() => !app.renderer.root.findDescendantById("session-nav-menu"))
  expect(app.records.size).toBe(2)
  expect(position.y).toBe(row.y + 1)
  expect(position.x).toBe(row.x + (method === "mouse" ? 2 : 0))
})

test("idle archive preserves failed unread metadata and restore selects the real session", async () => {
  // Given
  await using app = await fixture()
  // When
  await app.menu("archive")
  await app.waitForFrame((frame) => frame.includes("Session archived") && !app.renderer.root.findDescendantById("session-nav-row-ses_beta"))
  // Then
  expect(app.records.get("ses_beta")).toMatchObject({ outcome: "failed", time: { idle: 20, viewed: 10, archived: 40 } })
  expect(app.writes).not.toContain("POST /api/session/ses_beta/interrupt")
  await app.click("session-nav-archive")
  await app.waitForFrame(() => Boolean(app.renderer.root.findDescendantById("session-nav-row-ses_beta")))
  await app.menu("restore")
  await app.waitForFrame((frame) => frame.includes("Session restored") && frame.includes("Sessions"))
  expect(app.records.get("ses_beta")?.time.archived).toBeUndefined()
  expect(app.records.get("ses_beta")?.outcome).toBe("failed")
  await app.waitForFrame((frame) => frame.includes("/fixture/beta"))
  expect(app.records.get("ses_beta")?.time.idle).toBe(20)
})

test.each(["delete", "archive"] as const)("%s confirmation initially cancels on Enter", async (action) => {
  // Given
  await using app = await fixture(action === "archive" ? (url) => url.pathname === "/api/session/ses_beta/permission"
    ? json({ data: [{ id: "per_beta", sessionID: "ses_beta", action: "shell", resources: ["pwd"] }] }) : undefined : undefined)
  if (action === "archive") await app.waitForFrame((frame) => frame.includes("Needs approval"))
  // When
  await app.menu(action)
  await app.waitForFrame((frame) => frame.includes(action === "delete" ? "Delete session?" : "Stop and archive session?"))
  app.mockInput.pressEnter()
  // Then
  await app.waitForFrame((frame) => !frame.includes(action === "delete" ? "Delete session?" : "Stop and archive session?"))
  expect(app.records.get("ses_beta")?.time.archived).toBeUndefined()
  expect(app.node("session-nav-row-ses_beta")).toBeDefined()
  expect(app.writes.filter((write) => /PATCH|DELETE|interrupt/.test(write))).toEqual([])
})

test("confirmed attention archive interrupts before rejecting permission and cancelling form", async () => {
  // Given
  const pending = { permission: true, form: true, interrupted: false, decision: "" }
  await using app = await fixture(async (url, request) => {
    if (url.pathname === "/api/session/ses_beta/interrupt") {
      pending.interrupted = true
      return json({})
    }
    if (url.pathname === "/api/session/ses_beta/permission/per_beta/reply") {
      expect(pending.interrupted).toBe(true)
      pending.decision = Schema.decodeUnknownSync(Schema.Struct({ decision: Schema.String }))(await request.json()).decision
      pending.permission = false
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/ses_beta/form/frm_beta" && request.method === "DELETE") {
      expect(pending.interrupted).toBe(true)
      pending.form = false
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session/ses_beta/permission") return json({ data: pending.permission
      ? [{ id: "per_beta", sessionID: "ses_beta", action: "shell", resources: ["pwd"] }] : [] })
    if (url.pathname === "/api/session/ses_beta/form") return json({ data: pending.form
      ? [{ id: "frm_beta", sessionID: "ses_beta", title: "Choose", fields: [{ key: "answer", type: "string", title: "Answer" }] }] : [] })
  })
  await app.waitForFrame((frame) => frame.includes("Needs approval"))
  // When
  await app.menu("archive")
  await app.waitForFrame((frame) => frame.includes("Stop and archive session?"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  // Then
  await app.waitForFrame((frame) => frame.includes("Session archived") && !app.renderer.root.findDescendantById("session-nav-row-ses_beta"))
  expect(pending).toEqual({ permission: false, form: false, interrupted: true, decision: "reject" })
  expect(app.records.get("ses_beta")).toMatchObject({ outcome: "failed", time: { idle: 20, viewed: 10, archived: 40 } })
})

test("native rename updates the authoritative title and row", async () => {
  // Given
  await using app = await fixture()
  await app.menu("rename")
  await app.waitForFrame((frame) => frame.includes("Rename session") &&
    app.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  // When
  for (const _ of "Beta task") app.mockInput.pressBackspace()
  await app.mockInput.typeText("Renamed beta")
  app.mockInput.pressEnter()
  await app.waitForFrame(() => app.records.get("ses_beta")?.title === "Renamed beta")
  app.events.emit({ id: "evt_renamed", created: 40, type: "session.renamed",
    durable: { aggregateID: "ses_beta", seq: 1, version: 1 }, data: { sessionID: "ses_beta", title: "Renamed beta" } })
  // Then
  await app.waitForFrame((frame) => frame.includes("Renamed beta") && !frame.includes("Rename session"))
  expect(app.records.get("ses_beta")?.title).toBe("Renamed beta")
})

test.each(["archive", "delete"] as const)("rejected %s retains the row with visible feedback", async (action) => {
  // Given
  await using app = await fixture((url, request) => url.pathname === "/api/session/ses_beta" &&
    request.method === (action === "archive" ? "PATCH" : "DELETE") ? new Response("Rejected", { status: 503 }) : undefined)
  // When
  await app.menu(action)
  if (action === "delete") {
    await app.waitForFrame((frame) => frame.includes("Delete session?"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
  }
  // Then
  await app.waitForFrame((frame) => frame.includes(`Could not ${action} session`))
  expect(app.node("session-nav-row-ses_beta")).toBeDefined()
  expect(app.records.get("ses_beta")?.time.archived).toBeUndefined()
})

test.each(["session.deleted", "session.archived"] as const)("%s events remove membership without stale resurrection", async (type) => {
  // Given
  const requested = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  let refreshing = false
  await using app = await fixture((url) => {
    if (refreshing && url.pathname === "/api/session" && url.searchParams.get("parentID") === "null") {
      requested.resolve()
      return response.promise.then((result) => result.clone())
    }
  })
  await app.menu("pin")
  await app.waitForFrame(() => Boolean(app.renderer.root.findDescendantById("session-nav-group-pinned")))
  if (type === "session.archived") {
    const beta = app.records.get("ses_beta")
    if (!beta) throw new Error("Missing beta fixture")
    app.records.set(beta.id, { ...beta, time: { ...beta.time, archived: 50 } })
  }
  // When
  refreshing = true
  if (type === "session.deleted") app.events.emit({ id: "evt_membership", created: 50, type,
    durable: { aggregateID: "ses_beta", seq: 1, version: 2 }, data: { sessionID: "ses_beta" } })
  else app.events.emit({ id: "evt_membership", created: 50, type,
    durable: { aggregateID: "ses_beta", seq: 1, version: 1 }, data: { sessionID: "ses_beta" } })
  try {
    await requested.promise
    response.resolve(json({ data: [session("ses_beta", "proj_beta"),
      { ...session("ses_probe", "proj_alpha"), title: "Refetch committed" }], cursor: {} }))
    // Then: the sentinel proves the stale response has actually been rendered.
    await app.waitForFrame((frame) => frame.includes("Refetch committed"))
    expect(Boolean(app.renderer.root.findDescendantById("session-nav-row-ses_beta"))).toBe(false)
  } finally {
    response.resolve(json({ data: [], cursor: {} }))
  }
})
