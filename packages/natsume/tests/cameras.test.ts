import { expect, it } from 'vitest';
import { mat4, quat } from 'gl-matrix';
import * as I from '../src/format/generated/noa/ir.js';
import { AuthoredCamera, copyCameraEnvironment } from '../src/rendering/camera-environment.js';
import { SceneNode, Scene } from '../src/runtime/scene.js';
import { AnimationBindings, bindingWrites } from '../src/runtime/animation-bindings.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { linear } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { validateDocument } from '../src/format/semantics.js';
import { checkCompatibility } from '../src/runtime/compatibility.js';
type V = { x: number; y: number; z: number };
type Case = {
  custom?: boolean;
  physical: boolean;
  ortho: boolean;
  gate: number;
  aspect: number;
  fov: number;
  near: number;
  far: number;
  size: number;
  focal: number;
  sensor: V;
  shift: V;
  position: V;
  rotation: V & { w: number };
  scale: V;
  projection: number[];
  view: number[];
};
const native = JSON.parse(readNativeFixture('unity-cameras.json')) as { cases: Case[] };
it('opens declared camera capabilities while preserving host requirements and target diagnostics', () => {
  const doc = minimalDocument(),
    camera = new I.CameraT();
  camera.viewport = new I.Vec4T(0, 0, 1, 1);
  camera.hdr = camera.msaa = camera.dynamicResolution = true;
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.Camera, camera)];
  doc.entries[0]!.cameraPolicy = I.CameraPolicy.Embedded;
  doc.entries[0]!.cameraComponentId = 3;
  doc.features = ['camera.authored', 'camera.embedded'].map(
    (name) => new I.FeatureRequirementT(name, 1, true),
  );
  const pack = new EffectPack(doc, {} as never, new Map(), new Map());
  const context = {
    disposed: false,
    maxTextureSize: 16384,
    availableTexturePixels: 1000000,
    cachedMaterialIds: new Set<number>(),
    imageBitmapAvailable: true,
    hasScript: () => false,
  };
  try {
    const report = checkCompatibility(
      pack,
      { cameraEnvironment: { targetDisplay: 0, width: 100, height: 80 } },
      context,
    );
    expect(report.compatible).toBe(true);
    expect(report.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['CAMERA_SKYBOX_BACKGROUND', 'CAMERA_HOST_RENDER_TARGET']),
    );
    expect(
      checkCompatibility(pack, {}, context).issues.some(
        (i) => i.field === 'cameraEnvironment' && i.severity === 'error',
      ),
    ).toBe(true);
    expect(
      checkCompatibility(
        pack,
        { cameraEnvironment: { targetDisplay: 0, width: 100, height: 80, mainCameraId: 99 } },
        context,
      ).compatible,
    ).toBe(false);
  } finally {
    pack.dispose();
  }
});
it('rejects invalid active physical parameters and ignores inactive custom matrices', () => {
  const doc = minimalDocument(),
    camera = new I.CameraT();
  camera.viewport = new I.Vec4T(0, 0, 1, 1);
  camera.physical = true;
  camera.sensorSizeMm = new I.Vec2T(36, 24);
  camera.focalLengthMm = 43;
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.Camera, camera)];
  doc.features = [new I.FeatureRequirementT('camera.authored', 1, true)];
  expect(() => validateDocument(doc)).not.toThrow();
  for (const focal of [0, -1]) {
    camera.focalLengthMm = focal;
    expect(() => validateDocument(doc)).toThrow('physical camera');
  }
  camera.focalLengthMm = 43;
  camera.sensorSizeMm.x = 0;
  expect(() => validateDocument(doc)).toThrow('physical camera');
  camera.physical = false;
  camera.customProjection = new I.Matrix4T(new Array(16).fill(0));
  const node = new SceneNode(doc.nodes[0]!, undefined, undefined),
    view = new AuthoredCamera(3, node, camera);
  view.sync({ targetDisplay: 0, width: 100, height: 80 });
  expect(view.projection[0]).toBeGreaterThan(0);
});
it.skipIf(!native.cases.length)('matches native camera projection and view matrices', () => {
  for (const c of native.cases) {
    const node = new SceneNode(minimalDocument().nodes[0]!, undefined, undefined);
    const q = quat.fromValues(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
    mat4.fromRotationTranslationScale(
      node.worldMatrix,
      q,
      [c.position.x, c.position.y, c.position.z],
      [c.scale.x, c.scale.y, c.scale.z],
    );
    quat.copy(node.worldRotation, q);
    const d = new I.CameraT();
    Object.assign(d, {
      physical: c.physical,
      projection: c.ortho ? 1 : 0,
      gateFit: c.gate,
      aspectMode: 1,
      aspect: c.aspect,
      fovRadians: c.fov,
      nearPlane: c.near,
      farPlane: c.far,
      orthoHalfHeight: c.size,
      focalLengthMm: c.focal,
      sensorSizeMm: new I.Vec2T(c.sensor.x, c.sensor.y),
      lensShift: new I.Vec2T(c.shift.x, c.shift.y),
      viewport: new I.Vec4T(0, 0, 1, 1),
    });
    if (c.custom) {
      d.projection = 2;
      d.customProjection = new I.Matrix4T(c.projection);
    }
    const camera = new AuthoredCamera(2, node, d);
    camera.sync({ targetDisplay: 0, width: 128, height: 96 });
    for (let i = 0; i < 16; i++) {
      recordError(
        'camera.projection',
        camera.projection[i]! - c.projection[i]!,
        'absolute',
        JSON.stringify(c),
      );
      recordError('camera.view', camera.view[i]! - c.view[i]!, 'absolute', JSON.stringify(c));
      expect(
        Math.abs(camera.projection[i]! - c.projection[i]!),
        JSON.stringify(c) + `/projection/${i}`,
      ).toBeLessThan(5e-6);
      expect(Math.abs(camera.view[i]! - c.view[i]!), JSON.stringify(c) + `/view/${i}`).toBeLessThan(
        5e-6,
      );
    }
  }
});

it('drives screen Canvas layout from the selected source camera across animation and resize', () => {
  const doc = minimalDocument();
  for (const id of [2, 3, 4])
    doc.nodes.push(new I.NodeT(id, String(id), 1, true, structuredClone(doc.nodes[0]!.transform)));
  doc.nodes[1]!.transform!.position!.z = -5;
  const camera = new I.CameraT();
  Object.assign(camera, {
    projection: 1,
    orthoHalfHeight: 2,
    nearPlane: 0.1,
    farPlane: 100,
    viewport: new I.Vec4T(0, 0, 1, 1),
  });
  const canvas = new I.CanvasT();
  canvas.mode = 1;
  canvas.planeDistance = 2;
  const rect = new I.RectLayoutT(
    new I.Vec2T(0.5, 0.5),
    new I.Vec2T(0.5, 0.5),
    new I.Vec2T(0.5, 0.5),
    new I.Vec3T(),
    new I.Vec2T(10, 10),
  );
  doc.components = [
    new I.ComponentT(12, 2, true, I.ComponentData.Camera, camera),
    new I.ComponentT(13, 3, true, I.ComponentData.Camera, structuredClone(camera)),
    new I.ComponentT(14, 4, true, I.ComponentData.Canvas, canvas),
    new I.ComponentT(15, 4, true, I.ComponentData.RectLayout, rect),
  ];
  const pack = new EffectPack(doc, {} as never, new Map(), new Map());
  try {
    const env = { targetDisplay: 0, width: 100, height: 80, mainCameraId: 12 };
    expect(
      () =>
        new Scene(pack, [1], undefined, undefined, { targetDisplay: 0, width: 100, height: 80 }),
    ).toThrow('ScreenCamera');
    const scene = new Scene(pack, [1], undefined, undefined, env);
    const bindings = new AnimationBindings(pack, scene);
    scene.setCameraDefinitions(bindings.cameras);
    expect(scene.nodes.get(4)!.layout).toEqual({ width: 100, height: 80 });
    expect(scene.nodes.get(4)!.worldMatrix[14]).toBeCloseTo(-3);
    const scale = scene.nodes.get(4)!.worldMatrix[0]!;
    bindings.cameras.get(12)!.orthoHalfHeight = 4;
    scene.update();
    expect(scene.nodes.get(4)!.worldMatrix[0]).toBeCloseTo(scale * 2);
    scene.nodes.get(2)!.localPosition.x = 3;
    scene.nodes.get(2)!.transformDirty = true;
    scene.update();
    expect(scene.nodes.get(4)!.worldMatrix[12]).toBeCloseTo(3);
    scene.setCameraEnvironment({ ...env, width: 200 });
    expect(scene.nodes.get(4)!.layout).toEqual({ width: 200, height: 80 });
    scene.setCameraEnvironment({ ...env, mainCameraId: 13 });
    expect(scene.nodes.get(4)!.worldMatrix[14]).toBeCloseTo(2);
    scene.setCameraEnvironment(env);
    bindings.reset();
    scene.reset();
    expect(scene.nodes.get(4)!.worldMatrix[14]).toBeCloseTo(-3);
    expect(scene.nodes.get(4)!.worldMatrix[0]).toBeCloseTo(scale);
    expect(() => scene.setCameraEnvironment({ ...env, targetDisplay: 1 })).toThrow('display size');
    expect(scene.nodes.get(4)!.layout).toEqual({ width: 100, height: 80 });
    const explicit = structuredClone(doc);
    (explicit.components[2]!.data as I.CanvasT).cameraComponentId = 13;
    const explicitPack = new EffectPack(explicit, {} as never, new Map(), new Map());
    try {
      const separate = new Scene(explicitPack, [1], undefined, undefined, {
        targetDisplay: 0,
        width: 100,
        height: 80,
      });
      expect(separate.nodes.get(4)!.worldMatrix[14]).toBeCloseTo(2);
      separate.setCameraEnvironment(env);
      expect(separate.nodes.get(4)!.worldMatrix[14]).toBeCloseTo(2);
      separate.nodes.get(3)!.localPosition.x = 7;
      separate.nodes.get(3)!.transformDirty = true;
      separate.update();
      expect(separate.nodes.get(4)!.worldMatrix[12]).toBeCloseTo(7);
    } finally {
      explicitPack.dispose();
    }
    for (const mode of [0, 2]) {
      const copy = structuredClone(doc);
      (copy.components[2]!.data as I.CanvasT).mode = mode;
      const other = new EffectPack(copy, {} as never, new Map(), new Map());
      try {
        const scene = new Scene(
          other,
          [1],
          undefined,
          undefined,
          mode === 0 ? { targetDisplay: 0, width: 150, height: 90 } : undefined,
        );
        expect(scene.nodes.get(4)!.layout).toEqual(
          mode === 0 ? { width: 150, height: 90 } : { width: 10, height: 10 },
        );
      } finally {
        other.dispose();
      }
    }
  } finally {
    pack.dispose();
  }
});
it('isolates camera animation state and aliases CameraActive with ComponentEnabled', () => {
  const doc = minimalDocument(),
    camera = new I.CameraT();
  doc.components = [new I.ComponentT(2, 1, true, I.ComponentData.Camera, camera)];
  const pack = new EffectPack(doc, {} as never, new Map(), new Map());
  try {
    const a = new AnimationBindings(pack, new Scene(pack, [1])),
      b = new AnimationBindings(pack, new Scene(pack, [1]));
    for (const [property, field] of [
      [I.AnimationProperty.CameraFov, 'fovRadians'],
      [I.AnimationProperty.CameraOrthoSize, 'orthoHalfHeight'],
      [I.AnimationProperty.CameraNear, 'nearPlane'],
      [I.AnimationProperty.CameraFar, 'farPlane'],
    ] as const) {
      const track = new I.TrackT(
        new I.BindingT(null, 2, property),
        I.TrackData.FloatTrack,
        new I.FloatTrackT(linear(1, 3).curveMax),
      );
      a.compile(track)!.sample(0.5);
      expect(a.cameras.get(2)![field]).toBe(2);
      expect(b.cameras.get(2)![field]).toBe(camera[field]);
    }
    const active = new I.TrackT(
      new I.BindingT(null, 2, I.AnimationProperty.CameraActive),
      I.TrackData.BoolTrack,
      new I.BoolTrackT([new I.BoolKeyT(0, false)]),
    );
    a.compile(active)!.sample(0);
    expect(a.enabled.get(2)).toBe(false);
    expect(bindingWrites(pack, active)).toEqual(['component:2:enabled']);
    a.reset();
    expect(a.enabled.get(2)).toBe(true);
    expect(a.cameras.get(2)!.fovRadians).toBe(camera.fovRadians);
  } finally {
    pack.dispose();
  }
});
it('validates copied display inputs and prevents borrowed-object mutation', () => {
  const value = { targetDisplay: 0, width: 100, height: 80 };
  const copy = copyCameraEnvironment(value)!;
  value.width = 12;
  expect(copy.width).toBe(100);
  for (const bad of [
    { ...value, width: 0 },
    { ...value, height: NaN },
    { ...value, targetDisplay: -1 },
    { ...value, mainCameraId: 0 },
  ])
    expect(() => copyCameraEnvironment(bad)).toThrow('cameraEnvironment');
});
