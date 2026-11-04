import { BoxRenderable, RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"

export function isSelected(app: TestRendererSetup, id: string) {
  const row = app.renderer.root.findDescendantById(`session-${id}`)
  return row instanceof BoxRenderable && row.backgroundColor.equals(RGBA.fromHex("#2b394c"))
}
