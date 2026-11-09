/**
 * Unit tests for the DSA modules. Dependency-free: `node dsa/tests/run.js`
 * (or `npm test` from the repo root). Exits non-zero on any failure.
 */

import assert from 'node:assert/strict';
import { Graph } from '../Graph.js';
import { Queue, Stack } from '../Queue.js';
import { bfs } from '../BFS.js';
import { dfs } from '../DFS.js';
import { MinHeap } from '../MinHeap.js';
import { dijkstra } from '../Dijkstra.js';
import { DynamicRouter } from '../DynamicRouter.js';
import { MODES, edgeCost } from '../EdgeCost.js';
import { createRng } from '../Random.js';
import { SAMPLE_GRAPHS } from '../sampleGraphs.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** Small diamond: A-B-D is short but slow/congested, A-C-D is longer but fast. */
function diamond() {
  const g = new Graph('diamond');
  g.addNode('A', { x: 0, y: 0 });
  g.addNode('B', { x: 100, y: -50 });
  g.addNode('C', { x: 100, y: 50 });
  g.addNode('D', { x: 200, y: 0 });
  g.addNode('E', { x: 300, y: 0 }); // reachable only via D
  g.addNode('Z', { x: 900, y: 900 }); // isolated
  g.addRoad('A', 'B', { id: 'AB', distance: 2, baseTravelTime: 10 });
  g.addRoad('B', 'D', { id: 'BD', distance: 2, baseTravelTime: 10 });
  g.addRoad('A', 'C', { id: 'AC', distance: 3, baseTravelTime: 6 });
  g.addRoad('C', 'D', { id: 'CD', distance: 3, baseTravelTime: 6 });
  g.addRoad('D', 'E', { id: 'DE', distance: 1, baseTravelTime: 2 });
  return g;
}

/** Random connected graph for property tests. */
function randomGraph(rng, n) {
  const g = new Graph('rand');
  for (let i = 0; i < n; i++) g.addNode(`v${i}`, { x: rng() * 1000, y: rng() * 1000 });
  for (let i = 1; i < n; i++) {
    g.addRoad(`v${i}`, `v${Math.floor(rng() * i)}`, {
      distance: 1 + Math.floor(rng() * 20),
      baseTravelTime: 1 + Math.floor(rng() * 20),
      trafficLevel: 1 + rng() * 2,
    });
  }
  const extra = n * 2;
  for (let k = 0; k < extra; k++) {
    const a = Math.floor(rng() * n);
    const b = Math.floor(rng() * n);
    if (a === b) continue;
    g.addRoad(`v${a}`, `v${b}`, {
      distance: 1 + Math.floor(rng() * 20),
      baseTravelTime: 1 + Math.floor(rng() * 20),
      trafficLevel: 1 + rng() * 2,
      isBlocked: rng() < 0.1,
      bidirectional: rng() < 0.7,
    });
  }
  return g;
}

