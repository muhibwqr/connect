import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { connect } from 'react-redux';
import mapboxgl from 'mapbox-gl';

import { fetchDriveCoords } from '../../actions/cached';
import { CloseBold } from '../../icons';
import { currentOffset } from '../../timeline';
import { seek } from '../../timeline/playback';
import { DEFAULT_LOCATION, MAPBOX_STYLE, MAPBOX_TOKEN } from '../../utils/geocode';
import {
  buildTrack, engagedIntervals, inIntervals, intervalsTotal, nearestIndex, sampleTrack, shortestTurn,
} from '../../utils/track';
import { EMPTY_FC, addRouteLayers, carPoint, lineOf, setSourceData } from '../DriveMap/mapLayers';
import { STATS, resetHud, setHud, setHudUi, useHud, useHudUi } from './store';
import './hud.css';

const MARGIN = 12;
const GAP = 8;
const SEEK_PICK_PX = 28;
const EXPAND_MS = 450;
const BEARING_EASE = 0.15;
const COMPACT_WIDTH = 520;
const MPS_TO = { mph: 2.23694, kmh: 3.6 };
const M_PER = { mph: 1609.344, kmh: 1000 };
const SPEED_UNIT = { mph: 'mph', kmh: 'km/h' };
const DIST_UNIT = { mph: 'mi', kmh: 'km' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// positions are stored as fractions of the free space, so widgets stay inside on resize
const place = (pos, w, h, W, H) => ({
  left: MARGIN + clamp(pos.x, 0, 1) * Math.max(0, W - w - 2 * MARGIN),
  top: MARGIN + clamp(pos.y, 0, 1) * Math.max(0, H - h - 2 * MARGIN),
});

const toPos = (left, top, w, h, W, H) => {
  const fw = W - w - 2 * MARGIN;
  const fh = H - h - 2 * MARGIN;
  return {
    x: fw > 0 ? clamp((left - MARGIN) / fw, 0, 1) : 0,
    y: fh > 0 ? clamp((top - MARGIN) / fh, 0, 1) : 0,
  };
};

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const countUpTo = (sorted, t) => {
  let n = 0;
  while (n < sorted.length && sorted[n] <= t) n += 1;
  return n;
};

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const STAT_ICONS = {
  speed: <Icon><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4.5-5" /></Icon>,
  distance: <Icon><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></Icon>,
  remaining: <Icon><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></Icon>,
  engaged: <Icon><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M4.5 10.5h5.5M14 10.5h5.5M12 14v6" /></Icon>,
  alerts: <Icon><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></Icon>,
};

const Minimap = ({ track, hud, box, expanded, editing, onExpand, onSeek, children }) => {
  const containerRef = useRef(null);
  const ringRef = useRef(null);
  const mapRef = useRef(null);
  const loadedRef = useRef(false);
  const frame = useRef({ index: -1, heading: 0, bearing: 0, w: 0, h: 0 });
  const live = useRef({});
  live.current = { track, hud, expanded, onSeek };

  const drawRoute = (map, t) => {
    setSourceData(map, 'route', lineOf(t ? t.coords : []));
    setSourceData(map, 'routeDone', lineOf([]));
    setSourceData(map, 'car', EMPTY_FC);
    frame.current.index = -1;
    frame.current.cam = null;
  };

  useEffect(() => {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: [DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.latitude],
      zoom: live.current.hud.mapZoom,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      boxZoom: false,
      keyboard: false,
      dragPan: false,
      scrollZoom: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
    });
    map.on('load', () => {
      addRouteLayers(map, { dashed: true });
      loadedRef.current = true;
      drawRoute(map, live.current.track);
    });
    // in the big map, clicking the route jumps the video to that moment
    map.on('click', (ev) => {
      const { track: t, expanded: ex, onSeek: seekTo } = live.current;
      if (!ex || !t || !t.ts.length) return;
      const hit = nearestIndex(t, (c) => map.project(c), ev.point);
      if (hit.index >= 0 && hit.px <= SEEK_PICK_PX) seekTo(t.ts[hit.index] * 1000);
    });
    mapRef.current = map;
    return () => {
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (mapRef.current && loadedRef.current) drawRoute(mapRef.current, track);
  }, [track]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    [map.dragPan, map.scrollZoom, map.doubleClickZoom, map.touchZoomRotate]
      .forEach((handler) => (expanded ? handler.enable() : handler.disable()));
    if (expanded) map.touchZoomRotate.disableRotation();
    frame.current.cam = null;
    if (!expanded) return undefined;

    const id = setTimeout(() => {
      const t = live.current.track;
      if (!t || !t.coords.length) return;
      map.resize();
      const bounds = t.coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(t.coords[0], t.coords[0]));
      map.jumpTo({ bearing: 0 });
      map.fitBounds(bounds, { padding: 56, duration: 600 });
    }, EXPAND_MS);
    return () => clearTimeout(id);
  }, [expanded]);

  useEffect(() => {
    let raf;
    const f = frame.current;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const map = mapRef.current;
      const el = containerRef.current;
      if (!map || !el) return;
      if (el.clientWidth !== f.w || el.clientHeight !== f.h) {
        f.w = el.clientWidth;
        f.h = el.clientHeight;
        map.resize();
      }
      const { track: t, hud: h, expanded: ex } = live.current;
      if (loadedRef.current && t && t.ts.length) {
        const s = sampleTrack(t, currentOffset());
        if (s.heading !== null) f.heading = s.heading;
        const pos = [s.lng, s.lat];
        if (pos[0] !== f.lng || pos[1] !== f.lat || f.heading !== f.drawnHeading) {
          [f.lng, f.lat] = pos;
          f.drawnHeading = f.heading;
          setSourceData(map, 'car', carPoint(pos, f.heading));
        }
        if (s.index !== f.index) {
          f.index = s.index;
          setSourceData(map, 'routeDone', lineOf([...t.coords.slice(0, s.index + 1), pos]));
        }
        if (!ex) {
          const turn = shortestTurn(f.bearing, h.rotate ? f.heading : 0);
          f.bearing = Math.abs(turn) < 0.3 ? f.bearing + turn : f.bearing + turn * BEARING_EASE;
          const cam = `${pos[0]},${pos[1]},${f.bearing.toFixed(2)},${h.mapZoom}`;
          if (cam !== f.cam) {
            f.cam = cam;
            map.jumpTo({ center: pos, bearing: f.bearing, zoom: h.mapZoom });
          }
        }
      }
      if (ringRef.current) ringRef.current.style.transform = `rotate(${-map.getBearing()}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const collapsed = !expanded;
  return (
    <div
      className={`hud-minimap ${collapsed && hud.shape === 'circle' ? 'is-circle' : ''} ${expanded ? 'is-expanded' : ''}`}
      style={box}
      onClick={() => collapsed && !editing && onExpand()}
      onKeyDown={(ev) => collapsed && ev.key === 'Enter' && onExpand()}
      role={collapsed ? 'button' : undefined}
      tabIndex={collapsed ? 0 : -1}
      aria-label={collapsed ? 'Expand map' : undefined}
    >
      <div ref={containerRef} className="w-full h-full" />
      <div className="hud-vignette" />
      <div ref={ringRef} className="hud-compass"><span>N</span></div>
      {(!track || !track.ts.length) && <div className="hud-nogps fn-text">No GPS</div>}
      {children}
    </div>
  );
};

const StatsWidget = forwardRef(({ track, route, range, hud, style }, ref) => {
  const valueRefs = useRef({});
  const engagedRowRef = useRef(null);
  const intervals = useMemo(() => engagedIntervals(route?.events), [route?.events]);
  const alerts = useMemo(() => (route?.events || [])
    .filter((ev) => ev.type === 'alert')
    .map((ev) => ev.route_offset_millis)
    .sort((a, b) => a - b), [route?.events]);
  const engagedPct = route?.duration && route?.events
    ? Math.round((intervalsTotal(intervals) / route.duration) * 100)
    : null;

  const live = useRef({});
  live.current = { track, range, hud, intervals, alerts };

  useEffect(() => {
    let raf;
    const set = (key, text) => {
      const el = valueRefs.current[key];
      if (el && el.textContent !== text) el.textContent = text;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { track: t, range: r, hud: h, intervals: iv, alerts: al } = live.current;
      const offset = currentOffset();
      const s = t && t.ts.length ? sampleTrack(t, offset) : null;
      set('speed', s ? String(Math.round(s.speed * MPS_TO[h.units])) : '--');
      set('distance', s ? (s.dist / M_PER[h.units]).toFixed(1) : '--');
      set('remaining', r ? formatDuration(r.end - offset) : '--');
      const engaged = inIntervals(iv, offset);
      set('engaged', engaged ? 'On' : 'Off');
      engagedRowRef.current?.classList.toggle('is-on', engaged);
      set('alerts', String(countUpTo(al, offset)));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const units = {
    speed: SPEED_UNIT[hud.units],
    distance: track?.total ? `/ ${(track.total / M_PER[hud.units]).toFixed(1)} ${DIST_UNIT[hud.units]}` : DIST_UNIT[hud.units],
    remaining: 'left',
    engaged: engagedPct !== null ? `${engagedPct}% of drive` : 'openpilot',
    alerts: 'alerts',
  };

  return (
    <div ref={ref} className="hud-stats" style={style}>
      {STATS.filter((s) => hud.stats[s.key]).map((s) => (
        <div key={s.key} ref={s.key === 'engaged' ? engagedRowRef : undefined} className="hud-stat">
          <span className="hud-stat-icon">{STAT_ICONS[s.key]}</span>
          <span ref={(el) => { valueRefs.current[s.key] = el; }} className="hud-stat-value fn-text">--</span>
          <span className="hud-stat-unit fn-text">{units[s.key]}</span>
        </div>
      ))}
    </div>
  );
});

const Switch = ({ label, checked, onChange }) => (
  <div className="hud-row">
    <span>{label}</span>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`hud-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  </div>
);

const Segmented = ({ label, value, options, onChange }) => (
  <div className="hud-row">
    <span>{label}</span>
    <div className="hud-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  </div>
);

const Slider = ({ label, value, min, max, step, format, onChange }) => (
  <div className="hud-row">
    <span>{label}</span>
    <span className="flex items-center gap-2">
      <input type="range" className="hud-range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(ev) => onChange(Number(ev.target.value))} />
      <span className="w-9 text-right tabular-nums text-white/70">{format(value)}</span>
    </span>
  </div>
);

const pct = (v) => `${Math.round(v * 100)}%`;

const SettingsPanel = ({ hud }) => (
  <div className="hud-panel" role="dialog" aria-label="HUD settings">
    <div className="flex items-center justify-between">
      <span className="fn-text text-lg">HUD</span>
      <button type="button" className="glass-btn w-8 h-8 rounded-full flex items-center justify-center" aria-label="Close HUD settings" onClick={() => setHudUi({ panel: false })}>
        <CloseBold className="w-4 h-4" />
      </button>
    </div>

    <div className="hud-section-title fn-text">Minimap</div>
    <Switch label="Show minimap" checked={hud.minimap} onChange={(v) => setHud({ minimap: v })} />
    <Segmented label="Shape" value={hud.shape} options={[['circle', 'Circle'], ['square', 'Square']]} onChange={(v) => setHud({ shape: v })} />
    <Slider label="Size" value={hud.mapSize} min={0.2} max={0.8} step={0.01} format={pct} onChange={(v) => setHud({ mapSize: v })} />
    <Slider label="Zoom" value={hud.mapZoom} min={11} max={18} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => setHud({ mapZoom: v })} />
    <Switch label="Lock on (rotate with car)" checked={hud.rotate} onChange={(v) => setHud({ rotate: v })} />

    <div className="hud-section-title fn-text">Stats</div>
    <div className="flex flex-wrap gap-1.5 py-1">
      {STATS.map((s) => (
        <button
          key={s.key}
          type="button"
          aria-pressed={hud.stats[s.key]}
          className={`hud-chip ${hud.stats[s.key] ? 'is-on' : ''}`}
          onClick={() => setHud((prev) => ({ stats: { ...prev.stats, [s.key]: !prev.stats[s.key] } }))}
        >
          {s.label}
        </button>
      ))}
    </div>
    <Segmented label="Units" value={hud.units} options={[['mph', 'mph'], ['kmh', 'km/h']]} onChange={(v) => setHud({ units: v })} />
    <Slider label="Size" value={hud.statsScale} min={0.6} max={1.6} step={0.05} format={pct} onChange={(v) => setHud({ statsScale: v })} />

    <div className="flex gap-2 mt-3">
      <button type="button" className="hud-btn is-primary flex-1" onClick={() => setHudUi({ panel: false, editing: true })}>Edit layout</button>
      <button type="button" className="hud-btn" onClick={resetHud}>Reset</button>
    </div>
  </div>
);

