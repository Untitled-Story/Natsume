import { Simulation } from '../src/runtime/simulation.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { expect, it } from 'vitest';
import { quat } from 'gl-matrix';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { particleSource, vector, constant } from './particle-fixtures.js';
import { Scene } from '../src/runtime/scene.js';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { recordError } from './measurement.js';
import { hasNativeFixture, readNativeFixture } from './native-fixture.js';
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
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { AnimationProperty as P } from '../src/format/generated/noa/ir/animation-property.js';
import { ParticleParameter as PP } from '../src/format/generated/noa/ir/particle-parameter.js';
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

type V3 = { x: number; y: number; z: number };
interface Case {
  label: string;
  kind: string;
  property: string;
  variant: number;
  holdout: boolean;
  channels: { name: string; first: number; last: number }[];
  samples: {
    time: number;
    position: V3;
    rotation: V3 & { w: number };
    scale: V3;
    world: number[];
    values: number[];
    anchored: V3;
    size: V3;
    anchorMin: V3;
    anchorMax: V3;
    pivot: V3;
    active: boolean;
    enabled: boolean;
  }[];
}
const native = JSON.parse(readNativeFixture('unity-animation-bindings.json')) as {
  cases: Case[];
  particleHasEnabled?: boolean;
  states?: { writeDefaults: boolean; first: number[]; second: number[] }[];
  disables?: {
    keepState: boolean;
    writeDefaults: boolean;
    nodeInactive: boolean;
    before: number;
    disabled: number;
    resumed: number;
    beforeTime: number;
    disabledTime: number;
    resumedTime: number;
  }[];
  conflicts?: { childCreatedFirst: boolean; value: number; reenabledValue: number }[];
};
const q = (x: number, y: number, z: number) => {
  const v = quat.fromEuler(quat.create(), x, y, z, 'yxz');
  return new QuaternionT(...(Array.from(v) as [number, number, number, number]));
};
function curve(a: number, b: number, scale = 1) {
  const c = new ScalarCurveT();
  c.keys = [
    Object.assign(new FloatKeyT(), { value: a * scale, interpolation: 1 }),
    Object.assign(new FloatKeyT(), { time: 1, value: b * scale }),
  ];
  return c;
}
function setup(c: Case) {
  const d = minimalDocument();
  d.nodes[0]!.transform = new TransformT(new Vec3T(2, -3, 4), q(10, 20, 30), new Vec3T(2, 3, 0.5));
  d.nodes.push(
    new NodeT(
      3,
      'target',
      1,
      true,
      new TransformT(new Vec3T(3, 4, 5), q(20, 35, 55), new Vec3T(1.2, 0.8, 2)),
    ),
  );
  const fields = Object.fromEntries(
    c.channels.map((v) => [
      v.name,
      curve(v.first, v.last, c.property === 'localEulerAnglesRaw' ? Math.PI / 180 : 1),
    ]),
  );
  const bool = new BoolTrackT(c.channels.map(() => new BoolKeyT(0, true)));
  bool.keys.push(new BoolKeyT(1, false));
  let track: TrackT;
  if (c.kind === 'transform') {
    const property = (
      {
        m_LocalPosition: P.NodePosition,
        m_LocalScale: P.NodeScale,
        m_LocalRotation: P.NodeRotation,
        localEulerAnglesRaw: P.NodeRotation,
      } as Record<string, P>
    )[c.property]!;
    track = new TrackT(
      new BindingT(3, property),
      property === P.NodeRotation ? D.RotationTrack : D.Vector3Track,
      property === P.NodeRotation
        ? new RotationTrackT(
            c.property === 'localEulerAnglesRaw' ? 1 : 0,
            fields.x,
            fields.y,
            fields.z,
            fields.w,
          )
        : new Vector3TrackT(
            fields.x,
            fields.y,
            c.property === 'm_AnchoredPosition' ? null : fields.z,
          ),
    );
  } else if (c.kind === 'layout') {
    d.nodes[0]!.transform = minimalDocument().nodes[0]!.transform;
    const parent = new RectLayoutT(
      new Vec2T(),
      new Vec2T(),
      new Vec2T(0.3, 0.7),
      new Vec3T(),
      new Vec2T(200, 100),
    );
    const child = new RectLayoutT(
      new Vec2T(0.1, 0.2),
      new Vec2T(0.8, 0.9),
      new Vec2T(0.25, 0.75),
      new Vec3T(3, 4, 5),
      new Vec2T(20, -10),
    );
    d.components.push(
      new ComponentT(5, 1, true, C.RectLayout, parent),
      new ComponentT(6, 3, true, C.RectLayout, child),
    );
    const property = (
      {
        m_AnchoredPosition: P.RectAnchoredPosition,
        m_SizeDelta: P.RectSizeDelta,
        m_AnchorMin: P.RectAnchorMin,
        m_AnchorMax: P.RectAnchorMax,
        m_Pivot: P.RectPivot,
      } as Record<string, P>
    )[c.property]!;
    track = new TrackT(
      new BindingT(6, property),
      D.Vector3Track,
      new Vector3TrackT(fields.x, fields.y, c.property === 'm_AnchoredPosition' ? null : fields.z),
    );
  } else if (c.kind === 'particle') {
    const ps = particleSource();
    ps.main!.lifetime = constant(5);
    ps.main!.lifetime!.mode = 2;
    ps.main!.lifetime!.constantMin = 2;
    ps.main!.speed = constant(3);
    ps.main!.size = vector(2, 3, 4);
    ps.main!.rotation = vector(0.1, 0.2, 0.3);
    ps.main!.size3d = true;
    ps.main!.rotation3d = true;
    ps.main!.gravityMultiplier = constant(0);
    ps.main!.color = new ColorParameterT(
      2,
      new ColorT(0.2, 0.3, 0.4, 0.5),
      new ColorT(0.6, 0.7, 0.8, 0.9),
    );
    const color = () =>
      new ColorParameterT(2, new ColorT(0.1, 0.2, 0.3, 0.4), new ColorT(0.5, 0.6, 0.7, 0.8));
    ps.modules.push(
      new ParticleModuleT(M.EmissionModule, new EmissionModuleT(constant(7), constant(2))),
      new ParticleModuleT(M.VelocityModule, new VelocityModuleT(vector(1, 2, 3))),
      new ParticleModuleT(
        M.CustomDataModule,
        new CustomDataModuleT([
          new CustomDataStreamT(0, 2, 0, [], color()),
          new CustomDataStreamT(1, 2, 0, [], color()),
        ]),
      ),
    );
    d.components.push(new ComponentT(5, 3, true, C.ParticleSystem, ps));
    const parts = c.property.split('.'),
      source = parts.slice(0, 2).join('.');
    const parameters: Record<string, PP> = {
      'InitialModule.startLifetime': PP.StartLifetime,
      'InitialModule.startSpeed': PP.StartSpeed,
      'InitialModule.startSize': PP.StartSizeX,
      'InitialModule.startSizeY': PP.StartSizeY,
      'InitialModule.startSizeZ': PP.StartSizeZ,
      'InitialModule.startRotationX': PP.StartRotationX,
      'InitialModule.startRotationY': PP.StartRotationY,
      'InitialModule.startRotation': PP.StartRotationZ,
      'InitialModule.gravityModifier': PP.GravityMultiplier,
      'EmissionModule.rateOverTime': PP.RateOverTime,
      'EmissionModule.rateOverDistance': PP.RateOverDistance,
      'VelocityModule.x': PP.VelocityX,
      'VelocityModule.y': PP.VelocityY,
      'VelocityModule.z': PP.VelocityZ,
    };
    if (c.property === 'looping')
      track = new TrackT(new BindingT(5, P.ParticleLoop), D.BoolTrack, bool);
    else if (parts.length === 4) {
      const data = new ColorTrackT();
      Object.assign(data, { [parts[3]!]: fields[''] });
      track = new TrackT(
        new BindingT(
          5,
          source.startsWith('Initial') ? P.ParticleColor : P.ParticleCustomColor,
          0,
          parts[2],
          source.endsWith('1') ? 1 : 0,
        ),
        D.ColorTrack,
        data,
      );
    } else
      track = new TrackT(
        new BindingT(5, P.ParticleParameter, parameters[source], parts[2]),
        D.FloatTrack,
        new FloatTrackT(fields['']),
      );
  } else if (c.kind === 'material' || c.kind === 'renderer') {
    const r = new ParticleRendererT();
    r.materials = [7];
    d.components.push(new ComponentT(5, 3, true, C.ParticleRenderer, r));
    const m = new MaterialT(7, 'material', 5, new ColorT(0.2, 0.4, 0.6, 0.8));
    m.textures = [new TextureBindingT('_MainTex', 0, 0, new Vec2T(2, 3), new Vec2T(0.1, 0.2))];
    m.floats = [new FloatPropertyT('_InvFade', 2)];
    d.materials = [m];
    track =
      c.kind === 'renderer'
        ? new TrackT(new BindingT(5, P.RendererEnabled), D.BoolTrack, bool)
        : c.property === '_TintColor'
          ? new TrackT(
              new BindingT(5, P.RendererMaterialTint, 0, '_TintColor'),
              D.ColorTrack,
              new ColorTrackT(fields.r, fields.g, fields.b, fields.a),
            )
          : c.property === '_MainTex_ST'
            ? new TrackT(
                new BindingT(5, P.RendererTextureST, 0, '_MainTex'),
                D.Vector4Track,
                new Vector4TrackT(fields.x, fields.y, fields.z, fields.w),
              )
            : new TrackT(
                new BindingT(5, P.RendererMaterialFloat, 0, '_InvFade'),
                D.FloatTrack,
                new FloatTrackT(fields['']),
              );
  } else track = new TrackT(new BindingT(3, P.NodeActive), D.BoolTrack, bool);
  d.animations = [new AnimationT(10, 'clip', 1, false, [track])];
  const pack = new EffectPack(
      d,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [1, 0],
        document: 'scene.noir',
        files: [],
      },
      new Map(),
      new Map(),
    ),
    scene = new Scene(pack, [1]),
    bindings = new AnimationBindings(pack, scene);
  return { scene, binding: bindings.compile(track)! };
}
it.skipIf(!hasNativeFixture('unity-animation-bindings.json'))(
  'matches native transform, layout, particle endpoints and renderer property blocks',
  () => {
    for (const c of native.cases) {
      if (c.property === 'm_Enabled' && c.kind === 'particle') continue;
      // Native vector clips synthesize zero missing channels; NOAP explicitly preserves the entry baseline.
      if (c.channels.length === 1 && ['transform', 'layout'].includes(c.kind)) continue;
      const { scene, binding } = setup(c);
      for (const s of c.samples) {
        binding.sample(s.time);
        scene.update();
        let actual: number[], expected: number[];
        if (c.kind === 'transform') {
          actual = Array.from(scene.nodes.get(3)!.worldMatrix);
          expected = s.world;
        } else if (c.kind === 'layout') {
          const n = scene.nodes.get(3)!;
          actual = [
            n.localPosition.x,
            n.localPosition.y,
            n.localPosition.z,
            n.layout!.width,
            n.layout!.height,
          ];
          const parentSize = { x: 200, y: 100 };
          expected = [
            s.position.x,
            s.position.y,
            s.position.z,
            parentSize.x * (s.anchorMax.x - s.anchorMin.x) + s.size.x,
            parentSize.y * (s.anchorMax.y - s.anchorMin.y) + s.size.y,
          ];
        } else if (c.kind === 'active' || c.kind === 'renderer') {
          actual = binding.read();
          expected = [Number(c.kind === 'active' ? s.active : s.enabled)];
        } else {
          actual = binding.read();
          expected = s.values;
          if (c.kind === 'particle' && c.property.split('.').length === 4)
            actual = [actual[['r', 'g', 'b', 'a'].indexOf(c.property.split('.')[3]!)]!];
          else if (c.kind === 'material' && c.channels.length === 1 && c.property !== '_InvFade') {
            actual = [actual[0]!];
            expected = [expected[0]!];
          }
        }
        for (let i = 0; i < actual.length; i++) {
          const error = actual[i]! - expected[i]!;
          recordError(
            `animation.binding.${c.holdout ? 'holdout' : 'primary'}.${c.kind}.${c.property}`,
            error,
            c.kind === 'transform' || c.kind === 'layout' ? 'scene-unit' : 'value',
            `${c.label}/${s.time}/${i}`,
          );
          expect(Math.abs(error), `${c.label}/${s.time}/${i}`).toBeLessThan(
            c.kind === 'layout' ? 1e-3 : 2e-4,
          );
        }
      }
    }
    expect(native.particleHasEnabled).toBe(false);
  },
);

