import { ref, computed } from "vue";
import type { TransferSnapshot } from "@/utils/transfer-progress";

const map = ref<Record<string, TransferSnapshot>>({});

export function upsertDownloadTransfer(snap: TransferSnapshot) {
  map.value = { ...map.value, [snap.requestId]: snap };
}

export function removeDownloadTransfer(requestId: string) {
  if (!(requestId in map.value)) return;
  const next = { ...map.value };
  delete next[requestId];
  map.value = next;
}

export function clearDownloadTransfers() {
  map.value = {};
}

export function listDownloadTransfers(): TransferSnapshot[] {
  return Object.values(map.value);
}

/** Reactive list for components */
export const downloadTransferList = computed(() => listDownloadTransfers());
