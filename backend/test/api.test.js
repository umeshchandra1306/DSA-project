/** API smoke tests against the in-memory store: `npm test` in backend/. */
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { MemoryStore } from '../db/store.js';

const server = createApp(new MemoryStore()).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

try {
  await test('health + sample listing', async () => {
    assert.equal((await call('GET', '/health')).body.ok, true);
    const list = (await call('GET', '/graphs/samples')).body;
    assert.deepEqual(list.map((s) => s.key).sort(), ['cityGrid', 'highwayHub', 'suburban']);
    const g = (await call('GET', '/graphs/samples/cityGrid')).body;
    assert.equal(g.nodes.length, 30);
    assert.equal((await call('GET', '/graphs/samples/nope')).status, 404);
  });

  let savedId;
  await test('save, list, load, patch, delete a custom network', async () => {
    const payload = {
      name: 'Mini',
      nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }, { id: 'b', label: 'B', x: 100, y: 0 }, { id: 'c', label: 'C', x: 200, y: 0 }],
      roads: [{ id: 'r1', source: 'a', destination: 'b' }, { id: 'r2', source: 'b', destination: 'c' }],
    };
    const created = await call('POST', '/graphs', payload);
    assert.equal(created.status, 201);
    savedId = created.body.id;
    assert.equal((await call('GET', '/graphs')).body.length, 1);
    assert.equal((await call('GET', `/graphs/${savedId}`)).body.roads.length, 2);
    assert.equal((await call('PATCH', `/graphs/${savedId}/roads/r1`, { trafficLevel: 2.5 })).body.trafficLevel, 2.5);
    assert.equal((await call('PATCH', `/graphs/${savedId}/roads/r1`, { trafficLevel: 9 })).status, 400);
    assert.equal((await call('POST', '/graphs', { name: 'bad', nodes: [], roads: [] })).status, 400);
    assert.equal((await call('POST', '/graphs', { ...payload, roads: [{ source: 'a', destination: 'zzz' }] })).status, 400);
  });

  await test('route computation compares algorithms and persists runs', async () => {
    const res = await call('POST', '/route', { sampleKey: 'cityGrid', source: 'A1', target: 'E6', mode: 'time', persist: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r) => r.algorithm), ['BFS', 'DFS', 'Dijkstra']);
    const d = res.body.results.find((r) => r.algorithm === 'Dijkstra');
    for (const r of res.body.results) assert.ok(d.totalCost <= r.totalCost + 1e-9);
    const runs = (await call('GET', '/runs?sampleKey=cityGrid')).body;
    assert.equal(runs.length, 3);
    assert.equal((await call('POST', '/route', { sampleKey: 'cityGrid', source: 'A1', target: 'nope' })).status, 400);
    assert.equal((await call('POST', '/route', { source: 'A1', target: 'E6' })).status, 400);
    assert.equal((await call('POST', '/route', { graphId: savedId, source: 'a', target: 'c', algorithms: ['A*'] })).status, 400);
  });

  await test('events and saved routes', async () => {
    const ev = await call('POST', '/events', { sampleKey: 'cityGrid', roadId: 'r3', eventType: 'block', routeChanged: true });
    assert.equal(ev.status, 201);
    assert.equal((await call('GET', '/events?sampleKey=cityGrid')).body.length, 1);
    assert.equal((await call('POST', '/events', { roadId: 'r3', eventType: 'explode' })).status, 400);
    const route = await call('POST', '/routes', { sampleKey: 'cityGrid', name: 'Commute', source: 'A1', target: 'E6', mode: 'time' });
    assert.equal(route.status, 201);
    assert.equal((await call('GET', '/routes?sampleKey=cityGrid')).body.length, 1);
    assert.equal((await call('DELETE', `/routes/${route.body.id}`)).status, 204);
    assert.equal((await call('DELETE', '/routes/999')).status, 404);
    assert.equal((await call('DELETE', `/graphs/${savedId}`)).status, 204);
  });

  console.log(`\n${passed} backend tests passed`);
} finally {
  server.close();
}
