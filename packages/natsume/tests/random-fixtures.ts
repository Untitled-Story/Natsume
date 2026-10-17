import { constant, particleSource } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { CircleShapeT } from '../src/format/generated/noa/ir/circle-shape.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ShapeGeometry } from '../src/format/generated/noa/ir/shape-geometry.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { ScalarMode } from '../src/format/generated/noa/ir/scalar-mode.js';
import { ColorMode } from '../src/format/generated/noa/ir/color-mode.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { SizeModuleT } from '../src/format/generated/noa/ir/size-module.js';
import { VectorParameterT } from '../src/format/generated/noa/ir/vector-parameter.js';
import { VelocityModuleT } from '../src/format/generated/noa/ir/velocity-module.js';

export const randomCount = 16384;
export const range = (min: number, max: number) => {
  const p = constant(max);
  p.mode = ScalarMode.TwoConstants;
  p.constantMin = min;
  return p;
};
export function randomSource(seed: number, thickness: number, arc: number) {
  const source = particleSource(),
    main = source.main!;
  main.maxParticles = randomCount;
  main.seed = seed;
  main.lifetime = range(2, 4);
  main.speed = range(1, 3);
  main.size = new VectorParameterT(range(1, 3), range(2, 6), range(3, 9));
  main.size3d = true;
  main.rotation = new VectorParameterT(range(0, 1), range(0, 1), range(0, 1));
  main.rotation3d = true;
  main.color = new ColorParameterT();
  main.color.mode = ColorMode.TwoColors;
  main.color.colorMin = new ColorT(0, 0, 0, 0);
  main.color.colorMax = new ColorT(1, 1, 1, 1);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(null, null, [new BurstT(0, constant(randomCount))]),
    ),
    new ParticleModuleT(
      M.ShapeModule,
      new ShapeModuleT(
        ShapeGeometry.CircleShape,
        new CircleShapeT(constant(2), arc, thickness),
        new TransformT(new Vec3T(), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
      ),
    ),
    new ParticleModuleT(
      M.SizeModule,
      new SizeModuleT(new VectorParameterT(range(1, 2), range(2, 4), range(3, 6)), true),
    ),
    new ParticleModuleT(
      M.VelocityModule,
      new VelocityModuleT(new VectorParameterT(range(1, 2), range(2, 4), range(3, 6))),
    ),
  );
  return source;
}
