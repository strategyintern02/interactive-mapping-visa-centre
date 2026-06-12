/*
  Visa Medical Centre Intelligence Platform — Server
  --------------------------------------------------
  Start:  node server.js
  Open:   http://localhost:3000

  Data is stored in data.json (same folder).
  Geocoding uses OpenStreetMap Nominatim (free, no API key needed).
*/

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DB_PATH  = path.join(__dirname, 'data.json');
const HTML_FILE = 'visa-medical-intelligence-platform-d2.html';

// ── Database helpers ──────────────────────────────────────────────────────────

function readDB() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  // Strip BOM if present
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// FIX #2 — Write queue (mutex) so concurrent POST/PUT requests never
// interleave their read-modify-write cycles and overwrite each other.
// Node.js is single-threaded but async gaps (e.g. during geocoding) allow
// two requests to both read the same file state before either has written back.
let _dbQueue = Promise.resolve();

function withDB(fn) {
  // Chain every DB operation so they run strictly one at a time.
  const result = _dbQueue.then(fn);
  _dbQueue = result.catch(() => {}); // failed ops must not break the chain
  return result;
}

// ── Geocoding (city-level coordinates via OpenStreetMap Nominatim) ────────────

async function geocodeCity(city, country) {
  try {
    const q   = `${encodeURIComponent(city)},${encodeURIComponent(country)}`;
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VisaMedicalIntelligencePlatform/1.0 (internal)' }
    });
    if (!res.ok) throw new Error('Nominatim returned ' + res.status);
    const hits = await res.json();
    if (Array.isArray(hits) && hits.length > 0) {
      return {
        lat: parseFloat(hits[0].lat),
        lng: parseFloat(hits[0].lon),
        coordConfidence: 'city-level coordinate'
      };
    }
  } catch (e) {
    console.warn('  Geocoding failed for', city, country, '—', e.message);
  }
  return { lat: null, lng: null, coordConfidence: 'not geocoded' };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());

// Root route MUST come before express.static — otherwise static middleware
// finds index.html in the folder first and serves the old file, and this
// route never runs.  Order matters in Express.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, HTML_FILE));
});

// Block direct browser access to sensitive/stale files.
// index.html is the old version of the app — block it so the server
// always serves the current visa-medical-intelligence-platform-d2.html.
const BLOCKED = [
  '/data.json', '/server.js', '/package.json',
  '/package-lock.json', '/start.bat', '/index.html', '/app.js'
];
BLOCKED.forEach(file => {
  app.get(file, (req, res) => res.status(403).json({ error: 'Forbidden' }));
});

app.use(express.static(__dirname));   // serves remaining static assets (CDN libs are external anyway)

// ── API Routes ────────────────────────────────────────────────────────────────

/* GET /api/centres  — return all centres */
app.get('/api/centres', (req, res) => {
  try {
    const db = readDB();

    // FIX #12 — normalise every record before sending so manually-edited data.json
    // entries with wrong types (e.g. programs as a string, null programStatuses)
    // don't crash the frontend.  Mirror the same guards in the browser's loadData().
    db.centres.forEach(c => {
      if (!Array.isArray(c.programs))                                            c.programs = [];
      if (!c.programStatuses || typeof c.programStatuses !== 'object'
          || Array.isArray(c.programStatuses))                                   c.programStatuses = {};
      if (c.lat  !== null && typeof c.lat  !== 'number') c.lat  = parseFloat(c.lat)  || null;
      if (c.lng  !== null && typeof c.lng  !== 'number') c.lng  = parseFloat(c.lng)  || null;
    });

    res.json({ centres: db.centres });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not read database: ' + e.message });
  }
});

