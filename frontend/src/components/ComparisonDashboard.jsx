/**
 * ComparisonDashboard.jsx — MODULE 3 (Nagulapati Sai Ashwin): metrics for the
 * current run, side-by-side algorithm comparison, and stored run history.
 *
 *  - In "compare" mode, renders one synchronised canvas per algorithm so BFS,
 *    DFS and Dijkstra can be watched exploring the SAME network at once.
 *  - A table lists each algorithm's route distance, time, nodes explored, edges
 *    checked and execution time; the best value in each column is highlighted.
 */

import { MODE_LABELS } from '@dsa/EdgeCost.js';
import GraphCanvas from './GraphCanvas.jsx';
import { deriveState } from '../lib/replay.js';

const ORDER = ['Dijkstra', 'BFS', 'DFS'];

const COLUMNS = [
  { key: 'totalDistance', label: 'Distance (km)', digits: 2 },
  { key: 'totalTime', label: 'Travel time (min)', digits: 1 },
  { key: 'hops', label: 'Roads', digits: 0 },
  { key: 'nodesExplored', label: 'Nodes explored', digits: 0 },
  { key: 'edgesChecked', label: 'Edges checked', digits: 0 },
  { key: 'executionTimeMs', label: 'Exec (ms)', digits: 3 },
];

const fmt = (v, d) => (v == null ? '—' : Number(v).toFixed(d));

/** Overlay shown on a canvas: live counters while animating, totals when done. */
export function StatsOverlay({ algorithm, result, replay, done }) {
  const s = replay?.stats ?? { visited: 0, frontier: 0, edgesChecked: 0 };
  return (
    <div className="chip mono">
      <div style={{ fontWeight: 500 }}>{algorithm}</div>
      <div>
        visited {s.visited} · frontier {s.frontier}
      </div>
      <div>edges checked {s.edgesChecked}</div>
      {done && result && (
        <div style={{ color: result.found ? 'var(--good)' : 'var(--bad)' }}>
          {result.found ? `${fmt(result.totalDistance, 2)} km · ${fmt(result.totalTime, 1)} min` : 'no route available'}
        </div>
      )}
    </div>
  );
}

export function bestByColumn(rows) {
  const best = {};
  for (const col of COLUMNS) {
    const vals = rows.map((r) => r[col.key]).filter((v) => v != null);
    best[col.key] = vals.length > 1 ? Math.min(...vals) : null;
  }
  return best;
}

/** One-sentence takeaway comparing Dijkstra with the unweighted baselines. */
export function insight(results, mode) {
  const d = results.Dijkstra;
  if (!d) return null;
  if (!d.found) return 'No route exists under the current road closures.';
  const others = ['BFS', 'DFS'].map((n) => results[n]).filter((r) => r?.found);
  if (others.length === 0) return null;
  const metric = mode === 'distance' ? 'totalDistance' : 'totalTime';
  const unit = mode === 'distance' ? 'km' : 'min';
  const worst = others.reduce((a, b) => (b[metric] > a[metric] ? b : a));
  const saving = worst[metric] - d[metric];
  if (saving <= 1e-6) return 'All algorithms found an equally good route on this network.';
  return `Dijkstra's route is ${saving.toFixed(1)} ${unit} (${((saving / worst[metric]) * 100).toFixed(0)}%) better than ${worst.algorithm}'s.`;
}

export default function ComparisonDashboard({
  graph,
  version,
  results, // { Dijkstra?, BFS?, DFS? } or null
  compare,
  step,
  pathProgress,
  ghostPath,
  source,
  target,
  mode,
  history,
  onRefreshHistory,
  backendOnline,
}) {
  const names = results ? ORDER.filter((n) => results[n]) : [];
  const rows = names.map((n) => results[n]);
  const best = bestByColumn(rows);
  const note = results ? insight(results, mode) : null;

  return (
    <div className="grid gap-4">
      {compare && results && (
        <div className="compare-grid">
          {names.map((name) => {
            const r = results[name];
            const replay = deriveState(r.trace, step);
            const done = step >= r.trace.length;
            return (
              <GraphCanvas
                key={name}
                compact
                title={`${name} — ${r.found ? `${fmt(r.totalTime, 1)} min` : 'no route'}`}
                graph={graph}
                version={version}
                replay={replay}
                path={done ? r.path : []}
                pathProgress={pathProgress}
                ghostPath={ghostPath}
                source={source}
                target={target}
                overlay={<StatsOverlay algorithm={name} result={r} replay={replay} done={done} />}
              />
            );
          })}
        </div>
      )}

      <section className="sheet">
        <div className="sheet-head">
          <h2>Run statistics{results ? ` · ${MODE_LABELS[mode]}` : ''}</h2>
        </div>
        {rows.length === 0 ? (
          <p className="hint">
            Run a route to fill this table. Choose “Compare all three” to watch Dijkstra, BFS, and DFS on the same network.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="stats mono">
                <thead>
                  <tr>
                    <th>Algorithm</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.algorithm}>
                      <td style={{ fontWeight: 600 }}>{r.algorithm}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className={best[c.key] != null && r[c.key] === best[c.key] ? 'best' : ''}>
                          {fmt(r[c.key], c.digits)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {note && <p className="reading">{note}</p>}
            <p className="fine">
              The marked figure in each column is the lowest. BFS minimises roads and DFS finds some route. Only Dijkstra
              minimises the chosen cost. Execution time is wall-clock for the algorithm alone.
            </p>
          </>
        )}
      </section>

      <section className="sheet">
        <div className="sheet-head">
          <h2>Past runs</h2>
          <button className="btn" onClick={onRefreshHistory} disabled={!backendOnline}>
            Refresh
          </button>
        </div>
        {!backendOnline ? (
          <p className="hint">Backend offline. Run history is stored only when the API is running.</p>
        ) : history.length === 0 ? (
          <p className="hint">No stored runs for this network yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="stats mono">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Algorithm</th>
                  <th>Route</th>
                  <th>Mode</th>
                  <th>Dist</th>
                  <th>Time</th>
                  <th>Nodes</th>
                  <th>Edges</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.createdAt).toLocaleTimeString()}</td>
                    <td>{h.algorithm}</td>
                    <td>
                      {h.source}→{h.target}
                    </td>
                    <td>{MODE_LABELS[h.mode] ?? h.mode}</td>
                    <td>{fmt(h.totalDistance, 2)}</td>
                    <td>{fmt(h.totalTime, 1)}</td>
                    <td>{h.nodesExplored}</td>
                    <td>{h.edgesChecked}</td>
                    <td>{fmt(h.executionTimeMs, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
