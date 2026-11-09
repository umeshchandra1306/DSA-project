/**
 * store.js — persistence layer with two interchangeable implementations.
 *
 *   PgStore      PostgreSQL via raw `pg` queries (used when DATABASE_URL is set)
 *   MemoryStore  in-process maps (fallback so the app runs with no database;
 *                data is lost on restart)
 *
 * Both expose the same async interface, so server.js does not care which one
 * it is talking to.
 */

import { Graph } from '../../dsa/Graph.js';

const RUN_COLUMNS = `id, graph_id AS "graphId", sample_key AS "sampleKey", algorithm, mode, source, target, found,
  path, total_distance AS "totalDistance", total_time AS "totalTime", total_cost AS "totalCost",
  nodes_explored AS "nodesExplored", edges_checked AS "edgesChecked", execution_ms AS "executionTimeMs",
  created_at AS "createdAt"`;

// ---------------------------------------------------------------- PostgreSQL

export class PgStore {
  constructor(pool) {
    this.pool = pool;
    this.kind = 'postgres';
  }

  async listGraphs() {
    const { rows } = await this.pool.query(
      `SELECT g.id, g.name, g.description, g.created_at AS "createdAt", g.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM nodes n WHERE n.graph_id = g.id) AS "nodeCount",
              (SELECT count(*)::int FROM roads r WHERE r.graph_id = g.id) AS "roadCount"
         FROM graphs g ORDER BY g.updated_at DESC`,
    );
    return rows;
  }

  async getGraph(id) {
    const g = await this.pool.query('SELECT id, name, description FROM graphs WHERE id = $1', [id]);
    if (g.rowCount === 0) return null;
    const nodes = await this.pool.query(
      'SELECT node_id AS id, label, x, y FROM nodes WHERE graph_id = $1 ORDER BY node_id',
      [id],
    );
    const roads = await this.pool.query(
      `SELECT road_id AS id, source, destination, distance, base_travel_time AS "baseTravelTime",
              traffic_level AS "trafficLevel", is_blocked AS "isBlocked", bidirectional
         FROM roads WHERE graph_id = $1 ORDER BY road_id`,
      [id],
    );
    return { id: g.rows[0].id, description: g.rows[0].description, name: g.rows[0].name, nodes: nodes.rows, roads: roads.rows };
  }

