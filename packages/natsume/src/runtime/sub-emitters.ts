import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { SubEmitterEvent as Event } from '../format/generated/noa/ir/sub-emitter-event.js';
import type { SubEmitterT } from '../format/generated/noa/ir/sub-emitter.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { Emitter } from './emitter.js';
import { particleSnapshot, type ParticleSnapshot } from './particle-snapshot.js';
import { random, scalar } from './parameters.js';
import { maximumLifetime } from './prewarm.js';

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
  distanceCarry: number;
  readonly bornDuringWarm: boolean;
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
  readonly initialAge?: number;
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
  private readonly warmRequests = new Set<Emitter>();
  private readonly warmRemainders = new Map<Emitter, number>();
  private readonly descendants = new Map<number, ReadonlySet<number>>();
  private readonly queuedDistance = new Map<number, number>();
  private advancing: Emitter | undefined;
  private warmingStep = false;

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
    for (const root of this.order) {
      if (!this.slots.get(root.id)?.some((edge) => edge.systemComponentId)) continue;
      const scope = new Set<number>([root.id]);
      for (const source of this.order)
        if (scope.has(source.id))
          for (const edge of this.slots.get(source.id) ?? [])
            if (edge.systemComponentId) scope.add(edge.systemComponentId);
      this.descendants.set(root.id, scope);
      root.onPrewarm = () => this.warmRequests.add(root);
    }
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
    this.warm();
    this.stepScope(delta);
    for (const [root, remainder] of this.warmRemainders) {
      const localStep = delta * root.main.simulationSpeed;
      if (localStep <= 0) continue;
      let remaining = remainder;
      while (remaining > 1e-6) {
        this.stepScope(delta, this.descendants.get(root.id));
        remaining -= localStep;
      }
      this.warmRemainders.delete(root);
    }
  }

  /** Initializes connected histories after every system has synchronized its active state. */
  warm(): void {
    let work = 0;
    for (const root of this.warmRequests) {
      const scope = this.descendants.get(root.id)!;
      const history = Math.max(
        ...this.order.filter((e) => scope.has(e.id)).map((e) => maximumLifetime(e.main)),
      );
      work +=
        this.order.reduce((sum, e) => sum + (scope.has(e.id) ? e.main.maxParticles : 0), 0) *
        Math.ceil(
          (Math.ceil(history / root.main.durationSeconds) * root.main.durationSeconds) / 0.02,
        );
      check(work <= 40_000_000, 'LIMIT', 'Instance graph prewarm work exceeds playback budget');
    }
    for (const root of this.warmRequests) {
      this.warmRequests.delete(root);
      const scope = this.descendants.get(root.id)!;
      const history = Math.max(
        ...this.order.filter((e) => scope.has(e.id)).map((e) => maximumLifetime(e.main)),
      );
      const remaining = root.prewarmGraph(
        (seconds) => this.stepScope(seconds / root.main.simulationSpeed, scope, root, seconds),
        history,
      );
      if (remaining > 0) this.warmRemainders.set(root, remaining);
    }
  }

  private stepScope(
    delta: number,
    scope?: ReadonlySet<number>,
    warming?: Emitter,
    localSeconds = 0,
  ): void {
    for (const emitter of this.order) {
      if (scope && !scope.has(emitter.id)) continue;
      this.flush(this.before, emitter.id);
      this.advancing = emitter;
      this.warmingStep = warming !== undefined;
      try {
        if (emitter === warming) emitter.advancePrewarm(localSeconds);
        else emitter.step(delta);
      } finally {
        this.advancing = undefined;
        this.warmingStep = false;
      }
      this.advanceChannels(emitter, delta);
      this.flush(this.after, emitter.id);
    }
  }

  clear(): void {
    this.channels.length = 0;
    this.before.clear();
    this.after.clear();
    this.sequence = 0;
    this.warmRequests.clear();
    this.warmRemainders.clear();
    this.queuedDistance.clear();
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
        distanceCarry: 0,
        bornDuringWarm: this.advancing === source && this.warmingStep,
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
    const emitter = this.emitters.get(id)!;
    this.warmRequests.delete(emitter);
    this.warmRemainders.delete(emitter);
    for (let i = this.channels.length - 1; i >= 0; i--)
      if (this.channels[i]!.source.id === id || this.channels[i]!.target.id === id)
        this.channels.splice(i, 1);
    this.before.delete(id);
    this.after.delete(id);
    this.queuedDistance.delete(id);
    for (const queue of [this.before, this.after])
      for (const [target, births] of queue) {
        const remaining = births.filter((birth) => birth.parentSystem !== id);
        if (remaining.length) queue.set(target, remaining);
        else queue.delete(target);
      }
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
        birth.initialAge,
      );
  }
  private flush(queue: Map<number, PendingBirth[]>, id: number): void {
    if (queue === this.after) this.queuedDistance.delete(id);
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
      if (end <= 0) {
        channel.previous = parent;
        continue;
      }
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
              initialAge: from === 0 && when === 0 && channel.bornDuringWarm ? parent.age : 0,
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
      const previous = channel.previous;
      const distance = Math.hypot(
        parent.position[0] - previous.position[0],
        parent.position[1] - previous.position[1],
        parent.position[2] - previous.position[2],
      );
      const lower = Math.max(0, Math.min(1, (delay - from) / dt));
      const upper = target.main.loop ? 1 : Math.max(0, Math.min(1, (delay + duration - from) / dt));
      const perDistance = Math.max(
        0,
        scalar(target.emission?.rateOverDistance, phase, random(target.seed, channel.particle, 91)),
      );
      const pathRate = distance * perDistance;
      const total = channel.distanceCarry + Math.max(0, upper - lower) * pathRate;
      const distanceAmount = Math.floor(total);
      const queued = this.queuedDistance.get(target.id) ?? 0;
      const accepted = Math.min(
        distanceAmount,
        Math.max(0, target.main.maxParticles - target.count - queued),
      );
      this.queuedDistance.set(target.id, queued + accepted);
      for (let n = 0; n < accepted; n++) {
        const fraction = lower + (n + 1 - channel.distanceCarry) / pathRate;
        const position: [number, number, number] = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++)
          position[axis] =
            previous.position[axis]! +
            (parent.position[axis]! - previous.position[axis]!) * fraction;
        this.enqueue(this.after, {
          target,
          parentSystem: source.id,
          parent: { ...parent, position },
          properties: channel.edge.inheritProperties,
          amount: 1,
          phase,
          time: end,
          spacing: (dt / source.main.simulationSpeed) * target.main.simulationSpeed,
          remainder: 1 - fraction,
        });
      }
      channel.distanceCarry = total - distanceAmount;
      channel.previous = parent;
    }
  }
}
