export type TransferPhase = "upload" | "download";

export type TransferSnapshot = {
  loaded: number;
  total: number;
  percent: number;
  etaSec: number | null;
  indeterminate: boolean;
  phase: TransferPhase;
  requestId: string;
};

type Sample = { t: number; loaded: number };

const WINDOW_MS = 2000;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[i]}`;
}

/** Returns whole seconds as number, or null if unknown. */
export function formatEta(etaSec: number | null): number | null {
  if (etaSec == null || !Number.isFinite(etaSec) || etaSec < 0) return null;
  return Math.max(0, Math.ceil(etaSec));
}

export function createTransferTracker(meta: {
  phase: TransferPhase;
  requestId: string;
}) {
  let samples: Sample[] = [];

  function update(
    event: { loaded: number; total?: number },
    now: number = Date.now()
  ): TransferSnapshot {
    const loaded = Math.max(0, event.loaded || 0);
    const total = Math.max(0, event.total || 0);
    const indeterminate = total <= 0;
    samples.push({ t: now, loaded });
    samples = samples.filter((s) => now - s.t <= WINDOW_MS);
    if (samples.length === 0 || samples[0].t === now) {
      samples = [{ t: now, loaded }];
    }

    let etaSec: number | null = null;
    if (!indeterminate && samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      const dBytes = last.loaded - first.loaded;
      if (dt > 0 && dBytes > 0) {
        const rate = dBytes / dt;
        etaSec = (total - loaded) / rate;
      }
    }

    const percent = indeterminate
      ? 0
      : Math.min(100, Math.round((loaded / total) * 100));

    return {
      loaded,
      total,
      percent,
      etaSec,
      indeterminate,
      phase: meta.phase,
      requestId: meta.requestId,
    };
  }

  function reset() {
    samples = [];
  }

  return { update, reset };
}
