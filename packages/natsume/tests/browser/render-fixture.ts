import { Vec3T } from '../../src/format/generated/noa/ir/vec3.js';
import { Application, Container, Graphics, RenderTexture, Texture, extensions } from 'pixi.js';
import { NatsumePlugin } from '../../src/index.js';
import { getPreview } from '../../../playground/src/preview.js';
import { ParticleMesh } from '../../src/rendering/particle-mesh.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { Scene } from '../../src/runtime/scene.js';
import { minimalDocument } from '../helpers.js';
import { manualParticle, particleSource } from '../particle-fixtures.js';
import { RenderMode } from '../../src/format/generated/noa/ir/render-mode.js';
import { Alignment } from '../../src/format/generated/noa/ir/alignment.js';
import { ParticleSort } from '../../src/format/generated/noa/ir/particle-sort.js';
import type { ParticleRendererT } from '../../src/format/generated/noa/ir/particle-renderer.js';
import { EffectPack } from '../../src/pack.js';
import { randomSource } from '../random-fixtures.js';
import { vector } from '../particle-fixtures.js';
import { ParticleModuleT } from '../../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../../src/format/generated/noa/ir/particle-module-data.js';
import { VelocityModuleT } from '../../src/format/generated/noa/ir/velocity-module.js';
import { QuaternionT } from '../../src/format/generated/noa/ir/quaternion.js';

export async function checkRuntimeCompatibility() {
  const { app, effect } = getPreview();
  if (!app || !effect) throw new Error('Missing preview');
  effect.pause();
  const { ComponentData } = await import('../../src/format/generated/noa/ir/component-data.js');
  const { NatsumeCompatibilityError } = await import('../../src/index.js');
  const { constant } = await import('../particle-fixtures.js');
  const source = effect.simulation.pack;
  const document = structuredClone(
    source.document,
  ) as import('../../src/format/generated/noa/ir/document.js').DocumentT;
  const renderer = document.components.find((c) => c.dataType === ComponentData.ParticleRenderer)!
    .data as ParticleRendererT;
  const system = document.components.find((c) => c.id === renderer.systemComponentId)!
    .data as import('../../src/format/generated/noa/ir/particle-system.js').ParticleSystemT;
  renderer.mode = RenderMode.StretchedBillboard;
  renderer.alignment = Alignment.View;
  renderer.freeformStretching = true;
  system.main!.durationSeconds = 0.001;
  system.main!.gravityMultiplier = constant(1);
  system.main!.gravity = null;
  const files = new Map(
    source.manifest.files.flatMap((file) => {
      const bytes = file.asset_id ? source.getAssetBytes(file.asset_id) : undefined;
      return bytes ? [[file.path, bytes] as const] : [];
    }),
  );
  const meshes = new Map(
    document.assets.flatMap((asset) => {
      const mesh = asset.kind === 2 ? source.getMesh(asset.id) : undefined;
      return mesh
        ? [
            [
              asset.id,
              structuredClone(mesh) as import('../../src/format/generated/noa/mesh/mesh.js').MeshT,
            ] as const,
          ]
        : [];
    }),
  );
  const pack = new EffectPack(document, source.manifest, files, meshes);
  let decodes = 0;
  const decode = globalThis.createImageBitmap;
  const before = [effect.particleCount, effect.time, app.stage.children.length];
  globalThis.createImageBitmap = () => {
    decodes++;
    throw new Error('Unexpected preflight image decode');
  };
  try {
    const valid = app.natsume.checkCompatibility(source, {
      particleEnvironment: {
        fog: { mode: 'none' },
        gravity: [0, -9.81, 0],
        viewPosition: [0, 0, -10],
      },
    });
    const report = app.natsume.checkCompatibility(pack);
    let sameIssues = false;
    try {
      await app.natsume.instantiate(pack);
    } catch (error) {
      sameIssues =
        error instanceof NatsumeCompatibilityError &&
        JSON.stringify(error.issues) === JSON.stringify(report.issues);
    }
    return {
      valid: valid.compatible,
      blocked: !report.compatible,
      fields: report.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.field),
      sameIssues,
      decodes,
      unchanged:
        JSON.stringify(before) ===
        JSON.stringify([effect.particleCount, effect.time, app.stage.children.length]),
    };
  } finally {
    globalThis.createImageBitmap = decode;
    pack.dispose();
  }
}

