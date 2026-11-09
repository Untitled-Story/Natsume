import { check } from '../errors.js';
import type { SceneNode } from './scene.js';
import type { SubEmitterGraph, ControlledParticleScope } from './sub-emitters.js';
import type { TimelineControl } from './timeline-graph.js';
const approximately = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-44);

/** One native ParticleControlPlayable: a root and the pools reached through sub-emitter edges. */
class ParticleClock {
  private previous: number | undefined;
  private readonly lastTimes = new Map<number, number>();
  constructor(private readonly scope: ControlledParticleScope) {}
  private needsReset(time: number): boolean {
    return (
      this.previous === undefined ||
      time < this.previous ||
      this.scope.systems.some((e) => {
        const previous = this.lastTimes.get(e.id);
        return previous !== undefined && !approximately(e.elapsedSeconds, previous);
      })
    );
  }
  work(time: number): number {
    if (!this.scope.root.node.activeInHierarchy) return 0;
    const reset = this.needsReset(time);
    const delta = reset ? time : Math.fround(time - this.previous!);
    const warm =
      reset && this.scope.root.main.simulationSpeed
        ? this.scope.root.prewarmSeconds / this.scope.root.main.simulationSpeed
        : 0;
    return (
      Math.ceil((delta + warm) / Math.fround(0.03)) *
      this.scope.systems.reduce((n, e) => n + e.main.maxParticles, 0)
    );
  }
  sample(time: number): void {
    if (!this.scope.root.node.activeInHierarchy) {
      this.pause();
      return;
    }
    const reset = this.needsReset(time);
    const delta = reset ? time : Math.fround(time - this.previous!);
    for (const e of this.scope.systems) e.sync();
    if (reset) {
      this.scope.reset();
      if (this.scope.root.main.simulationSpeed)
        this.simulate(this.scope.root.prewarmSeconds / this.scope.root.main.simulationSpeed);
    }
    this.simulate(delta);
    this.previous = time;
    for (const e of this.scope.systems) this.lastTimes.set(e.id, e.elapsedSeconds);
  }
  private simulate(seconds: number): void {
    let remaining = seconds;
    while (remaining > 0) {
      const step = Math.min(remaining, Math.fround(1 / 3));
      this.scope.step(step);
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
  constructor(node: SceneNode, search: boolean, seed: number, graph: SubEmitterGraph) {
    this.clocks = graph
      .claimTimelineControl(node, search, seed)
      .map((scope) => new ParticleClock(scope));
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
