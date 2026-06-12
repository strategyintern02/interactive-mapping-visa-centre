/* =====================================================================
   Visa Medical Centre Intelligence Platform
   ---------------------------------------------------------------------
   Single-file application logic.
   Architecture:
     - state         : in-memory state (filters, selection, layer mode)
     - dataLayer     : load and normalize data from data.json
     - filterLayer   : apply current filter state to the centre array
     - mapLayer      : Leaflet rendering (markers, clusters, heatmap)
     - panelLayer    : left filter / right detail / bottom tray DOM
     - insightsLayer : computed metrics, top-N tables, data quality
     - exportLayer   : CSV / XLSX / PDF
   ===================================================================== */
(function(){
'use strict';

/* ----- 1. STATE ----- */
const STATUSES = ['Active','New Empanelment','De-panelled'];
const PROGRAMS = ['Australia','UK','Canada','USA','New Zealand','South Korea','Japan','Malaysia','WAFID'];
const STATUS_CLASS = {
  'Active':'active',
  'New Empanelment':'new',
  'De-panelled':'depanel'
};

const state = {
  data: null,
  filters: {
    search: '',
    statuses: new Set(STATUSES),       // all on by default
    programs: new Set(),                // empty = all programs
    countries: new Set(),               // empty = all
    city: '',
    category: '',
  },
  selected: null,                       // single centre id
  compare: [],                          // up to 3 centre ids
  mapLayer: 'markers',                  // markers | heat | concentration
  region: 'global',
  trayCollapsed: false,
};

/* ----- 2. UTILITIES ----- */
const $ = (sel, root) => (root||document).querySelector(sel);
const $$ = (sel, root) => Array.from((root||document).querySelectorAll(sel));
const fmt = n => (n==null?'—':n.toLocaleString());
const escapeHTML = s => String(s==null?'':s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pct = (n,d) => d?(Math.round((n/d)*1000)/10).toFixed(1):'0.0';
function debounce(fn, ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}}

/* ----- 3. DATA LAYER ----- */
async function loadData(){
  let raw;
  // Prefer inline data (single-file build) when available — avoids file:// fetch issues
  if (window.__INLINE_DATA__){
    raw = window.__INLINE_DATA__;
  } else {
    try {
      const res = await fetch('data.json');
      if (!res.ok) throw new Error('HTTP '+res.status);
      raw = await res.json();
    } catch(e){
      throw new Error('Failed to load data.json — '+e.message);
    }
  }
  // Normalize & enrich
  raw.centres.forEach((c,i)=>{
    c._idx = i;
    c._search = (c.name+' '+c.city+' '+c.sourceCountry+' '+(c.state||'')+' '+(c.address||'')).toLowerCase();
    if (!Array.isArray(c.programs)) c.programs = [];
  });
  state.data = raw;
  return raw;
}

/* ----- 4. FILTERING ----- */
function filterCentres(){
  const f = state.filters;
  const q = f.search.trim().toLowerCase();
  return state.data.centres.filter(c=>{
    if (!f.statuses.has(c.status)) return false;
    if (f.programs.size > 0){
      let any = false;
      for (const p of c.programs){ if (f.programs.has(p)){ any = true; break; } }
      if (!any) return false;
    }
    if (f.countries.size > 0 && !f.countries.has(c.sourceCountry)) return false;
    if (f.city && c.city !== f.city) return false;
    if (f.category && c.category !== f.category) return false;
    if (q && !c._search.includes(q)) return false;
    return true;
  });
}

/* ----- 5. MAP LAYER ----- */
let map, clusterGroup, heatLayer, concentrationLayer, markerIndex = {};

function initMap(){
  map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomControl: true })
    .setView([18, 80], 3);
  // Neutral tile (CartoDB Positron - clean, gov/exec style)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:'&copy; OpenStreetMap, &copy; CARTO',
    subdomains:'abcd',
    maxZoom: 18
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: zoom => (zoom <= 4 ? 120 : 50),
    spiderfyOnMaxZoom: true,
    iconCreateFunction: cluster => {
      const n = cluster.getChildCount();
      const size = n > 100 ? 44 : n > 30 ? 38 : 32;
      return L.divIcon({
        className:'',
        iconSize:[size,size],
        html:`<div class="cluster-marker" style="width:${size}px;height:${size}px">${n}</div>`
      });
    }
  });
  map.on('popupclose', ()=>{ /* keep selection in panel until explicit clear */ });
}

