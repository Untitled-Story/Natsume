import { quat, vec3 } from 'gl-matrix';
import { check } from '../errors.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { AnimationT } from '../format/generated/noa/ir/animation.js';
import type { AnimationEventT } from '../format/generated/noa/ir/animation-event.js';
import type { TimelineTrackT } from '../format/generated/noa/ir/timeline-track.js';
import type { TimelineAnimationT } from '../format/generated/noa/ir/timeline-animation.js';
import type { TimelineControlT } from '../format/generated/noa/ir/timeline-control.js';
import type { TimelineClipT } from '../format/generated/noa/ir/timeline-clip.js';
import type { TypedReferenceT } from '../format/generated/noa/ir/typed-reference.js';
import type { Scene, SceneNode } from './scene.js';
import type { TimelineDirector, DirectorGraph } from './timeline-director.js';
import {
  eulerQuaternion,
  type AnimationBindings,
  type CompiledBinding,
} from './animation-bindings.js';
import {
  poseValue,
  blendValue,
  writePose,
  type AnimationPose,
  type PoseValue,
} from './animation-pose.js';
import { timelineClipTime, timelineClipWeight, timelineTrackClips } from './timeline-time.js';
import { visitAnimationEvents } from './animation-events.js';
import { AnimationProperty as P } from '../format/generated/noa/ir/animation-property.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import type { TrackT } from '../format/generated/noa/ir/track.js';

export interface TimelineControl {
  sample(seconds: number, playing: boolean): void;
  pause(outside?: boolean): void;
  destroy(): void;
}
export interface TimelineHost {
  readonly pack: EffectPack;
  readonly scene: Scene;
  readonly bindings: AnimationBindings;
  animatorPose?(id: number): ReadonlyMap<string, PoseValue> | undefined;
  defer?(action: () => void): void;
  revision?(): number;
  event(animatorId: number, clip: R<AnimationT>, event: R<AnimationEventT>): boolean;
  control(
    director: TimelineDirector,
    data: R<TimelineControlT>,
    target: SceneNode,
  ): TimelineControl;
}
interface Clip {
  readonly source: R<TimelineClipT>;
  readonly animation: R<AnimationT> | undefined;
  readonly bindings: readonly CompiledBinding[];
  readonly control: TimelineControl | undefined;
  previous: number | undefined;
  active: boolean;
}
interface Track {
  readonly source: R<TimelineTrackT>;
  readonly target: R<TypedReferenceT> | null;
  readonly node: SceneNode | undefined;
  readonly baseline: boolean;
  readonly clips: readonly Clip[];
  readonly defaults: AnimationPose;
}

