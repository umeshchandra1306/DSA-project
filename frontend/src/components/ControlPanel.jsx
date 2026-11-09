/**
 * ControlPanel.jsx — MODULE 3 (Nagulapati Sai Ashwin): left-hand controls.
 *
 * Sections: network · route (source/target/mode/algorithm) · playback
 * (run/play/pause/step/speed) · map tools · selected road (live traffic &
 * blockage editing) · traffic simulation · event log.
 */

import { useState } from 'react';
import { MODES, MODE_LABELS, MIN_TRAFFIC, MAX_TRAFFIC } from '@dsa/EdgeCost.js';

const ALGORITHM_OPTIONS = [
  ['Dijkstra', 'Dijkstra, weighted'],
  ['BFS', 'BFS, fewest roads'],
  ['DFS', 'DFS, depth-first'],
  ['compare', 'Compare all three'],
];

const TOOLS = [
  ['select', 'Select', 'Click nodes to set source and target. Click a road to edit it.'],
  ['addNode', 'Add node', 'Click empty space to place an intersection.'],
  ['addRoad', 'Add road', 'Click two intersections to connect them.'],
  ['delete', 'Delete', 'Click a node or road to remove it.'],
];

function Section({ title, children }) {
  return (
    <section className="panel-section">
      <h2>{title}</h2>
      <div className="panel-section-body">{children}</div>
    </section>
  );
}

function Label({ text, children }) {
  return (
    <label className="label">
      {text}
      {children}
    </label>
  );
}

