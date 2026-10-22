import { visitAnimationEvents, type NatsumeAnimationEvent } from './animation-events.js';
import { SUPPORTED_FEATURES } from '../format/semantics.js';
import { AnimationProperty } from '../format/generated/noa/ir/animation-property.js';
import { ParticleParameter } from '../format/generated/noa/ir/particle-parameter.js';
import { AnimationClock, animationSupport, animatorSupport } from './animation.js';
import { assertSupport } from './support-checks.js';
import type { AnimationT } from '../format/generated/noa/ir/animation.js';
import type { SceneNode } from './scene.js';
import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { AnimatorT } from '../format/generated/noa/ir/animator.js';
import { AnimationBindings, type CompiledBinding } from './animation-bindings.js';
import { ComponentData } from '../format/generated/noa/ir/component-data.js';
import { ActionKind } from '../format/generated/noa/ir/action-kind.js';
import { CameraPolicy } from '../format/generated/noa/ir/camera-policy.js';
import { Scene, type LayoutSize } from './scene.js';
import { Emitter, prewarmDuration, type Diagnostic } from './emitter.js';

export interface SimulationOptions {
  readonly entryId?: number;
  readonly seed?: number;
  /** Required only when the entry's root uses stretched external anchors. */
  readonly parentLayout?: LayoutSize;
  readonly gravity?: readonly [number, number, number];
}
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'draining' | 'stopped';

/** Identifies an Animator or an entry action's continuously playing clip. */
export type AnimationTarget =
  | { readonly animatorId: number; readonly clipId?: never }
  | { readonly clipId: number; readonly animatorId?: never };
interface AnimationPlayer {
  readonly clip: R<AnimationT>;
  eventTime: number;
  skipAdvance: boolean;
  readonly key: string;
  readonly clock: AnimationClock;
  readonly owner: SceneNode | undefined;
  disabled: boolean;
  hierarchyDisabled: boolean;
  resetOnEnable: boolean;
  readonly keepState: boolean;
  readonly animatorId: number | undefined;
  readonly bindings: CompiledBinding[];
}

export class Simulation {
  readonly scene: Scene;
  readonly emitters = new Map<number, Emitter>();
  readonly diagnostics: Diagnostic[] = [];
  readonly entry;
  state: PlaybackState = 'idle';
  time = 0;
  droppedSeconds = 0;
  private accumulator = 0;
  private revision = 0;
  private updating = false;
  private dispatchingEvents = false;
  onAnimationEvent: ((event: NatsumeAnimationEvent) => void) | undefined;
  private resumeState: PlaybackState = 'playing';
  private initialized = false;
  readonly fixedDelta = 1 / 60;
  readonly bindings: AnimationBindings;
  private readonly animatorDefaults = new Map<number, CompiledBinding[]>();
  private readonly startedAnimators = new Set<number>();
  private readonly clips = new Map<number, R<AnimationT>>();
  private readonly players = new Map<string, AnimationPlayer>();
  private readonly priorities = new Map<string, number>();
  private readonly registrations = new Map<string, number>();
  private registrationSequence = 0;
  private orderDirty = false;
  private orderedPlayers: AnimationPlayer[] = [];

