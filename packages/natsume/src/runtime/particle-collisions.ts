import { vec3 } from 'gl-matrix';
import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { CollisionModuleT } from '../format/generated/noa/ir/collision-module.js';
import type { SceneNode } from './scene.js';
import type { Emitter } from './emitter.js';
import type { ParticleSweepHit, ParticleSweepQuery } from './particle-physics.js';
import { particleSnapshot, type MutableParticleSnapshot } from './particle-snapshot.js';
import { scalar, random } from './parameters.js';
type MutableSweepQuery = { -readonly [K in keyof ParticleSweepQuery]: ParticleSweepQuery[K] };

/** Reuses world-space scratch storage across all particles in one system. */
export class ParticleCollisions {
  private readonly start = new Float64Array(3);
  private readonly end = new Float64Array(3);
  private readonly displacement = new Float64Array(3);
  private readonly velocity = new Float64Array(3);
  private readonly normal = new Float64Array(3);
  private readonly contact = new Float64Array(3);
  private readonly force = new Float64Array(3);
  private readonly forcePoint = new Float64Array(3);
  private readonly color = new Float32Array(4);
  private snapshot: MutableParticleSnapshot | undefined;
  private readonly hits: ParticleSweepHit[] = [];
  private readonly query: MutableSweepQuery = {
    position: this.start,
    displacement: this.displacement,
    radius: 0,
    dimension: '3d',
    layerMask: -1,
    dynamicColliders: false,
    interiorCollisions: false,
    quality: 'high',
    voxelSize: 0,
    maxShapes: 0,
  };
  constructor(
    readonly definition: R<CollisionModuleT>,
    private readonly nodes?: ReadonlyMap<number, SceneNode>,
  ) {}

  /** Returns the post-collision particle age; death is observed on the following step. */
  resolve(
    e: Emitter,
    index: number,
    dt: number,
    age: number,
    x: number,
    y: number,
    z: number,
  ): number {
    const c = this.definition,
      o = index * 3;
    this.snapshot = particleSnapshot(e, index, 0, this.snapshot, this.color);
    const snapshot = this.snapshot;
    const radius =
      Math.max(Math.abs(snapshot.size[0]), Math.abs(snapshot.size[1]), Math.abs(snapshot.size[2])) *
      c.radiusScale *
      0.5;
    vec3.set(this.start, x, y, z);
    vec3.transformMat4(this.start, this.start, e.simulationMatrix);
    vec3.set(this.end, e.positions[o]!, e.positions[o + 1]!, e.positions[o + 2]!);
    vec3.transformMat4(this.end, this.end, e.simulationMatrix);
    vec3.subtract(this.displacement, this.end, this.start);
    vec3.scale(this.velocity, this.displacement, 1 / dt);
    if (c.type === 0) {
      for (const id of c.planes) {
        if (!id) continue;
        const node = this.nodes?.get(id);
        check(node, 'HOST', `Missing collision plane node ${id}`);
        vec3.set(this.normal, 0, 1, 0);
        vec3.transformQuat(this.normal, this.normal, node.worldRotation);
        const m = node.worldMatrix;
        const startDistance =
          this.normal[0]! * (this.start[0]! - m[12]!) +
          this.normal[1]! * (this.start[1]! - m[13]!) +
          this.normal[2]! * (this.start[2]! - m[14]!);
        const travel = vec3.dot(this.displacement, this.normal);
        if (travel < 0 && startDistance + travel < radius)
          age = this.respond(
            e,
            index,
            dt,
            age,
            radius,
            (radius - startDistance) / travel,
            undefined,
            id,
          );
      }
    } else {
      const world = e.environment?.physicsWorlds?.[String(c.hostPhysicsSlot)];
      check(world, 'HOST', `Missing particle physics world ${c.hostPhysicsSlot}`);
      const query = this.query;
      query.radius = radius;
      query.dimension = c.dimension === 1 ? '2d' : '3d';
      query.layerMask = c.layerMask;
      query.dynamicColliders = c.dynamicColliders;
      query.interiorCollisions = c.interiorCollisions;
      query.quality = c.quality === 0 ? 'high' : c.quality === 1 ? 'medium' : 'low';
      query.voxelSize = c.voxelSize;
      query.maxShapes = c.maxShapes;
      this.hits.length = 0;
      world.sweepSphere(query, this.hits);
      let closest: ParticleSweepHit | undefined;
      for (const hit of this.hits) {
        check(
          hit &&
            Number.isFinite(hit.fraction) &&
            hit.fraction >= 0 &&
            hit.fraction <= 1 &&
            hit.normal.length === 3 &&
            hit.normal.every(Number.isFinite) &&
            hit.point.length === 3 &&
            hit.point.every(Number.isFinite) &&
            hit.collider &&
            Number.isInteger(hit.collider.layer) &&
            hit.collider.layer >= 0 &&
            hit.collider.layer < 32,
          'HOST',
          'Invalid particle sweep hit',
        );
        if (
          !(c.layerMask & (1 << hit.collider.layer)) ||
          (!c.dynamicColliders && hit.collider.dynamic) ||
          (!c.interiorCollisions && hit.inside)
        )
          continue;
        if (!closest || hit.fraction < closest.fraction) closest = hit;
      }
      if (closest) {
        check(
          !c.colliderForce || !closest.collider.dynamic || closest.collider.applyForce,
          'HOST',
          'Dynamic collider requires applyForce for nonzero particle colliderForce',
        );
        this.normal.set(closest.normal);
        check(vec3.length(this.normal) > 0, 'HOST', 'Particle sweep normal must be nonzero');
        vec3.normalize(this.normal, this.normal);
        // Initial sphere penetration uses the extrapolated contact time, like Planes.
        let fraction = closest.fraction;
        if (fraction === 0) {
          const distance =
            this.normal[0]! * (this.start[0]! - closest.point[0]) +
            this.normal[1]! * (this.start[1]! - closest.point[1]) +
            this.normal[2]! * (this.start[2]! - closest.point[2]);
          const travel = vec3.dot(this.displacement, this.normal);
          if (distance < radius && travel < 0) fraction = (radius - distance) / travel;
        }
        age = this.respond(e, index, dt, age, radius, fraction, closest);
      }
    }
    return age;
  }

