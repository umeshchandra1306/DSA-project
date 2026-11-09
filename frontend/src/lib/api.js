/**
 * api.js — thin fetch wrapper around the Express REST API. Every call rejects
 * with an Error on failure, so callers can fall back to local data when the
 * backend is offline.
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body (e.g. a dev-proxy failure page) */
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const scope = ({ graphId, sampleKey }) => {
  const q = new URLSearchParams();
  if (graphId) q.set('graphId', graphId);
  if (sampleKey) q.set('sampleKey', sampleKey);
  return q.toString();
};

export const api = {
  health: () => request('GET', '/health'),
  listSamples: () => request('GET', '/graphs/samples'),
  getSample: (key) => request('GET', `/graphs/samples/${encodeURIComponent(key)}`),
  listGraphs: () => request('GET', '/graphs'),
  getGraph: (id) => request('GET', `/graphs/${id}`),
  saveGraph: (graph) => request('POST', '/graphs', graph),
  deleteGraph: (id) => request('DELETE', `/graphs/${id}`),
  patchRoad: (graphId, roadId, patch) => request('PATCH', `/graphs/${graphId}/roads/${encodeURIComponent(roadId)}`, patch),
  saveRun: (run) => request('POST', '/runs', run),
  listRuns: (sc) => request('GET', `/runs?${scope(sc)}`),
  saveEvent: (event) => request('POST', '/events', event),
  saveRoute: (route) => request('POST', '/routes', route),
  listRoutes: (sc) => request('GET', `/routes?${scope(sc)}`),
  deleteRoute: (id) => request('DELETE', `/routes/${id}`),
};
