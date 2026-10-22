import { check } from '../errors.js';
import { schemas } from './generated/schema.js';

interface Field {
  name: string;
  type: string;
  required: boolean;
  slot?: number;
  offset?: number;
  tagSlot?: number;
}
interface Definition {
  kind: string;
  fields?: readonly Field[];
  values?: Readonly<Record<string, string>>;
  base?: string;
  size?: number;
  align?: number;
}
interface Schema {
  root: string;
  identifier: string;
  definitions: Readonly<Record<string, Definition>>;
}
const sizes: Readonly<Record<string, number>> = {
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

/** Validate every known field before a generated accessor can read the buffer. */
export function verifyBuffer(bytes: Uint8Array, format: keyof typeof schemas): void {
  const schema: Schema = schemas[format];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let visits = 0;
  const bounds = (at: number, size: number, alignment = 1) => {
    check(
      Number.isSafeInteger(at) &&
        at >= 0 &&
        at % alignment === 0 &&
        size >= 0 &&
        size <= bytes.length - at,
      'BINARY',
      'Out-of-range or misaligned field',
      `${format}@${at}`,
    );
  };
  const pointer = (at: number) => {
    bounds(at, 4, 4);
    const offset = view.getUint32(at, true);
    check(offset >= 4, 'BINARY', 'Invalid forward offset', `${format}@${at}`);
    const target = at + offset;
    bounds(target, 1);
    return target;
  };
  const sizeOf = (type: string): number =>
    sizes[type] ??
    (schema.definitions[type]?.kind === 'struct' ? schema.definitions[type]?.size : undefined) ??
    (schema.definitions[type]?.kind === 'enum'
      ? sizes[schema.definitions[type]?.base ?? 'ubyte']
      : undefined) ??
    4;
  const scalar = (type: string, at: number): number | bigint => {
    bounds(at, sizeOf(type), sizeOf(type));
    switch (type) {
      case 'float':
      case 'double': {
        const value = type === 'float' ? view.getFloat32(at, true) : view.getFloat64(at, true);
        check(Number.isFinite(value), 'BINARY', 'Non-finite number', `${format}@${at}`);
        return value;
      }
      case 'bool': {
        const value = view.getUint8(at);
        check(value <= 1, 'BINARY', 'Invalid boolean');
        return value;
      }
      case 'byte':
        return view.getInt8(at);
      case 'ubyte':
        return view.getUint8(at);
      case 'short':
        return view.getInt16(at, true);
      case 'ushort':
        return view.getUint16(at, true);
      case 'int':
        return view.getInt32(at, true);
      case 'uint':
        return view.getUint32(at, true);
      case 'long':
        return view.getBigInt64(at, true);
      case 'ulong':
        return view.getBigUint64(at, true);
      default:
        throw new Error(`Unknown scalar ${type}`);
    }
  };
  const walk = (type: string, at: number, depth: number, indirect: boolean) => {
    check(++visits <= 1_000_000 && depth <= 64, 'LIMIT', 'FlatBuffer traversal limit exceeded');
    if (sizes[type]) {
      scalar(type, at);
      return;
    }
    if (type === 'string') {
      const start = pointer(at);
      bounds(start, 4, 4);
      const length = view.getUint32(start, true);
      bounds(start + 4, length + 1);
      check(view.getUint8(start + 4 + length) === 0, 'BINARY', 'String terminator missing');
      try {
        utf8.decode(bytes.subarray(start + 4, start + 4 + length));
      } catch {
        check(false, 'BINARY', 'Invalid UTF-8');
      }
      return;
    }
    if (type.startsWith('[')) {
      const element = type.slice(1, -1),
        start = pointer(at);
      bounds(start, 4, 4);
      const length = view.getUint32(start, true),
        stride = sizeOf(element);
      check(length <= 1_000_000, 'LIMIT', 'Vector length limit exceeded');
      bounds(start + 4, length * stride);
      for (let i = 0; i < length; i++) walk(element, start + 4 + i * stride, depth + 1, true);
      return;
    }
    const definition = schema.definitions[type];
    check(definition, 'BINARY', `Unknown schema type ${type}`);
    if (definition.kind === 'enum') {
      const value = scalar(definition.base ?? 'ubyte', at);
      check(
        definition.values?.[String(value)] !== undefined,
        'BINARY',
        `Unknown ${type} value ${value}`,
      );
      return;
    }
    if (definition.kind === 'struct') {
      bounds(at, definition.size ?? 0, definition.align);
      for (const field of definition.fields ?? [])
        walk(field.type, at + (field.offset ?? 0), depth + 1, false);
      return;
    }
    check(definition.kind === 'table', 'BINARY', `Unexpected ${type}`);
    const table = indirect ? pointer(at) : at;
    bounds(table, 4, 4);
    const delta = view.getInt32(table, true);
    check(delta !== 0, 'BINARY', 'Missing vtable');
    const vtable = table - delta;
    bounds(vtable, 4, 2);
    const vsize = view.getUint16(vtable, true),
      objectSize = view.getUint16(vtable + 2, true);
    check(vsize >= 4 && vsize % 2 === 0 && objectSize >= 4, 'BINARY', 'Invalid table sizes');
    bounds(vtable, vsize, 2);
    bounds(table, objectSize, 4);
    const fieldAt = (slot: number) => {
      const entry = 4 + slot * 2;
      const offset = entry < vsize ? view.getUint16(vtable + entry, true) : 0;
      check(
        offset === 0 || (offset >= 4 && offset < objectSize),
        'BINARY',
        'Invalid table field offset',
      );
      return offset ? table + offset : 0;
    };
    if (type === schema.root && depth === 0) {
      const version = (name: string, fallback: number) => {
        const field = definition.fields?.find((f) => f.name === name);
        if (!field) return fallback;
        const pos = fieldAt(field.slot ?? 0);
        if (!pos) return fallback;
        check(pos + sizeOf(field.type) <= table + objectSize, 'BINARY', 'Version outside table');
        return scalar(field.type, pos);
      };
      check(
        version('format_major', 0) === 2 &&
          version('format_minor', 0) === 0 &&
          (format !== 'noir' || version('semantics_revision', 1) === 1),
        'VERSION',
        `Unsupported ${schema.identifier} version or semantics revision`,
      );
    }
    for (const field of definition.fields ?? []) {
      const pos = fieldAt(field.slot ?? 0);
      check(!field.required || pos !== 0, 'BINARY', `Required ${type}.${field.name} missing`);
      const union = schema.definitions[field.type];
      if (union?.kind === 'union') {
        const tagAt = fieldAt(field.tagSlot ?? 0),
          tag = tagAt ? view.getUint8(tagAt) : 0;
        const child = union.values?.[tag];
        check(
          child !== undefined && (tag === 0 ? pos === 0 : pos !== 0),
          'BINARY',
          `Invalid ${type}.${field.name} union`,
        );
        if (tag !== 0) {
          check(pos + 4 <= table + objectSize, 'BINARY', 'Union outside table');
          walk(child, pos, depth + 1, true);
        }
      } else if (pos) {
        const width =
          field.type.startsWith('[') || field.type === 'string' ? 4 : sizeOf(field.type);
        check(pos + width <= table + objectSize, 'BINARY', 'Field outside table');
        walk(field.type, pos, depth + 1, true);
      }
    }
  };
  bounds(0, 8, 4);
  check(
    String.fromCharCode(...bytes.subarray(4, 8)) === schema.identifier,
    'BINARY',
    `Missing ${schema.identifier} identifier`,
  );
  walk(schema.root, 0, 0, true);
}
