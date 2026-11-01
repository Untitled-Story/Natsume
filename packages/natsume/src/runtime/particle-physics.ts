/** Borrowed world-space sphere query. Do not retain its arrays after the call. */
export interface ParticleSphereQuery {
  readonly position: Float64Array;
  readonly radius: number;
  readonly dimension: '3d' | '2d';
}

/** Swept sphere volume, including overlap at either endpoint. */
export interface ParticleColliderSweepQuery extends ParticleSphereQuery {
  readonly displacement: Float64Array;
}

/** Host-owned collider identity and optional particle force receiver. */
export interface ParticleCollider {
  readonly id: string;
  readonly layer: number;
  readonly dynamic?: boolean;
  /** Returns whether the world-space sphere intersects this collider. */
  overlapSphere(query: ParticleSphereQuery): boolean;
  /** Required for Trigger references; tests the full swept volume against this collider. */
  sweepSphere?(query: ParticleColliderSweepQuery): boolean;
  /** Apply a world-space force at a world-space contact point. Arrays are borrowed. */
  applyForce?(force: Float64Array, point: Float64Array): void;
}

export interface ParticleSweepQuery extends ParticleSphereQuery {
  readonly displacement: Float64Array;
  readonly layerMask: number;
  readonly dynamicColliders: boolean;
  readonly interiorCollisions: boolean;
  readonly quality: 'high' | 'medium' | 'low';
  readonly voxelSize: number;
  readonly maxShapes: number;
}

/** Surface contact; fraction measures progress along the requested displacement. */
export interface ParticleSweepHit {
  readonly collider: ParticleCollider;
  readonly fraction: number;
  readonly point: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  /** True when the sphere starts within a collider. */
  readonly inside?: boolean;
}

/** Host-owned physics scene. Fill outHits; Natsume clears it before each query. */
export interface ParticlePhysicsWorld {
  sweepSphere(query: ParticleSweepQuery, outHits: ParticleSweepHit[]): void;
}

/** A copied contact emitted by a system with collision messages enabled. */
export interface ParticleCollisionEvent {
  readonly systemId: number;
  readonly nodeId: number;
  readonly particleId: number;
  readonly colliderId: string | undefined;
  readonly planeNodeId: number | undefined;
  readonly position: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
}

/** Copied Trigger notification. Exit and Outside have no collider query results. */
export interface ParticleTriggerEvent {
  readonly systemId: number;
  readonly nodeId: number;
  readonly particleId: number;
  readonly kind: 'inside' | 'outside' | 'enter' | 'exit';
  readonly position: readonly [number, number, number];
  readonly colliders: readonly { readonly slot: number; readonly colliderId: string }[];
}
