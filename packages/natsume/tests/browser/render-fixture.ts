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
import type { EffectPack } from '../../src/pack.js';
import { randomSource } from '../random-fixtures.js';
import { vector } from '../particle-fixtures.js';
import { ParticleModuleT } from '../../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../../src/format/generated/noa/ir/particle-module-data.js';
import { VelocityModuleT } from '../../src/format/generated/noa/ir/velocity-module.js';
import { QuaternionT } from '../../src/format/generated/noa/ir/quaternion.js';

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
    if (label === 'stretch-zero-speed' || label === 'stretch-linear-velocity')
      source.modules.push(
        new ParticleModuleT(
          M.VelocityModule,
          new VelocityModuleT(
            vector(label === 'stretch-zero-speed' ? -2 : 0, label === 'stretch-zero-speed' ? 0 : 2),
          ),
        ),
      );
    const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 1, []);
    manualParticle(emitter);
    const definition = structuredClone(original.definition) as ParticleRendererT;
    definition.mode = mode;
    definition.alignment = label.includes('local-')
      ? Alignment.Local
      : label.startsWith('mesh-view') || label === 'stretch-view'
        ? Alignment.View
        : Alignment.World;
    definition.cameraVelocityScale = definition.velocityScale = 0;
    definition.lengthScale =
      label === 'stretch-positive' ? 2 : label === 'stretch-negative-one' ? -1 : -4;
    definition.freeformStretching = false;
    definition.rotateWithStretchDirection = true;
    if (label === 'billboard-pivot') definition.pivot = new Vec3T(0.25, -0.5, 0.1);
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
        emitter.node.worldMatrix[10] = -1;
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        result.transformed = Array.from(mesh.geometry.indexBuffer!.data.slice(0, 3));
        emitter.node.worldMatrix[10] = 1;
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
  effect.setParticleEnvironment({
    fog: { mode: 'none' },
    gravity: [0, 0, 0],
    viewVelocity: [0, 3, 0],
  });
  const updated =
    meshes.every((mesh) => mesh.environment?.viewVelocity?.[1] === 3) &&
    first.gravity[1] === 0 &&
    second.gravity[1] === 0 &&
    effect.state === 'paused';
  effect.simulation.emitters.delete(first.id);
  effect.simulation.emitters.delete(second.id);
  return { rejected, preserved, updated };
}