  async saveGraph(graphJson, description = '') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO graphs (name, description) VALUES ($1, $2) RETURNING id',
        [graphJson.name, description],
      );
      const id = rows[0].id;
      for (const n of graphJson.nodes) {
        await client.query('INSERT INTO nodes (graph_id, node_id, label, x, y) VALUES ($1,$2,$3,$4,$5)', [
          id, n.id, n.label, n.x, n.y,
        ]);
      }
      for (const r of graphJson.roads) {
        await client.query(
          `INSERT INTO roads (graph_id, road_id, source, destination, distance, base_travel_time,
                              traffic_level, is_blocked, bidirectional)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, r.id, r.source, r.destination, r.distance, r.baseTravelTime, r.trafficLevel, r.isBlocked, r.bidirectional],
        );
      }
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteGraph(id) {
    const { rowCount } = await this.pool.query('DELETE FROM graphs WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async updateRoad(graphId, roadId, { trafficLevel, isBlocked }) {
    const { rows } = await this.pool.query(
      `UPDATE roads SET traffic_level = COALESCE($3, traffic_level), is_blocked = COALESCE($4, is_blocked)
        WHERE graph_id = $1 AND road_id = $2
        RETURNING traffic_level AS "trafficLevel", is_blocked AS "isBlocked"`,
      [graphId, roadId, trafficLevel ?? null, isBlocked ?? null],
    );
    if (rows.length) await this.pool.query('UPDATE graphs SET updated_at = now() WHERE id = $1', [graphId]);
    return rows[0] ?? null;
  }

  async addRun(run) {
    const { rows } = await this.pool.query(
      `INSERT INTO simulation_runs (graph_id, sample_key, algorithm, mode, source, target, found, path,
          total_distance, total_time, total_cost, nodes_explored, edges_checked, execution_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) RETURNING ${RUN_COLUMNS}`,
      [run.graphId ?? null, run.sampleKey ?? null, run.algorithm, run.mode, run.source, run.target, run.found,
        JSON.stringify(run.path), run.totalDistance, run.totalTime, run.totalCost, run.nodesExplored,
        run.edgesChecked, run.executionTimeMs],
    );
    return rows[0];
  }

  async listRuns({ graphId, sampleKey, limit = 50 }) {
    const { rows } = await this.pool.query(
      `SELECT ${RUN_COLUMNS} FROM simulation_runs
        WHERE ($1::int IS NULL OR graph_id = $1) AND ($2::text IS NULL OR sample_key = $2)
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [graphId ?? null, sampleKey ?? null, limit],
    );
    return rows;
  }

  async addEvent(ev) {
    const { rows } = await this.pool.query(
      `INSERT INTO traffic_events (graph_id, sample_key, road_id, event_type, old_traffic, new_traffic, route_changed)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, graph_id AS "graphId", sample_key AS "sampleKey", road_id AS "roadId",
                 event_type AS "eventType", old_traffic AS "oldTraffic", new_traffic AS "newTraffic",
                 route_changed AS "routeChanged", created_at AS "createdAt"`,
      [ev.graphId ?? null, ev.sampleKey ?? null, ev.roadId, ev.eventType, ev.oldTraffic ?? null, ev.newTraffic ?? null,
        Boolean(ev.routeChanged)],
    );
    return rows[0];
  }

  async listEvents({ graphId, sampleKey, limit = 100 }) {
    const { rows } = await this.pool.query(
      `SELECT id, graph_id AS "graphId", sample_key AS "sampleKey", road_id AS "roadId",
              event_type AS "eventType", old_traffic AS "oldTraffic", new_traffic AS "newTraffic",
              route_changed AS "routeChanged", created_at AS "createdAt"
         FROM traffic_events
        WHERE ($1::int IS NULL OR graph_id = $1) AND ($2::text IS NULL OR sample_key = $2)
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [graphId ?? null, sampleKey ?? null, limit],
    );
    return rows;
  }

  async addRoute(route) {
    const { rows } = await this.pool.query(
      `INSERT INTO saved_routes (graph_id, sample_key, name, source, target, mode)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, graph_id AS "graphId", sample_key AS "sampleKey", name, source, target, mode, created_at AS "createdAt"`,
      [route.graphId ?? null, route.sampleKey ?? null, route.name, route.source, route.target, route.mode],
    );
    return rows[0];
  }

  async listRoutes({ graphId, sampleKey }) {
    const { rows } = await this.pool.query(
      `SELECT id, graph_id AS "graphId", sample_key AS "sampleKey", name, source, target, mode, created_at AS "createdAt"
         FROM saved_routes
        WHERE ($1::int IS NULL OR graph_id = $1) AND ($2::text IS NULL OR sample_key = $2)
        ORDER BY created_at DESC, id DESC`,
      [graphId ?? null, sampleKey ?? null],
    );
    return rows;
  }

  async deleteRoute(id) {
    const { rowCount } = await this.pool.query('DELETE FROM saved_routes WHERE id = $1', [id]);
    return rowCount > 0;
  }
}

// ------------------------------------------------------------------- Memory

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.graphs = new Map();
    this.runs = [];
    this.events = [];
    this.routes = [];
    this._ids = { graph: 1, run: 1, event: 1, route: 1 };
  }

  async listGraphs() {
    return [...this.graphs.values()]
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        nodeCount: g.data.nodes.length,
        roadCount: g.data.roads.length,
      }))
      .reverse();
  }

  async getGraph(id) {
    const g = this.graphs.get(Number(id));
    return g ? { id: g.id, description: g.description, ...structuredClone(g.data) } : null;
  }

  async saveGraph(graphJson, description = '') {
    const id = this._ids.graph++;
    const now = new Date().toISOString();
    this.graphs.set(id, { id, name: graphJson.name, description, createdAt: now, updatedAt: now, data: structuredClone(graphJson) });
    return id;
  }

  async deleteGraph(id) {
    id = Number(id);
    const existed = this.graphs.delete(id);
    this.runs = this.runs.filter((r) => r.graphId !== id);
    this.events = this.events.filter((e) => e.graphId !== id);
    this.routes = this.routes.filter((r) => r.graphId !== id);
    return existed;
  }

  async updateRoad(graphId, roadId, { trafficLevel, isBlocked }) {
    const g = this.graphs.get(Number(graphId));
    const road = g?.data.roads.find((r) => r.id === roadId);
    if (!road) return null;
    if (trafficLevel != null) road.trafficLevel = trafficLevel;
    if (isBlocked != null) road.isBlocked = isBlocked;
    g.updatedAt = new Date().toISOString();
    return { trafficLevel: road.trafficLevel, isBlocked: road.isBlocked };
  }

  async addRun(run) {
    const row = { id: this._ids.run++, graphId: run.graphId ?? null, sampleKey: run.sampleKey ?? null, ...pick(run,
      ['algorithm', 'mode', 'source', 'target', 'found', 'path', 'totalDistance', 'totalTime', 'totalCost',
        'nodesExplored', 'edgesChecked', 'executionTimeMs']), createdAt: new Date().toISOString() };
    this.runs.unshift(row);
    return row;
  }

  async listRuns({ graphId, sampleKey, limit = 50 }) {
    return this.runs.filter((r) => matches(r, graphId, sampleKey)).slice(0, limit);
  }

  async addEvent(ev) {
    const row = { id: this._ids.event++, graphId: ev.graphId ?? null, sampleKey: ev.sampleKey ?? null, roadId: ev.roadId,
      eventType: ev.eventType, oldTraffic: ev.oldTraffic ?? null, newTraffic: ev.newTraffic ?? null,
      routeChanged: Boolean(ev.routeChanged), createdAt: new Date().toISOString() };
    this.events.unshift(row);
    return row;
  }

  async listEvents({ graphId, sampleKey, limit = 100 }) {
    return this.events.filter((e) => matches(e, graphId, sampleKey)).slice(0, limit);
  }

  async addRoute(route) {
    const row = { id: this._ids.route++, graphId: route.graphId ?? null, sampleKey: route.sampleKey ?? null,
      ...pick(route, ['name', 'source', 'target', 'mode']), createdAt: new Date().toISOString() };
    this.routes.unshift(row);
    return row;
  }

  async listRoutes({ graphId, sampleKey }) {
    return this.routes.filter((r) => matches(r, graphId, sampleKey));
  }

  async deleteRoute(id) {
    const before = this.routes.length;
    this.routes = this.routes.filter((r) => r.id !== Number(id));
    return this.routes.length < before;
  }
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}

function matches(row, graphId, sampleKey) {
  return (graphId == null || row.graphId === graphId) && (sampleKey == null || row.sampleKey === sampleKey);
}

/** Validate a graph payload by building it; returns the normalised JSON. */
export function normalizeGraphPayload(payload) {
  const graph = Graph.fromJSON(payload); // throws a descriptive Error when invalid
  if (graph.nodeCount === 0) throw new Error('A network needs at least one node');
  return graph.toJSON();
}

/** Create the right store for the environment. */
export async function createStore() {
  if (!process.env.DATABASE_URL) {
    console.warn('[store] DATABASE_URL not set — using the in-memory store (data is lost on restart).');
    return new MemoryStore();
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query('SELECT 1');
  console.log('[store] connected to PostgreSQL');
  return new PgStore(pool);
}
