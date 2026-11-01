import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { LightsModuleT } from '../format/generated/noa/ir/lights-module.js';
import type { Emitter, Diagnostic } from './emitter.js';
import { particleSnapshot, type MutableParticleSnapshot } from './particle-snapshot.js';
import { random, scalar } from './parameters.js';

/** Borrowed light state, valid during update(). Positions and ranges use world units. */
export interface ParticleLightState {
  readonly systemId: number;
  readonly particleId: number;
  readonly position: Float64Array;
  readonly color: Float32Array;
  readonly range: number;
  readonly intensity: number;
}
/** Natsume owns handles returned by create(), and releases them with destroy(). */
export interface ParticleLightHandle {
  update(state: ParticleLightState): void;
  destroy(): void;
}
/** Borrowed host template. Other light properties remain under host control. */
export interface ParticleLightTemplate {
  readonly color: readonly [number, number, number];
  readonly range: number;
  readonly intensity: number;
  create(): ParticleLightHandle;
}

type LightRecord = { template: ParticleLightTemplate; handle: ParticleLightHandle };
type MutableLightState = { -readonly [K in keyof ParticleLightState]: ParticleLightState[K] };

export class ParticleLights {
  private readonly handles = new Map<number, LightRecord>();
  private readonly wanted = new Set<number>();
  private readonly indices: number[] = [];
  private snapshot: MutableParticleSnapshot | undefined;
  private readonly scratch = new Float32Array(4);
  private readonly state: MutableLightState = {
    systemId: 0,
    particleId: 0,
    position: new Float64Array(3),
    color: new Float32Array(3),
    range: 0,
    intensity: 0,
  };
  constructor(
    readonly definition: R<LightsModuleT>,
    private readonly diagnostics: Diagnostic[],
  ) {}
  clear(): void {
    for (const record of this.handles.values()) this.release(record.handle);
    this.handles.clear();
    this.wanted.clear();
    this.indices.length = 0;
  }
  private release(handle: ParticleLightHandle): void {
    try {
      handle.destroy();
    } catch (error) {
      this.diagnostics.push({
        code: 'PARTICLE_LIGHT_RELEASE_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  sync(e: Emitter): void {
    const d = this.definition,
      slot = d.light?.hostSlot;
    if (!slot || d.ratio === 0 || d.maxLights === 0 || !e.node.activeInHierarchy || !e.enabled) {
      this.clear();
      return;
    }
    const template = e.environment?.lights?.[String(slot)];
    check(template, 'HOST', `Missing particle light template ${slot}`);
    this.wanted.clear();
    this.indices.length = 0;
    for (let i = 0; i < e.count && this.indices.length < d.maxLights; i++) {
      const id = e.serials[i]!;
      const selected = d.randomDistribution
        ? random(e.seed, id, 87) < d.ratio
        : Math.floor((id + 1) * d.ratio) > Math.floor(id * d.ratio);
      if (selected) {
        this.wanted.add(id);
        this.indices.push(i);
      }
    }
    for (const [id, record] of this.handles)
      if (!this.wanted.has(id) || record.template !== template) {
        this.release(record.handle);
        this.handles.delete(id);
      }
    for (const index of this.indices) {
      const id = e.serials[index]!;
      let record = this.handles.get(id);
      if (!record) {
        const handle = template.create();
        if (
          !handle ||
          typeof handle.update !== 'function' ||
          typeof handle.destroy !== 'function'
        ) {
          if (handle && typeof handle.destroy === 'function') this.release(handle);
          check(false, 'HOST', 'Particle light create() must return update()/destroy()');
        }
        record = { template, handle };
        this.handles.set(id, record);
      }
      this.snapshot = particleSnapshot(e, index, 0, this.snapshot, this.scratch);
      const p = this.snapshot,
        s = this.state,
        phase = e.ages[index]! / e.lifetimes[index]!;
      s.systemId = e.id;
      s.particleId = id;
      s.position.set(p.position);
      for (let axis = 0; axis < 3; axis++)
        s.color[axis] = d.useParticleColor ? p.color[axis]! : template.color[axis]!;
      const size = Math.max(Math.abs(p.size[0]), Math.abs(p.size[1]), Math.abs(p.size[2]));
      s.range = Math.max(
        0,
        template.range *
          scalar(d.rangeMultiplier, phase, random(e.seed, id, 88), 1) *
          (d.sizeAffectsRange ? size : 1),
      );
      s.intensity = Math.max(
        0,
        template.intensity *
          scalar(d.intensityMultiplier, phase, random(e.seed, id, 89), 1) *
          (d.alphaAffectsIntensity ? p.color[3] : 1),
      );
      record.handle.update(s);
    }
  }
}
