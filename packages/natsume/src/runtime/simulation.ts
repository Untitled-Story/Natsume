import { AnimatorController } from './animator-controller.js';
import { TimelineDirector } from './timeline-director.js';
import { TimelineGraph } from './timeline-graph.js';
import { validateTimelineBinding } from './timeline-bindings.js';
import { TimelineControlPlayer } from './timeline-control.js';
import { TimelineParticles } from './timeline-particles.js';
import { directorSupport } from './timeline-support.js';
import type { PlayableDirectorT } from '../format/generated/noa/ir/playable-director.js';
import type { AnimationEventT } from '../format/generated/noa/ir/animation-event.js';
import { particleSnapshot, type ParticleSnapshot } from './particle-snapshot.js';
import { TrailPointPool } from './trail-point-pool.js';
import { SubEmitterGraph } from './sub-emitters.js';
import { ParticleTrails } from './particle-trails.js';
import { ParticleModuleData } from '../format/generated/noa/ir/particle-module-data.js';
import type { TrailsModuleT } from '../format/generated/noa/ir/trails-module.js';
import type { CanvasEnvironment } from '../rendering/canvas-environment.js';
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
import { Emitter, type Diagnostic } from './emitter.js';
import { instancePrewarmWork } from './prewarm.js';
import { subEmitterSupport } from './sub-emitter-support.js';

export interface SimulationOptions {
  /** Complete fixed-step system order; repeat shared pools once per independent root. Defaults to stable scheduling. */
  readonly subEmitterUpdateOrder?: readonly number[];
  /** Maximum retained trail points per instance. Defaults to 65,536; overflow throws. */
  readonly maxTrailPoints?: number;
  /** Host display and projection inputs for source Canvas components. */
  readonly canvasEnvironment?: CanvasEnvironment;
  readonly entryId?: number;
  readonly seed?: number;
  /** Required only when the entry's root uses stretched external anchors. */
  readonly parentLayout?: LayoutSize;
  readonly gravity?: readonly [number, number, number];
  readonly particleEnvironment?: import('../rendering/particle-environment.js').ParticleEnvironment;
}
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'draining' | 'stopped';

/** Identifies an Animator or an entry action's continuously playing clip. */
export type AnimationTarget =
  | { readonly animatorId: number; readonly clipId?: never }
  | { readonly clipId: number; readonly animatorId?: never };
interface PlayerBase {
  readonly key: string;
  readonly owner: SceneNode | undefined;
  disabled: boolean;
  hierarchyDisabled: boolean;
  resetOnEnable: boolean;
  readonly keepState: boolean;
  readonly animatorId: number | undefined;
  readonly bindings: readonly CompiledBinding[];
  skipAdvance: boolean;
}
interface ClipPlayer extends PlayerBase {
  readonly controller?: never;
  readonly clip: R<AnimationT>;
  readonly clock: AnimationClock;
  eventTime: number;
}
interface ControllerPlayer extends PlayerBase {
  readonly controller: AnimatorController;
}
type AnimationPlayer = ClipPlayer | ControllerPlayer;

/** Extra clocks are required only by active controllers using those update modes. */
export interface AnimationUpdateOptions {
  readonly unscaledDeltaSeconds?: number;
  readonly physicsSteps?: readonly number[];
}

