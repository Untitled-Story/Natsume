import type { DeepReadonly as R } from '../pack.js';
import type { TrailsModuleT } from '../format/generated/noa/ir/trails-module.js';
import { TrailMode } from '../format/generated/noa/ir/trail-mode.js';
import type { Emitter } from './emitter.js';
import { particleSnapshot, type MutableParticleSnapshot } from './particle-snapshot.js';
import { random } from './parameters.js';
import { trailLifetime } from './trail-parameters.js';
import type { TrailPointPool } from './trail-point-pool.js';

export interface TrailRecord {
  readonly id: number;
  readonly phase: number;
  readonly lifetime: number;
  readonly head: number;
  anchor: number;
  alive: boolean;
  particle: MutableParticleSnapshot;
  distance: number;
  custom: number;
  readonly ribbonGroup?: string;
}

/** Per-system trail history backed by the instance's bounded, reusable point pool. */
export class ParticleTrails {
  readonly records = new Map<number, TrailRecord>();
  private time = 0;
  private readonly live = new Map<number, number>();
  private readonly vector = new Float64Array(3);
  private readonly colorScratch = new Float32Array(4);
  private readonly deathSamples: { record: TrailRecord; anchor: number; factor: number }[] = [];
  private readonly ribbonAnchors = new Map<string, { point: number; count: number }>();

  constructor(
    readonly emitter: Emitter,
    readonly definition: R<TrailsModuleT>,
    readonly pool: TrailPointPool,
  ) {
    emitter.enableLifetimeProgress();
    const birth = emitter.onBirth,
      death = emitter.onDeath,
      clear = emitter.onClear,
      disable = emitter.onDisable,
      advanced = emitter.onAdvanced;
    emitter.onBirth = (index, phase) => {
      birth?.(index, phase);
      this.birth(index, phase);
    };
    emitter.onDeath = (index) => {
      death?.(index);
      this.death(index);
    };
    emitter.onClear = () => {
      clear?.();
      this.clear();
    };
    emitter.onDisable = () => {
      disable?.();
      this.clear();
    };
    emitter.onAdvanced = (seconds) => {
      advanced?.(seconds);
      this.advance(seconds);
    };
  }

  clear(): void {
    for (const record of this.records.values()) this.release(record);
    this.records.clear();
    this.live.clear();
    this.deathSamples.length = 0;
    this.time = 0;
  }

  /** Visits visible centers in native order. A negative point ends each strip. */
  visit(
    visitor: (record: TrailRecord, point: number, x: number, y: number, z: number) => void,
  ): void {
    const ribbon = this.definition.mode === TrailMode.Ribbon;
    if (ribbon) {
      // Unity sorts by absolute particle age; equal ages retain compacted particle slots.
      const records: TrailRecord[] = [];
      for (let i = 0; i < this.emitter.count; i++) {
        const record = this.records.get(this.emitter.serials[i]!);
        if (record?.alive) records.push(record);
      }
      records.sort((a, b) => b.particle.age - a.particle.age);
      const groups = new Map<string, TrailRecord[]>();
      if (this.definition.splitSubEmitterRibbons) {
        // Native traversal strides through the parent-sorted array across group boundaries.
        records.sort((a, b) => {
          const ap = a.ribbonGroup!.split('/'),
            bp = b.ribbonGroup!.split('/');
          return (
            Number(bp[0]) - Number(ap[0]) ||
            Number(bp[1]) - Number(ap[1]) ||
            b.particle.age - a.particle.age
          );
        });
        let lane = 0;
        while (lane < this.definition.ribbonCount && lane < records.length) {
          let cursor = lane,
            lastStart = lane;
          while (cursor < records.length) {
            const group: TrailRecord[] = [];
            const parent = records[cursor]!.ribbonGroup!.slice(
              0,
              records[cursor]!.ribbonGroup!.lastIndexOf('/') + 1,
            );
            lastStart = cursor;
            while (cursor < records.length) {
              const record = records[cursor]!;
              if (group.length && !record.ribbonGroup!.startsWith(parent)) break;
              group.push(record);
              cursor += this.definition.ribbonCount;
            }
            groups.set(String(groups.size), group);
          }
          lane = lastStart + 1;
        }
      } else {
        for (let ordinal = 0; ordinal < records.length; ordinal++) {
          const key = String(ordinal % this.definition.ribbonCount);
          let group = groups.get(key);
          if (!group) groups.set(key, (group = []));
          group.push(records[ordinal]!);
        }
      }
      for (const group of groups.values()) {
        let last: TrailRecord | undefined;
        for (const record of group) {
          this.position(record.head);
          visitor(record, record.head, this.vector[0]!, this.vector[1]!, this.vector[2]!);
          last = record;
        }
        if (last) {
          if (this.definition.attachRibbonsToTransform) {
            const m = this.emitter.node.worldMatrix;
            visitor(last, last.head, m[12]!, m[13]!, m[14]!);
          }
          visitor(last, -1, 0, 0, 0);
        }
      }
      return;
    }
    for (const record of this.records.values()) {
      const cutoff = this.time - record.lifetime;
      let point = record.head;
      let newer = -1;
      while (point >= 0) {
        const time = this.pool.read(point, 3);
        if (time < cutoff && newer >= 0) {
          const nextTime = this.pool.read(newer, 3);
          const factor = Math.max(0, Math.min(1, (cutoff - time) / (nextTime - time || 1)));
          const x =
            this.pool.read(point, 0) +
            (this.pool.read(newer, 0) - this.pool.read(point, 0)) * factor;
          const y =
            this.pool.read(point, 1) +
            (this.pool.read(newer, 1) - this.pool.read(point, 1)) * factor;
          const z =
            this.pool.read(point, 2) +
            (this.pool.read(newer, 2) - this.pool.read(point, 2)) * factor;
          this.positionValues(x, y, z);
          visitor(record, point, this.vector[0]!, this.vector[1]!, this.vector[2]!);
          break;
        }
        this.position(point);
        visitor(record, point, this.vector[0]!, this.vector[1]!, this.vector[2]!);
        newer = point;
        point = this.pool.next(point);
      }
      visitor(record, -1, 0, 0, 0);
    }
  }

