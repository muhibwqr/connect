import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { currentOffset } from '../../timeline';
import { onFrame } from '../../timeline/frameClock';
import { DEFAULT_LOCATION, MAPBOX_STYLE, MAPBOX_TOKEN } from '../../utils/geocode';
import { nearestIndex, sampleTrack, shortestTurn } from '../../utils/track';
import { EMPTY_FC, addRouteLayers, carPoint, lineOf, setSourceData } from '../DriveMap/mapLayers';
import { BEARING_EASE, EXPAND_MS, SEEK_PICK_PX } from './util';

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
    const f = frame.current;
    const tick = () => {
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
    return onFrame(tick);
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

// speed bar is full at ~90 mph

export default Minimap;
