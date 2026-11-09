# Traffic Routing Optimizer

A dynamic graph-based routing simulator with real-time traffic and congestion modelling.
DSA course project — **BFS, DFS and Dijkstra only (no A\*)**, all data structures hand-written.

```
dsa/        MODULES 1 & 2 — pure JS, zero dependencies, shared by browser and server
backend/    MODULE 3 — Express REST API + PostgreSQL schema
frontend/   MODULE 3 — React (Vite) + Tailwind, HTML5 canvas visualiser
```

## Quick start

```bash
npm run install:all            # installs backend + frontend deps
npm test                       # 26 DSA unit tests (no dependencies needed)

# Optional: PostgreSQL. Without DATABASE_URL the API uses an in-memory store.
export DATABASE_URL=postgres://user:pass@localhost:5432/traffic
npm --prefix backend run db:init

npm run dev                    # starts backend (:4000) and frontend (:5173)
```

The UI also works with the backend switched off (samples run locally; saving and history are disabled).

## Who owns what

| Module | Owner | Files |
|---|---|---|
| 1 — Graph engine & unweighted traversals | Lahari Yella | `dsa/Graph.js`, `dsa/BFS.js`, `dsa/DFS.js`, `dsa/Queue.js` (Queue + Stack), `dsa/tests/run.js` |
| 2 — Weighted routing, heap & dynamic traffic | Umesh Chandra Bojja | `dsa/MinHeap.js`, `dsa/Dijkstra.js`, `dsa/DynamicRouter.js`, `dsa/EdgeCost.js` |
| 3 — Integration, UI, visualiser, database | Nagulapati Sai Ashwin | `backend/server.js`, `backend/db/schema.sql`, `backend/db/store.js`, `frontend/src/components/*` , `frontend/src/App.jsx` |

Shared helpers: `dsa/Path.js` (path reconstruction + run statistics), `dsa/sampleGraphs.js`, `dsa/Random.js`.

## DSA summary

| Structure / algorithm | Where | Complexity |
|---|---|---|
| Adjacency list (`Map<id, Edge[]>`) + node/road hash maps | `Graph.js` | O(V+E) space |
| FIFO queue (linked list), LIFO stack | `Queue.js` | O(1) per op |
| Binary min-heap with position map (`insert`, `extractMin`, `decreaseKey`, `bubbleUp`, `bubbleDown`) | `MinHeap.js` | O(log n) |
| BFS — fewest roads | `BFS.js` | O(V+E) |
| DFS — iterative, explicit stack | `DFS.js` | O(V+E) |
| Dijkstra — heap with decrease-key | `Dijkstra.js` | O((V+E) log V) |
| Predecessor map → path reconstruction | `Path.js` | O(path) |

### Edge cost (`dsa/EdgeCost.js`)

| Mode | Cost |
|---|---|
| Shortest distance | `distance` |
| Fastest time | `baseTravelTime × trafficLevel` |
| Avoid traffic | `distance × trafficLevel²` |
| Any mode, blocked road | `Infinity` (never traversed) |

`trafficLevel` is clamped to 1.0–3.0.

### Dynamic routing

`DynamicRouter.applyEvent({type:'block'|'unblock'|'traffic', roadId, value})` mutates the graph and re-runs
Dijkstra for the active route. The report says whether the route was affected, changed, broken or restored and
the cost delta. The UI shows the previous route as a dashed amber line and redraws the new route progressively.
`simulateTick(rng)` produces random congestion/closures for the “live traffic” mode.

## REST API (`/api`)

| Method & path | Purpose |
|---|---|
| `GET /health` | status and active store (`postgres` / `memory`) |
| `GET /graphs/samples`, `GET /graphs/samples/:key` | City Center Grid (`cityGrid`), Highway Hub (`highwayHub`), Complex Suburban Network (`suburban`) |
| `GET/POST /graphs`, `GET/DELETE /graphs/:id` | saved custom networks |
| `PATCH /graphs/:id/roads/:roadId` | persist traffic level / blockage |
| `POST /route` | run BFS/DFS/Dijkstra server-side; `persist:true` stores the stats |
| `GET/POST /runs` | past simulation runs and statistics |
| `GET/POST /events` | traffic-event history |
| `GET/POST /routes`, `DELETE /routes/:id` | saved routes |

Schema: `backend/db/schema.sql` (`graphs`, `nodes`, `roads`, `simulation_runs`, `traffic_events`, `saved_routes`, `users`).

## Using the app

1. Pick a network, set source/target (dropdowns or click the map), choose an optimisation mode and algorithm.
2. **Run** animates exploration (amber = frontier, blue = visited, green = final path). Use Pause, Step, Step back and the speed slider.
3. Choose **Compare all three** to watch Dijkstra, BFS and DFS on the same network and see a metrics table
   (distance, time, roads, nodes explored, edges checked, execution ms).
4. Click a road to set its traffic or block it, or start **live traffic** — the route re-computes instantly.
5. Map tools add/delete intersections and roads; **Save** stores the network in PostgreSQL.

## Testing status

* `npm test` — DSA suite, including a Bellman-Ford cross-check of Dijkstra on 60 random graphs in all three modes.
* `backend/test/api.test.js` (run with `npm test` inside `backend/` after installing dependencies) covers the REST API against the in-memory store.
