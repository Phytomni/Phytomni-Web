import { A2UI_LIMITS } from "./a2uiContract";
import type {
  A2uiActionResponse,
  A2uiFormField,
  A2uiOpenSurface,
  A2uiScalar,
  A2uiTerminalSurface,
} from "./a2uiContract";

export type A2uiWidgetKind = "confirm" | "form" | "choice";

export type A2uiDecodeReason =
  | "invalid_object"
  | "catalog_unsupported"
  | "identifier_invalid"
  | "widget_unsupported"
  | "props_invalid"
  | "limit_exceeded"
  | "unsafe_field_name"
  | "duplicate_field"
  | "response_invalid"
  | "status_unsupported";

export type A2uiDecodeResult<T> =
  { ok: true; value: T } | { ok: false; reason: A2uiDecodeReason };

/** Compatibility name for callers that only consume open custom surfaces. */
export type A2uiSurfaceValue = A2uiOpenSurface;
export type ParseA2uiResult = A2uiDecodeResult<A2uiOpenSurface>;

type A2uiObject = Record<string, unknown>;
type Failure = { ok: false; reason: A2uiDecodeReason };

const RESERVED_FIELD_NAMES = Object.assign(Object.create(null), {
  ["__proto__"]: true,
  prototype: true,
  constructor: true,
}) as Record<string, true>;
const WIDGETS = new Set<A2uiWidgetKind>(["confirm", "form", "choice"]);
const FORM_FIELD_TYPES = new Set(["text", "number", "select"]);
const CONFIRM_PROP_KEYS = new Set([
  "title",
  "body",
  "confirm_label",
  "cancel_label",
]);

const ok = <T>(value: T): A2uiDecodeResult<T> => ({ ok: true, value });
const fail = (reason: A2uiDecodeReason): Failure => ({ ok: false, reason });

function isReservedFieldName(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESERVED_FIELD_NAMES, value);
}

function isOrdinaryObject(value: unknown): value is A2uiObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasOwn(value: A2uiObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(value: A2uiObject, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function readIdentifier(value: unknown): A2uiDecodeResult<string> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return fail("identifier_invalid");
  }
  if (value.length > A2UI_LIMITS.identifierChars) return fail("limit_exceeded");
  return ok(value);
}

function readLabel(value: unknown, required = true): A2uiDecodeResult<string> {
  if (typeof value !== "string") return fail("props_invalid");
  if (value !== value.trim() || (required && value.length === 0)) {
    return fail("props_invalid");
  }
  if (value.length > A2UI_LIMITS.labelChars) return fail("limit_exceeded");
  return ok(value);
}

function readText(value: unknown, required = true): A2uiDecodeResult<string> {
  if (typeof value !== "string") return fail("props_invalid");
  if (value !== value.trim() || (required && value.length === 0)) {
    return fail("props_invalid");
  }
  if (value.length > A2UI_LIMITS.textChars) return fail("limit_exceeded");
  return ok(value);
}

function readScalar(value: unknown): A2uiDecodeResult<A2uiScalar> {
  if (typeof value === "number") {
    return Number.isFinite(value) ? ok(value) : fail("props_invalid");
  }
  if (typeof value === "string") return readText(value);
  return fail("props_invalid");
}

function readCatalog(value: unknown): A2uiDecodeResult<string> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return fail("catalog_unsupported");
  }
  if (value.length > A2UI_LIMITS.identifierChars) return fail("limit_exceeded");
  if (!isA2uiCatalogSupported(value)) return fail("catalog_unsupported");
  return ok(value);
}

function readWidget(value: unknown): A2uiDecodeResult<A2uiWidgetKind> {
  if (typeof value !== "string" || !WIDGETS.has(value as A2uiWidgetKind)) {
    return fail("widget_unsupported");
  }
  return ok(value as A2uiWidgetKind);
}

