# Prototype review and production migration assessment

## Scope and current evidence

The approved selection/menu refinements are implemented in the isolated lab.
No production OpenCode files were changed by this review request.

- Typecheck passed; 33 tests passed in one final run.
- Six final `evidence/refined-*.png` frames were inspected from actual PTY output:
  initial selection, keyboard focus, keyboard menu, SGR right-click menu, narrow
  detail menu, and lower/right-edge menu. Light/dark and 120/60 columns covered.
- Full fixture navigation, project disclosure, search focus, new/rename,
  archive/restore/delete confirmation, reset and pointer/keyboard transitions
  are covered by the tests. Prototype data mutations are deliberately in memory.
- The outer repository lists the lab as untracked. Production already has
  uncommitted navigation changes from earlier work; those were not reset or
  replaced. This is a prototype review, not a clean-branch PR/build certification.

## Findings

### P2: Archiving discards the original terminal/unread status

`src/app.tsx:181`, `archiveSession`, sets every archived session's override to `idle`.
The same operation handles already-failed and unread-result sessions, not only
the running/approval/question cases that ask to stop first. Restoring a failed
session therefore makes it look ready; unread state is also lost.

This is an existing prototype simplification, not a regression from the menu
refinement. Do not transplant this state mutation into production. Archive is a
visibility/lifecycle field, not an execution-outcome rewrite. Only an actual,
confirmed stop should change execution state. Preserve failure/result/read state
through archive/restore and add that invariant to production tests.

The independent reviewer reproduced both paths through the real renderer:
provider `Failed -> archive -> restore -> Ready` and scroll `New result ->
archive -> restore -> Ready`. Existing workflow tests check membership and
selection but not retained outcome/read state. This remains an open prototype
defect; it was not silently fixed as part of the approved selection/menu edits.

No P0/P1 defect or additional navigation-presentation blocker was found.

## Checked production seams

- `opencode/packages/tui/src/component/session-nav.tsx`: existing navigation
  component, `useData`, `useClient`, pins and route integration. Status already
  distinguishes permission/question attention and failed outcome.
- `opencode/packages/tui/src/context/session-tabs.tsx`: use the existing
  controller's new-tab/session behavior and model inheritance, not local drafts.
- `opencode/packages/tui/src/app.tsx` and `ui/layout.ts`: preserve existing rail
  sizing, readable-content constraints and narrow-width fallback policy.
- `opencode/packages/client/src/promise/generated/types.ts`:
  `SessionListInput` supports `search`, `archived`, cursor and project/directory;
  `SessionUpdateInput` supports `archived: boolean`;
  `SessionInterruptInput`/output describe real interruption, with an
  `interrupted` result. The client data layer processes archived/unarchived events.
- Native visual references: `feature-plugins/sidebar/mcp.tsx` and the original
  `TabContextMenu` in `component/session-tabs.tsx`.

These are source-level checks. No production API workflow or production test
suite was exercised in this review; the application was deliberately unchanged.

## Transfer design, not the prototype controller

1. Rebuild the approved View 3/dots presentation inside production `SessionNav`.
   Keep real transcript, composer, routing, tab lifecycle and width policies.
   Do not transfer the fake detail pane, lab chrome, fixture switching or reset.
2. Replace literal palettes with `useTheme()` semantic roles, and replace global
   one-letter `useKeyboard` controls with scoped/configurable production keymaps.
   Composer editing, dialogs and terminal-pane focus must retain their priority.
3. Use authoritative session/attention/outcome/read state, existing pin storage,
   project data, routing and persistent disclosure state. The lab's generic
   `SessionState`/arrays are not an adapter contract.
4. Route rename/delete/archive/restore through the real client and invalidation/
   events. Await failures and retain/correct the UI on rejection. A stopped
   prototype task is not proof that a real execution or pending form was stopped.
5. Resolve a chosen project's real directory/location for new sessions and retain
   model inheritance. Do not merely change a project label on a local draft.
6. Use server search and paginated/history queries where necessary; the current
   production sidebar's recent-window fetch is not full-history search.

## Suggested verified increments

- Presentation and native focus: project headers, rows, indicators, search block,
  selected/focused distinction, compact menu and title-adjacent New.
- Real lifecycle: project-aware creation, rename, persistent pin/disclosure,
  archived list and restore, safe interrupt/archive/delete behavior.
- Integration acceptance: actual permissions/questions, failed and unread
  outcomes, asynchronous rejection, deleted/archived event races, composer and
  dialog key precedence, width/terminal-pane behavior, custom themes and real
  restart persistence. Update stale production layout tests for the chosen design
  without weakening behavioral assertions.

## Code-quality and test perspective

Reviewed the entire lab implementation and tests against the programming and
overfit/slop criteria, without starting a cleanup/refactor:

- The new tests retain actual selection and navigation behavior while removing
  the visual marker; they are not deletion-only or tautological tests.
- Focus, menu geometry, viewport clamping and click-through prevention are tested
  through the real renderer. No fixed test sleeps or timing-luck retries were added.
- No production adapter/extraction, speculative parser, unnecessary normalization
  or substantial implementation-mirroring test algorithm was introduced.
- The standalone literal palettes, global lab keys and mock mutations are
  acceptable experiment boundaries, not production architecture.
- One fixture-only assertion has low independent value, but its surrounding
  rendered question-state test is useful. The important coverage gap is archive
  outcome/read-state preservation, not test count.

## Independent gate and final verdict

One read-only post-QA gate review completed. It read the implementation, tests,
documentation and production seams, inspected all six final screenshots, and
independently reproduced the archive finding. It did not duplicate the parent's
full 33-test/typecheck run. It approved navigation-design transfer with no
prototype presentation blockers.

**Ready to begin formal navigation integration: yes.**
**Ready to copy the standalone controller or land production functionality: no.**

The layout and interaction choices are sufficiently settled. Further broad
prototype polishing is not required before starting a scoped production
implementation. Carry the archive finding into that work and resolve it before
accepting real archive/restore behavior. Use existing theme, scoped keymaps,
authoritative state and API/event contracts rather than copying mock logic.

The next implementation should start with `SessionNav` presentation and native
focus integration, then real lifecycle operations, then the integration checks
listed above. Preserve the actual composer, tab controller and responsive policy.
No production migration was performed in this review; starting that implementation
is the next user decision.
