import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { SubEmitterEvent as Event } from '../format/generated/noa/ir/sub-emitter-event.js';
import type { SubEmitterT } from '../format/generated/noa/ir/sub-emitter.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { Emitter } from './emitter.js';
import { particleSnapshot, type ParticleSnapshot } from './particle-snapshot.js';
import { random, scalar } from './parameters.js';

interface BirthChannel {
  readonly source: Emitter;
  readonly target: Emitter;
  readonly edge: R<SubEmitterT>;
  readonly slot: number;
  readonly particle: number;
  previous: ParticleSnapshot;
  time: number;
  rateTime: number;
  carry: number;
  readonly bursts: Map<number, number>;
}
interface PendingBirth {
  readonly parentSystem: number;
  readonly target: Emitter;
  readonly parent: ParticleSnapshot;
  readonly properties: number;
  readonly amount?: number;
  readonly phase?: number;
  readonly time?: number;
  readonly spacing?: number;
  readonly remainder?: number;
}

/** Ordered DAG scheduling; channels share each target's original particle pool. */
export class SubEmitterGraph {
  readonly order: readonly Emitter[];
  private readonly slots = new Map<number, readonly R<SubEmitterT>[]>();
  private readonly channels: BirthChannel[] = [];
  private readonly before = new Map<number, PendingBirth[]>();
  private readonly after = new Map<number, PendingBirth[]>();
  private sequence = 0;
  private readonly indices = new Map<number, number>();

  constructor(private readonly emitters: ReadonlyMap<number, Emitter>) {
    const indegree = new Map<number, number>();
    for (const id of emitters.keys()) indegree.set(id, 0);
    for (const source of emitters.values()) {
      const module = source.source.modules.find((m) => m.dataType === M.SubEmittersModule);
      if (!module) continue;
      const edges = (module.data as R<SubEmittersModuleT>).emitters;
      this.slots.set(source.id, edges);
      if (edges.some((edge) => edge.systemComponentId)) {
        source.renderVelocities ??= new Float32Array(source.velocities.length);
        source.renderVelocities.set(source.velocities);
      }
      for (const edge of edges)
        if (edge.systemComponentId) {
          check(
            emitters.has(edge.systemComponentId),
            'CAPABILITY',
            'Sub-emitter target is outside this instance',
          );
          indegree.set(edge.systemComponentId, indegree.get(edge.systemComponentId)! + 1);
        }
      source.onBirth = (index) => this.birth(source, index);
      source.onDeath = (index) => this.death(source, index);
      source.onClear = () => this.clearSource(source.id);
    }
    const queue = [...emitters.values()].filter((e) => indegree.get(e.id) === 0);
    for (let index = 0; index < queue.length; index++)
      for (const edge of this.slots.get(queue[index]!.id) ?? [])
        if (edge.systemComponentId) {
          const count = indegree.get(edge.systemComponentId)! - 1;
          indegree.set(edge.systemComponentId, count);
          if (count === 0) queue.push(emitters.get(edge.systemComponentId)!);
        }
    check(queue.length === emitters.size, 'SEMANTIC', 'Sub-emitter graph contains a cycle');
    this.order = queue;
  }

  trigger(systemId: number, slot: number, particleId?: number): void {
    const source = this.emitters.get(systemId);
    check(source, 'HOST', 'Unknown particle system');
    const edges = this.slots.get(systemId);
    check(
      Number.isInteger(slot) && slot >= 0 && edges && slot < edges.length,
      'HOST',
      'Unknown sub-emitter slot',
    );
    check(
      particleId === undefined || (Number.isInteger(particleId) && particleId >= 0),
      'HOST',
      'Invalid particle ID',
    );
    const selected: number[] = [];
    for (let i = 0; i < source.count; i++)
      if (particleId === undefined || source.serials[i] === particleId) selected.push(i);
    check(particleId === undefined || selected.length, 'HOST', 'Particle is no longer alive');
    const edge = edges[slot]!;
    if (!edge.systemComponentId) return;
    const target = this.emitters.get(edge.systemComponentId)!;
    for (const index of selected)
      if (this.accept(source, index, edge, slot))
        this.emit({
          target,
          parentSystem: source.id,
          parent: particleSnapshot(source, index),
          properties: edge.inheritProperties,
        });
  }

  step(delta: number): void {
    for (const emitter of this.order) {
      this.flush(this.before, emitter.id);
      emitter.step(delta);
      this.advanceChannels(emitter, delta);
      this.flush(this.after, emitter.id);
    }
  }

  clear(): void {
    this.channels.length = 0;
    this.before.clear();
    this.after.clear();
    this.sequence = 0;
  }

