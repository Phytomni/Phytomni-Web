export interface ReferenceDocument {
  au?: string;
  ti?: string;
  so?: string;
  vl?: string;
  bp?: string;
  ep?: string;
  py?: string;
  dl?: string;
  pm?: string;
  title?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readStringField = (
  record: Record<string, unknown>,
  key: keyof ReferenceDocument
): string | undefined => {
  const value = record[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
};

export const normalizeReferenceDocument = (
  value: unknown
): ReferenceDocument => {
  if (!isRecord(value)) return {};

  return {
    au: readStringField(value, "au"),
    ti: readStringField(value, "ti"),
    so: readStringField(value, "so"),
    vl: readStringField(value, "vl"),
    bp: readStringField(value, "bp"),
    ep: readStringField(value, "ep"),
    py: readStringField(value, "py"),
    dl: readStringField(value, "dl"),
    pm: readStringField(value, "pm"),
    title: readStringField(value, "title"),
  };
};

// Format a detailed citation string from an untrusted reference boundary.
export const formatDetailedCitation = (value: unknown): string => {
  const doc = normalizeReferenceDocument(value);
  const parts: string[] = [];

  // author
  if (doc.au) {
    parts.push(doc.au);
  }

  // title
  if (doc.ti) {
    // strip HTML tags
    const cleanTitle = doc.ti.replace(/<[^>]*>/g, "");
    parts.push(`"${cleanTitle}"`);
  }

  // journal name
  if (doc.so) {
    parts.push(doc.so);
  }

  // volume, pages, and year combined
  let volumePageYear = "";
  if (doc.vl) {
    if (doc.bp && doc.ep) {
      volumePageYear = `${doc.vl}, ${doc.bp}-${doc.ep}`;
    } else if (doc.bp) {
      volumePageYear = `${doc.vl}, ${doc.bp}`;
    } else {
      volumePageYear = doc.vl;
    }
  } else if (doc.bp && doc.ep) {
    volumePageYear = `${doc.bp}-${doc.ep}`;
  }

  // add the year (wrapped in parentheses)
  if (doc.py) {
    if (volumePageYear) {
      volumePageYear += `, (${doc.py})`;
    } else {
      volumePageYear = `(${doc.py})`;
    }
  }

  // if volume/page/year info exists, add it to parts
  if (volumePageYear) {
    parts.push(volumePageYear);
  }

  return parts.join(". ");
};
