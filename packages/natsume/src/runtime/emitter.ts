import {
  advanceLifetimeProgress,
  lifetimeProgressAge,
  reciprocalLifetime,
} from './particle-clock.js';
import { mat4, quat, vec3 } from 'gl-matrix';
import { check } from '../errors.js';
import { SpriteShapeSampler } from './sprite-shape.js';
import { ShapeGeometry } from '../format/generated/noa/ir/shape-geometry.js';
import type { SpriteShapeT } from '../format/generated/noa/ir/sprite-shape.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { EmissionModuleT } from '../format/generated/noa/ir/emission-module.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import type { RotationModuleT } from '../format/generated/noa/ir/rotation-module.js';
import type { ColorModuleT } from '../format/generated/noa/ir/color-module.js';
import type { ColorBySpeedModuleT } from '../format/generated/noa/ir/color-by-speed-module.js';
import type { ForceModuleT } from '../format/generated/noa/ir/force-module.js';
import type { ExternalForcesModuleT } from '../format/generated/noa/ir/external-forces-module.js';
import {
  selectForceFields,
  type ParticleForceQuery,
  type ParticleForceField,
} from './particle-force-fields.js';
import type { InheritVelocityModuleT } from '../format/generated/noa/ir/inherit-velocity-module.js';
import type { LifetimeByEmitterSpeedModuleT } from '../format/generated/noa/ir/lifetime-by-emitter-speed-module.js';
import type { ParticleEnvironment } from '../rendering/particle-environment.js';
import { EmitterVelocityMode } from '../format/generated/noa/ir/emitter-velocity-mode.js';
import type { SizeBySpeedModuleT } from '../format/generated/noa/ir/size-by-speed-module.js';
import type { RotationBySpeedModuleT } from '../format/generated/noa/ir/rotation-by-speed-module.js';
import { speedPhase, speedSize } from './speed-modules.js';
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
import { sampleShape } from './shapes.js';
import { SheetTime } from '../format/generated/noa/ir/sheet-time.js';
import { CustomDataMode } from '../format/generated/noa/ir/custom-data-mode.js';
import { scalar, color, random, constantZero } from './parameters.js';
import { ParticleNoise } from '../particles/noise/particle-noise.js';
import type { SceneNode } from './scene.js';
import { maximumLifetime, prewarmDuration } from './prewarm.js';
export { prewarmDuration } from './prewarm.js';
import { emitterSupport } from './emitter-support.js';
import { assertSupport } from './support-checks.js';
import type { ParticleSnapshot } from './particle-snapshot.js';
import { ParticleCollisions } from './particle-collisions.js';
import type { CollisionModuleT } from '../format/generated/noa/ir/collision-module.js';
import type { ParticleCollisionEvent } from './particle-physics.js';
import type { ParticleTriggerEvent } from './particle-physics.js';
import { ParticleTriggers } from './particle-triggers.js';
import type { TriggerModuleT } from '../format/generated/noa/ir/trigger-module.js';
import type { LightsModuleT } from '../format/generated/noa/ir/lights-module.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import { ParticleLights } from './particle-lights.js';

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly componentId?: number;
}