  private birth(index: number, phase: number): void {
    const id = this.emitter.serials[index]!;
    if (
      this.definition.mode === TrailMode.Ribbon &&
      this.definition.splitSubEmitterRibbons &&
      !this.emitter.subParentSystems?.[index]
    )
      return;
    if (
      this.definition.mode === TrailMode.PerParticle &&
      random(this.emitter.seed, id, 190) >= this.definition.ratio
    )
      return;
    // The first sample is taken after integration, rather than at the birth position.
    this.live.set(id, phase);
    if (this.definition.mode === TrailMode.Ribbon) this.sample(index);
  }

  private death(index: number): void {
    const id = this.emitter.serials[index]!;
    let record = this.records.get(id);
    if (!this.definition.dieWithParticles && this.definition.mode === TrailMode.PerParticle) {
      const previous = record?.anchor;
      const previousAge = record?.particle.age ?? 0;
      const px = record ? this.pool.read(record.head, 0) : 0,
        py = record ? this.pool.read(record.head, 1) : 0,
        pz = record ? this.pool.read(record.head, 2) : 0;
      this.sample(index, false);
      record = this.records.get(id);
      if (record) {
        const factor = Math.max(
          0,
          Math.min(
            1,
            (record.particle.lifetime - previousAge) / (record.particle.age - previousAge || 1),
          ),
        );
        if (factor < 1)
          this.pool.write(
            record.head,
            px + (this.pool.read(record.head, 0) - px) * factor,
            py + (this.pool.read(record.head, 1) - py) * factor,
            pz + (this.pool.read(record.head, 2) - pz) * factor,
            this.time,
            record.distance,
          );
        this.deathSamples.push({
          record,
          anchor: record.anchor !== previous ? record.anchor : -1,
          factor,
        });
      }
    }
    this.live.delete(id);
    if (!record) return;
    record.alive = false;
    if (this.definition.dieWithParticles || this.definition.mode === TrailMode.Ribbon) {
      this.release(record);
      this.records.delete(id);
    }
  }

  private advance(seconds: number): void {
    this.time += seconds;
    for (const { record, anchor, factor } of this.deathSamples) {
      if (this.records.get(record.id) !== record) continue;
      for (const point of anchor < 0 ? [record.head] : [record.head, anchor])
        this.pool.write(
          point,
          this.pool.read(point, 0),
          this.pool.read(point, 1),
          this.pool.read(point, 2),
          this.time - seconds * (1 - factor),
          this.pool.read(point, 4),
        );
    }
    this.deathSamples.length = 0;
    const e = this.emitter;
    const ribbon = this.definition.mode === TrailMode.Ribbon;
    // Release expired history before births/anchors consume the shared budget.
    if (!ribbon) this.prune();
    for (let index = 0; index < e.count; index++) {
      const id = e.serials[index]!;
      if (!this.live.has(id)) continue;
      this.sample(index);
    }
  }

