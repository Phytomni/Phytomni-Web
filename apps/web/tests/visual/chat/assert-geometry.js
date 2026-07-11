/**
 * Hard assertion over window.__PHY_CHAT_GEOMETRY_RESULT__ from measure-geometry.js.
 * Returns { pass: true } only when the stored object exists and pass === true.
 * Missing or failing data throws so the agent-browser command exits nonzero.
 */
(() => {
  const stored = window.__PHY_CHAT_GEOMETRY_RESULT__;
  if (!stored || typeof stored !== "object") {
    throw new Error(
      "assert-geometry: missing window.__PHY_CHAT_GEOMETRY_RESULT__; run measure-geometry.js first"
    );
  }
  if (stored.pass !== true) {
    const detail =
      Array.isArray(stored.reasons) && stored.reasons.length
        ? stored.reasons.join("; ")
        : stored.error || "pass=false";
    throw new Error(`assert-geometry: geometry did not pass (${detail})`);
  }
  return { pass: true };
})();