function readIdentity(value: A2uiObject): A2uiDecodeResult<{
  catalog_version: string;
  surface_id: string;
  widget: A2uiWidgetKind;
}> {
  const catalog = readCatalog(
    hasOwn(value, "catalog_version") ? value.catalog_version : undefined
  );
  if (!catalog.ok) return catalog;
  const surfaceKey = readIdentifier(
    hasOwn(value, "surface_id") ? value.surface_id : undefined
  );
  if (!surfaceKey.ok) return surfaceKey;
  const widget = readWidget(hasOwn(value, "widget") ? value.widget : undefined);
  if (!widget.ok) return widget;
  return ok({
    catalog_version: catalog.value,
    surface_id: surfaceKey.value,
    widget: widget.value,
  });
}

function readProps(value: A2uiObject): A2uiDecodeResult<A2uiObject> {
  if (!hasOwn(value, "props") || !isOrdinaryObject(value.props)) {
    return fail("props_invalid");
  }
  return ok(value.props);
}

function readOptionalLabel(
  props: A2uiObject,
  key: string
): A2uiDecodeResult<string | undefined> {
  if (!hasOwn(props, key)) return ok(undefined);
  const value = props[key];
  if (value === null) return ok(undefined);
  if (typeof value !== "string") return fail("props_invalid");
  if (value.length > A2UI_LIMITS.labelChars) return fail("limit_exceeded");
  if (value.trim().length === 0) return ok(undefined);
  const result = readLabel(value);
  return result.ok ? result : result;
}

function readOptionalText(
  props: A2uiObject,
  key: string
): A2uiDecodeResult<string | undefined> {
  if (!hasOwn(props, key)) return ok(undefined);
  const value = props[key];
  if (value === null) return ok(undefined);
  if (typeof value !== "string") return fail("props_invalid");
  if (value.length > A2UI_LIMITS.textChars) return fail("limit_exceeded");
  if (value.length === 0) return ok(value);
  if (value.trim().length === 0) return fail("props_invalid");
  const result = readText(value);
  return result.ok ? result : result;
}

function readFormField(value: unknown): A2uiDecodeResult<A2uiFormField> {
  if (!isOrdinaryObject(value)) return fail("props_invalid");
  const name = readIdentifier(hasOwn(value, "name") ? value.name : undefined);
  if (!name.ok) return name;
  if (isReservedFieldName(name.value)) return fail("unsafe_field_name");
  const label = readLabel(hasOwn(value, "label") ? value.label : undefined);
  if (!label.ok) return label;
  const type = hasOwn(value, "type") ? value.type : undefined;
  if (typeof type !== "string" || !FORM_FIELD_TYPES.has(type)) {
    return fail("props_invalid");
  }
  if (typeof value.required !== "boolean") return fail("props_invalid");

  let options: A2uiScalar[] | undefined;
  if (hasOwn(value, "options")) {
    if (!Array.isArray(value.options)) return fail("props_invalid");
    if (value.options.length > A2UI_LIMITS.choiceItems)
      return fail("limit_exceeded");
    options = [];
    for (const option of value.options) {
      const scalar = readScalar(option);
      if (!scalar.ok) return scalar;
      options.push(scalar.value);
    }
  }
  if (type === "select" && !options) return fail("props_invalid");
  if (type !== "select" && options) return fail("props_invalid");

  return ok({
    name: name.value,
    label: label.value,
    type: type as A2uiFormField["type"],
    required: value.required,
    ...(options ? { options } : {}),
  });
}

function readFormFields(value: unknown): A2uiDecodeResult<A2uiFormField[]> {
  if (!Array.isArray(value)) return fail("props_invalid");
  if (value.length > A2UI_LIMITS.formFields) return fail("limit_exceeded");
  const fields: A2uiFormField[] = [];
  const names = new Set<string>();
  for (const fieldValue of value) {
    const field = readFormField(fieldValue);
    if (!field.ok) return field;
    if (names.has(field.value.name)) return fail("duplicate_field");
    names.add(field.value.name);
    fields.push(field.value);
  }
  return ok(fields);
}

interface A2uiChoiceOption {
  id: string;
  label: string;
}

