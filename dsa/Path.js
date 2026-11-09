/**
 * Path.js — path reconstruction and per-run statistics shared by BFS, DFS and
 * Dijkstra.
 *
 * Every algorithm records, for each discovered node, the *edge* that reached
 * it in a predecessor (parent) hash map:  parent: Map<nodeId, Edge>.
 * Backtracking from the target through `edge.source` yields the route.
 */

import { edgeCost, MODES } from './EdgeCost.js';

/**
 * Walk the predecessor map from `target` back to `source`.
 * @returns {{path:string[], edges:object[]}} empty arrays when unreachable
 */
export function reconstructPath(parent, source, target) {
  if (source === target) return { path: [source], edges: [] };
  if (!parent.has(target)) return { path: [], edges: [] };
  const path = [target];
  const edges = [];
  let cur = target;
  // Guard against corrupted maps: a valid route never has more hops than parents.
  let guard = parent.size + 1;
  while (cur !== source) {
    const edge = parent.get(cur);
    if (!edge || guard-- < 0) return { path: [], edges: [] };
    edges.push(edge);
    cur = edge.source;
    path.push(cur);
  }
  path.reverse();
  edges.reverse();
  return { path, edges };
}

/** Totals for a list of directed edges, evaluated at the CURRENT traffic. */
export function routeMetrics(edges, mode = MODES.TIME) {
  let totalDistance = 0;
  let totalTime = 0;
  let totalCost = 0;
  for (const e of edges) {
    totalDistance += e.distance;
    totalTime += e.baseTravelTime * e.trafficLevel;
    totalCost += edgeCost(e, mode);
  }
  return {
    totalDistance: round(totalDistance),
    totalTime: round(totalTime),
    totalCost: round(totalCost),
    hops: edges.length,
  };
}

function round(x) {
  return Number.isFinite(x) ? +x.toFixed(4) : x;
}

/**
 * Assemble the uniform result object every algorithm returns.
 *
 * {
 *   algorithm, mode, source, target, found,
 *   path: nodeId[], edges: Edge[],
 *   totalDistance, totalTime, totalCost, hops,
 *   nodesExplored, edgesChecked, executionTimeMs,
 *   visitedOrder: nodeId[], trace: event[]
 * }
 */
export function makeResult({
  algorithm,
  mode,
  source,
  target,
  parent,
  visitedOrder,
  edgesChecked,
  startedAt,
  trace,
}) {
  const { path, edges } = reconstructPath(parent, source, target);
  const found = path.length > 0;
  const metrics = found
    ? routeMetrics(edges, mode)
    : { totalDistance: null, totalTime: null, totalCost: null, hops: null };
  return {
    algorithm,
    mode,
    source,
    target,
    found,
    path,
    edges,
    ...metrics,
    nodesExplored: visitedOrder.length,
    edgesChecked,
    executionTimeMs: +(performance.now() - startedAt).toFixed(4),
    visitedOrder,
    trace,
  };
}

/** Strip heavy/non-serialisable fields (edges, trace) for storage or logging. */
export function summarize(result) {
  const { edges, trace, visitedOrder, ...rest } = result;
  return { ...rest, edgeRoadIds: edges.map((e) => e.roadId) };
}
