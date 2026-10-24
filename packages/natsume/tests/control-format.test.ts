import { expect, it } from 'vitest';
import { minimalDocument, encode } from './helpers.js';
import { validateDocument } from '../src/format/semantics.js';
import { verifyBuffer } from '../src/format/verify.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { AnimatorParameterT } from '../src/format/generated/noa/ir/animator-parameter.js';
import { AnimatorTransitionT } from '../src/format/generated/noa/ir/animator-transition.js';
import { AnimatorConditionT } from '../src/format/generated/noa/ir/animator-condition.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { FeatureRequirementT } from '../src/format/generated/noa/ir/feature-requirement.js';
import { ParticleRendererT } from '../src/format/generated/noa/ir/particle-renderer.js';
import { Document } from '../src/format/generated/noa/ir/document.js';
import { ByteBuffer } from 'flatbuffers';
import { animatorSupport } from '../src/runtime/animation.js';
import { PlayableDirectorT } from '../src/format/generated/noa/ir/playable-director.js';
import { TimelineT } from '../src/format/generated/noa/ir/timeline.js';
import { TimelineTrackT } from '../src/format/generated/noa/ir/timeline-track.js';

function controller() {
  const d = minimalDocument(),
    a = new AnimatorT(new SourceReferenceT(null, 1n));
  d.features.push(new FeatureRequirementT('animator.controller'));
  a.layers = [new AnimatorLayerT('Base', 0, 0, 1, [new AnimatorStateT(1, 'empty')])];
  d.components.push(new ComponentT(3, 1, true, C.Animator, a));
  return { d, a };
}
it('keeps state identifiers local to a layer, including IDs used by document entities', () => {
  const { d, a } = controller();
  a.layers.push(new AnimatorLayerT('Overlay', 0.5, 0, 1, [new AnimatorStateT(1, 'empty')]));
  expect(() => validateDocument(d)).not.toThrow();
  a.layers[1]!.states.push(new AnimatorStateT(1, 'duplicate'));
  expect(() => validateDocument(d)).toThrow(/state IDs/);
});
it('preserves controller absence and empty layers; preflight blocks unimplemented motion branches', () => {
  const { d, a } = controller();
  expect(() => validateDocument(d)).not.toThrow();
  expect(animatorSupport(a, 3).some((i) => i.field.endsWith('animationId'))).toBe(true);
  a.layers[0]!.defaultStateId = 0;
  a.layers[0]!.states = [];
  expect(() => validateDocument(d)).not.toThrow();
  a.layers = [];
  a.sourceController = null;
  expect(() => validateDocument(d)).not.toThrow();
  a.parameters = [new AnimatorParameterT('speed')];
  expect(() => validateDocument(d)).toThrow(/presence/);
});
it('validates typed conditions and transition destinations independently of playback support', () => {
  const { d, a } = controller(),
    state = a.layers[0]!.states[0]!;
  a.parameters = [new AnimatorParameterT('speed')];
  const t = new AnimatorTransitionT();
  t.destinationStateId = 1;
  t.conditions = [new AnimatorConditionT('speed', 2, 0.5)];
  state.transitions = [t];
  expect(() => validateDocument(d)).not.toThrow();
  t.conditions[0]!.mode = 0;
  expect(() => validateDocument(d)).toThrow(/parameter type/);
  t.conditions = [];
  t.destinationStateId = 2;
  expect(() => validateDocument(d)).toThrow(/destination/);
});
it('preserves absent versus present-empty trail streams through object API round trips', () => {
  const d = minimalDocument(),
    r = new ParticleRendererT();
  d.components = [new ComponentT(3, 1, true, C.ParticleRenderer, r)];
  expect(
    (
      Document.getRootAsDocument(new ByteBuffer(encode(d))).unpack().components[0]!
        .data as ParticleRendererT
    ).trailVertexStreams,
  ).toBeNull();
  r.trailVertexStreams = [];
  expect(
    (
      Document.getRootAsDocument(new ByteBuffer(encode(d))).unpack().components[0]!
        .data as ParticleRendererT
    ).trailVertexStreams,
  ).toEqual([]);
});
it('checks Timeline vector indices, parents, reachability and duplicate roots', () => {
  const d = minimalDocument(),
    p = new PlayableDirectorT(),
    t = new TimelineT(),
    track = new TimelineTrackT();
  track.source = new SourceReferenceT(null, 1n);
  track.name = 'group';
  t.roots = [0];
  t.tracks = [track];
  p.sourceAsset = new SourceReferenceT(null, 2n);
  p.timeline = t;
  d.features = ['timeline.director', 'timeline.graph'].map((f) => new FeatureRequirementT(f));
  d.components = [new ComponentT(3, 1, true, C.PlayableDirector, p)];
  expect(() => validateDocument(d)).not.toThrow();
  t.roots = [3];
  expect(() => validateDocument(d)).toThrow(/hierarchy/);
  t.roots = [0, 0];
  expect(() => validateDocument(d)).toThrow(/hierarchy/);
  t.roots = [];
  expect(() => validateDocument(d)).toThrow(/Unreachable/);
  t.roots = [0];
  track.parentIndex = 0;
  expect(() => validateDocument(d)).toThrow(/hierarchy/);
});
it('rejects previous document layouts before walking component unions', () => {
  const d = minimalDocument();
  d.formatMajor = 2;
  expect(() => verifyBuffer(encode(d), 'noir')).toThrow(/version/);
});
