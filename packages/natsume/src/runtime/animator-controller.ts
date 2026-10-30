import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { AnimatorT } from '../format/generated/noa/ir/animator.js';
import type { AnimatorStateT } from '../format/generated/noa/ir/animator-state.js';
import type { AnimatorLayerT } from '../format/generated/noa/ir/animator-layer.js';
import type { AnimatorTransitionT } from '../format/generated/noa/ir/animator-transition.js';
import type { AnimationT } from '../format/generated/noa/ir/animation.js';
import type { AnimationEventT } from '../format/generated/noa/ir/animation-event.js';
import { AnimatorConditionMode as Condition } from '../format/generated/noa/ir/animator-condition-mode.js';
import { AnimatorInterruption as Interruption } from '../format/generated/noa/ir/animator-interruption.js';
import { AnimatorParameters } from './animator-parameters.js';
import { AnimationBindings, type CompiledBinding } from './animation-bindings.js';
import { visitAnimationEvents } from './animation-events.js';
import { poseValue, mixPoses, addPose, writePose, type AnimationPose } from './animation-pose.js';

/** Immutable state snapshot; normalizedTime retains completed loops. */
export interface AnimatorStateInfo {
  readonly id: number;
  readonly name: string;
  readonly tag: string;
  readonly clipId: number;
  readonly normalizedTime: number;
}
/** Current crossfade, or undefined when the layer is not transitioning. */
export interface AnimatorTransitionInfo {
  readonly sourceStateId: number;
  readonly destinationStateId: number;
  readonly normalizedTime: number;
}
interface State {
  readonly source: R<AnimatorStateT>;
  readonly clip: R<AnimationT> | undefined;
  readonly bindings: readonly CompiledBinding[];
  readonly reference: AnimationPose;
  readonly held: AnimationPose;
  time: number;
  eventTime: number;
}
interface Transition {
  readonly source: R<AnimatorTransitionT>;
  readonly next: State;
  readonly duration: number;
  readonly frozen: AnimationPose | undefined;
  readonly frozenReference: AnimationPose | undefined;
  elapsed: number;
}
interface Layer {
  readonly source: R<AnimatorLayerT>;
  readonly defaults: Map<string, CompiledBinding>;
  current: State | undefined;
  transition: Transition | undefined;
  pose: AnimationPose;
  reference: AnimationPose;
  weight: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Flat, instance-owned Mecanim graph. No Avatar, masks or nested state machines. */
export class AnimatorController {
  readonly parameters: AnimatorParameters;
  private readonly layers: Layer[];
  private readonly defaults = new Map<string, CompiledBinding>();
  private readonly consumed = new Set<string>();
  private pose: AnimationPose = new Map();
  private revision = 0;
  private started = false;
  private readonly previousEvents: { clip: R<AnimationT>; event: R<AnimationEventT> }[] = [];
  private resumePhysicsEvents = false;
  visible = true;
  setVisible(visible: boolean): void {
    check(typeof visible === 'boolean', 'HOST', 'Animator visibility must be boolean');
    if (visible && !this.visible && this.source.updateMode === 1 && this.source.cullingMode === 2)
      this.resumePhysicsEvents = true;
    this.visible = visible;
  }
  /** Unity can dispatch the retained physics event batch when visibility returns without a physics tick. */
  flushDeferredEvents(): boolean {
    if (!this.resumePhysicsEvents) return true;
    this.resumePhysicsEvents = false;
    const revision = this.revision;
    for (const { clip, event } of this.previousEvents)
      if (!this.event(clip, event) || revision !== this.revision) return false;
    return true;
  }
  constructor(
    readonly source: R<AnimatorT>,
    private readonly clips: ReadonlyMap<number, R<AnimationT>>,
    private readonly bindings: AnimationBindings,
    private readonly event: (clip: R<AnimationT>, event: R<AnimationEventT>) => boolean,
  ) {
    this.parameters = new AnimatorParameters(source.parameters);
    this.layers = source.layers.map((source) => ({
      source,
      defaults: new Map(),
      current: undefined,
      transition: undefined,
      pose: new Map(),
      reference: new Map(),
      weight: source.defaultWeight,
    }));
  }
  get allBindings(): readonly CompiledBinding[] {
    return [...this.defaults.values()];
  }
  get layerCount(): number {
    return this.layers.length;
  }
  private layer(index: number): Layer {
    check(
      Number.isInteger(index) && index >= 0 && index < this.layers.length,
      'HOST',
      'Unknown Animator layer',
    );
    return this.layers[index]!;
  }
  getLayerWeight(index: number): number {
    this.layer(index);
    return index === 0 ? 1 : this.layers[index]!.weight;
  }
  setLayerWeight(index: number, value: number): void {
    const layer = this.layer(index);
    check(
      Number.isFinite(value) && value >= 0 && value <= 1,
      'HOST',
      'Animator layer weight must be in [0, 1]',
    );
    layer.weight = value;
  }
  getCurrentState(index = 0): AnimatorStateInfo | undefined {
    return this.info(this.layer(index).current);
  }
  getNextState(index = 0): AnimatorStateInfo | undefined {
    return this.info(this.layer(index).transition?.next);
  }
  getTransition(index = 0): AnimatorTransitionInfo | undefined {
    const l = this.layer(index),
      t = l.transition;
    return t
      ? Object.freeze({
          sourceStateId: l.current!.source.id,
          destinationStateId: t.next.source.id,
          normalizedTime: clamp(t.elapsed),
        })
      : undefined;
  }
  private info(s: State | undefined): AnimatorStateInfo | undefined {
    return s
      ? Object.freeze({
          id: s.source.id,
          name: String(s.source.name),
          tag: String(s.source.tag ?? ''),
          clipId: s.source.animationId,
          normalizedTime: s.time,
        })
      : undefined;
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const layer of this.layers)
      for (const state of layer.source.states)
        for (const track of this.clips.get(state.animationId)?.tracks ?? []) {
          const b = this.bindings.compile(track);
          if (b) {
            if (!this.defaults.has(b.key)) this.defaults.set(b.key, b);
            if (!layer.defaults.has(b.key)) layer.defaults.set(b.key, b);
          }
        }
    for (const layer of this.layers) this.enter(layer, layer.source.defaultStateId);
    this.evaluate(0, false);
  }
  reset(): void {
    this.revision++;
    this.previousEvents.length = 0;
    this.resumePhysicsEvents = false;
    this.started = false;
    this.defaults.clear();
    this.pose.clear();
    this.parameters.reset();
    for (const layer of this.layers) {
      layer.current = undefined;
      layer.transition = undefined;
      layer.pose.clear();
      layer.reference.clear();
      layer.defaults.clear();
      layer.weight = layer.source.defaultWeight;
    }
  }
  restoreDefaults(): void {
    for (const binding of this.defaults.values()) binding.write(binding.baseline);
  }
  play(state: string | number, index = 0): void {
    this.start();
    const layer = this.layer(index);
    const selected = layer.source.states.find((s) =>
      typeof state === 'number' ? s.id === state : s.name === state,
    );
    check(selected, 'HOST', 'Unknown Animator state');
    this.revision++;
    this.enter(layer, selected.id);
    layer.pose = this.sample(layer.current!, layer);
    layer.reference = this.reference(layer.current!, layer);
    this.compose();
  }
  private entry(layer: Layer): number {
    const transition = this.select(layer.source.entryTransitions, undefined, 0, 0, false);
    if (transition) this.consume(transition);
    return transition?.destinationStateId ?? layer.source.defaultStateId;
  }
  private state(source: R<AnimatorStateT>, held: AnimationPose): State {
    const clip = this.clips.get(source.animationId);
    const bindings = (clip?.tracks ?? []).flatMap((track) => {
      const b = this.bindings.compile(track);
      return b ? [b] : [];
    });
    const reference = new Map<string, ReturnType<typeof poseValue>>();
    for (const b of bindings) reference.set(b.key, poseValue(b, b.evaluate(0)));
    const state: State = {
      source,
      clip,
      bindings,
      reference,
      held: new Map(held),
      time: 0,
      eventTime: -Number.EPSILON,
    };
    state.eventTime = this.eventPhase(state) - Number.EPSILON;
    return state;
  }
  private enter(layer: Layer, id: number): void {
    layer.transition = undefined;
    const source = layer.source.states.find((s) => s.id === id);
    layer.current = source ? this.state(source, layer.pose) : undefined;
  }
  private consume(t: R<AnimatorTransitionT>): void {
    for (const condition of t.conditions) {
      const p = String(condition.parameter);
      if (this.parameters.isTrigger(p)) this.consumed.add(p);
    }
  }
  private select(
    list: readonly R<AnimatorTransitionT>[],
    state: State | undefined,
    from: number,
    to: number,
    any: boolean,
    stop?: R<AnimatorTransitionT>,
  ): R<AnimatorTransitionT> | undefined {
    const solo = list.some((t) => t.solo && !t.mute);
    for (const t of list) {
      if (t === stop) break;
      if (t.mute || (solo && !t.solo)) continue;
      if (any && !t.canTransitionToSelf && state?.source.id === t.destinationStateId) continue;
      if (t.hasExitTime) {
        const exit = t.exitTime === 0 ? 1 : t.exitTime;
        let crossed = false;
        if (exit < 1) {
          const boundary = Math.floor(from) + exit;
          crossed =
            (from < boundary && to >= boundary) || (from < boundary + 1 && to >= boundary + 1);
        } else crossed = from < exit && to >= exit;
        if (!crossed) continue;
      } else if (state && !t.conditions.length) continue;
      if (
        t.conditions.every((c) => {
          const value = this.parameters.value(String(c.parameter));
          switch (c.mode) {
            case Condition.If:
              return value === true;
            case Condition.IfNot:
              return value === false;
            case Condition.Greater:
              return typeof value === 'number' && value > c.threshold;
            case Condition.Less:
              return typeof value === 'number' && value < c.threshold;
            case Condition.Equals:
              return value === c.threshold;
            case Condition.NotEqual:
              return value !== c.threshold;
          }
        })
      )
        return t;
    }
    return undefined;
  }
  private speed(s: State): number {
    return (
      Math.abs(s.source.speed) *
      (s.source.speedParameter ? this.parameters.getFloat(String(s.source.speedParameter)) : 1)
    );
  }
  private advance(s: State, delta: number): void {
    s.time = Math.fround(
      s.time + Math.fround(Math.fround(delta * this.speed(s)) / (s.clip?.durationSeconds || 1)),
    );
  }
  private phase(s: State): number {
    let phase = s.source.timeParameter
      ? this.parameters.getFloat(String(s.source.timeParameter))
      : s.time;
    if (s.source.speed < 0 && !s.source.timeParameter) phase = 1 - phase;
    if (s.clip?.loop) {
      const offset = s.source.cycleOffsetParameter
        ? clamp(this.parameters.getFloat(String(s.source.cycleOffsetParameter)))
        : s.source.cycleOffset;
      phase = Math.fround(phase + offset);
      if (!(s.source.speed < 0 && phase === 1)) phase -= Math.floor(phase);
    } else phase = clamp(phase);
    return Math.fround(phase * (s.clip?.durationSeconds ?? 0));
  }
  private sample(s: State, layer: Layer): AnimationPose {
    const pose = new Map(s.held);
    if (s.source.writeDefaultValues)
      for (const [key, b] of layer.defaults) pose.set(key, poseValue(b, b.baseline));
    const seconds = this.phase(s);
    for (const b of s.bindings) pose.set(b.key, poseValue(b, b.evaluate(seconds)));
    return pose;
  }
  private reference(s: State, layer: Layer): AnimationPose {
    if (s.source.writeDefaultValues) {
      for (const [key, binding] of layer.defaults)
        if (!s.reference.has(key)) s.reference.set(key, poseValue(binding, binding.baseline));
    } else {
      for (const [key, value] of s.held)
        if (!s.reference.has(key))
          s.reference.set(key, poseValue(value.binding, value.binding.baseline));
    }
    return s.reference;
  }
  private eventPhase(s: State): number {
    const offset = s.clip?.loop
      ? s.source.cycleOffsetParameter
        ? clamp(this.parameters.getFloat(String(s.source.cycleOffsetParameter)))
        : s.source.cycleOffset
      : 0;
    let time = s.source.timeParameter
      ? this.parameters.getFloat(String(s.source.timeParameter))
      : s.time;
    if (s.source.speed < 0 && !s.source.timeParameter) time = 1 - time;
    return Math.fround(time + offset);
  }
  private events(s: State): boolean {
    if (!s.clip) return true;
    const to = this.eventPhase(s),
      from = s.eventTime;
    s.eventTime = to;
    let live = true;
    visitAnimationEvents(s.clip.events, s.clip.durationSeconds, s.clip.loop, from, to, (event) => {
      if (s.source.speed < 0 && from < to && event.timeSeconds === 0 && to === 1) return true;
      this.previousEvents.push({ clip: s.clip!, event });
      live = this.event(s.clip!, event);
      return live;
    });
    return live;
  }
  private begin(
    layer: Layer,
    t: R<AnimatorTransitionT>,
    source: State,
    interrupted: boolean,
  ): void {
    this.consume(t);
    if (t.isExit) {
      this.enter(layer, this.entry(layer));
      return;
    }
    const target = layer.source.states.find((s) => s.id === t.destinationStateId)!;
    const next = this.state(target, layer.pose);
    next.time = t.offset;
    next.eventTime = this.eventPhase(next) - Number.EPSILON;
    const duration = t.fixedDuration
      ? t.duration
      : (t.duration * (source.clip?.durationSeconds ?? 0)) /
        Math.max(1e-20, Math.abs(this.speed(source)));
    if (duration <= 0) {
      layer.current = next;
      layer.transition = undefined;
      return;
    }
    layer.transition = {
      source: t,
      next,
      duration,
      elapsed: 0,
      frozen: interrupted ? new Map(layer.pose) : undefined,
      frozenReference: interrupted ? new Map(layer.reference) : undefined,
    };
  }
  flushEvents(): boolean {
    const revision = this.revision;
    for (const layer of this.layers) {
      if (layer.current && !this.events(layer.current)) return false;
      if (layer.transition && layer.transition.elapsed > 0 && !this.events(layer.transition.next))
        return false;
      if (this.revision !== revision) return false;
    }
    return true;
  }
  evaluate(delta: number, events = true): boolean {
    if (!this.visible && this.source.cullingMode === 2) return true;
    const revision = this.revision;
    const eventStates: State[] = [];
    this.previousEvents.length = 0;
    this.resumePhysicsEvents = false;
    this.consumed.clear();
    for (const layer of this.layers) {
      const current = layer.current;
      if (!current) continue;
      const from = current.time,
        transition = layer.transition;
      if (!transition?.frozen) this.advance(current, delta);
      if (transition) {
        this.advance(transition.next, delta);
        transition.elapsed = Math.fround(
          transition.elapsed + Math.fround(delta / transition.duration),
        );
      }
      let chosen = this.select(
          layer.source.anyStateTransitions,
          current,
          from,
          current.time,
          true,
          transition?.source.orderedInterruption ? transition.source : undefined,
        ),
        origin = current;
      if (!chosen) {
        if (!transition)
          chosen = this.select(current.source.transitions, current, from, current.time, false);
        else {
          const mode = transition.source.interruption;
          const sources =
            mode === Interruption.Source
              ? [current]
              : mode === Interruption.Destination
                ? [transition.next]
                : mode === Interruption.SourceThenDestination
                  ? [current, transition.next]
                  : mode === Interruption.DestinationThenSource
                    ? [transition.next, current]
                    : [];
          for (const s of sources) {
            chosen = this.select(
              s.source.transitions,
              s,
              s === current ? from : s.time - delta,
              s.time,
              false,
              transition.source.orderedInterruption ? transition.source : undefined,
            );
            if (
              !chosen &&
              transition.source.orderedInterruption &&
              s.source.transitions.includes(transition.source)
            )
              break;
            if (chosen) {
              origin = s;
              break;
            }
          }
        }
      }
      if (chosen) {
        this.begin(layer, chosen, origin, !!transition);
        if (chosen.hasExitTime) {
          const exit = chosen.exitTime === 0 ? 1 : chosen.exitTime;
          let boundary = exit < 1 ? Math.floor(from) + exit : exit;
          if (exit < 1 && boundary <= from) boundary++;
          const seconds =
            (Math.max(0, origin.time - boundary) * (origin.clip?.durationSeconds || 1)) /
            Math.max(1e-20, Math.abs(this.speed(origin)));
          const destination = layer.transition?.next ?? layer.current;
          if (destination && destination !== origin) this.advance(destination, seconds);
          if (layer.transition)
            layer.transition.elapsed = Math.fround(seconds / layer.transition.duration);
        }
      } else if (transition && transition.elapsed >= 1) {
        layer.current = transition.next;
        layer.transition = undefined;
      }
      const active = layer.current;
      if (!active) continue;
      const blend = layer.transition;
      layer.pose = blend
        ? mixPoses(
            blend.frozen ?? this.sample(active, layer),
            this.sample(blend.next, layer),
            clamp(blend.elapsed),
          )
        : chosen && !active.clip
          ? this.sample(origin, layer)
          : this.sample(active, layer);
      layer.reference = blend
        ? mixPoses(
            blend.frozenReference ?? this.reference(active, layer),
            this.reference(blend.next, layer),
            clamp(blend.elapsed),
          )
        : this.reference(active, layer);
      if (events) {
        eventStates.push(active);
        if (blend && blend.elapsed > 0) eventStates.push(blend.next);
      }
    }
    for (const p of this.consumed) this.parameters.resetTrigger(p);
    this.compose();
    for (const state of eventStates)
      if (!this.events(state) || this.revision !== revision) return false;
    return this.revision === revision;
  }
  private compose(): void {
    let pose: AnimationPose = new Map();
    for (const [index, layer] of this.layers.entries()) {
      if (!layer.current) continue;
      const weight = index === 0 ? 1 : layer.weight;
      if (weight <= 0) continue;
      if (index === 0)
        pose = new Map(layer.pose.size ? layer.pose : this.sample(layer.current, layer));
      else if (layer.source.blend === 1) pose = addPose(pose, layer.pose, layer.reference, weight);
      else pose = mixPoses(pose, layer.pose, weight);
    }
    this.pose = pose;
  }
  apply(): void {
    if (!this.visible && this.source.cullingMode !== 0) return;
    writePose(this.pose);
  }
}
