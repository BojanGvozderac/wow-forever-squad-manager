export type DomainErrorCode = "invalid_input" | "forbidden" | "conflict";

/** Expected domain failures with messages safe to return to API clients. */
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}
