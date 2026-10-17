import { MainModuleT } from '../src/format/generated/noa/ir/main-module.js';
import { ParticleSystemT } from '../src/format/generated/noa/ir/particle-system.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { ScalarParameterT } from '../src/format/generated/noa/ir/scalar-parameter.js';
import { ScalarMode } from '../src/format/generated/noa/ir/scalar-mode.js';
import { VectorParameterT } from '../src/format/generated/noa/ir/vector-parameter.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';
import { LimitVelocityModuleT } from '../src/format/generated/noa/ir/limit-velocity-module.js';
import { ScalingMode } from '../src/format/generated/noa/ir/scaling-mode.js';
import { SizeModuleT } from '../src/format/generated/noa/ir/size-module.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { Interpolation } from '../src/format/generated/noa/ir/interpolation.js';
import { CurveDomain } from '../src/format/generated/noa/ir/curve-domain.js';
import { ColorModuleT } from '../src/format/generated/noa/ir/color-module.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorMode } from '../src/format/generated/noa/ir/color-mode.js';
import { GradientT } from '../src/format/generated/noa/ir/gradient.js';
import { GradientMode } from '../src/format/generated/noa/ir/gradient-mode.js';
import { RgbKeyT } from '../src/format/generated/noa/ir/rgb-key.js';
import { AlphaKeyT } from '../src/format/generated/noa/ir/alpha-key.js';
import type { Emitter } from '../src/runtime/emitter.js';

export const constant = (value: number) => new ScalarParameterT(ScalarMode.Constant, value, value);
export const vector = (x = 0, y = 0, z = 0) =>
  new VectorParameterT(constant(x), constant(y), constant(z));
export function linear(from: number, to: number) {
  const curve = new ScalarCurveT();
  curve.domain = CurveDomain.Normalized;
  const a = new FloatKeyT(),
    b = new FloatKeyT();
  a.value = from;
  a.interpolation = Interpolation.Linear;
  b.time = 1;
  b.value = to;
  curve.keys = [a, b];
  const parameter = new ScalarParameterT();
  parameter.mode = ScalarMode.Curve;
  parameter.curveMax = curve;
  return parameter;
}
export function particleSource(label = '') {
  const main = new MainModuleT();
  main.scaling = ScalingMode.Local;
  main.lifetime = constant(2);
  main.speed = constant(0);
  main.size = vector(1, 1, 1);
  main.rotation = vector();
  main.maxParticles = 64;
  const source = new ParticleSystemT(main);
  if (label.startsWith('motion-')) {
    const orbital = /multiplier|orbital|combined/.test(label) ? vector(1, 0.5, 0) : vector();
    const line =
      /linear|combined/.test(label) || label === 'motion-multiplier' ? vector(1, 2, 3) : vector();
    const radial =
      label === 'motion-radial'
        ? 1
        : /combined/.test(label) || label === 'motion-multiplier'
          ? 0.4
          : 0;
    const multiplier = /multiplier|combined/.test(label) ? 2 : 1;
    source.modules.push(
      new ParticleModuleT(
        M.VelocityModule,
        new VelocityModuleT(line, orbital, vector(), constant(radial), constant(multiplier)),
      ),
    );
    if (/limit/.test(label)) {
      const limit = new LimitVelocityModuleT();
      limit.limit = vector(0.12);
      limit.dampen = 0.26;
      source.modules.push(new ParticleModuleT(M.LimitVelocityModule, limit));
    }
  }
  if (label.startsWith('appearance-')) {
    const size = vector();
    size.x = linear(0.5, 2);
    size.y = linear(2, 0.5);
    size.z = constant(1);
    source.modules.push(new ParticleModuleT(M.SizeModule, new SizeModuleT(size, true)));
    const gradient = new GradientT(
      label.endsWith('fixed') ? GradientMode.Fixed : GradientMode.Blend,
      [new RgbKeyT(0, 1, 0, 0), new RgbKeyT(0.5, 0, 1, 0), new RgbKeyT(1, 0, 0, 1)],
      [new AlphaKeyT(0, 0), new AlphaKeyT(0.5, 1), new AlphaKeyT(1, 0)],
    );
    const color = new ColorParameterT();
    color.mode = ColorMode.Gradient;
    color.gradientMax = gradient;
    source.modules.push(new ParticleModuleT(M.ColorModule, new ColorModuleT(color)));
  }
  return source;
}
export function manualParticle(emitter: Emitter) {
  emitter.sync();
  emitter.emitting = false;
  emitter.count = 1;
  emitter.positions.set([1, 0.5, 0.2]);
  emitter.velocities.set([2, 0, 0]);
  emitter.lifetimes[0] = 1;
  emitter.ages[0] = 0;
  emitter.startSizes.set([2, 3, 4]);
  emitter.rotations.set([20, 35, 55].map((value) => (value * Math.PI) / 180));
  emitter.startColors.set([0.8, 0.6, 0.4, 128 / 255]);
}
