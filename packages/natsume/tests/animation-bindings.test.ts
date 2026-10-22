import { ActionT } from '../src/format/generated/noa/ir/action.js';
import { ActionKind } from '../src/format/generated/noa/ir/action-kind.js';
import { FeatureRequirementT } from '../src/format/generated/noa/ir/feature-requirement.js';
import { loadPack } from '../src/loader/load.js';
import { expect, it } from 'vitest';
import { EffectPack } from '../src/pack.js';
import { minimalDocument, archive, encode } from './helpers.js';
import { particleSource, vector, constant } from './particle-fixtures.js';
import { Scene } from '../src/runtime/scene.js';
import { Simulation } from '../src/runtime/simulation.js';
import { AnimationBindings, eulerQuaternion } from '../src/runtime/animation-bindings.js';
import { validateAnimationBindings } from '../src/format/animation-semantics.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { CustomDataModuleT } from '../src/format/generated/noa/ir/custom-data-module.js';
import { CustomDataStreamT } from '../src/format/generated/noa/ir/custom-data-stream.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { RectLayoutT } from '../src/format/generated/noa/ir/rect-layout.js';
import { ParticleRendererT } from '../src/format/generated/noa/ir/particle-renderer.js';
import { MaterialT } from '../src/format/generated/noa/ir/material.js';
import { TextureBindingT } from '../src/format/generated/noa/ir/texture-binding.js';
import { FloatPropertyT } from '../src/format/generated/noa/ir/float-property.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { AnimationProperty as P } from '../src/format/generated/noa/ir/animation-property.js';
import { ParticleParameter as PP } from '../src/format/generated/noa/ir/particle-parameter.js';
import { ScalarMode } from '../src/format/generated/noa/ir/scalar-mode.js';
import { TrackData as D } from '../src/format/generated/noa/ir/track-data.js';
import { Vector3TrackT } from '../src/format/generated/noa/ir/vector3-track.js';
import { Vector4TrackT } from '../src/format/generated/noa/ir/vector4-track.js';
import { RotationTrackT } from '../src/format/generated/noa/ir/rotation-track.js';
import { ColorTrackT } from '../src/format/generated/noa/ir/color-track.js';
import { FloatTrackT } from '../src/format/generated/noa/ir/float-track.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { BoolTrackT } from '../src/format/generated/noa/ir/bool-track.js';
import { BoolKeyT } from '../src/format/generated/noa/ir/bool-key.js';
import type { DocumentT } from '../src/format/generated/noa/ir/document.js';

