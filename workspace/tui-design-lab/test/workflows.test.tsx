import { expect, test } from "bun:test"
import { InputRenderable, MouseButton } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import { sessions } from "../src/fixtures"
import { isSelected } from "./selection"

const fixtureIDs = ["nav", "adapter", "keys", "question", "scroll", "long", "provider", "events"] as const
type Harness = Awaited<ReturnType<typeof testRender>>

async function workflow(run: (ui: ReturnType<typeof controls>) => Promise<void>) {
  const app = await testRender(() => <App />, { width: 120, height: 50, kittyKeyboard: true })
  try {
    await app.renderOnce()
    await run(controls(app))
  } finally {
    app.renderer.destroy()
  }
}

function controls(app: Harness) {
  const find = (id: string) => app.renderer.root.findDescendantById(id)
  const node = (id: string) => {
    const result = find(id)
    expect(result, id).toBeDefined()
    if (!result) throw new Error(`Missing renderable: ${id}`)
    return result
  }
  const text = (id: string) => {
    const target = node(id)
    return app.captureCharFrame().split("\n").slice(target.y, target.y + target.height)
      .map((line) => Bun.sliceAnsi(line, target.x, target.x + target.width)).join("\n")
  }
  const key = async (...args: Parameters<Harness["mockInput"]["pressKey"]>) => {
    app.mockInput.pressKey(...args)
    await app.renderOnce()
  }
  const arrow = async (direction: "up" | "down" | "left" | "right") => {
    app.mockInput.pressArrow(direction)
    await app.renderOnce()
  }
  const click = async (id: string, button: MouseButton.LEFT | MouseButton.RIGHT = MouseButton.LEFT) => {
    const target = node(id)
    const x = target.x + Math.min(1, target.width - 1)
    const y = target.y
    // click() inserts a timer even at delayMs: 0; emit the real mouse pair without one.
    await app.mockMouse.emitMouseEvent("down", x, y, button)
    await app.mockMouse.emitMouseEvent("up", x, y, button)
    await app.renderOnce()
  }
  const menu = async (id: string, action: "pin" | "rename" | "archive" | "restore" | "delete") => {
    await click(`session-${id}`, MouseButton.RIGHT)
    node("session-menu")
    await click(`menu-${action}`)
  }
  const input = (id: string) => {
    const target = node(id)
    expect(target).toBeInstanceOf(InputRenderable)
    if (!(target instanceof InputRenderable)) throw new Error(`Not an input: ${id}`)
    return target
  }
  const type = async (value: string) => {
    await app.mockInput.typeText(value, 0)
    await app.renderOnce()
  }
  return { app, find, node, text, key, arrow, click, menu, input, type }
}

test("keyboard folds every group and unfolds without losing header focus", () => workflow(async (ui) => {
  expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("session-list")
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.arrow("left")
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.arrow("left")
  expect(ui.find("session-nav")).toBeUndefined()
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.arrow("down")
  expect(ui.text("group-bridge-tui")).toContain("›")
  await ui.key("RETURN")
  expect(ui.find("session-events")).toBeUndefined()
  await ui.arrow("up")
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.arrow("up")
  expect(ui.text("session-adapter")).toContain("›")
  await ui.arrow("left")
  expect(ui.text("group-pins")).toContain("›")
  await ui.key(" ")
  for (const id of fixtureIDs) expect(ui.find(`session-${id}`)).toBeUndefined()
  expect(ui.text("group-pins")).toContain("›")

  await ui.arrow("right")
  expect(ui.find("session-adapter")).toBeDefined()
  expect(ui.text("group-pins")).toContain("›")
  await ui.arrow("down")
  expect(ui.text("session-adapter")).toContain("›")
  await ui.arrow("down")
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.key("RETURN")
  expect(ui.find("session-nav")).toBeDefined()
  await ui.key(" ")
  expect(ui.find("session-nav")).toBeUndefined()
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.arrow("right")
  await ui.arrow("down")
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.arrow("up")
  expect(ui.text("group-my-tui")).toContain("›")
  await ui.arrow("down")
  await ui.arrow("down")
  expect(ui.text("session-keys")).toContain("›")
  expect(isSelected(ui.app, "keys")).toBe(false)
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.key("RETURN")
  expect(isSelected(ui.app, "keys")).toBe(true)
  expect(ui.text("detail-pane")).toContain("Review keyboard shortcuts")
}))