  constructor(
    readonly pack: EffectPack,
    options: SimulationOptions = {},
  ) {
    check(!pack.disposed, 'DISPOSED', 'Pack has been disposed');
    for (const feature of pack.document.features)
      check(
        !feature.required || SUPPORTED_FEATURES[String(feature.name)] === feature.revision,
        'CAPABILITY',
        'Required feature is not implemented: ' + feature.name,
      );
    const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
    check(
      Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff,
      'HOST',
      'Instance seed must be uint32',
    );
    if (options.parentLayout)
      check(
        Number.isFinite(options.parentLayout.width) &&
          Number.isFinite(options.parentLayout.height) &&
          options.parentLayout.width >= 0 &&
          options.parentLayout.height >= 0,
        'HOST',
        'Invalid parent layout',
      );
    const entry = pack.document.entries.find(
      (e) => e.id === (options.entryId ?? pack.document.defaultEntryId),
    );
    check(entry, 'HOST', 'Unknown entry');
    check(
      entry.cameraPolicy === CameraPolicy.HostRequired,
      'CAPABILITY',
      'Embedded cameras are not implemented; use a host display matrix',
    );
    this.entry = entry;
    this.scene = new Scene(pack, entry.roots, options.parentLayout);
    this.bindings = new AnimationBindings(pack, this.scene);
    this.diagnostics.push({
      code: 'NATSUME_RANDOM_SEQUENCE',
      message:
        'Particle random channels are reproducible in Natsume; Unity native seeds do not reproduce the same births.',
    });
    const systems = pack.components.filter(
      (c) => this.scene.nodes.has(c.nodeId) && c.dataType === ComponentData.ParticleSystem,
    );
    check(
      systems.reduce((sum, c) => sum + (c.data as R<ParticleSystemT>).main!.maxParticles, 0) <=
        250_000,
      'LIMIT',
      'Total particle capacity exceeds playback limit',
    );
    check(
      systems.reduce((sum, c) => {
        const main = (c.data as R<ParticleSystemT>).main!;
        return (
          sum +
          (c.enabled && main.prewarm && main.loop
            ? main.maxParticles * Math.ceil(prewarmDuration(main) * 60)
            : 0)
        );
      }, 0) <= 40_000_000,
      'LIMIT',
      'Instance prewarm work exceeds playback budget',
    );
    for (const c of systems)
      this.emitters.set(
        c.id,
        new Emitter(
          c.id,
          this.scene.nodes.get(c.nodeId)!,
          this.bindings.systems.get(c.id) ?? (c.data as R<ParticleSystemT>),
          c.enabled,
          seed,
          this.diagnostics,
          options.gravity,
          this.scene.nodes.get((c.data as R<ParticleSystemT>).main!.customSpaceNodeId),
        ),
      );
    for (const animation of pack.document.animations)
      for (const track of animation.tracks) {
        const b = track.binding!;
        if (
          b.property === AnimationProperty.ParticleParameter &&
          b.parameter === ParticleParameter.GravityMultiplier
        ) {
          const emitter = this.emitters.get(b.targetId);
          if (emitter) {
            emitter.requiresAnimatedGravity = true;
            emitter.setGravity(options.gravity);
          }
        }
      }
    for (const animation of pack.document.animations) {
      assertSupport(animationSupport(animation));
      this.clips.set(animation.id, animation);
    }
    for (const c of pack.components.filter(
      (c) => c.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
    ))
      assertSupport(animatorSupport(c.data as R<AnimatorT>, c.id));
    for (const a of entry.actions)
      check(
        [
          ActionKind.SetActive,
          ActionKind.ApplyClip,
          ActionKind.PlayClip,
          ActionKind.StopEmission,
          ActionKind.ClearParticles,
        ].includes(a.kind),
        'CAPABILITY',
        'Unsupported entry action',
      );
  }
  get particleCount(): number {
    let n = 0;
    for (const e of this.emitters.values()) n += e.count;
    return n;
  }
  private sync(): void {
    this.scene.update();
    let changed = false;
    if (this.initialized)
      for (const c of this.pack.components) {
        if (
          c.dataType !== ComponentData.Animator ||
          !this.scene.nodes.has(c.nodeId) ||
          this.startedAnimators.has(c.id)
        )
          continue;
        if (this.bindings.enabled.get(c.id) && this.scene.nodes.get(c.nodeId)!.activeInHierarchy) {
          this.applyAnimatorState(c.id, (c.data as R<AnimatorT>).layers[0]!.defaultStateId, false);
          changed = true;
        }
      }
    for (const player of this.players.values()) {
      if (!player.owner) continue;
      if (
        !player.owner.activeInHierarchy ||
        (player.animatorId !== undefined && !this.bindings.enabled.get(player.animatorId))
      ) {
        if (
          !player.hierarchyDisabled &&
          !player.owner.activeInHierarchy &&
          player.animatorId !== undefined &&
          (this.pack.getComponent(player.animatorId)!.data as R<AnimatorT>)
            .writeDefaultValuesOnDisable
        ) {
          for (const binding of this.animatorDefaults.get(player.animatorId) ?? [])
            binding.write(binding.baseline);
          changed = true;
        }
        if (!player.disabled) this.orderDirty = true;
        player.disabled = true;
        if (!player.owner.activeInHierarchy && !player.keepState) {
          player.clock.normalizedTime = 0;
          player.resetOnEnable = true;
        }
      } else if (player.disabled) {
        player.disabled = false;
        this.registrations.set(player.key, this.registrationSequence++);
        this.orderDirty = true;
        if (player.resetOnEnable && player.animatorId !== undefined) {
          const animator = this.pack.getComponent(player.animatorId)!.data as R<AnimatorT>;
          this.applyAnimatorState(player.animatorId, animator.layers[0]!.defaultStateId, false);
          changed = true;
        } else {
          for (const binding of player.bindings) binding.sample(player.clock.seconds);
          changed = true;
        }
      }
    }
    for (const player of this.players.values())
      if (player.owner) player.hierarchyDisabled = !player.owner.activeInHierarchy;
    if (changed) this.scene.update();
    if (this.orderDirty) this.animationOrder();
    if (this.initialized)
      for (const e of this.emitters.values()) {
        if (this.bindings.systems.has(e.id)) e.refreshAnimatedParameters();
        e.sync();
      }
  }
  play(): void {
    if (this.state === 'playing') return;
    if (this.state === 'paused') {
      this.state = this.resumeState;
      return;
    }
    if (this.initialized || this.state === 'stopped' || this.state === 'draining') {
      this.restart();
      return;
    }
    this.initialized = true;
    this.state = 'playing';
    for (const c of this.pack.components)
      if (
        c.enabled &&
        c.dataType === ComponentData.Animator &&
        this.scene.nodes.get(c.nodeId)?.activeInHierarchy
      ) {
        const layer = (c.data as R<AnimatorT>).layers[0]!;
        this.applyAnimatorState(c.id, layer.defaultStateId, false);
      }
    for (const a of this.entry.actions) {
      switch (a.kind) {
        case ActionKind.ApplyClip:
          this.startClip(a.animationId);
          break;
        case ActionKind.PlayClip:
          this.startClip(a.animationId, `clip:${a.animationId}`);
          break;
        case ActionKind.SetActive: {
          const n = this.scene.nodes.get(a.targetId);
          if (n) n.active = a.active;
          break;
        }
        case ActionKind.StopEmission:
          this.emitters.get(a.targetId)!.emitting = false;
          break;
        case ActionKind.ClearParticles:
          this.emitters.get(a.targetId)!.clear();
          break;
      }
    }
    this.sync();
    for (const player of this.animationOrder()) if (!this.dispatchEvents(player, true)) break;
  }
  pause(): void {
    this.revision++;
    if (this.state === 'playing' || this.state === 'draining') {
      this.resumeState = this.state;
      this.state = 'paused';
    }
  }
  stop(mode: 'drain' | 'clear' = 'drain'): void {
    this.revision++;
    for (const e of this.emitters.values()) {
      e.emitting = false;
      if (mode === 'clear') e.clear();
    }
    this.state = mode === 'clear' || this.particleCount === 0 ? 'stopped' : 'draining';
    this.accumulator = 0;
  }
  restart(): void {
    this.revision++;
    this.time = 0;
    this.accumulator = 0;
    this.droppedSeconds = 0;
    this.initialized = false;
    this.players.clear();
    this.registrations.clear();
    this.registrationSequence = 0;
    this.orderedPlayers = [];
    this.orderDirty = true;
    this.animatorDefaults.clear();
    this.startedAnimators.clear();
    this.bindings.reset();
    this.state = 'idle';
    this.scene.reset();
    for (const e of this.emitters.values()) e.reset();
    this.scene.update();
    this.play();
  }
  setNodeActive(id: number, active: boolean): void {
    const n = this.scene.nodes.get(id);
    check(n, 'HOST', 'Unknown node');
    n.active = active;
    this.sync();
  }
  applyAnimatorState(animatorId: number, state: string | number, sync = true): void {
    this.revision++;
    const c = this.pack.getComponent(animatorId);
    check(
      c?.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
      'HOST',
      'Unknown Animator',
    );
    const layer = (c.data as R<AnimatorT>).layers[0]!,
      s = layer.states.find((s) => (typeof state === 'number' ? s.id === state : s.name === state));
    check(s, 'HOST', 'Unknown Animator state');
    if (!this.animatorDefaults.has(animatorId)) {
      const unique = new Map<string, CompiledBinding>();
      for (const state of layer.states)
        for (const track of this.clips.get(state.animationId)!.tracks) {
          const binding = this.bindings.compile(track);
          if (binding && !unique.has(binding.key)) unique.set(binding.key, binding);
        }
      this.animatorDefaults.set(animatorId, [...unique.values()]);
    }
    this.startedAnimators.add(animatorId);
    this.startClip(
      s.animationId,
      `animator:${animatorId}`,
      s.speed,
      s.cycleOffset,
      this.scene.nodes.get(c.nodeId),
      (c.data as R<AnimatorT>).keepStateOnDisable,
      animatorId,
      s.writeDefaultValues,
    );
    if (sync) {
      this.sync();
      const player = this.players.get('animator:' + animatorId);
      if (player && this.state === 'playing') {
        this.dispatchEvents(player, true);
        player.skipAdvance = true;
      }
    }
  }
  private startClip(
    id: number,
    key?: string,
    speed = 1,
    cycleOffset = 0,
    owner?: SceneNode,
    keepState = true,
    animatorId?: number,
    writeDefaults = false,
  ): void {
    const clip = this.clips.get(id);
    check(clip, 'SEMANTIC', 'Missing clip');
    if (key && !this.registrations.has(key))
      this.registrations.set(key, this.registrationSequence++);
    const clock = new AnimationClock(clip.durationSeconds, clip.loop, speed, cycleOffset);
    const bindings = clip.tracks.flatMap((track) => {
      const binding = this.bindings.compile(track);
      return binding ? [binding] : [];
    });
    if (writeDefaults && animatorId !== undefined) {
      const keys = new Set(bindings.map((b) => b.key));
      for (const binding of this.animatorDefaults.get(animatorId) ?? [])
        if (!keys.has(binding.key)) binding.write(binding.baseline);
    }
    for (const binding of bindings) binding.sample(clock.seconds);
    if (key)
      this.players.set(key, {
        key,
        clip,
        eventTime: -Number.EPSILON,
        skipAdvance: false,
        clock,
        bindings,
        owner,
        disabled: false,
        hierarchyDisabled: !owner?.activeInHierarchy,
        resetOnEnable: false,
        keepState,
        animatorId,
      });
    this.orderDirty = true;
  }

