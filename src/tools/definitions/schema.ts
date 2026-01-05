export type JsonSchema = Record<string, unknown>;

export type JsonSchemaProperties = Record<string, JsonSchema>;

export function strictObjectSchema(options: {
  properties?: JsonSchemaProperties;
  required?: string[];
  description?: string;
  oneOf?: JsonSchema[];
}): JsonSchema {
  const { properties, required, description, oneOf } = options;
  return {
    type: 'object',
    ...(description ? { description } : {}),
    additionalProperties: false,
    ...(properties ? { properties } : { properties: {} }),
    ...(required ? { required } : {}),
    ...(oneOf ? { oneOf } : {}),
  };
}

export function looseObjectSchema(options: {
  description?: string;
}): JsonSchema {
  const { description } = options;
  return {
    type: 'object',
    ...(description ? { description } : {}),
  };
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function pickProperties(
  all: JsonSchemaProperties,
  keys: string[],
): JsonSchemaProperties {
  const out: JsonSchemaProperties = {};
  for (const k of keys) {
    const schema = all[k];
    if (schema) out[k] = schema;
  }
  return out;
}

export type ActionOneOfVariant = {
  action: string;
  required?: string[];
  optional?: string[];
  description?: string;
  oneOf?: JsonSchema[];
};

export function actionOneOfSchema(options: {
  actionKey: string;
  properties: JsonSchemaProperties;
  commonOptional?: string[];
  variants: ActionOneOfVariant[];
}): JsonSchema {
  const actionKey = options.actionKey;
  const properties = options.properties;
  const commonOptional = options.commonOptional ?? [];
  const variants = options.variants;

  const actionValues = variants.map((v) => v.action);
  const unionAllowed = uniqStrings([
    actionKey,
    ...commonOptional,
    ...variants.flatMap((v) => [...(v.required ?? []), ...(v.optional ?? [])]),
  ]);

  const oneOf = variants.map((v) => {
    const required = uniqStrings([actionKey, ...(v.required ?? [])]);
    const allowed = uniqStrings([
      actionKey,
      ...commonOptional,
      ...(v.required ?? []),
      ...(v.optional ?? []),
    ]);

    return strictObjectSchema({
      properties: {
        [actionKey]: { type: 'string', const: v.action },
        ...pickProperties(
          properties,
          allowed.filter((k) => k !== actionKey),
        ),
      },
      required,
      ...(v.description ? { description: v.description } : {}),
      ...(v.oneOf ? { oneOf: v.oneOf } : {}),
    });
  });

  return strictObjectSchema({
    properties: {
      [actionKey]: { type: 'string', enum: actionValues },
      ...pickProperties(
        properties,
        unionAllowed.filter((k) => k !== actionKey),
      ),
    },
    required: [actionKey],
    oneOf,
  });
}
