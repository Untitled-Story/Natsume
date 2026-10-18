import type { DeepReadonly as R } from '../../pack.js';
import type { NoiseModuleT } from '../../format/generated/noa/ir/noise-module.js';
import { scalar } from '../../runtime/parameters.js';
import { CurlNoiseField } from './curl-field.js';

/** Evaluates Unity Noise parameters over a calibrated, seeded curl field. */
export class ParticleNoise {
  readonly field: CurlNoiseField;
  private readonly fields: CurlNoiseField[];
  private readonly weights: Float64Array;
  private readonly sampleValue = new Float64Array(3);
  private readonly frequency: number;
  private scroll = 0;
  constructor(
    readonly settings: R<NoiseModuleT>,
    seed: number,
  ) {
    this.frequency = Math.max(1e-4, settings.frequency);
    // Native quality levels change amplitude and correlation length, but all
    // three position axes still affect the field. Fitted to spatial statistics.
    const coordinateScale = settings.quality === 0 ? 0.86 : settings.quality === 1 ? 0.96 : 1.02;
    const amplitude =
      0.9816303202717301 * (settings.quality === 0 ? 1.87 : settings.quality === 1 ? 1.26 : 1);
    this.fields = Array.from(
      { length: settings.octaves },
      (_, i) =>
        new CurlNoiseField(
          seed,
          this.frequency * settings.octaveScale ** i,
          coordinateScale,
          amplitude,
        ),
    );
    this.weights = Float64Array.from(this.fields, (_, i) => settings.octaveMultiplier ** i);
    const sum = this.weights.reduce((total, weight) => total + weight, 0);
    for (let i = 0; i < this.weights.length; i++) this.weights[i] = this.weights[i]! / sum;
    this.field = this.fields[0]!;
  }
  reset(): void {
    this.scroll = 0;
  }
  advance(dt: number, phase: number): void {
    this.scroll += scalar(this.settings.scrollSpeed, phase) * dt;
  }
  sample(
    x: number,
    y: number,
    z: number,
    age: number,
    random: (channel: number) => number,
    out: Float64Array,
  ): void {
    const n = this.settings;
    out.fill(0);
    for (let octave = 0; octave < this.fields.length; octave++) {
      this.fields[octave]!.sample(x, y, z + this.scroll, this.sampleValue);
      // Normalize potential weights; each field already includes its spatial
      // derivative frequency, which must survive the octave sum.
      const weight = this.weights[octave]!;
      for (let axis = 0; axis < 3; axis++)
        out[axis] = out[axis]! + this.sampleValue[axis]! * weight;
    }
    const commonStrength = scalar(n.strength?.x, age, random(32));
    for (let axis = 0; axis < 3; axis++) {
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
      const raw = out[axis]!;
      const value = n.remapEnabled
        ? 2 *
          scalar(
            n.remap?.[n.separateAxes ? key : 'x'],
            Math.max(0, Math.min(1, (raw / this.frequency) * 0.5 + 0.5)),
            random(80 + axis),
          ) *
          (n.damping ? 1 : this.frequency)
        : raw * (n.damping ? 1 / this.frequency : 1);
      out[axis] =
        value *
        (n.separateAxes ? scalar(n.strength?.[key], age, random(32 + axis)) : commonStrength);
    }
  }
}
