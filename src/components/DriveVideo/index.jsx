/* eslint-disable camelcase */
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Typography } from '@material-ui/core';
import ReactPlayer from 'react-player/file';

import { api } from '../../api/backend';

import { ErrorOutline } from '../../icons';
import GlassControls, { CommaLoader } from '../GlassControls';
import { currentOffset } from '../../timeline';
import { onFrame } from '../../timeline/frameClock';
import store from '../../store';
import { bufferVideo, pause, seek, videoSync } from '../../timeline/playback';
import { isIos, isFirefox } from '../../utils/browser.js';

const VideoOverlay = ({ loading, error }) => {
  if (!error && !loading) {
    return null;
  }
  return (
    <div className="z-40 absolute inset-0 pointer-events-none flex items-center justify-center bg-[#16181A66] animate-fadein">
      {error ? (
        <div className="glass max-w-[80%] rounded-2xl px-5 py-4 text-center">
          <ErrorOutline className="mb-2" />
          <Typography>{error}</Typography>
        </div>
      ) : <CommaLoader />}
    </div>
  );
};

// how far the extrapolated timeline may drift from the video before it is corrected
const DRIFT_MS = 100;
// HTMLMediaElement.readyState
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;

export class DriveVideo extends Component {
  constructor(props) {
    super(props);

    this.onHlsError = this.onHlsError.bind(this);
    this.onVideoError = this.onVideoError.bind(this);
    this.onVideoResume = this.onVideoResume.bind(this);
    this.tick = this.tick.bind(this);

    this.videoPlayer = React.createRef();
    this.appliedSeekId = null;
    this.playPending = false;
    this.nextPlayAt = 0;
    this.stopTick = null;

    this.state = {
      src: null,
      videoError: null,
    };
  }

  componentDidMount() {
    this.updateVideoSource({});
    this.stopTick = onFrame(this.tick);
  }

  componentDidUpdate(prevProps) {
    this.updateVideoSource(prevProps);
  }

  componentWillUnmount() {
    if (this.stopTick) this.stopTick();
    this.stopTick = null;
  }

  /**
   * @param {Error} e
   */
  onHlsError(e) {
    const { dispatch } = this.props;
    dispatch(bufferVideo(true));

    if (e.type === 'mediaError' && (e.details === 'bufferStalledError' || e.details === 'bufferNudgeOnStall')) {
      // buffer but no error
      return;
    }

    if (e.type === 'networkError' && (e.response?.code === 404)) {
      this.setState({ videoError: 'This video segment has not uploaded yet or has been deleted.' });
    } else {
      this.setState({ videoError: 'Unable to load video' });
    }
  }

  /**
   * @param {Error} e
   * @param {any} [data]
   */
  onVideoError(e, data) {
    if (!e) {
      console.warn('Unknown video error', { e, data });
      return;
    }

    if (e === 'hlsError') {
      this.onHlsError(data);
      return;
    }

    if (e.name === 'AbortError') {
      // ignore
      return;
    }

    if (e.target?.src?.startsWith(window.location.origin) && e.target.src.endsWith('undefined')) {
      // TODO: figure out why the src isn't set properly
      // Sometimes an error will be thrown because we try to play
      // src: "https://connect.comma.ai/.../undefined"
      console.warn('Video error with undefined src, ignoring', { e, data });
      return;
    }

    const { dispatch } = this.props;
    dispatch(bufferVideo(true));

    if (e.type === 'networkError') {
      console.error('Network error', { e, data });
      this.setState({ videoError: 'Unable to load video. Check network connection.' });
      return;
    }

    const videoError = e.response?.code === 404
      ? 'This video segment has not uploaded yet or has been deleted.'
      : (e.response?.text || 'Unable to load video');
    this.setState({ videoError });
  }

  onVideoResume() {
    const { videoError } = this.state;
    if (videoError) this.setState({ videoError: null });
  }

  updateVideoSource(prevProps) {
    const { src } = this.state;
    const { currentRoute } = this.props;
    if (!currentRoute) {
      if (src !== '') {
        this.setState({ src: '', videoError: null });
      }
      return;
    }

    if (src === '' || !prevProps.currentRoute || prevProps.currentRoute?.fullname !== currentRoute.fullname) {
      this.appliedSeekId = null;
      this.setState({
        src: api.video.getQcameraStreamUrl(currentRoute.fullname, currentRoute.share_exp, currentRoute.share_sig),
        videoError: null,
      });
    }
  }

  getVideo() {
    const player = this.videoPlayer.current;
    return player ? player.getInternalPlayer() : null;
  }

  toVideoTime(offset) {
    const start = this.props.currentRoute?.videoStartOffset || 0;
    return Math.max(0, (offset - start) / 1000);
  }

  toRouteOffset(videoTime) {
    const start = this.props.currentRoute?.videoStartOffset || 0;
    return (videoTime * 1000) + start;
  }

