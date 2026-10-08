const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(lng1, lat1, lng2, lat2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function bearing(lng1, lat1, lng2, lat2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// signed shortest rotation in degrees from one bearing to another
export const shortestTurn = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

// driveCoords is { [routeSecond]: [lng, lat] }
export function buildTrack(driveCoords) {
  const ts = Object.keys(driveCoords || {}).map(Number).sort((a, b) => a - b);
  const coords = ts.map((t) => driveCoords[t]);
  const dist = [];
  let total = 0;
  coords.forEach(([lng, lat], i) => {
    if (i > 0) total += haversine(coords[i - 1][0], coords[i - 1][1], lng, lat);
    dist.push(total);
  });
  return { ts, coords, dist, total };
}

// index of the last sample at or before `sec`, clamped to the track
function indexAt(ts, sec) {
  let lo = 0;
  let hi = ts.length - 1;
  if (sec <= ts[0]) return 0;
  if (sec >= ts[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= sec) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const SMOOTH_WINDOW_S = 2;
const MIN_HEADING_MOVE_M = 3;

export function sampleTrack(track, offsetMs) {
  const { ts, coords, dist } = track;
  if (!ts.length) return null;
  const sec = offsetMs / 1000;
  const i = indexAt(ts, sec);
  const j = Math.min(i + 1, ts.length - 1);
  const span = ts[j] - ts[i];
  const f = span > 0 ? Math.max(0, Math.min(1, (sec - ts[i]) / span)) : 0;

  // speed and heading are measured over a short window to hide GPS jitter
  const a = indexAt(ts, sec - SMOOTH_WINDOW_S);
  const b = indexAt(ts, sec + SMOOTH_WINDOW_S);
  const dt = ts[b] - ts[a];
  const moved = dist[b] - dist[a];

  return {
    index: i,
    lng: coords[i][0] + (coords[j][0] - coords[i][0]) * f,
    lat: coords[i][1] + (coords[j][1] - coords[i][1]) * f,
    dist: dist[i] + (dist[j] - dist[i]) * f,
    speed: dt > 0 ? moved / dt : 0,
    heading: moved > MIN_HEADING_MOVE_M ? bearing(coords[a][0], coords[a][1], coords[b][0], coords[b][1]) : null,
  };
}

// nearest track sample to a screen point; `project` maps [lng, lat] to {x, y}
export function nearestIndex(track, project, point) {
  let index = -1;
  let best = Infinity;
  track.coords.forEach((c, i) => {
    const p = project(c);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return { index, px: Math.sqrt(best) };
}

export function engagedIntervals(events) {
  const spans = (events || [])
    .filter((ev) => ev.type === 'engage' && ev.data?.end_route_offset_millis !== undefined)
    .map((ev) => [ev.route_offset_millis, ev.data.end_route_offset_millis])
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  spans.forEach(([s, e]) => {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  });
  return merged;
}

export const inIntervals = (intervals, t) => intervals.some(([s, e]) => t >= s && t < e);
export const intervalsTotal = (intervals) => intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
