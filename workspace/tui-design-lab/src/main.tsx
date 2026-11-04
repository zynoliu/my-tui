import { render } from "@opentui/solid"
import { App } from "./app"

await render(
  () => <App
    initialVariant={Bun.argv.includes("--baseline") ? "baseline" : Bun.argv.includes("--list") ? "list" : "projects"}
    initialTheme={Bun.argv.includes("--light") ? "light" : "dark"}
    initialDataset={Bun.argv.includes("--empty") ? 2 : Bun.argv.includes("--overflow") ? 1 : 0}
    initialStatusStyle={Bun.argv.includes("--text-status") ? "text" : "dots"}
  />,
  { exitOnCtrlC: true, targetFps: 30 },
)
