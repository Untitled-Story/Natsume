import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { SubEmitterEvent as Event } from '../format/generated/noa/ir/sub-emitter-event.js';
import type { SubEmitterT } from '../format/generated/noa/ir/sub-emitter.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { Emitter } from './emitter.js';
import {
  particleInheritanceSnapshot as particleSnapshot,
  type ParticleSnapshot,
} from './particle-snapshot.js';
import { random, scalar } from './parameters.js';
import { maximumLifetime, graphPrewarmEstimate } from './prewarm.js';
import { copySubEmitterUpdateOrder } from './sub-emitter-order.js';

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
  readonly nativeDelta?: number;
  readonly firstStep?: number | undefined;
  readonly warmEvent?: Event;
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
  private readonly descendants = new Map<number, ReadonlySet<number>>();
  private readonly queuedDistance = new Map<number, number>();
  private readonly roots: readonly Emitter[];
  private readonly shared = new Set<number>();
  private readonly visited = new Set<number>();
  private readonly singletonScopes = new Map<number, ReadonlySet<number>>();
  private advancing: Emitter | undefined;
  private warmingStep = false;
  private clearing = false;
  private readonly virtualWarm = new Map<Emitter, Map<number, Event>>();
  private emittingWarmEvent = Event.Birth;
  private warmDelta = 0;
  private warmRemaining = 0;
  private finishingWarm = false;
  private updateOrder: readonly number[] | undefined;
  private readonly visits = new Map<number, number>();
  private orderedDelta = 0;

  constructor(private readonly emitters: ReadonlyMap<number, Emitter>) {
    const indegree = new Map<number, number>();
    for (const id of emitters.keys()) indegree.set(id, 0);
    for (const source of emitters.values()) {
      source.onBirth = (index) => this.birth(source, index);
      source.onDeath = (index) => this.death(source, index);
      source.onClear = () => this.clearSource(source.id);
      source.onDisable = () => this.clearSource(source.id, false);
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
          emitters.get(edge.systemComponentId)!.enableSubClock();
          indegree.set(edge.systemComponentId, indegree.get(edge.systemComponentId)! + 1);
        }
    }
    const queue = [...emitters.values()].filter((e) => indegree.get(e.id) === 0);
    this.roots = queue.slice();
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
      this.singletonScopes.set(root.id, new Set([root.id]));
      const scope = new Set<number>([root.id]);
      for (const source of this.order)
        if (scope.has(source.id))
          for (const edge of this.slots.get(source.id) ?? [])
            if (edge.systemComponentId) scope.add(edge.systemComponentId);
      this.descendants.set(root.id, scope);
      if (scope.size === 1) continue;
      root.onPrewarm = () => this.warmRequests.add(root);
      if (root.main.prewarm && root.main.loop)
        for (const id of scope) emitters.get(id)!.enableLifetimeProgress();
    }
    for (const target of this.order) {
      const parents = this.order.filter((e) =>
        (this.slots.get(e.id) ?? []).some((edge) => edge.systemComponentId === target.id),
      );
      if (
        parents.length > 1 ||
        parents.some(
          (e) =>
            (this.slots.get(e.id) ?? []).filter(
              (edge) => edge.systemComponentId === target.id && edge.event === Event.Birth,
            ).length > 1,
        )
      ) {
        this.shared.add(target.id);
        target.birthDriven = parents.some((parent) =>
          this.slots
            .get(parent.id)!
            .some((edge) => edge.systemComponentId === target.id && edge.event === Event.Birth),
        );
        target.enableLifetimeProgress();
        for (const parent of parents) parent.enableLifetimeProgress();
      }
    }
  }

  /** Copies a complete job order. Undefined restores the deterministic default. */
  setUpdateOrder(order: readonly number[] | undefined): void {
    if (order === undefined) {
      this.updateOrder = undefined;
      return;
    }
    const copied = copySubEmitterUpdateOrder(
      new Map([...this.emitters].map(([id, emitter]) => [id, emitter.source])),
      order,
    );
    this.updateOrder = copied;
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
    if (this.updateOrder) {
      this.stepOrdered(delta, this.updateOrder);
      return;
    }
    if (!this.shared.size) {
      this.stepScope(delta);
      return;
    }
    const visited = this.visited;
    visited.clear();
    for (const root of this.roots) {
      if (!root.graphPlaying) continue;
      const scope = this.descendants.get(root.id)!;
      this.stepScope(delta, scope);
      for (const id of scope) visited.add(id);
    }
    for (const emitter of this.order)
      if (!visited.has(emitter.id)) this.stepScope(delta, this.singletonScopes.get(emitter.id)!);
    for (const id of this.shared) this.flush(this.after, id);
  }

  private stepOrdered(delta: number, order: readonly number[]): void {
    this.visits.clear();
    for (const root of this.roots)
      if (root.graphPlaying)
        for (const id of this.descendants.get(root.id)!)
          this.visits.set(id, (this.visits.get(id) ?? 0) + 1);
    // Draining pools still receive one update after their last root has stopped.
    for (const id of this.emitters.keys())
      this.visits.set(id, Math.max(1, this.visits.get(id) ?? 0));
    this.orderedDelta = delta;
    try {
      for (const id of order) {
        const remaining = this.visits.get(id)!;
        if (!remaining) continue;
        this.visits.set(id, remaining - 1);
        const emitter = this.emitters.get(id)!;
        this.advancing = emitter;
        try {
          emitter.step(delta);
        } finally {
          this.advancing = undefined;
        }
        this.advanceChannels(emitter, delta);
        // A completed parent job publishes births before the next pool integration.
        while (this.before.size || this.after.size) {
          const target = (this.before.keys().next().value ?? this.after.keys().next().value)!;
          this.flush(this.before, target);
          this.flush(this.after, target);
        }
      }
    } finally {
      this.orderedDelta = 0;
    }
  }

  /** Initializes connected histories after every system has synchronized its active state. */
  warm(): void {
    let work = 0;
    for (const root of this.warmRequests) {
      const scope = this.descendants.get(root.id)!;
      work += graphPrewarmEstimate(
        root.id,
        new Map(this.order.filter((e) => scope.has(e.id)).map((e) => [e.id, e.source])),
      ).work;
      check(work <= 40_000_000, 'LIMIT', 'Instance graph prewarm work exceeds playback budget');
    }
    for (const root of this.warmRequests) {
      this.warmRequests.delete(root);
      const scope = this.descendants.get(root.id)!;
      const { history } = graphPrewarmEstimate(
        root.id,
        new Map(this.order.filter((e) => scope.has(e.id)).map((e) => [e.id, e.source])),
      );
      const targets = this.order.filter((e) => e !== root && scope.has(e.id));
      for (const target of targets) {
        target.deferPrewarmParticles = true;
        this.virtualWarm.set(
          target,
          new Map(Array.from(target.serials.subarray(0, target.count), (id) => [id, Event.Birth])),
        );
      }
      try {
        root.prewarmGraph((seconds, remaining) => {
          this.warmRemaining = remaining;
          this.warmDelta = seconds / root.main.simulationSpeed;
          this.stepScope(this.warmDelta, scope, root, seconds);
        }, history);
        for (const target of targets) target.deferPrewarmParticles = false;
        this.finishWarm(targets, Math.fround(history / Math.ceil(history / 0.03)));
      } finally {
        for (const target of targets) target.deferPrewarmParticles = false;
        this.virtualWarm.clear();
        this.warmDelta = 0;
        this.warmRemaining = 0;
        this.finishingWarm = false;
      }
    }
  }

  private finishWarm(targets: readonly Emitter[], step: number): void {
    this.finishingWarm = true;
    for (const source of targets) {
      const origins = this.virtualWarm.get(source)!;
      // New descendants emitted during this pass are already integrated to their remainder.
      this.virtualWarm.delete(source);
      let maximumAge = 0;
      for (let i = 0; i < source.count; i++) {
        const event = origins.get(source.serials[i]!);
        if (event === undefined) continue;
        let age = event === Event.Death ? 0 : Math.max(0, source.elapsedAge(i));
        while (age >= step) age = Math.fround(age - step);
        maximumAge = Math.max(maximumAge, age);
        source.finishPrewarmParticle(i, age, () => {
          this.advancing = event === Event.Death ? undefined : source;
          this.warmingStep = event !== Event.Death;
          this.birth(source, i);
          this.advancing = undefined;
          this.warmingStep = false;
        });
      }
      source.finishPrewarmTrails(maximumAge);
      this.advanceChannels(source, 0, origins);
      for (const target of targets) this.flush(this.before, target.id);
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
      if (warming || !this.shared.has(emitter.id)) this.flush(this.after, emitter.id);
    }
  }

  clear(): void {
    this.channels.length = 0;
    this.before.clear();
    this.after.clear();
    this.sequence = 0;
    this.warmRequests.clear();
    this.virtualWarm.clear();
    this.warmDelta = 0;
    this.finishingWarm = false;
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
    const virtual = this.virtualWarm.get(source);
    if (virtual && !this.finishingWarm) {
      virtual.set(source.serials[index]!, this.emittingWarmEvent);
      return;
    }
    for (const [slot, edge] of (this.slots.get(source.id) ?? []).entries()) {
      if (edge.event !== Event.Birth || !this.accept(source, index, edge, slot)) continue;
      if (
        this.shared.has(edge.systemComponentId) &&
        this.channels.some(
          (c) =>
            c.source === source &&
            c.particle === source.serials[index] &&
            c.target.id === edge.systemComponentId,
        )
      )
        continue;
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
    const virtual = this.virtualWarm.get(source);
    if (virtual && !this.finishingWarm) {
      virtual.delete(source.serials[index]!);
      return;
    }
    for (const [slot, edge] of (this.slots.get(source.id) ?? []).entries()) {
      if (edge.event !== Event.Death || !this.accept(source, index, edge, slot)) continue;
      this.enqueue(this.after, {
        target: this.emitters.get(edge.systemComponentId)!,
        parentSystem: source.id,
        parent: particleSnapshot(source, index),
        properties: edge.inheritProperties,
        warmEvent: Event.Death,
      });
    }
  }
  private clearSource(id: number, descendants = true): void {
    const emitter = this.emitters.get(id)!;
    this.warmRequests.delete(emitter);
    this.virtualWarm.delete(emitter);
    for (let i = this.channels.length - 1; i >= 0; i--)
      if (this.channels[i]!.source.id === id) this.channels.splice(i, 1);
    this.before.delete(id);
    this.after.delete(id);
    this.queuedDistance.delete(id);
    for (const queue of [this.before, this.after])
      for (const [target, births] of queue) {
        const remaining = births.filter((birth) => birth.parentSystem !== id);
        if (remaining.length) queue.set(target, remaining);
        else queue.delete(target);
      }
    if (descendants && !this.clearing) {
      this.clearing = true;
      try {
        // Unity clears connected sub-emitter pools even when Clear(withChildren) is false.
        for (const target of this.descendants.get(id) ?? [])
          if (target !== id) this.emitters.get(target)!.clear();
      } finally {
        this.clearing = false;
      }
    }
  }
  private enqueue(queue: Map<number, PendingBirth[]>, birth: PendingBirth): void {
    let births = queue.get(birth.target.id);
    if (!births) queue.set(birth.target.id, (births = []));
    births.push(birth);
  }
  private emit(birth: PendingBirth): void {
    if (!birth.target.enabled || !birth.target.node.activeInHierarchy) return;
    if (
      birth.target.deferPrewarmParticles &&
      this.warmRemaining >= Math.fround(maximumLifetime(birth.target.main))
    )
      return;
    const first = birth.target.count;
    const firstChannel = this.channels.length;
    const previous = this.emittingWarmEvent;
    this.emittingWarmEvent = birth.warmEvent ?? Event.Birth;
    try {
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
          birth.nativeDelta,
        );
      if (birth.firstStep !== undefined && birth.target.main.simulationSpeed > 0)
        birth.target.setBirthStep(first, birth.firstStep);
      if (birth.target.deferPrewarmParticles)
        birth.target.offsetPrewarmBirths(
          first,
          this.emittingWarmEvent === Event.Death
            ? -Math.max(0, birth.parent.age - birth.parent.lifetime)
            : this.warmDelta * birth.target.main.simulationSpeed,
        );
    } finally {
      this.emittingWarmEvent = previous;
    }
    if (this.orderedDelta && this.channels.length > firstChannel) {
      // Birth integration can create another generation after its pool job has run.
      this.advanceChannels(
        birth.target,
        this.orderedDelta,
        undefined,
        new Set(this.channels.slice(firstChannel)),
      );
    }
  }
  private flush(queue: Map<number, PendingBirth[]>, id: number): void {
    if (queue === this.after) this.queuedDistance.delete(id);
    const pending = queue.get(id);
    if (!pending) return;
    queue.delete(id);
    for (const birth of pending) this.emit(birth);
  }

  private advanceChannels(
    source: Emitter,
    delta: number,
    warmOrigins?: ReadonlyMap<number, Event>,
    newborn?: ReadonlySet<BirthChannel>,
  ): void {
    if (!source.enabled || !source.node.activeInHierarchy) return;
    if (!this.channels.some((c) => c.source === source)) return;
    this.indices.clear();
    for (let i = 0; i < source.count; i++) this.indices.set(source.serials[i]!, i);
    for (let i = 0; i < this.channels.length; i++) {
      const channel = this.channels[i]!;
      if (channel.source !== source) continue;
      if (newborn && !newborn.has(channel)) continue;
      const index = this.indices.get(channel.particle);
      if (index === undefined) {
        this.channels.splice(i--, 1);
        continue;
      }
      const parent = particleSnapshot(source, index);
      const target = channel.target;
      if (warmOrigins?.get(channel.particle) === Event.Death) continue;
      const dt = warmOrigins
        ? Math.max(parent.age, 1e-8)
        : newborn
          ? Math.min(Math.max(0, source.elapsedAge(index)), delta * source.main.simulationSpeed)
          : delta * source.main.simulationSpeed;
      if (dt <= 0) continue;
      const from =
          this.shared.has(target.id) && !warmOrigins
            ? Math.max(0, source.channelAge(index, dt))
            : channel.time,
        to =
          this.shared.has(target.id) && !warmOrigins
            ? source.channelAge(index)
            : Math.fround(from + dt);
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
              firstStep:
                !this.orderedDelta &&
                from === 0 &&
                when === 0 &&
                !target.deferPrewarmParticles &&
                !channel.bornDuringWarm &&
                !this.finishingWarm
                  ? (source.elapsedAge(index) / source.main.simulationSpeed) *
                    target.main.simulationSpeed
                  : undefined,
              initialAge: this.orderedDelta
                ? (Math.max(0, to - delay - when) / source.main.simulationSpeed) *
                  target.main.simulationSpeed
                : from === 0 && when === 0 && channel.bornDuringWarm
                  ? parent.age
                  : 0,
            });
          }
        }
      }
      // One clock per parent; the target's authored automatic-emission flag is irrelevant here.
      const phase = (target.main.loop ? end % duration : Math.min(end, duration)) / duration;
      const active =
        this.shared.has(target.id) && !target.main.loop && end >= duration
          ? 0
          : Math.max(
              0,
              (target.main.loop ? end : Math.min(end, duration)) -
                (target.main.loop ? start : Math.min(start, duration)),
            );
      const rate = Math.max(
        0,
        scalar(target.emission?.rateOverTime, phase, random(target.seed, channel.particle, 90)),
      );
      const shared = this.shared.has(target.id) && !warmOrigins;
      const spacing = rate > 0 ? Math.fround(1 / rate) : 0;
      const rateTime = Math.fround(channel.rateTime + Math.fround(active));
      channel.carry = shared
        ? Math.fround(channel.carry + Math.fround(Math.fround(active) * Math.fround(rate)))
        : channel.carry + rateTime - channel.rateTime;
      channel.rateTime =
        target.main.loop && rateTime >= duration ? Math.fround(rateTime % duration) : rateTime;
      const amount = shared
        ? Math.floor(channel.carry)
        : spacing > 0
          ? Math.floor(channel.carry / spacing + 1e-6)
          : 0;
      if (shared) channel.carry = Math.fround(channel.carry - amount);
      else if (spacing > 0) channel.carry -= amount * spacing;
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
          spacing: shared
            ? rate > 0
              ? Math.fround(1 / Math.fround(Math.fround(active) * Math.fround(rate)))
              : 0
            : spacing,
          remainder: shared ? channel.carry : channel.carry / spacing,
          ...(shared ? { nativeDelta: Math.fround(delta * target.main.simulationSpeed) } : {}),
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
