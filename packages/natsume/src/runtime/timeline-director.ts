import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { PlayableDirectorT } from '../format/generated/noa/ir/playable-director.js';
import type { SourceReferenceT } from '../format/generated/noa/ir/source-reference.js';
import { TypedReferenceT } from '../format/generated/noa/ir/typed-reference.js';
import type { DirectorBindingKey, DirectorBindingTarget } from './director-handle.js';
import { timelineDuration } from './timeline-time.js';

/** A graph is instance-owned and captures its restoration baselines when built. */
export interface DirectorGraph {
  evaluate(seconds: number, playback: boolean): void;
  pause(): void;
  destroy(deferred?: boolean): void;
}
const bindingKey = (key: Pick<R<SourceReferenceT>, 'guid' | 'fileId'>) =>
  JSON.stringify([String(key.guid ?? ''), String(key.fileId)]);

/** Clock/lifecycle shared by empty and populated source Directors. */
export class TimelineDirector {
  state: 'playing' | 'paused' | 'stopped' = 'stopped';
  time = 0;
  readonly duration: number;
  private graph: DirectorGraph | undefined;
  private evaluating = false;
  private revision = 0;
  private readonly overrides = new Map<string, R<TypedReferenceT> | null>();
  private readonly exposed = new Map<string, R<TypedReferenceT> | null>();
  constructor(
    readonly id: number,
    readonly source: R<PlayableDirectorT>,
    private readonly createGraph: (director: TimelineDirector) => DirectorGraph,
    private readonly validateTarget: (
      target: DirectorBindingTarget,
      key: DirectorBindingKey,
    ) => void,
  ) {
    this.duration = source.timeline ? timelineDuration(source.timeline) : 0;
    this.time = source.initialTime;
  }
  resolve(
    key: R<SourceReferenceT>,
    fallback: R<TypedReferenceT> | null,
  ): R<TypedReferenceT> | null {
    const name = bindingKey(key);
    if (this.overrides.has(name)) return this.overrides.get(name)!;
    const binding = this.source.bindings.find((b) => bindingKey(b.key!) === name);
    return binding ? binding.target : fallback;
  }
  setBinding(key: DirectorBindingKey, target: DirectorBindingTarget): void {
    check(
      key &&
        ((typeof key.exposedName === 'string' && key.exposedName.length > 0) ||
          (typeof key.guid === 'string' && typeof key.fileId === 'bigint')),
      'HOST',
      'Director binding key requires guid/bigint fileId or a nonempty exposedName',
    );
    this.validateTarget(target, key);
    const map = key.exposedName !== undefined ? this.exposed : this.overrides;
    map.set(
      key.exposedName !== undefined ? key.exposedName : bindingKey(key),
      target === null
        ? null
        : new TypedReferenceT(
            target.nodeId !== undefined ? 1 : 2,
            target.nodeId ?? target.componentId,
          ),
    );
    this.releaseGraph();
  }
  resolveExposed(name: string, fallback: R<TypedReferenceT> | null): R<TypedReferenceT> | null {
    if (this.exposed.has(name)) return this.exposed.get(name)!;
    const reference = this.source.exposedReferences.find((r) => r.name === name);
    return reference ? reference.target : fallback;
  }
  play(): void {
    this.revision++;
    if (!this.source.timeline) return;
    this.state = 'playing';
    this.graph ??= this.createGraph(this);
  }
  pause(): void {
    this.revision++;
    if (this.state === 'playing') this.state = 'paused';
    this.graph?.pause();
  }
  stop(): void {
    this.revision++;
    this.state = 'stopped';
    this.time = this.source.initialTime;
    this.releaseGraph(true);
  }
  reset(): void {
    this.stop();
    this.time = this.source.initialTime;
  }
  setTime(seconds: number): void {
    check(
      Number.isFinite(seconds) && seconds >= 0,
      'HOST',
      'Director time must be finite nonnegative seconds',
    );
    this.revision++;
    this.time = seconds;
  }
  evaluate(playback = false): void {
    if (!this.source.timeline) return;
    check(!this.evaluating, 'HOST', 'Recursive Director evaluation or control cycle');
    this.evaluating = true;
    try {
      this.graph ??= this.createGraph(this);
      this.graph.evaluate(this.time, playback);
    } finally {
      this.evaluating = false;
    }
  }
  /** Returns false after a callback changes this Director's lifecycle. */
  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
  get version(): number {
    return this.revision;
  }
  advance(seconds: number, unscaled?: number): void {
    if (this.state !== 'playing' || this.source.clock === 3) return;
    let delta = seconds;
    if (this.source.clock === 0 || this.source.clock === 2) {
      check(
        unscaled !== undefined,
        'HOST',
        'DSP and UnscaledGameTime Directors require unscaledDeltaSeconds',
      );
      delta = unscaled;
    }
    this.time += delta;
    if (this.duration > 0 && this.time >= this.duration) {
      if (this.source.wrap === 1) this.time %= this.duration;
      else if (this.source.wrap === 2) {
        const revision = this.revision;
        this.time = this.duration;
        check(!this.evaluating, 'HOST', 'Recursive Director evaluation or control cycle');
        this.evaluating = true;
        try {
          this.graph ??= this.createGraph(this);
          this.graph.evaluate(this.time, true);
        } finally {
          this.evaluating = false;
        }
        if (this.revision === revision) this.stop();
        return;
      } else this.time = this.duration;
    }
    check(!this.evaluating, 'HOST', 'Recursive Director evaluation or control cycle');
    this.evaluating = true;
    try {
      this.graph ??= this.createGraph(this);
      this.graph.evaluate(this.time, true);
    } finally {
      this.evaluating = false;
    }
  }
  private releaseGraph(deferred = false): void {
    const graph = this.graph;
    this.graph = undefined;
    graph?.destroy(deferred);
  }
}
