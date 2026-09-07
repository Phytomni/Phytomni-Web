export type MarkdownSurface = "reading" | "chat" | "artifact" | "document";

export interface ScientificMarkdownNode {
  type: string;
  value?: string;
  children?: ScientificMarkdownNode[];
  data?: Record<string, unknown>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  [key: string]: unknown;
}

export interface ScientificCitationActivation {
  namespace: string;
  indices: number[];
}

export interface ScientificHeading {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export type ScientificResourceKind =
  "image" | "cif" | "attachment" | "markdown";

export interface AuthorizedScientificResource {
  id: string;
  name: string;
  kind: ScientificResourceKind;
  markdownHref: string;
  displayUrl?: string;
}

export interface ScientificResourceActivation {
  id: string;
  kind: "attachment" | "markdown";
}
