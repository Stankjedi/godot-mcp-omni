export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepSubstitute(
  value: unknown,
  substitutions: Record<string, string>,
): unknown {
  if (typeof value === 'string') return substitutions[value] ?? value;
  if (Array.isArray(value))
    return value.map((entry) => deepSubstitute(entry, substitutions));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepSubstitute(v, substitutions);
    }
    return out;
  }
  return value;
}
