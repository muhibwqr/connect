import React, { forwardRef, useEffect, useMemo, useRef } from 'react';
import { currentOffset } from '../../timeline';
import { onFrame } from '../../timeline/frameClock';
import { engagedIntervals, inIntervals, intervalsTotal, sampleTrack } from '../../utils/track';
import { STATS } from './store';
import { countUpTo, DIST_UNIT, formatDuration, M_PER, MPS_TO, SPEED_UNIT } from './util';

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

const TOP_SPEED_MPS = 40;
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

const StatsWidget = forwardRef(({ track, route, range, hud, style }, ref) => {
  const valueRefs = useRef({});
  const fillRefs = useRef({});
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
  live.current = { track, range, hud, intervals, alerts, engagedPct };

  useEffect(() => {
    const set = (key, text, fill) => {
      const el = valueRefs.current[key];
      if (el && el.textContent !== text) el.textContent = text;
      const bar = fillRefs.current[key];
      if (bar) bar.style.transform = `scaleX(${clamp01(fill)})`;
    };
    const tick = () => {
      const { track: t, range: r, hud: h, intervals: iv, alerts: al, engagedPct: ep } = live.current;
      const offset = currentOffset();
      const s = t && t.ts.length ? sampleTrack(t, offset) : null;
      set('speed', s ? String(Math.round(s.speed * MPS_TO[h.units])) : '--', s ? s.speed / TOP_SPEED_MPS : 0);
      set('distance', s ? (s.dist / M_PER[h.units]).toFixed(1) : '--', s && t.total ? s.dist / t.total : 0);
      set('remaining', r ? formatDuration(r.end - offset) : '--', r ? (r.end - offset) / (r.end - r.start) : 0);
      const engaged = inIntervals(iv, offset);
      set('engaged', engaged ? 'On' : 'Off', ep !== null ? ep / 100 : Number(engaged));
      engagedRowRef.current?.classList.toggle('is-on', engaged);
      const seen = countUpTo(al, offset);
      set('alerts', String(seen), al.length ? seen / al.length : 0);
    };
    return onFrame(tick);
  }, []);

  const units = {
    speed: SPEED_UNIT[hud.units],
    distance: track?.total ? `/ ${(track.total / M_PER[hud.units]).toFixed(1)} ${DIST_UNIT[hud.units]}` : DIST_UNIT[hud.units],
    remaining: '',
    engaged: engagedPct !== null ? `${engagedPct}%` : '',
    alerts: alerts.length ? `/ ${alerts.length}` : '',
  };

  return (
    <div ref={ref} className="hud-stats" style={style}>
      {STATS.filter((s) => hud.stats[s.key]).map((s) => (
        <div key={s.key} ref={s.key === 'engaged' ? engagedRowRef : undefined} className={`hud-bar is-${s.key}`}>
          <span className="hud-bar-icon">{STAT_ICONS[s.key]}</span>
          <div className="hud-bar-body">
            <div className="hud-bar-head">
              <span className="hud-bar-label">{s.label}</span>
              <span className="hud-bar-reading">
                <span ref={(el) => { valueRefs.current[s.key] = el; }} className="hud-bar-value fn-text">--</span>
                {units[s.key] && <span className="hud-bar-unit">{units[s.key]}</span>}
              </span>
            </div>
            <div className="hud-bar-track">
              <div ref={(el) => { fillRefs.current[s.key] = el; }} className="hud-bar-fill" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

export default StatsWidget;
