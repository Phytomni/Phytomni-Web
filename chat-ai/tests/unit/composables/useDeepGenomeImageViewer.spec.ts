import { describe, it, expect } from "vitest";
import { useDeepGenomeImageViewer } from "@/composables/useDeepGenomeImageViewer";

// ──────────────────────────────────────────────────────────────────────────────
// useDeepGenomeImageViewer — DOM-independent unit tests
// ──────────────────────────────────────────────────────────────────────────────

describe("useDeepGenomeImageViewer — initial state", () => {
  it("imageViewerVisible 初始为 false", () => {
    const { imageViewerVisible } = useDeepGenomeImageViewer();
    expect(imageViewerVisible.value).toBe(false);
  });

  it("currentImageSrc 初始为空字符串", () => {
    const { currentImageSrc } = useDeepGenomeImageViewer();
    expect(currentImageSrc.value).toBe("");
  });

  it("currentImageAlt 初始为空字符串", () => {
    const { currentImageAlt } = useDeepGenomeImageViewer();
    expect(currentImageAlt.value).toBe("");
  });
});

describe("useDeepGenomeImageViewer — imageStyle computed", () => {
  it("初始 imageStyle 包含 scale(1) translate(0px, 0px)", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transform).toBe("scale(1) translate(0px, 0px)");
  });

  it("初始 cursor 为 grab（未拖拽）", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.cursor).toBe("grab");
  });

  it("包含 transition: transform 0.2s ease（区别于 useImageZoomPan）", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transition).toBe("transform 0.2s ease");
  });

  it("transformOrigin 为 0 0", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.transformOrigin).toBe("0 0");
  });

  it("display 为 block", () => {
    const { imageStyle } = useDeepGenomeImageViewer();
    expect(imageStyle.value.display).toBe("block");
  });
});

describe("useDeepGenomeImageViewer — handleMouseDown / handleMouseUp", () => {
  it("handleMouseDown(左键) 将 cursor 切换为 grabbing", () => {
    const { imageStyle, handleMouseDown, handleMouseUp } =
      useDeepGenomeImageViewer();

    // 模拟左键点击（button = 0）
    const downEvent = new MouseEvent("mousedown", {
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    handleMouseDown(downEvent);
    expect(imageStyle.value.cursor).toBe("grabbing");

    // 松开后恢复为 grab
    handleMouseUp();
    expect(imageStyle.value.cursor).toBe("grab");
  });

  it("handleMouseDown(右键) 不启动拖拽", () => {
    const { imageStyle, handleMouseDown } = useDeepGenomeImageViewer();

    const rightClick = new MouseEvent("mousedown", { button: 2 });
    handleMouseDown(rightClick);
    expect(imageStyle.value.cursor).toBe("grab");
  });
});

describe("useDeepGenomeImageViewer — return surface", () => {
  it("返回所有模板需要的符号", () => {
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
  });

  it("内部符号不对外暴露（openImageViewer / scale / isDragging 等）", () => {
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
