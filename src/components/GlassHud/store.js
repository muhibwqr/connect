import { useSyncExternalStore } from 'react';

import { isMetric } from '../../utils/conversions';

const STORAGE_KEY = 'glassHud:v2';

export const STATS = [
  { key: 'speed', label: 'Speed' },
  { key: 'distance', label: 'Distance' },
  { key: 'remaining', label: 'Time left' },
  { key: 'engaged', label: 'openpilot' },
  { key: 'alerts', label: 'Alerts' },
];

const defaults = () => ({
  minimap: true,
  shape: 'square',
  mapSize: 0.36,
  mapZoom: 15,
  rotate: false,
  // positions are fractions of the free space inside the player, so they survive resizes
  mapPos: { x: 1, y: 0 },
  statsPos: null, // null = docked under the minimap
  statsScale: 1,
  stats: { speed: true, distance: true, remaining: true, engaged: true, alerts: false },
  units: isMetric() ? 'kmh' : 'mph',
});

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') {
      return { ...base, ...saved, stats: { ...base.stats, ...saved.stats } };
    }
  } catch (err) {
    // ignore unreadable settings
  }
  return base;
}

let settings = load();
let ui = { panel: false, editing: false, expanded: false };
const listeners = new Set();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setHud(patch) {
  settings = { ...settings, ...(typeof patch === 'function' ? patch(settings) : patch) };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    // storage full or blocked; settings still apply for this session
  }
  emit();
}

export function resetHud() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // ignore
  }
  settings = defaults();
  emit();
}

export function setHudUi(patch) {
  ui = { ...ui, ...patch };
  emit();
}

export const toggleHudPanel = () => setHudUi({ panel: !ui.panel, editing: false });

export const useHud = () => useSyncExternalStore(subscribe, () => settings);
export const useHudUi = () => useSyncExternalStore(subscribe, () => ui);
