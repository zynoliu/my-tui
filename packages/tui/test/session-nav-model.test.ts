import { expect, test } from "bun:test"
import { groupSessions, partitionWorking } from "../src/context/session-tabs-model"

const entry = (id: string, projectID = "p1", updated = 0) => ({ id, projectID, time: { updated } })

test("partitionWorking splits by predicate preserving order", () => {
  const entries = [entry("a", "p1", 3), entry("b", "p2", 2), entry("c", "p1", 1)]
  const { working, rest } = partitionWorking(entries, (item) => item.id === "b" || item.id === "c")
  expect(working.map((item) => item.id)).toEqual(["b", "c"])
  expect(rest.map((item) => item.id)).toEqual(["a"])
})

test("partitionWorking with nothing working returns empty working partition", () => {
  const entries = [entry("a", "p1", 2), entry("b", "p1", 1)]
  const { working, rest } = partitionWorking(entries, () => false)
  expect(working).toEqual([])
  expect(rest.map((item) => item.id)).toEqual(["a", "b"])
})

test("partitionWorking with everything working returns empty rest partition", () => {
  const entries = [entry("a")]
  const { working, rest } = partitionWorking(entries, () => true)
  expect(working.map((item) => item.id)).toEqual(["a"])
  expect(rest).toEqual([])
})

test("groupSessions groups by project, newest first within and across groups", () => {
  const entries = [
    entry("old-a", "p1", 10),
    entry("new-b", "p2", 50),
    entry("new-a", "p1", 30),
    entry("mid-b", "p2", 40),
  ]
  const groups = groupSessions(entries)
  expect(groups.map((group) => group.key)).toEqual(["p2", "p1"])
  expect(groups[0].sessions.map((item) => item.id)).toEqual(["new-b", "mid-b"])
  expect(groups[1].sessions.map((item) => item.id)).toEqual(["new-a", "old-a"])
  expect(groups[0].updated).toBe(50)
})

test("groupSessions caps groups and reports overflow", () => {
  const entries = Array.from({ length: 12 }, (_, index) => entry(`s${index}`, "p1", index))
  const groups = groupSessions(entries, { cap: 10 })
  expect(groups).toHaveLength(1)
  expect(groups[0].sessions).toHaveLength(10)
  expect(groups[0].overflow).toBe(2)
})

test("groupSessions honors a projectOf override", () => {
  const entries = [entry("a", "p1", 5), entry("b", "p2", 9)]
  const groups = groupSessions(entries, { projectOf: () => "all" })
  expect(groups).toHaveLength(1)
  expect(groups[0].key).toBe("all")
  expect(groups[0].sessions.map((item) => item.id)).toEqual(["b", "a"])
})

test("groupSessions with empty input returns no groups", () => {
  expect(groupSessions([])).toEqual([])
})
