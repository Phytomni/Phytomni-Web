import { afterEach, describe, it, expect, vi } from "vitest";
import { useDeepGenomeImageViewer } from "@/composables/useDeepGenomeImageViewer";

// ──────────────────────────────────────────────────────────────────────────────
// useDeepGenomeImageViewer — DOM-independent unit tests
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeImageViewer — initial state", () => {
  it("imageViewerVisible is initially false", () => {
    const { imageViewerVisible } = useDeepGenomeImageViewer();
    expect(imageViewerVisible.value).toBe(false);
  });

  it("currentImageSrc is initially an empty string", () => {
    const { currentImageSrc } = useDeepGenomeImageViewer();
    expect(currentImageSrc.value).toBe("");
  });

  it("currentImageAlt is initially an empty string", () => {
    const { currentImageAlt } = useDeepGenomeImageViewer();
    expect(currentImageAlt.value).toBe("");
  });
});

describe("useDeepGenomeImageViewer — imageStyle computed", () => {
  it("initial imageStyle includes scale(1) translate(0px, 0px)", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transform).toBe("scale(1) translate(0px, 0px)");
  });

  it("initial cursor is grab (not dragging)", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.cursor).toBe("grab");
  });

  it("includes transition: transform 0.2s ease (distinct from useImageZoomPan)", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transition).toBe("transform 0.2s ease");
  });

  it("transformOrigin is 0 0", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transformOrigin).toBe("0 0");
  });

  it("display is block", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.display).toBe("block");
  });
});

describe("useDeepGenomeImageViewer — handleMouseDown / handleMouseUp", () => {
  it("handleMouseDown (left button) switches cursor to grabbing", () => {
    const { imageStyle, handleMouseDown, handleMouseUp } =
      useDeepGenomeImageViewer();

    // Simulate a left-button click (button = 0)
    const downEvent = new MouseEvent("mousedown", {
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    handleMouseDown(downEvent);
    expect(imageStyle.value.cursor).toBe("grabbing");

    // Restores to grab after release
    handleMouseUp();
    expect(imageStyle.value.cursor).toBe("grab");
  });

  it("handleMouseDown (right button) does not start dragging", () => {
    const { imageStyle, handleMouseDown } = useDeepGenomeImageViewer();

    const rightClick = new MouseEvent("mousedown", { button: 2 });
    handleMouseDown(rightClick);
    expect(imageStyle.value.cursor).toBe("grab");
  });
});

describe("useDeepGenomeImageViewer — return surface", () => {
  it("returns all symbols the template needs", () => {
    const result = useDeepGenomeImageViewer();
    expect(result).toHaveProperty("imageViewerVisible");
    expect(result).toHaveProperty("currentImageSrc");
    expect(result).toHaveProperty("currentImageAlt");
    expect(result).toHaveProperty("containerRef");
    expect(result).toHaveProperty("imageRef");
    expect(result).toHaveProperty("imageStyle");
    expect(result).toHaveProperty("handleWheel");
    expect(result).toHaveProperty("handleMouseDown");
    expect(result).toHaveProperty("handleMouseMove");
    expect(result).toHaveProperty("handleMouseUp");
    expect(result).toHaveProperty("handleMouseLeave");
    expect(result).toHaveProperty("setupImageClickListeners");
    expect(result).toHaveProperty("cleanupImageClickListeners");
  });

  it("internal symbols are not exposed (openImageViewer / scale / isDragging, etc.)", () => {
    const result = useDeepGenomeImageViewer() as Record<string, unknown>;
    expect(result["openImageViewer"]).toBeUndefined();
    expect(result["scale"]).toBeUndefined();
    expect(result["isDragging"]).toBeUndefined();
    expect(result["minScale"]).toBeUndefined();
    expect(result["maxScale"]).toBeUndefined();
    expect(result["dragStart"]).toBeUndefined();
    expect(result["imageOffset"]).toBeUndefined();
  });
});

describe("useDeepGenomeImageViewer — scoped listener lifecycle", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const createRoot = (src: string, alt: string) => {
    const root = document.createElement("section");
    const image = document.createElement("img");
    image.className = "clickable-image";
    image.setAttribute("data-src", src);
    image.setAttribute("data-alt", alt);
    root.appendChild(image);
    document.body.appendChild(root);
    return { root, image };
  };

  it("keeps two viewer instances isolated to their own document roots", () => {
    const first = createRoot("https://example.com/first.png", "First");
    const second = createRoot("https://example.com/second.png", "Second");
    const firstViewer = useDeepGenomeImageViewer();
    const secondViewer = useDeepGenomeImageViewer();

    firstViewer.setupImageClickListeners(first.root);
    secondViewer.setupImageClickListeners(second.root);

    const firstImage =
      first.root.querySelector<HTMLImageElement>(".clickable-image");
    expect(firstImage).not.toBeNull();
    firstImage?.click();
    expect(firstViewer.imageViewerVisible.value).toBe(true);
    expect(firstViewer.currentImageSrc.value).toBe(
      "https://example.com/first.png"
    );
    expect(secondViewer.imageViewerVisible.value).toBe(false);

    const secondImage =
      second.root.querySelector<HTMLImageElement>(".clickable-image");
    expect(secondImage).not.toBeNull();
    secondImage?.click();
    expect(secondViewer.imageViewerVisible.value).toBe(true);
    expect(secondViewer.currentImageSrc.value).toBe(
      "https://example.com/second.png"
    );
  });

  it("queries only the supplied root and preserves the original image node", () => {
    const { root, image } = createRoot("https://example.com/plot.png", "Plot");
    const documentQuery = vi.spyOn(document, "querySelectorAll");
    const rootQuery = vi.spyOn(root, "querySelectorAll");
    const viewer = useDeepGenomeImageViewer();

    viewer.setupImageClickListeners(root);

    expect(rootQuery).toHaveBeenCalledWith(".clickable-image");
    expect(documentQuery).not.toHaveBeenCalled();
    expect(root.querySelector(".clickable-image")).toBe(image);
  });

  it("does not bind a second click listener when setup runs twice", () => {
    const { root, image } = createRoot("https://example.com/plot.png", "Plot");
    const addListener = vi.spyOn(image, "addEventListener");
    const viewer = useDeepGenomeImageViewer();

    viewer.setupImageClickListeners(root);
    viewer.setupImageClickListeners(root);

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("removes owned listeners during cleanup without replacing the node", () => {
    const { root, image } = createRoot("https://example.com/plot.png", "Plot");
    const removeListener = vi.spyOn(image, "removeEventListener");
    const viewer = useDeepGenomeImageViewer();

    viewer.setupImageClickListeners(root);
    expect(viewer.cleanupImageClickListeners).toBeTypeOf("function");
    viewer.cleanupImageClickListeners();
    viewer.imageViewerVisible.value = false;
    image.click();

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("click", expect.any(Function));
    expect(viewer.imageViewerVisible.value).toBe(false);
    expect(root.querySelector(".clickable-image")).toBe(image);
  });
});