function readChoiceOptions(
  value: unknown
): A2uiDecodeResult<A2uiChoiceOption[]> {
  if (!Array.isArray(value)) return fail("props_invalid");
  if (value.length > A2UI_LIMITS.choiceItems) return fail("limit_exceeded");
  const options: A2uiChoiceOption[] = [];
  const ids = new Set<string>();
  for (const optionValue of value) {
    if (!isOrdinaryObject(optionValue)) return fail("props_invalid");
    const id = readIdentifier(
      hasOwn(optionValue, "id") ? optionValue.id : undefined
    );
    if (!id.ok) return id;
    if (ids.has(id.value)) return fail("duplicate_field");
    ids.add(id.value);
    const label = readLabel(
      hasOwn(optionValue, "label") ? optionValue.label : undefined
    );
    if (!label.ok) return label;
    options.push({ id: id.value, label: label.value });
  }
  return ok(options);
}

function decodeOpenProps(
  widget: A2uiWidgetKind,
  props: A2uiObject
): A2uiDecodeResult<A2uiOpenSurface["props"]> {
  if (widget === "confirm") {
    if (!hasOnlyKeys(props, CONFIRM_PROP_KEYS)) return fail("props_invalid");
    const title = readLabel(hasOwn(props, "title") ? props.title : undefined);
    if (!title.ok) return title;
    const body = readOptionalText(props, "body");
    if (!body.ok) return body;
    const confirmLabel = readOptionalLabel(props, "confirm_label");
    if (!confirmLabel.ok) return confirmLabel;
    const cancelLabel = readOptionalLabel(props, "cancel_label");
    if (!cancelLabel.ok) return cancelLabel;
    return ok({
      title: title.value,
      ...(body.value !== undefined ? { body: body.value } : {}),
      ...(confirmLabel.value !== undefined
        ? { confirm_label: confirmLabel.value }
        : {}),
      ...(cancelLabel.value !== undefined
        ? { cancel_label: cancelLabel.value }
        : {}),
    });
  }

  const title = readLabel(hasOwn(props, "title") ? props.title : undefined);
  if (!title.ok) return title;
  if (widget === "form") {
    const fields = readFormFields(
      hasOwn(props, "fields") ? props.fields : undefined
    );
    if (!fields.ok) return fields;
    return ok({ title: title.value, fields: fields.value });
  }

  const options = readChoiceOptions(
    hasOwn(props, "options") ? props.options : undefined
  );
  if (!options.ok) return options;
  if (!hasOwn(props, "multiple") || typeof props.multiple !== "boolean") {
    return fail("props_invalid");
  }
  const multiple = props.multiple;
  return ok({ title: title.value, options: options.value, multiple });
}

function decodeOpenSurfaceInternal(
  value: unknown
): A2uiDecodeResult<A2uiOpenSurface> {
  if (!isOrdinaryObject(value)) return fail("invalid_object");
  const identity = readIdentity(value);
  if (!identity.ok) return identity;
  const props = readProps(value);
  if (!props.ok) return props;
  const decodedProps = decodeOpenProps(identity.value.widget, props.value);
  if (!decodedProps.ok) return decodedProps;
  return ok({
    ...identity.value,
    widget: identity.value.widget,
    props: decodedProps.value as A2uiOpenSurface["props"],
  } as A2uiOpenSurface);
}

function readSubmittedFields(
  value: unknown
): A2uiDecodeResult<Record<string, A2uiScalar>> {
  if (!isOrdinaryObject(value)) return fail("props_invalid");
  const keys = Object.keys(value);
  if (keys.length > A2UI_LIMITS.formFields) return fail("limit_exceeded");
  const fields: Record<string, A2uiScalar> = {};
  for (const key of keys) {
    const identifier = readIdentifier(key);
    if (!identifier.ok) return identifier;
    if (isReservedFieldName(identifier.value)) return fail("unsafe_field_name");
    const scalar = readScalar(value[key]);
    if (!scalar.ok) return scalar;
    fields[identifier.value] = scalar.value;
  }
  return ok(fields);
}

