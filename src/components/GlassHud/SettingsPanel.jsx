import React from 'react';
import { CloseBold } from '../../icons';
import { STATS, resetHud, setHud, setHudUi } from './store';

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

export default SettingsPanel;
