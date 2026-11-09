/**
 * MinHeap.js — MODULE 2 (Umesh Chandra Bojja): binary min-heap priority queue.
 *
 * Stored in a flat array: children of index i are 2i+1 and 2i+2, parent is
 * floor((i-1)/2). A hash map `position` (value -> array index) is kept in sync
 * so `decreaseKey` can locate an element in O(1) instead of scanning.
 *
 *   insert        O(log n)
 *   extractMin    O(log n)
 *   decreaseKey   O(log n)
 *   peek/isEmpty  O(1)
 *
 * Every `value` must be unique within the heap (graph node ids are).
 */

export class MinHeap {
  constructor() {
    /** @type {{value:any, priority:number}[]} */
    this.heap = [];
    /** @type {Map<any, number>} value -> index in `heap` */
    this.position = new Map();
  }

  get size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  contains(value) {
    return this.position.has(value);
  }

  /** Current priority of `value`, or undefined if absent. */
  priorityOf(value) {
    const i = this.position.get(value);
    return i === undefined ? undefined : this.heap[i].priority;
  }

  peek() {
    return this.heap.length ? this.heap[0] : undefined;
  }

  /** Insert a new (value, priority) pair. Throws on duplicate value. */
  insert(value, priority) {
    if (this.position.has(value)) throw new Error(`MinHeap: duplicate value ${String(value)}`);
    if (Number.isNaN(priority)) throw new Error('MinHeap: priority must not be NaN');
    this.heap.push({ value, priority });
    const index = this.heap.length - 1;
    this.position.set(value, index);
    this.bubbleUp(index);
  }

  /** Remove and return the entry with the smallest priority ({value, priority}). */
  extractMin() {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop();
    this.position.delete(min.value);
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.position.set(last.value, 0);
      this.bubbleDown(0);
    }
    return min;
  }

  /**
   * Lower the priority of an existing value. Returns false (and does nothing)
   * if the value is absent or the new priority is not strictly smaller.
   */
  decreaseKey(value, newPriority) {
    const i = this.position.get(value);
    if (i === undefined || !(newPriority < this.heap[i].priority)) return false;
    this.heap[i].priority = newPriority;
    this.bubbleUp(i);
    return true;
  }

  /** Restore the heap property by moving index `i` up toward the root. */
  bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].priority <= this.heap[i].priority) break;
      this._swap(i, parent);
      i = parent;
    }
  }

  /** Restore the heap property by moving index `i` down toward the leaves. */
  bubbleDown(i) {
    const n = this.heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      this._swap(i, smallest);
      i = smallest;
    }
  }

  _swap(i, j) {
    const a = this.heap[i];
    const b = this.heap[j];
    this.heap[i] = b;
    this.heap[j] = a;
    this.position.set(b.value, i);
    this.position.set(a.value, j);
  }

  /** Debug helper: verifies the heap invariant and the position map. */
  isValid() {
    for (let i = 1; i < this.heap.length; i++) {
      if (this.heap[(i - 1) >> 1].priority > this.heap[i].priority) return false;
    }
    for (let i = 0; i < this.heap.length; i++) {
      if (this.position.get(this.heap[i].value) !== i) return false;
    }
    return this.position.size === this.heap.length;
  }
}