function renderMap(){
  const centres = filterCentres();
  clusterGroup.clearLayers();
  if (heatLayer){ map.removeLayer(heatLayer); heatLayer = null; }
  if (concentrationLayer){ map.removeLayer(concentrationLayer); concentrationLayer = null; }
  markerIndex = {};

  if (state.mapLayer === 'markers') {
    // Group centres by (country, city) so each city renders as ONE clickable marker
    const cityGroups = {};
    centres.forEach(c=>{
      if (c.lat == null || c.lng == null) return;
      const k = c.sourceCountry + '|' + c.city;
      if (!cityGroups[k]) cityGroups[k] = { country:c.sourceCountry, city:c.city, lat:c.lat, lng:c.lng, centres:[] };
      cityGroups[k].centres.push(c);
    });

    Object.entries(cityGroups).forEach(([k, g])=>{
      const count = g.centres.length;
      // Status precedence for ring colour: depanel > new > active
      const statuses = g.centres.map(c=>c.status);
      let cls = 'cm-active';
      if (statuses.includes('De-panelled'))     cls = 'cm-depanel';
      else if (statuses.includes('New Empanelment')) cls = 'cm-new';

      // Size scales with count (bigger = easier to click)
      const size = count >= 10 ? 40 : count >= 5 ? 36 : count >= 2 ? 32 : 28;
      const icon = L.divIcon({
        className:'',
        iconSize:[size,size],
        iconAnchor:[size/2, size/2],
        html:`<div class="city-marker ${cls}" style="width:${size}px;height:${size}px;font-size:${count>=10?13:12}px" title="${escapeHTML(g.city)}, ${escapeHTML(g.country)} — ${count} centre${count===1?'':'s'}">${count}</div>`
      });
      const m = L.marker([g.lat, g.lng], { icon, title: `${g.city}, ${g.country}` });
      m.bindPopup(()=>cityPopupHTML(g), { maxWidth: 380, minWidth: 280, autoPanPadding: [40, 40] });
      m._cityKey = k;
      clusterGroup.addLayer(m);
      // Index each centre's id → its city marker so 'Locate on map' still works
      g.centres.forEach(c=>{ markerIndex[c.id] = m; });
    });
    map.addLayer(clusterGroup);
  } else if (state.mapLayer === 'heat') {
    const pts = centres.filter(c=>c.lat!=null).map(c=>[c.lat, c.lng, 0.7]);
    heatLayer = L.heatLayer(pts, { radius: 26, blur: 22, maxZoom: 8,
      gradient: {0.2:'#9ca3af', 0.4:'#6b7280', 0.6:'#374151', 0.8:'#1f2937', 1.0:'#111827'}
    }).addTo(map);
  } else if (state.mapLayer === 'concentration') {
    // Use city concentration data — bubble per city sized by count
    concentrationLayer = L.layerGroup();
    const cityAgg = {};
    centres.forEach(c=>{
      if (c.lat == null) return;
      const k = c.sourceCountry + '|' + c.city;
      if (!cityAgg[k]) cityAgg[k] = { country:c.sourceCountry, city:c.city, lat:c.lat, lng:c.lng, count:0, centres:[] };
      cityAgg[k].count++;
      cityAgg[k].centres.push(c);
    });
    Object.values(cityAgg).forEach(cc=>{
      const r = Math.max(6, Math.min(30, 4 + cc.count*2));
      const circle = L.circleMarker([cc.lat, cc.lng], {
        radius: r,
        color: '#1f2937',
        weight: 1.5,
        opacity: .85,
        fillColor: '#374151',
        fillOpacity: .25
      });
      circle.bindPopup(`
        <div class="popup-title">${escapeHTML(cc.city)}, ${escapeHTML(cc.country)}</div>
        <div class="popup-meta">${cc.count} centre${cc.count===1?'':'s'} match current filters</div>
        ${cc.centres.slice(0,8).map(c=>`
          <div class="popup-row">
            <span><b>${escapeHTML(c.name)}</b></span>
            <span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>
          </div>`).join('')}
        ${cc.centres.length>8?`<div class="popup-meta" style="margin-top:6px">+ ${cc.centres.length-8} more</div>`:''}
      `,{maxWidth:340});
      // Add count label
      const label = L.divIcon({
        className:'',
        iconSize:[r*2,r*2],
        iconAnchor:[r,r],
        html:`<div style="width:${r*2}px;height:${r*2}px;display:flex;align-items:center;justify-content:center;font-size:${r>12?12:10}px;font-weight:600;color:#111827;pointer-events:none">${cc.count}</div>`
      });
      const lblMarker = L.marker([cc.lat, cc.lng], { icon: label, interactive: false });
      concentrationLayer.addLayer(circle);
      concentrationLayer.addLayer(lblMarker);
    });
    concentrationLayer.addTo(map);
  }

  // Update toolbar counts
  const cities = new Set(centres.map(c=>c.sourceCountry+'|'+c.city));
  const countries = new Set(centres.map(c=>c.sourceCountry));
  $('#visibleCentres').textContent = fmt(centres.length);
  $('#totalCentres').textContent = fmt(state.data.centres.length);
  $('#visibleCities').textContent = fmt(cities.size);
  $('#visibleCountries').textContent = fmt(countries.size);
}

function cityPopupHTML(g){
  // Per-programme totals across all centres in this city
  const progCounts = {};
  g.centres.forEach(c => c.programs.forEach(p => { progCounts[p] = (progCounts[p]||0) + 1; }));
  const progTotals = Object.entries(progCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([p,n]) => `<span class="pill pill-neutral" style="margin:2px 3px 2px 0">${escapeHTML(p)}: <b style="color:var(--text)">${n}</b></span>`)
    .join('');

  // Each centre as a sub-block with its full programme-approval pills
  const centresHTML = g.centres.map(c => {
    const progPills = c.programs.map(p => {
      const s = c.programStatuses[p] || c.status;
      const sc = STATUS_CLASS[s] || 'active';
      return `<span class="pill pill-${sc}" style="margin:1px 3px 1px 0;font-size:10.5px"><span class="dot"></span>${escapeHTML(p)}</span>`;
    }).join('');
    const statusPill = `<span class="pill pill-${STATUS_CLASS[c.status]}" style="margin-left:5px;font-size:10.5px;vertical-align:middle"><span class="dot"></span>${c.status}</span>`;
    return `
      <div class="popup-centre">
        <div class="popup-centre-name"><b>${escapeHTML(c.name)}</b>${c.status !== 'Active' ? statusPill : ''}</div>
        <div class="popup-centre-progs">${progPills}</div>
        <button class="popup-detail-link" onclick="window.__app.selectCentre('${c.id}')">View details →</button>
      </div>
    `;
  }).join('');

  return `
    <div class="popup-title">${escapeHTML(g.city)}, ${escapeHTML(g.country)}</div>
    <div class="popup-meta">${g.centres.length} centre${g.centres.length===1?'':'s'} · click "View details" for full record</div>
    ${progTotals ? `<div class="popup-prog-totals">${progTotals}</div>` : ''}
    <div class="popup-centres">${centresHTML}</div>
    <div class="popup-footer">Source: validated Sep 2025 panel list. Verify with destination authorities before external use.</div>
  `;
}

/* ----- 6. PANEL LAYER ----- */

// --- Top KPIs (header) ---
function renderTopKpis(){
  const all = state.data.centres;
  const countries = new Set(all.map(c=>c.sourceCountry)).size;
  const cities = new Set(all.map(c=>c.sourceCountry+'|'+c.city)).size;
  const html = [
    {l:'Centres', v: fmt(all.length)},
    {l:'Countries', v: fmt(countries)},
    {l:'Cities', v: fmt(cities)},
    {l:'Programs', v: PROGRAMS.length},
  ].map(k=>`<div class="kpi"><div class="kpi-val">${k.v}</div><div class="kpi-lbl">${k.l}</div></div>`).join('');
  $('#topKpis').innerHTML = html;
}

// --- Rail KPIs (live, filtered) ---
// 'Active' counts overall=Active. 'New' and 'De-panelled' count any centre with
// at least one such programme — so partial de-panellings (e.g. de-panelled from
// USA only) are visible in the headline number.
function renderSideKpis(){
  const v = filterCentres();
  const counts = {
    'Active':          v.filter(c=>c.status==='Active' && !Object.values(c.programStatuses).some(s=>s==='De-panelled' || s==='New Empanelment')).length,
    'New Empanelment': v.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment')).length,
    'De-panelled':     v.filter(c=>Object.values(c.programStatuses).some(s=>s==='De-panelled')).length,
  };
  const SHORT = {'Active':'Active','New Empanelment':'New','De-panelled':'De-panelled'};
  $('#railKpis').innerHTML = STATUSES.map(s=>`
    <div class="rkpi k-${STATUS_CLASS[s]}" title="${s}: ${fmt(counts[s]||0)} centres in current view">
      <div class="v">${fmt(counts[s]||0)}</div>
      <div class="l">${SHORT[s]}</div>
    </div>
  `).join('');
}