export async function checkApplicationPlugin() {
  const { app, effect } = getPreview();
  if (!app || !effect) throw new Error('Missing preview');
  effect.pause();
  // Re-registration is idempotent in Pixi's extension registry.
  extensions.add(NatsumePlugin);
  const other = new Application();
  await other.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    autoStart: false,
    width: 32,
    height: 32,
  });
  const runtime = other.natsume;
  const distinct = runtime !== app.natsume;
  const stable = runtime === other.natsume;
  const instance = await runtime.instantiate(effect.simulation.pack, {});
  other.stage.addChild(instance.container);
  instance.play();
  other.destroy();
  let rejected = false;
  try {
    await runtime.instantiate(effect.simulation.pack);
  } catch {
    rejected = true;
  }
  effect.play();
  effect.update(1 / 60);
  const isolated = !effect.destroyed && effect.state === 'playing';
  effect.pause();
  return {
    distinct,
    stable,
    destroyed: instance.destroyed,
    rejected,
    isolated,
    detached: !Object.hasOwn(other, 'natsume'),
  };
}

export function measureLifetimeSizeRandomness(seed: number) {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const document = minimalDocument();
  const pack = {
    nodes: document.nodes,
    components: [],
    getNode: (id: number) => document.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const scene = new Scene(pack, [1]);
  const e = new Emitter(3, scene.nodes.get(1)!, randomSource(seed, 1, Math.PI * 2), true, seed, []);
  e.sync();
  e.positions.fill(0);
  e.rotations.fill(0);
  const definition = structuredClone(original.definition) as ParticleRendererT;
  definition.mode = RenderMode.Mesh;
  definition.meshAssetIds = [1];
  const meshPack = {
    getMesh: () => ({
      positions: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      uv0: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      indices: [0, 1, 2],
      submeshes: [{}],
    }),
  } as unknown as EffectPack;
  const mesh = new ParticleMesh(
    e,
    definition,
    original.materialDefinition,
    Texture.WHITE,
    meshPack,
  );
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const result = [];
  try {
    for (const age of [0, 0.75]) {
      e.ages.fill(age);
      mesh.sync(matrix, 'gamma');
      const vertices = mesh.geometry.getBuffer('aPosition').data as Float32Array;
      const values = [0, 1, 2].map(() => [] as number[]);
      let maximumAxisDifference = 0;
      for (let i = 0; i < e.count; i++) {
        const factors = [0, 1, 2].map(
          (axis) =>
            vertices[(i * 3 + axis) * 16 + axis]! / e.startSizes[i * 3 + axis]! / (axis + 1) - 1,
        );
        for (let axis = 0; axis < 3; axis++) values[axis]!.push(factors[axis]!);
        maximumAxisDifference = Math.max(
          maximumAxisDifference,
          Math.abs(factors[0]! - factors[1]!),
          Math.abs(factors[0]! - factors[2]!),
        );
      }
      result.push({
        age,
        maximumAxisDifference,
        distributions: values.map((column) => {
          const mean = column.reduce((s, v) => s + v, 0) / column.length;
          const bins = new Array<number>(16).fill(0);
          for (const v of column) bins[Math.max(0, Math.min(15, Math.floor(v * 16)))]!++;
          return {
            mean,
            variance: column.reduce((s, v) => s + (v - mean) ** 2, 0) / column.length,
            bins,
          };
        }),
      });
    }
  } finally {
    mesh.destroy();
  }
  return result;
}

export async function measureParticleGeometry(labels?: string[]) {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const document = minimalDocument();
  const pack = {
    nodes: document.nodes,
    components: [],
    getNode: (id: number) => document.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const result = [];
  for (const label of labels ?? [
    'appearance-blend',
    'appearance-mesh',
    'mesh-view',
    'mesh-view-node-rotated',
    'mesh-world-node-rotated',
    'mesh-local-node-rotated',
    'billboard-local-node-rotated',
    'billboard-world-node-rotated',
    'stretch-view',
    'stretch-negative-four',
    'stretch-negative-one',
    'stretch-positive',
    'stretch-zero-speed',
    'stretch-linear-velocity',
  ]) {
    document.nodes[0]!.transform!.rotation = label.endsWith('-node-rotated')
      ? new QuaternionT(0, 0, Math.SQRT1_2, Math.SQRT1_2)
      : new QuaternionT(0, 0, 0, 1);
    const scene = new Scene(pack, [1]);
    const mode = label.startsWith('stretch-')
      ? RenderMode.StretchedBillboard
      : label === 'appearance-blend' || label.startsWith('billboard-')
        ? RenderMode.Billboard
        : RenderMode.Mesh;
    const source = particleSource(label.startsWith('appearance-') ? 'appearance-blend' : '');
    if (
      label.includes('zero-speed') ||
      label === 'stretch-linear-velocity' ||
      label === 'stretch-pivot-fast'
    )
      source.modules.push(
        new ParticleModuleT(
          M.VelocityModule,
          new VelocityModuleT(
            vector(
              label.includes('zero-speed') ? -2 : label === 'stretch-pivot-fast' ? 2 : 0,
              label === 'stretch-linear-velocity' ? 2 : 0,
            ),
          ),
        ),
      );
    const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    manualParticle(emitter);
    if (label.endsWith('-unrotated')) emitter.rotations.fill(0);
    if (label === 'stretch-pivot-unit-size') emitter.startSizes.fill(1);
    const definition = structuredClone(original.definition) as ParticleRendererT;
    definition.mode = mode;
    definition.alignment = label.includes('local-')
      ? Alignment.Local
      : label.startsWith('mesh-view') || label === 'stretch-view'
        ? Alignment.View
        : Alignment.World;
    definition.cameraVelocityScale = definition.velocityScale = 0;
    definition.lengthScale = label.endsWith('-positive')
      ? 2
      : label === 'stretch-negative-one'
        ? -1
        : -4;
    definition.freeformStretching = false;
    definition.rotateWithStretchDirection = true;
    if (label.includes('-pivot'))
      definition.pivot = new Vec3T(
        label.endsWith('-y') || label.endsWith('-z') ? 0 : 0.25,
        label.endsWith('-x') || label.endsWith('-z') ? 0 : -0.5,
        label.endsWith('-x') || label.endsWith('-y') ? 0 : 0.1,
      );
    if (label === 'billboard-flip') definition.flip = new Vec3T(1, 1, 0);
    definition.meshAssetIds = [1];
    const fixturePack = {
      getMesh: () => ({
        positions: [
          { x: -0.5, y: -0.5, z: 0 },
          { x: 0.5, y: -0.5, z: 0 },
          { x: 0.5, y: 0.5, z: 0 },
          { x: -0.5, y: 0.5, z: 0 },
        ],
        uv0: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        indices: [0, 1, 2, 0, 2, 3],
        submeshes: [{}],
      }),
    } as unknown as EffectPack;
    const mesh = new ParticleMesh(
      emitter,
      definition,
      original.materialDefinition,
      Texture.WHITE,
      fixturePack,
    );
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let frame = 0; frame <= 30; frame++) {
      if (frame) emitter.step(1 / 60);
      if (![0, 1, 30].includes(frame)) continue;
      mesh.sync(matrix, 'gamma');
      const buffer = mesh.geometry.getBuffer('aPosition').data as Float32Array;
      result.push({
        label,
        mode,
        frame,
        vertices: [0, 1, 2, 3].map((i) => Array.from(buffer.slice(i * 16, i * 16 + 3))),
        uv: [0, 1, 2, 3].map((i) => [buffer[i * 16 + 3]!, 1 - buffer[i * 16 + 4]!]),
      });
    }
    mesh.destroy();
  }
  return result;
}

/** Returns the particle source order encoded in the index buffer for each sort mode. */
export function measureParticleSorting() {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const document = minimalDocument();
  const pack = {
    nodes: document.nodes,
    components: [],
    getNode: (id: number) => document.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const scene = new Scene(pack, [1]);
  const emitter = new Emitter(3, scene.nodes.get(1)!, particleSource(''), true, 1, []);
  manualParticle(emitter);
  emitter.count = 3;
  emitter.positions.set([0, 0, 3, 0, 0, 1, 0, 0, 2]);
  emitter.lifetimes.fill(1);
  emitter.ages.set([0.2, 0.8, 0.5]);
  const result: Record<string, number[]> = {};
  for (const [name, sort] of [
    ['None', ParticleSort.None],
    ['Distance', ParticleSort.Distance],
    ['OldestFirst', ParticleSort.OldestFirst],
    ['YoungestFirst', ParticleSort.YoungestFirst],
    ['Depth', ParticleSort.Depth],
  ] as const) {
    const definition = structuredClone(original.definition) as ParticleRendererT;
    definition.mode = RenderMode.Mesh;
    definition.meshAssetIds = [1];
    definition.sort = sort as ParticleSort;
    const meshPack = {
      getMesh: () => ({
        positions: [{ x: 0, y: 0, z: 0 }],
        uv0: [{ x: 0, y: 0 }],
        indices: [0],
        submeshes: [{}],
      }),
    } as unknown as EffectPack;
    const mesh = new ParticleMesh(
      emitter,
      definition,
      original.materialDefinition,
      Texture.WHITE,
      meshPack,
    );
    try {
      mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
      result[name] = Array.from(mesh.geometry.indexBuffer!.data.slice(0, 3));
      if (sort === ParticleSort.Depth) {
        document.nodes[0]!.transform!.scale!.z = -1;
        emitter.node.localMatrix[10] = -1;
        scene.update();
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        result.transformed = Array.from(mesh.geometry.indexBuffer!.data.slice(0, 3));
        document.nodes[0]!.transform!.scale!.z = 1;
        emitter.node.localMatrix[10] = 1;
        scene.update();
        emitter.positions.fill(0);
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        result.ties = Array.from(mesh.geometry.indexBuffer!.data.slice(0, 3));
        emitter.count = 0;
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        result.empty = [Number(mesh.visible)];
      }
    } finally {
      mesh.destroy();
    }
  }
  return result;
}

/** Draw a known uniform particle through the actual Natsume pipe and read RGBA. */
export function checkRenderState() {
  const { app, effect } = getPreview();
  if (!app || !effect) throw new Error('Missing preview');
  effect.pause();
  const mesh = effect.container.children[0] as ParticleMesh;
  mesh.removeFromParent();
  const vertices = mesh.geometry.getBuffer('aPosition');
  const data = vertices.data as Float32Array;
  const positions = [0, 0, 20, 0, 20, 20, 0, 20];
  for (let i = 0; i < 4; i++) {
    const k = i * 16;
    data[k] = positions[i * 2]!;
    data[k + 1] = positions[i * 2 + 1]!;
    data[k + 2] = 0;
    data[k + 3] = data[k + 4] = 0.5;
    data[k + 5] = 1;
    data[k + 6] = data[k + 7] = 0;
    data[k + 8] = 0.5;
    data[k + 9] = 0;
    data[k + 10] = data[k + 11] = 10;
    data[k + 12] = data[k + 15] = 20;
    data[k + 13] = data[k + 14] = 0;
  }
  mesh.geometry.indexCount = 6;
  vertices.update(256);
  mesh.visible = true;
  mesh.shader!.resources.uTexture = Texture.WHITE.source;
  const scene = new Container();
  scene.addChild(new Graphics().rect(0, 0, 64, 32).fill({ color: 0x0000ff, alpha: 0.5 }));
  scene.addChild(mesh);
  scene.addChild(new Graphics().rect(32, 0, 20, 20).fill({ color: 0x00ff00, alpha: 0.5 }));
  const target = RenderTexture.create({ width: 64, height: 32, resolution: 1, antialias: false });
  app.renderer.render({ container: scene, target, clear: true });
  const pixels = app.renderer.extract.pixels({ target });
  const sample = (x: number, y: number) =>
    Array.from(pixels.pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
  const alpha = sample(10, 10),
    host = sample(40, 10),
    background = sample(60, 10),
    clamped = sample(1, 10);
  mesh.alpha = 0.5;
  app.renderer.render({ container: scene, target, clear: true });
  const tinted = app.renderer.extract.pixels({ target }).pixels;
  const inherited = Array.from(tinted.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4));
  mesh.alpha = 1;
  for (let i = 0; i < 4; i++) data[i * 16 + 9] = 1;
  vertices.update(256);
  app.renderer.render({ container: scene, target, clear: true });
  const addPixels = app.renderer.extract.pixels({ target }).pixels;
  const additive = Array.from(addPixels.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4));
  for (let i = 0; i < 4; i++) data[i * 16 + 9] = 0;
  vertices.update(256);
  mesh.alpha = 0.5;
  // A host mask must apply to the custom pipe and following Pixi content.
  const mask = new Graphics().rect(0, 0, 8, 20).fill(0xffffff);
  scene.addChild(mask);
  mesh.mask = mask;
  app.renderer.render({ container: scene, target, clear: true });
  const cropped = app.renderer.extract.pixels({ target }).pixels;
  const outsideMask = Array.from(cropped.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4));
  const gl = (app.renderer as import('pixi.js').WebGLRenderer).gl;
  const restoredMask = Array.from(gl.getParameter(gl.COLOR_WRITEMASK) as boolean[]);
  mesh.mask = null;
  mesh.alpha = 1;
  for (let i = 0; i < 4; i++) {
    data[i * 16 + 5] = 0.5;
    data[i * 16 + 8] = 1;
  }
  vertices.update(256);
  app.renderer.render({ container: scene, target, clear: true });
  const gamma = app.renderer.extract.pixels({ target }).pixels[(10 * 64 + 10) * 4];
  mesh.shader!.resources.colorUniforms.uniforms.uLinear = 1;
  app.renderer.render({ container: scene, target, clear: true });
  const linear = app.renderer.extract.pixels({ target }).pixels[(10 * 64 + 10) * 4];
  mesh.shader!.resources.colorUniforms.uniforms.uLinear = 0;
  mesh.removeFromParent();
  effect.container.addChild(mesh);
  scene.destroy({ children: true });
  target.destroy(true);
  return {
    alpha,
    host,
    background,
    inherited,
    outsideMask,
    restoredMask,
    clamped,
    additive,
    gamma,
    linear,
  };
}

