export const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export const lineOf = (coordinates) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates },
});

export const carPoint = (pos, heading) => ({
  type: 'Feature',
  properties: { heading },
  geometry: { type: 'Point', coordinates: pos },
});

// white chevron with a soft green halo, drawn once and handed to mapbox as an icon
export function carArrowImage(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 24, size / 24);
  ctx.beginPath();
  ctx.arc(12, 12, 10.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(58, 208, 124, 0.28)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, 3);
  ctx.lineTo(19, 20);
  ctx.lineTo(12, 16.2);
  ctx.lineTo(5, 20);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#0c0e0f';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

const ROUND = { 'line-join': 'round', 'line-cap': 'round' };

export function addRouteLayers(map, { dashed = false } = {}) {
  map.addSource('route', { type: 'geojson', data: lineOf([]) });
  map.addSource('routeDone', { type: 'geojson', data: lineOf([]) });
  map.addSource('car', { type: 'geojson', data: EMPTY_FC });

  map.addLayer({
    id: 'routeCasing',
    type: 'line',
    source: 'route',
    layout: ROUND,
    paint: { 'line-color': '#0c0e0f', 'line-width': 9, 'line-opacity': 0.5 },
  });
  map.addLayer({
    id: 'routeLine',
    type: 'line',
    source: 'route',
    layout: ROUND,
    paint: {
      'line-color': '#ffffff',
      'line-width': 5,
      'line-opacity': 0.45,
      ...(dashed ? { 'line-dasharray': [0.6, 1.6] } : {}),
    },
  });
  map.addLayer({
    id: 'routeDoneLine',
    type: 'line',
    source: 'routeDone',
    layout: ROUND,
    paint: { 'line-color': '#3ad07c', 'line-width': 5 },
  });

  if (!map.hasImage('car-arrow')) {
    map.addImage('car-arrow', carArrowImage(), { pixelRatio: 2 });
  }
  map.addLayer({
    id: 'car',
    type: 'symbol',
    source: 'car',
    layout: {
      'icon-image': 'car-arrow',
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
}

export function setSourceData(map, id, data) {
  const source = map && map.getSource(id);
  if (source) source.setData(data);
}
