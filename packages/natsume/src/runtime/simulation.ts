import { check } from '../errors.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { AnimatorT } from '../format/generated/noa/ir/animator.js';
import type { BoolTrackT } from '../format/generated/noa/ir/bool-track.js';
import { ComponentData } from '../format/generated/noa/ir/component-data.js';
import { AnimationProperty } from '../format/generated/noa/ir/animation-property.js';
import { TrackData } from '../format/generated/noa/ir/track-data.js';
import { ActionKind } from '../format/generated/noa/ir/action-kind.js';
import { CameraPolicy } from '../format/generated/noa/ir/camera-policy.js';
import { Scene, type LayoutSize } from './scene.js';
import { Emitter, prewarmDuration, type Diagnostic } from './emitter.js';

export interface SimulationOptions {
  readonly entryId?: number;
  readonly seed?: number;
  readonly approximateNoise?: boolean;
  /** Required only when the entry's root uses stretched external anchors. */
  readonly parentLayout?: LayoutSize;
}
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'draining' | 'stopped';

export class Simulation {
  readonly scene: Scene;
  readonly emitters = new Map<number, Emitter>();
  readonly diagnostics: Diagnostic[] = [];
  readonly entry;
  state: PlaybackState = 'idle';
  time = 0;
  droppedSeconds = 0;
  private accumulator = 0;
  private resumeState: PlaybackState = 'playing';
  private initialized = false;
  readonly fixedDelta = 1 / 60;
  constructor(
    readonly pack: EffectPack,
    options: SimulationOptions = {},
  ) {
    check(!pack.disposed, 'DISPOSED', 'Pack has been disposed');
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
          c.data as R<ParticleSystemT>,
          c.enabled,
          seed,
          options.approximateNoise ?? false,
          this.diagnostics,
        ),
      );
    for (const a of pack.document.animations) {
      check(
        a.durationSeconds === 0 && a.events.length === 0,
        'CAPABILITY',
        'Initial Animator supports zero-duration clips without events',
      );
      for (const t of a.tracks)
        check(
          t.binding?.property === AnimationProperty.NodeActive &&
            t.dataType === TrackData.BoolTrack,
          'CAPABILITY',
          'Initial Animator supports NodeActive tracks',
        );
    }
    for (const c of pack.components.filter(
      (c) => c.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
    ))
      check(
        (c.data as R<AnimatorT>).layers.length === 1,
        'CAPABILITY',
        'Only single-layer Animator is supported',
      );
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
    if (this.initialized) for (const e of this.emitters.values()) e.sync();
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
        case ActionKind.PlayClip:
          this.applyClip(a.animationId);
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
  }
  pause(): void {
    if (this.state === 'playing' || this.state === 'draining') {
      this.resumeState = this.state;
      this.state = 'paused';
    }
  }
  stop(mode: 'drain' | 'clear' = 'drain'): void {
    for (const e of this.emitters.values()) {
      e.emitting = false;
      if (mode === 'clear') e.clear();
    }
    this.state = mode === 'clear' || this.particleCount === 0 ? 'stopped' : 'draining';
    this.accumulator = 0;
  }
  restart(): void {
    this.time = 0;
    this.accumulator = 0;
    this.droppedSeconds = 0;
    this.initialized = false;
    this.state = 'idle';
    for (const n of this.scene.nodes.values()) n.active = n.source.active;
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
    const c = this.pack.getComponent(animatorId);
    check(
      c?.dataType === ComponentData.Animator && this.scene.nodes.has(c.nodeId),
      'HOST',
      'Unknown Animator',
    );
    const layer = (c.data as R<AnimatorT>).layers[0]!,
      s = layer.states.find((s) => (typeof state === 'number' ? s.id === state : s.name === state));
    check(s, 'HOST', 'Unknown Animator state');
    this.applyClip(s.animationId);
    if (sync) this.sync();
  }
  private applyClip(id: number): void {
    const clip = this.pack.document.animations.find((a) => a.id === id);
    check(clip, 'SEMANTIC', 'Missing clip');
    for (const t of clip.tracks) {
      const node = this.scene.nodes.get(t.binding!.targetId);
      if (!node) continue;
      for (const k of (t.data as R<BoolTrackT>).keys) if (k.time <= 0) node.active = k.value;
    }
  }
  update(seconds: number): void {
    check(
      Number.isFinite(seconds) && seconds >= 0,
      'HOST',
      'Delta time must be finite nonnegative seconds',
    );
    if (this.state !== 'playing' && this.state !== 'draining') return;
    const accepted = Math.min(seconds, 0.25);
    this.droppedSeconds += seconds - accepted;
    this.accumulator += accepted;
    this.sync();
    // At most eight fixed steps. Preserve the fractional remainder, discard overload.
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.fixedDelta && steps < 8) {
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
  }
}
