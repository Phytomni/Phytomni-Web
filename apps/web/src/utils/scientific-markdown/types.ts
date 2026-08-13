export type MarkdownSurface = "reading" | "chat" | "artifact" | "document";

export interface ScientificCitationActivation {
  namespace: string;
  indices: number[];
}

export interface ScientificHeading {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}
