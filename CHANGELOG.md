# Changelog

Dated, one-line entries for data + feature changes, newest first.
Entries before 2026-06-12 are reconstructed from email threads and chat history
(the project predates this repo's git history).

## 2026-06-20

- **Project restructure** — `public/` (browser-served HTML), `server/` (Express API),
  `data/` (centres + WAFID demand), `scripts/` (start.bat + push-to-gist.ps1).
- New top-level docs: `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `.gitignore`.
- Legacy `index.html` + `app.js` deleted (superseded by inlined-JS d2 HTML).
- One-off migration scripts (`patch-uk.js`, `add-wafid-demand.js`) and `.bak`
  backups deleted — ~1.5 MB cleaned out of the root.
- `server.js` → `server/api.js`. `BLOCKED` URL list dropped (the only served
  folder is now `public/`, so data/config/scripts are unreachable by design).
- UI: WAFID rail-tab country sections now collapsed by default; expand on click.
- UI: WAFID search input now retains focus + caret position across re-renders.
- UI: Demand map mode — "No data" overlay rings removed (legend was already
  dropped earlier; circles now match the legend).
- UI: Rail-tab CSS tightened so all 7 tabs fit at ≥1280px viewports without
  horizontal scroll.

## 2026-06-19

- **Feature: WAFID Demand rail tab** — dedicated tab with searchable List view
  + sortable Table view, demand-level filter pills, KPI strip
  (cities / high / moderate / low), per-row 📍 to focus on the map, CSV export.
  Stays in sync with the rail's source-country filter. Partial-dataset note
  surfaced as an info banner.
- **Feature: Demand map layer** — circle per city coloured by High / Moderate /
  Low. Auto-swaps the legend.
- Data: `wafidDemand` block added to `data/data.json` + `data/data-snapshot.json`
  — 31 cities across India (10) / Nepal (2) / Sri Lanka (6) / Philippines (11) /
  South Africa (2), all pre-geocoded.
- UI: "No data" row dropped from the Demand legend per stakeholder ask.
- Commit: `bf252c8 Added wafid centre demand wise cities`.

## 2026-06-15

- **Data: UK approved-clinics fix.** UK-Active India centres 62 → 46 to align
  with the official gov.uk India TB clinic page (8 May 2026).
  - 21 mis-tagged centres hard-deleted (verified against gov.uk Wayback Machine
    snapshots 2019–2026 — none were ever on the approved list).
  - UK Active added to 5 centres that already existed under other programmes:
    Apollo Hospitals Chennai (CEN-0010), KD Hospital Ahmedabad (CEN-0024),
    Apollo Clinic Surat (CEN-0025), Clinical Diagnostic Centre Mumbai Nariman
    Point (CEN-0416), Sanjiwani Chikitsa Kendra Nagpur (CEN-0131).
  - GEMS Nerul city corrected from Mumbai → Navi Mumbai (CEN-0018).
  - `cityConcentration` regenerated from updated `centres` array.
  - Totals: centres 653 → 632, UK Active global 104 → 88.
- Commits: `94a8320 updated UK centres`, `c414b6f final UK changes`.

## 2026-06-12 (deployment + ops feature day)

- **Initial Git commit** — project entered version control (`827f009`).
- **Live deployment** — converted from static HTML build to Node/Express web
  app deployed on Vercel; data persisted in a private GitHub Gist
  (`GIST_ID` + `GITHUB_TOKEN` env vars on Vercel). Commit `4c6b710` added
  `vercel.json`.
- **Feature: Operations writes via the Update tab** — three sub-forms:
  - **New Empanelment** — add a centre (name, city, country, programmes,
    address, contact). Coordinates auto-plotted via geocoding.
  - **De-panelment** — remove a centre/programme with a reason field.
  - **Re-empanelment** — restore a previously de-panelled centre/programme.
  - Duplicate guard: blocks re-adding any centre (active OR de-panelled) with
    the same name + city + source country (case-insensitive).
- **Feature: Baseline Control** (`f1b2b4b added revert changes option`) — top
  of the Update tab. "Save as Baseline" snapshots current data into the same
  Gist as a second file (`data-snapshot.json`); "Revert to Baseline" restores
  it with a confirm prompt. Lets management test freely without affecting
  live data.
- **Feature: Insights tab — filter-aware + centre-aware**:
  - No selection → live network summary, Programme Coverage table, top cities.
  - Centre selected → spotlight card with KPIs vs city/country averages, peer
    centres in same city, "Only centre in [city] empanelled for [X]" signal,
    "Top 20% by programme breadth" signal, de-panel / validation alerts.
- **Feature: Country tab — filter-aware**:
  - Country summary cards with status breakdown.
  - City × Programme matrix when a single country is filtered.
  - Global coverage gaps surface countries with no active centre for the
    currently-filtered programme.
- **Feature: Clickable KPI cards** (`8fe9aa8`) — header KPIs are now buttons
  that apply matching filters on click.
- **Feature: WAFID programme added** as the 9th visa programme
  (`a875f3f added WAFID centre`).
- **Data: WAFID discrepancies removed** (`7871f80`); minor cleanup
  (`7cbec16 some minor changes`).
- **Data: Centre for Migration Medicine, Hyderabad (CEN-0072)** — USA programme
  status corrected from De-panelled → Active (was a mis-tag). Remark cleaned up.
- **Audit + 7 bug fixes** (one critical, three high, one medium, two low):
  - C-1: Duplicate-submission API now returns 409 (was 500).
  - H-1: `_reempanelSelectedId` declared in state object literal.
  - H-2: Re-empanel button reset arrow now matches creation glyph (`↻`).
  - H-3: `refreshUpdateCentreSelect` validates both typeaheads on data change.
  - H-4: Removed stale hard-reset of `_reempanelSelectedId` in
    `renderUpdatePane()`.
  - M-2: Startup normaliser no longer writes `sourceCountry` into empty
    `country` fields (was corrupting records).
  - L-1: Friendlier warning when `data.json` is missing on first run.
- **Data: centres grew 379 → 653** over the day's empanelment additions.
- **Push to Gist verified** — 691,395 bytes / 20,404 lines for `data.json`,
  matching the deployed site. (The Gist UI's truncated display is a known
  GitHub editor quirk; the API returns the full file via `raw_url`.)

## 2026-06-08

- **Stakeholder feedback received** (Divya) — the v1 platform is
  "significantly improved" but wants a discussion on centre-detail fields to
  make it "truly insightful." Triggered the upgrade work that landed on Jun 12.

## 2026-06-05

- **Data: updated US permanent visa statistics** in the IME workbook.
- **UI: consolidated city-card view** in the map — multiple centres in the
  same city now collapse to a single clickable marker with a popup listing
  all centres at that location.

## 2026-06-01

- **v1 delivered**: 379-centre interactive HTML map covering the M5 source
  countries × 9 destination visa programmes, plus the IME requirement workbook
  for M5 countries.
- **Same-day fix**: 72 misplotted centres re-geocoded; "Under Review" status
  tag removed from centres (was creating noise in filters and exports).
- Tech stack at v1: vanilla JS in a single `app.js`, Leaflet 1.9.4 +
  MarkerCluster + Leaflet.Heat for the map, XLSX.js for Excel export, CartoDB
  Positron tiles. Three map views (clustered markers / heatmap /
  concentration bubbles), five filter dimensions, Compare panel (up to 3
  centres, 20+ attributes, distance matrix), CSV / XLSX / PDF export.

## 2026-05-26

- Reference outputs shared (Siddharth) — suggested AI-assisted approach to
  speed up the centre validation work.

## 2026-05-25

- **Project kick-off** — two tasks assigned (Divya → Anurag):
  (1) validate and map visa medical centres across source countries;
  (2) IME requirement and volume analysis for the M5 destination countries
  (Australia, UK, Canada, USA, New Zealand).