  /** Higher values write later. Changes apply on the next fixed step and survive restart. */
  setAnimationPriority(target: AnimationTarget, priority: number): void {
    check(
      target && typeof target === 'object' && Number.isFinite(priority),
      'HOST',
      'Invalid animation priority',
    );
    const animator = target.animatorId !== undefined;
    check(animator !== (target.clipId !== undefined), 'HOST', 'Specify one animation target');
    if (animator) {
      const c = this.pack.getComponent(target.animatorId!);
      check(
        c?.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
        'HOST',
        'Unknown Animator',
      );
    } else
      check(
        this.entry.actions.some(
          (a) => a.kind === ActionKind.PlayClip && a.animationId === target.clipId,
        ),
        'HOST',
        'Unknown entry PlayClip',
      );
    const key = animator ? `animator:${target.animatorId}` : `clip:${target.clipId}`;
    if (priority === 0) this.priorities.delete(key);
    else this.priorities.set(key, priority);
    this.orderDirty = true;
    this.animationOrder();
  }
  private animationOrder(): readonly AnimationPlayer[] {
    if (!this.orderDirty) return this.orderedPlayers;
    this.orderDirty = false;
    this.orderedPlayers = [...this.players.values()].sort(
      (a, b) =>
        (this.priorities.get(a.key) ?? 0) - (this.priorities.get(b.key) ?? 0) ||
        Number(a.animatorId === undefined) - Number(b.animatorId === undefined) ||
        this.registrations.get(a.key)! - this.registrations.get(b.key)!,
    );
    for (let i = this.diagnostics.length - 1; i >= 0; i--)
      if (this.diagnostics[i]!.code === 'NATSUME_ANIMATION_ORDER') this.diagnostics.splice(i, 1);
    const writers = new Map<string, AnimationPlayer[]>();
    const overlaps = new Set<string>();
    for (const player of this.orderedPlayers) {
      if (player.disabled || (player.owner && !player.owner.activeInHierarchy)) continue;
      for (const binding of player.bindings)
        for (const key of binding.writes) {
          const previous = writers.get(key) ?? [];
          for (const other of previous)
            if (
              other !== player &&
              (this.priorities.get(other.key) ?? 0) === (this.priorities.get(player.key) ?? 0)
            )
              overlaps.add(`${other.key} / ${player.key}`);
          previous.push(player);
          writers.set(key, previous);
        }
    }
    if (overlaps.size)
      this.diagnostics.push({
        code: 'NATSUME_ANIMATION_ORDER',
        message: `Overlapping animation writes use registration order: ${[...overlaps].join(', ')}. Set distinct animation priorities to choose the final writer.`,
      });
    return this.orderedPlayers;
  }
  private dispatchEvents(player: AnimationPlayer, initial = false): boolean {
    if (this.dispatchingEvents) return false;
    if (player.disabled || (player.owner && !player.owner.activeInHierarchy)) return true;
    const { clip, clock } = player;
    const offset = clock.loop ? Math.fround(clock.cycleOffset) : 0;
    const to = initial ? offset % 1 : Math.fround(clock.normalizedTime + offset);
    const from = initial ? (offset % 1) - Number.EPSILON : player.eventTime;
    const revision = this.revision;
    player.eventTime = initial ? offset : to;
    this.dispatchingEvents = true;
    try {
      visitAnimationEvents(clip.events, clock.duration, clock.loop, from, to, (event) => {
        const animatorId = player.animatorId ?? event.animatorComponentId;
        this.onAnimationEvent?.(
          Object.freeze({
            clipId: clip.id,
            animatorId,
            nodeId: this.pack.getComponent(animatorId)?.nodeId,
            timeSeconds: event.timeSeconds,
            name: String(event.name ?? ''),
            stringParameter: String(event.stringParameter ?? ''),
            floatParameter: event.floatParameter,
            intParameter: event.intParameter,
            objectParameter: event.objectParameter,
            requireReceiver: event.messageOptions === 0,
          }),
        );
        return (
          this.revision === revision &&
          this.state === 'playing' &&
          (!player.owner || player.owner.activeInHierarchy)
        );
      });
    } finally {
      this.dispatchingEvents = false;
    }
    return this.revision === revision && this.state === 'playing';
  }
  private advanceAnimations(): void {
    for (const player of this.animationOrder()) {
      const { clock, bindings, owner, animatorId } = player;
      if (animatorId !== undefined && !this.bindings.enabled.get(animatorId)) continue;
      if (owner && !owner.activeInHierarchy) continue;
      if (player.eventTime < 0 && !this.dispatchEvents(player, true)) return;
      if (clock.duration === 0) continue;
      if (player.skipAdvance) {
        player.skipAdvance = false;
        continue;
      }
      clock.advance(this.fixedDelta);
      if (!this.dispatchEvents(player)) return;
      for (const binding of bindings) binding.sample(clock.seconds);
    }
  }
  update(seconds: number): void {
    check(
      Number.isFinite(seconds) && seconds >= 0,
      'HOST',
      'Delta time must be finite nonnegative seconds',
    );
    check(!this.updating, 'HOST', 'Recursive animation update is unsupported');
    if (this.state !== 'playing' && this.state !== 'draining') return;
    this.updating = true;
    try {
      const accepted = Math.min(seconds, 0.25);
      this.droppedSeconds += seconds - accepted;
      this.accumulator += accepted;
      this.sync();
      // At most eight fixed steps. Preserve the fractional remainder, discard overload.
      let steps = 0;
      while (this.accumulator + 1e-10 >= this.fixedDelta && steps < 8) {
        const revision = this.revision;
        if (this.state === 'playing' && this.players.size > 0) {
          this.advanceAnimations();
          if (revision !== this.revision) {
            this.accumulator = 0;
            return;
          }
          this.sync();
        }
        if (this.state !== 'playing' && this.state !== 'draining') break;
        for (const e of this.emitters.values()) e.step(this.fixedDelta);
        this.time += this.fixedDelta;
        this.accumulator -= this.fixedDelta;
        steps++;
      }
      if (this.accumulator >= this.fixedDelta) {
        const excess = Math.floor((this.accumulator + 1e-10) / this.fixedDelta) * this.fixedDelta;
        this.droppedSeconds += excess;
        this.accumulator -= excess;
      }
      if (this.state === 'draining' && this.particleCount === 0) this.state = 'stopped';
    } finally {
      this.updating = false;
    }
  }
}
