export interface ThreeDMolViewer {
  addModel(content: string, format: string): void;
  setStyle(selection: Record<string, never>, style: unknown): void;
  zoomTo(): void;
  render(): void;
  animate(): void;
  stopAnimate?(): void;
  clear?(): void;
}

export interface ThreeDMolModule {
  createViewer(
    element: HTMLElement,
    options: { backgroundColor: string }
  ): ThreeDMolViewer;
}

let modulePromise: Promise<ThreeDMolModule> | null = null;

export const load3DMol = (): Promise<ThreeDMolModule> => {
  if (modulePromise) return modulePromise;

  modulePromise = import("3dmol")
    .then((module) => {
      const moduleRecord = module as unknown as Record<string, unknown>;
      const candidate = Object.prototype.hasOwnProperty.call(
        moduleRecord,
        "default"
      )
        ? moduleRecord.default
        : moduleRecord;

      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof (candidate as { createViewer?: unknown }).createViewer !==
          "function"
      ) {
        throw new Error("3Dmol.js module does not expose createViewer");
      }

      return candidate as ThreeDMolModule;
    })
    .catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });

  return modulePromise;
};
