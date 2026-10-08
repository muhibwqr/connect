import React, { useRef } from 'react';

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

export default EditFrame;
