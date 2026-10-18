import { mat4, quat, vec3 } from 'gl-matrix';
import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { EmissionModuleT } from '../format/generated/noa/ir/emission-module.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import type { RotationModuleT } from '../format/generated/noa/ir/rotation-module.js';
import type { ColorModuleT } from '../format/generated/noa/ir/color-module.js';
import type { SizeModuleT } from '../format/generated/noa/ir/size-module.js';
import type { VelocityModuleT } from '../format/generated/noa/ir/velocity-module.js';
import type { LimitVelocityModuleT } from '../format/generated/noa/ir/limit-velocity-module.js';
import type { NoiseModuleT } from '../format/generated/noa/ir/noise-module.js';
import type { TextureSheetModuleT } from '../format/generated/noa/ir/texture-sheet-module.js';
import type { CustomDataModuleT } from '../format/generated/noa/ir/custom-data-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { Space } from '../format/generated/noa/ir/space.js';
import { ScalingMode } from '../format/generated/noa/ir/scaling-mode.js';
import { SeedMode } from '../format/generated/noa/ir/seed-mode.js';
import { sampleShape, validateShape } from './shapes.js';
import { SheetTime } from '../format/generated/noa/ir/sheet-time.js';
import { CustomDataMode } from '../format/generated/noa/ir/custom-data-mode.js';
import { scalar, color, random, validateParameters, constantZero } from './parameters.js';
import { CurlNoiseField } from '../particles/noise/curl-field.js';
import { ParticleNoise } from '../particles/noise/particle-noise.js';
import type { SceneNode } from './scene.js';

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly componentId?: number;
}

/** Warm complete cycles until constant/ranged birth lifetimes can reach steady state. */
export function prewarmDuration(main: NonNullable<R<ParticleSystemT>['main']>): number {
  if (!main.prewarm || !main.loop) return 0;
  const p = main.lifetime;
  let lifetime = Math.max(1e-6, scalar(p, 0, 0), scalar(p, 0, 1));
  if (p && (p.mode === 1 || p.mode === 3)) {
    for (const c of p.mode === 3 ? [p.curveMin, p.curveMax] : [p.curveMax]) {
      for (let i = 0; i < (c?.keys.length ?? 0); i++) {
        const k = c!.keys[i]!,
          next = c!.keys[i + 1];
        lifetime = Math.max(lifetime, k.value * p.multiplier);
        if (next && k.interpolation >= 2) {
          const dt = next.time - k.time;
          // Bezier control values bound weighted and Hermite segment peaks.
          lifetime = Math.max(
            lifetime,
            (k.value + k.outSlope * dt * (k.weightedOut ? k.outWeight : 1 / 3)) * p.multiplier,
            (next.value - next.inSlope * dt * (next.weightedIn ? next.inWeight : 1 / 3)) *
              p.multiplier,
          );
        }
      }
    }
  }
  return Math.ceil(lifetime / main.durationSeconds) * main.durationSeconds;
}