/** Measures ordinary stretch geometry for deterministic native inputs. */
export function measureStretchedParticles(
  cases: {
    label: string;
    velocity: { x: number; y: number; z: number };
    viewVelocity?: { x: number; y: number; z: number };
    lengthScale: number;
    velocityScale: number;
    cameraVelocityScale: number;
    rotate: boolean;
  }[],
) {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  return cases.map((sample) => {
    const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, particleSource(), true, 1, []);
    manualParticle(e);
    e.velocities.set([sample.velocity.x, sample.velocity.y, sample.velocity.z]);
    const definition = structuredClone(original.definition) as ParticleRendererT;
    definition.mode = RenderMode.StretchedBillboard;
    definition.alignment = Alignment.View;
    definition.freeformStretching = false;
    definition.rotateWithStretchDirection = sample.rotate;
    definition.lengthScale = sample.lengthScale;
    definition.velocityScale = sample.velocityScale;
    definition.cameraVelocityScale = sample.cameraVelocityScale;
    const velocity = sample.viewVelocity;
    const mesh = new ParticleMesh(e, definition, original.materialDefinition, Texture.WHITE, pack, {
      fog: { mode: 'none' },
      ...(velocity ? { viewVelocity: [velocity.x, velocity.y, velocity.z] as const } : {}),
    });
    try {
      mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
      const buffer = mesh.geometry.getBuffer('aPosition').data as Float32Array;
      return {
        label: sample.label,
        vertices: [0, 1, 2, 3].map((i) => Array.from(buffer.slice(i * 16, i * 16 + 3))),
        uv: [0, 1, 2, 3].map((i) => [buffer[i * 16 + 3]!, 1 - buffer[i * 16 + 4]!]),
      };
    } finally {
      mesh.destroy();
    }
  });
}

