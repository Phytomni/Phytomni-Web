// 图片查看器(Agents 架构图弹窗)的缩放/拖拽辅助。
//
// 抽成纯函数便于单测,且把健壮性兜底集中在一处:
//   - 图片未加载完时 naturalWidth/Height 为 0,缩放数学会出现除零 → NaN/Infinity,
//     clampPanOffset 对非有限输入与 dim===0 一律归零,顺带吞掉这种脏值;
//   - scale<=1(未放大)时锁定平移为 0;放大时把平移限制在「图片中心不越过容器
//     中心」的范围内,防止把图片拖出可视区域。

/**
 * 把以图片中心为原点、scale 缩放下的单轴平移量限制在合理范围内。
 *
 * @param offset 期望的平移量(图片坐标系,scale 之前的单位)。
 * @param naturalDim 图片该轴的自然尺寸(naturalWidth / naturalHeight)。
 * @param scale 当前缩放倍数。
 * @returns 限制后的平移量;非有限输入 / 未加载 / 未放大时返回 0。
 */
export function clampPanOffset(
  offset: number,
  naturalDim: number,
  scale: number
): number {
  if (!Number.isFinite(offset) || !naturalDim || scale <= 1) return 0;
  const max = (naturalDim * (scale - 1)) / (2 * scale);
  return Math.min(max, Math.max(-max, offset));
}
