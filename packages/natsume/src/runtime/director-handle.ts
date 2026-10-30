import type { TimelineDirector } from './timeline-director.js';

/** Identifies a source binding without losing signed 64-bit file IDs. */
export type DirectorBindingKey =
  | { readonly guid: string; readonly fileId: bigint; readonly exposedName?: never }
  | { readonly exposedName: string; readonly guid?: never; readonly fileId?: never };
/** A binding target belonging to this effect; null clears the binding. */
export type DirectorBindingTarget =
  | { readonly nodeId: number; readonly componentId?: never }
  | { readonly componentId: number; readonly nodeId?: never }
  | null;

/** Instance-owned PlayableDirector. Times are double-precision seconds. */
export class NatsumeDirector {
  constructor(
    private readonly director: TimelineDirector,
    private readonly assertAlive: () => void,
    private readonly refresh: () => void,
  ) {}
  get state(): 'playing' | 'paused' | 'stopped' {
    this.assertAlive();
    return this.director.state;
  }
  get duration(): number {
    this.assertAlive();
    return this.director.duration;
  }
  play(): void {
    this.assertAlive();
    this.director.play();
    this.refresh();
  }
  pause(): void {
    this.assertAlive();
    this.director.pause();
    this.refresh();
  }
  /** Stops playback and resets time; post-playback restoration runs at the next update boundary. */
  stop(): void {
    this.assertAlive();
    this.director.stop();
    this.refresh();
  }
  getTime(): number {
    this.assertAlive();
    return this.director.time;
  }
  /** Changes time without sampling. Call evaluate to apply a manual seek immediately. */
  setTime(seconds: number): void {
    this.assertAlive();
    this.director.setTime(seconds);
  }
  /** Samples the graph at its current time, including activation and controlled systems. */
  evaluate(): void {
    this.assertAlive();
    this.director.evaluate();
    this.refresh();
  }
  /** Rebinds a source track within this instance and rebuilds its playback graph. */
  setBinding(key: DirectorBindingKey, target: DirectorBindingTarget): void {
    this.assertAlive();
    this.director.setBinding(key, target);
    this.refresh();
  }
}
