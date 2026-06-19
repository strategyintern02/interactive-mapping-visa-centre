const fs = require('fs');

// WAFID city-wise demand data — partial dataset, only cities WAFID publishes.
// Lat/lng pre-geocoded so no runtime geocoding is required.
const wafidDemand = {
  publishedAt: '2026-06-19',
  note: 'Partial dataset — only cities WAFID publishes. Missing cities are not visible here, not implied to be low demand.',
  cities: [
    // ── India ──
    { country: 'India', city: 'Coimbatore',    demand: 'high', lat: 11.0168, lng: 76.9558 },
    { country: 'India', city: 'Demow',         demand: 'high', lat: 27.0833, lng: 94.9333 },
    { country: 'India', city: 'Indore',        demand: 'high', lat: 22.7196, lng: 75.8577 },
    { country: 'India', city: 'Kadapa',        demand: 'high', lat: 14.4673, lng: 78.8242 },
    { country: 'India', city: 'Madurai',       demand: 'high', lat:  9.9252, lng: 78.1198 },
    { country: 'India', city: 'Malappuram',    demand: 'high', lat: 11.0509, lng: 76.0711 },
    { country: 'India', city: 'Silchar',       demand: 'high', lat: 24.8333, lng: 92.7789 },
    { country: 'India', city: 'Srinagar',      demand: 'high', lat: 34.0837, lng: 74.7973 },
    { country: 'India', city: 'Vijayawada',    demand: 'high', lat: 16.5062, lng: 80.6480 },
    { country: 'India', city: 'Visakhapatnam', demand: 'high', lat: 17.6868, lng: 83.2185 },

    // ── Nepal ──
    { country: 'Nepal', city: 'Kathmandu',     demand: 'low',  lat: 27.7172, lng: 85.3240 },
    { country: 'Nepal', city: 'Tripureshwor',  demand: 'high', lat: 27.6973, lng: 85.3122 },

    // ── Sri Lanka ──
    { country: 'Sri Lanka', city: 'Ampara',        demand: 'high',     lat: 7.2987, lng: 81.6747 },
    { country: 'Sri Lanka', city: 'Anuradhapura',  demand: 'low',      lat: 8.3114, lng: 80.4037 },
    { country: 'Sri Lanka', city: 'Batticaloa',    demand: 'high',     lat: 7.7170, lng: 81.7000 },
    { country: 'Sri Lanka', city: 'Colombo',       demand: 'low',      lat: 6.9271, lng: 79.8612 },
    { country: 'Sri Lanka', city: 'Kandy',         demand: 'moderate', lat: 7.2906, lng: 80.6337 },
    { country: 'Sri Lanka', city: 'Kurunegala',    demand: 'low',      lat: 7.4863, lng: 80.3650 },

    // ── Philippines ──
    { country: 'Philippines', city: 'Bacolod',     demand: 'low',  lat: 10.6713, lng: 122.9511 },
    { country: 'Philippines', city: 'Cebu',        demand: 'low',  lat: 10.3157, lng: 123.8854 },
    { country: 'Philippines', city: 'Davao',       demand: 'low',  lat:  7.0731, lng: 125.6128 },
    { country: 'Philippines', city: 'Iloilo',      demand: 'high', lat: 10.7202, lng: 122.5621 },
    { country: 'Philippines', city: 'Makati',      demand: 'high', lat: 14.5547, lng: 121.0244 },
    { country: 'Philippines', city: 'Mandaluyong', demand: 'low',  lat: 14.5832, lng: 121.0409 },
    { country: 'Philippines', city: 'Mandaue',     demand: 'low',  lat: 10.3236, lng: 123.9223 },
    { country: 'Philippines', city: 'Manila',      demand: 'low',  lat: 14.5995, lng: 120.9842 },
    { country: 'Philippines', city: 'Mindanao',    demand: 'high', lat:  7.5000, lng: 125.0000 },
    { country: 'Philippines', city: 'Quezon',      demand: 'high', lat: 14.6760, lng: 121.0437 },
    { country: 'Philippines', city: 'Zamboanga',   demand: 'high', lat:  6.9214, lng: 122.0790 },

    // ── South Africa ──
    { country: 'South Africa', city: 'Johannesburg', demand: 'low', lat: -26.2041, lng: 28.0473 },
    { country: 'South Africa', city: 'Pretoria',     demand: 'low', lat: -25.7479, lng: 28.2293 },
  ],
};

function apply(path) {
  const d = JSON.parse(fs.readFileSync(path, 'utf8'));
  d.wafidDemand = wafidDemand;
  fs.writeFileSync(path, JSON.stringify(d, null, 2));
  console.log(`${path}: wafidDemand block added (${wafidDemand.cities.length} cities)`);
}

apply('./data.json');
apply('./data-snapshot.json');
