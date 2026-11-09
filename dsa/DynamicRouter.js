/**
 * DynamicRouter.js — MODULE 2 (Umesh Chandra Bojja): live traffic engine.
 *
 * Owns an "active route" (source, target, mode). Whenever a road's traffic
 * level changes or a road is blocked/unblocked, the router mutates the graph
 * and immediately re-runs Dijkstra, reporting how the optimal route moved so
 * the UI can animate the transition from the old path to the new one.
 *
 * Event types accepted by applyEvent():
 *   {type:'block',   roadId}
 *   {type:'unblock', roadId}
 *   {type:'traffic', roadId, value}     value = new multiplier, clamped to [1, 3]
 */

import { dijkstra } from './Dijkstra.js';
import { MODES, clampTraffic } from './EdgeCost.js';

export class DynamicRouter {
  /** @param {import('./Graph.js').Graph} graph */
  constructor(graph) {
    this.graph = graph;
    /** @type {{source:string,target:string,mode:string,result:object}|null} */
    this.active = null;
    this.eventLog = [];
    this._listeners = new Set();
  }

  /** Subscribe to recalculation reports. Returns an unsubscribe function. */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Set (and compute) the active route with Dijkstra. */
  setRoute(source, target, mode = MODES.TIME) {
    const result = dijkstra(this.graph, source, target, { mode });
    this.active = { source: String(source), target: String(target), mode, result };
    return result;
  }

  clearRoute() {
    this.active = null;
  }

  /** Re-run Dijkstra for the active route under current conditions. */
  recalculate() {
    if (!this.active) return null;
    const { source, target, mode } = this.active;
    const result = dijkstra(this.graph, source, target, { mode });
    this.active.result = result;
    return result;
  }

  blockRoad(roadId) {
    return this.applyEvent({ type: 'block', roadId });
  }

  unblockRoad(roadId) {
    return this.applyEvent({ type: 'unblock', roadId });
  }

  setTraffic(roadId, level) {
    return this.applyEvent({ type: 'traffic', roadId, value: level });
  }

  /**
   * Apply a traffic/blockage event and recompute the active route.
   * @returns {{event:object, applied:boolean, hadRoute:boolean, previous:object|null,
   *            current:object|null, routeChanged:boolean, routeAffected:boolean,
   *            routeBroken:boolean, routeRestored:boolean, costDelta:number|null}}
   */
  applyEvent(event) {
    const road = this.graph.getRoad(event.roadId);
    if (!road) throw new Error(`Unknown road "${event.roadId}"`);

    const before = { trafficLevel: road.trafficLevel, isBlocked: road.isBlocked };
    if (event.type === 'block') this.graph.updateRoad(road.id, { isBlocked: true });
    else if (event.type === 'unblock') this.graph.updateRoad(road.id, { isBlocked: false });
    else if (event.type === 'traffic') this.graph.updateRoad(road.id, { trafficLevel: clampTraffic(event.value) });
    else throw new Error(`Unknown event type "${event.type}"`);

    const after = { trafficLevel: road.trafficLevel, isBlocked: road.isBlocked };
    const logged = { ...event, roadId: road.id, before, after, at: Date.now() };
    this.eventLog.push(logged);

    const report = {
      event: logged,
      applied: true,
      hadRoute: Boolean(this.active),
      previous: this.active ? this.active.result : null,
      current: this.active ? this.active.result : null,
      routeChanged: false,
      routeAffected: false,
      routeBroken: false,
      routeRestored: false,
      costDelta: null,
    };

    if (this.active) {
      const previous = this.active.result;
      const current = this.recalculate();
      report.previous = previous;
      report.current = current;
      report.routeAffected = previous.edges.some((e) => e.roadId === road.id);
      report.routeChanged = !samePath(previous.path, current.path);
      report.routeBroken = previous.found && !current.found;
      report.routeRestored = !previous.found && current.found;
      if (previous.found && current.found) report.costDelta = +(current.totalCost - previous.totalCost).toFixed(4);
    }

    for (const listener of this._listeners) listener(report);
    return report;
  }

  /**
   * Simulate one "tick" of city traffic: random roads get busier or clear up,
   * and a few are closed/reopened. Pure function of the supplied rng, so runs
   * are reproducible. Returns the list of reports produced.
   */
  simulateTick(rng, { changes = 3, blockChance = 0.08, reopenChance = 0.35 } = {}) {
    const reports = [];
    const roads = [...this.graph.roads.values()];
    if (roads.length === 0) return reports;

    for (const road of roads) {
      if (road.isBlocked && rng() < reopenChance) reports.push(this.unblockRoad(road.id));
    }
    for (let i = 0; i < changes; i++) {
      const road = roads[Math.floor(rng() * roads.length)];
      if (rng() < blockChance) {
        reports.push(this.blockRoad(road.id));
      } else {
        const delta = (rng() - 0.45) * 1.2; // slight bias toward congestion
        reports.push(this.setTraffic(road.id, road.trafficLevel + delta));
      }
    }
    return reports;
  }
}

function samePath(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
