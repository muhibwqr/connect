import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { fetchDriveCoords } from '../../actions/cached';
import { CloseBold } from '../../icons';
import { seek } from '../../timeline/playback';
import { buildTrack } from '../../utils/track';
import { STATS, setHud, setHudUi, useHud, useHudUi } from './store';
import { clamp, COMPACT_WIDTH, MARGIN, place, toPos } from './util';
import EditFrame from './EditFrame';
import Minimap from './Minimap';
import SettingsPanel from './SettingsPanel';
import StatsWidget from './StatsBars';
import './hud.css';

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

  const scale = hud.statsScale * (W && W < COMPACT_WIDTH ? 0.66 : 1);
  const sw = statsSize.w * scale;
  const sh = statsSize.h * scale;
  let statsXY;
  if (hud.statsPos) {
    statsXY = place(hud.statsPos, sw, sh, W, H);
  } else {
    // health bars sit top-left, out of the minimap's way
    statsXY = place({ x: 0, y: 0 }, sw, sh, W, H);
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
