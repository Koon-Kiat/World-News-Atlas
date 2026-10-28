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

## Accessibility audit, 28 October 2026 (WCAG 2.2 AA)

Every route was measured in the browser at 1440px and 375px with a script that checks the rendered font size, text contrast and target size of each visible element.

| Check | Before | After |
| --- | --- | --- |
| Text under 14px (landing) | 69 elements, smallest 9.3px | None under 13px |
| Text under 14px (explorer) | 151 elements | None under 13px |
| Primary button contrast | 3.39:1 (white on `#3d8fe0`) | 5.63:1 (white on `#2668b5`) |
| Input/chip/select borders | 1.91:1 | 3.38:1 or better (`#66788d`) |
| Search inputs | 21px-tall hit area inside a 48px box | Input fills the field (44px) |

Rules now enforced in `interface.css`:

- **Type scale:** set in rem, so browser text-size settings scale everything.
  - `--fs-meta` (13px): metadata such as timestamps, counts and helper text.
  - `--fs-ui` (15px): interface text such as buttons, labels, chips and inputs.
  - `--fs-body` (16px): summaries and running text.
  - `--fs-lede` (18px): introductions.
- **Contrast:** text is at least 4.5:1; control boundaries and indicators are at least 3:1 (WCAG 1.4.3 and 1.4.11).
- **Targets:** 44px for primary controls and never below 24px (WCAG 2.5.8). The 18px source checkboxes pass because their full 44px label row is the target.
- **Selection indicator:** a hollow ring in the global view and a filled amber marker once a country is selected. The adjacent text ("1 of 2 selected") states the same thing, so color is never the only signal.
- **Map overlays:** the status chip and zoom controls use a solid chart panel instead of a translucent blur.
- **Landing page:** a scroll-driven story without hidden content.
  - The story stage pins while its section scrolls past (one 85vh chapter per step). Scroll progress fills a rail, advances steps 01–04, swaps the example card, and drives a light parallax: globe drift and rotation, counter-rotating orbit rings, and a slower background grid.
  - All four step titles stay visible; the active step expands with its description. Each title is a button that scrolls to its chapter, so the story works by keyboard.
  - Below 1060px wide, below 680px tall, or with reduced motion, the stage unpins and every description is shown as a normal list.
  - Perspective previews render at full size with story-specific artwork (`public/landing/`) instead of the generic placeholder.
  - Decorative background words were removed.

Not covered: screen-reader testing with NVDA, VoiceOver or JAWS, and 200% zoom reflow on every route.