it.skipIf(!hasNativeFixture('unity-animation-bindings.json'))(
  'matches native state defaults, disabling and re-registration ordering',
  () => {
    for (const c of native.disables ?? []) {
      const d = minimalDocument();
      d.nodes.push(
        new NodeT(
          3,
          'target',
          1,
          true,
          new TransformT(new Vec3T(3, 4, 5), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
        ),
      );
      d.animations = [
        new AnimationT(10, 'A', 1, false, [
          new TrackT(
            new BindingT(3, P.NodePosition),
            D.Vector3Track,
            new Vector3TrackT(curve(9, 9)),
          ),
        ]),
      ];
      d.components = [
        new ComponentT(
          4,
          1,
          true,
          C.Animator,
          new AnimatorT(c.keepState, c.writeDefaults, [
            new AnimatorLayerT('Base', 1, 11, [new AnimatorStateT(11, 'A', 10, 1, 0, true)]),
          ]),
        ),
      ];
      const pack = new EffectPack(
        d,
        {
          format: 'noa-package',
          version: 1,
          noir_version: [1, 0],
          document: 'scene.noir',
          files: [],
        },
        new Map(),
        new Map(),
      );
      const s = new Simulation(pack);
      s.play();
      s.update(1 / 60);
      const actual = [s.scene.nodes.get(3)!.localPosition.x];
      if (c.nodeInactive) s.setNodeActive(1, false);
      else {
        s.bindings.enabled.set(4, false);
        s.update(0);
      }
      actual.push(s.scene.nodes.get(3)!.localPosition.x);
      if (c.nodeInactive) s.setNodeActive(1, true);
      else {
        s.bindings.enabled.set(4, true);
        s.update(0);
      }
      actual.push(s.scene.nodes.get(3)!.localPosition.x);
      [c.before, c.disabled, c.resumed].forEach((v, i) => {
        recordError(
          'animation.lifecycle.disable',
          actual[i]! - v,
          'value',
          `${c.keepState}/${c.writeDefaults}/${c.nodeInactive}/${i}`,
        );
        expect(actual[i]).toBe(v);
      });
    }
    for (const c of native.states ?? []) {
      const d = minimalDocument();
      d.nodes.push(
        new NodeT(
          3,
          'target',
          1,
          true,
          new TransformT(new Vec3T(3, 4, 5), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
        ),
      );
      d.animations = [
        new AnimationT(10, 'A', 1, false, [
          new TrackT(
            new BindingT(3, P.NodePosition),
            D.Vector3Track,
            new Vector3TrackT(curve(9, 9)),
          ),
        ]),
        new AnimationT(12, 'B', 1, false, [
          new TrackT(new BindingT(3, P.NodeScale), D.Vector3Track, new Vector3TrackT(curve(8, 8))),
        ]),
      ];
      d.components = [
        new ComponentT(
          4,
          1,
          true,
          C.Animator,
          new AnimatorT(false, false, [
            new AnimatorLayerT('Base', 1, 11, [
              new AnimatorStateT(11, 'A', 10, 1, 0, true),
              new AnimatorStateT(13, 'B', 12, 1, 0, c.writeDefaults),
            ]),
          ]),
        ),
      ];
      const pack = new EffectPack(
          d,
          {
            format: 'noa-package',
            version: 1,
            noir_version: [1, 0],
            document: 'scene.noir',
            files: [],
          },
          new Map(),
          new Map(),
        ),
        sim = new Simulation(pack);
      sim.play();
      recordError(
        'animation.lifecycle.state-defaults',
        sim.scene.nodes.get(3)!.localPosition.x - c.first[0]!,
        'scene-unit',
        String(c.writeDefaults) + '/first',
      );
      sim.applyAnimatorState(4, 'B');
      const actual = sim.scene.nodes.get(3)!.localPosition.x;
      recordError(
        'animation.lifecycle.state-defaults',
        actual - c.second[0]!,
        'scene-unit',
        String(c.writeDefaults) + '/second',
      );
      expect(actual).toBe(c.second[0]);
    }
    for (const c of native.conflicts ?? []) {
      const d = minimalDocument();
      d.nodes.push(
        new NodeT(3, 'owner', 1, true, d.nodes[0]!.transform),
        new NodeT(5, 'target', 3, true, d.nodes[0]!.transform),
      );
      d.animations = [
        new AnimationT(10, 'parent', 1, false, [
          new TrackT(
            new BindingT(5, P.NodePosition),
            D.Vector3Track,
            new Vector3TrackT(curve(9, 9)),
          ),
        ]),
        new AnimationT(12, 'child', 1, false, [
          new TrackT(
            new BindingT(5, P.NodePosition),
            D.Vector3Track,
            new Vector3TrackT(curve(8, 8)),
          ),
        ]),
      ];
      const parent = new ComponentT(
          4,
          1,
          true,
          C.Animator,
          new AnimatorT(true, false, [
            new AnimatorLayerT('Base', 1, 11, [new AnimatorStateT(11, 'A', 10)]),
          ]),
        ),
        child = new ComponentT(
          6,
          3,
          true,
          C.Animator,
          new AnimatorT(true, false, [
            new AnimatorLayerT('Base', 1, 13, [new AnimatorStateT(13, 'B', 12)]),
          ]),
        );
      d.components = c.childCreatedFirst ? [child, parent] : [parent, child];
      const pack = new EffectPack(
          d,
          {
            format: 'noa-package',
            version: 1,
            noir_version: [1, 0],
            document: 'scene.noir',
            files: [],
          },
          new Map(),
          new Map(),
        ),
        sim = new Simulation(pack);
      sim.play();
      sim.update(1 / 60);
      let actual = sim.scene.nodes.get(5)!.localPosition.x;
      expect(actual).toBe(c.value);
      recordError(
        'animation.lifecycle.registration',
        actual - c.value,
        'scene-unit',
        String(c.childCreatedFirst),
      );
      const first = c.childCreatedFirst ? 6 : 4;
      sim.bindings.enabled.set(first, false);
      sim.update(0);
      sim.bindings.enabled.set(first, true);
      sim.update(1 / 60);
      actual = sim.scene.nodes.get(5)!.localPosition.x;
      expect(actual).toBe(c.reenabledValue);
      recordError(
        'animation.lifecycle.registration',
        actual - c.reenabledValue,
        'scene-unit',
        String(c.childCreatedFirst) + '/reenable',
      );
    }
  },
);
