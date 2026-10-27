# Components adopted from TissUUmaps

The files in `components/` and `hooks/useCompressedRowVirtualizer.ts` are **verbatim copies** of
the TissUUmaps app (`apps/tissuumaps/src/`, same relative paths), taken at upstream commit
`79f9480`. They are not edited here, so that they can be compared with upstream and later moved
into a shared package (e.g. `@tissuumaps/react`) without changes. InSitUUmaps builds on them
instead of keeping its own controls (decision D25).

| File                                   | Upstream path                                              |
| -------------------------------------- | ---------------------------------------------------------- |
| `components/common/autocomplete.tsx`   | `apps/tissuumaps/src/components/common/autocomplete.tsx`   |
| `components/common/icon-button.tsx`    | `apps/tissuumaps/src/components/common/icon-button.tsx`    |
| `components/ui/button.tsx`             | `apps/tissuumaps/src/components/ui/button.tsx`             |
| `components/ui/input.tsx`              | `apps/tissuumaps/src/components/ui/input.tsx`              |
| `components/ui/input-group.tsx`        | `apps/tissuumaps/src/components/ui/input-group.tsx`        |
| `components/ui/textarea.tsx`           | `apps/tissuumaps/src/components/ui/textarea.tsx`           |
| `components/ui/tooltip.tsx`            | `apps/tissuumaps/src/components/ui/tooltip.tsx`            |
| `hooks/useCompressedRowVirtualizer.ts` | `apps/tissuumaps/src/hooks/useCompressedRowVirtualizer.ts` |

They use the TissUUmaps theme tokens (`--popover`, `--muted-foreground`, ...), which
`src/index.css` defines with the TissUUmaps light-theme values. To update a file, copy it again
from upstream; app-specific behaviour belongs in the components that use them (e.g.
`ui/GeneSearch.tsx`).