/* POST /api/centres  — add a new empanelled centre */
app.post('/api/centres', async (req, res) => {
  try {
    const { name, city, country, sourceCountry, programs, address, contact, email, remarks } = req.body;

    // Validate mandatory fields
    if (!name || !city || !country || !sourceCountry || !address) {
      return res.status(400).json({ error: 'Missing required fields (name, city, country, sourceCountry, programs, address)' });
    }
    // FIX #3 (partial) — ensure programs is actually an array, not a string or missing
    if (!Array.isArray(programs) || programs.length === 0) {
      return res.status(400).json({ error: 'programs must be a non-empty array of programme names' });
    }

    // Normalise free-text geographic fields to Title Case so new entries
    // group correctly with existing data (e.g. "delhi" → "Delhi", "india" → "India").
    // Declared first so it can be used for geocoding too.
    const toTitleCase = s => (s || '').trim().replace(/\b\w/g, c => c.toUpperCase());
    const normName          = toTitleCase(name);
    const normCity          = toTitleCase(city);
    const normCountry       = toTitleCase(country);
    const normSourceCountry = toTitleCase(sourceCountry);

    // FIX #13 — geocode using the physical location country, not sourceCountry
    // (sourceCountry = visa applicants' home country; country = where the clinic is located)
    console.log(`  Geocoding: ${normCity}, ${normCountry} ...`);
    const geo = await geocodeCity(normCity, normCountry);
    if (geo.lat) {
      console.log(`  ✓ Coordinates found: ${geo.lat}, ${geo.lng}`);
    } else {
      console.log(`  ⚠ No coordinates found — centre will appear without map marker`);
    }

    // Build the new centre record (same shape as existing centres)
    const id = 'MC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const programStatuses = {};
    programs.forEach(p => { programStatuses[p] = 'New Empanelment'; });

    const newCentre = {
      id,
      name:          normName,
      category: 'Medical Centre',
      sourceCountry: normSourceCountry,
      country:       normCountry,
      city:          normCity,
      state: '',
      address,
      programs: [...programs],
      programStatuses,
      status: 'New Empanelment',
      m5PanelCount: 0,
      totalEmpanelment: 1,
      contact:  contact  || '',
      email:    email    || '',
      website:  '',
      lat:      geo.lat,
      lng:      geo.lng,
      coordConfidence:   geo.coordConfidence,
      validationStatus:  'Verified by operations team',
      validationChannel: 'Internal verification',
      remarks:  remarks  || '',
    };

    // Duplicate check + save — wrapped in queue for concurrency safety (FIX #2)
    await withDB(() => {
      const db = readDB();

      // Check if a centre with the same name + city + source country already exists.
      // Comparison is case-insensitive so "singh clinic" matches "Singh Clinic".
      const nameLower   = normName.toLowerCase();
      const cityLower   = normCity.toLowerCase();
      const sourceLower = normSourceCountry.toLowerCase();

      const existing = db.centres.find(c =>
        c.name.toLowerCase()          === nameLower &&
        c.city.toLowerCase()          === cityLower &&
        c.sourceCountry.toLowerCase() === sourceLower
      );

      if (existing) {
        const status = existing.status;
        const err = new Error(
          status === 'De-panelled'
            ? `"${existing.name}" in ${existing.city} already exists and is currently De-panelled. ` +
              `Use the Re-empanel option in the Update tab to restore it.`
            : `"${existing.name}" in ${existing.city} already exists (status: ${status}). ` +
              `Duplicate entries are not allowed.`
        );
        err.statusCode = 409; // Conflict
        throw err;
      }

      db.centres.push(newCentre);
      writeDB(db);
    });

    console.log(`  ✓ New centre saved: ${normName} (${normCity}, ${normCountry})`);
    res.status(201).json(newCentre);

  } catch (e) {
    console.error(e);
    // C-1 FIX — use e.statusCode (set by duplicate-check) so 409 Conflict
    // is returned instead of 500 when the centre already exists.
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/* PUT /api/centres/:id/depanel  — de-panel a programme from an existing centre */
app.put('/api/centres/:id/depanel', async (req, res) => {
  try {
    const { programme, remarks } = req.body;
    if (!programme) return res.status(400).json({ error: 'programme is required' });

    let updatedCentre;

    // FIX #2 — queue the entire read-modify-write atomically
    await withDB(() => {
      const db     = readDB();
      const centre = db.centres.find(c => c.id === req.params.id);
      if (!centre) {
        const err = new Error('Centre not found');
        err.statusCode = 404;
        throw err;
      }

      // FIX #3 — validate that the programme actually exists on this centre
      // before de-panelling it, so we don't create orphaned programStatuses keys.
      if (!centre.programs.includes(programme)) {
        const err = new Error(`Programme "${programme}" is not listed for this centre`);
        err.statusCode = 400;
        throw err;
      }

      // Mark the programme as De-panelled
      centre.programStatuses[programme] = 'De-panelled';

      // Append reason to remarks if provided
      if (remarks) {
        centre.remarks = (centre.remarks ? centre.remarks + '\n' : '')
                       + `De-panel [${programme}]: ${remarks}`;
      }

      // If every programme is now De-panelled, promote top-level status
      const allDepanelled = centre.programs.every(
        p => (centre.programStatuses[p] || centre.status) === 'De-panelled'
      );
      if (allDepanelled) centre.status = 'De-panelled';

      writeDB(db);
      updatedCentre = centre;
    });

    console.log(`  ✓ De-panelled: ${updatedCentre.name} from ${programme}`);
    res.json(updatedCentre);

  } catch (e) {
    console.error(e);
    const status = e.statusCode || 500;
    res.status(status).json({ error: e.message });
  }
});

/* PUT /api/centres/:id/reempanel  — restore a de-panelled programme back to active */
app.put('/api/centres/:id/reempanel', async (req, res) => {
  try {
    const { programme, remarks } = req.body;
    if (!programme) return res.status(400).json({ error: 'programme is required' });

    let updatedCentre;

    await withDB(() => {
      const db     = readDB();
      const centre = db.centres.find(c => c.id === req.params.id);
      if (!centre) {
        const err = new Error('Centre not found');
        err.statusCode = 404;
        throw err;
      }

      if (!centre.programs.includes(programme)) {
        const err = new Error(`Programme "${programme}" is not listed for this centre`);
        err.statusCode = 400;
        throw err;
      }

      if ((centre.programStatuses[programme] || centre.status) !== 'De-panelled') {
        const err = new Error(`Programme "${programme}" is not currently De-panelled for this centre`);
        err.statusCode = 400;
        throw err;
      }

      // Restore this programme to New Empanelment
      centre.programStatuses[programme] = 'New Empanelment';

      // If no programmes are De-panelled anymore, restore top-level status
      const stillDepanelled = centre.programs.some(
        p => (centre.programStatuses[p] || centre.status) === 'De-panelled'
      );
      if (!stillDepanelled) centre.status = 'New Empanelment';

      if (remarks) {
        centre.remarks = (centre.remarks ? centre.remarks + '\n' : '')
                       + `Re-empanelled [${programme}]: ${remarks}`;
      }

      writeDB(db);
      updatedCentre = centre;
    });

    console.log(`  ✓ Re-empanelled: ${updatedCentre.name} for ${programme}`);
    res.json(updatedCentre);

  } catch (e) {
    console.error(e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── Startup: normalise any lowercase geographic fields left by manual entry ───
// Runs once on every server start — safe to run repeatedly (idempotent).
(function normaliseSavedData() {
  try {
    const toTC = s => (s || '').trim().replace(/\b\w/g, c => c.toUpperCase());
    const db   = readDB();
    let changed = 0;
    db.centres.forEach(c => {
      let dirty = false;

      // Fix capitalisation — only update a field if it had a real value;
      // never substitute sourceCountry into country when country is absent
      // (M-2 FIX: previous code used `c.country || c.sourceCountry` which
      // would overwrite a legitimately empty country with the sourceCountry).
      const fixedCity   = toTC(c.city);
      const fixedSource = toTC(c.sourceCountry);
      const fixedName   = toTC(c.name);
      if (c.city !== fixedCity)           { c.city          = fixedCity;   dirty = true; }
      if (c.sourceCountry !== fixedSource){ c.sourceCountry = fixedSource; dirty = true; }
      if (c.name !== fixedName)           { c.name          = fixedName;   dirty = true; }
      // Only touch country if it already has a value
      if (c.country) {
        const fixedCountry = toTC(c.country);
        if (c.country !== fixedCountry)   { c.country = fixedCountry;      dirty = true; }
      }

      // Fix validation status — entries added via the form by the operations
      // team are pre-verified; replace the old "To Validate / Manual entry"
      // placeholder values with the correct verified status.
      if (c.validationChannel === 'Manual entry') {
        c.validationStatus  = 'Verified by operations team';
        c.validationChannel = 'Internal verification';
        dirty = true;
      }

      if (dirty) changed++;
    });
    if (changed > 0) {
      writeDB(db);
      console.log(`  ✓ Normalised capitalisation on ${changed} record(s) in data.json`);
    }
  } catch (e) {
    // L-1 FIX — distinguish missing file (expected on first run) from real errors
    if (e.code === 'ENOENT') {
      console.warn('  ℹ data.json not found — will be created on first entry.');
    } else {
      console.warn('  ⚠ Could not normalise data on startup:', e.message);
    }
  }
})();

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n  ┌────────────────────────────────────────────────┐');
  console.log(`  │  Visa Medical Intelligence Platform            │`);
  console.log(`  │  http://localhost:${PORT}                         │`);
  console.log('  └────────────────────────────────────────────────┘');
  console.log('\n  Open the link above in your browser.\n');
});
