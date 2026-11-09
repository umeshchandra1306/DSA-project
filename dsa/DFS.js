/**
 * DFS.js — MODULE 1 (Lahari Yella): Depth-First Search.
 *
 * Stack-based general graph exploration. DFS goes as deep as possible before
 * backtracking, so the route it finds is *a* route, not a good one: it is
 * neither fewest-hops nor lowest-cost. It is included to show why exploration
 * order matters. The traversal is iterative (explicit stack) so it cannot
 * overflow the call stack on large networks.
 *
 * A node is marked visited when POPPED, and its parent edge is recorded at
 * that moment, which gives the same preorder as recursive DFS.
 *
 * Complexity: O(V + E) time, O(V) space.
 */

import { Stack } from './Queue.js';
import { makeResult } from './Path.js';
import { MODES } from './EdgeCost.js';

/**
 * @param {import('./Graph.js').Graph} graph
 * @param {string} source
 * @param {string} [target]  omit to traverse the whole component
 * @param {{mode?:string, record?:boolean}} [options]
 */
export function dfs(graph, source, target, { mode = MODES.TIME, record = true } = {}) {
  source = String(source);
  target = target == null ? null : String(target);
  if (!graph.hasNode(source)) throw new Error(`Unknown source node "${source}"`);
  if (target !== null && !graph.hasNode(target)) throw new Error(`Unknown target node "${target}"`);

  const startedAt = performance.now();
  const trace = [];
  const visitedOrder = [];
  const parent = new Map();
  const visited = new Set();
  const stack = new Stack();
  let edgesChecked = 0;

  stack.push({ node: source, via: null });
  if (record) trace.push({ type: 'frontier', node: source, parent: null });

  while (!stack.isEmpty()) {
    const { node: u, via } = stack.pop();
    if (visited.has(u)) continue; // stale duplicate entry
    visited.add(u);
    if (via) parent.set(u, via);
    visitedOrder.push(u);
    if (record) trace.push({ type: 'visit', node: u });
    if (u === target) break;

    // Push in reverse so the first neighbour in the adjacency list is explored first.
    const edges = graph.getNeighbors(u);
    for (let i = edges.length - 1; i >= 0; i--) {
      const edge = edges[i];
      edgesChecked++;
      const v = edge.destination;
      if (edge.isBlocked) {
        if (record) trace.push({ type: 'edge', from: u, to: v, blocked: true });
        continue;
      }
      if (record) trace.push({ type: 'edge', from: u, to: v, blocked: false });
      if (visited.has(v)) continue;
      stack.push({ node: v, via: edge });
      if (record) trace.push({ type: 'frontier', node: v, parent: u });
    }
  }

  return makeResult({ algorithm: 'DFS', mode, source, target, parent, visitedOrder, edgesChecked, startedAt, trace });
}
