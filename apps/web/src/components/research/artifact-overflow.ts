export type ArtifactOverflowItem = {
  id: string;
  label: string;
  divided?: boolean;
};

export function copyCloseArtifactMenuItems(
  t: (key: string) => string
): ArtifactOverflowItem[] {
  return [
    { id: "copy", label: t("chat.copy") },
    { id: "close", label: t("common.close"), divided: true },
  ];
}

export function resetArtifactMenuItems(label: string): ArtifactOverflowItem[] {
  return [{ id: "reset", label }];
}
