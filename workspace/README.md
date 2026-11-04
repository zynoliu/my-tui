# TUI workspace

Material around the fork that is not part of the upstream tree.

- `opencode-tui-briefing.md` — architecture map of `packages/tui`, the change log of this fork,
  the upstream rebase workflow, and the known-good test baseline.
- `tui-design-lab/` — standalone OpenTUI + Solid prototype used to choose the session navigation
  design. Fixture data only; it does not connect to a server. Run `bun install && bun dev` inside it.
- `icon.svg` — project icon.

The fork itself lives at the repository root. `dev` tracks the fork work; `upstream` tracks
`origin/dev` of https://github.com/anomalyco/opencode, and updates arrive with
`git fetch origin dev && git rebase origin/dev`.

Tests need the pinned Bun version (see `packageManager` in the root `package.json`); run them from
`packages/tui`.
