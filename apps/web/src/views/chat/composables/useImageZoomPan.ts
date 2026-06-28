import { ref, reactive, computed, watch, type Ref } from "vue";
import { clampPanOffset } from "@/utils/image-viewer";

export function useImageZoomPan(agentsViewVisible: Ref<boolean>) {
  // Agents architecture-diagram popup — zoom and drag state
  const scale = ref(1);
  const minScale = 1;
  const maxScale = 5;

  // mouse drag
  const isDragging = ref(false);
  const dragStart = reactive({ x: 0, y: 0 });
  const imageOffset = reactive({ x: 0, y: 0 });

  // DOM refs
  const containerRef = ref<HTMLDivElement>();
  const imageRef = ref<HTMLImageElement>();

  // dynamic style
  const imageStyle = computed(() => {
    return {
      transform: `scale(${scale.value}) translate(${imageOffset.x}px, ${imageOffset.y}px)`,
      transformOrigin: "0 0",
      cursor: isDragging.value ? "grabbing" : "grab",
      display: "block",
    };
  });

  // wheel zoom
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    const container = containerRef.value;
    const img = imageRef.value;
    if (!container || !img) return;

    // get the container bounds
    const containerRect = container.getBoundingClientRect();

    // compute the mouse position relative to the container
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    // current scale
    let newScale = scale.value;

    // wheel direction
    if (e.deltaY < 0) {
      newScale = Math.min(maxScale, scale.value + 0.1);
    } else {
      newScale = Math.max(minScale, scale.value - 0.1);
    }

    if (Math.abs(newScale - scale.value) < 0.01) return;

    // key: compute the new offset after scaling, zooming about the mouse
    // natural image size
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;

    // bail out while the image is still loading (naturalWidth/Height is 0) to avoid
    // a later divide-by-zero producing NaN/Infinity offsets that fling the image off-screen.
    if (!originalWidth || !originalHeight) return;

    // compute the mouse's logical position on the image (relative to the top-left)
    // current top-left of the image relative to the container
    const currentImageX =
      (containerRect.width - originalWidth * scale.value) / 2 +
      imageOffset.x * scale.value;
    const currentImageY =
      (containerRect.height - originalHeight * scale.value) / 2 +
      imageOffset.y * scale.value;

    // mouse coordinates relative to the image's top-left
    const mouseOnImageX = mouseX - currentImageX;
    const mouseOnImageY = mouseY - currentImageY;

    // compute the mouse's relative position on the natural image (0-1 range)
    const mouseRatioX = mouseOnImageX / (originalWidth * scale.value);
    const mouseRatioY = mouseOnImageY / (originalHeight * scale.value);

    // compute the new top-left so the point under the mouse stays fixed
    const newImageX = mouseX - originalWidth * newScale * mouseRatioX;
    const newImageY = mouseY - originalHeight * newScale * mouseRatioY;

    // compute the new offset and clamp it to the visible range (prevent dragging past the container center and losing the image)
    imageOffset.x = clampPanOffset(
      (newImageX - (containerRect.width - originalWidth * newScale) / 2) /
        newScale,
      originalWidth,
      newScale
    );
    imageOffset.y = clampPanOffset(
      (newImageY - (containerRect.height - originalHeight * newScale) / 2) /
        newScale,
      originalHeight,
      newScale
    );

    scale.value = newScale;
  };

  // drag to move the image
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // respond to the left button only
    isDragging.value = true;
    dragStart.x = e.clientX - imageOffset.x;
    dragStart.y = e.clientY - imageOffset.y;
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.value) return;
    const img = imageRef.value;
    imageOffset.x = clampPanOffset(
      e.clientX - dragStart.x,
      img?.naturalWidth ?? 0,
      scale.value
    );
    imageOffset.y = clampPanOffset(
      e.clientY - dragStart.y,
      img?.naturalHeight ?? 0,
      scale.value
    );
  };

  const handleMouseUp = () => {
    isDragging.value = false;
  };

  // reset zoom/drag state when the diagram popup closes, so it doesn't reopen at the previous zoom.
  watch(agentsViewVisible, (visible) => {
    if (!visible) {
      scale.value = 1;
      imageOffset.x = 0;
      imageOffset.y = 0;
      isDragging.value = false;
    }
  });

  return {
    scale,
    isDragging,
    imageOffset,
    containerRef,
    imageRef,
    imageStyle,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
