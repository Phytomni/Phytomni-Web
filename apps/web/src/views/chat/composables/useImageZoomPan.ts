import { ref, reactive, computed, watch, type Ref } from "vue";
import { clampPanOffset } from "@/utils/image-viewer";

export function useImageZoomPan(agentsViewVisible: Ref<boolean>) {
  // Agents架构图弹窗 — 缩放与拖拽状态
  const scale = ref(1);
  const minScale = 1;
  const maxScale = 5;

  // 鼠标拖拽
  const isDragging = ref(false);
  const dragStart = reactive({ x: 0, y: 0 });
  const imageOffset = reactive({ x: 0, y: 0 });

  // DOM 引用
  const containerRef = ref<HTMLDivElement>();
  const imageRef = ref<HTMLImageElement>();

  // 动态样式
  const imageStyle = computed(() => {
    return {
      transform: `scale(${scale.value}) translate(${imageOffset.x}px, ${imageOffset.y}px)`,
      transformOrigin: "0 0",
      cursor: isDragging.value ? "grabbing" : "grab",
      display: "block",
    };
  });

  // 滚轮缩放
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    const container = containerRef.value;
    const img = imageRef.value;
    if (!container || !img) return;

    // 获取容器边界
    const containerRect = container.getBoundingClientRect();

    // 计算鼠标相对于容器的位置
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    // 当前缩放
    let newScale = scale.value;

    // 滚轮方向
    if (e.deltaY < 0) {
      newScale = Math.min(maxScale, scale.value + 0.1);
    } else {
      newScale = Math.max(minScale, scale.value - 0.1);
    }

    if (Math.abs(newScale - scale.value) < 0.01) return;

    // 关键：计算缩放后的新偏移，实现以鼠标为中心缩放
    // 原始图片尺寸
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;

    // 图片尚未加载完(naturalWidth/Height 为 0)时直接退出，避免后续除零
    // 产生 NaN/Infinity 偏移把图片甩出视野。
    if (!originalWidth || !originalHeight) return;

    // 计算鼠标在图片上的逻辑位置（相对于图片左上角）
    // 当前图片左上角相对于容器的位置
    const currentImageX =
      (containerRect.width - originalWidth * scale.value) / 2 +
      imageOffset.x * scale.value;
    const currentImageY =
      (containerRect.height - originalHeight * scale.value) / 2 +
      imageOffset.y * scale.value;

    // 鼠标在图片上的相对坐标（相对于图片左上角）
    const mouseOnImageX = mouseX - currentImageX;
    const mouseOnImageY = mouseY - currentImageY;

    // 计算鼠标在原始图片上的相对位置（0-1范围）
    const mouseRatioX = mouseOnImageX / (originalWidth * scale.value);
    const mouseRatioY = mouseOnImageY / (originalHeight * scale.value);

    // 计算新的图片左上角位置，使鼠标指向的点保持不变
    const newImageX = mouseX - originalWidth * newScale * mouseRatioX;
    const newImageY = mouseY - originalHeight * newScale * mouseRatioY;

    // 计算新的偏移量，并 clamp 在可视范围内(防止越过容器中心拖丢图片）
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

  // 拖拽移动图片
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // 只响应左键
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

  // 关闭架构图弹窗时复位缩放/拖拽状态，避免下次打开仍停留在上次缩放的位置。
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