/** Reference oracle: Bellman-Ford (independent of the heap/Dijkstra code). */
function bellmanFord(g, source, mode) {
  const dist = new Map(g.nodeIds().map((id) => [id, Infinity]));
  dist.set(source, 0);
  for (let i = 0; i < g.nodeCount; i++) {
    let changed = false;
    for (const id of g.nodeIds()) {
      for (const e of g.getNeighbors(id)) {
        const w = edgeCost(e, mode);
        if (dist.get(id) + w < dist.get(e.destination)) {
          dist.set(e.destination, dist.get(id) + w);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return dist;
}

console.log('Graph');
test('adjacency list stores both directions of a road', () => {
  const g = diamond();
  assert.equal(g.nodeCount, 6);
  assert.equal(g.edgeCount, 10);
  assert.equal(g.getNeighbors('A').length, 2);
  assert.ok(g.findEdge('B', 'A'));
});
test('one-way roads create a single directed edge', () => {
  const g = new Graph();
  g.addNode('a');
  g.addNode('b');
  g.addRoad('a', 'b', { bidirectional: false });
  assert.equal(g.getNeighbors('a').length, 1);
  assert.equal(g.getNeighbors('b').length, 0);
});
test('updateRoad keeps both directed edges in sync and clamps traffic', () => {
  const g = diamond();
  g.updateRoad('AB', { trafficLevel: 99, isBlocked: true });
  assert.equal(g.findEdge('A', 'B').trafficLevel, 3);
  assert.equal(g.findEdge('B', 'A').trafficLevel, 3);
  assert.equal(g.findEdge('B', 'A').isBlocked, true);
});
test('removeNode removes incident roads; JSON round-trips', () => {
  const g = diamond();
  g.removeNode('D');
  assert.equal(g.getRoad('BD'), undefined);
  assert.equal(g.getNeighbors('B').length, 1);
  const copy = Graph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.deepEqual(copy.toJSON(), g.toJSON());
});
test('invalid input is rejected', () => {
  const g = diamond();
  assert.throws(() => g.addNode('A'));
  assert.throws(() => g.addRoad('A', 'nope'));
  assert.throws(() => g.addRoad('A', 'A'));
  assert.throws(() => g.addRoad('A', 'E', { distance: -1 }));
});

console.log('Edge cost');
test('cost formulas per mode and blocked = Infinity', () => {
  const e = { distance: 4, baseTravelTime: 10, trafficLevel: 2, isBlocked: false };
  assert.equal(edgeCost(e, MODES.DISTANCE), 4);
  assert.equal(edgeCost(e, MODES.TIME), 20);
  assert.equal(edgeCost(e, MODES.AVOID_TRAFFIC), 16);
  assert.equal(edgeCost({ ...e, isBlocked: true }, MODES.DISTANCE), Infinity);
});

console.log('Queue / Stack');
test('queue is FIFO, stack is LIFO', () => {
  const q = new Queue();
  const s = new Stack();
  for (const x of [1, 2, 3]) {
    q.enqueue(x);
    s.push(x);
  }
  assert.deepEqual([q.dequeue(), q.dequeue(), q.dequeue(), q.dequeue()], [1, 2, 3, undefined]);
  assert.deepEqual([s.pop(), s.pop(), s.pop(), s.pop()], [3, 2, 1, undefined]);
  assert.ok(q.isEmpty() && s.isEmpty());
});

console.log('BFS');
test('finds the fewest-hops route', () => {
  const g = diamond();
  const r = bfs(g, 'A', 'E');
  assert.equal(r.found, true);
  assert.equal(r.hops, 3);
  assert.equal(r.path[0], 'A');
  assert.equal(r.path.at(-1), 'E');
});
test('BFS level order on a chain', () => {
  const g = new Graph();
  ['a', 'b', 'c', 'd'].forEach((id) => g.addNode(id));
  g.addRoad('a', 'b');
  g.addRoad('b', 'c');
  g.addRoad('c', 'd');
  assert.deepEqual(bfs(g, 'a').visitedOrder, ['a', 'b', 'c', 'd']);
});
test('unreachable target and blocked roads', () => {
  const g = diamond();
  assert.equal(bfs(g, 'A', 'Z').found, false);
  g.updateRoad('DE', { isBlocked: true });
  assert.equal(bfs(g, 'A', 'E').found, false);
});
test('source == target gives a zero-length path', () => {
  const r = bfs(diamond(), 'A', 'A');
  assert.deepEqual(r.path, ['A']);
  assert.equal(r.hops, 0);
});

console.log('DFS');
test('visits every reachable node exactly once, in preorder', () => {
  const g = diamond();
  const r = dfs(g, 'A');
  assert.equal(new Set(r.visitedOrder).size, r.visitedOrder.length);
  assert.deepEqual([...r.visitedOrder].sort(), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(r.visitedOrder.slice(0, 3), ['A', 'B', 'D']); // dives before backtracking
});
test('returns a valid (not necessarily optimal) route', () => {
  const g = diamond();
  const r = dfs(g, 'A', 'E');
  assert.equal(r.found, true);
  for (let i = 0; i + 1 < r.path.length; i++) assert.ok(g.findEdge(r.path[i], r.path[i + 1]));
  assert.equal(dfs(g, 'A', 'Z').found, false);
});

console.log('MinHeap');
test('extractMin returns sorted order for random input', () => {
  const rng = createRng(42);
  const h = new MinHeap();
  const values = [];
  for (let i = 0; i < 500; i++) {
    const p = Math.floor(rng() * 1000);
    values.push(p);
    h.insert(`k${i}`, p);
  }
  assert.ok(h.isValid());
  const out = [];
  while (!h.isEmpty()) out.push(h.extractMin().priority);
  assert.deepEqual(out, values.sort((a, b) => a - b));
  assert.equal(h.extractMin(), undefined);
});
test('decreaseKey reorders and rejects non-decreases', () => {
  const h = new MinHeap();
  h.insert('a', 10);
  h.insert('b', 20);
  h.insert('c', 30);
  assert.equal(h.decreaseKey('c', 5), true);
  assert.equal(h.decreaseKey('b', 25), false);
  assert.equal(h.decreaseKey('zzz', 1), false);
  assert.ok(h.isValid());
  assert.equal(h.extractMin().value, 'c');
  assert.equal(h.extractMin().value, 'a');
});
test('duplicate insert throws', () => {
  const h = new MinHeap();
  h.insert('a', 1);
  assert.throws(() => h.insert('a', 2));
});

console.log('Dijkstra');
test('shortest distance vs fastest time pick different routes', () => {
  const g = diamond();
  const byDist = dijkstra(g, 'A', 'D', { mode: MODES.DISTANCE });
  const byTime = dijkstra(g, 'A', 'D', { mode: MODES.TIME });
  assert.deepEqual(byDist.path, ['A', 'B', 'D']);
  assert.equal(byDist.totalDistance, 4);
  assert.deepEqual(byTime.path, ['A', 'C', 'D']);
  assert.equal(byTime.totalTime, 12);
});
test('traffic changes the fastest route', () => {
  const g = diamond();
  g.updateRoad('AC', { trafficLevel: 3 }); // A-C now 18 min -> A-B-D (20) vs A-C-D (24)
  assert.deepEqual(dijkstra(g, 'A', 'D', { mode: MODES.TIME }).path, ['A', 'B', 'D']);
});
test('blocked roads are never used; fully blocked target is unreachable', () => {
  const g = diamond();
  g.updateRoad('AB', { isBlocked: true });
  assert.deepEqual(dijkstra(g, 'A', 'D', { mode: MODES.DISTANCE }).path, ['A', 'C', 'D']);
  g.updateRoad('AC', { isBlocked: true });
  const r = dijkstra(g, 'A', 'D');
  assert.equal(r.found, false);
  assert.equal(r.totalDistance, null);
});
test('matches Bellman-Ford on 60 random graphs in all modes', () => {
  const rng = createRng(2024);
  for (let t = 0; t < 60; t++) {
    const g = randomGraph(rng, 8 + Math.floor(rng() * 25));
    for (const mode of Object.values(MODES)) {
      const res = dijkstra(g, 'v0', null, { mode, record: false });
      const ref = bellmanFord(g, 'v0', mode);
      for (const id of g.nodeIds()) {
        const got = res.distances.has(id) ? res.distances.get(id) : Infinity;
        assert.ok(Math.abs(got - ref.get(id)) < 1e-9, `graph ${t} mode ${mode} node ${id}: ${got} vs ${ref.get(id)}`);
      }
    }
  }
});
test('Dijkstra cost never exceeds BFS or DFS route cost', () => {
  const rng = createRng(99);
  for (let t = 0; t < 30; t++) {
    const g = randomGraph(rng, 20);
    const target = `v${1 + Math.floor(rng() * 19)}`;
    const d = dijkstra(g, 'v0', target, { mode: MODES.TIME });
    for (const other of [bfs(g, 'v0', target, { mode: MODES.TIME }), dfs(g, 'v0', target, { mode: MODES.TIME })]) {
      assert.equal(other.found, d.found);
      if (d.found) assert.ok(d.totalCost <= other.totalCost + 1e-9);
    }
  }
});
test('stats are populated', () => {
  const r = dijkstra(diamond(), 'A', 'E');
  assert.ok(r.nodesExplored > 0 && r.edgesChecked > 0 && r.executionTimeMs >= 0);
  assert.ok(r.trace.some((e) => e.type === 'visit'));
});

console.log('DynamicRouter');
test('blocking a road on the active route triggers a reroute', () => {
  const g = diamond();
  const router = new DynamicRouter(g);
  router.setRoute('A', 'E', MODES.TIME);
  assert.deepEqual(router.active.result.path, ['A', 'C', 'D', 'E']);
  const report = router.blockRoad('CD');
  assert.equal(report.routeAffected, true);
  assert.equal(report.routeChanged, true);
  assert.deepEqual(report.current.path, ['A', 'B', 'D', 'E']);
  assert.ok(report.costDelta > 0);
});
test('unrelated change does not alter the route; breaking and restoring work', () => {
  const g = diamond();
  const router = new DynamicRouter(g);
  router.setRoute('A', 'E', MODES.TIME);
  const calm = router.setTraffic('AB', 1.5);
  assert.equal(calm.routeAffected, false);
  assert.equal(calm.routeChanged, false);
  const broken = router.blockRoad('DE');
  assert.equal(broken.routeBroken, true);
  const restored = router.unblockRoad('DE');
  assert.equal(restored.routeRestored, true);
});
test('subscribers are notified and traffic simulation is reproducible', () => {
  const run = () => {
    const g = SAMPLE_GRAPHS.cityGrid.build();
    const router = new DynamicRouter(g);
    router.setRoute('A1', 'E6', MODES.TIME);
    let notified = 0;
    router.subscribe(() => notified++);
    const rng = createRng(5);
    for (let i = 0; i < 10; i++) router.simulateTick(rng);
    assert.ok(notified > 0);
    return JSON.stringify(g.toJSON().roads.map((r) => [r.trafficLevel, r.isBlocked]));
  };
  assert.equal(run(), run());
});

console.log('Sample graphs');
test('every sample is connected and routable under every algorithm', () => {
  for (const s of Object.values(SAMPLE_GRAPHS)) {
    const g = s.build();
    const reach = bfs(g, s.defaultSource);
    assert.equal(reach.visitedOrder.length, g.nodeCount, `${s.name} not connected`);
    for (const fn of [bfs, dfs, dijkstra]) assert.ok(fn(g, s.defaultSource, s.defaultTarget).found);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
