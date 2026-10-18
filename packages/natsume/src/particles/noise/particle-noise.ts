import type { DeepReadonly as R } from '../../pack.js';
import type { NoiseModuleT } from '../../format/generated/noa/ir/noise-module.js';
import { scalar } from '../../runtime/parameters.js';
import { CurlNoiseField } from './curl-field.js';

/** Evaluates Unity Noise parameters over a calibrated, seeded curl field. */
export class ParticleNoise {
  readonly field: CurlNoiseField;
  private readonly fields: CurlNoiseField[];
  private readonly sampleValue = new Float64Array(3);
  private readonly frequency: number;
  private scroll = 0;
  constructor(
    readonly settings: R<NoiseModuleT>,
    seed: number,
  ) {
    this.frequency = Math.max(1e-4, settings.frequency);
    this.fields = Array.from(
      { length: settings.octaves },
      (_, i) => new CurlNoiseField(seed, this.frequency * settings.octaveScale ** i),
    );
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
      this.fields[octave]!.sample(
        x,
        n.quality === 0 ? 0 : y,
        (n.quality < 2 ? 0 : z) + this.scroll / this.frequency,
        this.sampleValue,
      );
      const weight = n.octaveMultiplier ** octave / Math.max(1e-6, n.octaveScale ** octave);
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