export class Simulation {
  onParticleSystemStopped:
    | ((event: import('./particle-stopped.js').ParticleSystemStoppedEvent) => void)
    | undefined;
  private readonly stoppedSystems = new Set<number>();
  private dispatchingStoppedEvents = false;
  onParticleTrigger:
    | ((event: import('./particle-physics.js').ParticleTriggerEvent) => void)
    | undefined;
  private readonly triggerEvents: import('./particle-physics.js').ParticleTriggerEvent[] = [];
  onParticleCollision:
    | ((event: import('./particle-physics.js').ParticleCollisionEvent) => void)
    | undefined;
  private readonly collisionEvents: import('./particle-physics.js').ParticleCollisionEvent[] = [];
  readonly directors = new Map<number, TimelineDirector>();
  private readonly directorClaims = new Map<number, number>();
  private readonly enabledDirectors = new Set<number>();
  private deferredDirectorDisposals: (() => void)[] = [];
  private flushingDirectors = false;
  onControlTime:
    | ((
        nodeId: number,
        phase: 'start' | 'sample' | 'stop',
        seconds: number,
        isCurrent: () => boolean,
      ) => void)
    | undefined;
  readonly trailPoints: TrailPointPool;
  readonly subEmitters: SubEmitterGraph;
  readonly trails = new Map<number, ParticleTrails>();
  readonly scene: Scene;
  readonly emitters = new Map<number, Emitter>();
  readonly diagnostics: Diagnostic[] = [];
  readonly entry;
  state: PlaybackState = 'idle';
  time = 0;
  droppedSeconds = 0;
  private accumulator = 0;
  private unscaledAccumulator = 0;
  private revision = 0;
  private updating = false;
  private dispatchingEvents = false;
  onAnimationEvent: ((event: NatsumeAnimationEvent) => void) | undefined;
  private resumeState: PlaybackState = 'playing';
  private initialized = false;
  readonly fixedDelta = 1 / 60;
  readonly bindings: AnimationBindings;
  private readonly controllers = new Map<number, AnimatorController>();
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
    this.trailPoints = new TrailPointPool(options.maxTrailPoints);
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
    this.scene = new Scene(pack, entry.roots, options.parentLayout, options.canvasEnvironment);
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
      instancePrewarmWork(
        new Map(systems.map((c) => [c.id, c.data as R<ParticleSystemT>])),
        new Set(systems.filter((c) => c.enabled).map((c) => c.id)),
      ) <= 40_000_000,
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
          pack,
          options.particleEnvironment,
          this.scene.nodes,
        ),
      );
    for (const emitter of this.emitters.values())
      emitter.onCollisionMessage = (event) => this.collisionEvents.push(event);
    for (const emitter of this.emitters.values())
      emitter.onTriggerMessage = (event) => this.triggerEvents.push(event);
    const stopNodes = new Set(
      [...this.emitters.values()].filter((e) => e.main.stopAction !== 0).map((e) => e.node),
    );
    for (const emitter of this.emitters.values()) {
      let node: SceneNode | undefined = emitter.node;
      while (node && !stopNodes.has(node)) node = node.parent;
      if (node) emitter.enableLifetimeProgress();
    }
    this.subEmitters = new SubEmitterGraph(this.emitters);
    this.subEmitters.setUpdateOrder(options.subEmitterUpdateOrder);
    this.diagnostics.push(
      ...subEmitterSupport(new Map(systems.map((c) => [c.id, c.data as R<ParticleSystemT>]))).map(
        ({ code, message }) => ({ code, message }),
      ),
    );
    for (const emitter of this.emitters.values()) {
      const module = emitter.source.modules.find(
        (m) => m.dataType === ParticleModuleData.TrailsModule,
      );
      if (module)
        this.trails.set(
          emitter.id,
          new ParticleTrails(emitter, module.data as R<TrailsModuleT>, this.trailPoints),
        );
    }
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
            emitter.gravity = emitter.resolveEnvironment(
              options.particleEnvironment,
              options.gravity,
            );
          }
        }
      }
    for (const animation of pack.document.animations) {
      assertSupport(animationSupport(animation));
      this.clips.set(animation.id, animation);
    }
    for (const c of pack.components.filter(
      (c) => c.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
    )) {
      assertSupport(animatorSupport(c.data as R<AnimatorT>, c.id));
      this.controllers.set(
        c.id,
        new AnimatorController(c.data as R<AnimatorT>, this.clips, this.bindings, (clip, event) =>
          this.emitAnimationEvent(c.id, clip, event),
        ),
      );
    }
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
    for (const c of pack.components)
      if (c.dataType === ComponentData.PlayableDirector && this.scene.nodes.has(c.nodeId)) {
        assertSupport(
          directorSupport(pack, c.data as R<PlayableDirectorT>, new Set(this.scene.nodes.keys())),
        );
        this.directors.set(
          c.id,
          new TimelineDirector(
            c.id,
            c.data as R<PlayableDirectorT>,
            (director) =>
              new TimelineGraph(director, {
                pack,
                scene: this.scene,
                bindings: this.bindings,
                animatorPose: (id) => this.controllers.get(id)?.getPose(),
                defer: (action) => this.deferredDirectorDisposals.push(action),
                revision: () => this.revision,
                event: (id, clip, event) => this.emitAnimationEvent(id, clip, event),
                control: (director, data, target) =>
                  new TimelineControlPlayer(director, data, target, {
                    pack,
                    scene: this.scene,
                    directors: this.directors,
                    directorClaims: this.directorClaims,
                    acquireParticles: (node, search, randomSeed) =>
                      new TimelineParticles(
                        node,
                        search,
                        randomSeed,
                        this.emitters,
                        this.subEmitters,
                      ),
                    controlTime: (nodeId, phase, seconds) => {
                      const revision = this.revision;
                      const version = director.version;
                      this.onControlTime?.(
                        nodeId,
                        phase,
                        seconds,
                        () => this.revision === revision && director.isCurrent(version),
                      );
                      return this.revision === revision;
                    },
                  }),
              }),
            (target, key) =>
              validateTimelineBinding(
                pack,
                this.scene,
                c.data as R<PlayableDirectorT>,
                key,
                target,
              ),
          ),
        );
      }
  }
  getDirector(id: number): TimelineDirector {
    const director = this.directors.get(id);
    check(director, 'HOST', 'Unknown PlayableDirector');
    return director;
  }
  /** @internal Unity releases stopped playable graphs at the next graph-update boundary. */
  flushDirectors(): void {
    if (this.flushingDirectors) return;
    this.flushingDirectors = true;
    try {
      while (this.deferredDirectorDisposals.length) {
        const pending = this.deferredDirectorDisposals;
        this.deferredDirectorDisposals = [];
        for (const action of pending) action();
      }
    } finally {
      this.flushingDirectors = false;
    }
  }
  /** @internal Release all owned graphs before destroying scene and script state. */
  disposeDirectors(): void {
    for (const director of this.directors.values()) director.stop();
    this.flushDirectors();
  }
  getParticles(systemId: number): readonly ParticleSnapshot[] {
    const emitter = this.emitters.get(systemId);
    check(emitter, 'HOST', 'Unknown particle system');
    return Array.from({ length: emitter.count }, (_, index) => particleSnapshot(emitter, index));
  }
  setParticleSystemVisible(systemId: number, visible: boolean): void {
    const emitter = this.emitters.get(systemId);
    check(emitter, 'HOST', 'Unknown particle system');
    check(typeof visible === 'boolean', 'HOST', 'Particle visibility must be boolean');
    emitter.visible = visible;
  }
  emitSubEmitter(systemId: number, slot: number, particleId?: number): void {
    this.subEmitters.trigger(systemId, slot, particleId);
  }
  /** Copies the job order for the next fixed step. Undefined restores stable scheduling; restart retains it. */
  setSubEmitterUpdateOrder(order: readonly number[] | undefined): void {
    this.subEmitters.setUpdateOrder(order);
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
          this.startAnimator(c.id);
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
          player.controller?.restoreDefaults();
          changed = true;
        }
        if (!player.disabled) this.orderDirty = true;
        player.disabled = true;
        if (!player.owner.activeInHierarchy && !player.keepState) {
          if (!player.controller) player.clock.normalizedTime = 0;
          player.resetOnEnable = true;
        }
      } else if (player.disabled) {
        player.disabled = false;
        this.registrations.set(player.key, this.registrationSequence++);
        this.orderDirty = true;
        if (player.resetOnEnable && player.animatorId !== undefined) {
          player.controller?.reset();
          this.startAnimator(player.animatorId);
          changed = true;
        } else {
          if (player.controller) player.controller.apply();
          else for (const binding of player.bindings) binding.sample(player.clock.seconds);
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
    if (this.initialized) this.subEmitters.warm();
    if (this.initialized)
      for (const [id, director] of this.directors) {
        const component = this.pack.getComponent(id)!;
        const active =
          this.bindings.enabled.get(id) &&
          this.scene.nodes.get(component.nodeId)!.activeInHierarchy;
        if (active && !this.enabledDirectors.has(id)) {
          this.enabledDirectors.add(id);
          if (director.source.playOnAwake) director.play();
        } else if (!active && this.enabledDirectors.delete(id)) director.stop();
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
        this.startAnimator(c.id);
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
    this.collisionEvents.length = 0;
    this.triggerEvents.length = 0;
    if (mode === 'clear') for (const director of this.directors.values()) director.stop();
    for (const e of this.emitters.values()) {
      e.emitting = false;
      if (mode === 'clear') e.clear();
    }
    if (mode === 'clear') this.trailPoints.clear();
    this.state =
      mode === 'clear' || (this.particleCount === 0 && this.trailPoints.count === 0)
        ? 'stopped'
        : 'draining';
    this.accumulator = 0;
    this.unscaledAccumulator = 0;
  }
  restart(): void {
    this.revision++;
    this.collisionEvents.length = 0;
    this.triggerEvents.length = 0;
    for (const director of this.directors.values()) director.reset();
    this.flushDirectors();
    this.enabledDirectors.clear();
    this.stoppedSystems.clear();
    this.subEmitters.clear();
    this.subEmitters.externallyControlled.clear();
    this.time = 0;
    this.accumulator = 0;
    this.unscaledAccumulator = 0;
    this.droppedSeconds = 0;
    this.initialized = false;
    this.players.clear();
    this.registrations.clear();
    this.registrationSequence = 0;
    this.orderedPlayers = [];
    this.orderDirty = true;
    for (const controller of this.controllers.values()) controller.reset();
    this.startedAnimators.clear();
    this.bindings.reset();
    this.state = 'idle';
    this.scene.reset();
    for (const e of this.emitters.values()) {
      e.timelineControlled = false;
      e.restorePlaybackSeed();
      e.reset();
    }
    this.trailPoints.clear();
    this.scene.update();
    this.play();
  }
  setNodeActive(id: number, active: boolean): void {
    const n = this.scene.nodes.get(id);
    check(n, 'HOST', 'Unknown node');
    check(!n.destroyed, 'DISPOSED', 'Node has been destroyed');
    n.active = active;
    this.sync();
  }
  getAnimator(id: number): AnimatorController {
    const controller = this.controllers.get(id);
    check(controller, 'HOST', 'Unknown Animator');
    return controller;
  }
  private startAnimator(id: number): ControllerPlayer {
    const controller = this.getAnimator(id);
    controller.start();
    controller.apply();
    const component = this.pack.getComponent(id)!;
    const key = `animator:${id}`;
    if (!this.registrations.has(key)) this.registrations.set(key, this.registrationSequence++);
    const player: ControllerPlayer = {
      key,
      controller,
      owner: this.scene.nodes.get(component.nodeId),
      disabled: false,
      hierarchyDisabled: false,
      resetOnEnable: false,
      keepState: controller.source.keepStateOnDisable,
      animatorId: id,
      bindings: controller.allBindings,
      skipAdvance: false,
    };
    this.players.set(key, player);
    this.startedAnimators.add(id);
    this.orderDirty = true;
    return player;
  }
  applyAnimatorState(animatorId: number, state: string | number, sync = true, layer = 0): void {
    const controller = this.getAnimator(animatorId);
    // Validate before changing playback or event generation.
    check(
      controller.source.layers[layer]?.states.some((s) =>
        typeof state === 'number' ? s.id === state : s.name === state,
      ),
      'HOST',
      'Unknown Animator state',
    );
    this.revision++;
    const player = this.players.get(`animator:${animatorId}`) ?? this.startAnimator(animatorId);
    controller.play(state, layer);
    controller.apply();
    if (sync) {
      this.sync();
      if (this.state === 'playing') {
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
    if (player.controller) return player.disabled || player.controller.flushEvents();
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
  private emitAnimationEvent(
    animatorId: number,
    clip: R<AnimationT>,
    event: R<AnimationEventT>,
  ): boolean {
    const revision = this.revision;
    if (this.dispatchingEvents) return false;
    this.dispatchingEvents = true;
    try {
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
    } finally {
      this.dispatchingEvents = false;
    }
    return (
      this.revision === revision &&
      this.state === 'playing' &&
      !!this.scene.nodes.get(this.pack.getComponent(animatorId)!.nodeId)?.activeInHierarchy
    );
  }
  private advanceAnimations(mode = 0, delta = this.fixedDelta, unscaledDelta?: number): void {
    for (const player of this.animationOrder()) {
      const { owner, animatorId } = player;
      if (animatorId !== undefined && !this.bindings.enabled.get(animatorId)) continue;
      if (owner && !owner.activeInHierarchy) continue;
      if (player.controller) {
        const controller = player.controller;
        const controllerDelta =
          controller.source.updateMode === mode
            ? delta
            : controller.source.updateMode === 2
              ? unscaledDelta
              : undefined;
        if (controllerDelta !== undefined) {
          if (!controller.flushEvents()) return;
          if (player.skipAdvance) player.skipAdvance = false;
          else if (!controller.evaluate(controllerDelta)) return;
        }
        controller.apply();
      } else {
        if (mode === 0) {
          if (player.eventTime < 0 && !this.dispatchEvents(player, true)) return;
          if (player.clock.duration === 0) continue;
          if (player.skipAdvance) {
            player.skipAdvance = false;
            continue;
          }
          player.clock.advance(delta);
          if (!this.dispatchEvents(player)) return;
        }
        for (const binding of player.bindings) binding.sample(player.clock.seconds);
      }
    }
  }
  private applyParticleStopActions(): boolean {
    if (!this.initialized || this.state === 'paused') return true;
    const revision = this.revision;
    let changed = false;
    for (const emitter of this.emitters.values()) {
      if (emitter.main.stopAction === 0) continue;
      if (!emitter.completed) {
        this.stoppedSystems.delete(emitter.id);
        continue;
      }
      if (
        this.stoppedSystems.has(emitter.id) ||
        emitter.timelineControlled ||
        this.subEmitters.hasLiveDescendants(emitter.id)
      )
        continue;
      let alive = (this.trails.get(emitter.id)?.records.size ?? 0) > 0;
      for (const child of this.emitters.values()) {
        if (child === emitter || !child.node.activeInHierarchy) continue;
        let ancestor: SceneNode | undefined = child.node;
        while (ancestor && ancestor !== emitter.node) ancestor = ancestor.parent;
        if (
          ancestor &&
          (child.graphPlaying || (this.trails.get(child.id)?.records.size ?? 0) > 0)
        ) {
          alive = true;
          break;
        }
      }
      if (alive) continue;
      this.stoppedSystems.add(emitter.id);
      switch (emitter.main.stopAction) {
        case 1:
          emitter.node.active = false;
          changed = true;
          break;
        case 2:
          for (const node of this.scene.ordered) {
            let ancestor: SceneNode | undefined = node;
            while (ancestor && ancestor !== emitter.node) ancestor = ancestor.parent;
            if (ancestor) node.destroyed = true;
          }
          changed = true;
          break;
        case 3:
          this.onParticleSystemStopped?.({ systemId: emitter.id, nodeId: emitter.node.id });
          break;
      }
      if (revision !== this.revision) return false;
    }
    if (changed) this.sync();
    return revision === this.revision;
  }
  update(seconds: number, clocks: AnimationUpdateOptions = {}): void {
    check(
      Number.isFinite(seconds) && seconds >= 0,
      'HOST',
      'Delta time must be finite nonnegative seconds',
    );
    check(
      !this.updating && !this.dispatchingStoppedEvents,
      'HOST',
      'Recursive animation update is unsupported',
    );
    check(!this.flushingDirectors, 'HOST', 'Recursive animation update is unsupported');
    this.flushDirectors();
    this.dispatchingStoppedEvents = true;
    try {
      if (!this.applyParticleStopActions()) return;
    } finally {
      this.dispatchingStoppedEvents = false;
    }
    if (this.state !== 'playing' && this.state !== 'draining') return;
    check(
      clocks !== null && typeof clocks === 'object',
      'HOST',
      'Animation clocks must be an object',
    );
    check(
      clocks.physicsSteps === undefined || Array.isArray(clocks.physicsSteps),
      'HOST',
      'physicsSteps must be an array',
    );
    if (clocks.unscaledDeltaSeconds !== undefined)
      check(
        Number.isFinite(clocks.unscaledDeltaSeconds) && clocks.unscaledDeltaSeconds >= 0,
        'HOST',
        'Animation clock must be finite nonnegative seconds',
      );
    for (const value of clocks.physicsSteps ?? [])
      check(
        Number.isFinite(value) && value >= 0,
        'HOST',
        'Animation clock must be finite nonnegative seconds',
      );
    const modes = new Set(
      [...this.controllers].flatMap(([id, c]) =>
        this.bindings.enabled.get(id) &&
        this.scene.nodes.get(this.pack.getComponent(id)!.nodeId)?.activeInHierarchy
          ? [c.source.updateMode]
          : [],
      ),
    );
    if (this.state === 'playing') {
      for (const [id, director] of this.directors) {
        if (director.state !== 'playing' || this.directorClaims.has(id)) continue;
        check(
          ![0, 2].includes(director.source.clock) || clocks.unscaledDeltaSeconds !== undefined,
          'HOST',
          'DSP and UnscaledGameTime Directors require unscaledDeltaSeconds',
        );
      }
      check(
        !modes.has(1) || clocks.physicsSteps !== undefined,
        'HOST',
        'AnimatePhysics requires physicsSteps',
      );
      check(
        !modes.has(2) || clocks.unscaledDeltaSeconds !== undefined,
        'HOST',
        'UnscaledTime requires unscaledDeltaSeconds',
      );
    }
    const hasUnscaledParticles = [...this.emitters.values()].some(
      (emitter) =>
        emitter.main.clock === 1 &&
        emitter.enabled &&
        emitter.node.activeInHierarchy &&
        !this.subEmitters.externallyControlled.has(emitter.id),
    );
    check(
      !hasUnscaledParticles || clocks.unscaledDeltaSeconds !== undefined,
      'HOST',
      'Unscaled particles require unscaledDeltaSeconds',
    );
    this.updating = true;
    try {
      const accepted = Math.min(seconds, 0.25);
      const unscaled = hasUnscaledParticles ? clocks.unscaledDeltaSeconds! : 0;
      const acceptedUnscaled = Math.min(unscaled, 0.25);
      this.droppedSeconds += Math.max(seconds - accepted, unscaled - acceptedUnscaled);
      this.accumulator += accepted;
      this.unscaledAccumulator += acceptedUnscaled;
      this.sync();
      if (this.state === 'playing') {
        for (const step of clocks.physicsSteps ?? []) {
          const revision = this.revision;
          this.advanceAnimations(1, step);
          if (this.revision !== revision) return;
          this.sync();
        }
        if (clocks.physicsSteps?.length === 0)
          for (const player of this.animationOrder()) {
            if (player.controller && !player.disabled && !player.controller.flushDeferredEvents())
              return;
          }
      }
      // At most eight fixed steps. Preserve the fractional remainder, discard overload.
      let steps = 0;
      let directorsAdvanced = false;
      let unscaledDelta = clocks.unscaledDeltaSeconds;
      while (
        (this.accumulator + 1e-10 >= this.fixedDelta ||
          this.unscaledAccumulator + 1e-10 >= this.fixedDelta) &&
        steps < 8
      ) {
        if (steps === 0)
          this.subEmitters.beginHostUpdate(
            Math.min(8, Math.floor((this.accumulator + 1e-10) / this.fixedDelta)) * this.fixedDelta,
          );
        const scaledStep = this.accumulator + 1e-10 >= this.fixedDelta ? this.fixedDelta : 0;
        const unscaledStep =
          this.unscaledAccumulator + 1e-10 >= this.fixedDelta ? this.fixedDelta : 0;
        const revision = this.revision;
        if (this.state === 'playing' && this.players.size > 0) {
          this.advanceAnimations(0, scaledStep, unscaledDelta);
          unscaledDelta = undefined;
          if (revision !== this.revision) {
            this.accumulator = 0;
            this.unscaledAccumulator = 0;
            return;
          }
          this.sync();
        }
        if (this.state !== 'playing' && this.state !== 'draining') break;
        if (this.state === 'playing' && !directorsAdvanced) {
          directorsAdvanced = true;
          if (!this.advanceDirectors(seconds, clocks)) return;
        }
        this.subEmitters.step(
          scaledStep,
          unscaledStep,
          seconds > 0 ? (clocks.unscaledDeltaSeconds ?? seconds) / seconds : 1,
        );
        this.time += scaledStep;
        this.accumulator -= scaledStep;
        this.unscaledAccumulator -= unscaledStep;
        steps++;
        if (this.collisionEvents.length) {
          const revision = this.revision;
          const events = this.collisionEvents.splice(0);
          for (const event of events) {
            this.onParticleCollision?.(event);
            if (revision !== this.revision) return;
          }
        }
        if (this.triggerEvents.length) {
          const revision = this.revision;
          const events = this.triggerEvents.splice(0);
          for (const event of events) {
            this.onParticleTrigger?.(event);
            if (revision !== this.revision) return;
          }
        }
      }
      if (this.state === 'playing' && unscaledDelta !== undefined) {
        const revision = this.revision;
        this.advanceAnimations(2, unscaledDelta);
        if (this.revision !== revision) return;
        this.sync();
      }
      if (this.state === 'playing' && !directorsAdvanced && !this.advanceDirectors(seconds, clocks))
        return;
      const excessScaled =
        Math.max(0, Math.floor((this.accumulator + 1e-10) / this.fixedDelta)) * this.fixedDelta;
      const excessUnscaled =
        Math.max(0, Math.floor((this.unscaledAccumulator + 1e-10) / this.fixedDelta)) *
        this.fixedDelta;
      this.droppedSeconds += Math.max(excessScaled, excessUnscaled);
      this.accumulator -= excessScaled;
      this.unscaledAccumulator -= excessUnscaled;
      if (this.state === 'draining' && this.particleCount === 0 && this.trailPoints.count === 0)
        this.state = 'stopped';
    } finally {
      this.subEmitters.endHostUpdate();
      this.updating = false;
    }
  }
  private advanceDirectors(seconds: number, clocks: AnimationUpdateOptions): boolean {
    const revision = this.revision;
    for (const [id, director] of this.directors) {
      if (this.directorClaims.has(id)) continue;
      const component = this.pack.getComponent(id)!;
      if (
        !this.bindings.enabled.get(id) ||
        !this.scene.nodes.get(component.nodeId)!.activeInHierarchy
      )
        continue;
      director.advance(seconds, clocks.unscaledDeltaSeconds);
      if (this.revision !== revision) return false;
    }
    this.sync();
    return true;
  }
}
