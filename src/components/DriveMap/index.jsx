import React, { Component } from 'react';
import { connect } from 'react-redux';

import ReactMapGL, { LinearInterpolator } from 'react-map-gl';

import { fetchDriveCoords } from '../../actions/cached';
import { currentOffset } from '../../timeline';
import { DEFAULT_LOCATION, MAPBOX_STYLE, MAPBOX_TOKEN } from '../../utils/geocode';
import { buildTrack, sampleTrack, shortestTurn } from '../../utils/track';
import { EMPTY_FC, addRouteLayers, carPoint, lineOf, setSourceData } from './mapLayers';
import '../GlassControls/glass.css';

const FLY_MS = 350;
const BEARING_EASE = 0.15;

const LockOnIcon = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" />
  </svg>
);

class DriveMap extends Component {
  constructor(props) {
    super(props);

    this.state = {
      viewport: {
        ...DEFAULT_LOCATION,
        zoom: 15,
        bearing: 0,
      },
      locked: true,
    };

    this.onRef = this.onRef.bind(this);
    this.onViewportChange = this.onViewportChange.bind(this);
    this.onInteraction = this.onInteraction.bind(this);
    this.initMap = this.initMap.bind(this);
    this.tick = this.tick.bind(this);
    this.toggleLock = this.toggleLock.bind(this);

    this.map = null;
    this.track = null;
    this.trackSource = null;
    this.lastPos = null;
    this.lastIndex = -1;
    this.heading = 0;
    this.bearingSettled = true;
    this.flyUntil = 0;
  }

  componentDidMount() {
    this.mounted = true;
    this.componentDidUpdate({});
    requestAnimationFrame(this.tick);
  }

  componentDidUpdate(prevProps) {
    const { dispatch, currentRoute, startTime } = this.props;

    const prevRoute = prevProps.currentRoute?.fullname || null;
    const route = currentRoute?.fullname || null;
    if (prevRoute !== route) {
      this.setTrack(null);
      if (route) {
        dispatch(fetchDriveCoords(currentRoute));
      }
    }

    // glide instead of jumping after a seek
    if (prevProps.startTime && prevProps.startTime !== startTime) {
      this.fly();
    }

    if (currentRoute?.driveCoords && currentRoute.driveCoords !== this.trackSource) {
      this.setTrack(currentRoute.driveCoords);
    }
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  onInteraction(ev) {
    if (ev.isDragging && this.state.locked) {
      this.setState({ locked: false });
    }
  }

  onRef(el) {
    if (el) {
      el.addEventListener('touchstart', (ev) => ev.stopPropagation());
    }
  }

  onViewportChange(viewport) {
    this.setState({ viewport });
  }

  setTrack(driveCoords) {
    this.trackSource = driveCoords;
    this.track = driveCoords ? buildTrack(driveCoords) : null;
    this.lastPos = null;
    this.lastIndex = -1;
    this.fly();
    const map = this.map && this.map.getMap();
    setSourceData(map, 'route', lineOf(this.track ? this.track.coords : []));
    setSourceData(map, 'routeDone', lineOf([]));
    setSourceData(map, 'car', EMPTY_FC);
  }

  fly() {
    this.flyUntil = -1;
  }

  tick() {
    if (!this.mounted) {
      return;
    }
    requestAnimationFrame(this.tick);

    const map = this.map && this.map.getMap();
    const { track } = this;
    if (!map || !track || !track.ts.length) {
      return;
    }

    const s = sampleTrack(track, currentOffset());
    if (s.heading !== null) {
      this.heading = s.heading;
    }
    const pos = [s.lng, s.lat];
    const moved = !this.lastPos || pos[0] !== this.lastPos[0] || pos[1] !== this.lastPos[1];
    if (moved || this.drawnHeading !== this.heading) {
      this.lastPos = pos;
      this.drawnHeading = this.heading;
      setSourceData(map, 'car', carPoint(pos, this.heading));
    }
    if (s.index !== this.lastIndex) {
      this.lastIndex = s.index;
      setSourceData(map, 'routeDone', lineOf([...track.coords.slice(0, s.index + 1), pos]));
    }

    if (this.state.locked && (moved || !this.bearingSettled || this.flyUntil < 0)) {
      this.follow(pos);
    }
  }

  // keep the car centred and heading-up while locked on
  follow(pos) {
    const now = Date.now();
    if (now < this.flyUntil) {
      return;
    }
    const flying = this.flyUntil < 0;
    this.flyUntil = flying ? now + FLY_MS : 0;

    this.setState((prev) => {
      const turn = shortestTurn(prev.viewport.bearing, this.heading);
      this.bearingSettled = flying || Math.abs(turn) < 0.3;
      const viewport = {
        ...prev.viewport,
        longitude: pos[0],
        latitude: pos[1],
        bearing: flying || this.bearingSettled ? this.heading : prev.viewport.bearing + turn * BEARING_EASE,
        transitionDuration: flying ? FLY_MS : 0,
        transitionInterpolator: flying ? new LinearInterpolator() : undefined,
      };
      return { viewport };
    });
  }

  toggleLock() {
    if (this.state.locked) {
      this.setState((prev) => ({
        locked: false,
        viewport: {
          ...prev.viewport,
          bearing: 0,
          transitionDuration: FLY_MS,
          transitionInterpolator: new LinearInterpolator(['bearing']),
        },
      }));
    } else {
      this.fly();
      this.setState({ locked: true }, () => this.lastPos && this.follow(this.lastPos));
    }
  }

  initMap(mapComponent) {
    if (!mapComponent || typeof mapComponent.getMap !== 'function') {
      this.map = null;
      return;
    }

    const map = mapComponent.getMap();
    if (!map) {
      this.map = null;
      return;
    }

    map.on('load', () => {
      addRouteLayers(map);
      this.map = mapComponent;
      this.setTrack(this.trackSource);
    });
  }

  render() {
    const { viewport, locked } = this.state;
    return (
      <div ref={this.onRef} className="relative w-full h-full min-h-[240px] overflow-hidden rounded-2xl bg-[#16181a] cursor-default">
        <div className="absolute inset-0">
          <ReactMapGL
            {...viewport}
            width="100%"
            height="100%"
            mapStyle={MAPBOX_STYLE}
            maxPitch={0}
            mapboxApiAccessToken={MAPBOX_TOKEN}
            ref={this.initMap}
            onContextMenu={null}
            dragRotate={false}
            touchRotate={false}
            onViewportChange={this.onViewportChange}
            attributionControl={false}
            onInteractionStateChange={this.onInteraction}
          />
        </div>
        <button
          type="button"
          onClick={this.toggleLock}
          aria-pressed={locked}
          aria-label={locked ? 'Unlock map from car' : 'Lock map on car'}
          className={`glass map-lock absolute top-3 right-3 z-10 flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-semibold text-white ${locked ? 'is-locked' : ''}`}
        >
          <LockOnIcon />
          {locked ? 'Locked on' : 'Lock on'}
        </button>
      </div>
    );
  }
}

const stateToProps = (state) => ({
  currentRoute: state.currentRoute,
  startTime: state.startTime,
});

export default connect(stateToProps)(DriveMap);
