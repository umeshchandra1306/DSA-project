/**
 * GraphCanvas.jsx — MODULE 3 (Nagulapati Sai Ashwin): HTML5 canvas road-network
 * renderer and algorithm visualiser.
 *
 * Visual states
 *   node  : unvisited (slate) · frontier/exploring (amber) · visited (blue) ·
 *           on final path (green) · source (green ring) · target (pink ring)
 *   road  : free-flow (slate) · congested (amber -> red, width grows, ×level label) ·
 *           blocked (red dashed with ✕) · exploration tree (blue) ·
 *           final path (green, drawn progressively) · previous route (amber dashed)
 *
 * The component is purely presentational: the parent owns all state and passes
 * in what to draw. `version` must change whenever the (mutable) Graph object is
 * edited so the canvas repaints.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pairKey } from '../lib/replay.js';

const WORLD = { w: 1000, h: 640 };

const C = {
  bg: '#e8e3da',
  grid: '#d4cdc2',
  road: '#8a8176',
  warn: '#a16207',
  hot: '#9f2d2d',
  tree: '#3d5a80',
  path: '#1e6b45',
  ghost: '#8a5a12',
  nodeIdle: '#f7f4ee',
  nodeIdleStroke: '#5c564e',
  frontier: '#8a5a12',
  visited: '#2c4a6e',
  source: '#1e6b45',
  target: '#9f3d24',
  label: '#2a2622',
  paper: '#fbfaf7',
  ink: '#1c1915',
};

const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [a, b] = [p(c1), p(c2)];
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}
/** traffic multiplier 1..3 -> colour slate -> amber -> red */
function trafficColor(level) {
  const t = Math.min(1, Math.max(0, (level - 1) / 2));
  return t < 0.5 ? mix(C.road, C.warn, t * 2) : mix(C.warn, C.hot, (t - 0.5) * 2);
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Points of the polyline for a node path, truncated to `progress` (0..1) of its length. */
function partialPolyline(graph, path, progress) {
  const pts = path.map((id) => graph.getNode(id)).filter(Boolean);
  if (pts.length < 2 || progress <= 0) return [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let remaining = total * Math.min(1, progress);
  const out = [pts[0]];
  for (let i = 1; i < pts.length && remaining > 0; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (seg <= remaining) {
      out.push(pts[i]);
      remaining -= seg;
    } else {
      const t = remaining / seg;
      out.push({ x: lerp(pts[i - 1].x, pts[i].x, t), y: lerp(pts[i - 1].y, pts[i].y, t) });
      remaining = 0;
    }
  }
  return out;
}

export default function GraphCanvas({
  graph,
  version = 0,
  replay = null, // output of deriveState(), or null for a plain map
  path = [],
  pathProgress = 1,
  ghostPath = [],
  source = null,
  target = null,
  selectedRoadId = null,
  onNodeClick,
  onRoadClick,
  onBackgroundClick,
  compact = false,
  title = null,
  overlay = null,
  showLegend = false,
  cursor = 'default',
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState(null); // {type:'road'|'node', id}

  // Track the rendered size (the box keeps the world's aspect ratio).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pathSet = useMemo(() => new Set(path), [path]);

  // ------------------------------------------------------------------ paint
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    const k = (size.w / WORLD.w) * dpr; // world -> device pixels
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // background + faint dot grid
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.fillStyle = C.grid;
    for (let x = 25; x < WORLD.w; x += 50) for (let y = 25; y < WORLD.h; y += 50) ctx.fillRect(x - 1, y - 1, 2, 2);

    const nodeR = compact ? 10 : 14;
    const fontPx = compact ? 12 : 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // roads
    for (const road of graph.roads.values()) {
      const a = graph.getNode(road.source);
      const b = graph.getNode(road.destination);
      if (!a || !b) continue;
      const key = pairKey(road.source, road.destination);
      const t = (road.trafficLevel - 1) / 2;

      if (road.id === selectedRoadId) {
        ctx.strokeStyle = 'rgba(28, 25, 21, 0.18)';
        ctx.lineWidth = 14;
        line(ctx, a, b);
      }
      if (road.isBlocked) {
        ctx.strokeStyle = C.hot;
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        line(ctx, a, b);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = trafficColor(road.trafficLevel);
        ctx.lineWidth = 3.5 + t * 5;
        line(ctx, a, b);
      }
      if (replay?.treeEdges.has(key) && !road.isBlocked) {
        ctx.strokeStyle = C.tree;
        ctx.lineWidth = 4.5;
        line(ctx, a, b);
      }
    }

    // edge currently being examined
    if (replay?.lastEdge) {
      const a = graph.getNode(replay.lastEdge.from);
      const b = graph.getNode(replay.lastEdge.to);
      if (a && b) {
        ctx.strokeStyle = replay.lastEdge.blocked ? C.hot : '#c4841d';
        ctx.lineWidth = 3;
        line(ctx, a, b);
      }
    }

    // previous route (before a live re-route)
    if (ghostPath.length > 1) {
      ctx.strokeStyle = C.ghost;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 5;
      ctx.setLineDash([4, 9]);
      const pts = ghostPath.map((id) => graph.getNode(id)).filter(Boolean);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // final path, drawn progressively with a paper casing so it reads on the map
    const poly = partialPolyline(graph, path, pathProgress);
    if (poly.length > 1) {
      strokePoly(ctx, poly, C.paper, 11);
      strokePoly(ctx, poly, C.path, 5);
    }

    // congestion + blockage badges
    if (!compact) {
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const road of graph.roads.values()) {
        const a = graph.getNode(road.source);
        const b = graph.getNode(road.destination);
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (road.isBlocked) {
          ctx.fillStyle = '#f6ece8';
          ctx.strokeStyle = C.hot;
          ctx.lineWidth = 1.5;
          roundRect(ctx, mx - 10, my - 10, 20, 20, 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = C.hot;
          ctx.fillText('✕', mx, my + 1);
        } else if (road.trafficLevel > 1.05) {
          const txt = `×${road.trafficLevel.toFixed(1)}`;
          const w = ctx.measureText(txt).width + 10;
          ctx.fillStyle = C.paper;
          ctx.strokeStyle = trafficColor(road.trafficLevel);
          ctx.lineWidth = 1.5;
          roundRect(ctx, mx - w / 2, my - 9, w, 18, 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.fillText(txt, mx, my + 1);
        }
      }
    }

    // nodes
    ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const node of graph.nodes.values()) {
      const state = replay?.nodeState.get(node.id);
      const onPath = pathSet.has(node.id) && pathProgress >= 1;
      let fill = C.nodeIdle;
      let stroke = C.nodeIdleStroke;
      if (state === 'frontier') {
        fill = '#f3e2c4';
        stroke = C.frontier;
      } else if (state === 'visited') {
        fill = '#d5e0ec';
        stroke = C.visited;
      }
      if (onPath) {
        fill = '#d7ebe1';
        stroke = C.path;
      }

      if (node.id === source || node.id === target) {
        ctx.strokeStyle = node.id === source ? C.source : C.target;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeR + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (replay?.current === node.id) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeR + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (node.id === source || node.id === target) {
        ctx.fillStyle = C.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText(node.id === source ? 'S' : 'T', node.x, node.y + 1);
        ctx.textBaseline = 'top';
      }
      ctx.fillStyle = C.label;
      ctx.fillText(node.label, node.x, node.y + nodeR + (node.id === source || node.id === target ? 8 : 4));
    }
  }, [graph, version, size, replay, path, pathProgress, ghostPath, source, target, selectedRoadId, compact, pathSet]);

  // ------------------------------------------------------------ interaction
  const toWorld = useCallback(
    (evt) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const s = WORLD.w / rect.width;
      return { x: (evt.clientX - rect.left) * s, y: (evt.clientY - rect.top) * s };
    },
    [],
  );

  const hitTest = useCallback(
    (p) => {
      const nodeR = compact ? 10 : 14;
      for (const node of graph.nodes.values()) {
        if (Math.hypot(node.x - p.x, node.y - p.y) <= nodeR + 6) return { type: 'node', id: node.id };
      }
      let best = null;
      let bestD = 10;
      for (const road of graph.roads.values()) {
        const a = graph.getNode(road.source);
        const b = graph.getNode(road.destination);
        const d = distToSegment(p.x, p.y, a, b);
        if (d < bestD) {
          bestD = d;
          best = { type: 'road', id: road.id };
        }
      }
      return best;
    },
    [graph, compact],
  );

  const interactive = Boolean(onNodeClick || onRoadClick || onBackgroundClick);

  const handleClick = (evt) => {
    if (!interactive) return;
    const p = toWorld(evt);
    const hit = hitTest(p);
    if (hit?.type === 'node') onNodeClick?.(hit.id, p);
    else if (hit?.type === 'road') onRoadClick?.(hit.id, p);
    else onBackgroundClick?.(p);
  };

  const handleMove = (evt) => {
    if (compact) return;
    const hit = hitTest(toWorld(evt));
    setHover((prev) => (prev?.id === hit?.id && prev?.type === hit?.type ? prev : hit));
  };

  const hoverRoad = hover?.type === 'road' ? graph.getRoad(hover.id) : null;
  const hoverNode = hover?.type === 'node' ? graph.getNode(hover.id) : null;

  return (
    <div className="map-frame">
      {title && (
        <div className="map-caption">
          <span>{title}</span>
        </div>
      )}
      <div ref={wrapRef} className="relative w-full" style={{ aspectRatio: `${WORLD.w} / ${WORLD.h}` }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: hover && interactive ? 'pointer' : cursor }}
          onClick={handleClick}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Road network ${graph.name}`}
        />
        {overlay && <div className="absolute left-2 top-2 pointer-events-none">{overlay}</div>}

        {!compact && (hoverRoad || hoverNode) && (
          <div className="chip readout mono absolute left-2 bottom-2 pointer-events-none">
            {hoverRoad
              ? `${hoverRoad.id} · ${hoverRoad.source}${hoverRoad.bidirectional ? '↔' : '→'}${hoverRoad.destination} · ${hoverRoad.distance} km · base ${hoverRoad.baseTravelTime} min · ×${hoverRoad.trafficLevel.toFixed(1)}${hoverRoad.isBlocked ? ' · blocked' : ''}`
              : `${hoverNode.label} (${hoverNode.id}) · ${graph.getNeighbors(hoverNode.id).length} outgoing roads`}
          </div>
        )}

        {showLegend && !compact && (
          <div className="chip map-key absolute right-2 bottom-2 pointer-events-none">
            {[
              ['Unvisited', C.nodeIdleStroke],
              ['Frontier', C.frontier],
              ['Visited', C.visited],
              ['Final path', C.path],
              ['Congested', C.warn],
              ['Blocked', C.hot],
            ].map(([label, color]) => (
              <span key={label}>
                <span className="key-swatch" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function strokePoly(ctx, pts, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
