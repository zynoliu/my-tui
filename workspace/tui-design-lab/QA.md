# Prototype verification

Verified locally on macOS arm64, 2026-10-28.

- `bun run typecheck`: exit 0.
- `bun test`: 33 pass, 0 fail.
- Real OpenTUI processes ran in isolated tmux PTYs. Raw output was recorded with
  `tmux pipe-pane` and replayed in xterm.js in owned headless Chrome. Screenshots
  are not based on `tmux capture-pane` or a visual HTML reimplementation.
- Initial navigation build: inspected all 12 standard-fixture captures: baseline/list/projects, dark/light,
  120x40 and 60x24. No text lines exceeded the terminal width. Chinese titles
  remained aligned; long titles and metadata used ellipses.
- At 60 columns, the sidebar uses full width and scrolls; Enter opens detail.
  Automated tests cover returning with Escape and reopening search from detail.
- Automated interaction tests cover switching designs without losing selection,
  filtering and restoring navigation focus, and scrolling to the last overflow
  item. Pure-function tests cover matching and one-copy-per-session grouping.

Local screenshot names:

```text
evidence/labqa-{baseline,list,projects}-{dark,light}-{120,60}.png
```

## Design boundaries

This is a discussion prototype, not the chosen final design. The baseline is a
structural reconstruction, not the production component. The right pane only
provides proportions and selected-session context. No chat behavior, backend,
persisted state, or formal TUI integration was implemented or claimed.

The standard fixture is visually checked in both themes and widths; the overflow
and empty fixture behavior is available for exploration, with overflow keyboard
navigation covered by the tests. They are not included in the 12-image visual
matrix.

## Compact status comparison

- Default compact indicators and `I` text/indicator switching are implemented.
- Added two interaction tests (60 and 120 columns): check all status glyphs,
  aligned indicator columns, unchanged title positions and preserved selection
  when switching both ways. Existing navigation tests also pass in compact mode.
- Inspected eight fresh project-layout captures: dots/text, dark/light, 120x40
  and 60x40. No text exceeded terminal width. Indicator positions remain fixed;
  running and approval use filled circles, unread a hollow circle, failed a cross,
  and idle leaves the column blank. Approval retains its explicit metadata label.
- The sidebar suppresses repeated status words in compact mode; the reference
  detail pane deliberately keeps the full status label.
- Status-comparison revision screenshots: `evidence/status-{dots,text}-{dark,light}-{120,60}.png`.
  The earlier `labqa-*` captures document the initial build, not this revision.

## Navigation workflow revision

The current default is project groups + dots. All seven requested interaction
areas are implemented in the isolated prototype; production OpenCode is untouched.

The 29-test passing run includes:

- Keyboard folding/unfolding every project, including when all groups are folded,
  without losing heading focus; separate focused and open sessions.
- Actual search/list/detail focus with Tab and Shift+Tab; Escape clears search.
- Project-aware creation using keyboard, alternate project selection, and + New.
- Right-click targeting without changing the open session; equivalent Shift+F10
  menu; pin and rename, including rename cancellation.
- Immediate idle/result/failed archive, restoration and archive view toggling.
- Running/approval/question archive: initial Cancel, click cancellation and
  explicit keyboard confirmation, then stopped/idle state in the archive.
- Delete cancellation, explicit confirmation and reset restoring fixture data.
- Distinct question state, attention circle and answer label.
- At 60 and 80 columns, a pure-keyboard create -> edit through the real input ->
  archive -> restore flow.

The dialog backdrop intentionally does not paint over underlying cells. An
alpha-filled backdrop erased underlying CJK cells in the real renderer; the
right-click regression caught it, and now verifies the unchanged content.

Previous `labqa-*` and `status-*` screenshots are historical evidence. Current
workflow captures use `evidence/workflow-*.png`; only the explicitly inspected
scenes listed below should be treated as visual evidence for this revision.

Inspected 12 current real-PTY/xterm captures, all with zero lines exceeding their
terminal width:

- `workflow-home-{dark,light}-{120,60}`: default View 3/dots, whole-block search,
  + New, distinct approval/answer labels, archive footer and focus hints.
  Wide cases are 120x44; narrow cases are 60x30.
- `workflow-new-dark-120`: project chooser, current project initially selected.
- `workflow-rename-dark-60`: focused editable title on a narrow terminal.
- `workflow-menu-light-120`: keyboard-opened session actions.
- `workflow-confirm-light-60`: archive warning with Cancel initially selected.
- `workflow-delete-dark-60`: delete warning with Cancel initially selected.
- `workflow-archived-dark-120`: archived record retained after the mock run stops.
- `workflow-search-light-60`: focused search block and no-results state.
- `workflow-folded-light-120`: keyboard-collapsed project retains heading focus.

These scenes were driven through actual tmux keyboard input. Mouse targeting and
confirmation/restore/reset transitions are additionally covered by the passing
real-renderer tests. Raw streams and matching `.png` files are in `evidence/`.
The raw-ANSI substring watcher did not reliably observe every differential
screen update; the final xterm-rendered frames, not that watcher, verified all
expected scene states.

## OpenCode disclosure styling

Project headings now follow the native MCP module: `▼` / `▶`, bold body-color
title, muted folded count, no item background, and a trailing keyboard-focus `›`.
The reference is `opencode/packages/tui/src/feature-plugins/sidebar/mcp.tsx`.
Projects always show the toggle, including a single-session project.

The unchanged 29-test suite and typecheck passed. Four new real-PTY/xterm frames
were inspected: `evidence/disclosure-{dark,light}-{120,60}.png`; 120x44 cases show
expanded headings, and 60x30 cases show the keyboard-folded my-tui group with its
count and focus marker. All four have zero width overflow. `workflow-*` remains
the previous interaction revision's evidence, not the current heading styling.

## Selection and native compact-menu refinement

- Removed the active-session `>`; selection is still a background wash and bold
  title. `›` appears only with keyboard navigation and hides after pointer movement.
- Menus are separate four-row raised surfaces, not generic dialog frames: no
  border, title, help footer or row prefix. Pointer and keyboard anchors are both
  target-based, with viewport clamping and a detail-pane anchor in narrow mode.
- Added regression tests for keyboard/pointer focus transition without changing
  selection, compact menu geometry/content, outside-click dismissal without
  activating the covered New button, edge clamping and narrow-detail anchoring.
- Typecheck and all 33 tests passed in one final run.
- Inspected six current real-PTY/xterm captures:
  `refined-home-dark-120`, `refined-focus-dark-120`,
  `refined-keymenu-light-120`, `refined-mousemenu-dark-120`,
  `refined-detailmenu-dark-60`, `refined-edgemenu-light-60`.
  They cover initial selection, keyboard focus, keyboard/mouse invocation,
  narrow detail and lower/right-edge placement. All have zero text width overflow.
- The right-click scene was driven by actual SGR mouse bytes at the row location
  obtained from the rendered terminal frame. Keyboard scenes used actual tmux
  input, including End followed immediately by Shift+F10 for edge placement.
- During visual inspection the menu initially blended into the sidebar; using
  the existing elevated field surface and selected-row wash made its footprint
  distinct while keeping it borderless.

One independent post-QA gate review read the complete prototype and production
seams, inspected all six final refined captures, and approved navigation-design
transfer. It also reproduced archive/restore losing failed/unread state, an open
prototype defect not covered by the passing membership/selection checks.
See `MIGRATION-REVIEW.md` for severity, scope, production acceptance requirements
and the distinction between design readiness and production landing readiness.
