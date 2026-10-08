import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import dayjs from 'dayjs';

import { api } from '../../api/backend';
import { Forward10, Fullscreen, FullscreenExit, Pause, PlayArrow, Replay10, VolumeOff, VolumeUp } from '../../icons';
import { currentOffset } from '../../timeline';
import { onFrame } from '../../timeline/frameClock';
import { pause, play, seek } from '../../timeline/playback';
import { getSegmentNumber } from '../../utils';
import { isIos } from '../../utils/browser.js';
import './glass.css';

const SPEEDS = [0.5, 1, 2, 4, 8];
const SPEED_SLOT = 34;
const HIDE_DELAY = 2500;
const SKIP_MS = 10000;
const DOUBLE_TAP_MS = 300;
const SCRUB_SEEK_MS = 150;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function formatClock(route, offset) {
  const date = dayjs(route.start_time_utc_millis + offset);
  return date.isValid() ? date.format('HH:mm:ss') : '--:--:--';
}

function nearestSpeedIndex(speed) {
  let best = 0;
  SPEEDS.forEach((s, i) => {
    if (Math.abs(s - speed) < Math.abs(SPEEDS[best] - speed)) best = i;
  });
  return best;
}

export const GooFilter = () => (
  <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
    <defs>
      <filter id="glass-goo">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
        <feComposite in="SourceGraphic" in2="goo" operator="atop" />
      </filter>
    </defs>
  </svg>
);

const COMMA_PATH = 'M48.453 105.707C48.453 103.77 48.3011 102.148 48.5246 100.584C48.6198 99.9171 49.4009 99.203 50.0379 98.8003C53.1435 96.8362 56.5171 95.268 59.4085 93.0154C68.7741 85.7187 74.3255 76.1131 74.6289 63.6354C74.7149 60.0925 73.4079 59.2074 70.4217 60.5875C61.8019 64.572 52.5325 62.2358 47.5855 54.8313C42.1907 46.7555 42.9504 36.0028 49.4143 28.9481C57.6708 19.9376 71.2562 19.6679 80.6245 28.2733C86.2363 33.4281 88.9028 40.084 89.5677 47.6547C91.797 73.0176 79.0313 93.9229 55.797 103.106C53.4975 104.015 51.1395 104.761 48.453 105.707Z';

export const CommaLoader = () => (
  <div className="glass comma-loader relative w-16 h-16 rounded-full flex items-center justify-center" role="progressbar" aria-label="Loading video">
    <svg className="comma-spin w-9 h-9" viewBox="20 20 88 88" aria-hidden="true">
      <path fill="#fff" fillRule="evenodd" d={COMMA_PATH} />
    </svg>
  </div>
);

const PlayPauseGlyph = ({ paused }) => (
  <span className={`relative block w-4 h-4 ${paused ? 'is-paused' : ''}`} aria-hidden="true">
    <span className="pp-half pp-left" />
    <span className="pp-half pp-right" />
  </span>
);

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

