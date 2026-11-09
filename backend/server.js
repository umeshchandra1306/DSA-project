/**
 * server.js — MODULE 3 (Nagulapati Sai Ashwin): Express REST API.
 *
 * Endpoints (all JSON, prefix /api):
 *   GET    /health
 *   GET    /graphs/samples                  list built-in networks
 *   GET    /graphs/samples/:key             one built-in network (graph JSON)
 *   GET    /graphs                          list saved networks
 *   POST   /graphs                          save a custom network  {name, description?, nodes, roads}
 *   GET    /graphs/:id                      load a saved network
 *   DELETE /graphs/:id
 *   PATCH  /graphs/:id/roads/:roadId        persist traffic/blockage {trafficLevel?, isBlocked?}
 *   POST   /route                           run algorithms server-side and (optionally) store stats
 *   GET    /runs?graphId=|sampleKey=        past simulation runs
 *   POST   /runs                            store a run computed in the browser
 *   GET    /events?graphId=|sampleKey=      traffic-event history
 *   POST   /events                          record a traffic event
 *   GET    /routes?graphId=|sampleKey=      saved routes
 *   POST   /routes   DELETE /routes/:id
 *
 * All routing maths lives in ../dsa (hand-written); this file only wires it up.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { Graph } from '../dsa/Graph.js';
import { bfs } from '../dsa/BFS.js';
import { dfs } from '../dsa/DFS.js';
import { dijkstra } from '../dsa/Dijkstra.js';
import { MODES } from '../dsa/EdgeCost.js';
import { summarize } from '../dsa/Path.js';
import { SAMPLE_GRAPHS, listSampleGraphs, buildSampleGraph } from '../dsa/sampleGraphs.js';
import { createStore, normalizeGraphPayload } from './db/store.js';

const ALGORITHMS = { BFS: bfs, DFS: dfs, Dijkstra: dijkstra };
const VALID_MODES = new Set(Object.values(MODES));
const EVENT_TYPES = new Set(['block', 'unblock', 'traffic']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function intParam(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
}

function scopeFrom(source) {
  const graphId = source.graphId != null && source.graphId !== '' ? intParam(source.graphId, 'graphId') : undefined;
  const sampleKey = source.sampleKey ? String(source.sampleKey) : undefined;
  return { graphId, sampleKey };
}

export function createApp(store) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ ok: true, store: store.kind }));

  // ------------------------------------------------------------- networks
  api.get('/graphs/samples', (req, res) => res.json(listSampleGraphs()));

  api.get('/graphs/samples/:key', (req, res) => {
    const graph = buildSampleGraph(req.params.key);
    if (!graph) throw new HttpError(404, `No sample network "${req.params.key}"`);
    const { defaultSource, defaultTarget, description, key } = SAMPLE_GRAPHS[req.params.key];
    res.json({ ...graph.toJSON(), sampleKey: key, description, defaultSource, defaultTarget });
  });

  api.get('/graphs', wrap(async (req, res) => res.json(await store.listGraphs())));

  api.post('/graphs', wrap(async (req, res) => {
    let normalized;
    try {
      normalized = normalizeGraphPayload(req.body);
    } catch (err) {
      throw new HttpError(400, `Invalid network: ${err.message}`);
    }
    const name = String(req.body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'A network needs a name');
    normalized.name = name.slice(0, 120);
    const id = await store.saveGraph(normalized, String(req.body.description ?? '').slice(0, 1000));
    res.status(201).json({ id, ...normalized });
  }));

  api.get('/graphs/:id', wrap(async (req, res) => {
    const graph = await store.getGraph(intParam(req.params.id, 'id'));
    if (!graph) throw new HttpError(404, 'Network not found');
    res.json(graph);
  }));

  api.delete('/graphs/:id', wrap(async (req, res) => {
    const ok = await store.deleteGraph(intParam(req.params.id, 'id'));
    if (!ok) throw new HttpError(404, 'Network not found');
    res.status(204).end();
  }));

  api.patch('/graphs/:id/roads/:roadId', wrap(async (req, res) => {
    const { trafficLevel, isBlocked } = req.body ?? {};
    if (trafficLevel !== undefined && !(Number(trafficLevel) >= 1 && Number(trafficLevel) <= 3)) {
      throw new HttpError(400, 'trafficLevel must be between 1.0 and 3.0');
    }
    if (isBlocked !== undefined && typeof isBlocked !== 'boolean') throw new HttpError(400, 'isBlocked must be a boolean');
    const updated = await store.updateRoad(intParam(req.params.id, 'id'), req.params.roadId, {
      trafficLevel: trafficLevel === undefined ? undefined : Number(trafficLevel),
      isBlocked,
    });
    if (!updated) throw new HttpError(404, 'Road not found');
    res.json(updated);
  }));

  // --------------------------------------------------------------- routing
  api.post('/route', wrap(async (req, res) => {
    const { source, target, mode = MODES.TIME, algorithms = Object.keys(ALGORITHMS), persist = false, includeTrace = false } =
      req.body ?? {};
    if (!VALID_MODES.has(mode)) throw new HttpError(400, `mode must be one of ${[...VALID_MODES].join(', ')}`);
    if (!Array.isArray(algorithms) || algorithms.length === 0 || algorithms.some((a) => !ALGORITHMS[a])) {
      throw new HttpError(400, `algorithms must be a non-empty subset of ${Object.keys(ALGORITHMS).join(', ')}`);
    }

    // Resolve the network: inline JSON > saved id > sample key.
    let graph;
    const { graphId, sampleKey } = scopeFrom(req.body ?? {});
    try {
      if (req.body.graph) graph = Graph.fromJSON(req.body.graph);
      else if (graphId) {
        const saved = await store.getGraph(graphId);
        if (!saved) throw new HttpError(404, 'Network not found');
        graph = Graph.fromJSON(saved);
      } else if (sampleKey) {
        graph = buildSampleGraph(sampleKey);
        if (!graph) throw new HttpError(404, `No sample network "${sampleKey}"`);
      } else {
        throw new HttpError(400, 'Provide one of: graph, graphId, sampleKey');
      }
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError(400, `Invalid network: ${err.message}`);
    }
    if (!graph.hasNode(source) || !graph.hasNode(target)) throw new HttpError(400, 'source and target must be nodes of the network');

    const results = [];
    for (const name of algorithms) {
      const result = ALGORITHMS[name](graph, source, target, { mode, record: Boolean(includeTrace) });
      const summary = summarize(result);
      if (includeTrace) summary.trace = result.trace;
      if (persist) {
        summary.runId = (await store.addRun({ ...summary, graphId, sampleKey })).id;
      }
      results.push(summary);
    }
    res.json({ source, target, mode, results });
  }));

  api.get('/runs', wrap(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json(await store.listRuns({ ...scopeFrom(req.query), limit }));
  }));

  api.post('/runs', wrap(async (req, res) => {
    const r = req.body ?? {};
    if (!ALGORITHMS[r.algorithm]) throw new HttpError(400, 'Unknown algorithm');
    if (!VALID_MODES.has(r.mode)) throw new HttpError(400, 'Unknown mode');
    if (!r.source || !r.target) throw new HttpError(400, 'source and target are required');
    const nums = ['nodesExplored', 'edgesChecked', 'executionTimeMs'];
    if (nums.some((k) => !Number.isFinite(Number(r[k])))) throw new HttpError(400, `${nums.join(', ')} must be numbers`);
    const { graphId, sampleKey } = scopeFrom(r);
    const row = await store.addRun({
      graphId, sampleKey, algorithm: r.algorithm, mode: r.mode, source: String(r.source), target: String(r.target),
      found: Boolean(r.found), path: Array.isArray(r.path) ? r.path.map(String) : [],
      totalDistance: r.totalDistance ?? null, totalTime: r.totalTime ?? null, totalCost: r.totalCost ?? null,
      nodesExplored: Math.trunc(r.nodesExplored), edgesChecked: Math.trunc(r.edgesChecked), executionTimeMs: Number(r.executionTimeMs),
    });
    res.status(201).json(row);
  }));

  // ------------------------------------------------------ traffic history
  api.get('/events', wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json(await store.listEvents({ ...scopeFrom(req.query), limit }));
  }));

  api.post('/events', wrap(async (req, res) => {
    const e = req.body ?? {};
    if (!EVENT_TYPES.has(e.eventType)) throw new HttpError(400, 'eventType must be block, unblock or traffic');
    if (!e.roadId) throw new HttpError(400, 'roadId is required');
    const { graphId, sampleKey } = scopeFrom(e);
    res.status(201).json(await store.addEvent({
      graphId, sampleKey, roadId: String(e.roadId), eventType: e.eventType,
      oldTraffic: e.oldTraffic, newTraffic: e.newTraffic, routeChanged: e.routeChanged,
    }));
  }));

  // ---------------------------------------------------------- saved routes
  api.get('/routes', wrap(async (req, res) => res.json(await store.listRoutes(scopeFrom(req.query)))));

  api.post('/routes', wrap(async (req, res) => {
    const r = req.body ?? {};
    if (!r.name || !r.source || !r.target) throw new HttpError(400, 'name, source and target are required');
    if (!VALID_MODES.has(r.mode)) throw new HttpError(400, 'Unknown mode');
    const { graphId, sampleKey } = scopeFrom(r);
    res.status(201).json(await store.addRoute({
      graphId, sampleKey, name: String(r.name).slice(0, 120), source: String(r.source), target: String(r.target), mode: r.mode,
    }));
  }));

  api.delete('/routes/:id', wrap(async (req, res) => {
    if (!(await store.deleteRoute(intParam(req.params.id, 'id')))) throw new HttpError(404, 'Route not found');
    res.status(204).end();
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
  });

  return app;
}

// Start the server only when run directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = await createStore();
  const port = Number(process.env.PORT) || 4000;
  createApp(store).listen(port, () => console.log(`Traffic Routing API listening on http://localhost:${port}/api`));
}