/** Dense SoA particle storage. Random channels persist through compaction via serial IDs. */
export class Emitter {
  readonly main: NonNullable<R<ParticleSystemT>['main']>;
  readonly emission: R<EmissionModuleT> | undefined;
  readonly shape: R<ShapeModuleT> | undefined;
  readonly colorModule: R<ColorModuleT> | undefined;
  readonly sizeModule: R<SizeModuleT> | undefined;
  readonly rotationModule: R<RotationModuleT> | undefined;
  readonly velocityModule: R<VelocityModuleT> | undefined;
  readonly limit: R<LimitVelocityModuleT> | undefined;
  readonly noise: R<NoiseModuleT> | undefined;
  readonly sheet: R<TextureSheetModuleT> | undefined;
  readonly custom: R<CustomDataModuleT> | undefined;
  readonly customData: Float32Array | undefined;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  renderVelocities: Float32Array | undefined;
  readonly startSizes: Float32Array;
  readonly rotations: Float32Array;
  readonly startColors: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  readonly serials: Uint32Array;
  readonly seed: number;
  readonly field: CurlNoiseField | undefined;
  readonly noiseSizes: Float32Array | undefined;
  private readonly noiseEvaluator: ParticleNoise | undefined;
  readonly prewarmSeconds: number;
  readonly delaySeconds: number;
  readonly shapeMatrix = mat4.create();
  readonly simulationMatrix = mat4.create();
  readonly inverseSimulationMatrix = mat4.create();
  private readonly vectorMatrix = mat4.create();
  private readonly limitRotation = quat.create();
  private readonly inverseLimitRotation = quat.create();
  gravity: readonly [number, number, number] = [0, 0, 0];
  private readonly scratch = new Float64Array(3);
  private readonly direction = vec3.create();
  private readonly birth = new Float64Array(6);
  private nextSerial = 0;
  private time = 0;
  private carry = 0;
  private enabledLast = false;
  private started = false;
  private delayRemaining = 0;
  count = 0;
  emitting = true;
  constructor(
    readonly id: number,
    readonly node: SceneNode,
    readonly source: R<ParticleSystemT>,
    readonly enabled: boolean,
    instanceSeed: number,
    diagnostics: Diagnostic[],
    gravity?: readonly [number, number, number],
    readonly customSpaceNode?: SceneNode,
  ) {
    const main = source.main!;
    this.main = main;
    validateParameters(source);
    this.setGravity(gravity);
    check(
      main.scaling === ScalingMode.Local,
      'CAPABILITY',
      `System ${id}: scaling ${ScalingMode[main.scaling]} is unsupported`,
    );
    check(
      main.space !== Space.Custom || customSpaceNode,
      'HOST',
      `System ${id}: custom simulation node is unavailable`,
    );
    this.updateSpace();
    this.delaySeconds = Math.max(0, scalar(main.startDelay, 0, random(instanceSeed, id, 70)));
    this.delayRemaining = this.delaySeconds;
    check(main.maxParticles <= 100_000, 'LIMIT', 'Emitter capacity exceeds playback limit');
    check(
      main.durationSeconds >= 1 / 60,
      'CAPABILITY',
      'Playback requires duration >= 1/60 second',
    );
    this.prewarmSeconds = prewarmDuration(main);
    check(
      Math.ceil(this.prewarmSeconds * 60) <= 36_000 &&
        main.maxParticles * Math.ceil(this.prewarmSeconds * 60) <= 10_000_000,
      'LIMIT',
      'Prewarm work exceeds playback budget',
    );
    for (const m of source.modules) {
      switch (m.dataType) {
        case M.EmissionModule:
          this.emission = m.data as R<EmissionModuleT>;
          break;
        case M.ShapeModule:
          this.shape = m.data as R<ShapeModuleT>;
          break;
        case M.ColorModule:
          this.colorModule = m.data as R<ColorModuleT>;
          break;
        case M.SizeModule:
          this.sizeModule = m.data as R<SizeModuleT>;
          break;
        case M.RotationModule:
          this.rotationModule = m.data as R<RotationModuleT>;
          break;
        case M.VelocityModule:
          this.velocityModule = m.data as R<VelocityModuleT>;
          break;
        case M.LimitVelocityModule:
          this.limit = m.data as R<LimitVelocityModuleT>;
          break;
        case M.NoiseModule:
          this.noise = m.data as R<NoiseModuleT>;
          break;
        case M.TextureSheetModule:
          this.sheet = m.data as R<TextureSheetModuleT>;
          break;
        case M.CustomDataModule:
          this.custom = m.data as R<CustomDataModuleT>;
          break;
        default:
          check(false, 'CAPABILITY', `System ${id}: unsupported particle module ${M[m.dataType]}`);
      }
    }
    check(
      constantZero(this.emission?.rateOverDistance),
      'CAPABILITY',
      'Distance emission unsupported',
    );
    for (const b of this.emission?.bursts ?? [])
      check(
        b.cycles !== 0 || b.intervalSeconds > 0,
        'CAPABILITY',
        `System ${id}: infinite burst requires a positive repeat interval`,
      );
    check(
      (this.emission?.bursts ?? []).reduce(
        (n, b) =>
          n +
          (b.cycles ||
            Math.max(
              0,
              Math.ceil((this.main.durationSeconds - b.timeSeconds) / b.intervalSeconds),
            )),
        0,
      ) <= 4096,
      'LIMIT',
      'Too many burst repetitions',
    );
    if (this.shape) {
      const s = this.shape;
      validateShape(s);
      const t = s.transform!,
        q = t.rotation!,
        p = t.position!,
        scale = t.scale!;
      mat4.fromRotationTranslationScale(
        this.shapeMatrix,
        [q.x, q.y, q.z, q.w],
        [p.x, p.y, p.z],
        [scale.x, scale.y, scale.z],
      );
    }

    this.seed =
      main.seedMode === SeedMode.Fixed
        ? main.seed
        : Math.floor(random(instanceSeed, id, 0) * 4294967296);
    if (this.noise) {
      const n = this.noise;
      check(
        n.algorithm === 'unity-particle-noise' && n.algorithmRevision === 1,
        'CAPABILITY',
        'Unsupported particle noise algorithm or revision',
      );
      this.noiseEvaluator = new ParticleNoise(n, this.seed);
      this.field = this.noiseEvaluator.field;
      if (!constantZero(n.sizeAmount))
        this.noiseSizes = new Float32Array(main.maxParticles * 3).fill(1);
      diagnostics.push({
        code: 'APPROXIMATE_NOISE',
        componentId: id,
        message:
          'Noise uses calibrated TypeScript Curl Noise; seeded trajectories differ from Unity.',
      });
    }
    const cap = main.maxParticles;
    this.positions = new Float32Array(cap * 3);
    this.velocities = new Float32Array(cap * 3);
    if (this.sheet?.timeMode === SheetTime.Speed) this.renderVelocities = new Float32Array(cap * 3);
    this.startSizes = new Float32Array(cap * 3);
    this.rotations = new Float32Array(cap * 3);
    this.startColors = new Float32Array(cap * 4);
    this.ages = new Float32Array(cap);
    this.lifetimes = new Float32Array(cap);
    this.serials = new Uint32Array(cap);
    if (this.custom?.streams.some((s) => s.mode !== CustomDataMode.Disabled))
      this.customData = new Float32Array(cap * 8);
  }
  private updateCustom(index: number, age: number): void {
    if (!this.customData) return;
    const serial = this.serials[index]!;
    for (const stream of this.custom!.streams) {
      const offset = index * 8 + stream.slot * 4;
      this.customData.fill(0, offset, offset + 4);
      if (stream.mode === CustomDataMode.Vector)
        for (let component = 0; component < stream.vectorComponents; component++)
          this.customData[offset + component] = scalar(
            stream.vector[component],
            age,
            random(
              this.seed,
              serial,
              stream.slot === 0 && component === 0 ? 56 : 120 + stream.slot * 4 + component,
            ),
          );
      else if (stream.mode === CustomDataMode.Color)
        color(
          stream.color,
          age,
          random(this.seed, serial, 120 + stream.slot * 4),
          this.customData,
          offset,
        );
    }
  }
  setGravity(value: readonly [number, number, number] | undefined): void {
    this.gravity = this.resolveGravity(value);
  }
  /** @internal Validates gravity before committing an environment replacement. */
  resolveGravity(
    value: readonly [number, number, number] | undefined,
  ): readonly [number, number, number] {
    const authored = this.main.gravity;
    check(
      constantZero(this.main.gravityMultiplier) || value !== undefined || authored,
      'HOST',
      `System ${this.id}: nonzero gravityMultiplier requires particleEnvironment.gravity`,
    );
    const next =
      value ?? (authored ? ([authored.x, authored.y, authored.z] as const) : ([0, 0, 0] as const));
    check(next.length === 3 && next.every(Number.isFinite), 'HOST', 'Invalid particle gravity');
    return next;
  }
  /** Refreshes the coordinate frame without moving particles already stored in that frame. */
  updateSpace(): void {
    const frame =
      this.main.space === Space.Local
        ? this.node
        : this.main.space === Space.Custom
          ? this.customSpaceNode
          : undefined;
    if (frame) mat4.copy(this.simulationMatrix, frame.worldMatrix);
    else mat4.identity(this.simulationMatrix);
    // Zero scale is valid. Rotation-only fallback preserves finite simulation in a collapsed frame.
    if (!mat4.invert(this.inverseSimulationMatrix, this.simulationMatrix)) {
      mat4.fromQuat(this.inverseSimulationMatrix, frame!.worldRotation);
      mat4.transpose(this.inverseSimulationMatrix, this.inverseSimulationMatrix);
    }
    mat4.multiply(this.vectorMatrix, this.inverseSimulationMatrix, this.node.worldMatrix);
    // Native limit axes use inverse module rotation relative to the simulation frame.
    // Scale does not scale their thresholds.
    if (this.limit?.space === Space.Local) {
      quat.conjugate(this.limitRotation, this.node.worldRotation);
      if (frame) quat.multiply(this.limitRotation, this.limitRotation, frame.worldRotation);
    } else if (frame) quat.copy(this.limitRotation, frame.worldRotation);
    else quat.identity(this.limitRotation);
    quat.conjugate(this.inverseLimitRotation, this.limitRotation);
  }
  private vector(x: number, y: number, z: number, local: boolean): Float64Array {
    const m = local ? this.vectorMatrix : this.inverseSimulationMatrix;
    const out = this.scratch;
    out[0] = m[0]! * x + m[4]! * y + m[8]! * z;
    out[1] = m[1]! * x + m[5]! * y + m[9]! * z;
    out[2] = m[2]! * x + m[6]! * y + m[10]! * z;
    return out;
  }
  reset(): void {
    this.count = 0;
    this.noiseEvaluator?.reset();
    this.nextSerial = 0;
    this.time = 0;
    this.carry = 0;
    this.started = false;
    this.delayRemaining = this.delaySeconds;
    this.enabledLast = false;
    this.emitting = true;
  }
  clear(): void {
    this.count = 0;
  }
  sync(): void {
    this.updateSpace();
    const active = this.enabled && this.node.activeInHierarchy;
    if (active === this.enabledLast) return;
    this.enabledLast = active;
    if (!active) {
      this.clear();
      this.noiseEvaluator?.reset();
      this.started = false;
      this.delayRemaining = this.delaySeconds;
      this.time = 0;
      this.carry = 0;
    } else if (this.main.playOnEnable && this.emitting) this.start();
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.delayRemaining > 0) return;
    this.bursts(-Number.EPSILON, 0);
    this.prewarm();
  }
  private prewarm(): void {
    if (!this.main.simulationSpeed) return;
    const steps = Math.ceil(this.prewarmSeconds * 60);
    for (let i = 0; i < steps; i++) this.advance(Math.min(1 / 60, this.prewarmSeconds - i / 60));
  }
  private bursts(from: number, to: number): void {
    const duration = this.main.durationSeconds;
    const firstCycle = this.main.loop ? Math.max(0, Math.floor(from / duration)) : 0;
    const lastCycle = this.main.loop ? Math.floor(to / duration) : 0;
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++)
      for (const [index, b] of (this.emission?.bursts ?? []).entries()) {
        const epsilonTime = 1e-8 * Math.max(1, duration),
          repetitions =
            b.intervalSeconds === 0
              ? 1
              : b.cycles ||
                Math.max(
                  0,
                  Math.ceil((duration - b.timeSeconds - epsilonTime) / b.intervalSeconds),
                ),
          localFrom = from - cycle * duration - b.timeSeconds,
          localTo = to - cycle * duration - b.timeSeconds,
          first =
            b.intervalSeconds > 0 ? Math.max(0, Math.floor(localFrom / b.intervalSeconds) - 1) : 0,
          last =
            b.intervalSeconds > 0
              ? Math.min(repetitions - 1, Math.ceil(localTo / b.intervalSeconds) + 1)
              : 0;
        for (let repeat = first; repeat <= last; repeat++) {
          const when = cycle * duration + b.timeSeconds + repeat * b.intervalSeconds;
          const phase = (b.timeSeconds + repeat * b.intervalSeconds) / duration;
          const epsilon = 1e-8 * Math.max(1, Math.abs(when));
          if (phase > 1 + epsilon) continue;
          // A new cycle's zero-time burst starts on the following step. The
          // preceding cycle's duration-end burst belongs to the ending step.
          const cycleStart = cycle > 0 && phase === 0;
          if (
            cycleStart
              ? when < from - epsilon || when >= to - epsilon
              : when <= from + (from < 0 ? 0 : epsilon) || when > to + epsilon
          )
            continue;
          if (random(this.seed, cycle, index + 100) < b.probability)
            this.emit(
              Math.round(scalar(b.count, phase, random(this.seed, cycle, index + 110))),
              phase,
              when,
            );
        }
      }
  }
  private emit(
    amount: number,
    phase = (this.time % this.main.durationSeconds) / this.main.durationSeconds,
    seconds = this.time,
  ): void {
    const capacity = this.ages.length;
    for (let n = 0; n < amount && this.count < capacity; n++) {
      const i = this.count++,
        o = i * 3,
        serial = this.nextSerial++;
      this.serials[i] = serial;
      const rnd = (ch: number) => random(this.seed, serial, ch),
        t = phase;
      this.ages[i] = 0;
      this.noiseSizes?.fill(1, o, o + 3);
      this.lifetimes[i] = Math.max(1e-6, scalar(this.main.lifetime, t, rnd(0)));
      let x = 0,
        y = 0,
        z = 0,
        dx = 0,
        dy = 0,
        dz = 1;
      if (this.shape) {
        sampleShape(
          this.shape,
          this.seed,
          serial,
          t,
          n,
          amount,
          this.birth,
          seconds,
          this.main.durationSeconds,
        );
        const [px, py, pz, bx, by, bz] = this.birth;
        const m = this.shapeMatrix;
        x = m[0]! * px! + m[4]! * py! + m[8]! * pz! + m[12]!;
        y = m[1]! * px! + m[5]! * py! + m[9]! * pz! + m[13]!;
        z = m[2]! * px! + m[6]! * py! + m[10]! * pz! + m[14]!;
        const q = this.shape.transform!.rotation!;
        vec3.transformQuat(this.direction, [bx!, by!, bz!], [q.x, q.y, q.z, q.w]);
        dx = this.direction[0]!;
        dy = this.direction[1]!;
        dz = this.direction[2]!;
      }
      if (this.main.space !== Space.Local) {
        const m = this.node.worldMatrix,
          inv = this.inverseSimulationMatrix;
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!;
        y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!;
        z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!;
        const direction = this.vector(dx, dy, dz, true);
        dx = direction[0]!;
        dy = direction[1]!;
        dz = direction[2]!;
      }
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      const speed = scalar(this.main.speed, t, rnd(4));
      this.velocities[o] = dx * speed;
      this.velocities[o + 1] = dy * speed;
      this.velocities[o + 2] = dz * speed;
      if (this.renderVelocities) {
        this.renderVelocities[o] = dx * speed;
        this.renderVelocities[o + 1] = dy * speed;
        this.renderVelocities[o + 2] = dz * speed;
      }
      const size = this.main.size!,
        rot = this.main.rotation!;
      const sx = scalar(size.x, t, rnd(5));
      this.startSizes[o] = sx;
      this.startSizes[o + 1] = this.main.size3d ? scalar(size.y, t, rnd(6)) : sx;
      this.startSizes[o + 2] = this.main.size3d ? scalar(size.z, t, rnd(7)) : sx;
      this.rotations[o] = this.main.rotation3d ? scalar(rot.x, t, rnd(8)) : 0;
      this.rotations[o + 1] = this.main.rotation3d ? scalar(rot.y, t, rnd(9)) : 0;
      this.rotations[o + 2] = scalar(rot.z, t, rnd(10));
      const rotationSign = rnd(68) < this.main.flipRotationProbability ? -1 : 1;
      for (let axis = 0; axis < 3; axis++)
        this.rotations[o + axis] = this.rotations[o + axis]! * rotationSign;
      if (this.shape?.alignToDirection) {
        this.rotations[o] = this.rotations[o]! - Math.asin(Math.max(-1, Math.min(1, dy)));
        this.rotations[o + 1] =
          this.rotations[o + 1]! + (Math.hypot(dx, dz) < 1e-8 ? -Math.PI / 2 : Math.atan2(dx, dz));
      }
      color(this.main.color, t, rnd(11), this.startColors, i * 4);
      this.updateCustom(i, 0);
    }
  }
  step(delta: number): void {
    if (!this.enabledLast) return;
    let dt = delta * this.main.simulationSpeed;
    if (dt <= 0) return;
    if (this.delayRemaining > 0) {
      this.delayRemaining -= dt;
      if (this.delayRemaining > 0) return;
      dt = -this.delayRemaining;
      this.delayRemaining = 0;
      this.bursts(-Number.EPSILON, 0);
      this.prewarm();
      if (dt <= 0) return;
    }
    this.advance(dt);
  }
  private advance(dt: number): void {
    this.noiseEvaluator?.advance(
      dt,
      (this.time % this.main.durationSeconds) / this.main.durationSeconds,
    );
    const limitDecay = this.limit ? Math.pow(1 - this.limit.dampen, dt * 30) : 1;
    for (let i = 0; i < this.count; ) {
      const age = this.ages[i]! + dt;
      if (age >= this.lifetimes[i]!) {
        this.remove(i);
        continue;
      }
      const t = age / this.lifetimes[i]!,
        serial = this.serials[i]!,
        o = i * 3,
        rnd = (ch: number) => random(this.seed, serial, ch);
      if (this.rotationModule) {
        const r = this.rotationModule,
          rotationTime = this.ages[i]! / this.lifetimes[i]!,
          rotationSign = rnd(68) < this.main.flipRotationProbability ? -1 : 1;
        if (r.separateAxes) {
          this.rotations[o] =
            this.rotations[o]! +
            scalar(r.angularVelocity?.x, rotationTime, rnd(60)) * dt * rotationSign;
          this.rotations[o + 1] =
            this.rotations[o + 1]! +
            scalar(r.angularVelocity?.y, rotationTime, rnd(61)) * dt * rotationSign;
        }
        this.rotations[o + 2] =
          this.rotations[o + 2]! +
          scalar(r.angularVelocity?.z, rotationTime, rnd(62)) * dt * rotationSign;
      }
      let x = this.positions[o]!,
        y = this.positions[o + 1]!,
        z = this.positions[o + 2]!;
      let vx = this.velocities[o]!,
        vy = this.velocities[o + 1]!,
        vz = this.velocities[o + 2]!;
      const gravityMultiplier = scalar(this.main.gravityMultiplier, t, rnd(69), 1);
      const gravity = this.vector(...this.gravity, false);
      const gx = gravity[0]! * gravityMultiplier * dt,
        gy = gravity[1]! * gravityMultiplier * dt,
        gz = gravity[2]! * gravityMultiplier * dt;
      vx += gx;
      vy += gy;
      vz += gz;
      this.velocities[o] = vx;
      this.velocities[o + 1] = vy;
      this.velocities[o + 2] = vz;
      let orbitalX = 0,
        orbitalY = 0,
        orbitalZ = 0,
        multiplier = 1;
      const v = this.velocityModule;
      if (v) {
        const scale = this.node.source.transform!.scale!;
        const linear = this.vector(
          scalar(v.linear?.x, t, rnd(20)) * (v.space === Space.World ? scale.x : 1),
          scalar(v.linear?.y, t, rnd(21)) * (v.space === Space.World ? scale.y : 1),
          scalar(v.linear?.z, t, rnd(22)) * (v.space === Space.World ? scale.z : 1),
          v.space === Space.Local,
        );
        vx += linear[0]!;
        vy += linear[1]!;
        vz += linear[2]!;
        multiplier = scalar(v.speedMultiplier, t, rnd(30), 1);
        const ox = scalar(v.orbitalOffset?.x, t, rnd(24)),
          oy = scalar(v.orbitalOffset?.y, t, rnd(25)),
          oz = scalar(v.orbitalOffset?.z, t, rnd(26));
        const wx = scalar(v.orbital?.x, t, rnd(27)),
          wy = scalar(v.orbital?.y, t, rnd(28)),
          wz = scalar(v.orbital?.z, t, rnd(29));
        // Native probe: orbital displacement participates in speedModifier and
        // the scalar limit, but is not itself accumulated in stored velocity.
        let px = x - ox,
          py = y - oy,
          pz = z - oz;
        const angularDt = dt * multiplier;
        if (wz && angularDt) {
          const c = Math.cos(wz * angularDt),
            s = Math.sin(wz * angularDt),
            a = px * c - py * s;
          py = px * s + py * c;
          px = a;
        }
        if (wx && angularDt) {
          const c = Math.cos(wx * angularDt),
            s = Math.sin(wx * angularDt),
            a = py * c - pz * s;
          pz = py * s + pz * c;
          py = a;
        }
        if (wy && angularDt) {
          const c = Math.cos(wy * angularDt),
            s = Math.sin(wy * angularDt),
            a = px * c + pz * s;
          pz = -px * s + pz * c;
          px = a;
        }
        if ((wx || wy || wz) && angularDt) {
          orbitalX = (px + ox - x) / dt;
          orbitalY = (py + oy - y) / dt;
          orbitalZ = (pz + oz - z) / dt;
          // Preserve the existing rotated position used by Noise sampling.
          x = px + ox;
          y = py + oy;
          z = pz + oz;
          vx += orbitalX / multiplier;
          vy += orbitalY / multiplier;
          vz += orbitalZ / multiplier;
        }
        const radial = scalar(v.radial, t, rnd(23));
        if (radial) {
          const length = Math.hypot(x, y, z) || 1;
          vx += (x / length) * radial;
          vy += (y / length) * radial;
          vz += (z / length) * radial;
        }
      }
      if (this.limit) {
        const l = this.limit;
        const beforeX = vx,
          beforeY = vy,
          beforeZ = vz;
        if (l.separateAxes) {
          vec3.transformQuat(this.direction, [vx, vy, vz], this.inverseLimitRotation);
          for (let axis = 0; axis < 3; axis++) {
            const key = axis === 0 ? l.limit?.x : axis === 1 ? l.limit?.y : l.limit?.z;
            const maximum = Math.max(0, scalar(key, t, rnd(40 + axis)));
            const value = this.direction[axis]!;
            if (Math.abs(value) > maximum)
              this.direction[axis] =
                Math.sign(value) * (maximum + (Math.abs(value) - maximum) * limitDecay);
          }
          vec3.transformQuat(this.direction, this.direction, this.limitRotation);
          vx = this.direction[0]!;
          vy = this.direction[1]!;
          vz = this.direction[2]!;
        } else {
          const speed = Math.hypot(vx, vy, vz),
            maximum = Math.max(0, scalar(l.limit?.x, t, rnd(40)));
          if (speed > maximum) {
            const factor = (maximum + (speed - maximum) * limitDecay) / speed;
            vx *= factor;
            vy *= factor;
            vz *= factor;
          }
        }
        const speed = Math.hypot(vx, vy, vz);
        if (speed > 0) {
          let drag = Math.max(0, scalar(l.drag, t, rnd(43))) * dt;
          if (l.multiplyDragBySize) {
            const size =
              this.startSizes[o]! *
              scalar(this.sizeModule?.size?.x, this.ages[i]! / this.lifetimes[i]!, rnd(50), 1) *
              (this.noiseSizes?.[o] ?? 1);
            drag *= Math.PI * size * size;
          }
          if (l.multiplyDragByVelocity) drag *= speed * speed;
          const factor = Math.max(0, 1 - drag / speed);
          vx *= factor;
          vy *= factor;
          vz *= factor;
        }
        // Store only the correction; lifecycle velocity is evaluated again next step.
        this.velocities[o] = this.velocities[o]! + vx - beforeX;
        this.velocities[o + 1] = this.velocities[o + 1]! + vy - beforeY;
        this.velocities[o + 2] = this.velocities[o + 2]! + vz - beforeZ;
      }
      if (this.renderVelocities) {
        this.renderVelocities[o] = vx * multiplier;
        this.renderVelocities[o + 1] = vy * multiplier;
        this.renderVelocities[o + 2] = vz * multiplier;
      }
      vx = vx * multiplier - orbitalX;
      vy = vy * multiplier - orbitalY;
      vz = vz * multiplier - orbitalZ;
      if (this.noise && this.noiseEvaluator) {
        const n = this.noise;
        this.noiseEvaluator.sample(x, y, z, t, rnd, this.scratch);
        const amount = scalar(n.positionAmount, t, rnd(31), 1) * dt;
        x += this.scratch[0]! * amount;
        y += this.scratch[1]! * amount;
        z += this.scratch[2]! * amount;
        const rotation = scalar(n.rotationAmount, t, rnd(35)) * (Math.PI / 360) * dt;
        if (this.main.rotation3d) {
          this.rotations[o] = this.rotations[o]! + this.scratch[0]! * rotation;
          this.rotations[o + 1] = this.rotations[o + 1]! + this.scratch[1]! * rotation;
        }
        this.rotations[o + 2] = this.rotations[o + 2]! + this.scratch[2]! * rotation;
        if (this.noiseSizes) {
          const size = scalar(n.sizeAmount, t, rnd(36)) * 0.5;
          for (let axis = 0; axis < 3; axis++)
            this.noiseSizes[o + axis] = 1 + this.scratch[axis]! * size;
        }
      }
      this.positions[o] = x + vx * dt;
      this.positions[o + 1] = y + vy * dt;
      this.positions[o + 2] = z + vz * dt;
      this.ages[i] = age;
      this.updateCustom(i, t);
      i++;
    }
    if (this.emitting && this.started) {
      const end = this.time + dt;
      this.bursts(this.time, end);
      const activeDt = this.main.loop
        ? dt
        : Math.max(
            0,
            Math.min(end, this.main.durationSeconds) -
              Math.min(this.time, this.main.durationSeconds),
          );
      this.carry +=
        scalar(
          this.emission?.rateOverTime,
          (this.time % this.main.durationSeconds) / this.main.durationSeconds,
          random(this.seed, 0, 90),
        ) * activeDt;
      const amount = Math.floor(this.carry + 1e-8);
      this.carry -= amount;
      this.emit(amount, undefined, end);
      this.time = end;
    }
  }
  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.ages, this.lifetimes, this.serials]) a[i] = a[last]!;
    for (const a of [this.positions, this.velocities, this.startSizes, this.rotations])
      a.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.noiseSizes?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.renderVelocities?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.customData?.copyWithin(i * 8, last * 8, last * 8 + 8);
    this.startColors.copyWithin(i * 4, last * 4, last * 4 + 4);
  }
}
