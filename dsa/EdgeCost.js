/**
 * EdgeCost.js — dynamic edge-cost model shared by every routing algorithm.
 *
 * The cost of an edge is NOT stored; it is computed on demand from the edge's
 * current attributes, so a change in traffic level or a road blockage is
 * reflected immediately the next time an algorithm runs.
 *
 *   DISTANCE       cost = distance
 *   TIME           cost = baseTravelTime * trafficLevel
 *   AVOID_TRAFFIC  cost = distance * trafficLevel^2   (congestion penalised hard)
 *
 * "Avoid blocked roads" applies in EVERY mode: a blocked edge costs Infinity,
 * and all algorithms refuse to relax an edge whose cost is Infinity.
 */

export const MODES = Object.freeze({
  DISTANCE: 'distance',
  TIME: 'time',
  AVOID_TRAFFIC: 'avoidTraffic',
});

export const MODE_LABELS = Object.freeze({
  [MODES.DISTANCE]: 'Shortest distance',
  [MODES.TIME]: 'Fastest time',
  [MODES.AVOID_TRAFFIC]: 'Avoid traffic',
});

/** Traffic multiplier bounds: 1.0x (free flow) .. 3.0x (gridlock). */
export const MIN_TRAFFIC = 1.0;
export const MAX_TRAFFIC = 3.0;

/** Clamp a traffic multiplier into the legal [1, 3] range. */
export function clampTraffic(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return MIN_TRAFFIC;
  return Math.min(MAX_TRAFFIC, Math.max(MIN_TRAFFIC, n));
}

/**
 * Cost of traversing a directed edge under the given optimisation mode.
 * @param {{distance:number, baseTravelTime:number, trafficLevel:number, isBlocked:boolean}} edge
 * @param {string} mode one of MODES
 * @returns {number} a non-negative finite cost, or Infinity when blocked
 */
export function edgeCost(edge, mode = MODES.TIME) {
  if (edge.isBlocked) return Infinity;
  switch (mode) {
    case MODES.DISTANCE:
      return edge.distance;
    case MODES.TIME:
      return edge.baseTravelTime * edge.trafficLevel;
    case MODES.AVOID_TRAFFIC:
      return edge.distance * edge.trafficLevel * edge.trafficLevel;
    default:
      throw new Error(`Unknown optimisation mode: ${mode}`);
  }
}
