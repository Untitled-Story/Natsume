import { check } from '../errors.js';
import type { SceneNode } from './scene.js';
import type { Emitter } from './emitter.js';
import type { SubEmitterGraph } from './sub-emitters.js';
import type { TimelineControl } from './timeline-graph.js';
import { ParticleModuleData } from '../format/generated/noa/ir/particle-module-data.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { DeepReadonly as R } from '../pack.js';

/** Deterministic re-simulation on seeks, incremental simulation for forward playback. */
export class TimelineParticles implements TimelineControl {
  private previous: number | undefined;
  private readonly scope = new Set<number>();
  private readonly systems: Emitter[];
  constructor(
    node: SceneNode,
    search: boolean,
    seed: number,
    emitters: ReadonlyMap<number, Emitter>,
    private readonly graph: SubEmitterGraph,
  ) {
    const onRoot = [...emitters.values()].some((e) => e.node === node);
    for (const emitter of emitters.values()) {
      if (!search && !onRoot) break;
      for (let parent: SceneNode | undefined = emitter.node; parent; parent = parent.parent)
        if (parent === node) {
          this.scope.add(emitter.id);
          break;
        }
    }
    const pending = [...this.scope];
    for (let i = 0; i < pending.length; i++) {
      const emitter = emitters.get(pending[i]!)!;
      const module = emitter.source.modules.find(
        (m) => m.dataType === ParticleModuleData.SubEmittersModule,
      )?.data as R<SubEmittersModuleT> | undefined;
      for (const edge of module?.emitters ?? [])
        if (edge.systemComponentId && !this.scope.has(edge.systemComponentId)) {
          this.scope.add(edge.systemComponentId);
          pending.push(edge.systemComponentId);
        }
    }
    this.systems = graph.order.filter((e) => this.scope.has(e.id));
    let randomSeed = Math.max(1, seed);
    for (const emitter of this.systems) {
      graph.externallyControlled.add(emitter.id);
      emitter.timelineControlled = true;
      emitter.setPlaybackSeed(randomSeed++);
      emitter.reset();
    }
  }
  sample(seconds: number): void {
    const time = Math.fround(seconds);
    const reset = this.previous === undefined || time < this.previous;
    const delta = reset ? time : Math.fround(time - this.previous!);
    // Same work ceiling as instance prewarm; reject an expensive seek before changing live pools.
    check(
      Math.ceil(delta / (1 / 3)) * this.systems.reduce((n, e) => n + e.main.maxParticles, 0) <=
        40_000_000,
      'LIMIT',
      'Timeline particle seek exceeds simulation work budget',
    );
    if (reset)
      for (const emitter of this.systems) {
        emitter.reset();
        emitter.sync();
        emitter.start(false);
      }
    let remaining = delta;
    while (remaining > 0) {
      const step = Math.min(remaining, Math.fround(1 / 3));
      this.graph.stepControlled(step, this.scope);
      remaining = Math.fround(remaining - step);
    }
    this.previous = time;
  }
  pause(): void {
    this.previous = undefined;
  }
  destroy(): void {
    this.pause();
  }
}
