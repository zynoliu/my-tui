# Navigation design lab

## Scope

A fixed-data experiment for choosing a session navigation design. It does not
connect to OpenCode, models, services, plugins, or user state.

Primary action: select a conversation.
Information priorities: task title, actionable status, project/branch context.
Required states: selected, keyboard-focused, hovered, running, approval, question, unread,
failed, pinned, empty, Chinese/long labels, overflow, light/dark, narrow terminal.
Left out: real transcript, composer, diffs, persistence, backend adapters.
Create, rename, archive, restore and delete are local fixture mutations only.

## References and variants

- Baseline: structural reconstruction of the current Pinned / Working / project
  sidebar. Not a copy of the production component, and not pixel-identical.
- List: T3-inspired title-first two-line rows; pins plus a flat recent list.
- Projects: project grouping with two-line session rows, paired with dots.
  Project disclosure headings follow OpenCode's native MCP sidebar module.
  External references inform organization, not a separate visual skin.

Layout: list-detail shell. At >= 92 columns, a 38-column sidebar and a flexible
reference pane; below 92, list and detail occupy the full width one at a time.
The session scrollbox alone scrolls. Toolbar, search, archive entry,
and lab controls remain fixed. At < 92 columns use a shorter control legend.
Row titles and metadata truncate by terminal cell width, not string length.

## Tokens

Monospace throughout. One cell of horizontal row padding; two lines per proposed
row; one line per baseline row. Group headers have a one-line leading gap.
No cards, shadows, accent stripes, decorative borders, or animated mock work.
Selection uses a background wash plus bold title, without a redundant `>`.
Keyboard navigation exposes `›` on the focused row/header; pointer movement
hides that cue without changing the open conversation.
Project headings participate in list focus, even while collapsed. Opening a
session is explicit; moving focus never changes the selected conversation.
Disclosure styling follows `opencode/packages/tui/src/feature-plugins/sidebar/mcp.tsx`:
body-color `▼` / `▶`, bold heading, muted parenthesized count when collapsed,
and no item-style background. A trailing `›` adds visible keyboard focus without
making the section heading look like a selected conversation. Unlike the MCP
server list's count-dependent control, projects always expose the toggle because
every project remains keyboard-collapsible.
The search field is one three-row color block with one-cell padding, an inline
placeholder, and no separate Filter title. Sessions and + New share one heading.
Status style is independent of layout: I toggles Dots/Text, default Dots.
Both styles reserve the same two-cell trailing title column. Dots: green `●`
running, amber `●` approval/question, neutral `○` unread, red `×` failure, blank idle.
Approval and question retain distinct labels; other compact rows show relative time.
The detail pane keeps the complete status label. Selection is never a status dot.

| Role | Dark | Light |
| --- | --- | --- |
| canvas | #15181c | #fafafa |
| sidebar | #1b1f24 | #f0f1f3 |
| text | #e4e7ec | #20242b |
| muted | #a0a8b4 | #586273 |
| faint | #88919f | #636d7b |
| selected | #2b394c | #dce6f3 |
| hover | #262c35 | #e4e7ec |
| field | #242a33 | #e5e8ed |
| running | #91c9a1 | #2a6540 |
| attention | #dfbd80 | #825600 |
| failed | #e9a4a4 | #a13232 |

## Interaction contract

Tab/Shift+Tab cycle actual search/list/detail focus. / goes directly to search;
Enter/Down leaves search for the result list. Esc closes the top dialog, otherwise
clears search and returns to the list. On narrow terminals, focus chooses which
pane is visible. Up/Down/Home/End apply only to list entries (headings and rows).
Left on a row focuses its heading; Left on a heading folds it. Right expands a
heading or enters its first child. Enter/Space on a heading toggles it; a fold
retains header focus. Filtering temporarily expands matching groups.

N and + New open a project chooser, defaulting to list context or the open
session in detail. Enter creates an in-memory draft in the chosen project.
Right-click opens that row's menu without opening it; Shift+F10 opens the same
menu for the focused/open session. Menu actions are pin, rename, archive/restore,
delete. Keyboard and mouse use the same action handlers.

Archive preserves the session; running/approval/question requires confirmation
that the simulated task stops first. Archived sessions are accessible from the
fixed footer or A. Restore selects the restored session in the active list.
Delete always confirms. Both confirmations initially select Cancel. New, rename
and confirmation dialogs use a bounded bordered surface. Session context menus
are separate four-row raised surfaces: no border, title, help footer, or prefix
glyph, matching the native `TabContextMenu` structure in
`opencode/packages/tui/src/component/session-tabs.tsx`. Pointer menus anchor at
the click; keyboard menus anchor at the target row, or the visible detail pane
when the row is unavailable. Both axes clamp to the terminal viewport.
The backdrop does not paint over underlying
characters (alpha fill was observed to erase underlying CJK cells).

1/2/3 change layout without resetting data; I switches status style; T changes
theme. P toggles pin; S cycles focused fixture state. F4 changes fixture datasets.
R restores fixture data including new/renamed/archived/deleted sessions.
All changes are in memory. Ctrl+C exits.
