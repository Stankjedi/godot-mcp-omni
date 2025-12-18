export function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export class ValidationError extends Error {
  field: string;
  receivedType: string;

  constructor(field: string, message: string, receivedType: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.receivedType = receivedType;
  }
}

function fail(fieldName: string, expected: string, value: unknown): never {
  const receivedType = valueType(value);
  throw new ValidationError(
    fieldName,
    `Invalid field "${fieldName}": expected ${expected}, got ${receivedType}`,
    receivedType
  );
}

export function asString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') fail(fieldName, 'string', value);
  return value;
}

export function asNonEmptyString(value: unknown, fieldName: string): string {
  const s = asString(value, fieldName);
  if (s.trim().length === 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected non-empty string`,
      valueType(value)
    );
  }
  return s;
}

export function asOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, fieldName);
}

export function asNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) fail(fieldName, 'number', value);
  return value;
}

export function asOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asNumber(value, fieldName);
}

export function asPositiveNumber(value: unknown, fieldName: string): number {
  const n = asNumber(value, fieldName);
  if (n <= 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected positive number`,
      valueType(value)
    );
  }
  return n;
}

export function asOptionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asPositiveNumber(value, fieldName);
}

export function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(fieldName, 'object', value);
  return value as Record<string, unknown>;
}

export function asOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return asRecord(value, fieldName);
}

export function asRecordOrJson(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    try {
      return asRecord(JSON.parse(trimmed), fieldName);
    } catch {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": expected object or JSON object string`,
        valueType(value)
      );
    }
  }
  return asRecord(value, fieldName);
}

export function asOptionalRecordOrJson(
  value: unknown,
  fieldName: string,
  defaultValue: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value === undefined || value === null) return defaultValue;
  return asRecordOrJson(value, fieldName);
}