  private respond(
    e: Emitter,
    index: number,
    dt: number,
    age: number,
    radius: number,
    fraction: number,
    hit?: ParticleSweepHit,
    planeNodeId?: number,
  ): number {
    const c = this.definition,
      o = index * 3,
      id = e.serials[index]!;
    const normal = this.normal;
    const incoming = vec3.dot(this.velocity, normal);
    if (incoming >= 0) return age;
    const phase = e.ages[index]! / e.lifetimes[index]!;
    const dampen = Math.max(0, Math.min(1, scalar(c.dampen, phase, random(e.seed, id, 84))));
    const bounce = scalar(c.bounce, phase, random(e.seed, id, 85));
    const speed = vec3.length(this.velocity);
    vec3.scale(this.force, this.velocity, speed > 0 ? 1 / speed : 0);
    vec3.scaleAndAdd(this.contact, this.start, this.displacement, fraction);
    if (hit) {
      for (let axis = 0; axis < 3; axis++)
        this.contact[axis] = hit.point[axis]! + normal[axis]! * radius;
    }
    vec3.scaleAndAdd(this.forcePoint, this.contact, normal, -radius);
    vec3.scaleAndAdd(this.velocity, this.velocity, normal, -(1 + bounce) * incoming);
    vec3.scale(this.velocity, this.velocity, 1 - dampen);
    vec3.scaleAndAdd(this.end, this.contact, this.velocity, dt * (1 - fraction));
    if (hit && fraction < 0) {
      const outgoing = vec3.dot(this.velocity, normal);
      for (let axis = 0; axis < 3; axis++)
        this.end[axis] =
          this.end[axis]! + (this.velocity[axis]! - normal[axis]! * outgoing) * dt * fraction;
    }
    age = Math.min(
      e.lifetimes[index]!,
      age +
        Math.max(0, scalar(c.lifetimeLoss, phase, random(e.seed, id, 86))) * e.lifetimes[index]!,
    );
    const resultingSpeed = vec3.length(this.velocity);
    if (resultingSpeed < c.minKillSpeed || resultingSpeed > c.maxKillSpeed)
      age = e.lifetimes[index]!;
    if (hit?.collider.applyForce && c.colliderForce > 0) {
      let force = c.colliderForce;
      if (c.multiplyForceBySize) force *= ((4 * Math.PI) / 3) * Math.max(1e-5, radius) ** 3;
      if (c.multiplyForceBySpeed) force *= speed;
      if (c.multiplyForceByAngle) force *= speed > 0 ? -incoming / speed : 0;
      vec3.scale(this.force, this.force, force);
      hit.collider.applyForce(this.force, this.forcePoint);
    }
    if (c.sendMessages)
      e.onCollisionMessage?.({
        systemId: e.id,
        nodeId: e.node.id,
        particleId: id,
        colliderId: hit?.collider.id,
        planeNodeId,
        position: [this.contact[0]!, this.contact[1]!, this.contact[2]!],
        normal: [normal[0]!, normal[1]!, normal[2]!],
        velocity: [this.velocity[0]!, this.velocity[1]!, this.velocity[2]!],
      });
    vec3.transformMat4(this.end, this.end, e.inverseSimulationMatrix);
    e.positions.set(this.end, o);
    const m = e.inverseSimulationMatrix,
      v = this.velocity;
    for (let axis = 0; axis < 3; axis++) {
      const value = m[axis]! * v[0]! + m[4 + axis]! * v[1]! + m[8 + axis]! * v[2]!;
      e.velocities[o + axis] = value;
      if (e.renderVelocities) e.renderVelocities[o + axis] = value;
    }
    const previousAge = e.ages[index]!;
    e.ages[index] = age;
    try {
      e.onCollision?.(index);
    } finally {
      e.ages[index] = previousAge;
    }
    vec3.transformMat4(this.end, this.end, e.simulationMatrix);
    return age;
  }
}
