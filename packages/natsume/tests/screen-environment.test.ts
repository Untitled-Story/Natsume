import { describe, expect, it } from 'vitest';
import { EffectPack } from '../src/index.js';
import {
  FixedStepClock,
  screenCanvasEnvironment,
  screenParticleEnvironment,
  stationaryRigidbodyVelocities,
} from '../src/index.js';
import { copyCanvasEnvironment } from '../src/rendering/canvas-environment.js';
import { copyEnvironment } from '../src/rendering/particle-environment.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { minimalDocument } from './helpers.js';
import { particleSource } from './particle-fixtures.js';

describe('FixedStepClock', () => {
  it('emits whole steps and carries the remainder', () => {
    const clock = new FixedStepClock(0.02);
    expect(clock.advance(0.01)).toEqual([]);
    expect(clock.advance(0.01)).toEqual([0.02]);
    expect(clock.advance(0.05)).toEqual([0.02, 0.02]);
    expect(clock.advance(0.01)).toEqual([0.02]);
    expect(clock.advance(0)).toEqual([]);
  });
  it('discards steps beyond the frame cap and supports reset', () => {
    const clock = new FixedStepClock(0.02, 3);
    expect(clock.advance(1)).toHaveLength(3);
    expect(clock.advance(0)).toEqual([]);
    clock.advance(0.01);
    clock.reset();
    expect(clock.advance(0.01)).toEqual([]);
  });
  it('rejects invalid configuration and deltas', () => {
    expect(() => new FixedStepClock(0)).toThrow('Step must be positive');
    expect(() => new FixedStepClock(0.02, 0)).toThrow('maxStepsPerFrame');
    const clock = new FixedStepClock();
    for (const bad of [-1, NaN, Infinity]) expect(() => clock.advance(bad)).toThrow('frame delta');
  });
});

describe('screen environment presets', () => {
  it('builds a valid orthographic canvas view that maps pixels one to one', () => {
    const environment = screenCanvasEnvironment(1280, 720);
    expect(copyCanvasEnvironment(environment)).toBeDefined();
    const { projectionMatrix: p, viewMatrix: v } = environment.mainCamera!;
    expect(p[0]).toBeCloseTo(2 / 1280, 12);
    expect(p[5]).toBeCloseTo(2 / 720, 12);
    expect(p[10]).toBeCloseTo(-2 / 1999.9, 12);
    expect(p[14]).toBeCloseTo(-2000.1 / 1999.9, 12);
    expect(v[14]).toBe(-1000);
    expect(screenCanvasEnvironment(10, 20, 2).displays).toEqual({ 2: { width: 10, height: 20 } });
  });
  it('builds a valid particle environment that accepts overrides', () => {
    expect(copyEnvironment(screenParticleEnvironment())).toBeDefined();
    const custom = screenParticleEnvironment({ gravity: [0, 0, 0], viewPosition: undefined });
    expect(custom.gravity).toEqual([0, 0, 0]);
    expect(custom.viewPosition).toBeUndefined();
    expect(custom.fog).toEqual({ mode: 'none' });
  });
  it('binds zero velocity to every declared Rigidbody slot', () => {
    const document = minimalDocument();
    const a = particleSource(),
      b = particleSource();
    a.main!.hostRigidbodyVelocitySlot = 'body-a';
    document.components = [
      new ComponentT(3, 1, true, ComponentData.ParticleSystem, a),
      new ComponentT(4, 1, true, ComponentData.ParticleSystem, b),
    ];
    const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
    expect(stationaryRigidbodyVelocities(pack)).toEqual({ 'body-a': [0, 0, 0] });
  });
});
