interface ModelPoint {
  x: number;
  y: number;
  z: number;
}

export interface ThreeDMolViewer {
  addModel(content: string, format: string): void;
  selectedAtoms(selection: Record<string, never>): Array<{
    x: number;
    y: number;
    z: number;
  }>;
  modelToScreen(points: ModelPoint[]): Array<{ x: number; y: number }>;
  setStyle(selection: Record<string, never>, style: unknown): void;
  setProjection(projection: "orthographic"): void;
  setViewStyle(style: {
    style: "outline";
    color: string;
    width: number;
    maxpixels: number;
  }): void;
  addSurface(
    type: "SES",
    style: { color: string; opacity: number },
    selection: Record<string, never>
  ): Promise<number | number[]> & { surfid: number };
  rotate(angle: number, axis: "x" | "y"): void;
  getView(): number[];
  setView(view: number[]): void;
  translateScene(x: number, y: number): void;
  setSurfaceMaterialStyle(
    id: number,
    style: { color: string; opacity: number }
  ): void;
  zoomTo(): void;
  zoom(factor: number): void;
  resize(): void;
  render(): void;
  stopAnimate?(): void;
  clear?(): void;
}

export function fit3DMolStructure(
  viewer: Pick<ThreeDMolViewer, "selectedAtoms" | "modelToScreen" | "zoom">,
  target: HTMLElement
): boolean {
  const width = target.offsetWidth;
  const height = target.offsetHeight;
  if (!width || !height) return false;
  const canvas = target.querySelector("canvas");
  if (!canvas) throw new Error("Structure canvas unavailable");
  const atoms = viewer.selectedAtoms({});
  // Project a four-coordinate-unit margin as well as the real atoms. This
  // protects the SES envelope even for tiny models; no model data is modified.
  const projected = viewer.modelToScreen([
    ...atoms,
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
    { x: 0, y: 0, z: 4 },
  ]);
  if (
    projected.length !== atoms.length + 4 ||
    projected.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
    )
  )
    throw new Error("Structure projection unavailable");
  const [origin, xAxis, yAxis, zAxis] = projected.slice(-4);
  const marginX = Math.hypot(
    xAxis.x - origin.x,
    yAxis.x - origin.x,
    zAxis.x - origin.x
  );
  const marginY = Math.hypot(
    xAxis.y - origin.y,
    yAxis.y - origin.y,
    zAxis.y - origin.y
  );
  const bounds = canvas.getBoundingClientRect();
  const centerX =
    bounds.left +
    window.scrollX -
    document.documentElement.clientLeft +
    width / 2;
  const centerY =
    bounds.top +
    window.scrollY -
    document.documentElement.clientTop +
    height / 2;
  let halfWidth = 0;
  let halfHeight = 0;
  for (const point of projected.slice(0, atoms.length)) {
    halfWidth = Math.max(halfWidth, Math.abs(point.x - centerX));
    halfHeight = Math.max(halfHeight, Math.abs(point.y - centerY));
  }
  const factor = Math.min(
    (width * 0.44) / (halfWidth + marginX),
    (height * 0.44) / (halfHeight + marginY)
  );
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error("Structure projection unavailable");
  if (factor !== 1) viewer.zoom(factor);
  return true;
}

export interface ThreeDMolModule {
  createViewer(
    element: HTMLElement,
    options: {
      backgroundColor: string;
      antialias: boolean;
      cartoonQuality: number;
      disableFog: boolean;
    }
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
