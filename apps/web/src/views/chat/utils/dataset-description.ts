export const MAX_DATASET_DESCRIPTION_SCALARS = 4000;

export class DatasetDescriptionError extends Error {
  readonly code = "invalid_dataset_description";

  constructor() {
    super("Dataset description is invalid");
    this.name = "DatasetDescriptionError";
  }
}

export function normalizeDatasetDescription(value: string): string | undefined {
  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (
    normalized.includes("\u0000") ||
    Array.from(normalized).length > MAX_DATASET_DESCRIPTION_SCALARS
  ) {
    throw new DatasetDescriptionError();
  }
  return normalized;
}
