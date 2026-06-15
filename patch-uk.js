const fs = require('fs');

const DELETE_IDS = new Set([
  'CEN-0031','CEN-0032','CEN-0033','CEN-0040','CEN-0041','CEN-0042','CEN-0043',
  'CEN-0044','CEN-0045','CEN-0046','CEN-0047','CEN-0048','CEN-0053','CEN-0054',
  'CEN-0055','CEN-0056','CEN-0057','CEN-0058','CEN-0059','CEN-0061','CEN-0062'
]);

const ADD_UK_IDS = new Set(['CEN-0010','CEN-0024','CEN-0025','CEN-0416','CEN-0131']);

function rebuildCityConcentration(centres) {
  const programKey = {
    'Australia': 'australia', 'UK': 'uk', 'Canada': 'canada', 'USA': 'usa',
    'New Zealand': 'newZealand', 'South Korea': 'southKorea', 'Japan': 'japan',
    'Malaysia': 'malaysia', 'WAFID': 'wafid'
  };
  const buckets = new Map();
  for (const c of centres) {
    const key = (c.sourceCountry || '') + '|' + (c.city || '');
    if (!buckets.has(key)) {
      buckets.set(key, {
        country: c.sourceCountry, city: c.city, total: 0, m5: 0,
        lat: c.lat, lng: c.lng,
        australia: 0, uk: 0, canada: 0, usa: 0, newZealand: 0,
        southKorea: 0, japan: 0, malaysia: 0, wafid: 0
      });
    }
    const b = buckets.get(key);
    b.total++;
    b.m5++;
    for (const p of (c.programs || [])) {
      if (programKey[p]) b[programKey[p]]++;
    }
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

function patch(filePath) {
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const before = d.centres.length;
  const ukIndiaBefore = d.centres.filter(c => c.sourceCountry === 'India' && c.programs?.includes('UK') && c.programStatuses?.UK === 'Active').length;

  d.centres = d.centres.filter(c => !DELETE_IDS.has(c.id));

  let added = 0, cityFixed = 0;
  for (const c of d.centres) {
    if (ADD_UK_IDS.has(c.id)) {
      if (!c.programs.includes('UK')) { c.programs.push('UK'); added++; }
      c.programStatuses = c.programStatuses || {};
      c.programStatuses['UK'] = 'Active';
      c.m5PanelCount = c.programs.length;
      c.totalEmpanelment = c.programs.length;
    }
    if (c.id === 'CEN-0018' && c.city === 'Mumbai' && (c.name || '').includes('GEMS')) {
      c.city = 'Navi Mumbai';
      cityFixed++;
    }
  }

  d.cityConcentration = rebuildCityConcentration(d.centres);
  d.sourceFile = 'gov.uk India TB clinic list (8 May 2026) — 21 non-approved centres removed';
  d.generated = new Date().toISOString().slice(0, 10);

  const after = d.centres.length;
  const ukIndiaAfter = d.centres.filter(c => c.sourceCountry === 'India' && c.programs?.includes('UK') && c.programStatuses?.UK === 'Active').length;

  fs.writeFileSync(filePath, JSON.stringify(d, null, 2));

  console.log(`\n${filePath}`);
  console.log(`  Centres: ${before} -> ${after} (removed ${before - after})`);
  console.log(`  UK-India Active: ${ukIndiaBefore} -> ${ukIndiaAfter}`);
  console.log(`  UK flag added to: ${added} centres`);
  console.log(`  City corrections: ${cityFixed}`);
}

patch('./data.json');
patch('./data-snapshot.json');