const EditFrame = ({ label, box, onMove, onResize }) => {
  const drag = useRef(null);
  const start = (mode) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { mode, x: ev.clientX, y: ev.clientY, box };
  };
  const move = (ev) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (d.mode === 'move') onMove(d.box.left + dx, d.box.top + dy);
    else onResize(d.box, dx, dy);
  };
  const end = () => { drag.current = null; };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return (
    <div className="hud-edit-frame" style={box} onPointerDown={start('move')} {...handlers}>
      <span className="hud-edit-label fn-text">{label}</span>
      <span className="hud-edit-handle" onPointerDown={start('resize')} {...handlers} />
    </div>
  );
};

const GlassHud = ({ dispatch, currentRoute, zoom }) => {
  const hud = useHud();
  const ui = useHudUi();
  const rootRef = useRef(null);
  const statsRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [statsSize, setStatsSize] = useState({ w: 0, h: 0 });

  const anyStats = STATS.some((s) => hud.stats[s.key]);
  const showStats = anyStats && !ui.expanded && Boolean(currentRoute);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = statsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setStatsSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showStats, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const routeName = currentRoute?.fullname;
  useEffect(() => {
    if (currentRoute) dispatch(fetchDriveCoords(currentRoute));
  }, [routeName]); // eslint-disable-line react-hooks/exhaustive-deps

  const driveCoords = currentRoute?.driveCoords;
  const track = useMemo(() => (driveCoords ? buildTrack(driveCoords) : null), [driveCoords]);
  const range = zoom || (currentRoute ? { start: 0, end: currentRoute.duration } : null);

  const rangeRef = useRef(range);
  rangeRef.current = range;
  const onSeek = useCallback((ms) => {
    const r = rangeRef.current;
    dispatch(seek(r ? clamp(ms, r.start, r.end) : ms));
  }, [dispatch]);

  useEffect(() => {
    const onKeyDown = (ev) => {
      if (ev.key !== 'Escape') return;
      const cur = ui;
      if (cur.editing) setHudUi({ editing: false });
      else if (cur.panel) setHudUi({ panel: false });
      else if (cur.expanded) setHudUi({ expanded: false });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ui]);

  const { w: W, h: H } = size;
  const mapPx = Math.round(clamp(hud.mapSize * H, 72, Math.max(72, Math.min(W, H) - 2 * MARGIN)));
  const mapBox = { ...place(hud.mapPos, mapPx, mapPx, W, H), width: mapPx, height: mapPx };
  const expandedBox = { left: MARGIN, top: MARGIN, width: Math.max(0, W - 2 * MARGIN), height: Math.max(0, H - 2 * MARGIN) };

  const scale = hud.statsScale * (W && W < COMPACT_WIDTH ? 0.8 : 1);
  const sw = statsSize.w * scale;
  const sh = statsSize.h * scale;
  let statsXY;
  if (hud.statsPos) {
    statsXY = place(hud.statsPos, sw, sh, W, H);
  } else if (hud.minimap) {
    // docked under the minimap, Fortnite style; flips above it, or beside it when the video is short
    const below = mapBox.top + mapPx + GAP;
    const above = mapBox.top - GAP - sh;
    const onRight = mapBox.left + mapPx / 2 > W / 2;
    const maxLeft = Math.max(MARGIN, W - sw - MARGIN);
    if (below + sh <= H - MARGIN || above >= MARGIN) {
      const left = clamp(onRight ? mapBox.left + mapPx - sw : mapBox.left, MARGIN, maxLeft);
      statsXY = { left, top: below + sh <= H - MARGIN ? below : above };
    } else {
      const left = clamp(onRight ? mapBox.left - GAP - sw : mapBox.left + mapPx + GAP, MARGIN, maxLeft);
      statsXY = { left, top: clamp(mapBox.top, MARGIN, Math.max(MARGIN, H - MARGIN - sh)) };
    }
  } else {
    statsXY = place({ x: 1, y: 0 }, sw, sh, W, H);
  }
  const statsBox = { ...statsXY, width: sw, height: sh };

  const resetLayout = () => setHud({ mapPos: { x: 1, y: 0 }, statsPos: null, mapSize: 0.36, statsScale: 1 });

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none">
      {W > 0 && currentRoute && hud.minimap && (
        <Minimap
          track={track}
          hud={hud}
          box={ui.expanded ? expandedBox : mapBox}
          expanded={ui.expanded}
          editing={ui.editing}
          onExpand={() => setHudUi({ expanded: true, panel: false })}
          onSeek={onSeek}
        >
          {ui.expanded && (
            <div className="hud-map-header">
              <span className="fn-text text-lg">Drive map</span>
              <span className="hud-legend hidden sm:flex">
                <i className="is-done" />
                driven
                <i />
                ahead
              </span>
              <span className="hidden md:inline text-xs text-white/70">Click the route to jump there</span>
              <button
                type="button"
                className="glass glass-btn w-9 h-9 rounded-full flex items-center justify-center"
                aria-label="Close map"
                onClick={(ev) => { ev.stopPropagation(); setHudUi({ expanded: false }); }}
              >
                <CloseBold className="w-4 h-4" />
              </button>
            </div>
          )}
        </Minimap>
      )}

      {W > 0 && showStats && (
        <StatsWidget
          ref={statsRef}
          track={track}
          route={currentRoute}
          range={range}
          hud={hud}
          style={{ ...statsXY, transform: `scale(${scale})` }}
        />
      )}

      {ui.editing && (
        <div className="hud-edit">
          <div className="hud-edit-grid" />
          {hud.minimap && (
            <EditFrame
              label="Minimap"
              box={mapBox}
              onMove={(l, t) => setHud({ mapPos: toPos(l, t, mapPx, mapPx, W, H) })}
              onResize={(b, dx, dy) => setHud({ mapSize: clamp((b.width + (dx + dy) / 2) / H, 0.15, 0.85) })}
            />
          )}
          {showStats && (
            <EditFrame
              label="Stats"
              box={statsBox}
              onMove={(l, t) => setHud({ statsPos: toPos(l, t, sw, sh, W, H) })}
              onResize={(b, dx) => b.width > 0 && setHud({
                statsScale: clamp((hud.statsScale * (b.width + dx)) / b.width, 0.6, 1.6),
              })}
            />
          )}
          <div className="hud-edit-bar glass">
            <span className="fn-text text-sm">Edit HUD</span>
            <span className="hidden sm:inline text-xs text-white/60">Drag to move · pull the corner to resize</span>
            <button type="button" className="hud-btn" onClick={resetLayout}>Reset</button>
            <button type="button" className="hud-btn is-primary" onClick={() => setHudUi({ editing: false })}>Done</button>
          </div>
        </div>
      )}

      {ui.panel && <SettingsPanel hud={hud} />}
    </div>
  );
};

const stateToProps = (state) => ({
  currentRoute: state.currentRoute,
  zoom: state.zoom,
});

export default connect(stateToProps)(GlassHud);