// --- Filter checkboxes ---
function renderFilters(){
  const all = state.data.centres;
  const byStatus = countBy(all, c=>c.status);
  const byProgram = {};
  all.forEach(c=>c.programs.forEach(p=>{byProgram[p] = (byProgram[p]||0)+1;}));
  const byCountry = countBy(all, c=>c.sourceCountry);

  // Status
  $('#filterStatus').innerHTML = STATUSES.map(s=>`
    <label class="checkbox-row">
      <input type="checkbox" data-status="${s}" ${state.filters.statuses.has(s)?'checked':''}/>
      <span class="pill pill-${STATUS_CLASS[s]}"><span class="dot"></span>${s}</span>
      <span class="count">${fmt(byStatus[s]||0)}</span>
    </label>
  `).join('');
  $$('#filterStatus input').forEach(inp=>inp.addEventListener('change',e=>{
    const s = e.target.dataset.status;
    if (e.target.checked) state.filters.statuses.add(s); else state.filters.statuses.delete(s);
    update();
  }));

  // Program
  $('#filterProgram').innerHTML = PROGRAMS.map(p=>`
    <label class="checkbox-row">
      <input type="checkbox" data-program="${p}" ${state.filters.programs.has(p)?'checked':''}/>
      <span>${p}</span>
      <span class="count">${fmt(byProgram[p]||0)}</span>
    </label>
  `).join('');
  $$('#filterProgram input').forEach(inp=>inp.addEventListener('change',e=>{
    const p = e.target.dataset.program;
    if (e.target.checked) state.filters.programs.add(p); else state.filters.programs.delete(p);
    update();
  }));

  // Country
  const countriesSorted = Object.entries(byCountry).sort((a,b)=>b[1]-a[1]);
  $('#filterCountry').innerHTML = countriesSorted.map(([k,v])=>`
    <label class="checkbox-row">
      <input type="checkbox" data-country="${escapeHTML(k)}" ${state.filters.countries.has(k)?'checked':''}/>
      <span>${escapeHTML(k)}</span>
      <span class="count">${fmt(v)}</span>
    </label>
  `).join('');
  $$('#filterCountry input').forEach(inp=>inp.addEventListener('change',e=>{
    const c = e.target.dataset.country;
    if (e.target.checked) state.filters.countries.add(c); else state.filters.countries.delete(c);
    refreshCityFilter();
    update();
  }));

  // Category dropdown
  const cats = Object.entries(countBy(all, c=>c.category)).sort((a,b)=>b[1]-a[1]);
  $('#filterCategory').innerHTML = `<option value="">All categories (${all.length})</option>` +
    cats.map(([k,v])=>`<option value="${escapeHTML(k)}">${escapeHTML(k)} (${v})</option>`).join('');
  $('#filterCategory').addEventListener('change', e=>{
    state.filters.category = e.target.value;
    update();
  });

  refreshCityFilter();
}

function refreshCityFilter(){
  const f = state.filters;
  const pool = state.data.centres.filter(c=>
    (f.countries.size===0 || f.countries.has(c.sourceCountry))
  );
  const cityCounts = countBy(pool, c=>c.sourceCountry+'|'+c.city);
  const arr = Object.entries(cityCounts)
    .map(([k,v])=>{ const [country,city] = k.split('|'); return {country, city, count:v}; })
    .sort((a,b)=>b.count-a.count);
  const cur = state.filters.city;
  $('#filterCity').innerHTML = `<option value="">All cities (${pool.length} centres)</option>` +
    arr.map(c=>`<option value="${escapeHTML(c.city)}" ${c.city===cur?'selected':''}>${escapeHTML(c.city)}, ${escapeHTML(c.country)} (${c.count})</option>`).join('');
}

