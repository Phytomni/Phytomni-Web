import { ref, reactive, computed } from "vue";
import type { Ref } from "vue";

export function useDeepGenomeImageViewer() {
  // 点击悬浮放大弹窗相关变量
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

  // 动态样式
  const imageStyle = computed(() => {
    return {
      transform: `scale(${scale.value}) translate(${imageOffset.x}px, ${imageOffset.y}px)`,
      transformOrigin: "0 0",
      cursor: isDragging.value ? "grabbing" : "grab",
      display: "block",
      transition: "transform 0.2s ease",
    };
  });

  // 图片查看器相关方法（openImageViewer 内部使用，不对外暴露）
  const openImageViewer = (src: string, alt: string) => {
    currentImageSrc.value = src;
    currentImageAlt.value = alt;
    imageViewerVisible.value = true;
    // 重置缩放和位置
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

    // 获取容器边界
    const containerRect = container.getBoundingClientRect();

    // 计算鼠标相对于容器的位置
    const mouseX = event.clientX - containerRect.left;
    const mouseY = event.clientY - containerRect.top;

    // 获取图片原始尺寸
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;

    // 计算当前图片尺寸
    const currentWidth = originalWidth * scale.value;
    const currentHeight = originalHeight * scale.value;

    // 计算鼠标相对于图片的位置（缩放后的）
    const currentImageX =
      (containerRect.width - currentWidth) / 2 + imageOffset.x * scale.value;
    const currentImageY =
      (containerRect.height - currentHeight) / 2 + imageOffset.y * scale.value;

    // 计算鼠标在图片上的相对位置（百分比）
    const mousePercentX = (mouseX - currentImageX) / currentWidth;
    const mousePercentY = (mouseY - currentImageY) / currentHeight;

    // 调整缩放比例（乘法缩放，区别于 useImageZoomPan 的加法缩放）
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(minScale, Math.min(maxScale, scale.value * delta));

    // 计算新的图片尺寸
    const newWidth = originalWidth * newScale;
    const newHeight = originalHeight * newScale;

    // 计算新的偏移量，保持鼠标位置不变
    const newImageX = mouseX - mousePercentX * newWidth;
    const newImageY = mouseY - mousePercentY * newHeight;

    // 转换回原始缩放比例下的偏移量（不 clamp，区别于 useImageZoomPan）
    imageOffset.x = (newImageX - (containerRect.width - newWidth) / 2) / newScale;
    imageOffset.y =
      (newImageY - (containerRect.height - newHeight) / 2) / newScale;

    scale.value = newScale;
  };

  // 拖拽移动图片
  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return; // 只响应左键
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

  const setupImageClickListeners = () => {
    // 移除旧的事件监听器，避免重复绑定
    const existingImages = document.querySelectorAll(".clickable-image");
    existingImages.forEach((img) => {
      const newImg = img.cloneNode(true);
      img.parentNode!.replaceChild(newImg, img);
    });

    // 添加新的事件监听器和处理高宽比
    const images = document.querySelectorAll(".clickable-image");
    images.forEach((img) => {
      // 加载图片以获取其原始宽高
      const tempImg = new Image();
      tempImg.src =
        (img as HTMLImageElement).getAttribute("data-src") ||
        (img as HTMLImageElement).src;

      tempImg.onload = () => {
        // 计算高宽比
        const aspectRatio = tempImg.height / tempImg.width;

        // 如果高宽比小于0.5625，则设置宽度为100%
        if (aspectRatio < 0.5625) {
          (img as HTMLElement).style.width = "100%";
        } else {
          // 否则不单独设置宽度，使用默认的百分比宽度
          (img as HTMLElement).style.width = "70%";
        }
      };

      img.addEventListener("click", () => {
        const src = (img as HTMLImageElement).getAttribute("data-src");
        const alt = (img as HTMLImageElement).getAttribute("data-alt");
        openImageViewer(src ?? "", alt ?? "");
      });
    });
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
  };
}