/** Dense SoA particle storage. Random channels persist through compaction via serial IDs. */
export class Emitter {
  readonly main: NonNullable<R<ParticleSystemT>['main']>;
  readonly emission: R<EmissionModuleT> | undefined;
  readonly shape: R<ShapeModuleT> | undefined;
  readonly colorModule: R<ColorModuleT> | undefined;
  readonly colorBySpeed: R<ColorBySpeedModuleT> | undefined;
  readonly forceModule: R<ForceModuleT> | undefined;
  readonly collision: ParticleCollisions | undefined;
  readonly trigger: ParticleTriggers | undefined;
  readonly lights: ParticleLights | undefined;
  readonly externalForces: R<ExternalForcesModuleT> | undefined;
  private externalFields: readonly ParticleForceField[] = [];
  private readonly forcePosition = new Float64Array(3);
  private readonly forceVelocity = new Float64Array(3);
  private readonly forceOutput = new Float64Array(3);
  private readonly forceQuery: ParticleForceQuery & {
    deltaSeconds: number;
    timeSeconds: number;
    normalizedAge: number;
    particleId: number;
    systemId: number;
  } = {
    position: this.forcePosition,
    velocity: this.forceVelocity,
    deltaSeconds: 0,
    timeSeconds: 0,
    normalizedAge: 0,
    systemId: 0,
    particleId: 0,
  };
  readonly inheritVelocity: R<InheritVelocityModuleT> | undefined;
  readonly lifetimeByEmitterSpeed: R<LifetimeByEmitterSpeedModuleT> | undefined;
  readonly emitterVelocity = new Float64Array(3);
  private readonly lastVelocityPosition = new Float64Array(3);
  readonly sizeBySpeed: R<SizeBySpeedModuleT> | undefined;
  readonly rotationBySpeed: R<RotationBySpeedModuleT> | undefined;
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
  readonly moduleSpeeds: Float32Array | undefined;
  readonly startSizes: Float32Array;
  readonly rotations: Float32Array;
  readonly startColors: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  private birthStepSeconds: Float32Array | undefined;
  private lifetimeProgress: Float32Array | undefined;
  private inverseLifetimes: Float32Array | undefined;
  private subAges: Float64Array | undefined;
  /** @internal Historical survival is evaluated before connected prewarm births are integrated. */
  deferPrewarmParticles = false;
  readonly serials: Uint32Array;
  subParentSystems: Uint32Array | undefined;
  subParentParticles: Uint32Array | undefined;
  seed: number;
  private readonly initialSeed: number;
  private playbackSeedAssigned = false;
  field: ParticleNoise['field'] | undefined;
  readonly noiseSizes: Float32Array | undefined;
  private noiseEvaluator: ParticleNoise | undefined;
  prewarmSeconds: number;
  private maximumBirthLifetime: number;
  requiresAnimatedGravity = false;
  private lifetimeMin = NaN;
  private lifetimeMax = NaN;
  private lifetimeMultiplier = NaN;
  private lifetimeLoop = false;
  readonly delaySeconds: number;
  readonly shapeMatrix = mat4.create();
  readonly simulationMatrix = mat4.create();
  readonly inverseSimulationMatrix = mat4.create();
  readonly emitterMatrix = mat4.create();
  readonly particleScale = vec3.fromValues(1, 1, 1);
  private readonly vectorMatrix = mat4.create();
  private readonly orbitalRotation = quat.create();
  private readonly inverseOrbitalRotation = quat.create();
  private readonly orbitalOrigin = vec3.create();
  private readonly limitRotation = quat.create();
  private readonly inverseLimitRotation = quat.create();
  gravity: readonly [number, number, number] = [0, 0, 0];
  private readonly scratch = new Float64Array(3);
  private readonly colorScratch = new Float32Array(4);
  private forceStep = 0;
  private readonly initialInheritedVelocities: Float32Array | undefined;
  private readonly bakeInitialInheritance: boolean;
  private readonly direction = vec3.create();
  private readonly birth = new Float64Array(10);
  private readonly spriteShape: SpriteShapeSampler | undefined;
  private nextSerial = 0;
  private ringWrite = 0;
  private readonly retiredRingPools: Emitter[] = [];
  private retiredRingCount = 0;
  private readonly retireRingDeaths: boolean;
  /** @internal Replaced looping particles complete their last lifetime outside the visible pool. */
  onRingDeath: ((pool: Emitter, index: number) => void) | undefined;
  onBirth: ((index: number, phase: number) => void) | undefined;
  onDeath: ((index: number) => void) | undefined;
  onCollision: ((index: number) => void) | undefined;
  onCollisionMessage: ((event: ParticleCollisionEvent) => void) | undefined;
  onTrigger: ((index: number) => void) | undefined;
  onTriggerMessage: ((event: ParticleTriggerEvent) => void) | undefined;
  onClear: (() => void) | undefined;
  onDisable: (() => void) | undefined;
  /** @internal Birth-driven systems emit through parent channels, even after Play(). */
  birthDriven = false;
  /** @internal Timeline owns the clock, and Simulate does not use Play's prewarm. */
  timelineControlled = false;
  onAdvanced: ((seconds: number) => void) | undefined;
  /** @internal A graph defers warming until all participating systems are initialized. */
  onPrewarm: (() => void) | undefined;
  private subBirth:
    | { parent: ParticleSnapshot; properties: number; parentSystem: number }
    | undefined;
  private time = 0;
  /** @internal Source simulation time, excluding wall-clock pause. */
  get elapsedSeconds(): number {
    return this.main.loop ? this.time % this.main.durationSeconds : this.time;
  }
  private burstTime = 0;
  private burstCycle = 0;
  private readonly burstRepeats = new Map<number, number>();
  private carry = 0;
  private nativeRateCarry = 0;
  private warming = false;
  private warmStart = 0;
  private rateTime = 0;
  private rateSpacing = 0;
  private pendingPrewarmTime = 0;
  private distanceCarry = 0;
  private distanceStarted = false;
  private readonly lastEmissionPosition = new Float64Array(3);
  private enabledLast = false;
  private started = false;
  private delayRemaining = 0;
  count = 0;
  emitting = true;
  visible = true;
  private culledSeconds = 0;
  private wasCulled = false;
  constructor(
    readonly id: number,
    readonly node: SceneNode,
    readonly source: R<ParticleSystemT>,
    readonly enabled: boolean,
    instanceSeed: number,
    private readonly diagnostics: Diagnostic[],
    gravity?: readonly [number, number, number],
    readonly customSpaceNode?: SceneNode,
    private readonly pack?: EffectPack,
    public environment?: ParticleEnvironment,
    private readonly sceneNodes?: ReadonlyMap<number, SceneNode>,
  ) {
    const main = source.main!;
    this.main = main;
    this.retireRingDeaths = source.modules.some(
      (module) =>
        module.dataType === M.SubEmittersModule &&
        (module.data as R<SubEmittersModuleT>).emitters.some(
          (edge) => edge.systemComponentId && edge.event === 2,
        ),
    );
    assertSupport(
      emitterSupport(
        source,
        gravity,
        !!customSpaceNode,
        environment,
        sceneNodes ? new Set(sceneNodes.keys()) : new Set([node.id]),
      ),
    );
    this.setGravity(this.resolveEnvironment(environment, gravity));
    check(
      main.space !== Space.Custom || customSpaceNode,
      'HOST',
      `System ${id}: custom simulation node is unavailable`,
    );
    this.updateSpace();
    this.lastEmissionPosition.set([
      this.node.worldMatrix[12]!,
      this.node.worldMatrix[13]!,
      this.node.worldMatrix[14]!,
    ]);
    this.lastVelocityPosition.set(this.lastEmissionPosition);
    this.updateEmitterVelocity(0);
    this.delaySeconds = Math.max(0, scalar(main.startDelay, 0, random(instanceSeed, id, 70)));
    this.delayRemaining = this.delaySeconds;
    this.distanceStarted = this.delaySeconds > 0;
    this.prewarmSeconds = prewarmDuration(main, source.modules);
    this.maximumBirthLifetime = maximumLifetime(main, source.modules);
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
        case M.ColorBySpeedModule:
          this.colorBySpeed = m.data as R<ColorBySpeedModuleT>;
          break;
        case M.ForceModule:
          this.forceModule = m.data as R<ForceModuleT>;
          break;
        case M.ExternalForcesModule:
          this.externalForces = m.data as R<ExternalForcesModuleT>;
          break;
        case M.CollisionModule:
          this.collision = new ParticleCollisions(m.data as R<CollisionModuleT>, sceneNodes);
          break;
        case M.TriggerModule:
          this.trigger = new ParticleTriggers(m.data as R<TriggerModuleT>);
          break;
        case M.LightsModule:
          this.lights = new ParticleLights(m.data as R<LightsModuleT>, diagnostics);
          break;
        case M.InheritVelocityModule:
          this.inheritVelocity = m.data as R<InheritVelocityModuleT>;
          break;
        case M.LifetimeByEmitterSpeedModule:
          this.lifetimeByEmitterSpeed = m.data as R<LifetimeByEmitterSpeedModuleT>;
          break;
        case M.SizeBySpeedModule:
          this.sizeBySpeed = m.data as R<SizeBySpeedModuleT>;
          break;
        case M.RotationBySpeedModule:
          this.rotationBySpeed = m.data as R<RotationBySpeedModuleT>;
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
        case M.SubEmittersModule:
        case M.TrailsModule:
          // The instance graph owns cross-system scheduling.
          break;
        default:
          check(false, 'CAPABILITY', `System ${id}: unsupported particle module ${M[m.dataType]}`);
      }
    }
    if (this.shape) {
      const s = this.shape;
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
    this.initialSeed = this.seed;
    if (this.noise) {
      const n = this.noise;
      this.noiseEvaluator = new ParticleNoise(n, this.seed);
      this.field = this.noiseEvaluator.field;
      if (!constantZero(n.sizeAmount))
        this.noiseSizes = new Float32Array(main.maxParticles * 3).fill(1);
      diagnostics.push({
        code: 'APPROXIMATE_NOISE',
        componentId: id,
        message:
          'Noise uses measured Perlin curl fields; unmeasured parameter combinations may differ from Unity.',
      });
    }
    const cap = main.maxParticles;
    this.bakeInitialInheritance =
      this.inheritVelocity?.mode === 0 && [0, 2].includes(this.inheritVelocity.multiplier!.mode);
    if (this.inheritVelocity?.mode === 0 && !this.bakeInitialInheritance)
      this.initialInheritedVelocities = new Float32Array(cap * 3);
    this.positions = new Float32Array(cap * 3);
    this.velocities = new Float32Array(cap * 3);
    if (this.sizeBySpeed || this.rotationBySpeed || this.colorBySpeed)
      this.moduleSpeeds = new Float32Array(cap);
    if (this.shape?.geometryType === ShapeGeometry.SpriteShape) {
      check(pack, 'CAPABILITY', 'Sprite emission requires source assets');
      this.spriteShape = new SpriteShapeSampler(pack, this.shape.geometry as R<SpriteShapeT>);
    }
    if (this.velocityModule || this.sheet?.timeMode === SheetTime.Speed || this.inheritVelocity)
      this.renderVelocities = new Float32Array(cap * 3);
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
  /** Animated lifetime endpoints affect future births and the bounded prewarm window. */
  refreshAnimatedParameters(): void {
    const p = this.main.lifetime!;
    if (
      p.constantMin === this.lifetimeMin &&
      p.constantMax === this.lifetimeMax &&
      p.multiplier === this.lifetimeMultiplier &&
      this.main.loop === this.lifetimeLoop
    )
      return;
    this.lifetimeMin = p.constantMin;
    this.lifetimeMax = p.constantMax;
    this.lifetimeMultiplier = p.multiplier;
    this.lifetimeLoop = this.main.loop;
    this.prewarmSeconds = prewarmDuration(this.main, this.source.modules);
    this.maximumBirthLifetime = maximumLifetime(this.main, this.source.modules);
  }
  setGravity(value: readonly [number, number, number] | undefined): void {
    this.gravity = this.resolveGravity(value);
  }
  /** @internal Resolves host inputs before an environment replacement is committed. */
  resolveEnvironment(
    value: ParticleEnvironment | undefined,
    fallbackGravity?: readonly [number, number, number],
  ): readonly [number, number, number] {
    const velocity = value?.rigidbodyVelocities?.[String(this.main.hostRigidbodyVelocitySlot)];
    check(
      this.main.emitterVelocityMode !== EmitterVelocityMode.Rigidbody ||
        (velocity && velocity.length === 3 && velocity.every(Number.isFinite)),
      'HOST',
      `System ${this.id}: missing Rigidbody velocity slot ${this.main.hostRigidbodyVelocitySlot}`,
    );
    if (this.externalForces) selectForceFields(this.externalForces, value?.forceFields);
    const collision = this.collision?.definition;
    const lightSlot = this.lights?.definition.light?.hostSlot;
    check(
      !lightSlot || value?.lights?.[String(lightSlot)],
      'HOST',
      `Missing particle light template ${lightSlot}`,
    );
    if (this.trigger)
      for (const reference of this.trigger.definition.colliders)
        check(
          !reference.hostSlot || value?.colliders?.[String(reference.hostSlot)]?.sweepSphere,
          'HOST',
          `Missing particle collider ${reference.hostSlot}`,
        );
    check(
      !collision ||
        collision.type === 0 ||
        value?.physicsWorlds?.[String(collision.hostPhysicsSlot)],
      'HOST',
      `System ${this.id}: missing physics world ${collision?.hostPhysicsSlot}`,
    );
    return this.resolveGravity(
      this.main.gravitySource === 1
        ? value?.gravity2D && [value.gravity2D[0], value.gravity2D[1], 0]
        : (value?.gravity ?? fallbackGravity),
    );
  }
  private inheritedVector(offset: number): Float64Array {
    if (this.inheritVelocity!.mode !== 0)
      return this.vector(
        this.emitterVelocity[0]!,
        this.emitterVelocity[1]!,
        this.emitterVelocity[2]!,
        false,
      );
    for (let axis = 0; axis < 3; axis++)
      this.scratch[axis] = this.initialInheritedVelocities![offset + axis]!;
    return this.scratch;
  }
  private updateEmitterVelocity(delta: number): void {
    const m = this.node.worldMatrix;
    const mode = this.main.emitterVelocityMode;
    const velocity =
      this.environment?.rigidbodyVelocities?.[String(this.main.hostRigidbodyVelocitySlot)];
    const custom = this.main.customEmitterVelocity!;
    for (let axis = 0; axis < 3; axis++) {
      this.emitterVelocity[axis] =
        mode === EmitterVelocityMode.Rigidbody
          ? velocity![axis]!
          : mode === EmitterVelocityMode.Custom
            ? axis === 0
              ? custom.x
              : axis === 1
                ? custom.y
                : custom.z
            : delta > 0
              ? (m[12 + axis]! - this.lastVelocityPosition[axis]!) / delta
              : 0;
      this.lastVelocityPosition[axis] = m[12 + axis]!;
    }
  }
  /** @internal Validates gravity before committing an environment replacement. */
  resolveGravity(
    value: readonly [number, number, number] | undefined,
  ): readonly [number, number, number] {
    const authored = this.main.gravity;
    check(
      (!this.requiresAnimatedGravity && constantZero(this.main.gravityMultiplier)) ||
        value !== undefined ||
        authored,
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
    const scale = this.node.localScale;
    if (this.main.scaling === ScalingMode.Hierarchy) {
      mat4.copy(this.emitterMatrix, this.node.worldMatrix);
      const r = mat4.fromQuat(this.vectorMatrix, this.node.worldRotation),
        w = this.node.worldMatrix;
      for (let axis = 0; axis < 3; axis++) {
        const o = axis * 4;
        this.particleScale[axis] = r[o]! * w[o]! + r[o + 1]! * w[o + 1]! + r[o + 2]! * w[o + 2]!;
      }
    } else {
      vec3.set(
        this.particleScale,
        this.main.scaling === ScalingMode.Shape ? 1 : scale.x,
        this.main.scaling === ScalingMode.Shape ? 1 : scale.y,
        this.main.scaling === ScalingMode.Shape ? 1 : scale.z,
      );
      mat4.fromRotationTranslationScale(
        this.emitterMatrix,
        this.node.worldRotation,
        [this.node.worldMatrix[12]!, this.node.worldMatrix[13]!, this.node.worldMatrix[14]!],
        this.particleScale,
      );
    }
    if (frame === this.node) mat4.copy(this.simulationMatrix, this.emitterMatrix);
    else if (frame) mat4.copy(this.simulationMatrix, frame.worldMatrix);
    else mat4.identity(this.simulationMatrix);
    // Zero scale is valid. Rotation-only fallback preserves finite simulation in a collapsed frame.
    if (!mat4.invert(this.inverseSimulationMatrix, this.simulationMatrix)) {
      mat4.fromQuat(this.inverseSimulationMatrix, frame!.worldRotation);
      mat4.transpose(this.inverseSimulationMatrix, this.inverseSimulationMatrix);
    }
    mat4.multiply(this.vectorMatrix, this.inverseSimulationMatrix, this.emitterMatrix);
    // Native limit axes use inverse module rotation relative to the simulation frame.
    // Scale does not scale their thresholds.
    if (this.limit?.space === Space.Local) {
      quat.conjugate(this.limitRotation, this.node.worldRotation);
      if (frame) quat.multiply(this.limitRotation, this.limitRotation, frame.worldRotation);
    } else if (frame) quat.copy(this.limitRotation, frame.worldRotation);
    else quat.identity(this.limitRotation);
    quat.conjugate(this.inverseLimitRotation, this.limitRotation);
    if (frame) quat.conjugate(this.orbitalRotation, frame.worldRotation);
    else quat.identity(this.orbitalRotation);
    quat.multiply(this.orbitalRotation, this.orbitalRotation, this.node.worldRotation);
    quat.conjugate(this.inverseOrbitalRotation, this.orbitalRotation);
    vec3.set(
      this.orbitalOrigin,
      this.node.worldMatrix[12]!,
      this.node.worldMatrix[13]!,
      this.node.worldMatrix[14]!,
    );
    vec3.transformMat4(this.orbitalOrigin, this.orbitalOrigin, this.inverseSimulationMatrix);
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
    this.clearRetiredRingParticles();
    this.lights?.clear();
    this.trigger?.clear();
    this.onClear?.();
    this.count = 0;
    this.noiseEvaluator?.reset();
    this.nextSerial = 0;
    this.ringWrite = 0;
    this.forceStep = 0;
    this.culledSeconds = 0;
    this.wasCulled = false;
    this.time = 0;
    this.rateTime = 0;
    this.rateSpacing = 0;
    this.pendingPrewarmTime = 0;
    this.burstTime = this.burstCycle = 0;
    this.burstRepeats.clear();
    this.carry = 0;
    this.nativeRateCarry = 0;
    this.distanceCarry = 0;
    this.distanceStarted = this.delaySeconds > 0;
    this.lastEmissionPosition.set([
      this.node.worldMatrix[12]!,
      this.node.worldMatrix[13]!,
      this.node.worldMatrix[14]!,
    ]);
    this.lastVelocityPosition.set(this.lastEmissionPosition);
    this.updateEmitterVelocity(0);
    this.started = false;
    this.delayRemaining = this.delaySeconds;
    this.distanceStarted = this.delaySeconds > 0;
    this.enabledLast = false;
    this.emitting = true;
  }
  clear(): void {
    this.clearRetiredRingParticles();
    this.lights?.clear();
    this.trigger?.clear();
    this.onClear?.();
    this.count = 0;
    this.ringWrite = 0;
  }
  /** @internal A stopped root drains its particles before releasing its graph update. */
  get graphPlaying(): boolean {
    return (
      this.enabledLast &&
      (this.count > 0 ||
        (this.started &&
          this.emitting &&
          (this.main.loop || this.time < this.main.durationSeconds)))
    );
  }
  sync(): void {
    this.updateSpace();
    const active = this.enabled && this.node.activeInHierarchy;
    if (active === this.enabledLast) return;
    this.enabledLast = active;
    for (let axis = 0; axis < 3; axis++)
      this.lastVelocityPosition[axis] = this.node.worldMatrix[12 + axis]!;
    this.updateEmitterVelocity(0);
    if (!active) {
      this.culledSeconds = 0;
      this.wasCulled = false;
      this.clearRetiredRingParticles();
      this.lights?.clear();
      this.trigger?.clear();
      this.onDisable?.();
      this.count = 0;
      this.noiseEvaluator?.reset();
      this.started = false;
      this.delayRemaining = this.delaySeconds;
      this.distanceStarted = this.delaySeconds > 0;
      this.time = 0;
      this.rateTime = 0;
      this.rateSpacing = 0;
      this.pendingPrewarmTime = 0;
      this.warming = false;
      this.burstTime = this.burstCycle = 0;
      this.burstRepeats.clear();
      this.carry = 0;
      this.nativeRateCarry = 0;
      this.distanceCarry = 0;
      this.distanceStarted = this.delaySeconds > 0;
      this.lastEmissionPosition.set([
        this.node.worldMatrix[12]!,
        this.node.worldMatrix[13]!,
        this.node.worldMatrix[14]!,
      ]);
    } else if (this.main.playOnEnable && this.emitting) this.start(!this.timelineControlled);
  }
  /** @internal Timeline owns simulation and supplies an automatic seed explicitly. */
  setPlaybackSeed(seed: number): void {
    if (this.main.seedMode === SeedMode.Fixed || this.playbackSeedAssigned) return;
    this.playbackSeedAssigned = true;
    this.reseed(Math.max(1, seed >>> 0));
  }
  /** @internal Restores per-instance randomness when restarting outside a controlled graph. */
  restorePlaybackSeed(): void {
    this.playbackSeedAssigned = false;
    this.reseed(this.initialSeed);
  }
  private reseed(seed: number): void {
    if (this.seed === seed) return;
    this.seed = seed;
    if (this.noise) {
      this.noiseEvaluator = new ParticleNoise(this.noise, this.seed);
      this.field = this.noiseEvaluator.field;
    }
  }
  start(warm = true): void {
    if (this.started) return;
    this.started = true;
    if (this.delayRemaining > 0) return;
    if (!this.birthDriven) this.bursts(-Number.EPSILON, 0);
    if (warm) this.prewarm();
  }
  private prewarm(): void {
    if (!this.main.simulationSpeed || !this.prewarmSeconds) return;
    if (this.onPrewarm) {
      this.onPrewarm();
      return;
    }
    this.pendingPrewarmTime = this.runPrewarm((seconds) => this.advance(seconds));
  }

  /** @internal Advance the complete history when descendants can outlive the source. */
  prewarmGraph(
    advance: (seconds: number, remaining: number) => void,
    historyLifetime: number,
  ): number {
    this.warming = true;
    const duration =
      Math.ceil(historyLifetime / this.main.durationSeconds) * this.main.durationSeconds;
    // Play starts at time zero; its prewarm window has no fixed-step remainder.
    const history = Math.fround(historyLifetime);
    const skip = Math.max(0, Math.fround(duration - historyLifetime));
    this.warmStart = 0;
    this.time = Math.fround(skip % this.main.durationSeconds);
    this.rateTime = this.time;
    const substep = Math.fround(history / Math.ceil(Math.fround(history / Math.fround(0.03))));
    try {
      let remaining = history;
      while (remaining > 1e-6) {
        const delta = Math.min(substep, remaining);
        advance(delta, remaining);
        remaining = Math.fround(remaining - delta);
      }
      return 0;
    } finally {
      this.warming = false;
    }
  }

  /** @internal Integration time before remaining-lifetime getter rounding. */
  elapsedAge(index: number): number {
    return this.subAges?.[index] ?? this.ages[index]!;
  }
  /** @internal Emission uses percentage age before remaining-lifetime getter rounding. */
  channelAge(index: number, previousSeconds = 0): number {
    return this.lifetimeProgress
      ? Math.fround(
          Math.fround(
            Math.fround(
              this.lifetimeProgress[index]! -
                Math.fround(
                  Math.fround(Math.fround(previousSeconds) * 100) * this.inverseLifetimes![index]!,
                ),
            ) * Math.fround(0.01),
          ) / this.inverseLifetimes![index]!,
        )
      : this.elapsedAge(index);
  }

  /** @internal Birth channels integrate the source's partial first step. */
  setBirthStep(first: number, seconds: number): void {
    this.birthStepSeconds ??= new Float32Array(this.lifetimes.length).fill(NaN);
    for (let i = first; i < this.count; i++) this.birthStepSeconds[i] = seconds;
  }

  /** @internal Player-loop warm cohorts retain the native percentage-lifetime precision. */
  enableLifetimeProgress(): void {
    this.enableSubClock();
    if (this.lifetimeProgress) return;
    this.lifetimeProgress = new Float32Array(this.lifetimes.length);
    this.inverseLifetimes = new Float32Array(this.lifetimes.length);
    for (let i = 0; i < this.count; i++) {
      this.inverseLifetimes[i] = reciprocalLifetime(this.lifetimes[i]!);
      this.lifetimes[i] = Math.fround(1 / this.inverseLifetimes[i]!);
      this.lifetimeProgress[i] = Math.fround((this.ages[i]! / this.lifetimes[i]!) * 100);
    }
  }

  /** @internal Queued graph births do not receive the target's whole first integration step. */
  offsetPrewarmBirths(first: number, seconds: number): void {
    for (let i = first; i < this.count; i++) {
      if (this.lifetimeProgress)
        this.lifetimeProgress[i] = Math.fround(
          advanceLifetimeProgress(this.lifetimeProgress[i]!, -seconds, this.inverseLifetimes![i]!),
        );
      const age = this.lifetimeProgress ? this.progressAge(i) : this.ages[i]! - seconds;
      this.ages[i] = age;
      if (this.subAges) this.subAges[i] = Math.fround(this.subAges[i]! - seconds);
    }
  }

  /** @internal Restores a surviving virtual birth, then integrates only its native substep remainder. */
  finishPrewarmParticle(index: number, age: number, birth: () => void): void {
    this.ages[index] = 0;
    if (this.subAges) this.subAges[index] = 0;
    if (this.lifetimeProgress) this.lifetimeProgress[index] = 0;
    birth();
    this.advanceParticles(age, index, index + 1);
  }

  /** @internal Samples visible trail history after deferred particle integration. */
  finishPrewarmTrails(seconds: number): void {
    this.onAdvanced?.(seconds);
  }

  /** @internal Graph warming already supplies local simulation seconds. */
  advancePrewarm(seconds: number): void {
    this.advance(seconds);
  }

  private runPrewarm(advance: (seconds: number) => void): number {
    // Native standalone prewarm retains only the final maximum-lifetime window.
    this.warming = true;
    const historyLifetime = this.maximumBirthLifetime;
    const skip = Math.max(0, this.prewarmSeconds - historyLifetime);
    this.warmStart = skip;
    const fixedStep = Math.fround(0.02);
    try {
      const skippedSteps = Math.ceil(skip / 0.02);
      for (let i = 0; i < skippedSteps; i++) advance(Math.min(0.02, skip - i * 0.02));
      // Native prewarm drains complete 0.02 s steps from a Float32 lifetime window.
      // The remainder is consumed in whole substeps on the next update.
      let remaining = Math.fround(historyLifetime);
      while (remaining >= fixedStep) {
        advance(fixedStep);
        remaining = Math.fround(remaining - fixedStep);
      }
      return remaining > 1e-6 ? remaining : 0;
    } finally {
      this.warming = false;
    }
  }
  private repeatBursts(dt: number): void {
    const bursts = this.emission?.bursts;
    if (!bursts?.some((b) => b.intervalSeconds > 0 && b.cycles !== 1)) return;
    const initial = this.burstTime === 0 && this.burstCycle === 0;
    const duration = Math.fround(this.main.durationSeconds);
    const steps = Math.ceil(dt / Math.fround(0.03)),
      step = Math.fround(dt / steps);
    for (let i = 0; i < steps; i++) {
      this.burstTime = Math.fround(this.burstTime + step);
      if (this.main.loop && this.burstTime >= duration - 1e-8) {
        const cycles = Math.max(1, Math.floor((this.burstTime + 1e-8) / duration));
        this.burstTime = Math.fround(this.burstTime - cycles * duration);
        if (Math.abs(this.burstTime) < 1e-8) this.burstTime = 0;
        this.burstCycle += cycles;
        this.burstRepeats.clear();
      }
      for (const [index, b] of bursts.entries()) {
        if (
          b.intervalSeconds <= 0 ||
          b.cycles === 1 ||
          this.burstTime <= b.timeSeconds ||
          this.burstTime >= duration
        )
          continue;
        // Native samples one repetition index per substep; it does not replay
        // every event crossed by a large step, or repeat at the duration end.
        const repeat = Math.floor(
          Math.fround(Math.fround(this.burstTime - b.timeSeconds) / b.intervalSeconds),
        );
        if (
          repeat < 0 ||
          (b.cycles && repeat >= b.cycles) ||
          this.burstRepeats.get(index) === repeat
        )
          continue;
        // The zero-time birth already exposed by play stands for this first sample.
        const alreadyBorn =
          initial && i === 0 && b.timeSeconds === 0 && this.burstRepeats.has(index);
        this.burstRepeats.set(index, repeat);
        if (alreadyBorn) continue;
        if (random(this.seed, this.burstCycle, index + 100) < b.probability) {
          const phase = (b.timeSeconds + repeat * b.intervalSeconds) / duration;
          this.emit(
            Math.round(scalar(b.count, phase, random(this.seed, this.burstCycle, index + 110))),
            phase,
            this.burstCycle * duration + b.timeSeconds + repeat * b.intervalSeconds,
          );
        }
      }
    }
  }
  private bursts(from: number, to: number): void {
    if (this.emission?.enabled === false) return;
    if (from >= 0) this.repeatBursts(to - from);
    const duration = this.main.durationSeconds;
    const firstCycle = this.main.loop ? Math.max(0, Math.floor(from / duration)) : 0;
    const lastCycle = this.main.loop ? Math.floor(to / duration) : 0;
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++)
      for (const [index, b] of (this.emission?.bursts ?? []).entries()) {
        const repeated = b.intervalSeconds > 0 && b.cycles !== 1;
        if (repeated && from >= 0) continue;
        if (b.cycles === 0 && b.intervalSeconds === 0) {
          const localTo = to - cycle * duration;
          if (
            to > from &&
            localTo > b.timeSeconds &&
            localTo < duration - 1e-8 &&
            random(this.seed, Math.floor(to * 60), index + 100) < b.probability
          )
            this.emit(
              Math.round(
                scalar(b.count, localTo / duration, random(this.seed, cycle, index + 110)),
              ),
              localTo / duration,
              to,
            );
          continue;
        }
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
          if (repeated) this.burstRepeats.set(index, repeat);
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
    spacing = 0,
    remainder = 0,
    nativeBirthDelta?: number,
  ): void {
    const capacity = this.ages.length;
    const ring = this.main.ringBuffer !== 0;
    check(!ring || amount <= 100_000, 'LIMIT', 'Ring particle birth budget exceeded');
    // Skip births already beyond every authored lifetime; bound saturated-step work.
    const first =
      spacing > 0 && !ring
        ? Math.max(
            0,
            amount - Math.ceil(this.maximumBirthLifetime / (spacing * (nativeBirthDelta ?? 1))) - 1,
          )
        : 0;
    this.nextSerial += first;
    for (
      let n = first;
      n < amount &&
      (ring || n < first + capacity * 2) &&
      (this.count < capacity || this.main.ringBuffer !== 0);
      n++
    ) {
      const replacing = this.count === capacity;
      const i = replacing ? this.ringWrite : this.count++;
      if (replacing) {
        if (this.main.ringBuffer === 2) this.retireRingParticle(i);
        this.trigger?.forget(this.serials[i]!);
      }
      this.ringWrite = (i + 1) % capacity;
      const o = i * 3,
        serial = this.nextSerial++;
      this.serials[i] = serial;
      if (this.subParentSystems) {
        this.subParentSystems[i] = 0;
        this.subParentParticles![i] = 0;
      }
      const rnd = (ch: number) => random(this.seed, serial, ch),
        t = phase;
      this.ages[i] = 0;
      this.noiseSizes?.fill(1, o, o + 3);
      const lifetimeScale = this.lifetimeByEmitterSpeed
        ? scalar(
            this.lifetimeByEmitterSpeed.multiplier,
            speedPhase(
              Math.hypot(
                this.emitterVelocity[0]!,
                this.emitterVelocity[1]!,
                this.emitterVelocity[2]!,
              ),
              this.lifetimeByEmitterSpeed.speedRange!,
            ),
            rnd(78),
            1,
          )
        : 1;
      this.lifetimes[i] = Math.max(1e-6, scalar(this.main.lifetime, t, rnd(0)) * lifetimeScale);
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
          this.spriteShape,
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
      if (this.main.space !== Space.Local || this.main.scaling === ScalingMode.Shape) {
        const m =
            this.main.scaling === ScalingMode.Shape ? this.node.worldMatrix : this.emitterMatrix,
          inv = this.inverseSimulationMatrix;
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        x = inv[0]! * wx + inv[4]! * wy + inv[8]! * wz + inv[12]!;
        y = inv[1]! * wx + inv[5]! * wy + inv[9]! * wz + inv[13]!;
        z = inv[2]! * wx + inv[6]! * wy + inv[10]! * wz + inv[14]!;
        if (this.main.scaling === ScalingMode.Shape) {
          vec3.set(
            this.direction,
            m[0]! * dx + m[4]! * dy + m[8]! * dz,
            m[1]! * dx + m[5]! * dy + m[9]! * dz,
            m[2]! * dx + m[6]! * dy + m[10]! * dz,
          );
          vec3.normalize(this.direction, this.direction);
          const direction = this.vector(
            this.direction[0]!,
            this.direction[1]!,
            this.direction[2]!,
            false,
          );
          dx = direction[0]!;
          dy = direction[1]!;
          dz = direction[2]!;
        } else {
          const direction = this.vector(dx, dy, dz, true);
          dx = direction[0]!;
          dy = direction[1]!;
          dz = direction[2]!;
        }
      }
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      const speed = scalar(this.main.speed, t, rnd(4));
      this.velocities[o] = dx * speed;
      this.velocities[o + 1] = dy * speed;
      this.velocities[o + 2] = dz * speed;
      if (this.inheritVelocity && this.main.space !== Space.Local) {
        const inherited = this.vector(
          this.emitterVelocity[0]!,
          this.emitterVelocity[1]!,
          this.emitterVelocity[2]!,
          false,
        );
        const factor = scalar(this.inheritVelocity.multiplier, 0, rnd(77), 1);
        this.initialInheritedVelocities?.set(inherited, o);
        if (this.bakeInitialInheritance)
          for (let axis = 0; axis < 3; axis++)
            this.velocities[o + axis]! += inherited[axis]! * factor;
      }
      if (this.renderVelocities) {
        for (let axis = 0; axis < 3; axis++)
          this.renderVelocities[o + axis] = this.velocities[o + axis]!;
        if (
          this.inheritVelocity &&
          !this.bakeInitialInheritance &&
          this.main.space !== Space.Local
        ) {
          const inherited = this.inheritedVector(o);
          const factor = scalar(this.inheritVelocity.multiplier, 0, rnd(77), 1);
          for (let axis = 0; axis < 3; axis++)
            this.renderVelocities[o + axis]! += inherited[axis]! * factor;
        }
      }
      if (this.moduleSpeeds) {
        const velocity = this.renderVelocities ?? this.velocities;
        this.moduleSpeeds[i] = Math.hypot(velocity[o]!, velocity[o + 1]!, velocity[o + 2]!);
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
      if (this.spriteShape)
        for (let channel = 0; channel < 4; channel++)
          this.startColors[i * 4 + channel]! *= this.birth[6 + channel]!;
      if (this.subBirth) this.inheritSubBirth(i, this.subBirth.parent, this.subBirth.properties);
      if (this.subAges) this.subAges[i] = 0;
      if (this.lifetimeProgress) {
        this.lifetimeProgress[i] = 0;
        this.inverseLifetimes![i] = reciprocalLifetime(this.lifetimes[i]!);
        this.lifetimes[i] = Math.fround(1 / this.inverseLifetimes![i]!);
      }
      if (this.birthStepSeconds) this.birthStepSeconds[i] = NaN;
      this.updateCustom(i, 0);
      this.onBirth?.(i, phase);
      const age =
        nativeBirthDelta !== undefined
          ? Math.fround(
              nativeBirthDelta *
                Math.min(
                  1,
                  Math.max(
                    Math.fround(1e-6),
                    Math.fround(Math.fround(amount - n - 1 + remainder) * spacing),
                  ),
                ),
            )
          : (amount - n - 1 + remainder) * spacing;
      if (age > 0) this.advanceParticles(age, i, i + 1);
    }
  }
  /** Emits into this system's existing pool, including when automatic emission is disabled. */
  emitTriggeredBurst(parent: ParticleSnapshot, properties: number, parentSystem = 0): void {
    this.enableSubClock();
    this.subBirth = { parent, properties, parentSystem };
    try {
      for (const [index, burst] of (this.emission?.bursts ?? []).entries()) {
        if (random(this.seed, parent.id, 130 + index) >= burst.probability) continue;
        this.emit(
          Math.max(
            0,
            Math.round(scalar(burst.count, 0, random(this.seed, parent.id, 150 + index))),
          ),
          0,
        );
      }
    } finally {
      this.subBirth = undefined;
    }
  }
  /** @internal An independent Birth channel feeds the target without changing its own clock. */
  emitSubParticles(
    amount: number,
    phase: number,
    seconds: number,
    parent: ParticleSnapshot,
    properties: number,
    spacing = 0,
    remainder = 0,
    parentSystem = 0,
    initialAge = 0,
    nativeDelta?: number,
  ): void {
    this.enableSubClock();
    this.subBirth = { parent, properties, parentSystem };
    try {
      const first = this.nextSerial;
      this.emit(amount, phase, seconds, spacing, remainder, nativeDelta);
      if (initialAge > 0)
        for (let i = 0; i < this.count; ) {
          const serial = this.serials[i]!;
          if (serial >= first) this.advanceParticles(initialAge, i, i + 1);
          if (i < this.count && this.serials[i] === serial) i++;
        }
    } finally {
      this.subBirth = undefined;
    }
  }
  /** @internal Selects the graph clock before automatic or triggered births can begin. */
  enableSubClock(): void {
    if (this.subAges) return;
    this.subAges = new Float64Array(this.lifetimes.length);
    for (let i = 0; i < this.count; i++) this.subAges[i] = this.ages[i]!;
  }
  private inheritSubBirth(index: number, parent: ParticleSnapshot, properties: number): void {
    const parentSystem = this.subBirth!.parentSystem;
    if (parentSystem) {
      this.subParentSystems ??= new Uint32Array(this.lifetimes.length);
      this.subParentParticles ??= new Uint32Array(this.lifetimes.length);
      this.subParentSystems[index] = parentSystem;
      this.subParentParticles[index] = parent.id;
    }
    const offset = index * 3,
      m = this.inverseSimulationMatrix;
    // Shape offsets remain relative to the parent's position, without the target's translation.
    const x = parent.position[0] - this.emitterMatrix[12]!;
    const y = parent.position[1] - this.emitterMatrix[13]!;
    const z = parent.position[2] - this.emitterMatrix[14]!;
    this.positions[offset] = this.positions[offset]! + m[0]! * x + m[4]! * y + m[8]! * z;
    this.positions[offset + 1] = this.positions[offset + 1]! + m[1]! * x + m[5]! * y + m[9]! * z;
    this.positions[offset + 2] = this.positions[offset + 2]! + m[2]! * x + m[6]! * y + m[10]! * z;
    if (properties & 1)
      for (let channel = 0; channel < 4; channel++) {
        const child = Math.round(
          Math.max(0, Math.min(1, this.startColors[index * 4 + channel]!)) * 255,
        );
        const inherited = Math.round(Math.max(0, Math.min(1, parent.color[channel]!)) * 255);
        this.startColors[index * 4 + channel] = Math.round((child * inherited) / 255) / 255;
      }
    for (let axis = 0; axis < 3; axis++) {
      if (properties & 2)
        this.startSizes[offset + axis] = this.startSizes[offset + axis]! * parent.size[axis]!;
      if (properties & 4)
        this.rotations[offset + axis] = this.rotations[offset + axis]! + parent.rotation[axis]!;
    }
    if (properties & 8)
      this.lifetimes[index] = Math.max(1e-5, this.lifetimes[index]! * parent.remainingLifetime);
  }
  /** @internal Natural completion excludes descendant pools and retained trails. */
  get completed(): boolean {
    return (
      this.enabledLast &&
      this.started &&
      this.count === 0 &&
      this.retiredRingCount === 0 &&
      (!this.emitting ||
        (this.delayRemaining <= 0 &&
          !this.main.loop &&
          this.time + 1e-7 >= this.main.durationSeconds))
    );
  }
  step(delta: number): number {
    if (!this.enabledLast || delta <= 0) return 0;
    const culling = this.main.culling === 0 ? (this.main.loop ? 2 : 3) : this.main.culling;
    if (this.timelineControlled) {
      this.culledSeconds = 0;
      this.wasCulled = false;
    }
    if (!this.timelineControlled && !this.visible && culling !== 3) {
      this.wasCulled = true;
      if (culling === 1) this.culledSeconds += delta;
      return 0;
    }
    if (this.wasCulled) {
      this.wasCulled = false;
      if (culling === 2) return 0;
    }
    delta += this.culledSeconds;
    this.culledSeconds = 0;
    if (this.completed && !this.timelineControlled) {
      this.onAdvanced?.(delta * this.main.simulationSpeed);
      return 0;
    }
    this.updateEmitterVelocity(delta);
    let dt = delta * this.main.simulationSpeed;
    if (dt <= 0) return 0;
    if (this.delayRemaining > 0) {
      this.delayRemaining -= dt;
      if (this.delayRemaining > 0) {
        this.lastEmissionPosition.set([
          this.node.worldMatrix[12]!,
          this.node.worldMatrix[13]!,
          this.node.worldMatrix[14]!,
        ]);
        return delta;
      }
      dt = -this.delayRemaining;
      this.delayRemaining = 0;
      if (!this.birthDriven) this.bursts(-Number.EPSILON, 0);
      if (!this.timelineControlled) this.prewarm();
      if (dt <= 0) return 0;
    }
    const steps = Math.ceil(dt / Math.fround(0.03));
    const substep = dt / steps;
    for (let i = 0; i < steps; i++) this.advance(substep);
    if (this.pendingPrewarmTime > 0) {
      while (this.pendingPrewarmTime > 1e-6) {
        this.pendingPrewarmTime -= substep;
        this.advance(substep);
      }
      this.pendingPrewarmTime = 0;
    }
    return delta;
  }

  private clearRetiredRingParticles(): void {
    for (const pool of this.retiredRingPools) pool.clear();
    this.retiredRingCount = 0;
  }
  private retireRingParticle(index: number): void {
    if (!this.onRingDeath || !this.retireRingDeaths) return;
    check(this.retiredRingCount < 100_000, 'LIMIT', 'Retired ring particle capacity exceeded');
    let pool = this.retiredRingPools.find((candidate) => candidate.count < candidate.ages.length);
    if (!pool) {
      const source = {
        ...this.source,
        main: {
          ...this.main,
          maxParticles: Math.max(128, Math.min(1024, this.main.maxParticles)),
          ringBuffer: 0,
          stopAction: 0,
          clock: 0,
          culling: 3,
          prewarm: false,
        },
        modules: this.source.modules.filter(
          (module) =>
            module.dataType !== M.LightsModule &&
            module.dataType !== M.SubEmittersModule &&
            module.dataType !== M.EmissionModule,
        ),
      };
      pool = new Emitter(
        this.id,
        this.node,
        source,
        true,
        this.seed,
        this.diagnostics,
        this.gravity,
        this.customSpaceNode,
        this.pack,
        this.environment,
        this.sceneNodes,
      );
      if (this.lifetimeProgress) pool.enableLifetimeProgress();
      else pool.enableSubClock();
      const retired = pool;
      pool.onDeath = (i) => {
        this.retiredRingCount--;
        this.onRingDeath?.(retired, i);
      };
      this.retiredRingPools.push(pool);
    }
    const into = pool.count++;
    this.retiredRingCount++;
    for (const field of ['ages', 'lifetimes', 'serials', 'moduleSpeeds'] as const)
      if (this[field] && pool[field]) pool[field]![into] = this[field]![index]!;
    for (const field of [
      'positions',
      'velocities',
      'rotations',
      'startSizes',
      'renderVelocities',
      'noiseSizes',
      'initialInheritedVelocities',
    ] as const)
      if (this[field] && pool[field])
        pool[field]!.set(this[field]!.subarray(index * 3, index * 3 + 3), into * 3);
    pool.startColors.set(this.startColors.subarray(index * 4, index * 4 + 4), into * 4);
    if (this.customData && pool.customData)
      pool.customData.set(this.customData.subarray(index * 8, index * 8 + 8), into * 8);
    pool.subAges![into] = this.ages[index]!;
    if (this.lifetimeProgress && pool.lifetimeProgress) {
      pool.lifetimeProgress[into] = this.lifetimeProgress[index]!;
      pool.inverseLifetimes![into] = this.inverseLifetimes![index]!;
    }
  }
  private advanceRetiredRingParticles(dt: number): void {
    for (const pool of this.retiredRingPools) {
      if (!pool.count) continue;
      pool.environment = this.environment;
      pool.gravity = this.gravity;
      pool.seed = this.seed;
      pool.time = this.time;
      pool.forceStep = this.forceStep;
      pool.emitterVelocity.set(this.emitterVelocity);
      pool.updateSpace();
      pool.externalFields = this.externalFields;
      pool.noiseEvaluator = this.noiseEvaluator;
      pool.advanceParticles(dt);
    }
  }

  private advance(dt: number): void {
    this.forceStep++;
    if (this.externalForces)
      this.externalFields = selectForceFields(this.externalForces, this.environment?.forceFields);
    this.noiseEvaluator?.advance(
      dt,
      (this.time % this.main.durationSeconds) / this.main.durationSeconds,
    );
    this.advanceRetiredRingParticles(dt);
    this.advanceParticles(dt);
    this.advanceEmission(dt);
    if (!this.deferPrewarmParticles) this.onAdvanced?.(dt);
  }
  /** Native particle time is a Float32 percentage; 0.01 is multiplied before lifetime. */
  private progressAge(index: number): number {
    return lifetimeProgressAge(this.lifetimeProgress![index]!, this.lifetimes[index]!);
  }
  private advanceParticles(seconds: number, first = 0, end = this.count): void {
    const commonDecay = this.limit ? Math.pow(1 - this.limit.dampen, seconds * 30) : 1;
    for (let i = first; i < Math.min(this.count, end); ) {
      let dt = seconds;
      if (this.birthStepSeconds && !Number.isNaN(this.birthStepSeconds[i]!)) {
        dt = this.birthStepSeconds[i]!;
        this.birthStepSeconds[i] = NaN;
      }
      const limitDecay =
        dt === seconds || !this.limit ? commonDecay : Math.pow(1 - this.limit.dampen, dt * 30);
      const progress = this.lifetimeProgress
        ? advanceLifetimeProgress(this.lifetimeProgress[i]!, dt, this.inverseLifetimes![i]!)
        : undefined;
      if (progress !== undefined) this.lifetimeProgress![i] = progress;
      const elapsed = this.subAges
        ? this.deferPrewarmParticles
          ? Math.fround(this.subAges[i]! + Math.fround(dt))
          : this.subAges[i]! + Math.fround(dt)
        : 0;
      let age =
        progress !== undefined
          ? this.progressAge(i)
          : this.subAges
            ? this.subAges[i]! + Math.fround(dt)
            : this.ages[i]! + dt;
      const ring = this.main.ringBuffer;
      if (ring !== 0) {
        const lifetime = this.lifetimes[i]!;
        const range = this.main.ringBufferLoopRange!;
        if (this.lifetimeProgress) {
          let value = progress!;
          const from = Math.fround(range.x * 100),
            to = Math.fround(range.y * 100);
          const width = Math.fround(to - from);
          if (ring === 2 && width > 0 && value >= to)
            value = Math.fround(from + Math.fround(Math.fround(value - from) % width));
          else value = Math.min(value, ring === 1 ? Math.fround(100 - 2 ** -17) : 100);
          this.lifetimeProgress[i] = value;
          age = this.progressAge(i);
        } else {
          const width = (range.y - range.x) * lifetime;
          if (ring === 2 && width > 0 && age >= range.y * lifetime)
            age = range.x * lifetime + ((age - range.x * lifetime) % width);
          else age = Math.min(age, lifetime * (ring === 1 ? 1 - 2 ** -23 : 1));
        }
      }
      const dead =
        ring === 0 &&
        (progress !== undefined
          ? progress > 100
          : this.subAges
            ? age > this.lifetimes[i]!
            : age >= this.lifetimes[i]!);
      if (this.deferPrewarmParticles) {
        this.ages[i] = age;
        if (this.subAges) this.subAges[i] = ring ? age : elapsed;
        if (dead) {
          this.onDeath?.(i);
          this.remove(i);
        } else i++;
        continue;
      }
      if (dead && !this.onDeath) {
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
      const force = this.forceModule;
      if (force) {
        const phase = this.ages[i]! / this.lifetimes[i]!;
        const channel = force.randomizePerFrame ? 80 + this.forceStep * 3 : 80;
        // Unity scales world-force axes before converting into simulation space.
        const world = force.space === Space.World;
        const acceleration = this.vector(
          scalar(force.force?.x, phase, rnd(channel)) * (world ? this.particleScale[0]! : 1),
          scalar(force.force?.y, phase, rnd(channel + 1)) * (world ? this.particleScale[1]! : 1),
          scalar(force.force?.z, phase, rnd(channel + 2)) * (world ? this.particleScale[2]! : 1),
          !world,
        );
        vx += acceleration[0]! * dt;
        vy += acceleration[1]! * dt;
        vz += acceleration[2]! * dt;
      }
      if (this.externalForces) {
        const query = this.forceQuery;
        vec3.set(this.forcePosition, x, y, z);
        vec3.transformMat4(this.forcePosition, this.forcePosition, this.simulationMatrix);
        const m = this.simulationMatrix;
        vec3.set(
          this.forceVelocity,
          m[0]! * vx + m[4]! * vy + m[8]! * vz,
          m[1]! * vx + m[5]! * vy + m[9]! * vz,
          m[2]! * vx + m[6]! * vy + m[10]! * vz,
        );
        query.deltaSeconds = dt;
        query.systemId = this.id;
        query.timeSeconds = this.time;
        query.normalizedAge = this.ages[i]! / this.lifetimes[i]!;
        query.particleId = this.serials[i]!;
        const factor = scalar(this.externalForces.multiplier, query.normalizedAge, rnd(83), 1);
        for (const field of this.externalFields) {
          if (field.enabled === false) continue;
          this.forceOutput.fill(0);
          field.sample(query, this.forceOutput);
          check(
            this.forceOutput.every(Number.isFinite),
            'HOST',
            'Force field returned non-finite acceleration',
          );
          const acceleration = this.vector(
            this.forceOutput[0]!,
            this.forceOutput[1]!,
            this.forceOutput[2]!,
            false,
          );
          vx += acceleration[0]! * factor * dt;
          vy += acceleration[1]! * factor * dt;
          vz += acceleration[2]! * factor * dt;
        }
      }
      this.velocities[o] = vx;
      this.velocities[o + 1] = vy;
      this.velocities[o + 2] = vz;
      let orbitalX = 0,
        orbitalY = 0,
        orbitalZ = 0,
        multiplier = 1;
      if (this.inheritVelocity && !this.bakeInitialInheritance && this.main.space !== Space.Local) {
        const inherited = this.inheritedVector(o);
        const factor = scalar(
          this.inheritVelocity.multiplier,
          this.ages[i]! / this.lifetimes[i]!,
          rnd(77),
          1,
        );
        vx += inherited[0]! * factor;
        vy += inherited[1]! * factor;
        vz += inherited[2]! * factor;
      }
      const v = this.velocityModule;
      if (v) {
        const scale = this.node.localScale;
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
        // Native orbital/radial axes remain emitter-local, independently of linear velocity space.
        vec3.set(
          this.direction,
          x - this.orbitalOrigin[0]!,
          y - this.orbitalOrigin[1]!,
          z - this.orbitalOrigin[2]!,
        );
        vec3.transformQuat(this.direction, this.direction, this.inverseOrbitalRotation);
        let px = this.direction[0]! - ox,
          py = this.direction[1]! - oy,
          pz = this.direction[2]! - oz;
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
          vec3.set(this.direction, px + ox, py + oy, pz + oz);
          vec3.transformQuat(this.direction, this.direction, this.orbitalRotation);
          const nx = this.direction[0]! + this.orbitalOrigin[0]!,
            ny = this.direction[1]! + this.orbitalOrigin[1]!,
            nz = this.direction[2]! + this.orbitalOrigin[2]!;
          orbitalX = (nx - x) / dt;
          orbitalY = (ny - y) / dt;
          orbitalZ = (nz - z) / dt;
          x = nx;
          y = ny;
          z = nz;
          vx += orbitalX / multiplier;
          vy += orbitalY / multiplier;
          vz += orbitalZ / multiplier;
        }
        const radial = scalar(v.radial, t, rnd(23));
        if (radial) {
          const length = Math.hypot(px, py, pz) || 1;
          vec3.set(
            this.direction,
            (px / length) * radial,
            (py / length) * radial,
            (pz / length) * radial,
          );
          vec3.transformQuat(this.direction, this.direction, this.orbitalRotation);
          vx += this.direction[0]!;
          vy += this.direction[1]!;
          vz += this.direction[2]!;
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
            let size =
              (this.sizeBySpeed
                ? speedSize(this.sizeBySpeed, this.moduleSpeeds![i]!, rnd(73), 0)
                : 1) *
              this.startSizes[o]! *
              scalar(this.sizeModule?.size?.x, this.ages[i]! / this.lifetimes[i]!, rnd(50), 1) *
              (this.noiseSizes?.[o] ?? 1);
            if (this.main.size3d && this.sizeBySpeed) {
              let maximum = size;
              for (let axis = 1; axis < 3; axis++) {
                const parameter = this.sizeModule?.separateAxes
                  ? axis === 1
                    ? this.sizeModule.size?.y
                    : this.sizeModule.size?.z
                  : this.sizeModule?.size?.x;
                maximum = Math.max(
                  maximum,
                  this.startSizes[o + axis]! *
                    speedSize(this.sizeBySpeed, this.moduleSpeeds![i]!, rnd(73), axis) *
                    scalar(parameter, this.ages[i]! / this.lifetimes[i]!, rnd(50), 1) *
                    (this.noiseSizes?.[o + axis] ?? 1),
                );
              }
              size = maximum * 0.5;
            }
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
      if (this.moduleSpeeds) this.moduleSpeeds[i] = Math.hypot(vx, vy, vz);
      if (this.rotationBySpeed) {
        const r = this.rotationBySpeed;
        const phase = speedPhase(Math.hypot(vx, vy, vz), r.speedRange!);
        const factor = rnd(74);
        const sign = rnd(68) < this.main.flipRotationProbability ? -1 : 1;
        if (r.separateAxes) {
          this.rotations[o] =
            this.rotations[o]! + scalar(r.angularVelocity?.x, phase, factor) * dt * sign;
          this.rotations[o + 1] =
            this.rotations[o + 1]! + scalar(r.angularVelocity?.y, phase, factor) * dt * sign;
        }
        this.rotations[o + 2] =
          this.rotations[o + 2]! + scalar(r.angularVelocity?.z, phase, factor) * dt * sign;
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
            this.noiseSizes[o + axis] = Math.max(0, 1 + this.scratch[axis]! * size);
        }
      }
      this.positions[o] = x + vx * dt;
      this.positions[o + 1] = y + vy * dt;
      this.positions[o + 2] = z + vz * dt;
      let collisionAge = 0;
      const integratedAge = age;
      if (!dead && this.collision) {
        const previous = age;
        age = this.collision.resolve(this, i, dt, age, x, y, z);
        collisionAge = age - previous;
        if (collisionAge && this.lifetimeProgress)
          this.lifetimeProgress[i] = (age / this.lifetimes[i]!) * 100;
      }
      if (!dead && this.trigger) {
        age = this.trigger.resolve(this, i, age, x, y, z);
        collisionAge = age - integratedAge;
        if (collisionAge && this.lifetimeProgress)
          this.lifetimeProgress[i] = (age / this.lifetimes[i]!) * 100;
      }
      // Custom Data, like integrated rotation, samples the start of this simulation step.
      this.updateCustom(i, this.ages[i]! / this.lifetimes[i]!);
      this.ages[i] = age;
      if (this.subAges) this.subAges[i] = (ring ? age - collisionAge : elapsed) + collisionAge;
      if (dead) {
        this.onDeath?.(i);
        this.remove(i);
        continue;
      }
      i++;
    }
  }
  /** Evaluates current particle color into caller-owned storage. */
  sampleColor(index: number, out: Float32Array): void {
    const id = this.serials[index]!;
    color(
      this.colorModule?.color ?? null,
      this.ages[index]! / this.lifetimes[index]!,
      random(this.seed, id, 53),
      out,
    );
    if (this.colorBySpeed)
      color(
        this.colorBySpeed.color,
        speedPhase(this.moduleSpeeds![index]!, this.colorBySpeed.speedRange!),
        random(this.seed, id, 79),
        this.colorScratch,
      );
    for (let channel = 0; channel < 4; channel++) {
      const value =
        out[channel]! *
        this.startColors[index * 4 + channel]! *
        (this.colorBySpeed ? this.colorScratch[channel]! : 1);
      out[channel] = this.colorBySpeed
        ? Math.round(Math.max(0, Math.min(1, value)) * 255) / 255
        : value;
    }
  }
  private advanceEmission(dt: number): void {
    if (this.emitting && this.started) {
      const end = this.lifetimeProgress ? Math.fround(this.time + Math.fround(dt)) : this.time + dt;
      const previousRateTime = this.rateTime;
      this.rateTime = Math.fround(this.rateTime + Math.fround(dt));
      const rateDt = this.rateTime - previousRateTime;
      // Keep the emission clock within a loop: absolute Float32 time drifts
      // enough to move boundary births to another step and change their initial values.
      if (this.main.loop && this.rateTime >= this.main.durationSeconds)
        this.rateTime = Math.fround(this.rateTime % this.main.durationSeconds);
      if (!this.birthDriven) this.bursts(this.time, end);
      const activeDt = this.main.loop
        ? dt
        : Math.max(
            0,
            Math.min(end, this.main.durationSeconds) -
              Math.min(this.time, this.main.durationSeconds),
          );
      const phase =
        (this.main.loop
          ? this.rateTime % this.main.durationSeconds
          : Math.min(this.rateTime, this.main.durationSeconds)) / this.main.durationSeconds;
      const rate = Math.max(
        0,
        this.birthDriven || this.emission?.enabled === false
          ? 0
          : scalar(this.emission?.rateOverTime, phase, random(this.seed, 0, 90)),
      );
      const birthDt = this.warming
        ? Math.min(rateDt, Math.max(0, end - this.warmStart))
        : !this.main.loop && this.rateTime >= this.main.durationSeconds
          ? 0
          : rateDt;
      if (this.lifetimeProgress) {
        const integral =
          this.main.loop && this.rateTime < previousRateTime
            ? Math.fround(
                Math.fround(Math.fround(this.main.durationSeconds - previousRateTime) * rate) +
                  Math.fround(this.rateTime * rate),
              )
            : Math.fround(Math.fround(birthDt) * Math.fround(rate));
        this.nativeRateCarry = Math.fround(this.nativeRateCarry + integral);
        const amount = Math.floor(this.nativeRateCarry);
        this.nativeRateCarry = Math.fround(this.nativeRateCarry - amount);
        const ratio = integral >= Math.fround(0.0001) ? Math.fround(1 / integral) : 1;
        this.emit(amount, phase, end, ratio, this.nativeRateCarry, Math.fround(dt));
      } else {
        // Prewarm retains reciprocal precision and rounds the birth ratio at its
        // Float32 boundary; live emission uses a Float32 interval instead.
        const spacing = rate > 0 ? (this.warming ? 1 / rate : Math.fround(1 / rate)) : 0;
        if (spacing > 0 && this.rateSpacing > 0 && spacing !== this.rateSpacing)
          this.carry *= spacing / this.rateSpacing;
        if (spacing > 0) this.rateSpacing = spacing;
        this.carry += spacing > 0 ? birthDt : 0;
        const amount =
          spacing > 0
            ? Math.floor(this.warming ? Math.fround(this.carry / spacing) : this.carry / spacing)
            : 0;
        this.carry -= amount * spacing;
        this.emit(amount, phase, end, spacing, spacing > 0 ? this.carry / spacing : 0);
      }
      const m = this.node.worldMatrix;
      const distance = Math.hypot(
        m[12]! - this.lastEmissionPosition[0]!,
        m[13]! - this.lastEmissionPosition[1]!,
        m[14]! - this.lastEmissionPosition[2]!,
      );
      this.distanceCarry +=
        (this.distanceStarted ? distance : 0) *
        (activeDt / dt) *
        Math.max(
          0,
          this.birthDriven || this.emission?.enabled === false
            ? 0
            : scalar(
                this.emission?.rateOverDistance,
                (this.time % this.main.durationSeconds) / this.main.durationSeconds,
                random(this.seed, 0, 91),
              ),
        );
      const distanceAmount = Math.floor(this.distanceCarry + 1e-8);
      this.distanceCarry -= distanceAmount;
      this.distanceStarted = true;
      this.emit(distanceAmount, undefined, end);
      this.time =
        this.lifetimeProgress && this.main.loop && end >= this.main.durationSeconds
          ? Math.fround(end % this.main.durationSeconds)
          : end;
    }
    this.lastEmissionPosition.set([
      this.node.worldMatrix[12]!,
      this.node.worldMatrix[13]!,
      this.node.worldMatrix[14]!,
    ]);
  }
  private remove(i: number): void {
    this.trigger?.forget(this.serials[i]!);
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.ages, this.lifetimes, this.serials]) a[i] = a[last]!;
    if (this.subAges) this.subAges[i] = this.subAges[last]!;
    if (this.birthStepSeconds) this.birthStepSeconds[i] = this.birthStepSeconds[last]!;
    if (this.lifetimeProgress) {
      this.lifetimeProgress[i] = this.lifetimeProgress[last]!;
      this.inverseLifetimes![i] = this.inverseLifetimes![last]!;
    }
    if (this.subParentSystems) {
      this.subParentSystems[i] = this.subParentSystems[last]!;
      this.subParentParticles![i] = this.subParentParticles![last]!;
    }
    for (const a of [this.positions, this.velocities, this.startSizes, this.rotations])
      a.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.noiseSizes?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.moduleSpeeds?.copyWithin(i, last, last + 1);
    this.renderVelocities?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.initialInheritedVelocities?.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.customData?.copyWithin(i * 8, last * 8, last * 8 + 8);
    this.startColors.copyWithin(i * 4, last * 4, last * 4 + 4);
  }
}
