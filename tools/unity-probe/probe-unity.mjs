import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUnityBaseline } from './verify-unity-baseline.mjs';
import { sharedOrderFixture } from './shared-order-fixture.mjs';

// Preserve existing fixture bytes when a fresh native run is numerically identical.
async function saveJson(path, contents) {
  try {
    const previous = await readFile(path, 'utf8');
    if (JSON.stringify(JSON.parse(previous)) === JSON.stringify(JSON.parse(contents))) return;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

const tool = dirname(fileURLToPath(import.meta.url));
const root = resolve(tool, '../..');
const version = '2022.3.21f1';
const controller = process.argv.includes('--animator-controller');
const controllerPlayback = process.argv.includes('--animator-playback');
const subEmitters = process.argv.includes('--sub-emitters');
const sharedSubEmitters = process.argv.includes('--shared');
const sharedSingle = process.argv.includes('--single');
const caseArgument = process.argv.indexOf('--case');
const sharedCase = caseArgument < 0 ? undefined : Number(process.argv[caseArgument + 1]);
assert(
  caseArgument < 0 ||
    (sharedSubEmitters &&
      !sharedSingle &&
      Number.isInteger(sharedCase) &&
      sharedCase >= 0 &&
      sharedCase < 72),
  '--case requires --shared and an integer from 0 to 71',
);
const workerArgument = process.argv.indexOf('--job-workers');
const jobWorkers = workerArgument < 0 ? undefined : Number(process.argv[workerArgument + 1]);
assert(
  workerArgument < 0 || (Number.isInteger(jobWorkers) && jobWorkers >= 0 && jobWorkers <= 128),
  '--job-workers requires an integer from 0 to 128',
);
assert(!sharedSingle || sharedSubEmitters, '--single requires --shared');
assert(
  !sharedSingle || !process.argv.includes('--update-fixtures'),
  'A single shared case must not replace the complete fixture',
);
assert(
  !sharedSubEmitters || !process.argv.includes('--update-fixtures') || jobWorkers === 0,
  'Shared golden data requires --job-workers 0',
);
const traceOrder = process.argv.includes('--trace-order');
assert(
  !traceOrder ||
    (sharedSubEmitters &&
      jobWorkers === 0 &&
      !sharedSingle &&
      sharedCase === undefined &&
      process.platform === 'darwin' &&
      process.arch === 'arm64'),
  '--trace-order requires macOS arm64, --shared --job-workers 0, and all cases',
);
const playback = process.argv.includes('--playback') || sharedSubEmitters;
const subTransforms = process.argv.includes('--transforms');
assert(
  !subTransforms || (subEmitters && !playback),
  '--transforms requires --sub-emitters without --playback',
);
assert(!playback || subEmitters, '--playback requires --sub-emitters');
const trails = process.argv.includes('--trails');
const spriteMasks = process.argv.includes('--sprite-masks');
const uiMasks = process.argv.includes('--ui-masks');
const images = process.argv.includes('--images');
const canvas = process.argv.includes('--canvas');
const spriteSheets = process.argv.includes('--sprite-sheets');
const spriteRendering = process.argv.includes('--sprite-rendering');
const spriteShapes = process.argv.includes('--sprite-shapes');
const sceneMaterials = process.argv.includes('--scene-materials');
const events = process.argv.includes('--events');
const particleModules = process.argv.includes('--particle-modules');
const externalForces = process.argv.includes('--external-forces');
const particleCollisions = process.argv.includes('--particle-collisions');
const colliderForcePlayback = process.argv.includes('--collider-force');
const particleLights = process.argv.includes('--particle-lights');
const lightDistribution = process.argv.includes('--light-distribution');
const particleTriggers = process.argv.includes('--particle-triggers');
const ringBuffer = process.argv.includes('--ring-buffer');
const ringPlayback = process.argv.includes('--ring-playback');
const particleClockPlayback = process.argv.includes('--particle-clocks');
const particleMainPlayback = process.argv.includes('--particle-main');
const particleCullingPlayback = process.argv.includes('--particle-culling');
const cullingRealtime = particleCullingPlayback && process.argv.includes('--realtime');
const cullingValidation = cullingRealtime && process.argv.includes('--validation');
const shapeTextures = process.argv.includes('--shape-textures');
const cameras = process.argv.includes('--cameras');
const uvFlips = process.argv.includes('--uv-flips');
const rendererShapes = process.argv.includes('--renderer-shapes');
const meshShapes = process.argv.includes('--mesh-shapes');
const particleProbe = uvFlips
  ? ['uv-flips', 'NatsumeUVFlipProbe.Run']
  : cameras
    ? ['cameras', 'NatsumeCameraProbe.Run']
    : shapeTextures
      ? ['shape-textures', 'NatsumeShapeTextureProbe.Run']
      : rendererShapes
        ? ['renderer-shapes', 'NatsumeRendererShapeProbe.Run']
        : meshShapes
          ? ['mesh-shapes', 'NatsumeMeshShapeProbe.Run']
          : particleModules
            ? ['particle-modules', 'NatsumeParticleModulesProbe.Run']
            : externalForces
              ? ['external-forces', 'NatsumeExternalForcesProbe.Run']
              : particleCollisions
                ? ['particle-collisions', 'NatsumeParticleCollisionProbe.Run']
                : colliderForcePlayback
                  ? ['collider-force', 'NatsumeParticleForcePlaybackProbe.Run']
                  : particleTriggers
                    ? ['particle-triggers', 'NatsumeParticleTriggerPlaybackProbe.Run']
                    : particleLights
                      ? ['particle-lights', 'NatsumeParticleLightsProbe.Run']
                      : lightDistribution
                        ? ['light-distribution', 'NatsumeParticleLightDistributionProbe.Run']
                        : ringBuffer
                          ? ['ring-buffer', 'NatsumeParticleRingBufferProbe.Run']
                          : ringPlayback
                            ? ['ring-playback', 'NatsumeParticleRingPlaybackProbe.Run']
                            : particleClockPlayback
                              ? ['particle-clocks', 'NatsumeParticleClockPlaybackProbe.Run']
                              : particleMainPlayback
                                ? ['particle-main', 'NatsumeParticleMainPlaybackProbe.Run']
                                : particleCullingPlayback
                                  ? [
                                      cullingValidation
                                        ? 'particle-culling-validation'
                                        : cullingRealtime
                                          ? 'particle-culling-realtime'
                                          : 'particle-culling',
                                      'NatsumeParticleCullingPlaybackProbe.Run',
                                    ]
                                  : undefined;
const bySpeed = process.argv.includes('--by-speed') || !!particleProbe;
assert(
  [
    particleModules,
    externalForces,
    particleCollisions,
    colliderForcePlayback,
    particleTriggers,
    particleLights,
    lightDistribution,
    ringBuffer,
    ringPlayback,
    particleClockPlayback,
    particleMainPlayback,
    particleCullingPlayback,
    meshShapes,
    rendererShapes,
    shapeTextures,
    cameras,
    uvFlips,
    process.argv.includes('--by-speed'),
  ].filter(Boolean).length <= 1,
  'Choose one probe mode',
);
assert(
  !(externalForces && (particleModules || process.argv.includes('--by-speed'))),
  'Choose one probe mode',
);
assert(!particleModules || !process.argv.includes('--by-speed'), 'Choose one probe mode');
const bindings = process.argv.includes('--animation-bindings');
const animation = process.argv.includes('--animation');
const meshes = process.argv.includes('--meshes');
const compatibility = process.argv.includes('--compatibility');
const fitting = process.argv.includes('--noise-fit');
const layout = process.argv.includes('--prefab-layout');
const boundaries = process.argv.includes('--boundaries');
const distributions = process.argv.includes('--random');
const shape = process.argv.includes('--shape');
const basicShapes = process.argv.includes('--basic-shapes');
const rotationPrewarm = process.argv.includes('--rotation-prewarm');
const sorting = process.argv.includes('--sorting');
const spaces = process.argv.includes('--spaces');
const sweeps = process.argv.includes('--sweeps');
const noiseOptions = process.argv.includes('--noise-options');
const noiseStatistics = process.argv.includes('--noise-statistics');
const customData = process.argv.includes('--custom-data');
const stretch = process.argv.includes('--stretch');
const rectLayout = process.argv.includes('--rect-layout');
assert(
  Number(controller) +
    Number(controllerPlayback) +
    Number(subEmitters) +
    Number(trails) +
    Number(spriteMasks) +
    Number(uiMasks) +
    Number(images) +
    Number(canvas) +
    Number(spriteSheets) +
    Number(spriteRendering) +
    Number(spriteShapes) +
    Number(sceneMaterials) +
    Number(events) +
    Number(bySpeed) +
    Number(bindings) +
    Number(animation) +
    Number(meshes) +
    Number(compatibility) +
    Number(fitting) +
    Number(layout) +
    Number(boundaries) +
    Number(distributions) +
    Number(shape) +
    Number(basicShapes) +
    Number(rotationPrewarm) +
    Number(sorting) +
    Number(spaces) +
    Number(sweeps) +
    Number(noiseOptions) +
    Number(rectLayout) +
    Number(stretch) +
    Number(noiseStatistics) +
    Number(customData) <=
    1,
  'Choose one probe mode',
);
if (noiseStatistics && process.env.NATSUME_NOISE_STATISTICS_INPUT)
  assert(
    !process.argv.includes('--update-fixtures'),
    'Custom statistics must not replace default fixtures',
  );
const editor = process.env.UNITY_EDITOR;
assert(editor, 'Set UNITY_EDITOR to the Unity executable inside Unity.app/Contents/MacOS/Unity');
const project = resolve(root, 'data/unity-probe');
const output = resolve(
  root,
  'data/unity-baselines',
  controller
    ? 'animator-controller'
    : controllerPlayback
      ? 'animator-playback'
      : subEmitters
        ? subTransforms
          ? 'sub-emitter-transforms'
          : sharedSubEmitters
            ? sharedSingle
              ? 'sub-emitter-shared-single'
              : 'sub-emitter-shared'
            : playback
              ? 'sub-emitter-playback'
              : 'sub-emitters'
        : trails
          ? 'trails'
          : spriteMasks
            ? 'sprite-masks'
            : uiMasks
              ? 'ui-masks'
              : images
                ? 'images'
                : canvas
                  ? 'canvas'
                  : spriteSheets
                    ? 'sprite-sheets'
                    : spriteRendering
                      ? 'sprite-rendering'
                      : spriteShapes
                        ? 'sprite-shapes'
                        : sceneMaterials
                          ? 'scene-materials'
                          : events
                            ? 'events'
                            : bySpeed
                              ? (particleProbe?.[0] ?? 'by-speed')
                              : bindings
                                ? 'animation-bindings'
                                : animation
                                  ? 'animation'
                                  : meshes
                                    ? 'meshes'
                                    : compatibility
                                      ? 'compatibility'
                                      : noiseStatistics
                                        ? process.env.NATSUME_NOISE_STATISTICS_INPUT
                                          ? 'noise-statistics-custom'
                                          : 'noise-statistics'
                                        : customData
                                          ? 'custom-data'
                                          : stretch
                                            ? 'stretch'
                                            : rectLayout
                                              ? 'layout'
                                              : noiseOptions
                                                ? 'noise-options'
                                                : sweeps
                                                  ? 'sweeps'
                                                  : spaces
                                                    ? 'spaces'
                                                    : sorting
                                                      ? 'sorting'
                                                      : basicShapes
                                                        ? 'basic-shapes'
                                                        : rotationPrewarm
                                                          ? 'rotation-prewarm'
                                                          : layout
                                                            ? 'prefab-layout'
                                                            : boundaries
                                                              ? 'boundaries'
                                                              : distributions
                                                                ? 'random'
                                                                : shape
                                                                  ? 'shape'
                                                                  : '.',
);
const baseline = resolve(output, fitting ? 'noise-fit-output.json' : `unity-${version}.json`);
await mkdir(output, { recursive: true });
await cp(resolve(tool, 'project'), project, { recursive: true });
// Use the Editor-bundled UI assembly in the ignored probe project; no package download is required.
await cp(
  resolve(dirname(editor), '../Resources/PackageManager/BuiltInPackages/com.unity.ugui/Runtime'),
  resolve(project, 'Assets/UnityUI'),
  { recursive: true },
);

const prefabSource = resolve(
  process.env.NATSUME_PREFAB_SOURCE ?? resolve(root, '../Noa/data/scenario/effect/kirakira_01_rip'),
);
if (layout) {
  await cp(prefabSource, resolve(project, 'Assets/KirakiraLayout'), { recursive: true });
}
let previous;
try {
  previous = JSON.parse(await readFile(baseline, 'utf8'));
  // Preserve the last run and require a fresh file from this editor invocation.
  await rename(baseline, `${baseline}.previous`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (stretch) {
  try {
    await rename(
      resolve(output, 'camera-motion.json'),
      resolve(output, 'camera-motion.json.previous'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const log = resolve(output, 'editor.log');
console.log(`Running Unity ${version}; editor log: ${log}`);
const nativeMap = resolve(output, 'native-map.json');
const nativeTrace = resolve(output, 'native-order.jsonl');
if (traceOrder) {
  await rm(nativeMap, { force: true });
  await rm(nativeTrace, { force: true });
}
function runEditor(command, args, options) {
  if (!traceOrder) return spawn(command, args, options);
  return spawn(
    'xcrun',
    [
      'lldb',
      '-b',
      '-o',
      `target create ${JSON.stringify(command)}`,
      '-o',
      'settings set target.disable-aslr false',
      '-o',
      `command script import ${JSON.stringify(resolve(tool, 'trace_shared_order.py'))}`,
      '-o',
      `run ${args.map((arg) => JSON.stringify(arg)).join(' ')}`,
    ],
    options,
  );
}
const child = runEditor(
  editor,
  [
    '-batchmode',
    '-noUpm',
    ...(jobWorkers === undefined ? [] : ['-job-worker-count', String(jobWorkers)]),
    ...(trails ||
    spriteMasks ||
    uiMasks ||
    images ||
    canvas ||
    spriteSheets ||
    spriteRendering ||
    spriteShapes ||
    sceneMaterials ||
    meshes ||
    compatibility ||
    layout ||
    boundaries ||
    controllerPlayback ||
    distributions ||
    sorting ||
    noiseOptions ||
    stretch ||
    noiseStatistics ||
    particleProbe
      ? []
      : ['-nographics']),
    '-projectPath',
    project,
    '-executeMethod',
    controller
      ? 'NatsumeAnimatorControllerProbe.Run'
      : controllerPlayback
        ? 'NatsumeAnimatorPlaybackProbe.Run'
        : subEmitters
          ? subTransforms
            ? 'NatsumeSubEmitterTransformProbe.Run'
            : sharedSubEmitters
              ? 'NatsumeSubEmitterSharedPlaybackProbe.Run'
              : playback
                ? 'NatsumeSubEmitterPlaybackProbe.Run'
                : 'NatsumeSubEmitterProbe.Run'
          : trails
            ? 'NatsumeTrailProbe.Run'
            : spriteMasks
              ? 'NatsumeSpriteMaskProbe.Run'
              : uiMasks
                ? 'NatsumeUIMaskProbe.Run'
                : images
                  ? 'NatsumeImageProbe.Run'
                  : canvas
                    ? 'NatsumeCanvasProbe.Run'
                    : spriteSheets
                      ? 'NatsumeSpriteSheetProbe.Run'
                      : spriteRendering
                        ? 'NatsumeSpriteRenderProbe.Run'
                        : spriteShapes
                          ? 'NatsumeSpriteShapeProbe.Run'
                          : sceneMaterials
                            ? 'NatsumeSceneMaterialProbe.Run'
                            : events
                              ? 'NatsumeEventProbe.Run'
                              : bySpeed
                                ? (particleProbe?.[1] ?? 'NatsumeBySpeedProbe.Run')
                                : bindings
                                  ? 'NatsumeBindingProbe.Run'
                                  : animation
                                    ? 'NatsumeAnimationProbe.Run'
                                    : meshes
                                      ? 'NatsumeMeshProbe.Run'
                                      : compatibility
                                        ? 'NatsumeCompatibilityProbe.Run'
                                        : noiseStatistics
                                          ? 'NatsumeNoiseStatisticsProbe.Run'
                                          : customData
                                            ? 'NatsumeCustomDataProbe.Run'
                                            : stretch
                                              ? 'NatsumeStretchProbe.Run'
                                              : rectLayout
                                                ? 'NatsumeLayoutProbe.Run'
                                                : noiseOptions
                                                  ? 'NatsumeNoiseOptionsProbe.Run'
                                                  : sweeps
                                                    ? 'NatsumeSweepProbe.Run'
                                                    : spaces
                                                      ? 'NatsumeSpaceProbe.Run'
                                                      : sorting
                                                        ? 'NatsumeSortingProbe.Run'
                                                        : basicShapes
                                                          ? 'NatsumeBasicShapeProbe.Run'
                                                          : rotationPrewarm
                                                            ? 'NatsumeRotationPrewarmProbe.Run'
                                                            : shape
                                                              ? 'NatsumeShapeProbe.Run'
                                                              : distributions
                                                                ? 'NatsumeRandomProbe.Run'
                                                                : layout
                                                                  ? 'NatsumePrefabLayoutProbe.Run'
                                                                  : boundaries
                                                                    ? 'NatsumeBoundaryProbe.Run'
                                                                    : fitting
                                                                      ? 'NatsumeNoiseFitProbe.Run'
                                                                      : 'NatsumeProbe.Run',
    ...(stretch ||
    bindings ||
    playback ||
    controllerPlayback ||
    colliderForcePlayback ||
    particleTriggers ||
    particleLights ||
    lightDistribution ||
    ringPlayback ||
    particleClockPlayback ||
    particleMainPlayback ||
    particleCullingPlayback
      ? []
      : ['-quit']),
    '-logFile',
    log,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NATSUME_COMPAT_OUTPUT: baseline,
      ...(cullingRealtime ? { NATSUME_CULLING_REALTIME: '1' } : {}),
      ...(cullingValidation ? { NATSUME_CULLING_VALIDATION: '1' } : {}),
      ...(traceOrder ? { NATSUME_NATIVE_MAP: nativeMap, NATSUME_NATIVE_TRACE: nativeTrace } : {}),
      ...(sharedSubEmitters
        ? {
            NATSUME_SHARED_SINGLE: sharedSingle ? '1' : '0',
            NATSUME_SHARED_CASE: sharedCase === undefined ? '-1' : String(sharedCase),
          }
        : {}),
    },
  },
);
await new Promise((accept, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) =>
    code === 0
      ? accept()
      : reject(new Error(`Unity exited with ${signal ?? code}; inspect ${log}`)),
  );
});
const current = JSON.parse(await readFile(baseline, 'utf8'));
assert.equal(current.unityVersion, version);
if (uvFlips) {
  assert.equal(current.cases.length, 54);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-uv-flips.json'),
      JSON.stringify(current) + '\n',
    );
  console.log('UV flip observations: 54 cases');
  process.exit(0);
}
if (cameras) {
  assert.equal(current.cases.length, 323);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-cameras.json'),
      JSON.stringify(current) + '\n',
    );
  console.log('Camera observations: 323 cases');
  process.exit(0);
}
if (shapeTextures) {
  assert.equal(current.cases.length, 1423);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-shape-texture.json'),
      JSON.stringify(current) + '\n',
    );
  console.log('Shape texture observations: 1423 cases');
  process.exit(0);
}
if (rendererShapes) {
  assert.equal(current.cases.length, 432);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-renderer-shape.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Renderer shape observations: 432 cases');
  process.exit(0);
}
if (meshShapes) {
  assert.equal(current.cases.length, 56);
  assert.equal(current.variants.length, 3);
  assert(current.variants.every((v) => v.cases.length === 12));
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-mesh-shape.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Mesh shape observations: 92 cases');
  process.exit(0);
}
if (particleClockPlayback || particleMainPlayback || particleCullingPlayback) {
  assert.equal(
    current.cases.length,
    particleClockPlayback ? 18 : particleMainPlayback ? 60 : cullingValidation ? 144 : 84,
  );
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/${particleClockPlayback ? 'unity-particle-clock-playback' : particleMainPlayback ? 'unity-particle-main-playback' : cullingValidation ? 'unity-particle-culling-validation' : cullingRealtime ? 'unity-particle-culling-realtime' : 'unity-particle-culling-playback'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle playback observations: ${current.cases.length}`);
  process.exit(0);
}
if (ringBuffer || ringPlayback) {
  assert.equal(current.cases.length, ringBuffer ? 24 : 9);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/${ringBuffer ? 'unity-particle-ring-buffer' : 'unity-particle-ring-playback'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Ring particle observations: ${current.cases.length}`);
  process.exit(0);
}
if (particleLights || lightDistribution) {
  assert.equal(current.cases.length, particleLights ? 32 : 214);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/${particleLights ? 'unity-particle-lights' : 'unity-particle-light-distribution'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle light observations: ${current.cases.length}`);
  process.exit(0);
}
if (particleTriggers) {
  assert.equal(current.cases.length, 216);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-particle-trigger-playback.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle trigger observations: ${current.cases.length}`);
  process.exit(0);
}
if (particleCollisions || colliderForcePlayback) {
  assert.equal(current.cases.length, particleCollisions ? 162 : 72);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/${particleCollisions ? 'unity-particle-collisions' : 'unity-particle-collider-force'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle collision observations: ${current.cases.length}`);
  process.exit(0);
}
if (externalForces) {
  assert.equal(current.cases.length, 384);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-external-forces.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`External force observations: ${current.cases.length}`);
  process.exit(0);
}
if (particleModules) {
  assert.equal(current.cases.length, 328);
  assert.equal(current.random.length, 8);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-particle-modules.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle module observations: ${current.cases.length}`);
  process.exit(0);
}
if (controller || controllerPlayback) {
  assert.equal(current.cases.length, controller ? 150 : 20);
  console.log(`Animator observations: ${current.cases.length}, ${baseline}`);
  process.exit(0);
}
if (subTransforms) {
  assert.equal(current.cases.length, 90);
  for (const c of current.cases) {
    assert.equal(c.initial.length, 2);
    assert.equal(c.advanced.length, 2);
  }
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sub-emitter-transforms.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Inheritance transform observations: ${current.cases.length}`);
  process.exit(0);
}
if (sharedSubEmitters) {
  if (jobWorkers !== undefined) assert.equal(current.jobWorkers, jobWorkers);
  assert.equal(current.cases.length, sharedSingle || sharedCase !== undefined ? 1 : 72);
  for (const c of current.cases) assert.equal(c.samples.length, 121);
  if (process.argv.includes('--update-fixtures')) {
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/unity-sub-emitter-shared${sharedCase === undefined ? '' : `-case-${sharedCase}`}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  }
  if (traceOrder) {
    const trace = (await readFile(nativeTrace, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const fixture = sharedOrderFixture(current, trace);
    await saveJson(resolve(output, 'shared-order.json'), JSON.stringify(fixture, null, 2) + '\n');
    if (process.argv.includes('--update-fixtures'))
      await saveJson(
        resolve(root, 'data/unity-baselines/fixtures/unity-sub-emitter-shared-scheduled.json'),
        JSON.stringify(fixture, null, 2) + '\n',
      );
    console.log('Shared execution trace: 120 frames');
  }
  console.log(`Shared child observations: ${current.cases.length}`);
  process.exit(0);
}
if (playback) {
  assert.equal(current.cases.length, 44);
  for (const c of current.cases) assert.equal(c.samples.length, 181);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sub-emitter-playback.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Player-loop observations: ${current.cases.length}`);
  process.exit(0);
}
if (subEmitters || trails) {
  assert.equal(current.cases.length, subEmitters ? 102 : 130);
  if (trails) assert.equal(current.folds.length, 984);
  if (subEmitters) {
    assert.equal(current.lifecycle.length, 38);
    assert.equal(current.endpoints.length, 21);
    assert.equal(current.drain.length, 18);
  }
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/unity-${subEmitters ? 'sub-emitters' : 'trails'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle observations: ${current.cases.length}`);
  process.exit(0);
}
if (spriteMasks) {
  assert.equal(current.cases.length, 365);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sprite-masks.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Sprite mask observations: ' + current.cases.length);
  process.exit(0);
}
if (uiMasks) {
  assert.equal(current.cases.length, 59);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-ui-masks.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('UI mask observations: ' + current.cases.length);
  process.exit(0);
}
if (images) {
  assert.equal(current.cases.length, 176);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-images.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Image observations: ' + current.cases.length);
  process.exit(0);
}
if (canvas) {
  assert.equal(current.cases.length, 24);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-canvas.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Canvas observations: ' + current.cases.length);
  process.exit(0);
}
if (spriteSheets) {
  assert.equal(current.cases.length, 7);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sprite-sheets.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Sprite sheet geometry: ' + current.cases.length);
  process.exit(0);
}
if (spriteRendering) {
  assert.equal(current.cases.length, 32);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sprite-rendering.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Sprite rendering: ' + current.cases.length);
  process.exit(0);
}
if (spriteShapes) {
  assert.equal(current.cases.length, 52);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sprite-shapes.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Sprite/torus measurements: ' + current.cases.length);
  process.exit(0);
}
if (sceneMaterials) {
  assert.equal(current.cases.length, 12);
  assert.equal(current.states.length, 63);
  assert.equal(current.layers.length, 19);
  assert.equal(current.generatedMips.length, 4);
  for (const mip of current.generatedMips)
    assert.equal(mip.pixels.length, mip.width * mip.height * 4);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-scene-materials.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Scene material measurements: ' + current.cases.length);
  process.exit(0);
}
if (events) {
  assert.equal(current.cases.length, 221);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-events.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Event measurements: ' + current.cases.length);
  process.exit(0);
}
if (bySpeed) {
  assert.equal(current.cases.length, 3584);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-by-speed.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('By-speed measurements: ' + current.cases.length);
  process.exit(0);
}
if (bindings) {
  assert.equal(current.cases.length, 1377);
  assert.equal(current.states.length, 2);
  assert.equal(current.disables.length, 8);
  assert.equal(current.conflicts.length, 2);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-animation-bindings.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Binding measurements: ${current.cases.length} cases`);
  process.exit(0);
}
if (animation) {
  assert.equal(current.curves.length, 480);
  assert.equal(current.clocks.length, 144);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-animation.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(
    `Animation measurements: ${current.curves.length} curves, ${current.clocks.length} clocks`,
  );
  process.exit(0);
}
if (meshes) {
  assert.equal(current.cases.length, 8);
  assert.equal(current.materialCases.length, 15);
  assert.equal(current.orderCases.length, 43);
  assert.equal(current.legacyCases.length, 18);
  assert.equal(current.multipleSubmeshesRejected, true);
  assert.deepEqual(
    current.materialCases.find((c) => c.label === 'Mesh-0').pixels,
    [255, 0, 0, 255, 0, 0, 255, 0, 0],
  );
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-meshes.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Mesh measurements: ' + baseline);
  process.exit(0);
}
if (compatibility) {
  assert(current.curves.length >= 11 && current.gradient.length === 5);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-compatibility.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log('Compatibility measurements: ' + baseline);
  process.exit(0);
}
if (noiseStatistics || customData) {
  if (noiseStatistics && process.env.NATSUME_NOISE_STATISTICS_INPUT) {
    const input = JSON.parse(await readFile(process.env.NATSUME_NOISE_STATISTICS_INPUT, 'utf8'));
    assert.equal(current.count, input.count);
    assert.equal(current.cases.length, input.cases.length);
    assert(
      !process.argv.includes('--update-fixtures'),
      'Custom statistics must not replace default fixtures',
    );
  } else assert.equal(current.cases.length, noiseStatistics ? 86 : 8);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/unity-${noiseStatistics ? 'noise-statistics' : 'custom-data'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Module measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (stretch) {
  current.motion = JSON.parse(await readFile(resolve(output, 'camera-motion.json'), 'utf8')).cases;
  assert.equal(current.cases.length, 239);
  assert.equal(current.motion.length, 288);
  assert(
    current.motion.some((sample) => Math.abs(sample.viewVelocity.y - 3) < 0.01),
    'Moving-view probe must record a nonzero native camera velocity',
  );
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-stretch.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Stretch measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (rectLayout) {
  assert.equal(current.rootSize.x, -100);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-layout.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Signed RectTransform measurement: ${baseline}`);
  process.exit(0);
}
if (noiseOptions) {
  assert.equal(current.cases.length, 11);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-noise-options.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Noise parameter measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (sweeps) {
  assert.equal(current.cases.length, 11);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sweeps.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Shape sweep measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (spaces) {
  assert.equal(current.cases.length, 9);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-spaces.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Simulation space measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (sorting) {
  assert.equal(current.cases.length, 5);
  assert(current.cases.every((c) => c.order.length === 3));
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-sorting.json'),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle sorting: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (basicShapes || rotationPrewarm) {
  assert.equal(current.cases.length, basicShapes ? 34 : 121);
  if (process.argv.includes('--update-fixtures'))
    await saveJson(
      resolve(
        root,
        `data/unity-baselines/fixtures/unity-${basicShapes ? 'basic-shapes' : 'rotation-prewarm'}.json`,
      ),
      JSON.stringify(current, null, 2) + '\n',
    );
  console.log(`Particle measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (shape) {
  assert.equal(current.cases.length, 14);
  assert(current.cases.every((c) => c.positions.length > 0));
  if (process.argv.includes('--update-fixtures')) {
    const cases = current.cases.map((c) => {
      if (c.label.startsWith('spread-')) return c;
      const offsets = c.positions.map((p, i) => [
        p.x - 4 - c.radius * c.velocities[i].x,
        p.y - 5 - c.radius * c.velocities[i].y,
        p.z - 6 - c.radius * c.velocities[i].z,
      ]);
      const mean = [0, 1, 2].map((a) => offsets.reduce((s, p) => s + p[a], 0) / offsets.length);
      const secondMoment = [0, 1, 2].map(
        (a) => offsets.reduce((s, p) => s + p[a] * p[a], 0) / offsets.length,
      );
      const radiusSquared = offsets.map((p) => p.reduce((s, v) => s + v * v, 0));
      const radiusSquaredMean = radiusSquared.reduce((s, v) => s + v, 0) / offsets.length;
      const radiusSquaredVariance =
        radiusSquared.reduce((s, v) => s + (v - radiusSquaredMean) ** 2, 0) / offsets.length;
      return {
        label: c.label,
        radius: c.radius,
        jitter: c.jitter,
        scale: c.scale,
        rotated: c.rotated,
        count: offsets.length,
        mean,
        secondMoment,
        radiusSquaredMean,
        radiusSquaredVariance,
      };
    });
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-shape.json'),
      JSON.stringify({ unityVersion: current.unityVersion, cases }, null, 2) +
        String.fromCharCode(10),
    );
  }
  console.log('Shape measurements: ' + current.cases.length + ' cases, ' + baseline);
  process.exit(0);
}
if (distributions) {
  assert.equal(current.cases.length, 14);
  assert(current.cases.every((c) => c.count === 16384 && c.distributions.length === 17));
  if (process.argv.includes('--update-fixtures')) {
    await mkdir(resolve(root, 'data/unity-baselines/fixtures'), { recursive: true });
    const cases = current.cases.map((c) => ({
      ...c,
      correlations: c.correlations.filter((r) => Math.abs(r.value) > 0.1),
    }));
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-random.json'),
      JSON.stringify({ unityVersion: current.unityVersion, cases }, null, 2) +
        String.fromCharCode(10),
    );
  }
  console.log('Random distributions: ' + current.cases.length + ' cases, ' + baseline);
  process.exit(0);
}
if (boundaries) {
  assert.notEqual(current.graphicsDevice, 'Null');
  assert(current.cases.length >= 24);
  assert(current.cases.every((sample) => sample.samples.length > 1));
  if (process.argv.includes('--update-fixtures')) {
    const cases = current.cases.map((sample) => ({
      label: sample.label,
      ...(sample.label.startsWith('sheet-search-') ? { threshold: sample.threshold } : {}),
      ...(sample.label.startsWith('rate-window-')
        ? {
            stepSeconds: sample.stepSeconds,
            rate: sample.rate,
            lifetimeCurve: sample.lifetimeCurve,
            rateCurve: sample.rateCurve,
            duration: sample.duration,
          }
        : {}),
      ...(sample.label.startsWith('repeat-grid-')
        ? {
            stepSeconds: sample.stepSeconds,
            duration: sample.duration,
            burstStart: sample.burstStart,
            burstInterval: sample.burstInterval,
            burstCycles: sample.burstCycles,
            loop: sample.loop,
          }
        : {}),
      samples: sample.samples
        .filter((s) =>
          /motion|appearance|stretch|mesh-|billboard-/.test(sample.label)
            ? [0, 1, 4, 30, 59].includes(s.frame)
            : true,
        )
        .map((s) =>
          /motion|appearance|stretch|mesh-|billboard-/.test(sample.label)
            ? {
                frame: s.frame,
                positions: s.positions,
                velocities: s.velocities,
                sizes: s.sizes,
                colors: s.colors,
                ...(/appearance|stretch|mesh-|billboard-/.test(sample.label)
                  ? { vertices: s.vertices, uv: s.uv }
                  : {}),
              }
            : sample.label.startsWith('rate-window-')
              ? { frame: s.frame, count: s.count, remaining: s.remaining, lifetimes: s.lifetimes }
              : sample.label.startsWith('sheet-')
                ? { frame: s.frame, remaining: s.remaining, uv: s.uv }
                : { frame: s.frame, count: s.count },
        ),
    }));
    await mkdir(resolve(root, 'data/unity-baselines/fixtures'), { recursive: true });
    await saveJson(
      resolve(root, 'data/unity-baselines/fixtures/unity-boundaries.json'),
      `${JSON.stringify(
        {
          unityVersion: current.unityVersion,
          source:
            'NatsumeBoundaryProbe.cs; fixed dt 1/60; native measurements, not calculated expectations',
          cases,
        },
        null,
        2,
      )}\n`,
    );
  }
  console.log(`Boundary measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (layout) {
  const sourceHash = createHash('sha256')
    .update(await readFile(resolve(prefabSource, 'kirakira_01.prefab')))
    .digest('hex');
  assert.equal(current.prefabSha256, sourceHash, 'The imported prefab must match the source');
  assert.notEqual(current.graphicsDevice, 'Null');
  assert(current.cases.some((sample) => sample.systems.some((system) => system.count > 0)));
  console.log(`Native prefab placement measurements and PNGs: ${output}`);
  process.exit(0);
}
if (fitting) {
  console.log(`Noise measurements: ${current.cases.length} cases, ${baseline}`);
  process.exit(0);
}
if (process.argv.includes('--update-fixtures'))
  await saveJson(
    resolve(root, 'data/unity-baselines/fixtures/unity-curves.json'),
    JSON.stringify({ unityVersion: current.unityVersion, cases: current.curves }, null, 2) + '\n',
  );
const report = verifyUnityBaseline(current);
if (previous?.unityVersion === version) {
  // Labels and probe metadata can evolve; compare unchanged numerical cases.
  let compared = 0;
  for (const sample of current.noise) {
    const prior = previous.noise.find((item) => item.label === sample.label);
    if (prior) {
      assert.deepEqual(sample, prior, `Noise changed across editor runs: ${sample.label}`);
      compared++;
    }
  }
  report.repeatedNoiseCases = compared;
}
await saveJson(resolve(output, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