export function packDocument(d: DocumentT): EffectPack {
  return new EffectPack(
    d,
    { format: 'noa-package', version: 1, noir_version: [2, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
}
export function animationCurve(a = 0, b = 1): ScalarCurveT {
  const c = new ScalarCurveT();
  c.keys = [
    Object.assign(new FloatKeyT(), { value: a, interpolation: 1 }),
    Object.assign(new FloatKeyT(), { time: 1, value: b }),
  ];
  return c;
}
function fixture(tracks: TrackT[]) {
  const d = minimalDocument();
  d.nodes.push(
    new NodeT(
      3,
      'target',
      1,
      true,
      new TransformT(new Vec3T(3, 4, 5), new QuaternionT(0, 0, 0, 1), new Vec3T(1.2, 0.8, 2)),
    ),
  );
  d.animations = [new AnimationT(10, 'A', 1, false, tracks)];
  d.components.push(
    new ComponentT(
      4,
      1,
      true,
      C.Animator,
      new AnimatorT(false, false, [
        new AnimatorLayerT('Base', 1, 11, [new AnimatorStateT(11, 'A', 10, 1, 0, true)]),
      ]),
    ),
  );
  return d;
}
const vtrack = (
  property: P,
  target = 3,
  x = animationCurve(),
  y: ScalarCurveT | null = null,
  z: ScalarCurveT | null = null,
) => new TrackT(new BindingT(target, property), D.Vector3Track, new Vector3TrackT(x, y, z));

it('uses action-entry channels without accumulating and isolates two instances through restart', () => {
  const p = packDocument(fixture([vtrack(P.NodePosition)])),
    a = new Simulation(p),
    b = new Simulation(p);
  a.play();
  b.play();
  a.update(0.1);
  expect(a.scene.nodes.get(3)!.localPosition).toEqual({ x: expect.closeTo(0.1), y: 4, z: 5 });
  expect(b.scene.nodes.get(3)!.localPosition.x).toBe(0);
  a.scene.nodes.get(3)!.localPosition.y = 99;
  a.update(1 / 60);
  expect(a.scene.nodes.get(3)!.localPosition.y).toBe(4);
  a.restart();
  expect(a.scene.nodes.get(3)!.localPosition).toEqual({ x: 0, y: 4, z: 5 });
  expect(p.getNode(3)!.transform!.position!.x).toBe(3);
});
it.each([false, true])(
  'restores Animator startup defaults on state switch when enabled=%s',
  (defaults) => {
    const d = fixture([vtrack(P.NodePosition, 3, animationCurve(9, 9))]);
    d.animations.push(
      new AnimationT(12, 'B', 1, false, [vtrack(P.NodeScale, 3, animationCurve(8, 8))]),
    );
    (d.components[0]!.data as AnimatorT).layers[0]!.states.push(
      new AnimatorStateT(13, 'B', 12, 1, 0, defaults),
    );
    const s = new Simulation(packDocument(d));
    s.play();
    s.applyAnimatorState(4, 'B');
    expect(s.scene.nodes.get(3)!.localPosition.x).toBe(defaults ? 3 : 9);
    expect(s.scene.nodes.get(3)!.localScale).toEqual({ x: 8, y: 0.8, z: 2 });
  },
);
it('starts an initially inactive Animator on activation and freezes a disabled component', () => {
  const d = fixture([vtrack(P.NodePosition)]);
  d.nodes[0]!.active = false;
  const s = new Simulation(packDocument(d));
  s.play();
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(3);
  s.setNodeActive(1, true);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBeCloseTo(1 / 60);
  s.bindings.enabled.set(4, false);
  s.update(0.1);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBeCloseTo(1 / 60);
  s.bindings.enabled.set(4, true);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBeCloseTo(2 / 60);
});
it('uses Euler ZXY and normalizes sampled quaternion components', () => {
  const d = fixture([
    new TrackT(
      new BindingT(3, P.NodeRotation),
      D.RotationTrack,
      new RotationTrackT(
        1,
        animationCurve(6, 8),
        animationCurve(0.2, 0.5),
        animationCurve(-0.3, 0.9),
      ),
    ),
  ]);
  const s = new Simulation(packDocument(d));
  s.play();
  s.update(0.1);
  const q = s.scene.nodes.get(3)!.localRotation,
    expected = eulerQuaternion([6.2, 0.23, -0.18]);
  expect([q.x, q.y, q.z, q.w]).toEqual(Array.from(expected).map((v) => expect.closeTo(v, 5)));
  const r = new TrackT(
    new BindingT(3, P.NodeRotation),
    D.RotationTrack,
    new RotationTrackT(
      0,
      animationCurve(2, 2),
      animationCurve(),
      animationCurve(),
      animationCurve(2, 2),
    ),
  );
  const b = s.bindings.compile(r)!;
  b.sample(0.5);
  expect(Math.hypot(...b.read())).toBeCloseTo(1);
});
it('updates nested stretched layouts, localPosition links and root container size', () => {
  const d = fixture([
    vtrack(P.RectSizeDelta, 5, animationCurve(200, 400), animationCurve(100, 200)),
  ]);
  const root = new RectLayoutT();
  root.anchorMin = new Vec2T();
  root.anchorMax = new Vec2T();
  root.pivot = new Vec2T(0.3, 0.7);
  root.sizeDelta = new Vec2T(200, 100);
  root.anchoredPosition = new Vec3T();
  const child = new RectLayoutT();
  child.anchorMin = new Vec2T(0.1, 0.2);
  child.anchorMax = new Vec2T(0.8, 0.9);
  child.pivot = new Vec2T(0.25, 0.75);
  child.sizeDelta = new Vec2T(20, -10);
  child.anchoredPosition = new Vec3T(3, 4, 5);
  d.components.push(
    new ComponentT(5, 1, true, C.RectLayout, root),
    new ComponentT(6, 3, true, C.RectLayout, child),
  );
  const s = new Simulation(packDocument(d));
  s.play();
  s.update(0.1);
  expect(s.scene.layoutSize!.width).toBeCloseTo(220);
  expect(s.scene.nodes.get(3)!.layout!.width).toBeCloseTo(174);
  const before = s.scene.nodes.get(3)!.localPosition.x;
  s.bindings.compile(vtrack(P.NodePosition, 3, animationCurve(42, 42)))!.sample(0);
  s.scene.update();
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(42);
  expect(before).not.toBe(42);
  s.scene.nodes.get(3)!.layoutDirty = true;
  s.scene.update();
  expect(s.scene.nodes.get(3)!.localPosition.x).toBeCloseTo(42);
});
it.each([ScalarMode.Constant, ScalarMode.TwoConstants, ScalarMode.Curve, ScalarMode.TwoCurves])(
  'writes MinMaxCurve source branches without changing mode %s',
  (mode) => {
    const t = new TrackT(
      new BindingT(5, P.ParticleParameter, PP.StartSizeX, 'scalar'),
      D.FloatTrack,
      new FloatTrackT(animationCurve(2, 4)),
    );
    const d = fixture([t]),
      ps = particleSource();
    ps.main!.size!.x!.mode = mode;
    d.components.push(new ComponentT(5, 3, true, C.ParticleSystem, ps));
    const pack = packDocument(d),
      scene = new Scene(pack, [1]),
      a = new AnimationBindings(pack, scene),
      b = new AnimationBindings(pack, scene);
    a.compile(t)!.sample(0.5);
    const parameter = a.systems.get(5)!.main!.size!.x!;
    expect(parameter.mode).toBe(mode);
    expect(
      parameter[
        mode === ScalarMode.Curve || mode === ScalarMode.TwoCurves ? 'multiplier' : 'constantMax'
      ],
    ).toBe(3);
    expect(
      a.systems.get(5)!.main!.size!.y![
        mode === ScalarMode.Curve || mode === ScalarMode.TwoCurves ? 'multiplier' : 'constantMax'
      ],
    ).toBe(3);
    expect(b.systems.get(5)!.main!.size!.x!.constantMax).toBe(1);
    const min = structuredClone(t) as TrackT;
    min.binding!.propertyName = 'minScalar';
    a.compile(min)!.sample(0.25);
    expect(parameter.constantMin).toBe(2.5);
    a.reset();
    expect(parameter.constantMax).toBe(1);
  },
);
it('updates particle colors, custom slots, loop, emission, velocity and all source scalar endpoints', () => {
  const ps = particleSource();
  ps.main!.size3d = true;
  ps.main!.rotation3d = true;
  ps.main!.color = new ColorParameterT(
    2,
    new ColorT(0.1, 0.2, 0.3, 0.4),
    new ColorT(0.5, 0.6, 0.7, 0.8),
  );
  ps.main!.gravityMultiplier = constant(0);
  ps.modules.push(
    new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(7), constant(2))),
    new ParticleModuleT(M.VelocityModule, new VelocityModuleT(vector(1, 2, 3))),
    new ParticleModuleT(
      M.CustomDataModule,
      new CustomDataModuleT([
        new CustomDataStreamT(0, 2, 0, [], structuredClone(ps.main!.color)),
        new CustomDataStreamT(1, 2, 0, [], structuredClone(ps.main!.color)),
      ]),
    ),
  );
  const tracks: TrackT[] = [];
  for (let p = PP.StartLifetime; p <= PP.VelocityZ; p++)
    tracks.push(
      new TrackT(
        new BindingT(5, P.ParticleParameter, p, 'scalar'),
        D.FloatTrack,
        new FloatTrackT(animationCurve(2, 4)),
      ),
    );
  tracks.push(
    new TrackT(
      new BindingT(5, P.ParticleColor, 0, 'maxColor'),
      D.ColorTrack,
      new ColorTrackT(animationCurve(0.2, 0.8)),
    ),
    new TrackT(
      new BindingT(5, P.ParticleCustomColor, 0, 'minColor', 1),
      D.ColorTrack,
      new ColorTrackT(null, animationCurve(0.3, 0.7)),
    ),
    new TrackT(
      new BindingT(5, P.ParticleLoop),
      D.BoolTrack,
      new BoolTrackT([new BoolKeyT(0, true), new BoolKeyT(0.5, false)]),
    ),
  );
  const d = fixture(tracks);
  d.components.push(new ComponentT(5, 3, true, C.ParticleSystem, ps));
  const a = new AnimationBindings(
    packDocument(d),
    new Scene(packDocument(structuredClone(d) as DocumentT), [1]),
  );
  for (const track of tracks) a.compile(track)!.sample(0.5);
  const p = a.systems.get(5)!;
  expect(p.main!.speed!.constantMax).toBe(3);
  expect(p.main!.loop).toBe(false);
  expect(p.main!.color!.colorMax!.r).toBeCloseTo(0.5);
  expect(p.main!.color!.colorMax!.g).toBe(0.6);
  const custom = p.modules.find((m) => m.dataType === M.CustomDataModule)!
    .data as CustomDataModuleT;
  expect(custom.streams[1]!.color!.colorMin!.g).toBeCloseTo(0.5);
  expect(custom.streams[0]!.color!.colorMin!.g).toBe(0.2);
});
it('isolates renderer overrides from another renderer sharing its material and from other instances', () => {
  const tracks = [
    new TrackT(
      new BindingT(5, P.RendererMaterialTint, 0, '_TintColor'),
      D.ColorTrack,
      new ColorTrackT(animationCurve(0.2, 0.8)),
    ),
    new TrackT(
      new BindingT(5, P.RendererMaterialFloat, 0, '_InvFade'),
      D.FloatTrack,
      new FloatTrackT(animationCurve(2, 4)),
    ),
    new TrackT(
      new BindingT(5, P.RendererTextureST, 0, '_MainTex'),
      D.Vector4Track,
      new Vector4TrackT(animationCurve(2, 4), null, null, animationCurve(0.1, 0.9)),
    ),
  ];
  const d = fixture(tracks),
    r = new ParticleRendererT();
  r.materials = [7];
  d.components.push(
    new ComponentT(5, 3, true, C.ParticleRenderer, r),
    new ComponentT(6, 1, true, C.ParticleRenderer, structuredClone(r)),
  );
  const m = new MaterialT(7, 'material', 5, new ColorT(0.2, 0.4, 0.6, 0.8));
  m.textures = [new TextureBindingT('_MainTex', 0, 0, new Vec2T(2, 3), new Vec2T(0.1, 0.2))];
  m.floats = [new FloatPropertyT('_InvFade', 2)];
  d.materials = [m];
  const p = packDocument(d),
    a = new AnimationBindings(p, new Scene(p, [1])),
    b = new AnimationBindings(p, new Scene(p, [1]));
  for (const t of tracks) a.compile(t)!.sample(0.5);
  expect(a.materials.get('5:0')!.tint!.r).toBeCloseTo(0.5);
  expect(a.materials.get('5:0')!.floats[0]!.value).toBe(3);
  expect(a.materials.get('5:0')!.textures[0]!.offset!.y).toBeCloseTo(0.5);
  expect(a.materials.has('6:0')).toBe(false);
  expect(b.materials.get('5:0')!.floats[0]!.value).toBe(2);
  expect(p.document.materials[0]!.floats[0]!.value).toBe(2);
  a.reset();
  expect(a.materials.get('5:0')!.floats[0]!.value).toBe(2);
});
it('rejects source branches and targets that cannot execute', () => {
  const d = fixture([vtrack(P.NodeScale)]);
  validateAnimationBindings(d, () => {});
  d.animations[0]!.tracks[0]!.binding!.targetId = 4;
  expect(() => validateAnimationBindings(d, () => {})).toThrow('Invalid animation');
  d.animations[0]!.tracks = [
    new TrackT(
      new BindingT(4, P.ComponentEnabled),
      D.BoolTrack,
      new BoolTrackT([new BoolKeyT(0, true)]),
    ),
  ];
  validateAnimationBindings(d, () => {});
  d.components[0]!.dataType = C.ParticleSystem;
  expect(() => validateAnimationBindings(d, () => {})).toThrow('Invalid animation');
});

it('orders overlapping writers by priority and preserves settings across switches and restart', () => {
  const d = fixture([vtrack(P.NodePosition, 3, animationCurve(9, 9))]);
  d.animations.push(
    new AnimationT(12, 'B', 1, false, [vtrack(P.NodePosition, 3, animationCurve(8, 8))]),
  );
  d.components.push(
    new ComponentT(
      14,
      1,
      true,
      C.Animator,
      new AnimatorT(false, false, [
        new AnimatorLayerT('Base', 1, 13, [new AnimatorStateT(13, 'B', 12)]),
      ]),
    ),
  );
  const s = new Simulation(packDocument(d));
  s.play();
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
  expect(s.diagnostics.some((d) => d.code === 'NATSUME_ANIMATION_ORDER')).toBe(true);
  s.setAnimationPriority({ animatorId: 4 }, 10);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
  expect(s.diagnostics.some((d) => d.code === 'NATSUME_ANIMATION_ORDER')).toBe(false);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(9);
  s.applyAnimatorState(14, 'B');
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(9);
  s.restart();
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(9);
  s.setAnimationPriority({ animatorId: 4 }, 0);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
  expect(s.diagnostics.filter((d) => d.code === 'NATSUME_ANIMATION_ORDER')).toHaveLength(1);
  expect(() => s.setAnimationPriority({ animatorId: 999 }, 1)).toThrow('Unknown Animator');
  expect(() => s.setAnimationPriority({ clipId: 10 }, 1)).toThrow('Unknown entry PlayClip');
  expect(() => s.setAnimationPriority({ animatorId: 4 }, NaN)).toThrow(
    'Invalid animation priority',
  );
});
it('keeps registration order on state changes and re-registers an Animator when re-enabled', () => {
  const d = fixture([vtrack(P.NodePosition, 3, animationCurve(9, 9))]);
  d.animations.push(
    new AnimationT(12, 'B', 1, false, [vtrack(P.NodePosition, 3, animationCurve(8, 8))]),
  );
  d.components.push(
    new ComponentT(
      14,
      1,
      true,
      C.Animator,
      new AnimatorT(true, false, [
        new AnimatorLayerT('Base', 1, 13, [new AnimatorStateT(13, 'B', 12)]),
      ]),
    ),
  );
  const s = new Simulation(packDocument(d));
  s.play();
  s.applyAnimatorState(4, 'A');
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
  s.bindings.enabled.set(4, false);
  s.update(1 / 60);
  s.bindings.enabled.set(4, true);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(9);
});

it('allows an entry PlayClip to be prioritized alongside Animator writers', () => {
  const d = fixture([vtrack(P.NodePosition, 3, animationCurve(9, 9))]);
  d.animations.push(
    new AnimationT(12, 'clip', 1, false, [vtrack(P.NodePosition, 3, animationCurve(8, 8))]),
  );
  const action = new ActionT();
  action.kind = ActionKind.PlayClip;
  action.animationId = 12;
  d.entries[0]!.actions = [action];
  const s = new Simulation(packDocument(d));
  s.play();
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
  s.setAnimationPriority({ clipId: 12 }, -1);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(9);
  s.setAnimationPriority({ clipId: 12 }, 20);
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localPosition.x).toBe(8);
});
it('loads executable transform capabilities and rejects missing capability declarations', async () => {
  const d = fixture([vtrack(P.NodeScale)]);
  d.features = [new FeatureRequirementT('animation.transform')];
  const pack = await loadPack(await archive(encode(d)));
  const s = new Simulation(pack);
  s.play();
  s.update(1 / 60);
  expect(s.scene.nodes.get(3)!.localScale.x).toBeCloseTo(1 / 60);
  d.features = [];
  await expect(loadPack(await archive(encode(d)))).rejects.toThrow('animation.transform');
});
