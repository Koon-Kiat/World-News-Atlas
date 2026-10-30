# Interface design system

[Documentation index](../README.md)

Worldline uses a dark-only news interface with blue-graphite surfaces. [public/theme.js](../../public/theme.js) forces the dark theme before hydration; Settings stores the default news time range, not a light/system theme choice.

## Source and effective tokens

[globals.css](../../src/app/globals.css) defines base tokens, layouts and illustration styles. [interface.css](../../src/app/interface.css) loads last and supplies shared controls, typography and accessibility overrides. Read the final cascade before copying a value: later rules override some earlier tokens.

| Role | Token | Effective value |
| --- | --- | --- |
| Page | `--paper` | `#0c1219` |
| Surface | `--surface` | `#131b25` |
| Hover surface | `--surface-hover` | `#1b2633` |
| Text | `--ink` | `#e8edf3` |
| Secondary text | `--muted` | `#9aa7b6` |
| Decorative hairlines | `--line` / `--line-strong` | `#243140` / `#3a4a5c` |
| Accent text | `--signal` | `#6cb2f0` |
| Primary action | `--action-background` | `#2668b5` (overrides the earlier `#3d8fe0`) |
| Control boundary | `--control-border` | `#66788d`; chart contexts use `#7f93aa` |
| Selected chart place | `--marker` | `#eaa94a` |
| Error/destructive accent | `--live` | `#f0716a` |

Map, globe and landing-story containers re-scope the shared palette to navy surfaces and amber chart accents. Use the existing semantic tokens for new styles. Match offline artwork, manifest theme colors and image placeholders when changing the palette.

## Typography and assets

- Source Serif 4 supplies display headlines and article typography through `--display` / `--article`; Source Sans 3 supplies interface text through `--sans`. Fonts are self-hosted.
- The rem-based scale uses `--fs-meta` (0.8125rem), `--fs-ui` (0.9375rem), `--fs-body` (1rem) and `--fs-lede` (1.125rem). These correspond to 13/15/16/18px at a 16px root size.
- Use sentence-case labels and avoid tracked uppercase interface labels.
- Use Lucide for interface icons. Preserve geographic flags and [publisher artwork](publisher-marks.md) as distinct assets with their provenance.

## Shared controls and behavior

- Shared primary actions use blue; secondary actions are outlined. Standard primary controls have a 44px minimum height, 6px control radius and 10px panel radius.
- Selected chips and segments use an ink fill. Cards use hairline borders; the lead story has a blue top rule. Notices and errors use a colored leading edge.
- Keyboard focus uses an explicit ring. Country selection combines a visible marker with adjacent selection-count text. Search fields fill their control area; source checkbox targets include the surrounding label row.
- The landing story pins and advances through four chapters on larger screens. Chapter-title buttons provide keyboard navigation. At 1060px or narrower, at 680px height or shorter, and with reduced motion, the story uses an unpinned layout with descriptions visible.
- Settings persists the selected default time range only in the browser. Saved articles and search history also remain device-local.

## Review checklist

For interface changes, check landing, country, two-country comparison, reader, saved, settings and missing-page views at desktop and 375px widths. Include empty, loading and error states, keyboard navigation, focus visibility, reduced motion, long labels and storage failures.

Check rendered text/control contrast and effective target sizes, including chart overrides. Test 200% zoom/reflow and screen-reader behavior when claiming accessibility coverage. CSS targets and prior visual checks alone do not establish WCAG conformance; this guide does not certify it.

Run the relevant UI tests and the [development checks](../development/setup.md). Record dated browser/accessibility results separately when conducting a release review, rather than treating an old test count as current evidence.
