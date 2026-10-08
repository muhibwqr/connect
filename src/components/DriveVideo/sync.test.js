import { beforeEach, describe, expect, it, vi } from 'vitest';

import store from '../../store';
import { currentOffset } from '../../timeline';
import { bufferVideo, pause, seek, videoSync } from '../../timeline/playback';
import { DriveVideo } from './index';

// drive the real store: paused, so currentOffset() doesn't extrapolate
const timeline = {
  set offset(ms) { store.dispatch(videoSync(ms)); },
  get seekId() { return store.getState().seekId; },
  userSeek(ms) { store.dispatch(seek(ms)); },
};

const route = { fullname: 'x|y', videoStartOffset: 2000 };

function setup({ loop = null, desiredPlaySpeed = 1, ...videoProps } = {}) {
  const dispatch = vi.fn();
  const video = {
    readyState: 4, seeking: false, paused: false, ended: false, duration: 600, currentTime: 0,
    play: vi.fn(() => Promise.resolve()),
    ...videoProps,
  };
  const dv = new DriveVideo({ dispatch, currentRoute: route, loop, desiredPlaySpeed, isBufferingVideo: false });
  dv.getVideo = () => video;
  dv.appliedSeekId = timeline.seekId;
  return { dv, video, dispatch };
}

describe('DriveVideo sync rules', () => {
  beforeEach(() => {
    store.dispatch(pause());
    timeline.offset = 0;
  });

  it('reads the paused store offset directly', () => {
    timeline.offset = 4321;
    expect(currentOffset()).toEqual(4321);
  });

  it('copies the video position into the timeline only past the drift threshold', () => {
    const { dv, video, dispatch } = setup({ currentTime: 10 });
    timeline.offset = 12_050; // 10s of video + 2s start offset, 50ms off
    dv.tick(0);
    expect(dispatch).not.toHaveBeenCalled();

    video.currentTime = 10.5;
    dv.tick(0);
    expect(dispatch).toHaveBeenCalledWith(videoSync(12_500));
  });

  it('applies a user seek to the video instead of syncing back', () => {
    const { dv, video, dispatch } = setup({ currentTime: 10 });
    timeline.userSeek(62_000);
    dv.tick(0);
    expect(video.currentTime).toEqual(60);
    expect(dv.appliedSeekId).toEqual(timeline.seekId);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('clamps seeks to the video duration', () => {
    const { dv, video } = setup();
    timeline.userSeek(10_000_000);
    dv.tick(0);
    expect(video.currentTime).toEqual(600);
  });

  it('reports buffering from readyState', () => {
    const { dv, dispatch } = setup({ readyState: 2, currentTime: 0 });
    timeline.offset = 2000;
    dv.tick(0);
    expect(dispatch).toHaveBeenCalledWith(bufferVideo(true));
  });

  it('wraps a loop back to its start', () => {
    const loop = { startTime: 5000, duration: 10_000 };
    const { dv, dispatch } = setup({ loop, currentTime: 13.5 }); // offset 15.5s, past loop end
    timeline.offset = 15_500;
    dv.tick(0);
    expect(dispatch).toHaveBeenCalledWith(seek(5000));
  });

  it('pauses at the end of a full drive', () => {
    const { dv, dispatch } = setup({ ended: true, paused: true, currentTime: 600 });
    timeline.offset = 602_000;
    dv.tick(0);
    expect(dispatch).toHaveBeenCalledWith(pause());
  });

  it('backs off retrying play() when it is rejected', async () => {
    const { dv, video } = setup({ paused: true, play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))) });
    dv.tick(0);
    await new Promise((r) => setTimeout(r, 0));
    dv.tick(1);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(dv.nextPlayAt).toBeGreaterThan(1);
  });
});