// Fullscreen the whole player so the glass controls stay on top. iPhone Safari can
// only fullscreen a <video> itself (with Apple's own controls), so fall back to that.
function toggleFullscreen(player) {
  if (!player) return;
  if (fullscreenElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const request = player.requestFullscreen || player.webkitRequestFullscreen;
  if (request && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
    Promise.resolve(request.call(player)).catch(() => {});
    return;
  }
  const video = player.querySelector('video');
  if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
}

const GlassButton = ({ className = '', children, ...props }) => (
  <button
    type="button"
    className={`glass-btn flex items-center justify-center w-9 h-9 rounded-full text-white/90 ${className}`}
    {...props}
  >
    {children}
  </button>
);

const ScrubPreview = ({ route, offset }) => {
  const segment = getSegmentNumber(route, offset);
  return (
    <>
      <div
        className="w-32 h-20 rounded-xl bg-black/40 bg-no-repeat bg-cover bg-top"
        style={{ backgroundImage: `url(${api.routeAssets.thumbnail(route, segment)})` }}
      />
      <div className="mt-1 text-center text-xs font-medium tabular-nums">
        {formatClock(route, offset)}
        <span className="text-white/50">{` · seg ${segment}`}</span>
      </div>
    </>
  );
};

const GlassControls = ({ dispatch, zoom, currentRoute, desiredPlaySpeed, isBufferingVideo, isMuted, hasAudio, onMuteToggle }) => {
  const [visible, setVisible] = useState(true);
  const [hoverPct, setHoverPct] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [bloop, setBloop] = useState(null);
  const [skip, setSkip] = useState(null);
  const [lastSpeed, setLastSpeed] = useState(desiredPlaySpeed || 1);

  const trackRef = useRef(null);
  const progressRef = useRef(null);
  const headRef = useRef(null);
  const clockRef = useRef(null);
  const segRef = useRef(null);
  const hideTimer = useRef(null);
  const clickTimer = useRef(null);
  const lastTap = useRef(null);
  const overDock = useRef(false);
  const scrubPct = useRef(null);
  const lastScrubSeek = useRef(0);

  const range = zoom || (currentRoute ? { start: 0, end: currentRoute.duration } : null);
  const isPaused = desiredPlaySpeed === 0;
  const shown = visible || isPaused || isBufferingVideo || scrubbing;

  const live = useRef({});
  const dockRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  live.current = { range, currentRoute };

  useEffect(() => {
    if (desiredPlaySpeed) setLastSpeed(desiredPlaySpeed);
  }, [desiredPlaySpeed]);

  const pctToOffset = useCallback((pct) => {
    const r = live.current.range;
    return r.start + pct * (r.end - r.start);
  }, []);

  const poke = useCallback(() => {
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!overDock.current) setVisible(false);
    }, HIDE_DELAY);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(clickTimer.current);
    };
  }, [poke]);

  // drive the playhead and clock from the playback clock without re-rendering
  useEffect(() => {
    const tick = () => {
      const { range: r, currentRoute: route } = live.current;
      if (!r || !route || !progressRef.current) return;
      const offset = scrubPct.current !== null ? pctToOffset(scrubPct.current) : currentOffset();
      const pct = `${clamp01((offset - r.start) / (r.end - r.start)) * 100}%`;
      progressRef.current.style.width = pct;
      headRef.current.style.left = pct;
      const clock = formatClock(route, offset);
      if (clockRef.current.textContent !== clock) clockRef.current.textContent = clock;
      const seg = `seg ${getSegmentNumber(route, offset)}`;
      if (segRef.current.textContent !== seg) segRef.current.textContent = seg;
    };
    return onFrame(tick);
  }, [pctToOffset]);

  const togglePlay = () => {
    dispatch(isPaused ? play(lastSpeed) : pause());
    setBloop({ key: Date.now(), paused: !isPaused });
    poke();
  };

  const skipBy = (ms) => {
    const target = currentOffset() + ms;
    dispatch(seek(range ? Math.max(range.start, Math.min(range.end, target)) : target));
    setSkip({ key: Date.now(), dir: Math.sign(ms) });
    poke();
  };

  const setSpeed = (speed) => {
    dispatch(play(speed));
    poke();
  };

  const player = () => dockRef.current?.closest('.drive-player');
  const onFullscreen = () => toggleFullscreen(player());

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(fullscreenElement() && fullscreenElement() === player()));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const actions = useRef();
  actions.current = { togglePlay, skipBy, onMuteToggle, hasAudio, onFullscreen };

  useEffect(() => {
    const onKeyDown = (ev) => {
      const tag = ev.target?.tagName;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return;
      const a = actions.current;
      if (ev.key === ' ' || ev.key === 'k') {
        if (tag === 'BUTTON' && ev.key === ' ') return;
        ev.preventDefault();
        a.togglePlay();
      } else if (ev.key === 'ArrowLeft' || ev.key === 'j') {
        ev.preventDefault();
        a.skipBy(-SKIP_MS);
      } else if (ev.key === 'ArrowRight' || ev.key === 'l') {
        ev.preventDefault();
        a.skipBy(SKIP_MS);
      } else if (ev.key === 'm' && a.hasAudio && a.onMuteToggle) {
        a.onMuteToggle();
      } else if (ev.key === 'f') {
        a.onFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // tap the middle to play/pause, double-tap the sides to skip
  const onSurfacePointerUp = (ev) => {
    if (ev.button !== 0) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const zone = x < 0.3 ? -1 : (x > 0.7 ? 1 : 0);
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = { time: now, zone };

    if (zone !== 0 && prev && prev.zone === zone && now - prev.time < DOUBLE_TAP_MS) {
      clearTimeout(clickTimer.current);
      skipBy(zone * SKIP_MS);
      return;
    }
    if (ev.pointerType !== 'mouse' && !shown) {
      poke();
      return;
    }
    clearTimeout(clickTimer.current);
    if (zone === 0) {
      togglePlay();
    } else {
      clickTimer.current = setTimeout(() => actions.current.togglePlay(), DOUBLE_TAP_MS);
    }
  };

  const pctFromEvent = (ev) => {
    const rect = trackRef.current.getBoundingClientRect();
    return clamp01((ev.clientX - rect.left) / rect.width);
  };

  const scrubTo = (pct, force) => {
    scrubPct.current = pct;
    const now = Date.now();
    if (force || now - lastScrubSeek.current > SCRUB_SEEK_MS) {
      lastScrubSeek.current = now;
      dispatch(seek(pctToOffset(pct)));
    }
  };

  const onTrackPointerDown = (ev) => {
    if (ev.button !== 0 || !range) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const pct = pctFromEvent(ev);
    setScrubbing(true);
    setHoverPct(pct);
    scrubTo(pct, true);
  };

  const onTrackPointerMove = (ev) => {
    if (!range) return;
    const pct = pctFromEvent(ev);
    setHoverPct(pct);
    if (scrubPct.current !== null) scrubTo(pct, false);
  };

  const onTrackPointerUp = (ev) => {
    if (scrubPct.current !== null) {
      scrubTo(pctFromEvent(ev), true);
      scrubPct.current = null;
    }
    setScrubbing(false);
    if (ev.pointerType !== 'mouse') setHoverPct(null);
    poke();
  };

  const onTrackKeyDown = (ev) => {
    if (ev.key === 'Home' && range) {
      ev.preventDefault();
      dispatch(seek(range.start));
    } else if (ev.key === 'End' && range) {
      ev.preventDefault();
      dispatch(seek(range.end));
    }
  };

  const speedIndex = nearestSpeedIndex(isPaused ? lastSpeed : desiredPlaySpeed);
  const showSpeed = !isIos();
  const hoverActive = hoverPct !== null && currentRoute && range;
  const headLarge = hoverActive || scrubbing;

  return (
    <>
      <GooFilter />

      <div
        className="absolute inset-0 z-30 select-none"
        style={{ cursor: shown ? 'default' : 'none', touchAction: 'manipulation' }}
        onPointerMove={(ev) => ev.pointerType === 'mouse' && poke()}
        onPointerUp={onSurfacePointerUp}
        aria-hidden="true"
      />

      <div
        className={`glass-dock pointer-events-none absolute inset-x-0 bottom-0 h-1/2 z-30 bg-gradient-to-t from-black/60 to-transparent ${shown ? '' : 'is-hidden'}`}
      />

      {bloop && (
        <div key={bloop.key} className="glass glass-bloop pointer-events-none absolute left-1/2 top-1/2 z-40 w-16 h-16 rounded-full flex items-center justify-center text-white">
          {bloop.paused ? <Pause className="w-8 h-8" /> : <PlayArrow className="w-8 h-8" />}
        </div>
      )}

      {skip && (
        <div
          key={skip.key}
          className={`glass glass-skip pointer-events-none absolute top-1/2 z-40 px-4 h-12 rounded-full flex items-center gap-2 text-white text-sm font-semibold ${skip.dir < 0 ? 'left-[8%]' : 'right-[8%]'}`}
        >
          {skip.dir < 0 ? <Replay10 className="w-6 h-6" /> : <Forward10 className="w-6 h-6" />}
          {skip.dir < 0 ? '−10s' : '+10s'}
        </div>
      )}

      <div
        ref={dockRef}
        className={`glass glass-dock absolute inset-x-2 bottom-2 sm:inset-x-3 sm:bottom-3 z-50 rounded-[22px] px-3 pt-1 pb-1.5 text-white ${shown ? '' : 'is-hidden'}`}
        onPointerEnter={() => { overDock.current = true; setVisible(true); }}
        onPointerLeave={() => { overDock.current = false; poke(); }}
      >
        <div
          ref={trackRef}
          className="relative h-6 cursor-pointer touch-none"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
          onPointerLeave={() => !scrubbing && setHoverPct(null)}
          onKeyDown={onTrackKeyDown}
        >
          <div className="absolute inset-x-0 top-1/2 -mt-[3px] h-1.5 rounded-full bg-white/20" />
          <div className="goo absolute inset-0">
            <div
              ref={progressRef}
              className="absolute left-0 top-1/2 -mt-[3px] h-1.5 rounded-full bg-gradient-to-r from-[#3ad07c] to-white"
            />
            <div
              ref={headRef}
              className="scrub-blob absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{ width: headLarge ? 18 : 12, height: headLarge ? 18 : 12 }}
            />
            <div
              className="scrub-drop absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{
                left: `${(hoverPct || 0) * 100}%`,
                width: hoverActive && !scrubbing ? 10 : 0,
                height: hoverActive && !scrubbing ? 10 : 0,
                opacity: hoverActive && !scrubbing ? 1 : 0,
              }}
            />
          </div>
          {hoverActive && (
            <div
              className="glass scrub-bubble pointer-events-none absolute bottom-full mb-2 p-1.5 rounded-2xl"
              style={{
                left: `clamp(70px, ${hoverPct * 100}%, calc(100% - 70px))`,
                transform: `translateX(-50%) scale(${scrubbing ? 1.04 : 1})`,
              }}
            >
              <ScrubPreview route={currentRoute} offset={pctToOffset(hoverPct)} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1.5">
          <GlassButton onClick={() => skipBy(-SKIP_MS)} aria-label="Jump back 10 seconds">
            <Replay10 className="w-5 h-5" />
          </GlassButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPaused ? 'Unpause' : 'Pause'}
            className="glass-btn flex items-center justify-center w-11 h-11 rounded-full bg-white text-[#0c0e0f] shadow-[0_4px_20px_rgba(255,255,255,0.25)] hover:!bg-white"
          >
            <PlayPauseGlyph paused={isPaused} />
          </button>
          <GlassButton onClick={() => skipBy(SKIP_MS)} aria-label="Jump forward 10 seconds">
            <Forward10 className="w-5 h-5" />
          </GlassButton>

          <div className="ml-1 sm:ml-2 flex items-baseline gap-2 min-w-0">
            <span ref={clockRef} className="text-sm sm:text-base font-semibold tabular-nums" />
            <span ref={segRef} className="hidden xs:inline text-xs text-white/50 tabular-nums" />
          </div>

          <div className="flex-1" />

          {showSpeed && (
            <>
              <div className="relative hidden sm:flex h-8 rounded-full bg-black/20 p-0.5" role="radiogroup" aria-label="Playback speed">
                <div className="goo absolute inset-0.5 pointer-events-none">
                  <div
                    className="speed-trail absolute top-1/2 -mt-2.5 h-5 rounded-full bg-white"
                    style={{ left: speedIndex * SPEED_SLOT + 7, width: SPEED_SLOT - 14 }}
                  />
                  <div
                    className="speed-blob absolute top-0 h-full rounded-full bg-white"
                    style={{ left: speedIndex * SPEED_SLOT, width: SPEED_SLOT }}
                  />
                </div>
                {SPEEDS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={i === speedIndex}
                    aria-label={`Play at ${s}x`}
                    onClick={() => setSpeed(s)}
                    className={`relative z-10 h-full text-xs font-semibold tabular-nums transition-colors ${i === speedIndex ? 'text-[#0c0e0f]' : 'text-white/70 hover:text-white'}`}
                    style={{ width: SPEED_SLOT }}
                  >
                    {`${s}×`}
                  </button>
                ))}
              </div>
              <GlassButton
                className="sm:hidden w-auto px-2 text-xs font-semibold tabular-nums"
                onClick={() => setSpeed(SPEEDS[(speedIndex + 1) % SPEEDS.length])}
                aria-label="Change playback speed"
              >
                {`${SPEEDS[speedIndex]}×`}
              </GlassButton>
            </>
          )}


          <GlassButton
            onClick={onMuteToggle}
            disabled={!hasAudio}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            title={hasAudio ? '' : 'Enable audio recording through the "Record and Upload Microphone Audio" toggle on your device'}
          >
            {isMuted ? <VolumeOff className="w-5 h-5" /> : <VolumeUp className="w-5 h-5" />}
          </GlassButton>

          <GlassButton onClick={onFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <FullscreenExit className="w-5 h-5" /> : <Fullscreen className="w-5 h-5" />}
          </GlassButton>
        </div>
      </div>
    </>
  );
};

const stateToProps = (state) => ({
  zoom: state.zoom,
  currentRoute: state.currentRoute,
  desiredPlaySpeed: state.desiredPlaySpeed,
  isBufferingVideo: state.isBufferingVideo,
});

export default connect(stateToProps)(GlassControls);
