import type { DeepReadonly as R } from '../pack.js';
import type { TimelineT } from '../format/generated/noa/ir/timeline.js';
import type { TimelineClipT } from '../format/generated/noa/ir/timeline-clip.js';
import { curve } from './parameters.js';

const tick = 1e-12;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const repeat = (v: number, duration: number) => ((v % duration) + duration) % duration;

/** Unity recalculates extrapolation extents from neighboring clips when building a graph. */
export function timelineTrackClips(
  clips: readonly R<TimelineClipT>[],
): readonly R<TimelineClipT>[] {
  const sorted = clips.map((c) => ({ ...c })).sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    let post = Infinity;
    const end = c.start + c.duration;
    for (const other of sorted) {
      if (other === c) continue;
      const gap = other.start - end;
      if (gap >= -1e-9) post = Math.min(post, gap);
      if (other.start <= end && other.start + other.duration > end) post = 0;
    }
    c.postExtrapolationTime = post <= 1e-5 ? 0 : post;
  }
  for (const [i, c] of sorted.entries()) {
    let pre = i === 0 ? Math.max(0, c.start) : 0;
    if (i > 0) {
      let previous: typeof c | undefined;
      for (let j = 0; j < i; j++) {
        const p = sorted[j]!;
        if (p.start + p.duration > c.start) {
          previous = undefined;
          break;
        }
        if (!previous || p.start + p.duration > previous.start + previous.duration) previous = p;
      }
      if (previous && !previous.postExtrapolation)
        pre = c.start - previous.start - previous.duration;
    }
    c.preExtrapolationTime = pre <= 1e-5 ? 0 : pre;
  }
  return clips.map(
    (c) => sorted.find((s) => s.start === c.start && s.data === c.data && s.name === c.name)!,
  );
}

/** Timeline's discrete time uses one-picosecond ticks; Fixed retains the recorded value. */
export function timelineDuration(timeline: R<TimelineT>): number {
  if (timeline.durationMode === 1) return timeline.fixedDuration;
  let end = 0;
  for (const track of timeline.tracks)
    if (!track.muted)
      for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  return end > 0 ? (Math.floor(end / tick + 0.5) - 1) * tick : 0;
}

export function timelineClipTime(clip: R<TimelineClipT>, time: number): number | undefined {
  const offset = time - clip.start;
  if (time < 0) return undefined;
  let local = offset;
  const mode = offset < 0 ? clip.preExtrapolation : clip.postExtrapolation;
  if (offset < 0 || offset >= clip.duration) {
    const extent = offset < 0 ? clip.preExtrapolationTime : clip.postExtrapolationTime;
    if (!mode || (offset < 0 ? -offset > extent : offset >= clip.duration + extent))
      return undefined;
    if (mode === 1) local = Math.max(0, Math.min(clip.duration, offset));
    if (mode === 2) local = repeat(offset, clip.duration);
    if (mode === 3)
      local = clip.duration - Math.abs(repeat(offset, 2 * clip.duration) - clip.duration);
  }
  return local * clip.timeScale + clip.clipIn;
}

/** Extrapolation holds the boundary blend weight; animation sampling may still advance. */
export function timelineClipWeight(clip: R<TimelineClipT>, time: number): number {
  const t = Math.max(clip.start, Math.min(clip.start + clip.duration, time));
  const input = clip.blendIn > 0 ? clip.blendIn : clip.easeIn;
  const output = clip.blendOut > 0 ? clip.blendOut : clip.easeOut;
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const a = input > 0 ? clamp((t - clip.start) / input) : 1;
  const b = output > 0 ? clamp((t - clip.start - clip.duration + output) / output) : 0;
  return (
    (input > 0 ? clamp(clip.mixIn?.keys.length ? curve(clip.mixIn, a) : smooth(a)) : 1) *
    (output > 0 ? clamp(clip.mixOut?.keys.length ? curve(clip.mixOut, b) : 1 - smooth(b)) : 1)
  );
}