test("keyboard cycles real focus regions and Escape clears search", () => workflow(async (ui) => {
  for (const id of ["detail-pane", "session-search", "session-list"]) {
    await ui.key("TAB")
    expect(ui.app.renderer.currentFocusedRenderable?.id).toBe(id)
  }
  for (const id of ["session-search", "detail-pane", "session-list"]) {
    await ui.key("TAB", { shift: true })
    expect(ui.app.renderer.currentFocusedRenderable?.id).toBe(id)
  }
  await ui.key("TAB", { shift: true })
  expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("session-search")
  await ui.type("no_match_987")
  expect(ui.input("session-search").value).toBe("no_match_987")
  for (const id of fixtureIDs) expect(ui.find(`session-${id}`)).toBeUndefined()
  await ui.key("ESCAPE")
  expect(ui.input("session-search").value).toBe("")
  expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("session-list")
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.arrow("down")
  expect(ui.text("session-keys")).toContain("›")
  await ui.key("RETURN")
  expect(ui.text("detail-pane")).toContain("Review keyboard shortcuts")
}))

test.each([
  { launcher: "keyboard", current: "nav", alternate: false, project: "my-tui" },
  { launcher: "keyboard", current: "nav", alternate: true, project: "bridge-tui" },
  { launcher: "button", current: "events", alternate: false, project: "bridge-tui" },
] as const)("new draft uses $project via $launcher (alternate=$alternate)", (scenario) => workflow(async (ui) => {
  if (scenario.current !== "nav") await ui.click(`session-${scenario.current}`)
  if (scenario.launcher === "button") await ui.click("new-session-button")
  else await ui.key("n")
  ui.node("project-choice-my-tui")
  ui.node("project-choice-bridge-tui")
  if (scenario.alternate) {
    await ui.arrow("down")
    await ui.arrow("up")
    await ui.arrow("down")
  }
  await ui.key("RETURN")
  expect(isSelected(ui.app, "draft-1")).toBe(true)
  expect(ui.text("detail-pane")).toContain("New session")
  expect(ui.text("detail-pane")).toContain(scenario.project)
  expect(ui.node("session-draft-1").y).toBeGreaterThan(ui.node(`group-${scenario.project}`).y)
  expect(ui.find("project-choice-my-tui")).toBeUndefined()
}))

test("right mouse menu targets another session without opening it", () => workflow(async (ui) => {
  const selected = ui.text("detail-pane")
  await ui.click("session-events", MouseButton.RIGHT)
  ui.node("session-menu")
  for (const action of ["pin", "rename", "archive", "delete"]) ui.node(`menu-${action}`)
  expect(ui.text("detail-pane")).toBe(selected)
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.arrow("down")
  await ui.key("RETURN")
  ui.node("rename-session")
  expect(ui.input("rename-input").value).toBe("Inspect session events")
  await ui.key("ESCAPE")
  expect(ui.find("rename-session")).toBeUndefined()
  expect(ui.text("detail-pane")).toBe(selected)
  await ui.menu("events", "pin")
  expect(ui.node("session-events").y).toBeLessThan(ui.node("group-my-tui").y)
  expect(ui.text("detail-pane")).toBe(selected)
}))

test("Shift F10 menu supports initial pin and Up Down Enter parity", () => workflow(async (ui) => {
  await ui.arrow("down")
  expect(ui.text("session-keys")).toContain("›")
  await ui.key("F10", { shift: true })
  ui.node("session-menu")
  await ui.key("RETURN")
  expect(ui.node("session-keys").y).toBeLessThan(ui.node("group-my-tui").y)
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.key("F10", { shift: true })
  await ui.arrow("down")
  await ui.arrow("up")
  await ui.arrow("down")
  await ui.key("RETURN")
  ui.node("rename-session")
  expect(ui.input("rename-input").value).toBe("Review keyboard shortcuts")
  await ui.key("ESCAPE")
  expect(ui.find("rename-session")).toBeUndefined()
}))

test("rename commits on Enter and Escape leaves the previous title", () => workflow(async (ui) => {
  await ui.click("session-events")
  await ui.menu("events", "rename")
  expect(ui.input("rename-input").value).toBe("Inspect session events")
  // OpenTUI inputs may bind Ctrl+A to line-start rather than select-all.
  ui.input("rename-input").value = "Renamed events"
  await ui.app.renderOnce()
  await ui.key("RETURN")
  expect(ui.find("rename-session")).toBeUndefined()
  expect(isSelected(ui.app, "events")).toBe(true)
  expect(ui.text("detail-pane")).toContain("Renamed events")
  await ui.menu("events", "rename")
  expect(ui.input("rename-input").value).toBe("Renamed events")
  ui.input("rename-input").value = "Discarded rename"
  await ui.app.renderOnce()
  await ui.key("ESCAPE")
  expect(ui.text("session-events")).toContain("Renamed events")
  expect(ui.text("session-events")).not.toContain("Discarded rename")
  expect(ui.text("detail-pane")).not.toContain("Discarded rename")
}))

