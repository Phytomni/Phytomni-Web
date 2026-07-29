/** Closed, test-only registry for UI remediation browser fixtures. */
export const UI_REMEDIATION_FIXTURE_KEYS = [
  "change-password",
  "markdown",
  "review",
  "brief-gene",
  "cases",
  "review-preview",
  "brief-gene-preview",
] as const;

export type UiRemediationFixtureKey =
  (typeof UI_REMEDIATION_FIXTURE_KEYS)[number];

export const UI_REMEDIATION_LOCALES = ["en-US", "zh-CN"] as const;
export type UiRemediationLocale = (typeof UI_REMEDIATION_LOCALES)[number];

export type UiRemediationFixture = {
  state: UiRemediationFixtureKey;
  locale: UiRemediationLocale;
};

export type UiRemediationFixtureResolution =
  | { ok: true; state: UiRemediationFixtureKey; locale: UiRemediationLocale }
  | { ok: false; error: string };

function isFixtureState(
  value: string | null
): value is UiRemediationFixtureKey {
  return UI_REMEDIATION_FIXTURE_KEYS.includes(value as UiRemediationFixtureKey);
}

function isLocale(value: string | null): value is UiRemediationLocale {
  return UI_REMEDIATION_LOCALES.includes(value as UiRemediationLocale);
}

export function resolveUiRemediationFixture(
  state: string | null,
  locale: string | null
): UiRemediationFixtureResolution {
  if (!isFixtureState(state)) {
    return { ok: false, error: "Invalid visual fixture state." };
  }
  if (!isLocale(locale)) {
    return { ok: false, error: "Invalid visual fixture locale." };
  }
  return { ok: true, state, locale };
}
