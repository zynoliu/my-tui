# TUI navigation design lab

Independent OpenTUI + Solid prototype for discussing session navigation.
No OpenCode runtime imports, backend, models, configuration, or persisted state.
The right pane is only a size/context reference, not a chat implementation.

## Run

```sh
cd tui-design-lab
bun install --registry https://registry.npmmirror.com
bun dev
```

Use a real terminal; Ctrl+C exits. Default: View 3 (project groups), dark theme,
compact indicators. All create/rename/archive/restore/delete operations are local
in-memory prototype actions; no real conversations or files are changed.
At 92 columns and above, the list sits beside a reference pane. Below 92,
Enter opens detail and Escape returns to the full-width session list.

```sh
bun dev --baseline
bun dev --list
bun dev --projects
bun dev --projects --light
bun dev --overflow
bun dev --empty
bun dev --text-status
```

OpenTUI Core and Solid are pinned to 0.7.0, matching the source TUI.
SolidJS is pinned to OpenTUI's 1.9.12 peer dependency. This project installs its
own dependencies and can run without `opencode/`.

## Compare

| Key | Action |
| --- | --- |
| 1 | Baseline: reconstructed Pinned / Working / project structure |
| 2 | List: T3-inspired title-first rows, pins and recent sessions |
| 3 | Projects: VS Code-inspired lightweight workspace groups |
| Tab / Shift+Tab | Cycle search, list and detail regions; focus is shown in the footer |
| Up / Down | Move through project headings and session rows without switching the open session |
| Home / End | First / last visible list entry |
| Left | From a session, focus its project heading; on a heading, collapse it |
| Right | Expand a heading; if already expanded, focus its first session |
| Enter | Open a session or toggle the focused heading |
| / | Focus the filter; matches title, project and branch, all query words |
| Escape | Dismiss the top dialog, or clear search / return to list |
| Space | Toggle the focused group; retain focus on its heading |
| G | Expand all groups |
| P | Pin/unpin the focused session |
| S | Cycle its fixture status: running, approval, question, unread, idle, failed |
| N / + New | Choose a project and create/open a local draft |
| Shift+F10 / right click | Open the same session action menu |
| A / Archived footer | Switch active and archived session lists |
| T | Toggle dark/light |
| I | Compare compact indicators and text status without changing the layout |
| F4 | Cycle standard, overflow, empty fixture sets |
| R | Reset fixtures, new drafts, renames, deletions, archives, selection, search, pins, status and groups |
| Ctrl+C | Exit |

Click a session to open it. Click a group heading to fold or unfold it. Folded
headings stay keyboard-focusable even when every group is folded. The mouse
wheel scrolls the list. Switching designs preserves state; proposed designs do
not move sessions between working/status sections. Arrow shortcuts are local to
the list; they do not steal input from the search field or detail region.

Compact mode reserves a fixed indicator column: green `●` running, amber `●`
approval/question, neutral `○` unread, red `×` failed, blank idle. Approval and
question retain distinct `Needs approval` / `Needs answer` labels; other rows
show relative time. The detail pane always
shows the full state label, so selecting a session explains its indicator.
Text mode uses the original status labels. Both modes reserve the same title
width, so toggling does not move or reflow the conversation titles.

The baseline shares fixture data, but is not the real production component or
a pixel-accurate copy. The proposed designs are adaptations, not product clones.
Project section headings use OpenCode's MCP disclosure language: `▼` / `▶`,
bold title, muted count while folded, and no conversation-row background.
Keyboard navigation adds `›` to focused rows/headings; pointer movement hides it.
The open session uses background and bold title, without a leading `>`.
The visual reference is
`opencode/packages/tui/src/feature-plugins/sidebar/mcp.tsx`; projects keep their
toggle visible even with a single session so keyboard folding stays consistent.

## Session actions

The title's `+ New` and N open a project chooser. The focused project is used in
the list; the open session's project is used in detail. Up/Down then Enter chooses
a project and creates a `New session` draft. Escape cancels.

Right-click targets that row without switching the open conversation. Shift+F10
targets the keyboard-focused session (or the open session in detail). Both menus
offer pin/unpin, rename, archive/restore, and delete. Up/Down and Enter operate the
menu; Escape dismisses it. Rename uses a real editable input; Enter commits,
Escape discards changes.
The session menu is a compact borderless raised surface, with no title or help
footer. Mouse and keyboard invocation both anchor near the target (detail pane
when a narrow view hides the list) and clamp to viewport edges. Clicking outside
only dismisses it; it does not activate the covered control.

Archiving an idle/result/failed session removes it from the active list. For a
running, approval, or question session, a dialog explains that confirming will
stop the simulated task before archiving; its initial choice is Cancel.
The Archived footer/A opens retained sessions; Restore returns one to the active
list and selects it. An ended run is not automatically archived.

Delete always requires confirmation, initially Cancel. Use Down/Right/Tab to
select the destructive choice, then Enter, or click it explicitly. There are no
real messages or executions in this prototype. Closing the process loses all
changes; R restores the original fixtures, including deleted sessions.

## Files

- `src/app.tsx`: layout, navigation controls and color tokens.
- `src/fixtures.ts`: editable session fixtures and grouping/filtering logic.
- `src/main.tsx`: standalone launch and initial scenario flags.
- `DESIGN.md`: scope, cell dimensions, palette, layout and interaction contract.
- `MIGRATION-REVIEW.md`: full review, open lifecycle finding and production transfer assessment.
- `test/navigation.test.tsx`: model and real OpenTUI interaction tests.
- `test/workflows.test.tsx`: keyboard/mouse focus, creation, menus and session lifecycle tests.
- `evidence/`: ignored local PTY recordings and xterm screenshots from QA.

## Check

```sh
bun run typecheck
bun test
```

## Next design discussion

Use the same fixture and terminal size to compare 1/2/3. Decide title vs metadata
density, whether projects deserve headings, and how pending/running/unread states
should read. Test Chinese/long titles and overflow before choosing a direction.
Only transfer the chosen navigation layout into the real TUI after agreement.