function decodeTerminalProps(
  widget: A2uiWidgetKind,
  props: A2uiObject
): A2uiDecodeResult<A2uiTerminalSurface["props"]> {
  if (!hasOwn(props, "status") || props.status !== "submitted") {
    return fail("response_invalid");
  }

  if (widget === "confirm") {
    if (typeof props.accepted !== "boolean") return fail("props_invalid");
    const title = readOptionalLabel(props, "title");
    if (!title.ok) return title;
    const body = readOptionalText(props, "body");
    if (!body.ok) return body;
    const confirmLabel = readOptionalLabel(props, "confirm_label");
    if (!confirmLabel.ok) return confirmLabel;
    const cancelLabel = readOptionalLabel(props, "cancel_label");
    if (!cancelLabel.ok) return cancelLabel;
    return ok({
      status: "submitted",
      ...(title.value !== undefined ? { title: title.value } : {}),
      ...(body.value !== undefined ? { body: body.value } : {}),
      ...(confirmLabel.value !== undefined
        ? { confirm_label: confirmLabel.value }
        : {}),
      ...(cancelLabel.value !== undefined
        ? { cancel_label: cancelLabel.value }
        : {}),
      accepted: props.accepted,
    });
  }

  const title = readOptionalLabel(props, "title");
  if (!title.ok) return title;
  let cancelled: true | undefined;
  if (hasOwn(props, "cancelled")) {
    if (props.cancelled !== true) return fail("props_invalid");
    cancelled = true;
  }

  if (widget === "form") {
    if (!hasOwn(props, "fields")) return fail("props_invalid");
    const fields = Array.isArray(props.fields)
      ? readFormFields(props.fields)
      : readSubmittedFields(props.fields);
    if (!fields.ok) return fields;
    return ok({
      status: "submitted",
      ...(title.value !== undefined ? { title: title.value } : {}),
      fields: fields.value,
      ...(cancelled ? { cancelled } : {}),
    } as A2uiTerminalSurface["props"]);
  }

  let options: A2uiChoiceOption[] | undefined;
  if (hasOwn(props, "options")) {
    const decodedOptions = readChoiceOptions(props.options);
    if (!decodedOptions.ok) return decodedOptions;
    options = decodedOptions.value;
  }
  let multiple: boolean | undefined;
  if (hasOwn(props, "multiple")) {
    if (typeof props.multiple !== "boolean") return fail("props_invalid");
    multiple = props.multiple;
  }
  let selected: string | string[] | undefined;
  if (hasOwn(props, "selected")) {
    if (typeof props.selected === "string") {
      const value = readIdentifier(props.selected);
      if (!value.ok) return value;
      selected = value.value;
    } else if (Array.isArray(props.selected)) {
      if (props.selected.length > A2UI_LIMITS.choiceItems)
        return fail("limit_exceeded");
      const selectedValues: string[] = [];
      const selectedSet = new Set<string>();
      for (const selectedValue of props.selected) {
        const value = readIdentifier(selectedValue);
        if (!value.ok) return value;
        if (selectedSet.has(value.value)) return fail("duplicate_field");
        selectedSet.add(value.value);
        selectedValues.push(value.value);
      }
      selected = selectedValues;
    } else {
      return fail("props_invalid");
    }
  }
  return ok({
    status: "submitted",
    ...(title.value !== undefined ? { title: title.value } : {}),
    ...(options ? { options } : {}),
    ...(multiple !== undefined ? { multiple } : {}),
    ...(selected !== undefined ? { selected } : {}),
    ...(cancelled ? { cancelled } : {}),
  });
}

function decodeTerminalSurfaceInternal(
  value: unknown
): A2uiDecodeResult<A2uiTerminalSurface> {
  if (!isOrdinaryObject(value)) return fail("invalid_object");
  const identity = readIdentity(value);
  if (!identity.ok) return identity;
  const props = readProps(value);
  if (!props.ok) return props;
  const decodedProps = decodeTerminalProps(identity.value.widget, props.value);
  if (!decodedProps.ok) return decodedProps;
  return ok({
    ...identity.value,
    widget: identity.value.widget,
    props: decodedProps.value as A2uiTerminalSurface["props"],
  } as A2uiTerminalSurface);
}

