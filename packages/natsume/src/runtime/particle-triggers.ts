import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { TriggerModuleT } from '../format/generated/noa/ir/trigger-module.js';
import type { Emitter } from './emitter.js';
import type { ParticleColliderSweepQuery, ParticleTriggerEvent } from './particle-physics.js';
import { vec3 } from 'gl-matrix';
import { particleSnapshot, type MutableParticleSnapshot } from './particle-snapshot.js';

/** Union membership is keyed by stable particle ID, independent of array compaction. */
export class ParticleTriggers {
  private readonly inside = new Set<number>();
  private readonly position = new Float64Array(3);
  private readonly displacement = new Float64Array(3);
  private readonly color = new Float32Array(4);
  private snapshot: MutableParticleSnapshot | undefined;
  private readonly matches: { slot: number; colliderId: string }[] = [];
  private readonly query: {
    -readonly [K in keyof ParticleColliderSweepQuery]: ParticleColliderSweepQuery[K];
  } = {
    position: this.position,
    displacement: this.displacement,
    radius: 0,
    dimension: '3d',
  };
  constructor(readonly definition: R<TriggerModuleT>) {}
  clear(): void {
    this.inside.clear();
  }
  forget(id: number): void {
    this.inside.delete(id);
  }
  resolve(e: Emitter, index: number, age: number, x: number, y: number, z: number): number {
    const d = this.definition;
    if (!(d.inside || d.outside || d.enter || d.exit)) return age;
    const previousAge = e.ages[index]!;
    e.ages[index] = age;
    try {
      this.snapshot = particleSnapshot(e, index, 0, this.snapshot, this.color);
      const snapshot = this.snapshot,
        query = this.query;
      vec3.set(query.position, x, y, z);
      vec3.transformMat4(query.position, query.position, e.simulationMatrix);
      for (let axis = 0; axis < 3; axis++)
        query.displacement[axis] = snapshot.position[axis]! - query.position[axis]!;
      query.radius =
        Math.max(
          Math.abs(snapshot.size[0]),
          Math.abs(snapshot.size[1]),
          Math.abs(snapshot.size[2]),
        ) *
        d.radiusScale *
        0.5;
      this.matches.length = 0;
      let nextInside = false;
      for (const [slot, reference] of d.colliders.entries()) {
        if (!reference.hostSlot) continue;
        const collider = e.environment?.colliders?.[String(reference.hostSlot)];
        check(
          collider?.sweepSphere,
          'HOST',
          `Trigger requires collider sweepSphere slot ${reference.hostSlot}`,
        );
        query.dimension = reference.kind === 2 ? '2d' : '3d';
        const overlaps = collider.sweepSphere(query);
        check(typeof overlaps === 'boolean', 'HOST', 'Collider sweepSphere must return a boolean');
        if (!overlaps) continue;
        nextInside = true;
        if (d.query === 2 || (d.query === 1 && !this.matches.length))
          this.matches.push({ slot, colliderId: collider.id });
      }
      const id = snapshot.id,
        wasInside = this.inside.has(id);
      if (nextInside) this.inside.add(id);
      else this.inside.delete(id);
      const types = ['inside', 'outside', 'enter', 'exit'] as const;
      for (const kind of types) {
        if (
          !(kind === 'inside'
            ? nextInside
            : kind === 'outside'
              ? !nextInside
              : kind === 'enter'
                ? nextInside && !wasInside
                : !nextInside && wasInside)
        )
          continue;
        const action = d[kind];
        if (action === 0) continue;
        if (action === 1) e.ages[index] = age = e.lifetimes[index]!;
        if (action === 2) {
          const event: ParticleTriggerEvent = {
            systemId: e.id,
            nodeId: e.node.id,
            particleId: id,
            kind,
            position: [snapshot.position[0], snapshot.position[1], snapshot.position[2]],
            colliders:
              kind === 'inside' || kind === 'enter'
                ? this.matches.map((match) => ({ ...match }))
                : [],
          };
          e.onTriggerMessage?.(event);
        }
        e.onTrigger?.(index);
      }
      return age;
    } finally {
      e.ages[index] = previousAge;
    }
  }
}
