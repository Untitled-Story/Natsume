import { expect, it } from 'vitest';
import { PerlinCurlNoiseField } from '../src/particles/noise/perlin-curl-field.js';

// Unity 2022.3.21f1, strength/frequency 1, dt 0.002; held-out seeds and positions.
const native = [
  {
    quality: 1,
    seed: 212121,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-2.394556885471194, 0.1533031390807963, 0.8406638699827181],
  },
  {
    quality: 1,
    seed: 95959,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-1.0396837694348096, -1.5171765560507733, 0.9715556636924494],
  },
  {
    quality: 1,
    seed: 7654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-0.7800459491253426, 0.1379251414591612, 0.6809234295719351],
  },
  {
    quality: 1,
    seed: 987654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-1.3905762965610333, -1.6235112372794438, 1.1107921072743856],
  },
  {
    quality: 2,
    seed: 212121,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [0.16486643961799477, -0.9199380437686665, -0.9126662774514592],
  },
  {
    quality: 2,
    seed: 95959,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [0.2562999603605848, -1.7987488845957507, 0.09965896133090646],
  },
  {
    quality: 2,
    seed: 7654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-1.5785097326114808, 0.8046626662483476, -1.928329376182707],
  },
  {
    quality: 2,
    seed: 987654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-0.9815692435390955, -1.53243534438852, 0.2017021083395858],
  },
] as const;

for (const { quality, seed, point, expected } of native)
  it(`matches native quality ${quality} for seed ${seed}`, () => {
    const out = new Float64Array(3);
    new PerlinCurlNoiseField(seed, 1, quality).sample(...point, out);
    for (let axis = 0; axis < 3; axis++)
      expect(Math.abs(out[axis]! - expected[axis]!)).toBeLessThan(3e-4);
  });

// Unity dt=0.02, strength=0.5, step 12; an independent seed and signed scroll speeds.
const scrolling = [
  {
    quality: 1,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: -0.11999999731779099,
    point: [1.1312161684036255, -1.4813323020935059, -1.5418864488601685],
    expected: [-0.7193207901564417, -0.7046342053555147, -0.11583566924562311],
  },
  {
    quality: 1,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: 0.23999999463558197,
    point: [1.1332015991210938, -1.4860597848892212, -1.5447959899902344],
    expected: [-0.6828069839508902, -0.7868647751256401, -0.16545057666563787],
  },
  {
    quality: 1,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: 0.47999998927116394,
    point: [1.1362124681472778, -1.4868985414505005, -1.5465521812438965],
    expected: [-0.6133556503062468, -0.7740497762124935, -0.1931786580349205],
  },
  {
    quality: 2,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: -0.11999999731779099,
    point: [1.2530689239501953, -1.369214653968811, -1.5470517873764038],
    expected: [0.38930178558755935, 0.2973675794311072, -0.21330118656086594],
  },
  {
    quality: 2,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: 0.23999999463558197,
    point: [1.2454842329025269, -1.3726751804351807, -1.5387096405029297],
    expected: [0.24842024404749818, 0.23688078456105555, -0.059187413584904675],
  },
  {
    quality: 2,
    seed: 17320,
    frequency: 0.2800000011920929,
    scroll: 0.47999998927116394,
    point: [1.2399003505706787, -1.3750687837600708, -1.532810926437378],
    expected: [0.14129877406281474, 0.19578934153443595, 0.04967451206612242],
  },
] as const;

for (const { quality, seed, frequency, scroll, point, expected } of scrolling)
  it(`matches native quality ${quality} at scroll ${scroll}`, () => {
    const out = new Float64Array(3);
    new PerlinCurlNoiseField(seed, frequency, quality).sample(
      point[0],
      point[1],
      point[2],
      out,
      0,
      scroll,
    );
    for (let axis = 0; axis < 3; axis++)
      expect(Math.abs(out[axis]! - expected[axis]!)).toBeLessThan(2e-5);
  });
