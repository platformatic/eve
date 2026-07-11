# AGENTS.md

## Scope
- Applies to the whole repository.

## Maintenance
- Keep this file limited to non-discoverable, operationally significant gotchas. Do not add repo overviews, tech-stack summaries, directory maps, or commands already visible in `package.json`, CI, or config files.

## Current landmines
- `demos/*` are pnpm-workspace members (`packages: demos/*`) that each ALSO carry their own
  `pnpm-workspace.yaml`. That nested file is primarily an eve marker: in `wattpm dev`, eve snapshots
  its "source root" (nearest ancestor with `.git` or `pnpm-workspace.yaml`); without it eve roots at
  the repo and copies the whole tree into `<demo>/.eve/`, failing with `cp` EINVAL (dest inside src).
  Consequence: pnpm also treats that nested file as a root when you run `pnpm` from a demo dir, so the
  demos MUST link the capability via `@platformatic/eve: "file:../.."` (not `workspace:*`, which is
  unresolvable in that rooting). The nested file also carries `allowBuilds` (protobufjs,
  unrs-resolver) so a demo-dir `pnpm install` / `pnpm dev` don't fail on ignored build scripts. Do
  not delete it. Build the repo (`npm run build`) so the `file:` link resolves a current `dist/`.
