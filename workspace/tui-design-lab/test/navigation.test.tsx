import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { App } from "../src/app"
import { groupSessions, sessions, truncate, variants } from "../src/fixtures"
import { isSelected } from "./selection"

test.each([...variants])("%s partitions matching sessions exactly once", (variant) => {
  const groups = groupSessions(sessions, variant, "")
  const ids = groups.flatMap((group) => group.sessions.map((item) => item.id))
  expect(ids).toHaveLength(sessions.length)
  expect(new Set(ids).size).toBe(sessions.length)
  expect(groups[0]?.sessions.map((item) => item.id)).toEqual(["adapter"])
  expect(groupSessions(sessions, variant, "MY-TUI dev").flatMap((group) => group.sessions.map((item) => item.id))).toEqual(["nav", "keys"])
})

test("cell truncation preserves Chinese glyph boundaries", () => {
  expect(Bun.stringWidth(truncate("中文标题abcdef", 9))).toBeLessThanOrEqual(9)
  expect(truncate("short", 9)).toBe("short")
})

test("switching designs preserves the open conversation", async () => {
  const app = await testRender(() => <App />, { width: 120, height: 40, kittyKeyboard: true })
  try {
    await app.renderOnce()
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(isSelected(app, "keys")).toBe(true)
    for (const key of ["1", "3", "2"]) {
      app.mockInput.pressKey(key)
      await app.renderOnce()
      expect(isSelected(app, "keys")).toBe(true)
    }
  } finally {
    app.renderer.destroy()
  }
})

test("search isolates text input and Escape returns navigation control", async () => {
  const app = await testRender(() => <App />, { width: 120, height: 40, kittyKeyboard: true })
  try {
    await app.renderOnce()
    app.mockInput.pressKey("/")
    await app.renderOnce()
    expect(app.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable)
    await app.mockInput.typeText("no_match_987")
    await app.renderOnce()
    expect(app.renderer.root.findDescendantById("session-nav")).toBeUndefined()
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(isSelected(app, "nav")).toBe(true)
    expect(app.renderer.currentFocusedRenderable).not.toBeInstanceOf(InputRenderable)
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(isSelected(app, "keys")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test.each([60, 80])("narrow %s-column list opens detail and returns without losing selection", async (width) => {
  const app = await testRender(() => <App />, { width, height: 24, kittyKeyboard: true })
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Only navigation is under design.")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Only navigation is under design.")
    app.mockInput.pressKey("/")
    await app.renderOnce()
    expect(app.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable)
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(isSelected(app, "nav")).toBe(true)
    expect(app.captureCharFrame()).not.toContain("Only navigation is under design.")
  } finally {
    app.renderer.destroy()
  }
})

test("overflow keyboard navigation keeps the last focused row in view", async () => {
  const app = await testRender(() => <App />, { width: 120, height: 24, kittyKeyboard: true })
  try {
    await app.renderOnce()
    app.mockInput.pressKey("F4")
    await app.renderOnce()
    for (let index = 0; index < 32; index++) {
      app.mockInput.pressArrow("down")
      await app.renderOnce()
    }
    expect(app.captureCharFrame()).toContain("Review task 24")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(isSelected(app, "extra-23")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test.each([60, 120])("status styles share title positions and preserve selection at %s columns", async (width) => {
  const app = await testRender(() => <App />, { width, height: 48, kittyKeyboard: true })
  const sidebar = () => app.captureCharFrame().split("\n").map((line) => Bun.sliceAnsi(line, 0, width < 92 ? width : 38))
  try {
    await app.renderOnce()
    const compact = sidebar()
    const row = (lines: string[], title: string) => lines.find((line) => line.includes(title))
    const running = row(compact, "重新设计会话导航")
    const approval = row(compact, "Review keyboard shortcuts")
    const unread = row(compact, "Fix scroll restoration")
    const failed = row(compact, "Add provider discovery")
    expect(running).toContain("●")
    expect(approval).toContain("●")
    expect(unread).toContain("○")
    expect(failed).toContain("×")
    expect(row(compact, "Inspect session events")).not.toMatch(/[●○×]/)
    expect(new Set([running, approval, unread, failed].map((line) => Bun.stringWidth(line?.trimEnd() ?? ""))).size).toBe(1)

    app.mockInput.pressKey("i")
    await app.renderOnce()

    const text = sidebar()
    for (const title of ["重新设计会话导航", "Review keyboard shortcuts", "Fix scroll restoration", "Add provider discovery"]) {
      expect(row(text, title)?.replace(/[●○×›]/g, " ").trimEnd()).toBe(row(compact, title)?.replace(/[●○×›]/g, " ").trimEnd())
      expect(text.findIndex((line) => line.includes(title))).toBe(compact.findIndex((line) => line.includes(title)))
    }
    expect(isSelected(app, "nav")).toBe(true)
    expect(text.join("\n")).not.toMatch(/[●○×]/)
    app.mockInput.pressKey("i")
    await app.renderOnce()
    expect(row(sidebar(), "重新设计会话导航")).toContain("●")
  } finally {
    app.renderer.destroy()
  }
})
