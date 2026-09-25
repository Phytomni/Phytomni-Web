export type ArtifactOverflowItem = {
  id: string;
  label: string;
  divided?: boolean;
  children?: readonly ArtifactOverflowItem[];
};

export function copyDownloadCloseArtifactMenuItems(
  t: (key: string) => string,
  formats: readonly string[] = []
): ArtifactOverflowItem[] {
  const items: ArtifactOverflowItem[] = [{ id: "copy", label: t("chat.copy") }];
  if (formats.length > 0) {
    items.push({
      id: "download",
      label: t("chat.actions.download"),
      children: formats.map((format) => ({
        id: `download:${format}`,
        label: format,
      })),
    });
  }
  items.push({ id: "close", label: t("common.close"), divided: true });
  return items;
}

export function copyCloseArtifactMenuItems(
  t: (key: string) => string
): ArtifactOverflowItem[] {
  return copyDownloadCloseArtifactMenuItems(t, []);
}

export function resetArtifactMenuItems(label: string): ArtifactOverflowItem[] {
  return [{ id: "reset", label }];
}
