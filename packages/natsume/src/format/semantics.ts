import { validateAnimationBindings } from './animation-semantics.js';
import { check } from '../errors.js';
import type { DocumentT } from './generated/noa/ir/document.js';
import type { MeshT } from './generated/noa/mesh/mesh.js';
import { schemas } from './generated/schema.js';

type ObjectValue = Record<string, unknown>;
interface SchemaDefinition {
  kind: string;
  fields?: readonly { name: string; type: string }[];
  values?: Readonly<Record<string, string>>;
}
const definitions: Readonly<Record<string, SchemaDefinition>> = schemas.noir.definitions;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const object = (value: unknown): ObjectValue => {
  check(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    'SEMANTIC',
    'Missing object',
  );
  return value as ObjectValue;
};
const array = (value: unknown): ObjectValue[] => {
  check(Array.isArray(value), 'SEMANTIC', 'Missing array');
  return value.map(object);
};
const number = (o: ObjectValue, key: string) => {
  const value = o[key];
  check(typeof value === 'number' && Number.isFinite(value), 'SEMANTIC', `Invalid ${key}`);
  return value;
};
const present = (o: ObjectValue, ...keys: string[]) =>
  keys.forEach((key) =>
    check(o[key] !== null && o[key] !== undefined, 'SEMANTIC', `Missing ${key}`),
  );
const ordered = (values: ObjectValue[], normalized = false) => {
  check(values.length > 0, 'SEMANTIC', 'Empty keys');
  let previous = -Infinity;
  for (const key of values) {
    const time = number(key, 'time');
    check(
      time > previous && (!normalized || (time >= 0 && time <= 1)),
      'SEMANTIC',
      'Invalid key times',
    );
    previous = time;
  }
};
const unit = (value: number, name: string) =>
  check(value >= 0 && value <= 1, 'SEMANTIC', `Invalid ${name}`);

export const KNOWN_FEATURES: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    [
      'scene.trs',
      'layout.rect',
      'camera.host',
      'script.bridge',
      'animator.single-layer',
      'animation.node-active',
      'animation.transform',
      'animation.layout',
      'animation.component-enabled',
      'animation.particle',
      'animation.renderer-material',
      'particle.main',
      'particle.renderer',
      'particle.mesh-distribution',
      'particle.emission',
      'particle.shape.circle',
      'particle.shape.sphere',
      'particle.shape.hemisphere',
      'particle.shape.box',
      'particle.shape.cone',
      'particle.shape.cone-volume',
      'particle.shape.edge',
      'particle.color',
      'particle.size',
      'particle.size-by-speed',
      'particle.rotation-by-speed',
      'particle.rotation',
      'particle.velocity',
      'particle.limit-velocity',
      'particle.texture-sheet',
      'particle.custom-data',
      'particle.noise.unity',
      'curve.unity-infinity',
      'color.authored',
      'material.particle-add-alpha',
      'material.particle-unlit',
      'material.unity-legacy-particle-additive',
      'material.unity-legacy-particle-alpha-blend',
      'host.legacy-particle-environment',
      'mesh.nomesh',
    ].map((name) => [name, 1]),
  ),
);