export default function ControlPanel({
  samples,
  savedGraphs,
  networkName,
  currentKey,
  dirty,
  backendOnline,
  onLoadSample,
  onLoadSaved,
  onSaveNetwork,
  nodes,
  source,
  target,
  onSource,
  onTarget,
  onSwap,
  pickNext,
  mode,
  onMode,
  algorithm,
  onAlgorithm,
  hasResults,
  playing,
  step,
  maxSteps,
  speed,
  onSpeed,
  onRun,
  onPlayPause,
  onStep,
  onStepBack,
  onReset,
  onEnd,
  tool,
  onTool,
  selectedRoad,
  onSetTraffic,
  onTrafficCommit,
  onToggleBlock,
  onClearRoad,
  simOn,
  onSim,
  onSaveRoute,
  events,
}) {
  const [saveName, setSaveName] = useState('');
  const progress = maxSteps ? Math.min(100, (step / maxSteps) * 100) : 0;

  return (
    <aside className="rail" aria-label="Controls">
      <Section title="Network">
        <Label text="Load">
          <select
            className="field"
            value={currentKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('sample:')) onLoadSample(v.slice(7));
              else if (v.startsWith('saved:')) onLoadSaved(Number(v.slice(6)));
            }}
          >
            {currentKey === 'custom' && <option value="custom">{networkName} (unsaved)</option>}
            <optgroup label="Built-in samples">
              {samples.map((s) => (
                <option key={s.key} value={`sample:${s.key}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            {savedGraphs.length > 0 && (
              <optgroup label="Saved networks">
                {savedGraphs.map((g) => (
                  <option key={g.id} value={`saved:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Label>
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Name this network"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            aria-label="Network name"
          />
          <button
            className="btn"
            disabled={!backendOnline || !saveName.trim()}
            onClick={() => {
              onSaveNetwork(saveName.trim());
              setSaveName('');
            }}
            title={backendOnline ? 'Save this network to the database' : 'Backend offline'}
          >
            Save
          </button>
        </div>
        <p className="hint">
          {backendOnline ? 'Backend connected.' : 'Backend offline. Samples run locally, and saving is disabled.'}
          {dirty ? ' This network has unsaved edits.' : ''}
        </p>
      </Section>

      <Section title="Route">
        <div className="grid grid-cols-2 gap-2">
          <Label text="Source">
            <select className="field" value={source ?? ''} onChange={(e) => onSource(e.target.value)}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Target">
            <select className="field" value={target ?? ''} onChange={(e) => onTarget(e.target.value)}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Label>
        </div>
        <button className="btn" onClick={onSwap} title="Swap source and target" aria-label="Swap source and target">
          Swap source and target
        </button>
        <p className="hint">
          Or click the map. The next click sets the <b>{pickNext}</b>.
        </p>
        <div>
          <p className="hint" style={{ marginBottom: 6 }}>
            Optimise for
          </p>
          <div className="choice" role="group" aria-label="Optimise for">
            {Object.values(MODES).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="hint" style={{ marginBottom: 6 }}>
            Algorithm
          </p>
          <div className="choice" role="group" aria-label="Algorithm">
            {ALGORITHM_OPTIONS.map(([v, l]) => (
              <button key={v} type="button" aria-pressed={algorithm === v} onClick={() => onAlgorithm(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Playback">
        <button className="btn btn-primary" onClick={onRun} disabled={!source || !target}>
          Run route
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={onPlayPause} disabled={!hasResults}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn" onClick={onReset} disabled={!hasResults}>
            Reset
          </button>
          <button className="btn" onClick={onStepBack} disabled={!hasResults || step <= 0}>
            Step back
          </button>
          <button className="btn" onClick={onStep} disabled={!hasResults || step >= maxSteps}>
            Step
          </button>
          <button className="btn col-span-2" onClick={onEnd} disabled={!hasResults || step >= maxSteps}>
            Skip to result
          </button>
        </div>
        <Label text={`Speed, ${speed}×`}>
          <input type="range" min="1" max="20" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} />
        </Label>
        {hasResults && (
          <div className="meter" aria-hidden>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </Section>

      <Section title="Map tools">
        <div className="tools" role="group" aria-label="Map tools">
          {TOOLS.map(([id, label, hint]) => (
            <button key={id} type="button" aria-pressed={tool === id} onClick={() => onTool(id)} title={hint}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">{TOOLS.find((t) => t[0] === tool)?.[2]}</p>
      </Section>

      <Section title="Selected road">
        {selectedRoad ? (
          <>
            <p className="road-meta">
              {selectedRoad.id} · {selectedRoad.source} {selectedRoad.bidirectional ? '↔' : '→'} {selectedRoad.destination}
              <br />
              {selectedRoad.distance} km · base {selectedRoad.baseTravelTime} min
            </p>
            <Label text={`Traffic ×${selectedRoad.trafficLevel.toFixed(1)}`}>
              <input
                type="range"
                min={MIN_TRAFFIC}
                max={MAX_TRAFFIC}
                step="0.1"
                value={selectedRoad.trafficLevel}
                onChange={(e) => onSetTraffic(Number(e.target.value))}
                onPointerUp={onTrafficCommit}
                onKeyUp={onTrafficCommit}
                disabled={selectedRoad.isBlocked}
              />
            </Label>
            <div className="flex gap-2">
              <button className={`btn flex-1 ${selectedRoad.isBlocked ? '' : 'btn-danger'}`} onClick={onToggleBlock}>
                {selectedRoad.isBlocked ? 'Reopen road' : 'Block road'}
              </button>
              <button className="btn" onClick={onClearRoad} aria-label="Deselect road">
                Clear
              </button>
            </div>
            <p className="hint">Changes re-route the active path live with Dijkstra.</p>
          </>
        ) : (
          <p className="hint">Click a road on the map to change its traffic or close it.</p>
        )}
      </Section>

      <Section title="Traffic simulation">
        <button className={`btn ${simOn ? 'btn-active' : ''}`} onClick={() => onSim(!simOn)}>
          {simOn ? 'Stop live traffic' : 'Start live traffic'}
        </button>
        <p className="hint">Congests, closes, and reopens roads every few seconds. The route adapts each time.</p>
        <button className="btn" onClick={onSaveRoute} disabled={!backendOnline || !source || !target}>
          Save this route
        </button>
      </Section>

      <Section title="Event log">
        {events.length === 0 ? (
          <p className="hint">No traffic events yet.</p>
        ) : (
          <ul className="log">
            {events.map((e) => (
              <li key={e.id} className={e.routeChanged ? 'is-shift' : undefined}>
                {e.text}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
