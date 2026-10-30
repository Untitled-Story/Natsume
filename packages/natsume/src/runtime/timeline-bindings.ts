import { check } from '../errors.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { TrackT } from '../format/generated/noa/ir/track.js';
import type { TimelineTrackT } from '../format/generated/noa/ir/timeline-track.js';
import { TypedReferenceT } from '../format/generated/noa/ir/typed-reference.js';
import type { PlayableDirectorT } from '../format/generated/noa/ir/playable-director.js';
import type { TimelineAnimationT } from '../format/generated/noa/ir/timeline-animation.js';
import type { TimelineControlT } from '../format/generated/noa/ir/timeline-control.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import type { DirectorBindingKey, DirectorBindingTarget } from './director-handle.js';
import type { Scene } from './scene.js';

/** Resolves an animation path and component ordinal within a rebound Animator. */
export function retargetTimelineBinding(
  pack: EffectPack,
  scene: Scene,
  track: R<TrackT>,
  source: R<TimelineTrackT>,
  target: R<TypedReferenceT>,
): R<TrackT> {
  if (source.target?.id === target.id) return track;
  check(source.target?.kind === 2, 'HOST', 'Animation has no source Animator for retargeting');
  const from = pack.getComponent(source.target.id)!.nodeId;
  const to = pack.getComponent(target.id)!.nodeId;
  const original = pack.getComponent(track.binding!.targetId);
  let node = pack.getNode(original?.nodeId ?? track.binding!.targetId);
  const path: string[] = [];
  while (node && node.id !== from) {
    path.unshift(String(node.name));
    node = pack.getNode(node.parentId);
  }
  check(node, 'HOST', 'Animation binding is outside its original Animator');
  let destination = scene.nodes.get(to)!;
  for (const name of path) {
    const child = scene.ordered.find((n) => n.parent === destination && n.name === name);
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

/** Validates a binding before the live graph or its captured baselines are changed. */
export function validateTimelineBinding(
  pack: EffectPack,
  scene: Scene,
  source: R<PlayableDirectorT>,
  key: DirectorBindingKey,
  target: DirectorBindingTarget,
): void {
  if (target === null) return;
  check(
    (target.nodeId !== undefined) !== (target.componentId !== undefined),
    'HOST',
    'Director binding target requires exactly one nodeId or componentId',
  );
  const component =
    target.componentId !== undefined ? pack.getComponent(target.componentId) : undefined;
  check(
    (target.componentId === undefined || component) &&
      scene.nodes.has(component?.nodeId ?? target.nodeId ?? 0),
    'HOST',
    'Director binding target is outside this instance',
  );
  const reference = new TypedReferenceT(component ? 2 : 1, component?.id ?? target.nodeId!);
  for (const track of source.timeline?.tracks ?? []) {
    if (key.exposedName !== undefined) {
      for (const clip of track.clips) {
        if (clip.dataType !== 2) continue;
        const control = clip.data as R<TimelineControlT>;
        if (control.exposedName === key.exposedName)
          check(reference.kind === 1, 'HOST', 'Timeline Control binding requires a node');
      }
    } else if (track.source?.guid === key.guid && track.source.fileId === key.fileId) {
      if (track.kind === 1)
        check(reference.kind === 1, 'HOST', 'Activation binding requires a node');
      if (track.kind === 2) {
        check(component?.dataType === C.Animator, 'HOST', 'Animation binding requires an Animator');
        for (const clip of track.clips) {
          const data = clip.data as R<TimelineAnimationT>;
          const animation = pack.document.animations.find((a) => a.id === data.animationId)!;
          for (const binding of animation.tracks)
            retargetTimelineBinding(pack, scene, binding, track, reference);
        }
      }
    }
  }
}