  private prune(): void {
    for (const [id, record] of this.records) {
      const cutoff = this.time - record.lifetime;
      if ((!record.alive && this.pool.read(record.head, 3) < cutoff) || record.lifetime <= 0) {
        this.release(record);
        this.records.delete(id);
        continue;
      }
      let point = this.pool.next(record.head);
      while (point >= 0) {
        const next = this.pool.next(point);
        if (this.pool.read(point, 3) < cutoff) {
          this.pool.setNext(point, -1);
          this.releaseChain(next);
          break;
        }
        point = next;
      }
    }
  }

  private sample(index: number, storeAnchor = true): void {
    const e = this.emitter,
      id = e.serials[index]!;
    const ribbon = this.definition.mode === TrailMode.Ribbon;
    let record = this.records.get(id);
    const particle = particleSnapshot(e, index, 0, record?.particle, this.colorScratch);
    const offset = index * 3;
    const [x, y, z] = this.definition.worldSpace
      ? particle.position
      : [e.positions[offset]!, e.positions[offset + 1]!, e.positions[offset + 2]!];
    if (!record) {
      const phase = this.live.get(id)!;
      const lifetime = trailLifetime(
        this.definition,
        particle.lifetime,
        particle.size,
        phase,
        random(e.seed, id, 191),
      );
      if (!ribbon && lifetime <= 0) return;
      const head = this.pool.allocate(x, y, z, this.time, 0);
      const ribbonGroup = ribbon
        ? `${this.definition.splitSubEmitterRibbons ? `${e.subParentSystems![index]}/${e.subParentParticles![index]}/` : ''}${id % this.definition.ribbonCount}`
        : undefined;
      let anchor = -1;
      try {
        if (!ribbon) anchor = this.pool.allocate(x, y, z, this.time, 0);
        else if (this.definition.attachRibbonsToTransform) {
          const group = this.ribbonAnchors.get(ribbonGroup!);
          if (group) group.count++;
          else
            this.ribbonAnchors.set(ribbonGroup!, {
              point: this.pool.allocate(0, 0, 0, this.time, 0),
              count: 1,
            });
        }
      } catch (error) {
        this.pool.release(head);
        throw error;
      }
      this.pool.setNext(head, anchor);
      record = {
        id,
        phase,
        lifetime,
        head,
        anchor,
        alive: true,
        particle,
        distance: 0,
        custom: e.customData?.[index * 8] ?? 0,
        ...(ribbonGroup === undefined ? {} : { ribbonGroup }),
      };
      this.records.set(id, record);
    } else {
      record.distance += Math.hypot(
        x - this.pool.read(record.head, 0),
        y - this.pool.read(record.head, 1),
        z - this.pool.read(record.head, 2),
      );
      if (!ribbon) {
        const distance = Math.fround(
          Math.hypot(
            x - this.pool.read(record.anchor, 0),
            y - this.pool.read(record.anchor, 1),
            z - this.pool.read(record.anchor, 2),
          ),
        );
        if (
          storeAnchor &&
          particle.remainingLifetime > 0 &&
          distance > Math.fround(this.definition.minVertexDistance)
        ) {
          const anchor = this.pool.allocate(x, y, z, this.time, record.distance);
          this.pool.setNext(anchor, record.anchor);
          this.pool.setNext(record.head, anchor);
          record.anchor = anchor;
        }
      }
      this.pool.write(record.head, x, y, z, this.time, record.distance);
      record.particle = particle;
      record.custom = e.customData?.[index * 8] ?? 0;
    }
  }

  private release(record: TrailRecord): void {
    this.releaseChain(record.head);
    const group =
      record.ribbonGroup === undefined ? undefined : this.ribbonAnchors.get(record.ribbonGroup);
    if (group && --group.count === 0) {
      this.pool.release(group.point);
      this.ribbonAnchors.delete(record.ribbonGroup!);
    }
  }
  private releaseChain(point: number): void {
    while (point >= 0) {
      const next = this.pool.next(point);
      this.pool.release(point);
      point = next;
    }
  }
  private position(point: number): void {
    this.positionValues(
      this.pool.read(point, 0),
      this.pool.read(point, 1),
      this.pool.read(point, 2),
    );
  }
  private positionValues(x: number, y: number, z: number): void {
    if (this.definition.worldSpace) {
      this.vector.set([x, y, z]);
      return;
    }
    const m = this.emitter.simulationMatrix;
    this.vector[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    this.vector[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    this.vector[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
}