/** Checks that a rejected environment does not partially change gravity or rendering. */
export function checkEnvironmentReplacement() {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  effect.pause();
  const node = effect.simulation.scene.ordered[0]!;
  const a = particleSource(),
    b = particleSource();
  b.main!.gravityMultiplier = vector(1).x;
  const first = new Emitter(100001, node, a, true, 1, [], [0, -10, 0]);
  const second = new Emitter(100002, node, b, true, 1, [], [0, -10, 0]);
  effect.simulation.emitters.set(first.id, first);
  effect.simulation.emitters.set(second.id, second);
  const meshes = effect.container.children as ParticleMesh[];
  const before = meshes[0]!.environment;
  let rejected = false;
  try {
    effect.setParticleEnvironment({ fog: { mode: 'none' }, viewVelocity: [0, 3, 0] });
  } catch {
    rejected = true;
  }
  const preserved =
    meshes.every((mesh) => mesh.environment === before) &&
    first.gravity[1] === -10 &&
    second.gravity[1] === -10;
  const definition = structuredClone(meshes[0]!.definition) as ParticleRendererT;
  definition.alignment = Alignment.Facing;
  effect.addMesh(
    new ParticleMesh(
      meshes[0]!.emitter,
      definition,
      meshes[0]!.materialDefinition,
      Texture.WHITE,
      effect.simulation.pack,
      before,
    ),
  );
  let facingRejected = false;
  try {
    effect.setParticleEnvironment({ fog: { mode: 'none' }, gravity: [0, 0, 0] });
  } catch {
    facingRejected = true;
  }
  const facingPreserved = meshes[0]!.environment === before && second.gravity[1] === -10;
  definition.alignment = Alignment.World;
  const stretchDefinition = structuredClone(definition) as ParticleRendererT;
  stretchDefinition.mode = RenderMode.StretchedBillboard;
  stretchDefinition.freeformStretching = true;
  let freeformCreationRejected = false;
  try {
    new ParticleMesh(
      meshes[0]!.emitter,
      stretchDefinition,
      meshes[0]!.materialDefinition,
      Texture.WHITE,
      effect.simulation.pack,
      { fog: { mode: 'none' } },
    ).destroy();
  } catch (error) {
    freeformCreationRejected = error instanceof Error && error.message.includes('viewPosition');
  }
  effect.addMesh(
    new ParticleMesh(
      meshes[0]!.emitter,
      stretchDefinition,
      meshes[0]!.materialDefinition,
      Texture.WHITE,
      effect.simulation.pack,
      before,
    ),
  );
  let freeformUpdateRejected = false;
  try {
    effect.setParticleEnvironment({ fog: { mode: 'none' }, gravity: [0, 0, 0] });
  } catch (error) {
    freeformUpdateRejected = error instanceof Error && error.message.includes('viewPosition');
  }
  const freeformPreserved =
    meshes.every((mesh) => mesh.environment === before) && second.gravity[1] === -10;
  effect.setParticleEnvironment({
    fog: { mode: 'none' },
    gravity: [0, 0, 0],
    viewVelocity: [0, 3, 0],
    viewPosition: [0, 0, -10],
  });
  const updated =
    meshes.every((mesh) => mesh.environment?.viewVelocity?.[1] === 3) &&
    first.gravity[1] === 0 &&
    second.gravity[1] === 0 &&
    effect.state === 'paused';
  effect.simulation.emitters.delete(first.id);
  effect.simulation.emitters.delete(second.id);
  return {
    rejected,
    preserved,
    updated,
    facingRejected,
    facingPreserved,
    freeformCreationRejected,
    freeformUpdateRejected,
    freeformPreserved,
  };
}

