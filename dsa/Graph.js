/**
 * Graph.js — MODULE 1 (Lahari Yella): adjacency-list graph.
 *
 * Representation
 * --------------
 *   nodes : Map<id, {id, label, x, y}>                 (hash map of vertices)
 *   adj   : Map<id, Edge[]>                            (the adjacency list)
 *   roads : Map<roadId, Road>                          (undirected "road" records)
 *
 * A *road* is what the user sees (and what the database stores). Internally a
 * bidirectional road is two directed *edges* that share the same attribute
 * values, so the algorithms only ever deal with directed edges:
 *
 *   Edge = { roadId, source, destination, distance, baseTravelTime,
 *            trafficLevel, isBlocked }
 *
 * Updating a road (traffic / blockage) updates both directed edges, which is
 * how the dynamic routing engine changes costs "on the fly".
 *
 * Space: O(V + E).  addNode / addRoad: O(1).  getNeighbors: O(1).
 */

import { clampTraffic } from './EdgeCost.js';

/** Default conversion: 100 canvas pixels == 1 distance unit (km). */
const PIXELS_PER_UNIT = 100;
/** Default speed used to derive baseTravelTime from distance (km/h). */
const DEFAULT_SPEED_KMH = 40;

export class Graph {
  constructor(name = 'Untitled network') {
    this.name = name;
    /** @type {Map<string, {id:string,label:string,x:number,y:number}>} */
    this.nodes = new Map();
    /** @type {Map<string, object[]>} adjacency list: node id -> outgoing edges */
    this.adj = new Map();
    /** @type {Map<string, object>} road id -> road record */
    this.roads = new Map();
    this._nextRoadId = 1;
  }

  // ------------------------------------------------------------------ nodes

