// Validates the flat phyto.a2ui Custom value. Unknown or
// pre-v1 payloads are rejected so the reducer can skip the frame without
// breaking the stream.

export type A2uiWidgetKind = "confirm" | "form" | "choice";

export interface A2uiSurfaceValue {
  catalog_version: string;
  surface_id: string;
  widget: A2uiWidgetKind;
  props: Record<string, unknown>;
}

export type ParseA2uiResult =
  | { ok: true; value: A2uiSurfaceValue }
  | {
      ok: false;
      reason:
        | "invalid"
        | "missing_surface_id"
        | "unknown_widget"
        | "catalog_too_old";
    };

const WIDGETS = new Set<string>(["confirm", "form", "choice"]);

// Accept v1 / v1.x / 1 / 1.x — reject v0.* and empty.
export function isA2uiCatalogSupported(version: string): boolean {
  const v = String(version ?? "").trim();
  if (!v) return false;
  return /^v?1(\.|$)/.test(v);
}

export function parseA2uiCustomValue(value: unknown): ParseA2uiResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid" };
  }
  const v = value as Record<string, unknown>;
  const catalog_version = String(v.catalog_version ?? "");
  if (!isA2uiCatalogSupported(catalog_version)) {
    return { ok: false, reason: "catalog_too_old" };
  }
  const surface_id = String(v.surface_id ?? "").trim();
  if (!surface_id) {
    return { ok: false, reason: "missing_surface_id" };
  }
  const widget = String(v.widget ?? "");
  if (!WIDGETS.has(widget)) {
    return { ok: false, reason: "unknown_widget" };
  }
  const props =
    v.props && typeof v.props === "object" && !Array.isArray(v.props)
      ? (v.props as Record<string, unknown>)
      : {};
  return {
    ok: true,
    value: {
      catalog_version,
      surface_id,
      widget: widget as A2uiWidgetKind,
      props,
    },
  };
}
