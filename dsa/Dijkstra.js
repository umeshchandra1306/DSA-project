/**
 * Dijkstra.js — MODULE 2 (Umesh Chandra Bojja): weighted shortest path.
 *
 * Classic Dijkstra with the hand-written MinHeap (decrease-key variant, so the
 * heap never holds more than V entries). Edge weights come from `edgeCost`
 * under the chosen optimisation mode, so the result reflects the CURRENT
 * traffic levels; blocked roads cost Infinity and are never relaxed.
 *
 * Complexity: O((V + E) log V) time, O(V) space.
 *
 * Hash maps used: dist (best known cost), parent (predecessor edge),
 * settled (visited set).
 */

import { MinHeap } from './MinHeap.js';
import { edgeCost, MODES } from './EdgeCost.js';
import { makeResult } from './Path.js';

/**
 * @param {import('./Graph.js').Graph} graph
 * @param {string} source
 * @param {string} [target]  omit to compute costs to every reachable node
 * @param {{mode?:string, record?:boolean}} [options]
 * @returns result object (see Path.makeResult) plus `distances` (Map node -> cost)
 */
export function dijkstra(graph, source, target, { mode = MODES.TIME, record = true } = {}) {
  source = String(source);
  target = target == null ? null : String(target);
  if (!graph.hasNode(source)) throw new Error(`Unknown source node "${source}"`);
  if (target !== null && !graph.hasNode(target)) throw new Error(`Unknown target node "${target}"`);

  const startedAt = performance.now();
  const trace = [];
  const visitedOrder = [];
  const dist = new Map([[source, 0]]);
  const parent = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  let edgesChecked = 0;

  heap.insert(source, 0);
  if (record) trace.push({ type: 'frontier', node: source, parent: null, cost: 0 });

  while (!heap.isEmpty()) {
    const { value: u, priority: du } = heap.extractMin();
    settled.add(u);
    visitedOrder.push(u);
    if (record) trace.push({ type: 'visit', node: u, cost: du });
    if (u === target) break; // non-negative weights: u's distance is final

    for (const edge of graph.getNeighbors(u)) {
      edgesChecked++;
      const v = edge.destination;
      const w = edgeCost(edge, mode);
      if (w === Infinity) {
        if (record) trace.push({ type: 'edge', from: u, to: v, blocked: true });
        continue;
      }
      if (record) trace.push({ type: 'edge', from: u, to: v, blocked: false });
      if (settled.has(v)) continue;

      const candidate = du + w;
      const known = dist.get(v);
      if (known === undefined || candidate < known) {
        dist.set(v, candidate);
        parent.set(v, edge);
        if (heap.contains(v)) heap.decreaseKey(v, candidate);
        else heap.insert(v, candidate);
        if (record) trace.push({ type: 'frontier', node: v, parent: u, cost: candidate });
      }
    }
  }

  const result = makeResult({ algorithm: 'Dijkstra', mode, source, target, parent, visitedOrder, edgesChecked, startedAt, trace });
  result.distances = dist;
  return result;
}
