/**
 * Queue.js — FIFO queue used by BFS (MODULE 1).
 *
 * Implemented as a singly linked list with head/tail pointers so that both
 * enqueue and dequeue are true O(1) (Array.shift() is O(n)).
 */

export class Queue {
  constructor() {
    this._head = null;
    this._tail = null;
    this._size = 0;
  }

  get size() {
    return this._size;
  }

  isEmpty() {
    return this._size === 0;
  }

  enqueue(value) {
    const node = { value, next: null };
    if (this._tail) this._tail.next = node;
    else this._head = node;
    this._tail = node;
    this._size++;
  }

  dequeue() {
    if (!this._head) return undefined;
    const { value } = this._head;
    this._head = this._head.next;
    if (!this._head) this._tail = null;
    this._size--;
    return value;
  }

  peek() {
    return this._head ? this._head.value : undefined;
  }
}

/**
 * Stack.js equivalent — LIFO stack used by DFS. Backed by an array, whose
 * push/pop are amortised O(1).
 */
export class Stack {
  constructor() {
    this._items = [];
  }

  get size() {
    return this._items.length;
  }

  isEmpty() {
    return this._items.length === 0;
  }

  push(value) {
    this._items.push(value);
  }

  pop() {
    return this._items.pop();
  }

  peek() {
    return this._items[this._items.length - 1];
  }
}
