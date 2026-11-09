/**
 * replay.js — turns an algorithm's recorded trace into drawable state.
 *
 * An algorithm run is a list of events (frontier / visit / edge). Showing step
 * N of the animation is a pure function of the first N events, so play, pause,
 * step and scrubbing are all just changes of N.
 */

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {object[]} trace  events recorded by BFS / DFS / Dijkstra
 * @param {number} step     how many events have been applied
 */
export function deriveState(trace, step) {
  const n = Math.max(0, Math.min(step, trace.length));
  const nodeState = new Map(); // id -> 'frontier' | 'visited'
  const parent = new Map(); // child -> parent (latest discovery)
  let current = null;
  let lastEdge = null;
  let edgesChecked = 0;
  let visited = 0;

  for (let i = 0; i < n; i++) {
    const ev = trace[i];
    if (ev.type === 'frontier') {
      if (nodeState.get(ev.node) !== 'visited') nodeState.set(ev.node, 'frontier');
      if (ev.parent != null) parent.set(ev.node, ev.parent);
    } else if (ev.type === 'visit') {
      nodeState.set(ev.node, 'visited');
      current = ev.node;
      visited++;
    } else if (ev.type === 'edge') {
      edgesChecked++;
      lastEdge = { from: ev.from, to: ev.to, blocked: ev.blocked };
    }
  }

  const treeEdges = new Set();
  for (const [child, par] of parent) treeEdges.add(pairKey(child, par));
  let frontier = 0;
  for (const s of nodeState.values()) if (s === 'frontier') frontier++;

  return { nodeState, treeEdges, current, lastEdge, stats: { visited, frontier, edgesChecked } };
}

/** Smallest step count that applies the next 'visit' event after `step`. */
export function nextVisitStep(trace, step) {
  for (let i = step; i < trace.length; i++) {
    if (trace[i].type === 'visit') return i + 1;
  }
  return trace.length;
}

/** Step count that just finished the previous node expansion (for "step back"). */
export function prevVisitStep(trace, step) {
  let seen = 0;
  let last = 0;
  for (let i = 0; i < Math.min(step, trace.length); i++) {
    if (trace[i].type === 'visit') {
      seen++;
      if (i + 1 < step) last = i + 1;
    }
  }
  return seen === 0 ? 0 : last;
}
