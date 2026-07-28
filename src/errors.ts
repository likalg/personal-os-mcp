export type ErrorKind =
  | "configuration"
  | "authentication"
  | "authorization"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "upstream"
  | "network"
  | "timeout"
  | "invalid_json"
  | "contract";

export interface StructuredError {
  type: ErrorKind;
  status: number | null;
  message: string;
  field_errors: Record<string, string[]>;
  retryable: boolean;
  operation: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class PersonalOsApiError extends Error {
  constructor(public readonly details: StructuredError) {
    super(details.message);
    this.name = "PersonalOsApiError";
  }
}

export function redactSensitive(value: string, token: string): string {
  let redacted = value.replace(
    /authorization\s*:\s*bearer\s+[^\s,;]+/gi,
    "Authorization: [REDACTED]",
  );

  if (token) {
    redacted = redacted.split(token).join("[REDACTED]");
  }

  return redacted;
}
