# InSitUUmaps (TissUUmaps fork)

This repo is `SpatialPathology/insituumaps`, a fork of `TissUUmaps/TissUUmaps`. It contains the upstream pnpm monorepo plus the fork-only viewer in `apps/insituumaps`.

## Repo layout

- `apps/tissuumaps` - the TissUUmaps application
- `apps/insituumaps` - the InSituPy viewer (fork only)
- `packages/@tissuumaps-*` - `core`, `render`, `storage`, `plugins`, `react`
- `docs/` - user and developer documentation

## Read before changing code

The docs are the source of truth. This file only points to them.

| Task                                     | Read                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Any code change                          | `docs/development/coding-conventions.md`                           |
| Package structure, stores, data caches   | `docs/development/code-architecture.md`                            |
| Points, shapes, images, labels rendering | `docs/development/rendering.md`                                    |
| Plugins                                  | `docs/development/plugins.md`                                      |
| Adding or updating dependencies          | `docs/development/dependencies.md`                                 |
| Branches, changesets, CI                 | `docs/development/development-workflow.md`                         |
| Data model and projects                  | `docs/concepts/`                                                   |
| File formats                             | `docs/supported-data/`                                             |
| Work in `apps/insituumaps`               | `apps/insituumaps/README.md`, `apps/insituumaps/docs/decisions.md` |

## Environment

- Node `>=24` and pnpm `>=11.15.1` are required. Check `node -v` first: a shell can inherit an older Node even if a newer one is installed.
- Run `pnpm install` before type checks, tests or LSP use.
- The husky pre-commit hook runs `lint-staged` (ESLint and Prettier on staged files).
- On Windows, the Python scripts of `apps/insituumaps` use `INSITUUMAPS_PYTHON` if set, because `python3` is often the Microsoft Store stub.

## Commands

Run targeted checks for the changed code. Run the whole test suite only for broad changes.

```sh
pnpm typecheck                        # all projects
pnpm lint
pnpm fmt:check
pnpm exec vitest run <path>           # targeted tests
pnpm test                             # all tests, with coverage
pnpm test:scripts                     # release script tests
pnpm lint:docs                        # after changing docs/
pnpm changeset                        # add a changeset
pnpm build:apidocs                    # TypeDoc output in docs/api/

pnpm --filter insituumaps test           # viewer unit tests
pnpm --filter insituumaps test:converter # converter tests (needs Python)
pnpm --filter insituumaps smoke          # headless browser run on the fixture
pnpm --filter insituumaps smoke:local    # the same through the local-folder path
```

The smoke tests need the fixture (`pnpm --filter insituumaps fixture`), the running servers (`pnpm --filter insituumaps dev:fixture`) and a Chromium with WebGL 2. See `apps/insituumaps/README.md`.

## Rules that are easy to miss

- CI requires a changeset for PRs that change a package or an application.
- `docs/api/` and the `CHANGELOG.md` files are generated. Do not edit them.
- When changing a package's `exports`, keep `publishConfig.exports` in sync.
- Production builds resolve packages through `dist`, so build the packages first (`pnpm build` does this in order).
- Tests sit next to the unit they test (`X.test.ts`). GUI components, stores and glue code do not require tests.
- Only `console.error` and `console.warn` are allowed.

## Code navigation

If the `LSP` tool is available, use it for definitions, hover and call sites, with these limits:

- **Cold start:** right after startup, `goToDefinition` can stop at the import line. If it returns the same file, wait about 20 seconds and retry.
- **Incomplete references:** `findReferences` only covers TypeScript projects that are loaded. For example, a lookup started from `apps/insituumaps` missed uses in `apps/tissuumaps`. Before renaming or changing a shared API, confirm with a text search across `apps/` and `packages/`.
- **Availability:** LSP needs `pnpm install` and does not run in cloud sessions. Use text search there.

## Working with upstream

- Fork PRs target `SpatialPathology/insituumaps`. Pass `-R SpatialPathology/insituumaps` to `gh`, so that nothing is opened against upstream by accident.
- Keep changes small: one change per PR, conventional commit messages.
- Upstream PRs branch from `upstream/main`, never from the fork's `main`. Cherry-pick only the commits they need, and check that neither `CLAUDE.md` nor `planning/` is in the diff.
- For upstream PRs, remove AI co-author trailers, unless the maintainers have agreed to them, and declare AI use in the PR template. The upstream AI policy is in `docs/development/ai-policy.md`.

## Backlog and log

`planning/` and `.log/` are local links to a private folder shared with the upstream clone. They are ignored by git and do not exist in cloud sessions or other clones. If they are missing, skip these steps.

- The backlog is `planning/backlog.md`, not `.log/backlog.md`.
- The log is `.log/log.md`. It is shared between both clones, so start each entry title with `[fork]` or `[upstream]`.
- Never commit anything from `planning/` or `.log/`.
