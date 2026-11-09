/**
 * BFS.js — MODULE 1 (Lahari Yella): Breadth-First Search.
 *
 * Unweighted, queue-based traversal. It finds the route with the FEWEST ROADS
 * (hops), ignoring distance and traffic — which makes it the baseline against
 * which weighted Dijkstra routes are compared. Blocked roads are impassable
 * (treated as absent), exactly as for the other algorithms.
 *
 * Complexity: O(V + E) time, O(V) space.
 *
 * Trace events (for the visualiser):
 *   {type:'frontier', node, parent}   node discovered and enqueued
 *   {type:'visit',    node}           node dequeued / expanded
 *   {type:'edge',     from, to, blocked}  an outgoing edge was examined
 */

import { Queue } from './Queue.js';
import { makeResult } from './Path.js';
import { MODES } from './EdgeCost.js';

/**
 * @param {import('./Graph.js').Graph} graph
 * @param {string} source
 * @param {string} [target]  omit to traverse the whole component
 * @param {{mode?:string, record?:boolean}} [options] mode only affects the reported cost
 */
export function bfs(graph, source, target, { mode = MODES.TIME, record = true } = {}) {
  source = String(source);
  target = target == null ? null : String(target);
  if (!graph.hasNode(source)) throw new Error(`Unknown source node "${source}"`);
  if (target !== null && !graph.hasNode(target)) throw new Error(`Unknown target node "${target}"`);

  const startedAt = performance.now();
  const trace = [];
  const visitedOrder = [];
  const parent = new Map(); // nodeId -> edge used to reach it (predecessor map)
  const discovered = new Set([source]);
  const queue = new Queue();
  let edgesChecked = 0;

  queue.enqueue(source);
  if (record) trace.push({ type: 'frontier', node: source, parent: null });

  while (!queue.isEmpty()) {
    const u = queue.dequeue();
    visitedOrder.push(u);
    if (record) trace.push({ type: 'visit', node: u });
    if (u === target) break; // BFS reaches each node first via a fewest-hops route

    for (const edge of graph.getNeighbors(u)) {
      edgesChecked++;
      const v = edge.destination;
      if (edge.isBlocked) {
        if (record) trace.push({ type: 'edge', from: u, to: v, blocked: true });
        continue;
      }
      if (record) trace.push({ type: 'edge', from: u, to: v, blocked: false });
      if (discovered.has(v)) continue;
      discovered.add(v);
      parent.set(v, edge);
      queue.enqueue(v);
      if (record) trace.push({ type: 'frontier', node: v, parent: u });
    }
  }

  return makeResult({ algorithm: 'BFS', mode, source, target, parent, visitedOrder, edgesChecked, startedAt, trace });
}
