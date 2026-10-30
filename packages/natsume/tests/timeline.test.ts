import { describe, expect, it, vi } from 'vitest';
import { TimelineDirector } from '../src/runtime/timeline-director.js';
import { NatsumeDirector } from '../src/runtime/director-handle.js';
import { PlayableDirectorT } from '../src/format/generated/noa/ir/playable-director.js';
import { TimelineT } from '../src/format/generated/noa/ir/timeline.js';
import { TimelineTrackT } from '../src/format/generated/noa/ir/timeline-track.js';
import { TimelineClipT } from '../src/format/generated/noa/ir/timeline-clip.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { TypedReferenceT } from '../src/format/generated/noa/ir/typed-reference.js';
import {
  timelineClipTime,
  timelineClipWeight,
  timelineDuration,
} from '../src/runtime/timeline-time.js';

function fixture(clock = 1, wrap = 0) {
  const source = new PlayableDirectorT();
  source.clock = clock;
  source.wrap = wrap;
  source.timeline = new TimelineT(1, 1);
  const graph = { evaluate: vi.fn(), pause: vi.fn(), destroy: vi.fn() };
  const create = vi.fn(() => graph);
  return { source, graph, create, director: new TimelineDirector(3, source, create, () => {}) };
}
describe('Director clocks and lifecycle', () => {
  it('preserves a truly empty Director and its references', () => {
    const { source, director, create } = fixture();
    source.timeline = null;
    director.play();
    director.evaluate();
    expect(create).not.toHaveBeenCalled();
    expect(director.state).toBe('stopped');
  });
  it('changes time without evaluating and samples an explicit manual seek', () => {
    const { director, graph } = fixture(3);
    director.play();
    director.advance(0.5);
    expect(director.time).toBe(0);
    director.setTime(1.5);
    expect(graph.evaluate).not.toHaveBeenCalled();
    director.evaluate();
    expect(graph.evaluate).toHaveBeenCalledWith(1.5, false);
  });
  it('keeps pause baselines until graph destruction', () => {
    const { director, graph } = fixture();
    director.play();
    director.advance(0.25);
    director.pause();
    director.advance(0.25);
    expect(director.time).toBe(0.25);
    expect(graph.destroy).not.toHaveBeenCalled();
    director.stop();
    expect(graph.destroy).toHaveBeenCalledTimes(1);
    expect(director.time).toBe(0);
  });
  it.each([0, 1, 2])('implements wrap mode %i', (mode) => {
    const { director, graph } = fixture(1, mode);
    director.play();
    director.advance(1.25);
    expect(director.time).toBe(mode === 0 ? 1 : mode === 1 ? 0.25 : 0);
    expect(director.state).toBe(mode === 2 ? 'stopped' : 'playing');
    expect(graph.destroy).toHaveBeenCalledTimes(mode === 2 ? 1 : 0);
  });
  it('requires an explicit unscaled clock', () => {
    const { director } = fixture(2);
    director.play();
    expect(() => director.advance(0.2)).toThrow('unscaledDeltaSeconds');
    director.advance(0.2, 0.5);
    expect(director.time).toBe(0.5);
  });
  it('uses explicit unscaled time for DSP graphs without audio outputs', () => {
    const { director } = fixture(0);
    director.play();
    expect(() => director.advance(0.2)).toThrow('unscaledDeltaSeconds');
    director.advance(0, 0.25);
    expect(director.time).toBe(0.25);
    director.pause();
    director.advance(0, 0.2);
    expect(director.time).toBe(0.25);
    director.play();
    director.advance(0, 0.2);
    expect(director.time).toBe(0.45);
  });
  it('rejects recursive evaluation and restores the guard after an exception', () => {
    const { director, graph } = fixture();
    graph.evaluate.mockImplementationOnce(() => director.evaluate());
    expect(() => director.evaluate()).toThrow('Recursive');
    expect(() => director.evaluate()).not.toThrow();
  });
  it('preserves zero binding keys and explicit null overrides', () => {
    const { director, source } = fixture();
    const key = new SourceReferenceT('abc', 0n);
    source.bindings = [{ key, target: new TypedReferenceT(1, 5) } as never];
    expect(director.resolve(key, null)?.id).toBe(5);
    director.setBinding({ guid: 'abc', fileId: 0n }, null);
    expect(director.resolve(key, new TypedReferenceT(1, 5))).toBeNull();
  });
  it.each([-1, NaN, Infinity])('rejects invalid time %s', (value) => {
    expect(() => fixture().director.setTime(value)).toThrow('finite nonnegative');
  });
  it('checks the owner on every retained public handle operation', () => {
    const { director } = fixture();
    const alive = vi.fn();
    const handle = new NatsumeDirector(director, alive, () => {});
    handle.play();
    alive.mockImplementation(() => {
      throw new Error('disposed');
    });
    expect(() => handle.getTime()).toThrow('disposed');
  });
});
describe('Timeline clip time', () => {
  const clip = Object.assign(new TimelineClipT(), {
    start: 1,
    duration: 2,
    clipIn: 0.25,
    timeScale: 2,
    preExtrapolationTime: 1,
    postExtrapolationTime: 3,
  });
  it('uses half-open clip intervals and applies ClipIn after scaling', () => {
    expect(timelineClipTime(clip, 0.99)).toBeUndefined();
    expect(timelineClipTime(clip, 1)).toBe(0.25);
    expect(timelineClipTime(clip, 2)).toBe(2.25);
    expect(timelineClipTime(clip, 3)).toBeUndefined();
  });
  it.each([
    [1, 0.25, 4.25],
    [2, 3.25, 1.25],
    [3, 1.25, 3.25],
    [4, -0.75, 5.25],
  ])('maps extrapolation mode %i', (mode, before, after) => {
    const c = Object.assign(new TimelineClipT(), clip, {
      preExtrapolation: mode,
      postExtrapolation: mode,
    });
    expect(timelineClipTime(c, 0.5)).toBe(before);
    expect(timelineClipTime(c, 3.5)).toBe(after);
    expect(timelineClipTime(c, 6)).toBeUndefined();
  });
  it('uses smooth easing when curves are absent', () => {
    const c = Object.assign(new TimelineClipT(), clip, { easeIn: 0.5, easeOut: 0.5 });
    expect(timelineClipWeight(c, 1)).toBe(0);
    expect(timelineClipWeight(c, 1.25)).toBe(0.5);
    expect(timelineClipWeight(c, 2)).toBe(1);
    expect(timelineClipWeight(c, 3)).toBe(0);
  });
  it('subtracts one discrete tick only for BasedOnClips', () => {
    const t = new TimelineT();
    t.tracks = [Object.assign(new TimelineTrackT(), { clips: [clip] })];
    expect(timelineDuration(t)).toBeCloseTo(3 - 1e-12, 14);
    t.durationMode = 1;
    t.fixedDuration = 2.7;
    expect(timelineDuration(t)).toBe(2.7);
  });
});
