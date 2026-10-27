# Interface consistency pass — 26 October 2026

The shared interface follows the BBC GEL principles for visible action labels,
consistent control states, keyboard focus, search, filters and editorial cards:

- https://bbc.github.io/gel/components/buttons-and-ctas/
- https://bbc.github.io/gel/components/form-fields/
- https://bbc.github.io/gel/components/search/
- https://bbc.github.io/gel/components/filter-and-sort/
- https://bbc.github.io/gel/components/cards/

This is an adapted design, not BBC branding or a formal accessibility certification.
Source Sans 3 is used for interface text and headlines; Source Serif 4 is used for
reader decks and publisher excerpts. Both are self-hosted, open-source font families.
The offline page caches Source Sans 3. BBC Reith is not redistributed.

## Shared rules and coverage

`src/app/interface.css` owns the shared control dimensions, neutral dark surfaces,
readable text, focus outlines, button hierarchy and responsive overrides. Main
actions have 44px targets. Lucide supplies interface icons; flags and actual
publisher artwork retain their separate identity. Local BBC and CNA SVGs have
transparent backgrounds. Remote publisher favicons use a bounded image proxy
and a newspaper fallback if unavailable.

The pass covers landing navigation and calls to action, country and comparison
maps, quick country shortcuts, country search and selections, topic/language/
publisher/date/sort filters, story cards, reader actions and excerpts, library
menus, saved stories, settings, loading/empty/error states, missing pages and
offline recovery. All pages use dark mode. Lead stories retain their rotating
gradient border; reduced-motion preferences stop animation. The footer top link
centers its icon without inheriting text-link margins.

## Verification

- Desktop country and two-country selections, article cards and reader reviewed.
- Mobile layout at a 390px viewport reviewed for navigation, map, filters, reader,
  settings, saved empty state and offline recovery; missing-page route inspected.
- Lead border animation and centered footer icon verified from computed layout.
- Follow-up annotations: the count/loading panel now shares one dark footprint,
  centered beside the briefing heading; the loading spinner is a Lucide icon.
  Reader Back and Close share 44px targets, 18px icons and identical colors,
  borders and spacing. Publisher-link icon/text centers were measured in-browser.
- Reader focus wraps within the dialog; Escape returns to stories. Source picker
  focuses search and returns focus to its trigger on Escape. Regression tests
  exercise these behaviors alongside existing filter, save, reader and settings tests.
- Automated suite: 429 tests passed; lint and type checking passed. Vinext production
  build passed. This does not substitute for assistive-technology testing.
