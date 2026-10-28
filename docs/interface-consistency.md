# Interface design system — 28 October 2026

The site is a dark-only, professional news interface. This pass replaced the
pure-black surfaces and orange accent with a blue-graphite "night newsroom"
palette. All colors are now design tokens, and one set of shared rules covers
every route.

## Tokens

Defined in `:root` at the top of `src/app/globals.css`:

| Role | Token | Value |
| --- | --- | --- |
| Page | `--paper` | `#0c1219` |
| Surface / cards | `--surface` | `#131b25` |
| Hover surface | `--surface-hover` | `#1b2633` |
| Text | `--ink` | `#e8edf3` |
| Secondary text | `--muted` | `#9aa7b6` |
| Hairlines | `--line` / `--line-strong` | `#243140` / `#3a4a5c` |
| Accent text (links, labels) | `--signal` | `#6cb2f0` |
| Primary action | `--action-background` | `#3d8fe0` |
| Selected place on the chart | `--marker` | `#eaa94a` |
| Destructive / error edge | `--live` | `#f0716a` |

The map, landing globes and scroll story are drawn as a deep-ocean chart. The
`:is(.map-layout, .landing-globe-interactive, .landing-story, .landing-depth,
.journey-compare)` block re-scopes the same tokens to navy surfaces, with amber
as the accent. Components therefore never need chart-specific colors.

## Shared rules

`src/app/interface.css` loads last and owns the shared rules:

- **Type:** headlines use Source Serif 4 at display optical sizes, and
  interface text uses Source Sans 3. Labels are sentence case with no tracked
  capitals.
- **Actions:** atlas-blue primary, outlined secondary, 44px targets, 6px
  control radius, 10px panel radius.
- **Filters:** selected chips and segments use an ink fill.
- **Cards:** hairline borders and no shadows. The lead story has a 3px blue
  top rule instead of the former animated rainbow border.
- **Chart:** pale land on navy ocean, amber selection, amber focus stroke.
- **Banners:** a shared surface with a colored leading edge (blue notice, red
  error).

The offline page, web manifest, theme color and the `/api/image` placeholder
artwork use the same palette.

## Verification

- Reviewed in the browser at 1440px and 375px: landing, country, compare (two
  selected countries), story reader, saved, settings and the missing-page
  route. No horizontal scroll at 375px.
- `npm run check`: lint, typecheck and 430 tests pass. `npm run build` and
  `npm run db:check` pass.
- This is not a formal accessibility audit or assistive-technology test.
