import { check } from '../errors.js';
import * as I from './generated/noa/ir.js';

/** Checks environmental references and geometry independently of playback support. */
export function validateParticleContracts(d: I.DocumentT, required: (name: string) => void): void {
  const assets = new Map(d.assets.map((a) => [a.id, a.kind]));
  const nodes = new Set(d.nodes.map((n) => n.id));
  const components = new Map(d.components.map((c) => [c.id, c]));
  let host = false;
  const slot = (s: unknown) => {
    check(
      typeof s === 'string' && s.length > 0,
      'SEMANTIC',
      'Missing required particle environment slot',
    );
    host = true;
  };
  const fraction = (v: number) => check(v >= 0 && v <= 1, 'SEMANTIC', 'Invalid particle fraction');
  const reference = (r: I.EnvironmentReferenceT, kinds: I.EnvironmentKind[]) => {
    check(r && kinds.includes(r.kind), 'SEMANTIC', 'Invalid particle environment kind');
    if (!r.source) {
      check(
        r.hostSlot === null && r.sourceAsset === null,
        'SEMANTIC',
        'Invalid null environment slot',
      );
      return;
    }
    check(
      r.source.fileId !== 0n && (!r.source.guid || /^[0-9a-fA-F]{32}$/.test(String(r.source.guid))),
      'SEMANTIC',
      'Invalid environment source identity',
    );
    check(r.sourceAsset, 'SEMANTIC', 'Missing environment source asset');
    slot(r.hostSlot);
  };
  const speed = (range: I.Vec2T | null) =>
    check(range && range.x >= 0 && range.y >= range.x, 'SEMANTIC', 'Invalid particle speed range');
  const names: Partial<Record<I.ParticleModuleData, string>> = {
    [I.ParticleModuleData.InheritVelocityModule]: 'particle.inherit-velocity',
    [I.ParticleModuleData.LifetimeByEmitterSpeedModule]: 'particle.lifetime-by-emitter-speed',
    [I.ParticleModuleData.ForceModule]: 'particle.force',
    [I.ParticleModuleData.ColorBySpeedModule]: 'particle.color-by-speed',
    [I.ParticleModuleData.ExternalForcesModule]: 'particle.external-forces',
    [I.ParticleModuleData.CollisionModule]: 'particle.collision',
    [I.ParticleModuleData.TriggerModule]: 'particle.trigger',
    [I.ParticleModuleData.LightsModule]: 'particle.lights',
  };
  for (const c of d.components) {
    if (c.dataType === I.ComponentData.Camera) required('camera.authored');
    if (c.dataType !== I.ComponentData.ParticleSystem) continue;
    const ps = c.data as I.ParticleSystemT,
      main = ps.main!;
    check(
      main.ringBufferLoopRange && main.customEmitterVelocity,
      'SEMANTIC',
      'Missing particle ring buffer range or custom velocity',
    );
    fraction(main.ringBufferLoopRange.x);
    fraction(main.ringBufferLoopRange.y);
    check(
      main.ringBufferLoopRange.x <= main.ringBufferLoopRange.y,
      'SEMANTIC',
      'Invalid ring buffer range',
    );
    if (main.emitterVelocityMode === I.EmitterVelocityMode.Rigidbody)
      slot(main.hostRigidbodyVelocitySlot);
    for (const m of ps.modules) {
      const feature = names[m.dataType];
      if (feature) required(feature);
      switch (m.dataType) {
        case I.ParticleModuleData.LifetimeByEmitterSpeedModule:
        case I.ParticleModuleData.ColorBySpeedModule:
          speed((m.data as I.LifetimeByEmitterSpeedModuleT | I.ColorBySpeedModuleT).speedRange);
          break;
        case I.ParticleModuleData.ExternalForcesModule: {
          const v = m.data as I.ExternalForcesModuleT;
          if (v.filter !== I.InfluenceFilter.List) slot(v.hostForceFieldsSlot);
          for (const r of v.influences) {
            const active = v.filter !== I.InfluenceFilter.LayerMask;
            const before: boolean = host;
            reference(r, [I.EnvironmentKind.ForceField]);
            if (!active) host = before;
          }
          break;
        }
        case I.ParticleModuleData.CollisionModule: {
          const v = m.data as I.CollisionModuleT;
          check(
            v.planes.every((id) => !id || nodes.has(id)) &&
              v.minKillSpeed >= 0 &&
              v.maxKillSpeed >= v.minKillSpeed &&
              v.radiusScale >= 0 &&
              v.voxelSize >= 0 &&
              v.colliderForce >= 0,
            'SEMANTIC',
            'Invalid particle collision',
          );
          if (v.type === I.CollisionType.World) slot(v.hostPhysicsSlot);
          break;
        }
        case I.ParticleModuleData.TriggerModule: {
          const v = m.data as I.TriggerModuleT;
          check(v.radiusScale >= 0, 'SEMANTIC', 'Negative trigger radius');
          for (const r of v.colliders)
            reference(r, [I.EnvironmentKind.Collider3D, I.EnvironmentKind.Collider2D]);
          break;
        }
        case I.ParticleModuleData.LightsModule: {
          const v = m.data as I.LightsModuleT;
          fraction(v.ratio);
          reference(v.light!, [I.EnvironmentKind.Light]);
          break;
        }
        case I.ParticleModuleData.TextureSheetModule: {
          const v = m.data as I.TextureSheetModuleT;
          fraction(v.flipUProbability);
          fraction(v.flipVProbability);
          break;
        }
        case I.ParticleModuleData.ShapeModule: {
          const v = m.data as I.ShapeModuleT;
          if (v.texture) {
            required('particle.shape.texture');
            check(
              assets.get(v.texture.imageAssetId) === I.AssetKind.Image &&
                v.texture.clipChannel <= 3 &&
                v.texture.uvChannel <= 3,
              'SEMANTIC',
              'Invalid shape texture',
            );
            fraction(v.texture.clipThreshold);
          }
          if (
            v.geometryType === I.ShapeGeometry.MeshShape ||
            v.geometryType === I.ShapeGeometry.SpriteShape
          ) {
            const g = v.geometry as I.MeshShapeT | I.SpriteShapeT;
            fraction(g.spawnSpread);
            if (g.sourceRendererComponentId) {
              required('particle.shape.renderer');
              check(
                components.get(g.sourceRendererComponentId)?.dataType ===
                  (v.geometryType === I.ShapeGeometry.MeshShape
                    ? I.ComponentData.MeshRenderer
                    : I.ComponentData.SpriteRenderer),
                'SEMANTIC',
                'Invalid shape source renderer',
              );
            }
            if (v.geometryType === I.ShapeGeometry.MeshShape)
              check(
                assets.get((g as I.MeshShapeT).meshAssetId) === I.AssetKind.Mesh,
                'SEMANTIC',
                'Invalid shape mesh asset',
              );
          }
          break;
        }
      }
    }
  }
  if (host) required('host.particle-environment');
}