  /** Add an intersection. Throws if the id already exists. */
  addNode(id, { label = String(id), x = 0, y = 0 } = {}) {
    id = String(id);
    if (this.nodes.has(id)) throw new Error(`Node "${id}" already exists`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Node "${id}" needs finite x/y`);
    const node = { id, label, x, y };
    this.nodes.set(id, node);
    this.adj.set(id, []);
    return node;
  }

  hasNode(id) {
    return this.nodes.has(String(id));
  }

  getNode(id) {
    return this.nodes.get(String(id));
  }

  nodeIds() {
    return [...this.nodes.keys()];
  }

  /** Remove a node together with every road touching it. */
  removeNode(id) {
    id = String(id);
    if (!this.nodes.has(id)) return false;
    for (const road of [...this.roads.values()]) {
      if (road.source === id || road.destination === id) this.removeRoad(road.id);
    }
    this.nodes.delete(id);
    this.adj.delete(id);
    return true;
  }

  // ------------------------------------------------------------------ roads

  /**
   * Add a road between two existing nodes.
   * Missing distance is derived from node coordinates; missing baseTravelTime
   * from distance at DEFAULT_SPEED_KMH (minutes).
   * @returns the road record
   */
  addRoad(source, destination, opts = {}) {
    source = String(source);
    destination = String(destination);
    const a = this.nodes.get(source);
    const b = this.nodes.get(destination);
    if (!a) throw new Error(`Unknown source node "${source}"`);
    if (!b) throw new Error(`Unknown destination node "${destination}"`);
    if (source === destination) throw new Error('Self-loop roads are not allowed');

    const distance =
      opts.distance ?? Math.max(0.01, +(Math.hypot(a.x - b.x, a.y - b.y) / PIXELS_PER_UNIT).toFixed(3));
    const baseTravelTime = opts.baseTravelTime ?? +((distance / DEFAULT_SPEED_KMH) * 60).toFixed(3);
    if (!(distance > 0) || !Number.isFinite(distance)) throw new Error('distance must be a positive number');
    if (!(baseTravelTime > 0) || !Number.isFinite(baseTravelTime)) {
      throw new Error('baseTravelTime must be a positive number');
    }

    let id = opts.id != null ? String(opts.id) : null;
    if (id == null) {
      while (this.roads.has(`r${this._nextRoadId}`)) this._nextRoadId++;
      id = `r${this._nextRoadId++}`;
    } else if (this.roads.has(id)) {
      throw new Error(`Road "${id}" already exists`);
    }

    const road = {
      id,
      source,
      destination,
      distance,
      baseTravelTime,
      trafficLevel: clampTraffic(opts.trafficLevel ?? 1),
      isBlocked: Boolean(opts.isBlocked ?? false),
      bidirectional: opts.bidirectional !== false,
      edges: [],
    };

    const forward = this._makeEdge(road, source, destination);
    this.adj.get(source).push(forward);
    road.edges.push(forward);
    if (road.bidirectional) {
      const backward = this._makeEdge(road, destination, source);
      this.adj.get(destination).push(backward);
      road.edges.push(backward);
    }
    this.roads.set(id, road);
    return road;
  }

  _makeEdge(road, source, destination) {
    return {
      roadId: road.id,
      source,
      destination,
      distance: road.distance,
      baseTravelTime: road.baseTravelTime,
      trafficLevel: road.trafficLevel,
      isBlocked: road.isBlocked,
    };
  }

  getRoad(roadId) {
    return this.roads.get(String(roadId));
  }

  removeRoad(roadId) {
    const road = this.roads.get(String(roadId));
    if (!road) return false;
    for (const edge of road.edges) {
      const list = this.adj.get(edge.source);
      const idx = list.indexOf(edge);
      if (idx !== -1) list.splice(idx, 1);
    }
    this.roads.delete(road.id);
    return true;
  }

  /**
   * Change live attributes of a road (traffic level, blockage). Keeps the road
   * record and every directed edge in sync. Returns the road, or undefined.
   */
  updateRoad(roadId, patch = {}) {
    const road = this.roads.get(String(roadId));
    if (!road) return undefined;
    if (patch.trafficLevel !== undefined) road.trafficLevel = clampTraffic(patch.trafficLevel);
    if (patch.isBlocked !== undefined) road.isBlocked = Boolean(patch.isBlocked);
    for (const edge of road.edges) {
      edge.trafficLevel = road.trafficLevel;
      edge.isBlocked = road.isBlocked;
    }
    return road;
  }

  // ---------------------------------------------------------------- queries

  /** Outgoing directed edges of a node (the adjacency list entry). */
  getNeighbors(id) {
    return this.adj.get(String(id)) ?? [];
  }

  /** Number of vertices. */
  get nodeCount() {
    return this.nodes.size;
  }

  /** Number of directed edges (a bidirectional road counts twice). */
  get edgeCount() {
    let n = 0;
    for (const list of this.adj.values()) n += list.length;
    return n;
  }

  /** The directed edge u -> v with smallest distance, if any (helper for tests/UI). */
  findEdge(u, v) {
    let best;
    for (const e of this.getNeighbors(u)) {
      if (e.destination === String(v) && (!best || e.distance < best.distance)) best = e;
    }
    return best;
  }

  // ----------------------------------------------------------- serialisation

  /** Plain JSON-safe object (also the wire format used by the REST API). */
  toJSON() {
    return {
      name: this.name,
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      roads: [...this.roads.values()].map(({ edges, ...road }) => ({ ...road })),
    };
  }

  /** Rebuild a graph from `toJSON()` output (validates as it goes). */
  static fromJSON(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.roads)) {
      throw new Error('Graph JSON must contain "nodes" and "roads" arrays');
    }
    const g = new Graph(data.name ?? 'Untitled network');
    for (const n of data.nodes) g.addNode(n.id, { label: n.label, x: Number(n.x), y: Number(n.y) });
    for (const r of data.roads) {
      g.addRoad(r.source, r.destination, {
        id: r.id,
        distance: r.distance,
        baseTravelTime: r.baseTravelTime,
        trafficLevel: r.trafficLevel,
        isBlocked: r.isBlocked,
        bidirectional: r.bidirectional,
      });
    }
    return g;
  }

  clone() {
    return Graph.fromJSON(this.toJSON());
  }
}
