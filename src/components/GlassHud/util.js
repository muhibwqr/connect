import React from 'react';

export const MARGIN = 12;
export const SEEK_PICK_PX = 28;
export const EXPAND_MS = 450;
export const BEARING_EASE = 0.15;
export const COMPACT_WIDTH = 520;
export const MPS_TO = { mph: 2.23694, kmh: 3.6 };
export const M_PER = { mph: 1609.344, kmh: 1000 };
export const SPEED_UNIT = { mph: 'mph', kmh: 'km/h' };
export const DIST_UNIT = { mph: 'mi', kmh: 'km' };

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// positions are stored as fractions of the free space, so widgets stay inside on resize
export const place = (pos, w, h, W, H) => ({
  left: MARGIN + clamp(pos.x, 0, 1) * Math.max(0, W - w - 2 * MARGIN),
  top: MARGIN + clamp(pos.y, 0, 1) * Math.max(0, H - h - 2 * MARGIN),
});

export const toPos = (left, top, w, h, W, H) => {
  const fw = W - w - 2 * MARGIN;
  const fh = H - h - 2 * MARGIN;
  return {
    x: fw > 0 ? clamp((left - MARGIN) / fw, 0, 1) : 0,
    y: fh > 0 ? clamp((top - MARGIN) / fh, 0, 1) : 0,
  };
};

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const countUpTo = (sorted, t) => {
  let n = 0;
  while (n < sorted.length && sorted[n] <= t) n += 1;
  return n;
};
