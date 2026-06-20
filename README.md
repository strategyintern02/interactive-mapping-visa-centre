# Visa Medical Centre Intelligence Platform

Interactive map + dashboard of visa medical centres across source countries, with
filters for visa programme (Australia, UK, Canada, USA, NZ, South Korea, Japan,
Malaysia, WAFID), status (Active / New / De-panelled), and a WAFID
source-country demand layer.

Live site: deployed on Vercel. Data lives in a GitHub Gist read at request time.

## Folder layout

```
.
├── public/        Files served to the browser. Edit index.html for UI/behaviour.
├── server/        Node/Express API. Reads data from Gist (prod) or data/ (dev).
├── data/          Source of truth for centres + WAFID demand. Pushed to the Gist.
├── scripts/       start.bat (run locally) and push-to-gist.ps1 (deploy data).
├── package.json   Express dep + npm start.
├── vercel.json    Build/route config for Vercel.
├── CHANGELOG.md   Dated record of data and feature changes.
└── CLAUDE.md      Repo guide for AI assistants (Claude Code etc.).
```

## Run locally

```powershell
# easiest — double-click scripts/start.bat
# or:
npm install
npm start
# then open http://localhost:3000
```

Local mode reads `data/data.json` directly from disk. No Gist access is needed.

## Deploying changes

Two independent moving parts:

### Code (HTML / server.js) — Git push → Vercel auto-deploys
```powershell
git add public/index.html server/api.js
git commit -m "..."
git push
```

### Data (centres + WAFID demand) — push to the Gist
The deployed Vercel server reads data from a private GitHub Gist at request time,
so a Git push alone does NOT update data. Use the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-gist.ps1 -GistId "<id>" -Token "<token>"
```

The Gist ID and a fine-grained PAT live in **Vercel → Settings → Environment
Variables** as `GIST_ID` and `GITHUB_TOKEN`. Never commit either.

## Editing the data

`data/data.json` is the single file the API serves. The `centres` array drives
the map; `wafidDemand.cities` drives the Demand layer; `cityConcentration` is a
derived cache (rebuild whenever centres change — see `CHANGELOG.md` for prior
examples). `data/data-snapshot.json` is the baseline that the in-app
"Revert to Baseline" button restores from.

Append a one-line entry to `CHANGELOG.md` whenever you touch data — future you
will thank present you.
