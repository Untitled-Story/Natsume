import { mat4, vec3 } from 'gl-matrix';
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
import { NoiseQuality } from '../format/generated/noa/ir/noise-quality.js';
import { SheetTime } from '../format/generated/noa/ir/sheet-time.js';
import { SheetAnimation } from '../format/generated/noa/ir/sheet-animation.js';
import { CustomDataMode } from '../format/generated/noa/ir/custom-data-mode.js';
import { scalar, color, random, validateParameters, constantZero } from './parameters.js';
import { CurlNoiseField } from '../particles/noise/curl-field.js';
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
  check(
    p && (p.mode === 0 || p.mode === 2),
    'CAPABILITY',
    'Prewarm requires Constant/TwoConstants lifetime',
  );
  const lifetime = Math.max(1e-6, scalar(p, 0, 0), scalar(p, 0, 1));
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
  readonly prewarmSeconds: number;
  readonly delaySeconds: number;
  readonly shapeMatrix = mat4.create();
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
    approximateNoise: boolean,
    diagnostics: Diagnostic[],
  ) {
    const main = source.main!;
    this.main = main;
    validateParameters(source);
    check(
      main.space === Space.Local && main.scaling === ScalingMode.Local,
      'CAPABILITY',
      `System ${id}: playback supports local simulation/scaling`,
    );
    check(
      constantZero(main.gravityMultiplier),
      'CAPABILITY',
      `System ${id}: gravity is not supported`,
    );
    check(
      main.flipRotationProbability === 0,
      'CAPABILITY',
      `System ${id}: rotation flip is not supported`,
    );
    this.delaySeconds = Math.max(0, scalar(main.startDelay, 0, random(instanceSeed, id, 70)));
    this.delayRemaining = this.delaySeconds;
    check(main.maxParticles <= 100_000, 'LIMIT', 'Emitter capacity exceeds playback limit');
    check(
      main.durationSeconds >= 1 / 60 && main.simulationSpeed === 1,
      'CAPABILITY',
      'Initial playback requires duration >= 1/60 second and simulation speed 1',
    );
    this.prewarmSeconds = prewarmDuration(main);
    check(
      this.prewarmSeconds <= 30 &&
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
    check(
      !this.velocityModule || this.velocityModule.space === Space.Local,
      'CAPABILITY',
      'World velocity module unsupported',
    );
    if (this.limit)
      check(
        !this.limit.separateAxes &&
          this.limit.space === Space.Local &&
          constantZero(this.limit.drag),
        'CAPABILITY',
        'Initial limit velocity supports scalar local limit without drag',
      );
    if (this.sheet)
      check(
        this.sheet.timeMode === SheetTime.Lifetime &&
          this.sheet.animation === SheetAnimation.WholeSheet &&
          (this.sheet.uvChannelMask & 1) !== 0,
        'CAPABILITY',
        'Initial texture sheets support lifetime, whole-sheet UV0',
      );
    for (const s of this.custom?.streams ?? [])
      check(
        s.mode === CustomDataMode.Disabled ||
          (s.slot === 0 && s.mode === CustomDataMode.Vector && s.vectorComponents === 1),
        'CAPABILITY',
        'Only Custom1.x vector stream is supported',
      );
    this.seed =
      main.seedMode === SeedMode.Fixed
        ? main.seed
        : Math.floor(random(instanceSeed, id, 0) * 4294967296);
    if (this.noise) {
      const n = this.noise;
      check(approximateNoise, 'CAPABILITY', 'Unity Noise requires explicit approximateNoise: true');
      check(
        n.algorithm === 'unity-particle-noise' &&
          n.algorithmRevision === 1 &&
          n.quality === NoiseQuality.High &&
          n.octaves === 1 &&
          !n.remapEnabled &&
          constantZero(n.scrollSpeed) &&
          constantZero(n.rotationAmount) &&
          constantZero(n.sizeAmount) &&
          n.frequency > 0,
        'CAPABILITY',
        'Noise approximation supports High/one octave, no scroll/remap, position only',
      );
      this.field = new CurlNoiseField(this.seed, n.frequency);
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
    this.startSizes = new Float32Array(cap * 3);
    this.rotations = new Float32Array(cap * 3);
    this.startColors = new Float32Array(cap * 4);
    this.ages = new Float32Array(cap);
    this.lifetimes = new Float32Array(cap);
    this.serials = new Uint32Array(cap);
  }
  reset(): void {
    this.count = 0;
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
    const active = this.enabled && this.node.activeInHierarchy;
    if (active === this.enabledLast) return;
    this.enabledLast = active;
    if (!active) {
      this.clear();
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
    if (this.prewarmSeconds) {
      const steps = Math.ceil(this.prewarmSeconds * 60);
      for (let i = 0; i < steps; i++) this.step(Math.min(1 / 60, this.prewarmSeconds - i / 60));
    }
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
            );
        }
      }
  }
  private emit(
    amount: number,
    phase = (this.time % this.main.durationSeconds) / this.main.durationSeconds,
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
      this.lifetimes[i] = Math.max(1e-6, scalar(this.main.lifetime, t, rnd(0)));
      let x = 0,
        y = 0,
        z = 0,
        dx = 0,
        dy = 0,
        dz = 1;
      if (this.shape) {
        sampleShape(this.shape, this.seed, serial, t, n, amount, this.birth);
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
      color(this.main.color, t, rnd(11), this.startColors, i * 4);
    }
  }
  step(delta: number): void {
    if (!this.enabledLast) return;
    let dt = delta * this.main.simulationSpeed;
    if (this.delayRemaining > 0) {
      this.delayRemaining -= dt;
      if (this.delayRemaining > 0) return;
      dt = -this.delayRemaining;
      this.delayRemaining = 0;
      this.bursts(-Number.EPSILON, 0);
      if (this.prewarmSeconds) {
        const steps = Math.ceil(this.prewarmSeconds * 60);
        for (let i = 0; i < steps; i++) this.step(Math.min(1 / 60, this.prewarmSeconds - i / 60));
      }
      if (dt <= 0) return;
    }
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
          rotationTime = this.ages[i]! / this.lifetimes[i]!;
        if (r.separateAxes) {
          this.rotations[o] =
            this.rotations[o]! + scalar(r.angularVelocity?.x, rotationTime, rnd(60)) * dt;
          this.rotations[o + 1] =
            this.rotations[o + 1]! + scalar(r.angularVelocity?.y, rotationTime, rnd(61)) * dt;
        }
        this.rotations[o + 2] =
          this.rotations[o + 2]! + scalar(r.angularVelocity?.z, rotationTime, rnd(62)) * dt;
      }
      let x = this.positions[o]!,
        y = this.positions[o + 1]!,
        z = this.positions[o + 2]!;
      let vx = this.velocities[o]!,
        vy = this.velocities[o + 1]!,
        vz = this.velocities[o + 2]!;
      let orbitalX = 0,
        orbitalY = 0,
        orbitalZ = 0,
        multiplier = 1;
      const v = this.velocityModule;
      if (v) {
        vx += scalar(v.linear?.x, t, rnd(20));
        vy += scalar(v.linear?.y, t, rnd(21));
        vz += scalar(v.linear?.z, t, rnd(22));
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
        const speed = Math.hypot(vx, vy, vz),
          limit = scalar(this.limit.limit?.x, t, rnd(40));
        if (speed > limit) {
          const factor = (limit + (speed - limit) * limitDecay) / speed;
          // Native GetParticles stores the correction to the base velocity;
          // lifecycle velocity is added again on the next step.
          this.velocities[o] = this.velocities[o]! + vx * (factor - 1);
          this.velocities[o + 1] = this.velocities[o + 1]! + vy * (factor - 1);
          this.velocities[o + 2] = this.velocities[o + 2]! + vz * (factor - 1);
          vx *= factor;
          vy *= factor;
          vz *= factor;
        }
      }
      if (this.renderVelocities) {
        this.renderVelocities[o] = vx * multiplier;
        this.renderVelocities[o + 1] = vy * multiplier;
        this.renderVelocities[o + 2] = vz * multiplier;
      }
      vx = vx * multiplier - orbitalX;
      vy = vy * multiplier - orbitalY;
      vz = vz * multiplier - orbitalZ;
      if (this.noise && this.field) {
        const n = this.noise;
        this.field.sample(x, y, z, this.scratch);
        const amount =
          scalar(n.positionAmount, t, rnd(31), 1) * (n.damping ? 1 / n.frequency : 1) * dt;
        const strength = scalar(n.strength?.x, t, rnd(32));
        x += this.scratch[0]! * strength * amount;
        y +=
          this.scratch[1]! *
          (n.separateAxes ? scalar(n.strength?.y, t, rnd(33)) : strength) *
          amount;
        z +=
          this.scratch[2]! *
          (n.separateAxes ? scalar(n.strength?.z, t, rnd(34)) : strength) *
          amount;
      }
      this.positions[o] = x + vx * dt;
      this.positions[o + 1] = y + vy * dt;
      this.positions[o + 2] = z + vz * dt;
      this.ages[i] = age;
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
      this.emit(amount);
      this.time = end;
    }
  }
  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.ages, this.lifetimes, this.serials]) a[i] = a[last]!;
    for (const a of [this.positions, this.velocities, this.startSizes, this.rotations])
      a.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.renderVelocities?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.startColors.copyWithin(i * 4, last * 4, last * 4 + 4);
  }
}
