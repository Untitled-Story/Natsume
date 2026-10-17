import { readFileSync, writeFileSync } from 'node:fs';

// This parser deliberately accepts only the grammar used by the pinned schemas.
// New syntax must fail generation rather than silently omit validation metadata.
export function describeSchema(source) {
  source = source.replace(/\/\/[^\n]*/g, '');
  const definitions = {};
  source = source.replace(
    /\b(enum|union|struct|table)\s+(\w+)(?:\s*:\s*(\w+))?\s*\{([^}]*)\}/g,
    (_, kind, name, base, body) => {
      if (kind === 'enum' || kind === 'union') {
        let next = kind === 'union' ? 1 : 0;
        const values = kind === 'union' ? { 0: 'NONE' } : {};
        for (const entry of body
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)) {
          const m = /^(\w+)(?:\s*=\s*(\d+))?$/.exec(entry);
          if (!m) throw new Error(`Unsupported ${kind} entry: ${entry}`);
          const value = m[2] ? Number(m[2]) : next;
          values[value] = m[1];
          next = value + 1;
        }
        definitions[name] = { kind, base: base ?? 'ubyte', values };
      } else {
        const fields = [];
        for (const entry of body
          .split(';')
          .map((v) => v.trim())
          .filter(Boolean)) {
          const m =
            /^(\w+)\s*:\s*(\[\w+\]|\w+)(?:\s*=\s*([\w.+-]+))?(?:\s*\(\s*(required)\s*\))?$/.exec(
              entry,
            );
          if (!m) throw new Error(`Unsupported field: ${entry}`);
          fields.push({ name: m[1], type: m[2], required: Boolean(m[4]) });
        }
        definitions[name] = { kind, fields };
      }
      return '';
    },
  );
  const root = /root_type\s+(\w+)\s*;/.exec(source)?.[1];
  const identifier = /file_identifier\s+"(\w+)"\s*;/.exec(source)?.[1];
  source = source
    .replace(
      /(?:namespace\s+[\w.]+|root_type\s+\w+|file_(?:identifier|extension)\s+"\w+")\s*;/g,
      '',
    )
    .trim();
  if (source || !root || !identifier) throw new Error(`Unsupported schema syntax: ${source}`);
  const scalarSizes = {
    bool: 1,
    byte: 1,
    ubyte: 1,
    short: 2,
    ushort: 2,
    int: 4,
    uint: 4,
    float: 4,
    long: 8,
    ulong: 8,
    double: 8,
  };
  const layout = (name) => {
    if (scalarSizes[name]) return { size: scalarSizes[name], align: scalarSizes[name] };
    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown type: ${name}`);
    if (definition.kind === 'enum') return layout(definition.base);
    if (definition.kind !== 'struct') return { size: 4, align: 4 };
    if (definition.size) return definition;
    let size = 0,
      align = 1;
    for (const field of definition.fields) {
      const child = layout(field.type);
      align = Math.max(align, child.align);
      size = Math.ceil(size / child.align) * child.align;
      field.offset = size;
      size += child.size;
    }
    definition.align = align;
    definition.size = Math.ceil(size / align) * align;
    return definition;
  };
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.kind === 'struct') layout(name);
    if (definition.kind === 'table') {
      let slot = 0;
      definition.fields = definition.fields.flatMap((field) => {
        if (definitions[field.type]?.kind === 'union') {
          return [
            { name: `${field.name}_type`, type: 'ubyte', required: false, slot: slot++ },
            { ...field, slot: slot++, tagSlot: slot - 2 },
          ];
        }
        return [{ ...field, slot: slot++ }];
      });
    }
  }
  return { root, identifier, definitions };
}

export function generateDescriptors() {
  const schemas = Object.fromEntries(
    ['noir', 'mesh'].map((name) => [
      name,
      describeSchema(readFileSync(`schemas/${name}.fbs`, 'utf8')),
    ]),
  );
  writeFileSync(
    'src/format/generated/schema.ts',
    `// Generated from pinned schemas. Run pnpm generate.\nexport const schemas = ${JSON.stringify(schemas)} as const;\n`,
  );
}
