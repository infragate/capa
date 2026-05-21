# Contributing to capa

Thanks for helping improve [capa](https://github.com/infragate/capa)!

## Quick start

```bash
git clone https://github.com/infragate/capa.git
cd capa
bun install
bun test
bun run dev
```

## Development

- **Runtime:** [Bun](https://bun.sh)
- **Typecheck:** `bunx tsc --noEmit` (also checks `registries/`)
- **Web UI types:** `bunx tsc --noEmit -p web-ui/tsconfig.json`
- **Build web UI:** `bun run build:web`

## Code style

- TypeScript with `strict` mode
- Semicolons, double quotes where the surrounding file uses them
- Match existing patterns in the module you're editing — don't drive-by refactor

## Pull requests

1. **One issue per PR** — keep changes focused and reviewable.
2. **Tests required** for behavior changes; run `bun test` locally.
3. **Typecheck must pass** before requesting review.
4. Link the related issue in the PR description.
5. Update docs when user-facing behavior changes.

Questions? Open a [discussion](https://github.com/infragate/capa/discussions) or issue.
