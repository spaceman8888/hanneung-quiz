// Builds map.json (land path for the 지도 cards) from Natural Earth land polygons (public domain).
// usage: node tools/build-map.mjs <ne_10m_land.geojson>
import { readFileSync, writeFileSync } from 'node:fs';
import { project, MAP, MAP_VIEW } from '../logic.js';

const geo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rings = geo.features.flatMap(f => f.geometry.type === 'Polygon' ? f.geometry.coordinates
  : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []);
let d = '';
for (const ring of rings) {
  if (!ring.some(([lon, lat]) => lon > MAP.lon0 - 1 && lon < MAP.lon1 + 1 && lat > MAP.lat0 - 1 && lat < MAP.lat1 + 1)) continue;
  const pts = [];
  for (const [lon, lat] of ring) {   // clamping to a margin outside the view keeps the fill right for land crossing the edge
    const p = project(clamp(lat, MAP.lat0 - 1, MAP.lat1 + 1), clamp(lon, MAP.lon0 - 1, MAP.lon1 + 1)).map(Math.round);   // 1 unit ≈ 1 km
    const q = pts.at(-1);
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 2) pts.push(p);
  }
  const span = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
  if (pts.length >= 3 && span >= 4) d += 'M' + pts.map(p => p.join(' ')).join('L') + 'Z';   // drop specks; 울릉도 stays
}
writeFileSync('map.json', JSON.stringify({ view: MAP_VIEW, d }) + '\n');
console.log(`map.json: ${d.length} chars`);
