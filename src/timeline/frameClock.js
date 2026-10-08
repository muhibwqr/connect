// One requestAnimationFrame loop shared by everything that follows playback
// (video sync, seek bar, HUD), instead of each component running its own.
const subscribers = new Set();
let raf = null;

function frame(now) {
  raf = requestAnimationFrame(frame);
  subscribers.forEach((fn) => fn(now));
}

export function onFrame(fn) {
  subscribers.add(fn);
  if (raf === null) raf = requestAnimationFrame(frame);
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };
}