// --- Right rail: centre details ---
function renderDetail(){
  const host = $('#detailHost');
  if (!state.selected){
    host.innerHTML = `<div class="detail-empty" id="detailEmpty">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#9aa4b2" stroke-width="1.4"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/></svg>
      <div style="font-weight:500;color:var(--text-2)">No centre selected</div>
      <div style="font-size:11px;color:var(--muted-2);margin-top:10px;line-height:1.5;max-width:280px;margin-left:auto;margin-right:auto">Click any marker on the map to view full details, or pick a centre from the Country or Changes tables.</div>
    </div>`;
    return;
  }
  const c = state.data.centres.find(x=>x.id===state.selected);
  if (!c){ state.selected=null; renderDetail(); return; }
  const inCompare = state.compare.includes(c.id);

  // Program table
  const progRows = c.programs.map(p=>{
    const s = c.programStatuses[p] || c.status;
    return `<tr><td>${escapeHTML(p)}</td><td><span class="pill pill-${STATUS_CLASS[s]}"><span class="dot"></span>${s}</span></td></tr>`;
  }).join('') || '<tr><td colspan="2" style="color:var(--muted)">No programs flagged</td></tr>';

  // Validation info
  const validatedSrc = c.validationStatus && c.validationStatus !== 'To Validate';
  const validation = validatedSrc
    ? `<span class="pill pill-active"><span class="dot"></span>Source identified</span>`
    : `<span class="pill pill-review"><span class="dot"></span>Pending official refresh</span>`;

  host.innerHTML = `
    <div class="detail-card">
      <div class="detail-head">
        <div class="detail-name">${escapeHTML(c.name)}</div>
        <div class="detail-loc">${escapeHTML(c.city)}${c.state?', '+escapeHTML(c.state):''} · ${escapeHTML(c.sourceCountry)}</div>
        <div class="detail-status-row">
          <span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>
          <span class="pill pill-neutral"><span class="dot"></span>${escapeHTML(c.category)}</span>
          <span class="pill pill-neutral"><span class="dot"></span>${c.programs.length} programs</span>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ${inCompare?'btn-primary':''}" id="btnCmpAdd">${inCompare?'✓ In compare':'+ Add to compare'}</button>
          <button class="btn" id="btnFlyTo">Locate on map</button>
          <button class="btn btn-ghost" id="btnCloseDetail" style="margin-left:auto">Close</button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Identification</div>
        <dl class="dl">
          <dt>Centre ID</dt><dd style="font-family:monospace;font-size:11px">${escapeHTML(c.id)}</dd>
          <dt>Source country</dt><dd>${escapeHTML(c.sourceCountry)}</dd>
          <dt>State / Region</dt><dd>${escapeHTML(c.state)||'—'}</dd>
          <dt>City</dt><dd>${escapeHTML(c.city)}</dd>
          <dt>Address</dt><dd>${escapeHTML(c.address)||'—'}</dd>
          <dt>Coordinates</dt><dd>${c.lat!=null?`${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`:'—'} <span style="color:var(--muted);font-size:10px">${escapeHTML(c.coordConfidence)||''}</span></dd>
        </dl>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Visa Programmes Supported</div>
        <table class="prog-table"><thead><tr><th>Programme</th><th>Status</th></tr></thead><tbody>${progRows}</tbody></table>
        <div style="margin-top:6px;font-size:11px;color:var(--muted)">M5 panel count: <b style="color:var(--text)">${c.m5PanelCount||0}</b> · Total empanelment: <b style="color:var(--text)">${c.totalEmpanelment||0}</b></div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Contact</div>
        <dl class="dl">
          <dt>Phone</dt><dd>${escapeHTML(c.contact)||'—'}</dd>
          <dt>Email</dt><dd>${c.email?`<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a>`:'—'}</dd>
          <dt>Website</dt><dd>${c.website?`<a href="https://${escapeHTML(c.website)}" target="_blank" rel="noopener">${escapeHTML(c.website)}</a>`:'—'}</dd>
        </dl>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Validation</div>
        <dl class="dl">
          <dt>Verified</dt><dd>${validation}</dd>
          <dt>Channel</dt><dd>${escapeHTML(c.validationChannel)||'—'}</dd>
          <dt>Status</dt><dd style="font-size:11px;color:var(--muted)">${escapeHTML(c.validationStatus)||'—'}</dd>
        </dl>
      </div>

      ${c.remarks?`<div class="detail-section">
        <div class="detail-section-title">Remarks</div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.55">${escapeHTML(c.remarks)}</div>
      </div>`:''}
    </div>
  `;

  $('#btnCmpAdd').onclick = ()=>toggleCompare(c.id);
  $('#btnFlyTo').onclick = ()=>{ if (c.lat!=null) { map.flyTo([c.lat,c.lng], 9, {duration:0.6}); setTimeout(()=>{ const m = markerIndex[c.id]; if (m) m.openPopup(); }, 700); } };
  $('#btnCloseDetail').onclick = ()=>{ state.selected = null; renderDetail(); };
}

function selectCentre(id){
  state.selected = id;
  renderDetail();
  setTab('detail');
  // On narrow screens slide the rail in
  if (window.innerWidth < 821) {
    $('#rail').classList.add('show');
  }
}

/* ----- COMPARE ----- */
function toggleCompare(id){
  const i = state.compare.indexOf(id);
  if (i>=0) state.compare.splice(i,1);
  else if (state.compare.length < 3) state.compare.push(id);
  renderCompareBar();
  if (state.selected === id) renderDetail();
}

function renderCompareBar(){
  const bar = $('#compareBar');
  if (state.compare.length === 0){
    bar.classList.remove('active');
    return;
  }
  bar.classList.add('active');
  const slots = [0,1,2].map(i=>{
    const id = state.compare[i];
    if (!id) return `<div class="compare-slot empty">Slot ${i+1}</div>`;
    const c = state.data.centres.find(x=>x.id===id);
    return `<div class="compare-slot" title="${escapeHTML(c.name)}">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(c.name)}</span>
      <span class="x" data-cid="${id}">×</span>
    </div>`;
  }).join('');
  $('#compareSlots').innerHTML = slots;
  $$('#compareSlots .x').forEach(x=>x.onclick = ()=>toggleCompare(x.dataset.cid));
}

function openCompareModal(){
  if (state.compare.length < 1) return;
  const centres = state.compare.map(id=>state.data.centres.find(c=>c.id===id)).filter(Boolean);
  if (!centres.length) return;
  const cols = `auto repeat(${centres.length}, 1fr)`;
  const fields = [
    ['Centre ID', c=>`<code style="font-size:10px">${escapeHTML(c.id)}</code>`],
    ['Status', c=>`<span class="pill pill-${STATUS_CLASS[c.status]}"><span class="dot"></span>${c.status}</span>`],
    ['Country', c=>escapeHTML(c.sourceCountry)],
    ['City', c=>escapeHTML(c.city)],
    ['State / Region', c=>escapeHTML(c.state)||'—'],
    ['Category', c=>escapeHTML(c.category)],
    ['Address', c=>escapeHTML(c.address)||'—'],
    ['Programs supported', c=>c.programs.map(p=>{
      const s=c.programStatuses[p]||c.status;
      return `<span class="pill pill-${STATUS_CLASS[s]}" style="margin:1px"><span class="dot"></span>${p}</span>`;
    }).join(' ')||'—'],
    ['M5 panel count', c=>fmt(c.m5PanelCount)],
    ['Total empanelment', c=>fmt(c.totalEmpanelment)],
    ['Phone', c=>escapeHTML(c.contact)||'—'],
    ['Email', c=>c.email?`<a href="mailto:${escapeHTML(c.email)}">${escapeHTML(c.email)}</a>`:'—'],
    ['Website', c=>c.website?`<a href="https://${escapeHTML(c.website)}" target="_blank">${escapeHTML(c.website)}</a>`:'—'],
    ['Validation status', c=>escapeHTML(c.validationStatus)||'—'],
    ['Verification source', c=>escapeHTML(c.validationChannel)||'—'],
    ['Coordinates', c=>c.lat!=null?`${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`:'—'],
    ['Coord. confidence', c=>escapeHTML(c.coordConfidence)||'—'],
    ['Remarks', c=>escapeHTML(c.remarks)||'—'],
  ];
  // Add distance if 2+ centres
  if (centres.length >= 2){
    fields.push(['Distance from #1', c=>{
      if (c===centres[0]||c.lat==null||centres[0].lat==null) return '—';
      const d = haversine(centres[0].lat, centres[0].lng, c.lat, c.lng);
      return `${d.toFixed(0)} km`;
    }]);
  }
  let html = `<div class="cmp-grid" style="grid-template-columns:${cols}">`;
  // Header row
  html += `<div class="cmp-row header" style="grid-template-columns:${cols}">
    <div class="cmp-cell">Attribute</div>
    ${centres.map(c=>`<div class="cmp-cell"><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</span></div>`).join('')}
  </div>`;
  fields.forEach(([label, fn])=>{
    html += `<div class="cmp-row" style="grid-template-columns:${cols}">
      <div class="cmp-cell">${escapeHTML(label)}</div>
      ${centres.map(c=>`<div class="cmp-cell">${fn(c)}</div>`).join('')}
    </div>`;
  });
  html += `</div>`;
  if (centres.length >= 2){
    html += `<div style="margin-top:12px;font-size:11px;color:var(--muted);padding:8px 10px;background:var(--bg-soft);border:1px solid var(--border);border-radius:3px">
      <b>GIS distance matrix</b> (km, great-circle):<br/>${distanceMatrix(centres)}
    </div>`;
  }
  $('#cmpBody').innerHTML = html;
  $('#cmpModal').classList.add('active');
}

function haversine(lat1, lon1, lat2, lon2){
  const R=6371, toR=d=>d*Math.PI/180;
  const dLat=toR(lat2-lat1), dLon=toR(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distanceMatrix(arr){
  const rows = [];
  for (let i=0;i<arr.length;i++){
    for (let j=i+1;j<arr.length;j++){
      if (arr[i].lat==null||arr[j].lat==null) continue;
      const d = haversine(arr[i].lat, arr[i].lng, arr[j].lat, arr[j].lng);
      rows.push(`${escapeHTML(arr[i].city)} ↔ ${escapeHTML(arr[j].city)}: <b>${d.toFixed(0)} km</b>`);
    }
  }
  return rows.join(' · ') || 'Insufficient coordinates';
}

/* ----- 7. INSIGHTS LAYER ----- */
function countBy(arr, fn){
  const out = {};
  arr.forEach(x=>{ const k = fn(x); out[k] = (out[k]||0)+1; });
  return out;
}

function renderInsights(){
  const all = state.data.centres;
  const visible = filterCentres();
  const byCountry = countBy(all, c=>c.sourceCountry);
  const byCity = countBy(all, c=>c.sourceCountry+'|'+c.city);
  // Count any centre with at least one new/de-panelled programme (includes partial)
  const newSet = all.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment'));
  const depSet = all.filter(c=>Object.values(c.programStatuses).some(s=>s==='De-panelled'));
  const newCentres = newSet.length;
  const depanel    = depSet.length;
  const active     = all.length - newCentres - depSet.filter(c=>!newSet.includes(c)).length;
  const validated  = all.filter(c=>c.validationStatus && c.validationStatus !== 'To Validate' && c.validationStatus !== 'Internal list only - live official validation required').length;

  const newByCountry      = countBy(newSet, c=>c.sourceCountry);
  const depanelByCountry  = countBy(depSet, c=>c.sourceCountry);
  const topCountries = Object.entries(byCountry).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const topCities = Object.entries(byCity).map(([k,v])=>{const[c,city]=k.split('|');return {country:c,city,count:v};}).sort((a,b)=>b.count-a.count).slice(0,8);
  const byStatus = {
    'Active':          all.length - newCentres - depanel + newSet.filter(c=>depSet.includes(c)).length,
    'New Empanelment': newCentres,
    'De-panelled':     depanel,
  };

  const review = all.filter(c=>c.validationStatus === 'Priority for official validation refresh').length;

  $('#paneInsights').innerHTML = `
    <div class="insight-grid">
      <div class="insight"><h5>Active</h5><div class="big" style="color:var(--st-active)">${fmt(active)}</div><div class="sub">${pct(active,all.length)}% of network</div></div>
      <div class="insight"><h5>New empanelments</h5><div class="big" style="color:var(--st-new)">${fmt(newCentres)}</div><div class="sub">${Object.keys(newByCountry).length} countries</div></div>
      <div class="insight"><h5>De-panelled</h5><div class="big" style="color:var(--st-depanel)">${fmt(depanel)}</div><div class="sub">${Object.keys(depanelByCountry).length} countries · incl. partial</div></div>
      <div class="insight"><h5>Total network</h5><div class="big">${fmt(all.length)}</div><div class="sub">across ${new Set(all.map(c=>c.sourceCountry)).size} countries</div></div>
    </div>

    <div class="insight" style="margin-bottom:10px">
      <h5>Validation coverage</h5>
      <div class="big">${pct(validated,all.length)}%</div>
      <div class="sub">${fmt(validated)} of ${fmt(all.length)} centres have an identified source</div>
    </div>

    <div class="section-title">Top source countries</div>
    <table class="tbl">
      <thead><tr><th class="rank">#</th><th>Country</th><th class="num">Centres</th><th>Share</th></tr></thead>
      <tbody>
        ${topCountries.map(([k,v],i)=>{
          const w = Math.round(v/topCountries[0][1]*100);
          return `<tr><td class="rank">${i+1}</td><td><button class="tbl-link" data-fc="${escapeHTML(k)}">${escapeHTML(k)}</button></td><td class="num">${fmt(v)}</td><td><span class="bar-track"><span class="bar" style="width:${w}%"></span></span>${pct(v,all.length)}%</td></tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="section-title">Most concentrated cities</div>
    <table class="tbl">
      <thead><tr><th class="rank">#</th><th>City</th><th class="num">Centres</th></tr></thead>
      <tbody>
        ${topCities.map((x,i)=>`<tr><td class="rank">${i+1}</td><td><button class="tbl-link" data-fcity="${escapeHTML(x.city)}">${escapeHTML(x.city)}</button><span style="color:var(--muted);font-size:10px"> · ${escapeHTML(x.country)}</span></td><td class="num">${fmt(x.count)}</td></tr>`).join('')}
      </tbody>
    </table>

    <div class="section-title">Status distribution</div>
    <table class="tbl">
      <thead><tr><th>Status</th><th class="num">Count</th><th>Share</th></tr></thead>
      <tbody>
        ${STATUSES.map(s=>{const v=byStatus[s]||0;return `<tr><td><span class="pill pill-${STATUS_CLASS[s]}"><span class="dot"></span>${s}</span></td><td class="num">${fmt(v)}</td><td>${pct(v,all.length)}%</td></tr>`;}).join('')}
      </tbody>
    </table>

    <div class="section-title">Action items</div>
    <div style="font-size:12px;color:var(--text-2);line-height:1.6">
      ${depanel? `<div>→ Review <b>${depanel}</b> de-panelled centre${depanel===1?'':'s'} for client communications</div>`:''}
      ${newCentres?`<div>→ Onboard <b>${newCentres}</b> new empanelment${newCentres===1?'':'s'} into operations</div>`:''}
      ${review? `<div>→ Refresh <b>${review}</b> under-review centre${review===1?'':'s'} via official live sources</div>`:''}
    </div>
  `;
  // Hook drill-down links
  $$('#paneInsights .tbl-link[data-fc]').forEach(b=>b.onclick=()=>{
    state.filters.countries.clear();
    state.filters.countries.add(b.dataset.fc);
    syncFilterUI();
    update();
  });
  $$('#paneInsights .tbl-link[data-fcity]').forEach(b=>b.onclick=()=>{
    state.filters.city = b.dataset.fcity;
    $('#filterCity').value = b.dataset.fcity;
    update();
  });
}

function renderCountryPane(){
  const all = state.data.centres;
  const countries = Array.from(new Set(all.map(c=>c.sourceCountry))).sort();
  const rows = countries.map(country=>{
    const list = all.filter(c=>c.sourceCountry===country);
    const cities = new Set(list.map(c=>c.city)).size;
    // Count any centre with at least one new/de-panelled programme
    const news = list.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment')).length;
    const dep  = list.filter(c=>Object.values(c.programStatuses).some(s=>s==='De-panelled')).length;
    const active = list.length - news - dep + list.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment') && Object.values(c.programStatuses).some(s=>s==='De-panelled')).length;
    return {country, total:list.length, cities, active, news, dep};
  }).sort((a,b)=>b.total-a.total);
  const maxT = rows.length ? rows[0].total : 1;

  $('#paneCountry').innerHTML = `
    <div class="section-title" style="margin-top:0">Country intelligence — click a row to filter</div>
    <table class="tbl">
      <thead><tr>
        <th class="rank">#</th>
        <th>Country</th>
        <th class="num">Centres</th>
        <th class="num">Cities</th>
        <th>Status breakdown</th>
      </tr></thead>
      <tbody>
        ${rows.map((r,i)=>{
          // Build a compact 3-segment status stack bar
          const segs = [
            {n:r.active, c:'st-active'},
            {n:r.news,   c:'st-new'},
            {n:r.dep,    c:'st-depanel'},
          ].filter(s=>s.n>0);
          const segHTML = segs.map(s=>`<span style="display:inline-block;height:8px;background:var(--${s.c});width:${(s.n/r.total*100).toFixed(1)}%" title="${s.n}"></span>`).join('');
          return `<tr style="cursor:pointer" data-country="${escapeHTML(r.country)}">
            <td class="rank">${i+1}</td>
            <td><b>${escapeHTML(r.country)}</b></td>
            <td class="num">${fmt(r.total)}</td>
            <td class="num">${fmt(r.cities)}</td>
            <td><div style="display:flex;width:100%;border-radius:1px;overflow:hidden;background:var(--bg-soft);border:1px solid var(--border)">${segHTML}</div>
                <div style="display:flex;gap:6px;margin-top:3px;font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums">
                  <span style="color:var(--st-active)">A ${r.active}</span>
                  ${r.news?`<span style="color:var(--st-new)">N ${r.news}</span>`:''}
                  ${r.dep ?`<span style="color:var(--st-depanel)">D ${r.dep}</span>`:''}
                </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="font-size:10px;color:var(--muted-2);margin-top:6px">A = Active · N = New empanelment · D = De-panelled</div>
  `;
  $$('#paneCountry tbody tr').forEach(tr=>tr.onclick=()=>{
    state.filters.countries.clear();
    state.filters.countries.add(tr.dataset.country);
    syncFilterUI();
    update();
  });
}

function renderValidationPane(){
  const all = state.data.centres;
  const validated = all.filter(c=>c.validationStatus && c.validationStatus !== 'To Validate' && c.validationStatus !== 'Internal list only - live official validation required');
  const sources = countBy(all, c=>c.validationChannel || 'Unspecified');
  const sourceRows = Object.entries(sources).sort((a,b)=>b[1]-a[1]);

  $('#paneValidation').innerHTML = `
    <div class="section-title">Validation statistics</div>
    <div class="insight-grid">
      <div class="insight"><h5>Coverage</h5><div class="big">${pct(validated.length,all.length)}%</div><div class="sub">${fmt(validated.length)} / ${fmt(all.length)} mapped to a source</div></div>
      <div class="insight"><h5>Sources in use</h5><div class="big">${fmt(sourceRows.length)}</div><div class="sub">Distinct validation channels</div></div>
      <div class="insight"><h5>Priority refresh</h5><div class="big" style="color:var(--st-review)">${fmt(all.filter(c=>c.validationStatus==='Priority for official validation refresh').length)}</div><div class="sub">Awaiting refresh</div></div>
      <div class="insight"><h5>Coordinate quality</h5><div class="big">${pct(all.filter(c=>c.coordConfidence==='city-level coordinate').length,all.length)}%</div><div class="sub">City-level geocoded</div></div>
    </div>

    <div class="section-title">Validation channels</div>
    <table class="tbl">
      <thead><tr><th>Channel</th><th class="num">Centres</th><th>Share</th></tr></thead>
      <tbody>
        ${sourceRows.map(([k,v])=>`<tr><td style="font-size:11px">${escapeHTML(k)}</td><td class="num">${fmt(v)}</td><td><span class="bar-track"><span class="bar" style="width:${Math.round(v/sourceRows[0][1]*100)}%"></span></span>${pct(v,all.length)}%</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderNewPane(){
  const news = state.data.centres.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment'));
  $('#paneNew').innerHTML = `
    <div class="section-title" style="margin-top:0;color:var(--st-new)">▲ New empanelments — ${news.length}</div>
    ${news.length===0
      ? `<div style="padding:16px;color:var(--muted);text-align:center;font-size:12px;background:var(--bg-card);border:1px dashed var(--border-strong);border-radius:3px">No centres currently flagged as new empanelment.</div>`
      : `<table class="tbl">
        <thead><tr><th>Centre</th><th>Location</th><th>New for</th></tr></thead>
        <tbody>
          ${news.map(c=>{
            const newProgs = Object.entries(c.programStatuses).filter(([,s])=>s==='New Empanelment').map(([p])=>p);
            return `<tr style="cursor:pointer" data-cid="${c.id}">
              <td><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.id)}</span></td>
              <td style="font-size:11px">${escapeHTML(c.city)}<br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.sourceCountry)}</span></td>
              <td>${newProgs.map(p=>`<span class="pill pill-new" style="margin:1px 2px 1px 0"><span class="dot"></span>${p}</span>`).join('')||'—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`
    }`;
  $$('#paneNew tbody tr').forEach(tr=>tr.onclick=()=>selectCentre(tr.dataset.cid));
}

function renderDepanelPane(){
  const dep = state.data.centres.filter(c=>c.status==='De-panelled' || Object.values(c.programStatuses).some(s=>s==='De-panelled'));
  $('#paneDepanel').innerHTML = `
    <div class="section-title" style="color:var(--st-depanel)">▼ De-panellings — ${dep.length} (includes program-level removals)</div>
    ${dep.length===0
      ? `<div style="padding:16px;color:var(--muted);text-align:center;font-size:12px;background:var(--bg-card);border:1px dashed var(--border-strong);border-radius:3px">No de-panelled centres in the active dataset.</div>`
      : `<table class="tbl">
        <thead><tr><th>Centre</th><th>Location</th><th>Removed from</th></tr></thead>
        <tbody>
          ${dep.map(c=>{
            const removedFrom = Object.entries(c.programStatuses).filter(([k,v])=>v==='De-panelled').map(([k])=>k);
            return `<tr style="cursor:pointer" data-cid="${c.id}">
              <td><b>${escapeHTML(c.name)}</b><br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.id)} · ${c.status}</span></td>
              <td style="font-size:11px">${escapeHTML(c.city)}<br/><span style="color:var(--muted);font-size:10px">${escapeHTML(c.sourceCountry)}</span></td>
              <td>${removedFrom.map(p=>`<span class="pill pill-depanel" style="margin:1px 2px 1px 0"><span class="dot"></span>${p}</span>`).join('')||'<span style="color:var(--muted)">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}`;
  $$('#paneDepanel tbody tr').forEach(tr=>tr.onclick=()=>selectCentre(tr.dataset.cid));
}

function renderQualityPane(){
  const all = state.data.centres;
  const missingCoords = all.filter(c=>c.lat==null);
  const missingPhone = all.filter(c=>!c.contact);
  const missingEmail = all.filter(c=>!c.email);
  const missingAddress = all.filter(c=>!c.address);
  const noPrograms = all.filter(c=>!c.programs.length);
  const review = all.filter(c=>c.status==='Under Review');
  const lowConfCoord = all.filter(c=>c.coordConfidence && c.coordConfidence.includes('fallback'));
  const dupMap = {};
  all.forEach(c=>{const k = c.name.trim().toLowerCase()+'|'+c.city.trim().toLowerCase(); (dupMap[k]=dupMap[k]||[]).push(c);});
  const duplicates = Object.values(dupMap).filter(arr=>arr.length>1);

  const issues = [
    {label:'Missing coordinates', count:missingCoords.length, severity:'high', items: missingCoords},
    {label:'Missing phone number', count:missingPhone.length, severity:'med', items: missingPhone},
    {label:'Missing email', count:missingEmail.length, severity:'med', items: missingEmail},
    {label:'Missing address', count:missingAddress.length, severity:'med', items: missingAddress},
    {label:'No programs flagged', count:noPrograms.length, severity:'high', items: noPrograms},
    {label:'Low-confidence coordinate (fallback)', count:lowConfCoord.length, severity:'med', items: lowConfCoord},
    {label:'Potential duplicates (same name & city)', count:duplicates.length, severity:'high', items: duplicates.flat()},
  ];

  $('#paneQualityInner').innerHTML = `
    <div class="section-title" style="margin-top:0">Data quality audit</div>
    <div class="insight-grid">
      <div class="insight"><h5>Records</h5><div class="big">${fmt(all.length)}</div><div class="sub">Total in dataset</div></div>
      <div class="insight"><h5>Issues found</h5><div class="big" style="color:var(--st-review)">${fmt(issues.reduce((s,i)=>s+i.count,0))}</div><div class="sub">${issues.filter(i=>i.count>0).length} categories</div></div>
      <div class="insight"><h5>Clean records</h5><div class="big" style="color:var(--st-active)">${fmt(all.length - missingCoords.length - missingPhone.length - noPrograms.length)}</div><div class="sub">Coords + phone + programs OK</div></div>
      <div class="insight"><h5>Duplicates</h5><div class="big" style="color:var(--st-depanel)">${fmt(duplicates.length)}</div><div class="sub">Same name & city</div></div>
    </div>

    <table class="tbl">
      <thead><tr><th>Issue</th><th class="num">Records</th><th>Severity</th></tr></thead>
      <tbody>
        ${issues.map((iss,i)=>`<tr ${iss.count?`style="cursor:pointer" data-issue="${i}"`:''}>
          <td>${escapeHTML(iss.label)}</td>
          <td class="num">${fmt(iss.count)}</td>
          <td><span class="pill pill-${iss.severity==='high'?'depanel':'review'}"><span class="dot"></span>${iss.severity==='high'?'High':'Med'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div id="qualityDrill" style="margin-top:10px"></div>
  `;
  $$('#paneQualityInner tr[data-issue]').forEach(tr=>tr.onclick=()=>{
    const iss = issues[+tr.dataset.issue];
    $('#qualityDrill').innerHTML = `
      <div class="section-title">Affected: ${escapeHTML(iss.label)} (${iss.count})</div>
      <div class="tbl-scroll">
        <table class="tbl">
          <thead><tr><th>ID</th><th>Centre</th><th>City</th></tr></thead>
          <tbody>
            ${iss.items.slice(0,200).map(c=>`<tr style="cursor:pointer" data-cid="${c.id}"><td><code style="font-size:10px">${escapeHTML(c.id)}</code></td><td>${escapeHTML(c.name)}</td><td>${escapeHTML(c.city)} · ${escapeHTML(c.sourceCountry)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${iss.items.length>200?`<div style="color:var(--muted);font-size:11px;margin-top:6px">+ ${iss.items.length-200} more — export to view all</div>`:''}
    `;
    $$('#qualityDrill tr[data-cid]').forEach(tr=>tr.onclick=()=>selectCentre(tr.dataset.cid));
  });
}

/* ----- 8. EXPORTS ----- */
function exportCSV(){
  const rows = filterCentres();
  const cols = ['id','name','category','sourceCountry','city','state','address','programs','status','m5PanelCount','totalEmpanelment','contact','email','website','lat','lng','validationStatus','validationChannel','remarks'];
  const header = cols.join(',');
  const body = rows.map(r=>cols.map(k=>{
    let v = r[k];
    if (Array.isArray(v)) v = v.join(';');
    if (v == null) v = '';
    v = String(v).replace(/"/g,'""');
    return /[,"\n]/.test(v) ? `"${v}"` : v;
  }).join(',')).join('\n');
  downloadFile('visa-medical-centres.csv', header+'\n'+body, 'text/csv;charset=utf-8');
}

function exportXLSX(){
  const rows = filterCentres();
  const data = rows.map(r=>({
    'Centre ID': r.id,
    'Name': r.name,
    'Category': r.category,
    'Source Country': r.sourceCountry,
    'City': r.city,
    'State / Region': r.state,
    'Address': r.address,
    'Status': r.status,
    'Programs': r.programs.join('; '),
    'Program Statuses': Object.entries(r.programStatuses).map(([k,v])=>`${k}: ${v}`).join('; '),
    'M5 Panel Count': r.m5PanelCount,
    'Total Empanelment': r.totalEmpanelment,
    'Phone': r.contact,
    'Email': r.email,
    'Website': r.website,
    'Latitude': r.lat,
    'Longitude': r.lng,
    'Coord. Confidence': r.coordConfidence,
    'Validation Status': r.validationStatus,
    'Validation Channel': r.validationChannel,
    'Remarks': r.remarks,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = Object.keys(data[0]||{}).map(k=>({wch:Math.min(40,Math.max(12,k.length+2))}));

  // Add Country intel sheet
  const all = state.data.centres;
  const countries = Array.from(new Set(all.map(c=>c.sourceCountry))).sort();
  const countryRows = countries.map(country=>{
    const list = all.filter(c=>c.sourceCountry===country);
    return {
      'Country': country,
      'Total Centres': list.length,
      'Cities': new Set(list.map(c=>c.city)).size,
      'Active': list.filter(c=>c.status==='Active').length,
      'New Empanelments': list.filter(c=>c.status==='New Empanelment').length,
      'De-panelled': list.filter(c=>c.status==='De-panelled').length,
      'Under Review': list.filter(c=>c.status==='Under Review').length,
    };
  });
  const ws2 = XLSX.utils.json_to_sheet(countryRows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Centres');
  XLSX.utils.book_append_sheet(wb, ws2, 'Country Intel');
  XLSX.writeFile(wb, 'visa-medical-centres-intelligence.xlsx');
}

function exportPDF(){
  window.print();
}

function downloadFile(name, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* ----- 9. WIRING & UPDATE LOOP ----- */
function syncFilterUI(){
  $$('#filterCountry input').forEach(i=>{ i.checked = state.filters.countries.has(i.dataset.country); });
  $$('#filterStatus input').forEach(i=>{ i.checked = state.filters.statuses.has(i.dataset.status); });
  $$('#filterProgram input').forEach(i=>{ i.checked = state.filters.programs.has(i.dataset.program); });
  $('#filterCity').value = state.filters.city || '';
  $('#filterCategory').value = state.filters.category || '';
  $('#search').value = state.filters.search || '';
}

function renderFilteredCentresList() {
  const f = state.filters;
  const isActive = f.countries.size > 0 || f.programs.size > 0 || f.city !== '' || f.category !== '' || f.search.trim() !== '' || f.statuses.size !== STATUSES.length;
  const container = $('#filteredCentresContainer');
  if (!container) return;
  
  if (!isActive) {
    container.style.display = 'none';
    return;
  }
  
  const centres = filterCentres();
  container.style.display = 'block';
  $('#filteredCentresCount').textContent = `(${centres.length})`;
  
  if (centres.length === 0) {
    $('#filteredCentresList').innerHTML = `<div style="padding:10px;color:var(--muted);font-size:11px;text-align:center;">No centres match these filters.</div>`;
    return;
  }
  
  $('#filteredCentresList').innerHTML = centres.map(c => {
    let progs = c.programs;
    if (f.programs.size > 0) {
      progs = c.programs.filter(p => f.programs.has(p));
    }
    const progPills = progs.map(p => {
      const s = c.programStatuses[p] || c.status;
      const sc = STATUS_CLASS[s] || 'active';
      return `<span class="pill pill-${sc}" style="font-size:9px; padding:1px 4px; margin-right:3px; border-radius:3px;"><span class="dot" style="width:4px; height:4px;"></span>${escapeHTML(p)}</span>`;
    }).join('');

    return `
    <div style="padding:8px 8px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; flex-direction:column; gap:4px;" onclick="window.__app.selectCentre('${c.id}')" onmouseover="this.style.background='var(--bg-soft)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight:600; font-size:11.5px; color:var(--text); line-height:1.2;">${escapeHTML(c.name)}</div>
      <div style="font-size:10px; color:var(--muted);">${escapeHTML(c.city)}, ${escapeHTML(c.sourceCountry)}</div>
      <div style="display:flex; flex-wrap:wrap; gap:2px; margin-top:2px;">${progPills}</div>
    </div>
  `}).join('');
}

function update(){
  renderMap();
  renderSideKpis();
  renderInsights();
  renderCountryPane();
  renderValidationPane();
  renderNewPane();
  renderDepanelPane();
  renderQualityPane();
  renderFilteredCentresList();
  // Refresh badges
  const newCount = state.data.centres.filter(c=>Object.values(c.programStatuses).some(s=>s==='New Empanelment')).length;
  const depCount = state.data.centres.filter(c=>Object.values(c.programStatuses).some(s=>s==='De-panelled')).length;
  const qualCount = state.data.centres.filter(c=>c.status==='Under Review'||!c.lat).length;
  const bChanges = $('#badgeChanges'); if (bChanges) bChanges.textContent = newCount + depCount;
  const bQual = $('#badgeQuality'); if (bQual) bQual.textContent = qualCount;
}

function bind(){
  // Search
  $('#search').addEventListener('input', debounce(e=>{
    state.filters.search = e.target.value;
    update();
  }, 200));

  // City / category
  $('#filterCity').addEventListener('change', e=>{
    state.filters.city = e.target.value;
    update();
  });

  // Reset
  $('#btnReset').onclick = ()=>{
    state.filters.search='';
    state.filters.statuses = new Set(STATUSES);
    state.filters.programs = new Set();
    state.filters.countries = new Set();
    state.filters.city = '';
    state.filters.category = '';
    syncFilterUI();
    update();
  };

  // Map layer toggle
  $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(b=>b.onclick=()=>{
    $$('.map-toolbar .tb-group[aria-label="Map layer"] .tb-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    state.mapLayer = b.dataset.layer;
    renderMap();
  });

  // Region quick-zoom
  const REGIONS = {
    global:[18,80,3],
    'south-asia':[22,80,5],
    'se-asia':[5,115,5],
    africa:[5,20,4],
  };
  $$('.map-toolbar .tb-group[aria-label="Region"] .tb-btn').forEach(b=>b.onclick=()=>{
    $$('.map-toolbar .tb-group[aria-label="Region"] .tb-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const r = REGIONS[b.dataset.region];
    if (r) map.flyTo([r[0],r[1]], r[2], {duration:0.7});
  });

  // Rail tabs
  $$('.rail-tab').forEach(t=>t.onclick=()=>setTab(t.dataset.tab));

  // Export
  $('#btnExportCsv').onclick = exportCSV;
  $('#btnExportXlsx').onclick = exportXLSX;
  $('#btnExportPdf').onclick = exportPDF;

  // Compare
  $('#btnOpenCompare').onclick = openCompareModal;
  $('#btnClearCompare').onclick = ()=>{ state.compare = []; renderCompareBar(); renderDetail(); };
  $('#btnCloseCompare').onclick = ()=>$('#cmpModal').classList.remove('active');
  $('#cmpModal').onclick = e=>{ if (e.target === e.currentTarget) $('#cmpModal').classList.remove('active'); };

  // Mobile rail toggle
  $('#btnRailToggle').onclick = ()=>$('#rail').classList.toggle('show');
  const checkResponsive = ()=>{
    $('#btnRailToggle').style.display = window.innerWidth < 821 ? 'inline-flex' : 'none';
  };
  checkResponsive();
  window.addEventListener('resize', debounce(()=>{ checkResponsive(); if (map) map.invalidateSize(); }, 200));
}

function setTab(name){
  $$('.rail-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  $$('.rail-pane').forEach(p=>p.classList.toggle('active', p.dataset.pane===name));
  // On narrow screens make sure rail is visible
  if (window.innerWidth < 821) $('#rail').classList.add('show');
}

/* ----- BOOTSTRAP ----- */
async function boot(){
  try{
    await loadData();
    initMap();
    renderTopKpis();
    renderFilters();
    update();
    bind();
    setTimeout(()=>map.invalidateSize(), 100);
  }catch(e){
    console.error(e);
    $('#loader').innerHTML = `<div style="color:var(--st-depanel);text-align:center;padding:40px">
      <h3>Could not load data</h3>
      <p style="color:var(--muted);font-size:12px">${escapeHTML(e.message||String(e))}</p>
      <p style="color:var(--muted);font-size:11px">If you are opening this file directly with file://, browsers may block fetch(). Use a local web server (e.g. <code>python -m http.server</code>) or run the single-file build.</p>
    </div>`;
    return;
  }
  $('#loader').classList.add('hide');
}

// Expose minimal API for popup buttons
window.__app = { selectCentre, toggleCompare };

document.addEventListener('DOMContentLoaded', boot);
})();