export async function measureSheetUV() {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  const { TextureSheetModuleT } =
    await import('../../src/format/generated/noa/ir/texture-sheet-module.js');
  const { constant, linear } = await import('../particle-fixtures.js');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const document = minimalDocument();
  const pack = {
    nodes: document.nodes,
    components: [],
    getNode: (id: number) => document.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const source = particleSource();
  const sheet = new TextureSheetModuleT(4, 3);
  sheet.frameOverTime = linear(0, 1);
  sheet.startFrame = constant(0);
  source.modules.push(new ParticleModuleT(M.TextureSheetModule, sheet));
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 1, []);
  manualParticle(e);
  e.ages[0] = 0.5;
  e.lifetimes[0] = 1;
  const def = structuredClone(original.definition) as ParticleRendererT;
  def.mode = RenderMode.Billboard;
  def.alignment = Alignment.World;
  const mesh = new ParticleMesh(e, def, original.materialDefinition, Texture.WHITE, pack);
  const result = [];
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const mask of [1, 2, 3, 0]) {
    sheet.uvChannelMask = mask;
    mesh.sync(matrix, 'gamma');
    const buffer = mesh.geometry.getBuffer('aPosition').data as Float32Array;
    result.push({
      mask,
      uv: [0, 1, 2, 3].map((i) => [buffer[i * 16 + 3]!, 1 - buffer[i * 16 + 4]!]),
    });
  }
  mesh.destroy();
  return result;
}

