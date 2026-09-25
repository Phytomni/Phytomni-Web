/** Every expected real native canvas must be ready before a capture is accepted. */
export function hasReadyCifViewers(
  root: ParentNode,
  expectedCount: number
): boolean {
  const blocks = root.querySelectorAll<HTMLElement>(".scientific-cif-block");
  return (
    blocks.length === expectedCount &&
    expectedCount > 0 &&
    Array.from(blocks).every((block) => {
      const viewers = block.querySelectorAll<HTMLElement>(
        ".scientific-cif-viewer"
      );
      const canvases = viewers[0]?.querySelectorAll("canvas");
      const canvas = canvases?.[0];
      return (
        viewers.length === 1 &&
        viewers[0].dataset.scientificCifReady === "true" &&
        canvases?.length === 1 &&
        Boolean(canvas && canvas.width > 0 && canvas.height > 0)
      );
    })
  );
}
