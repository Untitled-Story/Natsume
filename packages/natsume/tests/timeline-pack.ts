import { minimalDocument } from './helpers.js';
import { EffectPack } from '../src/pack.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { PlayableDirectorT } from '../src/format/generated/noa/ir/playable-director.js';
import { TimelineT } from '../src/format/generated/noa/ir/timeline.js';
import { TimelineTrackT } from '../src/format/generated/noa/ir/timeline-track.js';
import { TimelineClipT } from '../src/format/generated/noa/ir/timeline-clip.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { TypedReferenceT } from '../src/format/generated/noa/ir/typed-reference.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';

/** Small resource-free source graph shared by browser and unit lifecycle checks. */
export function timelinePack() {
  const d = minimalDocument();
  d.nodes.push(
    new NodeT(
      4,
      'target',
      1,
      true,
      new TransformT(new Vec3T(), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
    ),
    new NodeT(
      5,
      'alternate',
      1,
      true,
      new TransformT(new Vec3T(), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
    ),
  );
  const track = new TimelineTrackT(new SourceReferenceT('track', 0n), 'activation', 1);
  track.target = new TypedReferenceT(1, 4);
  track.postPlayback = 2;
  track.clips = [Object.assign(new TimelineClipT(), { start: 0.25, duration: 0.5 })];
  const timeline = new TimelineT();
  timeline.roots = [0];
  timeline.tracks = [track];
  const source = new PlayableDirectorT();
  source.clock = 3;
  source.playOnAwake = true;
  source.sourceAsset = new SourceReferenceT('timeline', 1n);
  source.timeline = timeline;
  d.components = [new ComponentT(3, 1, true, C.PlayableDirector, source)];
  return new EffectPack(d, { document: 'scene.noir', files: [] } as never, new Map(), new Map());
}
