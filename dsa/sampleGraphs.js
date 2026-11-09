/**
 * sampleGraphs.js — built-in road networks (deterministic, no database needed).
 *
 *   cityGrid   "City Center Grid"          6x5 street grid + fast avenue + diagonals
 *   highwayHub "Highway Hub"               8 districts, ring roads, fast highways via a hub
 *   suburban   "Complex Suburban Network"  28 scattered nodes, k-nearest local roads
 *
 * World space is 1000 x 640 for every sample. Distances are in km
 * (100 px = 1 km); travel time is in minutes at the road's speed.
 */

import { Graph } from './Graph.js';
import { createRng } from './Random.js';

export const WORLD = { width: 1000, height: 640 };

function addRoadAtSpeed(g, a, b, speedKmh, extra = {}) {
  const na = g.getNode(a);
  const nb = g.getNode(b);
  const distance = extra.distance ?? +(Math.hypot(na.x - nb.x, na.y - nb.y) / 100).toFixed(3);
  const baseTravelTime = +((distance / speedKmh) * 60).toFixed(3);
  return g.addRoad(a, b, { distance, baseTravelTime, ...extra });
}

export function buildCityGrid() {
  const g = new Graph('City Center Grid');
  const rows = 5;
  const cols = 6;
  const id = (r, c) => `${String.fromCharCode(65 + r)}${c + 1}`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.addNode(id(r, c), { label: id(r, c), x: 120 + c * 152, y: 90 + r * 115 });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Row 2 is a fast arterial avenue (60 km/h); everything else is 30 km/h.
      if (c + 1 < cols) addRoadAtSpeed(g, id(r, c), id(r, c + 1), r === 2 ? 60 : 30);
      if (r + 1 < rows) addRoadAtSpeed(g, id(r, c), id(r + 1, c), c === 3 ? 55 : 30);
    }
  }
  // Two diagonal expressways: longer than a street hop but much faster.
  addRoadAtSpeed(g, id(0, 0), id(2, 2), 80);
  addRoadAtSpeed(g, id(2, 3), id(4, 5), 80);
  return g;
}

export function buildHighwayHub() {
  const g = new Graph('Highway Hub');
  g.addNode('HUB', { label: 'Hub', x: 500, y: 320 });
  const districts = ['North', 'NE', 'East', 'SE', 'South', 'SW', 'West', 'NW'];
  const R = [250, 330];
  districts.forEach((name, i) => {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    g.addNode(name, {
      label: name,
      x: Math.round(500 + Math.cos(angle) * 400 * (i % 2 === 0 ? 1 : 1.05)),
      y: Math.round(320 + Math.sin(angle) * (R[i % 2] - 30)),
    });
  });
  // Slow local ring roads between neighbouring districts.
  districts.forEach((name, i) => addRoadAtSpeed(g, name, districts[(i + 1) % 8], 35));
  // Fast highways from every district into the hub.
  districts.forEach((name) => addRoadAtSpeed(g, name, 'HUB', 100));
  // Two long bypass cross-roads.
  addRoadAtSpeed(g, 'North', 'South', 70, { distance: 6.4 });
  addRoadAtSpeed(g, 'West', 'East', 70, { distance: 8.2 });
  // Congested hub: highways into it start busy so "fastest" differs from "shortest".
  g.updateRoad(g.findEdge('East', 'HUB').roadId, { trafficLevel: 2.2 });
  g.updateRoad(g.findEdge('South', 'HUB').roadId, { trafficLevel: 1.6 });
  return g;
}

export function buildSuburban(seed = 7) {
  const g = new Graph('Complex Suburban Network');
  const rng = createRng(seed);
  const n = 28;
  const pts = [];
  // Rejection-sample points with a minimum spacing so the layout stays readable.
  while (pts.length < n) {
    const p = { x: 70 + rng() * 860, y: 60 + rng() * 520 };
    if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 95)) pts.push(p);
  }
  pts.forEach((p, i) => {
    const label = `S${String(i + 1).padStart(2, '0')}`;
    g.addNode(label, { label, x: Math.round(p.x), y: Math.round(p.y) });
  });
  const ids = g.nodeIds();
  const dist = (i, j) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
  const linked = new Set();
  const link = (i, j) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (i === j || linked.has(key)) return;
    linked.add(key);
    const d = dist(i, j);
    const speed = d > 220 ? 70 : d > 150 ? 50 : 30; // longer roads are faster collectors
    const jitter = 1 + rng() * 0.25; // winding roads are longer than the straight line
    addRoadAtSpeed(g, ids[i], ids[j], speed, { distance: +((d / 100) * jitter).toFixed(3) });
  };
  // Connectivity: each node joins the nearest node created before it.
  for (let i = 1; i < n; i++) {
    let best = 0;
    for (let j = 1; j < i; j++) if (dist(i, j) < dist(i, best)) best = j;
    link(i, best);
  }
  // Extra local roads: each node connects to its 2 nearest neighbours.
  for (let i = 0; i < n; i++) {
    const order = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => dist(i, a) - dist(i, b));
    link(i, order[0]);
    link(i, order[1]);
  }
  // A couple of busy collector roads.
  const roads = [...g.roads.values()];
  for (let k = 0; k < 4; k++) g.updateRoad(roads[Math.floor(rng() * roads.length)].id, { trafficLevel: 1.5 + rng() });
  return g;
}

export const SAMPLE_GRAPHS = {
  cityGrid: {
    key: 'cityGrid',
    name: 'City Center Grid',
    description: '6x5 street grid with a fast arterial avenue and two diagonal expressways.',
    build: buildCityGrid,
    defaultSource: 'A1',
    defaultTarget: 'E6',
  },
  highwayHub: {
    key: 'highwayHub',
    name: 'Highway Hub',
    description: 'Eight districts joined by slow ring roads and fast (but congested) highways through a central hub.',
    build: buildHighwayHub,
    defaultSource: 'North',
    defaultTarget: 'South',
  },
  suburban: {
    key: 'suburban',
    name: 'Complex Suburban Network',
    description: '28 scattered neighbourhoods linked by winding local roads and a few busy collectors.',
    build: () => buildSuburban(),
    defaultSource: 'S01',
    defaultTarget: 'S28',
  },
};

export function listSampleGraphs() {
  return Object.values(SAMPLE_GRAPHS).map(({ key, name, description, defaultSource, defaultTarget }) => ({
    key,
    name,
    description,
    defaultSource,
    defaultTarget,
  }));
}

export function buildSampleGraph(key) {
  const entry = SAMPLE_GRAPHS[key];
  return entry ? entry.build() : null;
}
