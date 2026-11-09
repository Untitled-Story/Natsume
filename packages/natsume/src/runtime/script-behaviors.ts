import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';
import type { EffectInstance, ScriptBehavior, ScriptFactory, ScriptIdentity } from './runtime.js';
import type { SceneNode } from './scene.js';
import type { Simulation } from './simulation.js';
import type { AnimationEventHandler, NatsumeAnimationEvent } from './animation-events.js';
import type { ParticleSystemStoppedEvent } from './particle-stopped.js';

interface BehaviorRecord {
  readonly node: SceneNode;
  readonly componentId: number;
  readonly behavior: ScriptBehavior;
  active: boolean;
  failed: boolean;
  destroyed: boolean;
  controlDepth: number;
}

/** Owns Bridge instances and their lifecycle; rendering never inspects behavior state. */
export class ScriptBehaviors {
  private readonly records: BehaviorRecord[] = [];
  private disposed = false;
  private destroying = false;
  private dispatchingFields = false;

  constructor(
    private readonly effect: EffectInstance,
    private readonly simulation: Simulation,
    private readonly getFactory: (identity: ScriptIdentity) => ScriptFactory | undefined,
    private readonly errors: 'isolate' | 'throw',
  ) {}

  get notifyingFields(): boolean {
    return this.dispatchingFields;
  }

  initialize(componentIds?: ReadonlySet<number>): void {
    for (const c of this.simulation.pack.customComponents) {
      if (componentIds && !componentIds.has(c.id)) continue;
      const node = this.simulation.scene.nodes.get(c.nodeId);
      if (!node) continue;
      const component = c.data as R<CustomComponentT>,
        identity = component.script;
      const factory = identity ? this.getFactory(identity) : undefined;
      if (!factory) {
        if (!c.enabled) continue;
        this.simulation.diagnostics.push({
          code: 'UNKNOWN_SCRIPT',
          componentId: c.id,
          message: `No factory for ${identity ? `${identity.namespace}.${identity.className}` : 'unresolved script'}; serialized data retained.`,
        });
        continue;
      }
      this.invoke(() => {
        const behavior = factory({
          effect: this.effect,
          node: this.effect.getNode(node.id)!,
          component,
          fields: this.simulation.bindings.scriptFields.get(c.id)!,
        });
        check(
          behavior && typeof behavior === 'object',
          'HOST',
          'Script factory must return a behavior object',
        );
        this.records.push({
          node,
          behavior,
          componentId: c.id,
          active: false,
          failed: false,
          destroyed: false,
          controlDepth: 0,
        });
      });
    }
  }

  restore(): void {
    const ids = new Set<number>();
    for (let i = this.records.length - 1; i >= 0; i--) {
      const b = this.records[i]!;
      if (b.destroyed && !b.node.destroyed) {
        ids.add(b.componentId);
        this.records.splice(i, 1);
      }
    }
    if (ids.size) this.initialize(ids);
  }

  syncActivation(): void {
    for (const b of this.records) {
      if (b.destroyed) continue;
      if (b.node.destroyed) {
        const active = b.active;
        b.active = false;
        b.destroyed = true;
        if (active && !b.failed) this.invoke(() => b.behavior.onDisable?.());
        this.invoke(() => b.behavior.destroy?.());
        continue;
      }
      if (b.failed) continue;
      const active =
        b.node.activeInHierarchy && this.simulation.bindings.enabled.get(b.componentId) === true;
      if (active !== b.active) {
        b.active = active;
        b.failed = !this.invoke(() =>
          active ? b.behavior.onEnable?.() : b.behavior.onDisable?.(),
        );
      }
    }
  }

  update(seconds: number): void {
    for (const b of this.records) {
      if (this.disposed) return;
      if (b.active && !b.failed) b.failed = !this.invoke(() => b.behavior.update?.(seconds));
    }
  }

  controlTime(
    nodeId: number,
    phase: 'start' | 'sample' | 'stop',
    seconds: number,
    isCurrent: () => boolean,
  ): void {
    for (const b of this.records) {
      if (phase !== 'stop' && !isCurrent()) return;
      if (this.disposed && !(this.destroying && phase === 'stop')) return;
      if (b.failed || b.node.id !== nodeId) continue;
      if (phase === 'start') b.controlDepth++;
      else if (!b.controlDepth) continue;
      else if (phase === 'stop') b.controlDepth--;
      b.failed = !this.invoke(() => {
        if (phase === 'start') b.behavior.onControlTimeStart?.();
        else if (phase === 'stop') b.behavior.onControlTimeStop?.();
        else b.behavior.onControlTime?.(seconds);
      });
    }
  }

  /** Messages use the caller's event error policy, rather than disabling a failed script. */
  *animationReceivers(event: NatsumeAnimationEvent): IterableIterator<AnimationEventHandler> {
    for (const b of this.records)
      if (b.node.id === event.nodeId && b.active && !b.failed && b.behavior.onAnimationEvent)
        yield (e) => b.behavior.onAnimationEvent!(e);
  }

  stoppedReceivers(
    event: ParticleSystemStoppedEvent,
  ): readonly ((event: ParticleSystemStoppedEvent) => void)[] {
    return this.records
      .filter((b) => b.node.id === event.nodeId && b.behavior.onParticleSystemStopped)
      .map((b) => (e) => {
        if (b.node.activeInHierarchy && !b.failed && !b.destroyed)
          b.behavior.onParticleSystemStopped?.(e);
      });
  }

  notifyFields(isCurrent: () => boolean): void {
    if (this.dispatchingFields || this.disposed) return;
    const pending = this.simulation.bindings.pendingScriptFields;
    if (!pending.size) return;
    const batch = [...pending].map(([id, fields]) => [id, [...fields]] as const);
    pending.clear();
    this.dispatchingFields = true;
    try {
      for (const [id, fields] of batch) {
        const b = this.records.find((b) => b.componentId === id);
        if (!b || b.failed || b.destroyed) continue;
        for (const [name, value] of fields) {
          if (this.disposed || !isCurrent()) return;
          b.failed = !this.invoke(() => b.behavior.onAnimatedField?.(name, value));
          if (b.failed) break;
        }
      }
    } finally {
      this.dispatchingFields = false;
    }
  }

  /** Finish paired Control callbacks before disabling and destroying their receivers. */
  destroy(stopControls: () => void): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroying = true;
    let failure: unknown;
    try {
      stopControls();
    } catch (error) {
      failure = error;
    }
    for (const b of this.records) {
      if (b.destroyed) continue;
      b.destroyed = true;
      try {
        if (b.active && !b.failed) this.invoke(() => b.behavior.onDisable?.());
      } catch (error) {
        failure ??= error;
      }
      try {
        this.invoke(() => b.behavior.destroy?.());
      } catch (error) {
        failure ??= error;
      }
    }
    this.destroying = false;
    this.records.length = 0;
    if (failure) throw failure;
  }

  private invoke(action: () => void): boolean {
    try {
      action();
      return true;
    } catch (error) {
      if (this.errors === 'throw') throw error;
      this.simulation.diagnostics.push({
        code: 'SCRIPT_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