test.each(["events", "scroll", "provider"] as const)("%s archives immediately and restores selected to live", (id) => workflow(async (ui) => {
  await ui.menu(id, "archive")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.find(`session-${id}`)).toBeUndefined()
  await ui.key("a")
  ui.node(`session-${id}`)
  expect(ui.find("session-nav")).toBeUndefined()
  await ui.click(`session-${id}`, MouseButton.RIGHT)
  ui.node("menu-restore")
  expect(ui.find("menu-archive")).toBeUndefined()
  await ui.click("menu-restore")
  expect(isSelected(ui.app, id)).toBe(true)
  expect(ui.find("session-nav")).toBeDefined()
  await ui.click("archive-toggle")
  expect(ui.find(`session-${id}`)).toBeUndefined()
  await ui.click("archive-toggle")
  expect(isSelected(ui.app, id)).toBe(true)
}))

test.each([
  { id: "nav", label: "Running", accept: "TAB" },
  { id: "keys", label: "Needs approval", accept: "ARROW_DOWN" },
  { id: "question", label: "Needs answer", accept: "ARROW_RIGHT" },
] as const)("$id archive cancels by default and stops execution only after confirmation", ({ id, label, accept }) => workflow(async (ui) => {
  await ui.click(`session-${id}`)
  expect(ui.text("detail-pane")).toContain(label)
  await ui.menu(id, "archive")
  ui.node("confirm-action")
  ui.node("confirm-cancel")
  ui.node("confirm-accept")
  await ui.key("RETURN")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.find(`session-${id}`)).toBeDefined()
  expect(ui.text("detail-pane")).toContain(label)
  await ui.menu(id, "archive")
  await ui.click("confirm-cancel")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.text("detail-pane")).toContain(label)
  await ui.menu(id, "archive")
  await ui.key(accept)
  await ui.key("RETURN")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.find(`session-${id}`)).toBeUndefined()
  await ui.key("a")
  await ui.click(`session-${id}`)
  expect(ui.text("detail-pane")).toContain("Ready")
  expect(ui.text("detail-pane")).not.toContain(label)
  await ui.menu(id, "restore")
  expect(isSelected(ui.app, id)).toBe(true)
  expect(ui.text("detail-pane")).toContain("Ready")
}))

test("delete cancels by default, confirms explicitly, and reset restores deleted fixtures", () => workflow(async (ui) => {
  await ui.menu("events", "delete")
  ui.node("confirm-action")
  await ui.key("RETURN")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.find("session-events")).toBeDefined()
  await ui.menu("events", "delete")
  await ui.click("confirm-cancel")
  expect(ui.find("session-events")).toBeDefined()
  await ui.menu("events", "delete")
  await ui.key("TAB")
  await ui.key("RETURN")
  expect(ui.find("confirm-action")).toBeUndefined()
  expect(ui.find("session-events")).toBeUndefined()
  await ui.key("a")
  expect(ui.find("session-events")).toBeUndefined()
  await ui.key("a")
  await ui.menu("scroll", "archive")
  await ui.menu("keys", "rename")
  ui.input("rename-input").value = "Temporary title"
  await ui.app.renderOnce()
  await ui.key("RETURN")
  await ui.menu("nav", "pin")
  await ui.key("n")
  await ui.key("RETURN")
  ui.node("session-draft-1")
  await ui.key("r")
  for (const id of fixtureIDs) ui.node(`session-${id}`)
  expect(ui.find("session-draft-1")).toBeUndefined()
  expect(ui.text("session-keys")).toContain("Review keyboard shortcuts")
  expect(ui.text("session-keys")).not.toContain("Temporary title")
  expect(ui.node("session-nav").y).toBeGreaterThan(ui.node("group-my-tui").y)
  expect(ui.node("session-adapter").y).toBeLessThan(ui.node("group-my-tui").y)
  expect(isSelected(ui.app, "nav")).toBe(true)
  expect(ui.text("detail-pane")).toContain("Running")
}))

test("question has its own shipped state, attention circle, and answer label", () => workflow(async (ui) => {
  const question = sessions.find((item) => item.id === "question")
  expect(question).toMatchObject({ title: "Choose navigation behavior", state: "question" })
  expect(ui.text("session-question")).toContain("Choose navigation behavior")
  expect(ui.text("session-question")).toContain("●")
  expect(ui.text("session-question")).toContain("Needs answer")
  expect(ui.text("session-question")).not.toContain("Needs approval")
  expect(ui.text("session-keys")).toContain("Needs approval")
  await ui.click("session-question")
  expect(ui.text("detail-pane")).toContain("Needs answer")
  expect(ui.text("detail-pane")).not.toContain("Needs approval")
}))

