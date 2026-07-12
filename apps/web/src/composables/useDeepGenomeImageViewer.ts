import { ref, reactive, computed } from "vue";

export function useDeepGenomeImageViewer() {
  // state for the click-to-enlarge popup
  const imageViewerVisible = ref(false);
  const currentImageSrc = ref("");
  const currentImageAlt = ref("");
  const containerRef = ref<HTMLDivElement>();
  const imageRef = ref<HTMLImageElement>();
  const isDragging = ref(false);
  const scale = ref(1);
  const minScale = 1;
  const maxScale = 5;
  const dragStart = reactive({ x: 0, y: 0 });
  const imageOffset = reactive({ x: 0, y: 0 });
  const imageBindings = new Map<
    HTMLImageElement,
    { click: EventListener; probe: HTMLImageElement }
  >();

  // dynamic style
  const imageStyle = computed(() => {
    return {
      transform: `scale(${scale.value}) translate(${imageOffset.x}px, ${imageOffset.y}px)`,
      transformOrigin: "0 0",
      cursor: isDragging.value ? "grabbing" : "grab",
      display: "block",
      transition: "transform 0.2s ease",
    };
  });

  // image viewer methods (openImageViewer is internal, not exposed)
  const openImageViewer = (src: string, alt: string) => {
    currentImageSrc.value = src;
    currentImageAlt.value = alt;
    imageViewerVisible.value = true;
    // reset zoom and position
    scale.value = 1;
    imageOffset.x = 0;
    imageOffset.y = 0;
    isDragging.value = false;
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();

    const container = containerRef.value;
    const img = imageRef.value;

    if (!container || !img) return;

    // get the container bounds
    const containerRect = container.getBoundingClientRect();

    // compute the mouse position relative to the container
    const mouseX = event.clientX - containerRect.left;
    const mouseY = event.clientY - containerRect.top;

    // get the image's natural size
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;

    // compute the current image size
    const currentWidth = originalWidth * scale.value;
    const currentHeight = originalHeight * scale.value;

    // compute the mouse position relative to the image (after scaling)
    const currentImageX =
      (containerRect.width - currentWidth) / 2 + imageOffset.x * scale.value;
    const currentImageY =
      (containerRect.height - currentHeight) / 2 + imageOffset.y * scale.value;

    // compute the mouse position on the image (as a percentage)
    const mousePercentX = (mouseX - currentImageX) / currentWidth;
    const mousePercentY = (mouseY - currentImageY) / currentHeight;

    // adjust the zoom (multiplicative, unlike useImageZoomPan's additive zoom)
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(minScale, Math.min(maxScale, scale.value * delta));

    // compute the new image size
    const newWidth = originalWidth * newScale;
    const newHeight = originalHeight * newScale;

    // compute the new offset, keeping the mouse position fixed
    const newImageX = mouseX - mousePercentX * newWidth;
    const newImageY = mouseY - mousePercentY * newHeight;

    // convert back to the offset under the original scale (no clamp, unlike useImageZoomPan)
    imageOffset.x = (newImageX - (containerRect.width - newWidth) / 2) / newScale;
    imageOffset.y =
      (newImageY - (containerRect.height - newHeight) / 2) / newScale;

    scale.value = newScale;
  };

  // drag to move the image
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return; // respond to the left button only
    isDragging.value = true;
    dragStart.x = event.clientX - imageOffset.x;
    dragStart.y = event.clientY - imageOffset.y;
    event.preventDefault();
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging.value) return;
    imageOffset.x = event.clientX - dragStart.x;
    imageOffset.y = event.clientY - dragStart.y;
  };

  const handleMouseUp = () => {
    isDragging.value = false;
  };

  const handleMouseLeave = () => {
    handleMouseUp();
  };

  const setupImageClickListeners = (root: ParentNode | null | undefined) => {
    if (!root) return;

    const images = root.querySelectorAll<HTMLImageElement>(".clickable-image");
    images.forEach((img) => {
      if (imageBindings.has(img)) return;

      // load the image to get its natural width/height
      const tempImg = new Image();
      tempImg.src =
        (img as HTMLImageElement).getAttribute("data-src") ||
        (img as HTMLImageElement).src;

      tempImg.onload = () => {
        // compute the aspect ratio
        const aspectRatio = tempImg.height / tempImg.width;

        // if the aspect ratio is below 0.5625, set width to 100%
        if (aspectRatio < 0.5625) {
          img.style.width = "100%";
        } else {
          // otherwise don't set width separately; use the default percentage width
          img.style.width = "70%";
        }
      };

      const handleClick = () => {
        const src = img.getAttribute("data-src");
        const alt = img.getAttribute("data-alt");
        openImageViewer(src ?? "", alt ?? "");
      };
      img.addEventListener("click", handleClick);
      imageBindings.set(img, { click: handleClick, probe: tempImg });
    });
  };

  const cleanupImageClickListeners = () => {
    imageBindings.forEach(({ click, probe }, img) => {
      img.removeEventListener("click", click);
      probe.onload = null;
      probe.onerror = null;
    });
    imageBindings.clear();
  };

  return {
    imageViewerVisible,
    currentImageSrc,
    currentImageAlt,
    containerRef,
    imageRef,
    imageStyle,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    setupImageClickListeners,
    cleanupImageClickListeners,
  };
}
