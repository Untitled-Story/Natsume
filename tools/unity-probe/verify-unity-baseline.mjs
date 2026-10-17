import assert from 'node:assert/strict';

// These checks validate the probe, not a Natsume implementation of Unity Noise.
export function verifyUnityBaseline(data) {
  assert.equal(data.unityVersion, '2022.3.21f1');
  assert.equal(data.step, Math.fround(1 / 60));
  const curve = (label) => {
    const result = data.curves.find((item) => item.label === label);
    assert(result, `Missing curve ${label}`);
    return result;
  };
  const noise = (label) => {
    const result = data.noise.find((item) => item.label === label);
    assert(result, `Missing Noise case ${label}`);
    return result;
  };
  const clamp = curve('raw-2');
  assert.equal(clamp.serializedPre, 2);
  assert.equal(clamp.serializedPost, 2);
  assert.equal(clamp.publicPre, 8);
  assert.equal(clamp.publicPost, 8);
  for (const { time, value } of clamp.samples) {
    assert.equal(value, 2 + 4 * Math.max(0, Math.min(1, time)));
  }
  assert.deepEqual(clamp.samples, curve('public-8').samples);
  assert.equal(curve('public-2').serializedPre, 1);
  assert.equal(curve('public-2').serializedPost, 1);
  assert.deepEqual(noise('base').samples, noise('base-repeat').samples);
  assert.deepEqual(noise('kirakira').samples, noise('kirakira-repeat').samples);
  assert.deepEqual(noise('disabled').samples, noise('strength-zero').samples);
  assert.deepEqual(noise('damping-off').samples, noise('position-half').samples);
  const seedSet = new Set([1000, 1001, 1002]);
  for (const entry of data.noise) {
    assert.equal(entry.samples.length, 39, entry.label);
    for (const sample of entry.samples) {
      assert(seedSet.has(sample.seed));
      for (const vector of ['position', 'velocity', 'rotation', 'size']) {
        for (const axis of ['x', 'y', 'z']) assert(Number.isFinite(sample[vector][axis]));
      }
    }
  }
  for (const sample of noise('disabled').samples) {
    assert.deepEqual(sample.position, data.origins[sample.seed - data.firstParticleSeed]);
  }
  return {
    unityVersion: data.unityVersion,
    curveCases: data.curves.length,
    noiseCases: data.noise.length,
    noiseSamples: data.noise.reduce((sum, entry) => sum + entry.samples.length, 0),
    serializedInfinity2: 'clamp',
    deterministicNoise: true,
    noiseImplementationVerified: false,
  };
}
