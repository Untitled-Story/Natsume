import { check } from './errors.js';

/**
 * Splits host frame time into fixed physics steps for effect.update({ physicsSteps }).
 * Steps beyond maxStepsPerFrame are discarded so a long stall does not cause a catch-up spiral.
 */
export class FixedStepClock {
  private accumulated = 0;

  constructor(
    readonly stepSeconds = 0.02,
    readonly maxStepsPerFrame = 8,
  ) {
    check(Number.isFinite(stepSeconds) && stepSeconds > 0, 'HOST', 'Step must be positive');
    check(
      Number.isSafeInteger(maxStepsPerFrame) && maxStepsPerFrame > 0,
      'HOST',
      'maxStepsPerFrame must be a positive integer',
    );
  }

  /** Returns the whole steps completed by this frame; the remainder carries to the next call. */
  advance(deltaSeconds: number): number[] {
    check(Number.isFinite(deltaSeconds) && deltaSeconds >= 0, 'HOST', 'Invalid frame delta');
    this.accumulated += deltaSeconds;
    const whole = Math.floor(this.accumulated / this.stepSeconds);
    const count = Math.min(this.maxStepsPerFrame, whole);
    this.accumulated = whole > count ? 0 : this.accumulated - count * this.stepSeconds;
    return Array<number>(count).fill(this.stepSeconds);
  }

  reset(): void {
    this.accumulated = 0;
  }
}