/** Executable instance graph. Local track indexes never escape into entity lookups. */
export class TimelineGraph implements DirectorGraph {
  private readonly tracks: Track[] = [];
  private destroyed = false;
  constructor(
    private readonly director: TimelineDirector,
    private readonly host: TimelineHost,
  ) {
    const timeline = director.source.timeline!;
    const muted = (index: number): boolean => {
      const track = timeline.tracks[index]!;
      return track.muted || (track.parentIndex >= 0 && muted(track.parentIndex));
    };
    for (const [index, source] of timeline.tracks.entries()) {
      if (muted(index) || source.kind === 0) continue;
      const target = director.resolve(source.source!, source.target);
      const component = target?.kind === 2 ? host.pack.getComponent(target.id) : undefined;
      const node = host.scene.nodes.get(component?.nodeId ?? target?.id ?? 0);
      check(!target || node, 'HOST', 'Timeline binding target is outside this instance');
      check(
        !target || source.kind !== 1 || target.kind === 1,
        'HOST',
        'Activation binding requires a node',
      );
      check(
        !target || source.kind !== 2 || component?.dataType === C.Animator,
        'HOST',
        'Animation binding requires an Animator',
      );
      const defaults: AnimationPose = new Map();
      const clips = timelineTrackClips(source.clips).map((clip): Clip => {
        let animation: R<AnimationT> | undefined;
        let bindings: CompiledBinding[] = [];
        let control: TimelineControl | undefined;
        if (source.kind === 2 && target) {
          const data = clip.data as R<TimelineAnimationT>;
          animation = host.pack.document.animations.find((a) => a.id === data.animationId)!;
          bindings = animation.tracks.flatMap((track) => {
            const mapped = this.retarget(track, source, target);
            let binding = host.bindings.compile(mapped);
            if (!binding) return [];
            const property = track.binding!.property;
            if ([P.NodePosition, P.NodeScale, P.NodeRotation].includes(property)) {
              const original = binding;
              binding = {
                ...original,
                mask: original.mask.map(() => true),
                evaluate: (seconds) => {
                  const values = original.evaluate(seconds);
                  return values.map((value, i) =>
                    original.mask[i]
                      ? value
                      : property === P.NodeScale || (property === P.NodeRotation && i === 3)
                        ? 1
                        : 0,
                  );
                },
              };
            }
            if (!defaults.has(binding.key))
              defaults.set(binding.key, poseValue(binding, binding.read()));
            return [binding];
          });
        } else if (source.kind === 3) {
          const data = clip.data as R<TimelineControlT>;
          const reference = director.resolveExposed(
            String(data.exposedName ?? ''),
            data.defaultTarget,
          );
          const controlled = reference ? host.scene.nodes.get(reference.id) : undefined;
          check(
            !reference || controlled,
            'HOST',
            'Timeline Control target is outside this instance',
          );
          if (controlled) control = host.control(director, data, controlled);
        }
        return { source: clip, animation, bindings, control, previous: undefined, active: false };
      });
      this.tracks.push({ source, target, node, clips, baseline: node?.active ?? false, defaults });
    }
  }
  private retarget(
    track: R<TrackT>,
    source: R<TimelineTrackT>,
    target: R<TypedReferenceT>,
  ): R<TrackT> {
    if (source.target?.id === target.id) return track;
    const pack = this.host.pack;
    const from = pack.getComponent(source.target!.id)!.nodeId;
    const to = pack.getComponent(target.id)!.nodeId;
    const original = pack.getComponent(track.binding!.targetId);
    let node = pack.getNode(original?.nodeId ?? track.binding!.targetId);
    const path: string[] = [];
    while (node && node.id !== from) {
      path.unshift(String(node.name));
      node = pack.getNode(node.parentId);
    }
    check(node, 'HOST', 'Animation binding is outside its original Animator');
    let destination = this.host.scene.nodes.get(to)!;
    for (const name of path) {
      const child = this.host.scene.ordered.find(
        (n) => n.parent === destination && n.name === name,
      );
      check(child, 'HOST', 'Rebound Animator is missing animated node: ' + path.join('/'));
      destination = child;
    }
    let id = destination.id;
    if (original) {
      const index = pack.components
        .filter((c) => c.nodeId === original.nodeId && c.dataType === original.dataType)
        .findIndex((c) => c.id === original.id);
      const component = pack.components.filter(
        (c) => c.nodeId === destination.id && c.dataType === original.dataType,
      )[index];
      check(component, 'HOST', 'Rebound Animator is missing an animated component');
      id = component.id;
    }
    return { ...track, binding: { ...track.binding!, targetId: id } };
  }
  evaluate(seconds: number, playback: boolean): void {
    if (this.destroyed) return;
    const revision = this.director.version;
    const hostRevision = this.host.revision?.();
    const current = () =>
      !this.destroyed &&
      this.director.isCurrent(revision) &&
      this.host.revision?.() === hostRevision;
    const events: { animatorId: number; clip: R<AnimationT>; event: R<AnimationEventT> }[] = [];
    for (const track of this.tracks) {
      if (!current()) return;
      if (track.source.kind === 1) {
        if (track.node)
          track.node.active = track.clips.some(
            (c) => timelineClipTime(c.source, seconds) !== undefined,
          );
        continue;
      }
      const contributions = new Map<string, { pose: PoseValue; weight: number }>();
      for (const clip of track.clips) {
        const local = timelineClipTime(clip.source, seconds);
        if (local === undefined) {
          clip.control?.pause(true);
          clip.active = false;
          clip.previous = undefined;
          continue;
        }
        const wasActive = clip.active;
        clip.active = true;
        clip.control?.sample(local, playback);
        if (!current()) return;
        if (!clip.animation) continue;
        const data = clip.source.data as R<TimelineAnimationT>;
        const duration = clip.animation.durationSeconds;
        const loop = data.loop === 1 || (data.loop === 0 && clip.animation.loop);
        let time = duration > 0 && loop ? local % duration : Math.min(local, duration);
        if (time < 0) time += duration;
        const weight = timelineClipWeight(clip.source, seconds);
        for (const binding of clip.bindings) {
          const value = poseValue(binding, binding.evaluate(Math.fround(time)));
          this.offsetRoot(track, clip, binding, value, time, loop);
          const previous = contributions.get(binding.key);
          contributions.set(
            binding.key,
            previous
              ? {
                  pose: blendValue(previous.pose, value, weight / (previous.weight + weight || 1)),
                  weight: previous.weight + weight,
                }
              : { pose: value, weight },
          );
        }
        if (playback && duration > 0) {
          visitAnimationEvents(
            clip.animation.events,
            duration,
            loop,
            wasActive && clip.previous !== undefined ? clip.previous / duration : -Number.EPSILON,
            local / duration,
            (event) => {
              events.push({ animatorId: track.target!.id, clip: clip.animation!, event });
              return true;
            },
          );
        }
        clip.previous = local;
        if (!current()) return;
      }
      if (track.source.kind === 2 && track.target) {
        const pose: AnimationPose = new Map();
        for (const [key, fallback] of track.defaults) {
          const contribution = contributions.get(key);
          if (!contribution || contribution.weight <= 1e-6) continue;
          let value = contribution?.pose;
          if (
            contribution &&
            contribution.weight > 1 &&
            !contribution.pose.binding.rotation &&
            !contribution.pose.binding.discrete
          )
            value = {
              ...contribution.pose,
              value: contribution.pose.value.map((v) => v * contribution.weight),
            };
          const base = this.host.animatorPose?.(track.target.id)?.get(key) ?? fallback;
          pose.set(
            key,
            contribution && value
              ? blendValue(base, value, Math.min(1, contribution.weight))
              : base,
          );
        }
        writePose(pose);
      }
    }
    this.host.scene.update();
    for (const { animatorId, clip, event } of events) {
      if (!current() || !this.host.event(animatorId, clip, event)) return;
    }
  }
  private offsetRoot(
    track: Track,
    clip: Clip,
    binding: CompiledBinding,
    pose: PoseValue,
    time: number,
    loop: boolean,
  ): void {
    const sourceTrack = clip.animation!.tracks[clip.bindings.indexOf(binding)];
    if (!sourceTrack || sourceTrack.binding!.targetId !== track.node?.id) return;
    const property = sourceTrack.binding!.property;
    if (property !== P.NodePosition && property !== P.NodeRotation) return;
    const data = clip.source.data as R<TimelineAnimationT>;
    const first = poseValue(binding, binding.evaluate(0));
    const offsetRotation = eulerQuaternion([
      data.eulerRadians!.x,
      data.eulerRadians!.y,
      data.eulerRadians!.z,
    ]);
    const trackRotation = eulerQuaternion([
      track.source.eulerRadians!.x,
      track.source.eulerRadians!.y,
      track.source.eulerRadians!.z,
    ]);
    if (property === P.NodePosition) {
      const v = [...pose.value];
      if (data.removeStartOffset) {
        for (let i = 0; i < 3; i++) v[i] = v[i]! - first.value[i]!;
        if (loop && clip.animation!.durationSeconds > 0) {
          const end = binding.evaluate(clip.animation!.durationSeconds);
          const cycles = Math.floor(
            (clip.previous === undefined
              ? time
              : clip.source.clipIn +
                (this.director.time - clip.source.start) * clip.source.timeScale) /
              clip.animation!.durationSeconds,
          );
          for (let i = 0; i < 3; i++) v[i] = v[i]! + (end[i]! - first.value[i]!) * cycles;
        }
      }
      const p = vec3.transformQuat(vec3.create(), v as vec3, offsetRotation);
      vec3.add(p, p, [data.position!.x, data.position!.y, data.position!.z]);
      vec3.transformQuat(p, p, trackRotation);
      const offset =
        track.source.trackOffset === 1 ? track.node.localPosition : track.source.position!;
      vec3.add(p, p, [offset.x, offset.y, offset.z]);
      (pose as { value: readonly number[] }).value = Array.from(p);
    } else {
      const q = quat.clone(pose.value as quat);
      if (data.removeStartOffset)
        quat.multiply(q, quat.invert(quat.create(), first.value as quat), q);
      quat.multiply(q, offsetRotation, q);
      quat.multiply(q, trackRotation, q);
      (pose as { value: readonly number[] }).value = Array.from(q);
    }
  }
  pause(): void {
    for (const track of this.tracks)
      for (const clip of track.clips) if (clip.active) clip.control?.pause();
  }
  destroy(deferred = false): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (deferred && this.host.defer) {
      this.host.defer(() => this.restore());
      return;
    }
    this.restore();
  }
  private restore(): void {
    for (const track of this.tracks) {
      for (const clip of track.clips) clip.control?.destroy();
      if (track.source.kind === 1 && track.node) {
        if (track.source.postPlayback === 0) track.node.active = true;
        if (track.source.postPlayback === 1) track.node.active = false;
        if (track.source.postPlayback === 2) track.node.active = track.baseline;
      }
    }
    this.host.scene.update();
  }
}
