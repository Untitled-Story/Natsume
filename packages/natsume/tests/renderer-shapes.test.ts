import { expect, it } from 'vitest';
import { mat4, quat } from 'gl-matrix';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../src/format/generated/noa/mesh/vec4.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { Simulation } from '../src/runtime/simulation.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

type Point = { x: number; y: number; z: number };
type Matrix = Record<string, number>;
interface Case {
  sprite: boolean;
  enabled: boolean;
  active: boolean;
  flipX: boolean;
  flipY: boolean;
  transformedShape: boolean;
  space: number;
  scaling: number;
  frame: number;
  variant: number;
  sourceMatrix: Matrix;
  emitterMatrix: Matrix;
  customMatrix: Matrix;
  samples: {
    position: Point;
    velocity: Point;
    color: { r: number; g: number; b: number; a: number };
  }[];
}
const fixture = JSON.parse(readNativeFixture('unity-renderer-shape.json')) as {
  vertices: Point[];
  normals: Point[];
  spriteVertices: Point[];
  spriteTriangles: number[];
  cases: Case[];
};
function matrix(value: Matrix) {
  return mat4.fromValues(
    ...(Array.from({ length: 16 }, (_, i) => value[`e${i % 4}${Math.floor(i / 4)}`]!) as Parameters<
      typeof mat4.fromValues
    >),
  );
}
function setup(c: Case) {
  const doc = minimalDocument();
  const transform = () => structuredClone(doc.nodes[0]!.transform);
  doc.nodes.push(
    new I.NodeT(4, 'source', 1, c.active, transform()),
    new I.NodeT(5, 'custom', 1, true, transform()),
  );
  const source = particleSource();
  source.main!.space = c.space;
  source.main!.scaling = c.scaling;
  source.main!.customSpaceNodeId = 5;
  source.main!.speed = constant(1);
  source.main!.playOnEnable = false;
  const mesh = new MeshT();
  mesh.positions = (c.sprite ? fixture.spriteVertices : fixture.vertices).map(
    (p) => new Vec3T(p.x, p.y, p.z ?? 0),
  );
  mesh.normals = c.sprite ? [] : fixture.normals.map((p) => new Vec3T(p.x, p.y, p.z));
  mesh.indices = c.sprite ? fixture.spriteTriangles : [0, 1, 2];
  mesh.submeshes = [new SubmeshT(0, mesh.indices.length)];
  mesh.colors = c.sprite
    ? []
    : [new Vec4T(1, 0, 0, 1), new Vec4T(0, 1, 0, 1), new Vec4T(0, 0, 1, 1)];
  const geometry = c.sprite
    ? new I.SpriteShapeT(6, 44, 0, 0.3, true, 1, constant(1))
    : new I.MeshShapeT(6, 43, 0, 0.3, true, false, 0, 1, constant(1));
  const shapeTransform = transform()!;
  if (c.transformedShape) {
    shapeTransform.position = new I.Vec3T(0.2, 0.4, -0.1);
    shapeTransform.scale = new I.Vec3T(0.5, 2, 1.5);
    const q = quat.create();
    // Unity Euler applies Z, then X, then Y.
    const qx = quat.setAxisAngle(quat.create(), [1, 0, 0], Math.PI / 12),
      qy = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI / 9),
      qz = quat.setAxisAngle(quat.create(), [0, 0, 1], Math.PI / 6);
    quat.multiply(q, qy, qx);
    quat.multiply(q, q, qz);
    shapeTransform.rotation = new I.QuaternionT(...(q as [number, number, number, number]));
  }
  source.modules = [
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(0), constant(0), [
        new I.BurstT(0, constant(c.frame ? 6 : 3), 1, 0, 1),
      ]),
    ),
    new I.ParticleModuleT(
      I.ParticleModuleData.ShapeModule,
      new I.ShapeModuleT(
        null,
        c.sprite ? I.ShapeGeometry.SpriteShape : I.ShapeGeometry.MeshShape,
        geometry,
        shapeTransform,
      ),
    ),
  ];
  const renderer = c.sprite ? new I.SpriteRendererT() : new I.MeshRendererT();
  if (c.sprite) {
    const r = renderer as I.SpriteRendererT;
    r.spriteAssetId = 44;
    r.flipX = c.flipX;
    r.flipY = c.flipY;
    r.color = new I.ColorT(0.2, 0.4, 0.7, 0.5);
  }
  doc.components = [
    new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source),
    new I.ComponentT(
      6,
      4,
      c.enabled,
      c.sprite ? I.ComponentData.SpriteRenderer : I.ComponentData.MeshRenderer,
      renderer,
    ),
  ];
  doc.assets = [new I.AssetT(44, I.AssetKind.Sprite, new I.SpriteAssetT(43))];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map([[43, mesh]]));
  const simulation = new Simulation(pack, { seed: 12345 });
  // Feed native scene frames directly, retaining shear for Hierarchy mode.
  for (const [id, value] of [
    [1, c.emitterMatrix],
    [4, c.sourceMatrix],
    [5, c.customMatrix],
  ] as const) {
    const node = simulation.scene.nodes.get(id)!;
    mat4.copy(node.worldMatrix, matrix(value));
    const q = quat.create();
    if (id === 4) {
      quat.fromEuler(q, 20, 35, 15);
      // quaternion from source hierarchy must use Unity's YXZ Euler order.
      const euler = c.frame ? [-10, 50, 25] : [20, 35, 15];
      const axis = euler.map((angle, i) =>
        quat.setAxisAngle(
          quat.create(),
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ][i]!,
          (angle! * Math.PI) / 180,
        ),
      );
      quat.multiply(q, axis[1]!, axis[0]!);
      quat.multiply(q, q, axis[2]!);
      if (c.variant === 6 && c.frame === 0) {
        const a = [5, 10, 15].map((angle, i) =>
          quat.setAxisAngle(
            quat.create(),
            [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ][i]!,
            (angle * Math.PI) / 180,
          ),
        );
        const parent = quat.multiply(quat.create(), a[1]!, a[0]!);
        quat.multiply(parent, parent, a[2]!);
        quat.multiply(q, parent, q);
      }
    } else {
      const euler = id === 1 ? [10, 20, -30] : [0, 15, 10];
      const axis = euler.map((angle, i) =>
        quat.setAxisAngle(
          quat.create(),
          [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ][i]!,
          (angle! * Math.PI) / 180,
        ),
      );
      quat.multiply(q, axis[1]!, axis[0]!);
      quat.multiply(q, q, axis[2]!);
    }
    quat.copy(node.worldRotation, q);
  }
  if (c.variant === 11 && c.frame === 1) simulation.scene.nodes.get(4)!.destroyed = true;
  const emitter = simulation.emitters.get(3)!;
  emitter.updateSpace();
  emitter.start(false);
  return { simulation, emitter, pack };
}
it.skipIf(!fixture.cases.length)(
  'matches native renderer shape frames, scaling, visibility, flips and tint',
  () => {
    let maxPosition = 0,
      maxVelocity = 0;
    for (const c of fixture.cases) {
      const { emitter, pack } = setup(c);
      try {
        expect(emitter.count).toBe(c.samples.length * (c.frame ? 2 : 1));
        const offset = c.frame ? 3 : 0;
        c.samples.forEach((sample, i) => {
          for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
            const position = Math.abs(
              emitter.positions[(i + offset) * 3 + axis]! - sample.position[key],
            );
            const velocity = Math.abs(
              emitter.velocities[(i + offset) * 3 + axis]! - sample.velocity[key],
            );
            maxPosition = Math.max(maxPosition, position);
            maxVelocity = Math.max(maxVelocity, velocity);
            const label = `${c.sprite}/${c.space}/${c.scaling}/${c.variant}/${c.frame}/${i}/${key}`;
            expect(position, label).toBeLessThan(0.0001);
            expect(velocity, label).toBeLessThan(0.00001);
          }
          for (const [axis, key] of (['r', 'g', 'b', 'a'] as const).entries())
            expect(emitter.startColors[(i + offset) * 4 + axis]).toBeCloseTo(sample.color[key], 6);
        });
      } finally {
        pack.dispose();
      }
    }
    recordError('shape.renderer', maxPosition, 'position', '432 frames', 'unity');
    recordError('shape.renderer', maxVelocity, 'velocity', '432 frames', 'unity');
  },
);