test.each([60, 80])("keyboard-only create, rename, archive and restore at %s columns", async (width) => {
  const app = await testRender(() => <App />, { width, height: 30, kittyKeyboard: true })
  const ui = controls(app)
  try {
    await app.renderOnce()
    await ui.key("n")
    await ui.key("RETURN")
    expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("detail-pane")
    expect(ui.text("detail-pane")).toContain("New session")

    await ui.key("F10", { shift: true })
    await ui.arrow("down")
    await ui.key("RETURN")
    expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("rename-input")
    await ui.key("END")
    for (let index = 0; index < "New session".length; index++) await ui.key("BACKSPACE")
    await ui.type("Keyboard draft")
    await ui.key("RETURN")
    expect(ui.text("detail-pane")).toContain("Keyboard draft")

    await ui.key("F10", { shift: true })
    await ui.arrow("down")
    await ui.arrow("down")
    await ui.key("RETURN")
    expect(ui.find("confirm-action")).toBeUndefined()
    expect(ui.find("session-draft-1")).toBeUndefined()
    await ui.key("a")
    await ui.key("HOME")
    await ui.arrow("down")
    await ui.key("F10", { shift: true })
    ui.node("menu-restore")
    await ui.arrow("down")
    await ui.arrow("down")
    await ui.key("RETURN")
    expect(ui.text("detail-pane")).toContain("Keyboard draft")
    await ui.key("ESCAPE")
    expect(isSelected(ui.app, "draft-1")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("active selection has no chevron and keyboard focus hides after pointer movement", () => workflow(async (ui) => {
  expect(isSelected(ui.app, "nav")).toBe(true)
  expect(ui.text("session-nav")).not.toMatch(/[>›]/)
  await ui.arrow("down")
  expect(ui.text("session-keys")).toContain("›")
  expect(isSelected(ui.app, "nav")).toBe(true)
  const row = ui.node("session-keys")
  await ui.app.mockMouse.emitMouseEvent("move", row.x + 1, row.y)
  await ui.app.renderOnce()
  expect(ui.text("session-keys")).not.toContain("›")
  expect(isSelected(ui.app, "nav")).toBe(true)
  await ui.key("RETURN")
  expect(isSelected(ui.app, "keys")).toBe(true)
  expect(ui.text("session-keys")).not.toContain(">")
}))

test("keyboard menu is a four-row borderless surface anchored to its session", () => workflow(async (ui) => {
  await ui.arrow("down")
  const row = ui.node("session-keys")
  await ui.key("F10", { shift: true })
  const menu = ui.node("session-menu")
  expect(menu.height).toBe(4)
  expect(menu.x).toBe(row.x)
  expect(menu.y).toBe(row.y + 1)
  expect(ui.text("session-menu").split("\n").map((line) => line.trim())).toEqual(["Pin", "Rename", "Archive", "Delete"])
  expect(ui.text("session-menu")).not.toMatch(/[›┌┐└┘│─]/)
  await ui.key("ESCAPE")
  expect(ui.find("session-menu")).toBeUndefined()
  expect(isSelected(ui.app, "nav")).toBe(true)
}))

test("clicking outside a menu only dismisses it without triggering the underlying New button", () => workflow(async (ui) => {
  await ui.key("F10", { shift: true })
  await ui.click("new-session-button")
  expect(ui.find("session-menu")).toBeUndefined()
  expect(ui.find("new-session")).toBeUndefined()
  expect(ui.find("session-draft-1")).toBeUndefined()
  expect(isSelected(ui.app, "nav")).toBe(true)
}))

test("compact menus clamp to the viewport and anchor to detail when the narrow list is hidden", async () => {
  const app = await testRender(() => <App />, { width: 60, height: 24, kittyKeyboard: true })
  const ui = controls(app)
  try {
    await app.renderOnce()
    await ui.key("END")
    const row = ui.node("session-events")
    await app.mockMouse.emitMouseEvent("down", row.x + row.width - 2, row.y, MouseButton.RIGHT)
    await app.renderOnce()
    const edgeMenu = ui.node("session-menu")
    expect(edgeMenu.x + edgeMenu.width).toBeLessThanOrEqual(60)
    expect(edgeMenu.y + edgeMenu.height).toBeLessThanOrEqual(24)
    await ui.key("ESCAPE")
    await ui.key("RETURN")
    const pane = ui.node("detail-pane")
    await ui.key("F10", { shift: true })
    expect(ui.node("session-menu").x).toBe(pane.x)
    expect(ui.node("session-menu").y).toBe(pane.y + 1)
    await ui.key("ESCAPE")
    expect(ui.app.renderer.currentFocusedRenderable?.id).toBe("detail-pane")
  } finally {
    app.renderer.destroy()
  }
})
