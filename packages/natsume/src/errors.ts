export type ErrorCode =
  | 'LIMIT'
  | 'ZIP'
  | 'MANIFEST'
  | 'HASH'
  | 'BINARY'
  | 'SEMANTIC'
  | 'VERSION'
  | 'CAPABILITY'
  | 'HOST'
  | 'DISPOSED';

export class NatsumeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly path = '',
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'NatsumeError';
  }
}

export function check(
  condition: unknown,
  code: ErrorCode,
  message: string,
  path = '',
): asserts condition {
  if (!condition) throw new NatsumeError(code, message, path);
}
