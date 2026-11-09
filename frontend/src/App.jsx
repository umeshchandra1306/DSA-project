/**
 * App.jsx — MODULE 3 (Nagulapati Sai Ashwin): application shell.
 *
 * Owns all state and wires the hand-written DSA (../dsa) to the UI:
 *   Run      -> BFS / DFS / Dijkstra record a trace; the trace is replayed step by step
 *   Events   -> DynamicRouter mutates the graph and re-runs Dijkstra live; the old
 *               route is ghosted and the new one is drawn progressively
 *   Backend  -> samples, saved networks, run statistics and traffic events go through
 *               the REST API (the UI still works offline using local samples)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@dsa/Graph.js';
import { bfs } from '@dsa/BFS.js';
import { dfs } from '@dsa/DFS.js';
import { dijkstra } from '@dsa/Dijkstra.js';
import { DynamicRouter } from '@dsa/DynamicRouter.js';
import { MODES, MODE_LABELS } from '@dsa/EdgeCost.js';
import { createRng } from '@dsa/Random.js';
import { SAMPLE_GRAPHS, buildSampleGraph, listSampleGraphs } from '@dsa/sampleGraphs.js';
import GraphCanvas from './components/GraphCanvas.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import ComparisonDashboard, { StatsOverlay } from './components/ComparisonDashboard.jsx';
import { deriveState, nextVisitStep, prevVisitStep } from './lib/replay.js';
import { api } from './lib/api.js';

const ALGOS = { BFS: bfs, DFS: dfs, Dijkstra: dijkstra };
const LOCAL_SAMPLES = listSampleGraphs();

const samePath = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const maxSteps = (results) => (results ? Math.max(...Object.values(results).map((r) => r.trace.length)) : 0);

function sampleNet(key, graph) {
  const s = SAMPLE_GRAPHS[key];
  return { key: `sample:${key}`, graph, name: s.name, sampleKey: key, graphId: null, dirty: false, source: s.defaultSource, target: s.defaultTarget };
}

export default function App() {
  const [net, setNet] = useState(() => sampleNet('cityGrid', buildSampleGraph('cityGrid')));
  const [version, setVersion] = useState(0);
  const [source, setSource] = useState(net.source);
  const [target, setTarget] = useState(net.target);
  const [mode, setMode] = useState(MODES.TIME);
  const [algorithm, setAlgorithm] = useState('Dijkstra');

  const [results, setResults] = useState(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [pathProgress, setPathProgress] = useState(0);
  const [ghostPath, setGhostPath] = useState([]);
  const [notice, setNotice] = useState(null); // {kind:'info'|'warn'|'bad', text}

  const [tool, setTool] = useState('select');
  const [pickNext, setPickNext] = useState('source');
  const [pendingNode, setPendingNode] = useState(null);
  const [selectedRoadId, setSelectedRoadId] = useState(null);
  const [simOn, setSimOn] = useState(false);
  const [events, setEvents] = useState([]);

  const [backendOnline, setBackendOnline] = useState(false);
  const [samples, setSamples] = useState(LOCAL_SAMPLES);
  const [savedGraphs, setSavedGraphs] = useState([]);
  const [history, setHistory] = useState([]);

  const router = useMemo(() => new DynamicRouter(net.graph), [net.graph]);
  const rafRef = useRef(0);
  const accRef = useRef(0);
  const rngRef = useRef(createRng(Date.now() % 1_000_000));
  const dragRef = useRef(null); // {roadId, oldTraffic, routeChanged} while a slider drag is in progress
  const eventIdRef = useRef(1);

  // Latest values for callbacks that outlive a render (timers, async handlers).
  const live = useRef({});
  live.current = { net, router, results, source, target, mode, backendOnline };

  const compare = algorithm === 'compare';
  const primary = compare ? 'Dijkstra' : algorithm;
  const total = maxSteps(results);
  const completed = Boolean(results) && step >= total;
  const primaryResult = results?.[primary] ?? null;

  const scope = useCallback(() => {
    const n = live.current.net;
    return n.dirty ? {} : { graphId: n.graphId ?? undefined, sampleKey: n.sampleKey ?? undefined };
  }, []);

  // ---------------------------------------------------------------- backend

  const refreshSaved = useCallback(async () => {
    try {
      setSavedGraphs(await api.listGraphs());
    } catch {
      /* keep the previous list */
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!live.current.backendOnline) return;
    try {
      setHistory(await api.listRuns({ ...scope(), limit: 30 }));
    } catch {
      setHistory([]);
    }
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.health();
        if (cancelled) return;
        setBackendOnline(true);
        live.current.backendOnline = true;
        setSamples(await api.listSamples());
        await refreshSaved();
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSaved]);

  useEffect(() => {
    refreshHistory();
  }, [net.key, backendOnline, refreshHistory]);

  // -------------------------------------------------------------- animation

  const animatePath = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 800);
      setPathProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Draw the final path when an animation finishes.
  useEffect(() => {
    if (completed) animatePath();
    else setPathProgress(0);
  }, [completed, animatePath]);

  // Playback clock: `speed` events per 25 ms tick scaled so 1x≈10 and 20x≈200 events/sec.
  useEffect(() => {
    if (!playing || !results) return undefined;
    const id = setInterval(() => {
      accRef.current += speed * 0.4;
      const advance = Math.floor(accRef.current);
      if (advance > 0) {
        accRef.current -= advance;
        setStep((s) => Math.min(total, s + advance));
      }
    }, 40);
    return () => clearInterval(id);
  }, [playing, results, speed, total]);

  useEffect(() => {
    if (playing && results && step >= total) setPlaying(false);
  }, [playing, results, step, total]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  // -------------------------------------------------------------- run / reset

  const resetRun = useCallback(() => {
    live.current.router.clearRoute();
    setResults(null);
    setStep(0);
    setPlaying(false);
    setGhostPath([]);
    setNotice(null);
  }, []);

  const handleRun = useCallback(() => {
    const { net: n, router: r, source: s, target: t, mode: m } = live.current;
    if (!s || !t) return;
    const names = algorithm === 'compare' ? ['Dijkstra', 'BFS', 'DFS'] : [algorithm];
    // Dijkstra always runs through the router so live events can re-route it.
    const dij = r.setRoute(s, t, m);
    const out = {};
    for (const name of names) out[name] = name === 'Dijkstra' ? dij : ALGOS[name](n.graph, s, t, { mode: m });
    setResults(out);
    setStep(0);
    accRef.current = 0;
    setPlaying(true);
    setGhostPath([]);
    setNotice(null);

    if (live.current.backendOnline) {
      const sc = scope();
      Promise.all(
        Object.values(out).map((res) =>
          api.saveRun({
            ...sc,
            algorithm: res.algorithm,
            mode: res.mode,
            source: res.source,
            target: res.target,
            found: res.found,
            path: res.path,
            totalDistance: res.totalDistance,
            totalTime: res.totalTime,
            totalCost: res.totalCost,
            nodesExplored: res.nodesExplored,
            edgesChecked: res.edgesChecked,
            executionTimeMs: res.executionTimeMs,
          }),
        ),
      )
        .then(refreshHistory)
        .catch(() => {});
    }
  }, [algorithm, scope, refreshHistory]);

  const handlePlayPause = () => {
    if (!results) return;
    if (playing) setPlaying(false);
    else {
      if (completed) setStep(0);
      setPlaying(true);
    }
  };
  const trace = primaryResult?.trace ?? [];
  const handleStep = () => {
    setPlaying(false);
    setStep((s) => (compare ? Math.min(total, s + 6) : nextVisitStep(trace, s)));
  };
  const handleStepBack = () => {
    setPlaying(false);
    setStep((s) => (compare ? Math.max(0, s - 6) : prevVisitStep(trace, s)));
  };
  const handleReset = () => {
    setPlaying(false);
    setStep(0);
    setGhostPath([]);
  };
  const handleEnd = () => {
    setPlaying(false);
    setStep(total);
  };

  // ------------------------------------------------------- live road events

  const persistEvent = useCallback(
    (event) => {
      const { net: n, backendOnline: online } = live.current;
      if (!online) return;
      const sc = scope();
      api.saveEvent({ ...sc, ...event }).catch(() => {});
      if (n.graphId && !n.dirty) {
        const patch = event.eventType === 'traffic' ? { trafficLevel: event.newTraffic } : { isBlocked: event.eventType === 'block' };
        api.patchRoad(n.graphId, event.roadId, patch).catch(() => {});
      }
    },
    [scope],
  );

  /** React to one or more router reports: refresh results, ghost the old route, animate the new one. */
  const afterReports = useCallback(
    (reports, { persist = true } = {}) => {
      if (reports.length === 0) return;
      const { net: n, router: r } = live.current;
      setVersion((v) => v + 1);

      const firstPrev = reports[0].previous;
      const routeChangedOverall = Boolean(firstPrev && r.active && !samePath(firstPrev.path, r.active.result.path));

      const entries = reports.map((rep) => {
        const road = n.graph.getRoad(rep.event.roadId);
        const label = road ? `${road.source}–${road.destination}` : rep.event.roadId;
        const what =
          rep.event.type === 'block'
            ? 'closed'
            : rep.event.type === 'unblock'
              ? 'reopened'
              : `×${rep.event.before.trafficLevel.toFixed(1)}→×${rep.event.after.trafficLevel.toFixed(1)}`;
        return {
          id: eventIdRef.current++,
          routeChanged: rep.routeChanged,
          text: `${rep.event.roadId} ${label} ${what}${rep.routeChanged ? ' → rerouted' : rep.routeBroken ? ' → no route' : ''}`,
        };
      });
      setEvents((prev) => [...entries.reverse(), ...prev].slice(0, 12));

      if (persist) {
        for (const rep of reports) {
          persistEvent({
            roadId: rep.event.roadId,
            eventType: rep.event.type,
            oldTraffic: rep.event.before.trafficLevel,
            newTraffic: rep.event.after.trafficLevel,
            routeChanged: rep.routeChanged,
          });
        }
      }

      const current = live.current.results;
      if (!current || !r.active) return;
      const { source: s, target: t, mode: m } = r.active;
      const next = {};
      for (const name of Object.keys(current)) {
        next[name] = name === 'Dijkstra' ? r.active.result : ALGOS[name](n.graph, s, t, { mode: m });
      }
      setResults(next);
      setStep(maxSteps(next));
      setPlaying(false);
      setGhostPath(routeChangedOverall ? firstPrev.path : []);
      animatePath();

      const now = r.active.result;
      if (firstPrev?.found && !now.found) setNotice({ kind: 'bad', text: 'Route blocked — no path exists between source and target.' });
      else if (!firstPrev?.found && now.found) setNotice({ kind: 'info', text: 'A route is available again.' });
      else if (routeChangedOverall) {
        const delta = now.totalCost - firstPrev.totalCost;
        const unit = m === MODES.DISTANCE ? 'km' : m === MODES.TIME ? 'min' : 'cost';
        setNotice({
          kind: 'warn',
          text: `Rerouted with Dijkstra: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ${unit} on the new best route (dashed amber = previous route).`,
        });
      }
    },
    [animatePath, persistEvent],
  );

  const applyRoadEvent = (event, opts) => afterReports([live.current.router.applyEvent(event)], opts);

  const selectedRoad = selectedRoadId ? net.graph.getRoad(selectedRoadId) : null;

  const handleSetTraffic = (level) => {
    if (!selectedRoad) return;
    if (!dragRef.current) dragRef.current = { roadId: selectedRoad.id, oldTraffic: selectedRoad.trafficLevel, routeChanged: false };
    const report = live.current.router.applyEvent({ type: 'traffic', roadId: selectedRoad.id, value: level });
    dragRef.current.routeChanged ||= report.routeChanged;
    afterReports([report], { persist: false });
  };
  const handleTrafficCommit = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const road = live.current.net.graph.getRoad(drag.roadId);
    if (!road || road.trafficLevel === drag.oldTraffic) return;
    persistEvent({
      roadId: road.id,
      eventType: 'traffic',
      oldTraffic: drag.oldTraffic,
      newTraffic: road.trafficLevel,
      routeChanged: drag.routeChanged,
    });
  };
  const handleToggleBlock = () => {
    if (!selectedRoad) return;
    applyRoadEvent({ type: selectedRoad.isBlocked ? 'unblock' : 'block', roadId: selectedRoad.id });
  };

  // Live traffic simulation: random congestion / closures every 2.5 s.
  useEffect(() => {
    if (!simOn) return undefined;
    const id = setInterval(() => {
      const reports = live.current.router.simulateTick(rngRef.current);
      afterReports(reports);
    }, 2500);
    return () => clearInterval(id);
  }, [simOn, afterReports]);

  // ------------------------------------------------------ network load / save

  const adoptNetwork = useCallback(
    (next) => {
      setNet(next);
      setSource(next.source ?? next.graph.nodeIds()[0] ?? null);
      setTarget(next.target ?? next.graph.nodeIds().at(-1) ?? null);
      setSelectedRoadId(null);
      setPendingNode(null);
      setSimOn(false);
      setEvents([]);
      setResults(null);
      setStep(0);
      setPlaying(false);
      setGhostPath([]);
      setNotice(null);
      setVersion((v) => v + 1);
    },
    [],
  );

  const loadSample = async (key) => {
    let graph;
    try {
      graph = Graph.fromJSON(await api.getSample(key));
    } catch {
      graph = buildSampleGraph(key);
    }
    if (graph) adoptNetwork(sampleNet(key, graph));
  };

  const loadSaved = async (id) => {
    try {
      const data = await api.getGraph(id);
      const graph = Graph.fromJSON(data);
      const ids = graph.nodeIds();
      adoptNetwork({ key: `saved:${id}`, graph, name: data.name, sampleKey: null, graphId: id, dirty: false, source: ids[0], target: ids.at(-1) });
    } catch (err) {
      setNotice({ kind: 'bad', text: `Could not load network: ${err.message}` });
    }
  };

  const saveNetwork = async (name) => {
    try {
      const saved = await api.saveGraph({ ...net.graph.toJSON(), name });
      setNet((n) => ({ ...n, key: `saved:${saved.id}`, name, graphId: saved.id, sampleKey: null, dirty: false }));
      await refreshSaved();
      setNotice({ kind: 'info', text: `Saved “${name}” to the database.` });
    } catch (err) {
      setNotice({ kind: 'bad', text: `Save failed: ${err.message}` });
    }
  };

  const saveRoute = async () => {
    try {
      await api.saveRoute({ ...scope(), name: `${source} → ${target} (${MODE_LABELS[mode]})`, source, target, mode });
      setNotice({ kind: 'info', text: 'Route saved.' });
    } catch (err) {
      setNotice({ kind: 'bad', text: `Could not save route: ${err.message}` });
    }
  };

  // --------------------------------------------------------------- map editing

  const editNetwork = (fn) => {
    try {
      fn(net.graph);
    } catch (err) {
      setNotice({ kind: 'bad', text: err.message });
      return;
    }
    router.clearRoute();
    setResults(null);
    setStep(0);
    setPlaying(false);
    setGhostPath([]);
    setSelectedRoadId((id) => (id && net.graph.getRoad(id) ? id : null));
    setNet((n) => ({ ...n, key: 'custom', dirty: true, sampleKey: null, graphId: null }));
    setVersion((v) => v + 1);
    const ids = net.graph.nodeIds();
    if (!net.graph.hasNode(source)) setSource(ids[0] ?? null);
    if (!net.graph.hasNode(target)) setTarget(ids.at(-1) ?? null);
  };

  const handleNodeClick = (id) => {
    if (tool === 'select') {
      if (pickNext === 'source') {
        setSource(id);
        setPickNext('target');
      } else {
        setTarget(id);
        setPickNext('source');
      }
      resetRun();
    } else if (tool === 'addRoad') {
      if (!pendingNode) setPendingNode(id);
      else if (pendingNode !== id) {
        const from = pendingNode;
        setPendingNode(null);
        editNetwork((g) => g.addRoad(from, id));
      }
    } else if (tool === 'delete') {
      editNetwork((g) => g.removeNode(id));
    }
  };

  const handleRoadClick = (id) => {
    if (tool === 'select') setSelectedRoadId(id);
    else if (tool === 'delete') {
      editNetwork((g) => g.removeRoad(id));
      if (selectedRoadId === id) setSelectedRoadId(null);
    }
  };

  const handleBackgroundClick = (p) => {
    if (tool === 'select') setSelectedRoadId(null);
    if (tool !== 'addNode') return;
    let n = net.graph.nodeCount + 1;
    while (net.graph.hasNode(`N${n}`)) n++;
    const id = `N${n}`;
    editNetwork((g) => g.addNode(id, { label: id, x: Math.round(p.x), y: Math.round(p.y) }));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedRoadId(null);
        setPendingNode(null);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------------ render

  const nodes = useMemo(() => [...net.graph.nodes.values()], [net.graph, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const replay = useMemo(() => (primaryResult ? deriveState(primaryResult.trace, step) : null), [primaryResult, step]);
  const primaryDone = Boolean(primaryResult) && step >= primaryResult.trace.length;

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="kicker">Graph search on a live road network</p>
          <h1 className="wordmark">Traffic Routing Optimizer</h1>
        </div>
        <p className="mast-meta">
          <span>
            Network <strong>{net.name}</strong>
          </span>
          <span>
            <strong>{net.graph.nodeCount}</strong> intersections
          </span>
          <span>
            <strong>{net.graph.roads.size}</strong> roads
          </span>
          <span className={backendOnline ? 'status-live' : 'status-local'}>
            API <strong>{backendOnline ? 'connected' : 'local'}</strong>
          </span>
        </p>
      </header>

      <div className="workspace">
        <ControlPanel
          samples={samples}
          savedGraphs={savedGraphs}
          networkName={net.name}
          currentKey={net.key}
          dirty={net.dirty}
          backendOnline={backendOnline}
          onLoadSample={loadSample}
          onLoadSaved={loadSaved}
          onSaveNetwork={saveNetwork}
          nodes={nodes}
          source={source}
          target={target}
          onSource={(v) => {
            setSource(v);
            resetRun();
          }}
          onTarget={(v) => {
            setTarget(v);
            resetRun();
          }}
          onSwap={() => {
            setSource(target);
            setTarget(source);
            resetRun();
          }}
          pickNext={pickNext}
          mode={mode}
          onMode={(v) => {
            setMode(v);
            resetRun();
          }}
          algorithm={algorithm}
          onAlgorithm={(v) => {
            setAlgorithm(v);
            resetRun();
          }}
          hasResults={Boolean(results)}
          playing={playing}
          step={step}
          maxSteps={total}
          speed={speed}
          onSpeed={setSpeed}
          onRun={handleRun}
          onPlayPause={handlePlayPause}
          onStep={handleStep}
          onStepBack={handleStepBack}
          onReset={handleReset}
          onEnd={handleEnd}
          tool={tool}
          onTool={(t) => {
            setTool(t);
            setPendingNode(null);
          }}
          selectedRoad={selectedRoad}
          onSetTraffic={handleSetTraffic}
          onTrafficCommit={handleTrafficCommit}
          onToggleBlock={handleToggleBlock}
          onClearRoad={() => setSelectedRoadId(null)}
          simOn={simOn}
          onSim={setSimOn}
          onSaveRoute={saveRoute}
          events={events}
        />

        <main className="stage">
          {notice && (
            <p role="status" className={`notice notice-${notice.kind}`}>
              {notice.text}
            </p>
          )}

          <GraphCanvas
            graph={net.graph}
            version={version}
            replay={replay}
            path={primaryDone && primaryResult ? primaryResult.path : []}
            pathProgress={pathProgress}
            ghostPath={ghostPath}
            source={source}
            target={target}
            selectedRoadId={selectedRoadId}
            onNodeClick={handleNodeClick}
            onRoadClick={handleRoadClick}
            onBackgroundClick={handleBackgroundClick}
            showLegend
            cursor={tool === 'addNode' ? 'crosshair' : 'default'}
            overlay={
              primaryResult ? (
                <StatsOverlay algorithm={primary} result={primaryResult} replay={replay} done={primaryDone} />
              ) : pendingNode ? (
                <div className="chip mono">
                  Road from {pendingNode}. Click the second intersection. Esc cancels.
                </div>
              ) : null
            }
          />

          <ComparisonDashboard
            graph={net.graph}
            version={version}
            results={results}
            compare={compare}
            step={step}
            pathProgress={pathProgress}
            ghostPath={ghostPath}
            source={source}
            target={target}
            mode={mode}
            history={history}
            onRefreshHistory={refreshHistory}
            backendOnline={backendOnline}
          />
        </main>
      </div>
    </div>
  );
}