export async function measureCompatibilityGeometry(labels: string[]) {
  const { effect } = getPreview();
  if (!effect) throw new Error('Missing preview');
  const { ScalingMode } = await import('../../src/format/generated/noa/ir/scaling-mode.js');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const result = [];
  for (const label of labels) {
    const doc = minimalDocument();
    const node = doc.nodes[0]!;
    if (label.startsWith('scaling-')) {
      const parent = structuredClone(node);
      parent.id = 9;
      parent.transform!.scale!.x = 2;
      parent.transform!.scale!.y = 3;
      parent.transform!.scale!.z = 4;
      node.parentId = 9;
      node.transform!.scale!.x = 0.5;
      node.transform!.scale!.y = 2;
      if (label.endsWith('rotated')) {
        parent.transform!.rotation = new QuaternionT(
          0,
          0,
          Math.sin(Math.PI / 12),
          Math.cos(Math.PI / 12),
        );
        node.transform!.rotation = new QuaternionT(
          0,
          0,
          Math.sin(Math.PI / 8),
          Math.cos(Math.PI / 8),
        );
      }
      doc.nodes.push(parent);
    }
    const pack = {
      nodes: doc.nodes,
      components: [],
      getNode: (id: number) => doc.nodes.find((n) => n.id === id),
    } as unknown as EffectPack;
    const source = particleSource();
    source.main!.scaling = label.includes('hierarchy')
      ? ScalingMode.Hierarchy
      : label.includes('shape')
        ? ScalingMode.Shape
        : ScalingMode.Local;
    const emitter = new Emitter(
      3,
      new Scene(pack, [node.parentId || 1]).nodes.get(1)!,
      source,
      true,
      1,
      [],
    );
    manualParticle(emitter);
    emitter.velocities.set([2, 1, 0.5]);
    emitter.lifetimes[0] = 2;
    const definition = structuredClone(original.definition) as ParticleRendererT;
    definition.mode = label.startsWith('freeform')
      ? RenderMode.StretchedBillboard
      : label.includes('HorizontalBillboard')
        ? RenderMode.HorizontalBillboard
        : label.includes('VerticalBillboard')
          ? RenderMode.VerticalBillboard
          : RenderMode.Billboard;
    definition.alignment = label.startsWith('roll-View')
      ? Alignment.View
      : label.includes('Facing')
        ? Alignment.Facing
        : label.includes('Velocity')
          ? Alignment.Velocity
          : Alignment.World;
    definition.allowRoll = !label.endsWith('False');
    if (label.startsWith('freeform')) {
      definition.freeformStretching = true;
      definition.rotateWithStretchDirection = label.endsWith('True');
      definition.lengthScale = 2;
      definition.velocityScale = 0.4;
      definition.cameraVelocityScale = 0;
      definition.alignment = Alignment.View;
      if (label.startsWith('freeform-axis-')) {
        const parts = label.split('-');
        emitter.velocities.set([Number(parts[2]), 0, 0]);
        definition.velocityScale = Number(parts[3]);
        emitter.rotations.fill(0);
      }
      if (label.includes('negative-length')) definition.lengthScale = -2;
      if (label.includes('negative-speed')) definition.velocityScale = -0.4;
      if (label.includes('zero-length')) definition.lengthScale = 0;
      if (label.includes('axial')) emitter.velocities.set([0, 0, 2]);
      if (label.includes('parallel')) emitter.velocities.set([1, 0.5, 10.2]);
    }
    if (
      label.startsWith('align-zero-') ||
      label.startsWith('plane-zero-') ||
      label.startsWith('freeform-zero-')
    )
      emitter.rotations.fill(0);
    const mesh = new ParticleMesh(
      emitter,
      definition,
      original.materialDefinition,
      Texture.WHITE,
      pack,
      { fog: { mode: 'none' }, viewPosition: [0, 0, -10] },
    );
    for (let frame = 0; frame <= 60; frame++) {
      if (frame) emitter.step(1 / 60);
      if (![0, 1, 2, 3, 15, 30, 60].includes(frame)) continue;
      const angle = label.startsWith('roll-') ? Math.PI / 6 : 0;
      const matrix = [
        Math.cos(angle),
        -Math.sin(angle),
        0,
        0,
        Math.sin(angle),
        Math.cos(angle),
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ];
      mesh.sync(matrix, 'gamma');
      const buffer = mesh.geometry.getBuffer('aPosition').data as Float32Array;
      result.push({
        label,
        frame,
        vertices: [0, 1, 2, 3].map((i) => {
          const x = buffer[i * 16]!,
            y = buffer[i * 16 + 1]!;
          return [
            Math.cos(angle) * x - Math.sin(angle) * y,
            Math.sin(angle) * x + Math.cos(angle) * y,
            buffer[i * 16 + 2]!,
          ];
        }),
      });
    }
    mesh.destroy();
  }
  return result;
}

