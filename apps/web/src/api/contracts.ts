/** JSON values accepted at an untrusted API boundary. */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

export type Decoder<T> = (value: unknown) => T;

export type GatewayErrorDetail = {
  code?: number;
  message?: string;
};

export type GatewayEnvelope<T> = {
  code?: number;
  msg?: string;
  message?: string;
  detail?: GatewayErrorDetail | string;
  result?: T;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalString(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}