it('refreshes source transforms without moving existing particles and rejects sources outside the entry', async () => {
  const { checkCompatibility } = await import('../src/runtime/compatibility.js');
  const doc = minimalDocument(),
    source = particleSource(),
    mesh = new MeshT();
  const tr = structuredClone(doc.nodes[0]!.transform)!;
  tr.position!.x = 3;
  doc.nodes.push(new I.NodeT(4, 'source', 1, false, tr));
  source.main!.space = I.Space.World;
  source.main!.speed = constant(1);
  source.modules = [
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1), 1, 0, 1)]),
    ),
    new I.ParticleModuleT(
      I.ParticleModuleData.ShapeModule,
      new I.ShapeModuleT(
        null,
        I.ShapeGeometry.MeshShape,
        new I.MeshShapeT(6, 43, 0, 0, false, false, 0, 1, constant(1)),
        structuredClone(doc.nodes[0]!.transform),
      ),
    ),
  ];
  mesh.positions = [new Vec3T(1, 0, 0)];
  mesh.normals = [new Vec3T(0, 0, 1)];
  doc.components = [
    new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source),
    new I.ComponentT(6, 4, false, I.ComponentData.MeshRenderer, new I.MeshRendererT()),
  ];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map([[43, mesh]]));
  const context = {
    maxTextureSize: 4096,
    availableTexturePixels: 4096,
    cachedMaterialIds: new Set<number>(),
    imageBitmapAvailable: true,
    hasScript: () => false,
    disposed: false,
  };
  try {
    expect(checkCompatibility(pack, {}, context).compatible).toBe(true);
    const sim = new Simulation(pack, {}),
      emitter = sim.emitters.get(3)!;
    emitter.start(false);
    expect(emitter.positions[0]).toBe(4);
    const node = sim.scene.nodes.get(4)!;
    node.localPosition.x = 8;
    node.transformDirty = true;
    sim.scene.update();
    emitter.updateSpace();
    expect(emitter.positions[0]).toBe(4);
    emitter.clear();
    emitter.start(false);
    // A new independent burst uses the refreshed source frame.
    emitter.reset();
    emitter.start(false);
    expect(emitter.positions[0]).toBe(9);
    node.destroyed = true;
    emitter.updateSpace();
    emitter.reset();
    emitter.start(false);
    expect(emitter.positions[0]).toBe(0);
    expect(Array.from(emitter.velocities.slice(0, 3))).toEqual([0, 0, 1]);
    const external = structuredClone(doc);
    external.nodes[1]!.parentId = 0;
    const externalPack = new EffectPack(
      external,
      { files: [] } as never,
      new Map(),
      new Map([[43, mesh]]),
    );
    try {
      expect(checkCompatibility(externalPack, {}, context).issues).toContainEqual(
        expect.objectContaining({
          componentId: 3,
          field: 'modules.1.geometry.sourceRendererComponentId',
          severity: 'error',
        }),
      );
      expect(() => new Simulation(externalPack, {})).toThrow(/outside the instance/);
    } finally {
      externalPack.dispose();
    }
  } finally {
    pack.dispose();
  }
});
