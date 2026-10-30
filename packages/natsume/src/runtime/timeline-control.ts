import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { TimelineControlT } from '../format/generated/noa/ir/timeline-control.js';
import type { Scene, SceneNode } from './scene.js';
import type { TimelineControl } from './timeline-graph.js';
import type { TimelineDirector } from './timeline-director.js';

export interface TimelineControlHost {
  readonly pack: EffectPack;
  readonly scene: Scene;
  readonly directors: ReadonlyMap<number, TimelineDirector>;
  readonly directorClaims: Map<number, number>;
  acquireParticles(node: SceneNode, search: boolean, seed: number): TimelineControl;
  controlTime(nodeId: number, phase: 'start' | 'sample' | 'stop', seconds: number): boolean;
}

/** Owns only the target systems claimed by one Control clip. */
export class TimelineControlPlayer implements TimelineControl {
  private started = false;
  private destroyed = false;
  private readonly initial: boolean;
  private readonly activation: boolean;
  private readonly directors: TimelineDirector[];
  private readonly scripts: SceneNode[];
  private readonly particles: TimelineControl | undefined;
  constructor(
    private readonly owner: TimelineDirector,
    private readonly source: R<TimelineControlT>,
    private readonly node: SceneNode,
    private readonly host: TimelineControlHost,
  ) {
    this.initial = node.active;
    const ownNode = host.pack.getComponent(owner.id)!.nodeId;
    this.activation = source.active && node.id !== ownNode;
    const descendant = (candidate: SceneNode) => {
      for (let p: SceneNode | undefined = candidate; p; p = p.parent) if (p === node) return true;
      return false;
    };
    this.directors = source.updateDirectors
      ? [...host.directors.values()].filter((director) => {
          const component = host.pack.getComponent(director.id)!;
          if (
            director === owner ||
            (director.source.sourceAsset?.guid === owner.source.sourceAsset?.guid &&
              director.source.sourceAsset?.fileId === owner.source.sourceAsset?.fileId)
          )
            return false;
          return source.searchHierarchy
            ? descendant(host.scene.nodes.get(component.nodeId)!)
            : component.nodeId === node.id;
        })
      : [];
    this.scripts = source.updateTimeControl ? host.scene.ordered.filter(descendant) : [];
    for (const director of this.directors)
      host.directorClaims.set(director.id, (host.directorClaims.get(director.id) ?? 0) + 1);
    this.particles = source.updateParticles
      ? host.acquireParticles(node, source.searchHierarchy, source.particleSeed)
      : undefined;
  }
  sample(seconds: number, playback: boolean): void {
    if (this.destroyed) return;
    const revision = this.owner.version;
    if (this.activation) this.node.active = true;
    this.host.scene.update();
    if (!this.started) {
      this.started = true;
      for (const node of this.scripts) {
        if (!this.host.controlTime(node.id, 'start', seconds)) return;
        if (!this.owner.isCurrent(revision) || this.destroyed) return;
      }
    }
    this.particles?.sample(seconds, playback);
    for (const director of this.directors) {
      const component = this.host.pack.getComponent(director.id)!;
      if (!component.enabled || !this.host.scene.nodes.get(component.nodeId)!.activeInHierarchy)
        continue;
      const duration = Math.max(0.1, director.duration);
      const time = director.source.wrap === 1 ? seconds % duration : Math.min(seconds, duration);
      director.setTime(Math.max(0, time));
      director.evaluate();
      if (!this.owner.isCurrent(revision) || this.destroyed) return;
    }
    for (const node of this.scripts) {
      if (!this.host.controlTime(node.id, 'sample', seconds)) return;
      if (!this.owner.isCurrent(revision) || this.destroyed) return;
    }
  }
  pause(outside = false): void {
    if (this.destroyed) return;
    if (this.activation && outside) this.node.active = false;
    if (!this.started) return;
    this.started = false;
    this.particles?.pause();
    if (this.activation) this.node.active = false;
    for (const director of this.directors) {
      if (outside) director.stop();
      else director.pause();
    }
    for (const node of this.scripts) this.host.controlTime(node.id, 'stop', 0);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.pause();
    this.destroyed = true;
    this.particles?.destroy();
    for (const director of this.directors) director.stop();
    for (const director of this.directors) {
      const claims = this.host.directorClaims.get(director.id)! - 1;
      if (claims) this.host.directorClaims.set(director.id, claims);
      else this.host.directorClaims.delete(director.id);
    }
    if (this.activation) {
      if (this.source.postPlayback === 0) this.node.active = true;
      if (this.source.postPlayback === 1) this.node.active = false;
      if (this.source.postPlayback === 2) this.node.active = this.initial;
    }
  }
}