export async function measureMeshChoices() {
  const { effect, app } = getPreview();
  if (!effect || !app) throw new Error('Missing preview');
  effect.pause();
  const original = effect.container.children[0] as ParticleMesh;
  const { ParticleRendererT } =
    await import('../../src/format/generated/noa/ir/particle-renderer.js');
  const { MeshDistribution } =
    await import('../../src/format/generated/noa/ir/mesh-distribution.js');
  const { TextureSheetModuleT } =
    await import('../../src/format/generated/noa/ir/texture-sheet-module.js');
  const { SheetRow } = await import('../../src/format/generated/noa/ir/sheet-row.js');
  const { SheetAnimation } = await import('../../src/format/generated/noa/ir/sheet-animation.js');
  const { constant } = await import('../particle-fixtures.js');
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
    getMesh: (id: number) => {
      const positions =
        id === 2
          ? [
              { x: -1, y: -0.5, z: 0 },
              { x: 1, y: -0.5, z: 0 },
              { x: 1, y: 0.5, z: 0 },
              { x: -1, y: 0.5, z: 0 },
            ]
          : [
              { x: -id / 2, y: -0.5, z: 0 },
              { x: id / 2, y: -0.5, z: 0 },
              { x: 0, y: 0.5, z: 0 },
            ];
      return {
        positions,
        uv0: positions.map((p) => ({ x: p.x / id + 0.5, y: p.y + 0.5 })),
        indices: id === 2 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2],
        submeshes: [{}],
      };
    },
  } as unknown as EffectPack;
  const scene = new Scene(pack, [1]);
  const source = particleSource();
  const sheet = new TextureSheetModuleT();
  sheet.columns = 1;
  sheet.rows = 3;
  sheet.rowMode = SheetRow.MeshIndex;
  sheet.animation = SheetAnimation.SingleRow;
  sheet.frameOverTime = constant(0);
  source.modules.push(new ParticleModuleT(M.TextureSheetModule, sheet));
  const e = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, []);
  e.count = 12;
  e.startSizes.fill(1);
  e.startColors.fill(1);
  e.lifetimes.fill(10);
  for (let i = 0; i < e.count; i++) {
    e.serials[i] = i;
    e.positions[i * 3] = i * 10;
    e.ages[i] = i / 100;
  }
  const definition = new ParticleRendererT();
  Object.assign(definition, structuredClone(original.definition), {
    mode: RenderMode.Mesh,
    alignment: Alignment.World,
    meshAssetIds: [1, 2, 3],
    meshWeights: [0, 1, 0],
    pivot: new Vec3T(0.25, 0, 0),
    sort: ParticleSort.OldestFirst,
  });
  const results = [];
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const distribution of [MeshDistribution.UniformRandom, MeshDistribution.NonUniformRandom]) {
    definition.meshDistribution = distribution;
    const mesh = new ParticleMesh(e, definition, original.materialDefinition, Texture.WHITE, pack);
    const stage = new Container();
    stage.addChild(mesh);
    try {
      const frames = [];
      for (const frame of [0, 1]) {
        if (frame) {
          e.count = 7;
          e.serials[2] = 100;
        }
        mesh.sync(matrix, 'gamma');
        const vertices = mesh.geometry.getBuffer('aPosition').data as Float32Array;
        const indices = Array.from(mesh.geometry.indexBuffer.data as Uint32Array).slice(
          0,
          mesh.geometry.indexCount,
        );
        frames.push({ indices, vertices: Array.from(vertices), count: e.count });
        app.renderer.render({ container: stage });
      }
      results.push({ distribution, frames });
    } finally {
      stage.removeChild(mesh);
      mesh.destroy();
      stage.destroy();
      e.count = 12;
      e.serials[2] = 2;
    }
  }
  return results;
}
