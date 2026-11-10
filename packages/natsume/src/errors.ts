/** Failure categories; see the diagnostics guide for what each one means. */
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

/** Error raised by Natsume. `code` classifies the failure; `path` locates it when known. */
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
