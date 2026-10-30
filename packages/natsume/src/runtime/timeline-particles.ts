import { check } from '../errors.js';
import type { SceneNode } from './scene.js';
import type { Emitter } from './emitter.js';
import type { SubEmitterGraph } from './sub-emitters.js';
import type { TimelineControl } from './timeline-graph.js';
import { ParticleModuleData } from '../format/generated/noa/ir/particle-module-data.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { DeepReadonly as R } from '../pack.js';

function subEmitters(emitter: Emitter): readonly number[] {
  const module = emitter.source.modules.find(
    (m) => m.dataType === ParticleModuleData.SubEmittersModule,
  )?.data as R<SubEmittersModuleT> | undefined;
  return module?.emitters.flatMap((e) => (e.systemComponentId ? [e.systemComponentId] : [])) ?? [];
}
const approximately = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-44);

/** One native ParticleControlPlayable: a root and the pools reached through sub-emitter edges. */
class ParticleClock {
  private previous: number | undefined;
  private readonly lastTimes = new Map<number, number>();
  readonly scope = new Set<number>();
  private readonly systems: Emitter[];
  constructor(
    private readonly root: Emitter,
    emitters: ReadonlyMap<number, Emitter>,
    private readonly graph: SubEmitterGraph,
  ) {
    this.scope.add(root.id);
    const pending = [root];
    for (let i = 0; i < pending.length; i++)
      for (const id of subEmitters(pending[i]!))
        if (!this.scope.has(id)) {
          this.scope.add(id);
          pending.push(emitters.get(id)!);
        }
    this.systems = graph.order.filter((e) => this.scope.has(e.id));
  }
  private needsReset(time: number): boolean {
    return (
      this.previous === undefined ||
      time < this.previous ||
      this.systems.some((e) => {
        const previous = this.lastTimes.get(e.id);
        return previous !== undefined && !approximately(e.elapsedSeconds, previous);
      })
    );
  }
  work(time: number): number {
    if (!this.root.node.activeInHierarchy) return 0;
    const reset = this.needsReset(time);
    const delta = reset ? time : Math.fround(time - this.previous!);
    const warm =
      reset && this.root.main.simulationSpeed
        ? this.root.prewarmSeconds / this.root.main.simulationSpeed
        : 0;
    return (
      Math.ceil((delta + warm) / Math.fround(0.03)) *
      this.systems.reduce((n, e) => n + e.main.maxParticles, 0)
    );
  }
  sample(time: number): void {
    if (!this.root.node.activeInHierarchy) {
      this.pause();
      return;
    }
    const reset = this.needsReset(time);
    const delta = reset ? time : Math.fround(time - this.previous!);
    for (const e of this.systems) e.sync();
    if (reset) {
      for (const e of this.systems) {
        e.reset();
        e.sync();
        e.start(false);
      }
      if (this.root.main.simulationSpeed)
        this.simulate(this.root.prewarmSeconds / this.root.main.simulationSpeed);
    }
    this.simulate(delta);
    this.previous = time;
    for (const e of this.systems) this.lastTimes.set(e.id, e.elapsedSeconds);
  }
  private simulate(seconds: number): void {
    let remaining = seconds;
    while (remaining > 0) {
      const step = Math.min(remaining, Math.fround(1 / 3));
      this.graph.stepControlled(step, this.scope);
      remaining = Math.fround(remaining - step);
    }
  }
  pause(): void {
    this.previous = undefined;
  }
}

/** Seeks resimulate; independent roots retain independent clocks and activation history. */
export class TimelineParticles implements TimelineControl {
  private readonly clocks: ParticleClock[];
  constructor(
    node: SceneNode,
    search: boolean,
    seed: number,
    emitters: ReadonlyMap<number, Emitter>,
    graph: SubEmitterGraph,
  ) {
    const onRoot = [...emitters.values()].some((e) => e.node === node);
    const candidates = [...emitters.values()].filter((e) => {
      if (!search && !onRoot) return false;
      for (let parent: SceneNode | undefined = e.node; parent; parent = parent.parent)
        if (parent === node) return true;
      return false;
    });
    const excluded = new Set(candidates.flatMap(subEmitters));
    const roots = candidates.filter((e) => !excluded.has(e.id));
    this.clocks = roots.map((e) => new ParticleClock(e, emitters, graph));
    const claimed = new Set(this.clocks.flatMap((c) => [...c.scope]));
    for (const id of claimed) {
      graph.externallyControlled.add(id);
      emitters.get(id)!.timelineControlled = true;
    }
    const seedSystem = (emitter: Emitter, value: number) => {
      emitter.setPlaybackSeed(value);
      emitter.reset();
      for (const id of subEmitters(emitter)) seedSystem(emitters.get(id)!, ++value);
    };
    // Every independent root receives the same seed; only sub-emitters increment it.
    for (const root of roots) seedSystem(root, Math.max(1, seed));
  }
  sample(seconds: number): void {
    const time = Math.fround(seconds);
    check(
      this.clocks.reduce((n, c) => n + c.work(time), 0) <= 40_000_000,
      'LIMIT',
      'Timeline particle seek exceeds simulation work budget',
    );
    for (const clock of this.clocks) clock.sample(time);
  }
  pause(): void {
    for (const clock of this.clocks) clock.pause();
  }
  destroy(): void {
    this.pause();
  }
}
