import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { Simulation } from '../src/runtime/simulation.js';
import { Emitter } from '../src/runtime/emitter.js';
import type { ParticleSystemT } from '../src/format/generated/noa/ir/particle-system.js';
import type { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { ParticleModuleData } from '../src/format/generated/noa/ir/particle-module-data.js';
import { Scene } from '../src/runtime/scene.js';
import { curve, scalar, random } from '../src/runtime/parameters.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { WrapMode } from '../src/format/generated/noa/ir/wrap-mode.js';
import { Interpolation } from '../src/format/generated/noa/ir/interpolation.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { RectLayoutT } from '../src/format/generated/noa/ir/rect-layout.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { archive, minimalDocument } from './helpers.js';

it('evaluates Hermite slope units and verified Unity clamp outside the curve', () => {
  const c = new ScalarCurveT();
  c.preWrap = c.postWrap = WrapMode.UnitySerialized;
  c.sourcePreInfinity = c.sourcePostInfinity = 2;
  const a = new FloatKeyT(),
    b = new FloatKeyT();
  a.time = 2;
  a.value = 1;
  a.outSlope = 2;
  a.interpolation = Interpolation.CubicHermite;
  b.time = 4;
  b.value = 5;
  b.inSlope = 2;
  c.keys = [a, b];
  expect(curve(c, 3)).toBe(3);
  expect(curve(c, -1)).toBe(1);
  expect(curve(c, 5)).toBe(5);
  c.postWrap = WrapMode.PingPong;
  expect(curve(c, 5)).toBe(3);
  expect(curve(c, 6)).toBe(1);
  c.postWrap = WrapMode.Loop;
  expect(curve(c, 4)).toBe(1);
});
it('resolves root-owned size and child anchors without host window dimensions', async () => {
  const d = minimalDocument();
  const rect = (x: number, y: number, w: number, h: number) =>
    new RectLayoutT(
      new Vec2T(x, y),
      new Vec2T(x, y),
      new Vec2T(0.5, 0.5),
      new Vec3T(),
      new Vec2T(w, h),
    );
  d.components = [new ComponentT(3, 1, true, ComponentData.RectLayout, rect(0.5, 0, 100, 200))];
  const child = new NodeT(4, 'child', 1, true, d.nodes[0]!.transform);
  d.nodes.push(child);
  d.components.push(new ComponentT(5, 4, true, ComponentData.RectLayout, rect(1, 1, 10, 20)));
  const pack = await loadPack(await archive((await import('./helpers.js')).encode(d)));
  const scene = new Scene(pack, [1]);
  expect(scene.layoutSize).toEqual({ width: 100, height: 200 });
  expect(Array.from(scene.nodes.get(4)!.worldMatrix).slice(12, 15)).toEqual([50, 100, 0]);
});

const sample = new URL('../../../data/kirakira.noap', import.meta.url);
describe.skipIf(!existsSync(sample))('kirakira playback', () => {
  const create = async () => new Simulation(await loadPack(readFileSync(sample)), { seed: 123 });
  const snapshot = (s: Simulation) =>
    [...s.emitters.values()].map((e) => ({
      id: e.id,
      count: e.count,
      positions: Array.from(e.positions.slice(0, e.count * 3)),
      ages: Array.from(e.ages.slice(0, e.count)),
    }));
  it('uses built-in Curl Noise and reports four noise modules', async () => {
    const pack = await loadPack(readFileSync(sample));
    expect(
      new Simulation(pack).diagnostics.filter((d) => d.code === 'APPROXIMATE_NOISE'),
    ).toHaveLength(4);
    const s = await create();
    expect(s.diagnostics.filter((d) => d.code === 'APPROXIMATE_NOISE')).toHaveLength(4);
    expect(s.scene.layoutSize).toEqual({ width: 100, height: 100 });
  });
  it('applies zero-duration state once, births 100 particles and emits 45/sec', async () => {
    const s = await create();
    s.play();
    expect(s.particleCount).toBe(100);
    s.play();
    expect(s.particleCount).toBe(100);
    s.applyAnimatorState(44, 'kirakira_01');
    expect(s.particleCount).toBe(100);
    const rate = [...s.emitters.values()].reduce((n, e) => n + scalar(e.emission?.rateOverTime), 0);
    expect(rate).toBe(45);
    expect(s.state).toBe('playing');
  });
  it('does not emit before play and can play after an idle stop', async () => {
    const s = await create();
    s.setNodeActive(12, false);
    s.setNodeActive(12, true);
    expect(s.particleCount).toBe(0);
    s.stop('clear');
    s.play();
    expect(s.particleCount).toBe(100);
  });
  it('pause freezes simulation; restart reproduces per-instance and fixed seeds', async () => {
    const s = await create();
    s.play();
    for (let i = 0; i < 45; i++) s.update(1 / 60);
    const a = snapshot(s);
    s.pause();
    s.update(5);
    expect(snapshot(s)).toEqual(a);
    expect(s.state).toBe('paused');
    s.restart();
    for (let i = 0; i < 45; i++) s.update(1 / 60);
    expect(snapshot(s)).toEqual(a);
  });
  it('drain finishes naturally while Animator Stop deactivates the hierarchy immediately', async () => {
    const s = await create();
    s.play();
    s.stop();
    expect(s.particleCount).toBe(100);
    expect(s.state).toBe('draining');
    for (let i = 0; i < 360; i++) s.update(1 / 60);
    expect(s.particleCount).toBe(0);
    expect(s.state).toBe('stopped');
    s.restart();
    s.applyAnimatorState(44, 'Stop');
    expect(s.particleCount).toBe(0);
    expect(s.state).toBe('playing');
    s.applyAnimatorState(44, 'kirakira_01');
    expect(s.particleCount).toBe(100);
  });
  it('fixed-step partitioning is deterministic and long frames have bounded catch-up', async () => {
    const a = await create(),
      b = await create();
    a.play();
    b.play();
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    for (let i = 0; i < 60; i++) b.update(1 / 60);
    expect(snapshot(a)).toEqual(snapshot(b));
    const time = a.time;
    a.update(10);
    expect(a.time - time).toBeCloseTo(8 / 60);
    expect(a.droppedSeconds).toBeGreaterThan(9.8);
    expect(() => a.update(-1)).toThrow();
  });
  it('uses native limit decay and native orbital ZXY order', async () => {
    const s = await create();
    s.play();
    const limitOriginal = s.emitters.get(76)!;
    const limitSource = structuredClone(limitOriginal.source) as ParticleSystemT;
    // Isolate the native limit-only fixture from the sample's lifecycle velocity.
    limitSource.modules = limitSource.modules.filter(
      (m) => m.dataType !== ParticleModuleData.VelocityModule,
    );
    const e = new Emitter(76, limitOriginal.node, limitSource, true, 123, []);
    e.sync();
    e.count = 1;
    e.positions.fill(0);
    e.velocities.fill(0);
    e.velocities[0] = 10;
    e.ages[0] = 0;
    e.lifetimes[0] = 10;
    e.emitting = false;
    e.step(1 / 60);
    expect(e.velocities[0]).toBeCloseTo(8.6190977, 5);
    const original = s.emitters.get(66)!,
      source = structuredClone(original.source) as ParticleSystemT;
    const velocity = source.modules.find((m) => m.dataType === ParticleModuleData.VelocityModule)!
      .data as VelocityModuleT;
    for (const [index, axis] of ['x', 'y', 'z'].entries()) {
      const key = axis as 'x' | 'y' | 'z';
      velocity.linear![key]!.constantMin = velocity.linear![key]!.constantMax = 0;
      velocity.orbital![key]!.constantMin = velocity.orbital![key]!.constantMax = [1, 0.5, 0][
        index
      ]!;
    }
    const orbital = new Emitter(66, original.node, source, true, 123, []);
    orbital.sync();
    orbital.count = 1;
    orbital.positions.fill(0);
    orbital.positions[0] = 1;
    orbital.velocities.fill(0);
    orbital.ages[0] = 0;
    orbital.lifetimes[0] = 10;
    orbital.emitting = false;
    for (let i = 0; i < 4; i++) orbital.step(1 / 60);
    // Golden samples from the installed Unity editor, not the model formula.
    expect(orbital.positions[0]).toBeCloseTo(0.99944431, 6);
    expect(orbital.positions[1]).toBeCloseTo(0.000833046, 6);
    expect(orbital.positions[2]).toBeCloseTo(-0.03331099, 6);
  });
});
it('random channels are stable, uint32 bounded and decorrelated', () => {
  expect(random(0, 0, 0)).toBe(random(0, 0, 0));
  expect(random(0, 0, 0)).not.toBe(random(0, 0, 1));
  expect(random(0xffffffff, 0xffffffff, 0xffffffff)).toBeLessThan(1);
});

it('preserves Unity signed RectTransform sizes and child anchor positions', async () => {
  const native = JSON.parse(
    readFileSync(new URL('./fixtures/unity-layout.json', import.meta.url), 'utf8'),
  );
  const d = minimalDocument();
  d.nodes.push(new NodeT(4, 'child', 1, true, d.nodes[0]!.transform));
  d.components = [
    new ComponentT(
      3,
      1,
      true,
      ComponentData.RectLayout,
      new RectLayoutT(
        new Vec2T(),
        new Vec2T(),
        new Vec2T(0.25, 0.75),
        new Vec3T(),
        new Vec2T(-100, -200),
      ),
    ),
    new ComponentT(
      5,
      4,
      true,
      ComponentData.RectLayout,
      new RectLayoutT(
        new Vec2T(0.1, 0.2),
        new Vec2T(0.8, 0.9),
        new Vec2T(0.3, 0.6),
        new Vec3T(5, 6, 7),
        new Vec2T(-20, 0),
      ),
    ),
  ];
  const pack = await loadPack(await archive((await import('./helpers.js')).encode(d)));
  const scene = new Scene(pack, [1]);
  expect(scene.layoutSize).toEqual({ width: native.rootSize.x, height: native.rootSize.y });
  expect(Math.abs(scene.nodes.get(4)!.layout!.width - native.childSize.x)).toBeLessThan(1e-5);
  expect(Math.abs(scene.nodes.get(4)!.layout!.height - native.childSize.y)).toBeLessThan(1e-5);
  for (const [i, k] of (['x', 'y', 'z'] as const).entries())
    expect(scene.nodes.get(4)!.localMatrix[12 + i]).toBeCloseTo(native.childPosition[k], 5);
  pack.dispose();
});