  private accept(source: Emitter, index: number, edge: R<SubEmitterT>, slot: number): boolean {
    const sequence = this.sequence++;
    return (
      edge.systemComponentId !== 0 &&
      random(source.seed, source.serials[index]! + sequence, 180 + slot) < edge.probability
    );
  }
  private birth(source: Emitter, index: number): void {
    for (const [slot, edge] of (this.slots.get(source.id) ?? []).entries()) {
      if (edge.event !== Event.Birth || !this.accept(source, index, edge, slot)) continue;
      this.channels.push({
        source,
        target: this.emitters.get(edge.systemComponentId)!,
        edge,
        slot,
        particle: source.serials[index]!,
        previous: particleSnapshot(source, index),
        time: 0,
        rateTime: 0,
        carry: 0,
        bursts: new Map(),
      });
    }
  }
  private death(source: Emitter, index: number): void {
    for (const [slot, edge] of (this.slots.get(source.id) ?? []).entries()) {
      if (edge.event !== Event.Death || !this.accept(source, index, edge, slot)) continue;
      this.enqueue(this.after, {
        target: this.emitters.get(edge.systemComponentId)!,
        parentSystem: source.id,
        parent: particleSnapshot(source, index),
        properties: edge.inheritProperties,
      });
    }
  }
  private clearSource(id: number): void {
    for (let i = this.channels.length - 1; i >= 0; i--)
      if (this.channels[i]!.source.id === id || this.channels[i]!.target.id === id)
        this.channels.splice(i, 1);
    this.before.delete(id);
    this.after.delete(id);
  }
  private enqueue(queue: Map<number, PendingBirth[]>, birth: PendingBirth): void {
    let births = queue.get(birth.target.id);
    if (!births) queue.set(birth.target.id, (births = []));
    births.push(birth);
  }
  private emit(birth: PendingBirth): void {
    if (!birth.target.enabled || !birth.target.node.activeInHierarchy) return;
    if (birth.amount === undefined)
      birth.target.emitTriggeredBurst(birth.parent, birth.properties, birth.parentSystem);
    else
      birth.target.emitSubParticles(
        birth.amount,
        birth.phase!,
        birth.time!,
        birth.parent,
        birth.properties,
        birth.spacing,
        birth.remainder,
        birth.parentSystem,
      );
  }
  private flush(queue: Map<number, PendingBirth[]>, id: number): void {
    const pending = queue.get(id);
    if (!pending) return;
    queue.delete(id);
    for (const birth of pending) this.emit(birth);
  }

  private advanceChannels(source: Emitter, delta: number): void {
    if (!source.enabled || !source.node.activeInHierarchy) return;
    if (!this.channels.some((c) => c.source === source)) return;
    this.indices.clear();
    for (let i = 0; i < source.count; i++) this.indices.set(source.serials[i]!, i);
    for (let i = 0; i < this.channels.length; i++) {
      const channel = this.channels[i]!;
      if (channel.source !== source) continue;
      const index = this.indices.get(channel.particle);
      if (index === undefined) {
        this.channels.splice(i--, 1);
        continue;
      }
      const parent = particleSnapshot(source, index);
      const target = channel.target;
      const dt = delta * source.main.simulationSpeed;
      if (dt <= 0) continue;
      const from = channel.time,
        to = Math.fround(from + dt);
      channel.time = to;
      const delay = target.delaySeconds;
      const duration = Math.fround(target.main.durationSeconds);
      const start = Math.max(0, from - delay),
        end = to - delay;
      if (end <= 0) continue;
      const firstCycle = target.main.loop ? Math.floor(start / duration) : 0;
      const lastCycle = target.main.loop ? Math.floor(end / duration) : 0;
      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        for (const [b, burst] of (target.emission?.bursts ?? []).entries()) {
          const repeats =
            burst.intervalSeconds > 0
              ? burst.cycles || Math.ceil(duration / burst.intervalSeconds)
              : 1;
          for (let repeat = 0; repeat < repeats; repeat++) {
            const local = burst.timeSeconds + repeat * burst.intervalSeconds;
            if (local >= duration) break;
            const when = Math.fround(cycle * duration + local);
            if (when < start || when >= end) continue;
            const key = cycle * 4096 + b;
            if ((channel.bursts.get(key) ?? -1) >= repeat) continue;
            channel.bursts.set(key, repeat);
            if (random(target.seed, channel.particle + cycle, b + 100) >= burst.probability)
              continue;
            const inherited = { ...channel.previous, remainingLifetime: parent.remainingLifetime };
            this.enqueue(this.before, {
              target,
              parentSystem: source.id,
              parent: inherited,
              properties: channel.edge.inheritProperties,
              amount: Math.round(
                scalar(
                  burst.count,
                  local / duration,
                  random(target.seed, channel.particle + cycle, b + 110),
                ),
              ),
              phase: local / duration,
              time: when,
            });
          }
        }
      }
      // One clock per parent; the target's authored automatic-emission flag is irrelevant here.
      const phase = (target.main.loop ? end % duration : Math.min(end, duration)) / duration;
      const active = Math.max(
        0,
        (target.main.loop ? end : Math.min(end, duration)) -
          (target.main.loop ? start : Math.min(start, duration)),
      );
      const rate = Math.max(
        0,
        scalar(target.emission?.rateOverTime, phase, random(target.seed, channel.particle, 90)),
      );
      const spacing = rate > 0 ? Math.fround(1 / rate) : 0;
      const rateTime = Math.fround(channel.rateTime + Math.fround(active));
      channel.carry += rateTime - channel.rateTime;
      channel.rateTime =
        target.main.loop && rateTime >= duration ? Math.fround(rateTime % duration) : rateTime;
      const amount = spacing > 0 ? Math.floor(channel.carry / spacing + 1e-6) : 0;
      if (spacing > 0) channel.carry -= amount * spacing;
      else channel.carry = 0;
      if (amount > 0)
        this.enqueue(this.after, {
          target,
          parentSystem: source.id,
          parent,
          properties: channel.edge.inheritProperties,
          amount,
          phase,
          time: end,
          spacing,
          remainder: channel.carry / spacing,
        });
      channel.previous = parent;
    }
  }
}