function decodeFormatted(
  value: unknown
): A2uiDecodeResult<{ answer?: string } | undefined> {
  if (value === undefined) return ok(undefined);
  if (!isOrdinaryObject(value)) return fail("response_invalid");
  if (!hasOwn(value, "answer")) return ok({});
  if (typeof value.answer !== "string") return fail("props_invalid");
  if (value.answer !== value.answer.trim()) return fail("props_invalid");
  // The terminal A2UI surface is authoritative for the action outcome. A
  // Review report may legitimately be much longer than the bounded inline
  // Markdown answer budget, so discard only that optional projection rather
  // than turning an otherwise valid terminal action into an unknown result.
  if (value.answer.length > A2UI_LIMITS.textChars) return ok(undefined);
  return ok({
    answer: value.answer,
  });
}

export function isA2uiCatalogSupported(version: string): boolean {
  if (typeof version !== "string") return false;
  const value = version.trim();
  if (!value) return false;
  return /^v?1(?:\.|$)/.test(value);
}

export function decodeA2uiOpenSurface(
  value: unknown
): A2uiDecodeResult<A2uiOpenSurface> {
  try {
    return decodeOpenSurfaceInternal(value);
  } catch {
    return fail("props_invalid");
  }
}

export function decodeA2uiTerminalSurface(
  value: unknown
): A2uiDecodeResult<A2uiTerminalSurface> {
  try {
    return decodeTerminalSurfaceInternal(value);
  } catch {
    return fail("response_invalid");
  }
}

export function decodeA2uiActionResponse(
  value: unknown
): A2uiDecodeResult<A2uiActionResponse> {
  try {
    if (!isOrdinaryObject(value)) return fail("invalid_object");
    const status = hasOwn(value, "status") ? value.status : undefined;
    if (status !== "succeeded" && status !== "input_required") {
      return fail("status_unsupported");
    }

    const runId = readIdentifier(
      hasOwn(value, "run_id") ? value.run_id : undefined
    );
    if (!runId.ok) return runId;

    if (status === "succeeded") {
      if (
        hasOwn(value, "interrupt") ||
        !hasOwn(value, "result") ||
        !isOrdinaryObject(value.result)
      ) {
        return fail("response_invalid");
      }
      const result = value.result;
      if (!hasOwn(result, "a2ui")) return fail("response_invalid");
      const a2ui = decodeTerminalSurfaceInternal(result.a2ui);
      if (!a2ui.ok) return a2ui;
      const formatted = decodeFormatted(result.formatted);
      if (!formatted.ok) return formatted;
      return ok({
        status: "succeeded",
        run_id: runId.value,
        result: {
          a2ui: a2ui.value,
          ...(formatted.value !== undefined
            ? { formatted: formatted.value }
            : {}),
        },
      });
    }

    if (
      hasOwn(value, "result") ||
      hasOwn(value, "formatted") ||
      !hasOwn(value, "interrupt") ||
      !isOrdinaryObject(value.interrupt)
    ) {
      return fail("response_invalid");
    }
    const interrupt = value.interrupt;
    if (!hasOwn(interrupt, "draft") || !isOrdinaryObject(interrupt.draft)) {
      return fail("response_invalid");
    }
    const draft = interrupt.draft;
    if (!hasOwn(draft, "a2ui")) return fail("response_invalid");
    const a2ui = decodeOpenSurfaceInternal(draft.a2ui);
    if (!a2ui.ok) return a2ui;
    return ok({
      status: "input_required",
      run_id: runId.value,
      interrupt: { draft: { a2ui: a2ui.value } },
    });
  } catch {
    return fail("response_invalid");
  }
}

export const parseA2uiCustomValue = decodeA2uiOpenSurface;
