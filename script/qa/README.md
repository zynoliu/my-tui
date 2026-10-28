# Session navigation terminal QA

`session-nav-integration.mjs` launches the real CLI in a PTY against an isolated V2
server and exposes its ANSI output through a local xterm page. It is an interactive
QA harness, not an unattended test runner.

Use a disposable server database and XDG configuration/state/data directories.
Set `OPENCODE_PASSWORD` to that server's password, `ULW_RUN_TMP` to the owned
scratch directory, and `ULW_XTERM_DIR` to an extracted xterm package containing
`lib/xterm.js` and `css/xterm.css`. The CLI must have a Bun runtime with
`Bun.Terminal` support. Keep runtime and transpiler caches inside the scratch root.

```sh
bun script/qa/session-nav-integration.mjs \
  --scenario navigation --server http://127.0.0.1:4189 \
  --cols 140 --rows 46 \
  --evidence-dir .omo/qa-evidence/session-nav-production/navigation
```

Open the `QA_READY` URL in an owned browser. The page's `qa` object supports
`send(bytes)`, `mouse(button, column, row)`, `text()`, `until(predicate)`,
`record(name)`, `api(method, path, body)` and `finish(pass)`.
Subscribe to a frame predicate before proceeding to the next interaction.
Send Escape separately from subsequent printable characters, so the terminal
parser does not interpret the pair as an Alt shortcut.

Scenarios:

- `navigation`: project disclosures, search, session selection and project-aware New.
- `lifecycle`: rename, archive/restore, default cancellation, delete and API failure.
- `attention`: real pending permission and question requests, composer/form priority.
- `responsive`: narrow horizontal fallback and desktop light/dark/custom themes.

The harness seeds real sessions. Attention also opens genuine requests. For a
failed/unread historical session, use the real experimental session import API
with `outcome: "failed"` and `time.viewed < time.idle`; verify GET responses before
and after archive. Restore selects the session, so the native viewed acknowledgment
may subsequently advance `time.viewed`.

`POST /fault` with `{method, path}` removes Authorization from exactly the next
matching proxied request, producing an actual server rejection. `POST /restart`
restarts the PTY against the same session and persisted state.

Save screenshots separately and call `qa.record` for transcripts. API, event,
input and raw ANSI logs are written under the evidence directory. `qa.finish`
stops the PTY, settles pending permission setup and closes the local proxy.
Its pass value is the operator's verdict, not an automatic assertion. Finally
close the owned browser, remove its profile and verify all owned PIDs/ports are
gone before deleting the scratch root. Do not commit temporary screenshots.