export function validateDocument(document: DocumentT): void {
  check(
    document.formatMajor === 1 && document.formatMinor === 0 && document.semanticsRevision === 1,
    'VERSION',
    'Unsupported NOIR version or semantics revision',
  );
  check(
    document.nodes.length && document.entries.length,
    'SEMANTIC',
    'Document needs nodes and entries',
  );
  const ids = new Map<number, string>();
  const add = (id: number, kind: string) => {
    check(id > 0 && !ids.has(id), 'SEMANTIC', `Duplicate/zero entity ID ${id}`);
    ids.set(id, kind);
  };
  const ref = (id: number, kind: string) =>
    check(ids.get(id) === kind, 'SEMANTIC', `Invalid ${kind} reference ${id}`);
  for (const [kind, values] of [
    ['node', document.nodes],
    ['component', document.components],
    ['asset', document.assets],
    ['material', document.materials],
    ['animation', document.animations],
    ['entry', document.entries],
  ] as const)
    for (const value of values) add(value.id, kind);
  const components = new Map(document.components.map((value) => [value.id, value]));
  const assets = new Map(document.assets.map((value) => [value.id, value]));
  const nodes = new Map(document.nodes.map((value) => [value.id, value]));
  for (const component of document.components)
    if (component.dataType === 6) {
      for (const layer of array(object(component.data).layers))
        for (const state of array(layer.states)) add(number(state, 'id'), 'state');
    }
  ref(document.defaultEntryId, 'entry');
  // Linear-time hierarchy validation; input depth does not recurse on the JS stack.
  const finished = new Set<number>();
  for (const node of document.nodes) {
    if (node.parentId) ref(node.parentId, 'node');
    const path = new Set<number>();
    let id = node.id;
    while (id !== 0 && !finished.has(id)) {
      check(!path.has(id), 'SEMANTIC', 'Node hierarchy cycle');
      path.add(id);
      const next = nodes.get(id);
      check(next, 'SEMANTIC', 'Missing parent node');
      id = next.parentId;
    }
    for (const item of path) finished.add(item);
  }
  const assetRef = (id: number, kind: number) => {
    ref(id, 'asset');
    check(assets.get(id)?.kind === kind, 'SEMANTIC', 'Asset kind mismatch');
  };
  for (const component of document.components) {
    ref(component.nodeId, 'node');
    check(component.dataType !== 0 && component.data, 'SEMANTIC', 'Missing component payload');
    const data = object(component.data);
    if (component.dataType === 3) {
      check(document.colorContext, 'SEMANTIC', 'Particles require a color context');
      const main = object(data.main);
      if (main.space === 2) ref(number(main, 'customSpaceNodeId'), 'node');
    }
    if (component.dataType === 4) {
      const system = components.get(number(data, 'systemComponentId'));
      check(
        system?.dataType === 3 && system.nodeId === component.nodeId,
        'SEMANTIC',
        'Renderer must reference its own particle system',
      );
      for (const material of data.materials as number[]) if (material) ref(material, 'material');
      for (const mesh of data.meshAssetIds as number[]) assetRef(mesh, 2);
    }
  }
  for (const material of document.materials) {
    check(material.model !== 0, 'SEMANTIC', 'Unknown material model');
    for (const texture of material.textures) assetRef(texture.imageId, 1);
    if (material.shaderDataAssetId) assetRef(material.shaderDataAssetId, 3);
  }
  for (const entry of document.entries) {
    check(
      entry.roots.length > 0 && new Set(entry.roots).size === entry.roots.length,
      'SEMANTIC',
      'Entry needs unique roots',
    );
    for (const root of entry.roots) ref(root, 'node');
    if (entry.cameraPolicy === 0)
      check(entry.hostCameraSlot, 'SEMANTIC', 'Missing host camera slot');
    else
      check(
        components.get(entry.cameraComponentId)?.dataType === 2,
        'SEMANTIC',
        'Invalid embedded camera',
      );
    for (const action of entry.actions) {
      if (action.kind <= 1) {
        ref(action.animationId, 'animation');
        check(action.targetId === 0, 'SEMANTIC', 'Clip action cannot specify a target');
      } else if (action.kind === 4) ref(action.targetId, 'node');
      else
        check(
          components.get(action.targetId)?.dataType === 3,
          'SEMANTIC',
          'Particle action target must be a particle system',
        );
    }
  }
  const features = new Map<string, number>();
  for (const feature of document.features) {
    check(
      typeof feature.name === 'string' &&
        feature.name.length > 0 &&
        !features.has(feature.name) &&
        feature.revision > 0,
      'SEMANTIC',
      'Invalid/duplicate feature',
    );
    check(
      !feature.required || KNOWN_FEATURES[feature.name] === feature.revision,
      'CAPABILITY',
      `Unknown required feature ${feature.name}@${feature.revision}`,
    );
    features.set(feature.name, feature.revision);
  }
  const requireFeature = (name: string) =>
    check(
      document.features.some(
        (feature) => feature.name === name && feature.revision === 1 && feature.required,
      ),
      'SEMANTIC',
      `Missing required ${name}@1 declaration`,
    );
  const checkTable = (name: string, o: ObjectValue) => {
    const extent = (key: string) => {
      const p = object(o[key]);
      if (p.mode === 0) check(number(p, 'constantMax') >= 0, 'SEMANTIC', 'Negative shape extent');
      if (p.mode === 2)
        check(
          number(p, 'constantMin') >= 0 && number(p, 'constantMax') >= 0,
          'SEMANTIC',
          'Negative shape extent',
        );
    };
    const arc = () =>
      check(
        number(o, 'arcRadians') >= 0 && number(o, 'arcRadians') <= Math.PI * 2 + 2e-7,
        'SEMANTIC',
        'Invalid shape arc',
      );
    switch (name) {
      case 'Transform':
        present(o, 'position', 'rotation', 'scale');
        break;
      case 'RectLayout':
        present(o, 'anchorMin', 'anchorMax', 'pivot', 'anchoredPosition', 'sizeDelta');
        break;
      case 'ScriptIdentity':
        check(o.assembly && o.className, 'SEMANTIC', 'Empty script identity');
        break;
      case 'TypedReference':
        ref(
          number(o, 'id'),
          ['unknown', 'node', 'component', 'material', 'asset', 'animation'][number(o, 'kind')] ??
            'unknown',
        );
        break;
      case 'SerializedValue':
        check(o.dataType !== 0 && o.data, 'SEMANTIC', 'Missing serialized value');
        break;
      case 'ScalarParameter':
        if (o.mode === 1 || o.mode === 3) {
          present(o, 'curveMax');
          const active =
            o.mode === 3 ? [object(o.curveMax), object(o.curveMin)] : [object(o.curveMax)];
          for (const curve of active)
            if (curve.preWrap === 3 || curve.postWrap === 3) requireFeature('curve.unity-infinity');
        }
        break;
      case 'ScalarCurve':
        ordered(array(o.keys));
        for (const key of array(o.keys)) {
          unit(number(key, 'inWeight'), 'curve weight');
          unit(number(key, 'outWeight'), 'curve weight');
        }
        break;
      case 'VectorParameter':
        present(o, 'x', 'y', 'z');
        break;
      case 'ColorParameter':
        if (o.mode === 0 || o.mode === 2) {
          present(o, 'colorMax');
          if (o.mode === 2) present(o, 'colorMin');
        } else {
          present(o, 'gradientMax');
          if (o.mode === 3) present(o, 'gradientMin');
        }
        break;
      case 'Gradient':
        ordered(array(o.rgb), true);
        ordered(array(o.alpha), true);
        break;
      case 'ColorContext':
        if (o.projectColorSpace === 2)
          check(o.hostProjectColorSpaceSlot, 'SEMANTIC', 'Missing source-project color-space slot');
        break;
      case 'ParticleRenderer':
        if (o.mode === 4 && o.meshDistribution === 1) {
          const weights = o.meshWeights as number[];
          check(
            weights.length === (o.meshAssetIds as number[]).length &&
              weights.every((w) => Number.isFinite(w) && w >= 0) &&
              Number.isFinite(weights.reduce((sum, w) => sum + w, 0)),
            'SEMANTIC',
            'Invalid mesh weights',
          );
          requireFeature('particle.mesh-distribution');
        }
        break;
      case 'MainModule':
        check(
          number(o, 'durationSeconds') > 0 &&
            number(o, 'simulationSpeed') >= 0 &&
            number(o, 'maxParticles') > 0,
          'SEMANTIC',
          'Invalid particle main settings',
        );
        unit(number(o, 'flipRotationProbability'), 'flip rotation probability');
        break;
      case 'Burst':
        check(
          number(o, 'timeSeconds') >= 0 &&
            number(o, 'intervalSeconds') >= 0 &&
            number(o, 'cycles') >= 0,
          'SEMANTIC',
          'Invalid burst',
        );
        unit(number(o, 'probability'), 'burst probability');
        break;
      case 'ParticleSystem': {
        const modules = array(o.modules);
        check(
          new Set(modules.map((v) => v.dataType)).size === modules.length,
          'SEMANTIC',
          'Duplicate particle module',
        );
        break;
      }
      case 'ParticleModule':
        check(o.dataType !== 0 && o.data, 'SEMANTIC', 'Missing particle module');
        break;
      case 'ShapeModule': {
        check(o.geometryType !== 0 && o.geometry, 'SEMANTIC', 'Missing shape geometry');
        const g = object(o.geometry);
        const feature = [
          '',
          'circle',
          'box',
          g.hemisphere ? 'hemisphere' : 'sphere',
          g.region === 1 ? 'cone-volume' : 'cone',
          'edge',
        ][Number(o.geometryType)];
        requireFeature(`particle.shape.${feature}`);
        unit(number(o, 'randomDirection'), 'random direction');
        unit(number(o, 'sphericalDirection'), 'spherical direction');
        check(number(o, 'randomPosition') >= 0, 'SEMANTIC', 'Negative shape jitter');
        break;
      }
      case 'CircleShape':
      case 'ConeShape':
        extent('radius');
        unit(number(o, 'radiusThickness'), 'radius thickness');
        unit(number(o, 'arcSpread'), 'arc spread');
        unit(number(o, 'radiusSpread'), 'radius spread');
        arc();
        if (name === 'ConeShape')
          check(
            number(o, 'angleRadians') >= 0 &&
              number(o, 'angleRadians') <= Math.PI / 2 + 1e-7 &&
              number(o, 'length') >= 0,
            'SEMANTIC',
            'Invalid cone',
          );
        break;
      case 'SphereShape':
        extent('radius');
        unit(number(o, 'radiusThickness'), 'radius thickness');
        break;
      case 'BoxShape': {
        const t = object(o.thickness);
        for (const axis of ['x', 'y', 'z']) unit(number(t, axis), 'box thickness');
        break;
      }
      case 'EdgeShape':
        extent('halfLength');
        unit(number(o, 'spread'), 'edge spread');
        break;
      case 'SizeBySpeedModule':
      case 'RotationBySpeedModule': {
        requireFeature(
          name === 'SizeBySpeedModule' ? 'particle.size-by-speed' : 'particle.rotation-by-speed',
        );
        const range = object(o.speedRange);
        check(
          number(range, 'x') >= 0 && number(range, 'y') >= number(range, 'x'),
          'SEMANTIC',
          'Invalid speed range',
        );
        break;
      }
      case 'NoiseModule':
        check(
          o.algorithm && number(o, 'algorithmRevision') > 0 && number(o, 'octaves') > 0,
          'SEMANTIC',
          'Invalid noise contract',
        );
        if (o.remapEnabled) present(o, 'remap');
        break;
      case 'TextureSheetModule':
        check(
          number(o, 'columns') > 0 && number(o, 'rows') > 0 && number(o, 'row') < number(o, 'rows'),
          'SEMANTIC',
          'Invalid texture sheet',
        );
        break;
      case 'CustomDataModule': {
        const streams = array(o.streams);
        check(
          new Set(streams.map((v) => v.slot)).size === streams.length,
          'SEMANTIC',
          'Duplicate custom stream',
        );
        break;
      }
      case 'CustomDataStream':
        check(number(o, 'slot') <= 1, 'SEMANTIC', 'Invalid custom stream slot');
        if (o.mode === 2) present(o, 'color');
        if (o.mode === 1)
          check(
            number(o, 'vectorComponents') >= 1 &&
              number(o, 'vectorComponents') <= 4 &&
              array(o.vector).length === o.vectorComponents,
            'SEMANTIC',
            'Custom vector count mismatch',
          );
        break;
      case 'RenderState':
        check(number(o, 'colorWriteMask') <= 15, 'SEMANTIC', 'Invalid color mask');
        break;
      case 'VertexStream':
        check(
          number(o, 'components') >= 1 && number(o, 'components') <= 4,
          'SEMANTIC',
          'Invalid vertex stream',
        );
        break;
      case 'AnimatorLayer':
        check(
          array(o.states).some((state) => state.id === o.defaultStateId),
          'SEMANTIC',
          'Missing default animator state',
        );
        break;
      case 'AnimatorState':
        ref(number(o, 'animationId'), 'animation');
        break;
      case 'Animation':
        check(number(o, 'durationSeconds') >= 0, 'SEMANTIC', 'Negative animation duration');
        break;
      case 'Track': {
        check(o.dataType !== 0 && o.data, 'SEMANTIC', 'Missing track payload');
        const binding = object(o.binding),
          target = number(binding, 'targetId');
        check(ids.has(target), 'SEMANTIC', 'Missing animation target');
        for (const curve of Object.values(object(o.data))) {
          if (!curve || typeof curve !== 'object' || !('domain' in curve)) continue;
          check(object(curve).domain === 0, 'SEMANTIC', 'Animation curves require Seconds domain');
          for (const key of array(object(curve).keys))
            check(number(key, 'time') >= 0, 'SEMANTIC', 'Negative animation key time');
        }
        if (binding.property === 1) {
          ref(target, 'node');
          check(o.dataType === 5, 'SEMANTIC', 'NodeActive requires BoolTrack');
        }
        break;
      }
      case 'BoolTrack':
        ordered(array(o.keys));
        for (const key of array(o.keys))
          check(number(key, 'time') >= 0, 'SEMANTIC', 'Negative animation key time');
        break;
      case 'ReferenceTrack':
        ordered(array(o.keys));
        for (const key of array(o.keys))
          check(ids.has(number(key, 'refId')), 'SEMANTIC', 'Missing reference-track target');
        break;
      case 'FloatTrack': {
        const curve = object(o.curve);
        if (curve.preWrap === 3 || curve.postWrap === 3) requireFeature('curve.unity-infinity');
        break;
      }
      case 'Camera':
        check(
          number(o, 'nearPlane') > 0 && number(o, 'farPlane') > number(o, 'nearPlane'),
          'SEMANTIC',
          'Invalid camera planes',
        );
        if (o.projection === 0)
          check(
            number(o, 'fovRadians') > 0 && number(o, 'fovRadians') < Math.PI,
            'SEMANTIC',
            'Invalid camera FOV',
          );
        if (o.projection === 1)
          check(number(o, 'orthoHalfHeight') > 0, 'SEMANTIC', 'Invalid orthographic size');
        if (o.projection === 2)
          check(
            Array.isArray(object(o.customProjection).values) &&
              (object(o.customProjection).values as unknown[]).length === 16,
            'SEMANTIC',
            'Invalid custom projection',
          );
        if (o.aspectMode === 1) check(number(o, 'aspect') > 0, 'SEMANTIC', 'Invalid camera aspect');
        break;
    }
  };
  const visit = (type: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (type.startsWith('[')) {
      for (const item of value as unknown[]) visit(type.slice(1, -1), item);
      return;
    }
    const definition = definitions[type];
    if (!definition?.fields) return;
    const o = object(value);
    checkTable(type, o);
    for (const field of definition.fields) {
      const key = camel(field.name),
        union = definitions[field.type];
      // Inactive parameter branches carry no execution semantics.
      if (
        type === 'ScalarParameter' &&
        key.startsWith('curve') &&
        !(key === 'curveMax' ? o.mode === 1 || o.mode === 3 : o.mode === 3)
      )
        continue;
      if (
        type === 'ColorParameter' &&
        ['colorMin', 'colorMax', 'gradientMin', 'gradientMax'].includes(key)
      ) {
        const active: Record<string, number[]> = {
          colorMin: [2],
          colorMax: [0, 2],
          gradientMin: [3],
          gradientMax: [1, 3, 4],
        };
        if (!active[key]?.includes(Number(o.mode))) continue;
      }
      if (type === 'NoiseModule' && key === 'remap' && !o.remapEnabled) continue;
      if (
        type === 'CustomDataStream' &&
        ((key === 'vector' && o.mode !== 1) || (key === 'color' && o.mode !== 2))
      )
        continue;
      if (union?.kind === 'union') {
        const tag = Number(o[`${key}Type`]);
        if (tag !== 0) visit(union.values?.[tag] ?? '', o[key]);
      } else visit(field.type, o[key]);
    }
  };
  visit('Document', document);
  validateAnimationBindings(document, requireFeature);
  for (const material of document.materials)
    if (material.model === 4 || material.model === 5) {
      requireFeature(
        material.model === 4
          ? 'material.unity-legacy-particle-additive'
          : 'material.unity-legacy-particle-alpha-blend',
      );
      requireFeature('host.legacy-particle-environment');
      check(material.shaderDataAssetId > 0, 'SEMANTIC', 'Legacy material requires a shader recipe');
    }
  if (document.components.some((value) => value.dataType === 3)) requireFeature('color.authored');
}

export function validateMesh(mesh: MeshT): void {
  check(mesh.formatMajor === 1 && mesh.formatMinor === 0, 'VERSION', 'Unsupported mesh version');
  check(
    mesh.positions.length > 0 && mesh.indices.length > 0 && mesh.indices.length % 3 === 0,
    'SEMANTIC',
    'Mesh needs vertices and triangle indices',
  );
  check(
    (mesh.normals.length === 0 || mesh.normals.length === mesh.positions.length) &&
      (mesh.uv0.length === 0 || mesh.uv0.length === mesh.positions.length),
    'SEMANTIC',
    'Mesh attribute count mismatch',
  );
  check(
    mesh.indices.every((index) => index < mesh.positions.length),
    'SEMANTIC',
    'Mesh index out of range',
  );
  let end = 0;
  for (const submesh of mesh.submeshes) {
    check(
      submesh.firstIndex === end && submesh.indexCount > 0 && submesh.indexCount % 3 === 0,
      'SEMANTIC',
      'Invalid submesh range',
    );
    end += submesh.indexCount;
  }
  check(end === mesh.indices.length, 'SEMANTIC', 'Submeshes must cover all indices');
}
