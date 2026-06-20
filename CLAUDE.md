# Repo guide for Claude

This file exists so an AI assistant (Claude Code, etc.) can get oriented in this
repo without re-deriving everything from scratch.

## What this app is

Internal strategy/analytics tool that visualises visa medical centres across
several source countries, filtered by destination visa programme. A single dev
maintains it. Used by the dev + their manager + occasional stakeholders. Not
public-facing.

## Tech stack (kept deliberately small)

- Backend: Node + Express in `server/api.js`. Single file. No framework on top.
- Frontend: ONE HTML file (`public/index.html`) with inline CSS + inline JS. No
  bundler, no build step. Leaflet + Leaflet.markercluster + Leaflet.heat + xlsx
  are loaded from CDN.
- Data: two JSON files in `data/`. The live `data.json`; `data-snapshot.json` is
  the baseline for the in-app Revert feature.
- Deploy: Vercel for code, GitHub Gist for data (read at request time).

## Where data flows

```
data/data.json  ──push-to-gist.ps1──►  GitHub Gist  ──server.js readDB──►  /api/centres  ──fetch──►  public/index.html
                                            ▲                                                       │
                                            └─── env vars on Vercel: GIST_ID, GITHUB_TOKEN ◄────────┘
```

Local dev (no env vars) → `readDB()` falls back to `data/data.json` on disk.
Production (env vars set) → `readDB()` fetches the Gist.

## Editing rules

- **One HTML file by design.** Do NOT split `public/index.html` into separate
  CSS/JS files or introduce a bundler. The single-file architecture lets the dev
  edit and verify without npm scripts. This is a feature.
- **Don't add build steps, TypeScript, or test frameworks** — the maintainer is
  not full-time on this, and tooling overhead has cost without matching benefit.
- **No auth.** Internal tool; don't propose login flows unless asked.
- **Inline edits beat clever abstractions.** Three similar lines is fine; a
  premature helper isn't.

## Common tasks

### Add or update centres
Edit `data/data.json` (or write a one-shot script that does it). Update
`cityConcentration` to reflect new counts — there's an example pattern in git
history (search for "rebuildCityConcentration"). Always update both `data.json`
and `data-snapshot.json` if the change is permanent.

### Add a new WAFID demand city
Append an entry to `data/data.json` → `wafidDemand.cities`. Include
geocoded `lat`/`lng`. Update `data-snapshot.json` too.

### Add a new map layer
Pattern: toolbar button → `state.mapLayer` value → branch in `renderMap()` →
cleanup line at the top of `renderMap()` → optional legend swap in
`updateMapLegend()`.

### Add a new rail tab
Pattern: `<button class="rail-tab" data-tab="...">` → matching
`<div class="rail-pane" data-pane="..." id="...">` → render function called from
both `setTab()` (when activated) and `update()` (when filters change).

## After editing

For changes observable in the browser:

1. `npm start` (or `scripts/start.bat`)
2. Open `http://localhost:3000`
3. Verify the change works for the golden path AND that no other feature broke.
4. Check the browser console for errors before reporting done.

## Deployment caveat

**A Git push alone does NOT update the live data.** Vercel reads data from the
Gist. After Git push, also run `scripts/push-to-gist.ps1` whenever you've
touched any file in `data/`.

## What lives where (quick map)

| Need to find...                  | Look in                                                |
| -------------------------------- | ------------------------------------------------------ |
| Toolbar buttons (Markers/etc.)   | `public/index.html` around the `map-toolbar` block     |
| Map render branches              | `public/index.html` — `function renderMap()`           |
| Filter logic                     | `public/index.html` — `function filterCentres()`       |
| Rail tab definitions             | `public/index.html` — search `rail-tab` and `rail-pane`|
| API endpoints                    | `server/api.js`                                        |
| Gist read/write                  | `server/api.js` — `readDB()` / `writeDB()`             |
| Snapshot/Revert                  | `server/api.js` — `readSnapshot()` / `writeSnapshot()` |
| Data schema reference            | `data/data.json` first entry                           |

## CHANGELOG hygiene

Every data change → one line in `CHANGELOG.md` with date + summary. Every
non-trivial feature → same. Skip for typo fixes.