  // jump the video to wherever the timeline was seeked to
  applySeek(video, seekId) {
    this.appliedSeekId = seekId;
    let target = this.toVideoTime(currentOffset());
    if (Number.isFinite(video.duration)) {
      target = Math.min(target, video.duration);
    }
    if (Math.abs(video.currentTime - target) > 0.01) {
      video.currentTime = target;
    }
  }

  // The <video> is the clock: each frame, read its real position and copy it into
  // the timeline whenever the extrapolated timeline has drifted. User seeks go the
  // other way, from the timeline into the video, and are told apart by seekId.
  tick(now) {
    const { dispatch, currentRoute, loop, isBufferingVideo } = this.props;
    const video = this.getVideo();
    if (!currentRoute || !video || !(video.readyState >= HAVE_METADATA)) {
      return;
    }

    const buffering = Boolean(video.seeking || (video.readyState < HAVE_FUTURE_DATA && !video.ended));
    if (buffering !== isBufferingVideo && !this.state.videoError) {
      dispatch(bufferVideo(buffering));
    }

    // read the store directly: props lag one render behind a dispatch
    const { seekId } = store.getState();
    if (seekId !== this.appliedSeekId) {
      this.applySeek(video, seekId);
      return;
    }
    if (video.seeking) {
      return;
    }

    // a video that hit its end pauses itself, and ReactPlayer won't replay it
    // because its `playing` prop never changed, so restart it when the loop wraps
    if (video.paused && this.props.desiredPlaySpeed && !video.ended && !this.playPending && now >= this.nextPlayAt) {
      this.playPending = true;
      Promise.resolve(video.play())
        .catch(() => { this.nextPlayAt = performance.now() + 1000; }) // e.g. autoplay blocked: back off
        .finally(() => { this.playPending = false; });
    }

    const offset = this.toRouteOffset(video.currentTime);
    if (loop?.duration) {
      const loopEnd = loop.startTime + loop.duration;
      if (video.ended || offset >= loopEnd || offset < loop.startTime - DRIFT_MS) {
        dispatch(seek(loop.startTime));
        return;
      }
    } else if (video.ended && this.props.desiredPlaySpeed) {
      dispatch(pause());
    }

    if (Math.abs(offset - currentOffset()) > DRIFT_MS) {
      dispatch(videoSync(offset));
    }
  }

  render() {
    const { desiredPlaySpeed, isBufferingVideo, currentRoute, onAudioStatusChange, isMuted, hasAudio, onMuteToggle } = this.props;
    const { src, videoError } = this.state;

    const onPlayerReady = (player) => {
      if (isIos()) { // ios does not support hls.js and on other browsers hls.js does not directly play the m3u8 so audioTracks are not visible
        const videoElement = player.getInternalPlayer();
        if (videoElement && videoElement.audioTracks && videoElement.audioTracks.length > 0) {
          if (onAudioStatusChange) {
            onAudioStatusChange(true);
          }
        }
      } else { // on other platforms, inspect audio tracks before hls.js changes things
        const hlsPlayer = player.getInternalPlayer('hls');
        if (hlsPlayer) {
          hlsPlayer.on('hlsBufferCodecs', (event, data) => {
            if (onAudioStatusChange) {
              onAudioStatusChange(!!data.audio);
            }
          });
        }
      }
    };

    return (
      <div className="drive-player min-h-[200px] relative max-w-[964px] m-[0_auto] aspect-[1.593] overflow-hidden rounded-2xl bg-black">
        <VideoOverlay loading={isBufferingVideo} error={videoError} />
        <ReactPlayer
          ref={this.videoPlayer}
          url={src}
          playsinline
          muted={isMuted}
          width="100%"
          height="100%"
          playing={Boolean(currentRoute && desiredPlaySpeed)}
          onReady={onPlayerReady}
          config={{
            hlsVersion: '1.4.8',
            hlsOptions: {
              maxBufferLength: 40,
            },
          }}
          // most browsers can't go above 16x; firefox mutes audio above 8x
          playbackRate={Math.min(desiredPlaySpeed || 1, (isFirefox() && !isMuted) ? 8 : 16)}
          onBufferEnd={this.onVideoResume}
          onPlay={this.onVideoResume}
          onError={this.onVideoError}
        />
        <GlassControls isMuted={isMuted} hasAudio={hasAudio} onMuteToggle={onMuteToggle} />
      </div>
    );
  }
}

const stateToProps = (state) => ({
  dongleId: state.dongleId,
  desiredPlaySpeed: state.desiredPlaySpeed,
  loop: state.loop,
  isBufferingVideo: state.isBufferingVideo,
  routes: state.routes,
  currentRoute: state.currentRoute,
});

export default connect(stateToProps)(DriveVideo);
