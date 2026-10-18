import { NatsumeError, type ErrorCode } from '../errors.js';

export interface SupportIssue {
  readonly severity: 'error' | 'warning';
  readonly code: ErrorCode | string;
  readonly field: string;
  readonly value: unknown;
  readonly message: string;
}

/** Collects independent checks without allocating simulation or GPU resources. */
export class SupportChecks {
  readonly issues: SupportIssue[] = [];
  require(
    condition: unknown,
    code: ErrorCode,
    field: string,
    value: unknown,
    message: string,
  ): void {
    if (!condition) this.issues.push({ severity: 'error', code, field, value, message });
  }
  warn(code: string, field: string, value: unknown, message: string): void {
    this.issues.push({ severity: 'warning', code, field, value, message });
  }
}

export function assertSupport(issues: readonly SupportIssue[]): void {
  const issue = issues.find((issue) => issue.severity === 'error');
  if (issue) throw new NatsumeError(issue.code as ErrorCode, issue.message, issue.field);
}
