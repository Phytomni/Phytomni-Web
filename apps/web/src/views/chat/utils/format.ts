// Check whether a string is valid JSON
export const isValidJSON = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// Convert data into Element Plus Table format
export interface TableDataInput {
  headers: readonly string[];
  rows: readonly unknown[][];
}

export const convertToTableData = (
  data: TableDataInput
): Array<Record<string, unknown>> => {
  return data.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    data.headers.forEach((header, index) => {
      // replace spaces with underscores to avoid spaces in property names
      const key = header.replace(/\s+/g, "_").toLowerCase();
      obj[key] = row[index];
    });
    return obj;
  });
};

export const formatFileSize = (size: number) => {
  if (size < 1024) {
    return size + " B";
  } else if (size < 1024 * 1024) {
    return (size / 1024).toFixed(2) + " KB";
  } else {
    return (size / (1024 * 1024)).toFixed(2) + " MB";
  }
};

export const extractAtValues = (
  text: string
): { matches: string[]; cleanedText: string } => {
  // match all substrings starting with @ and ending with a comma
  const regex = /@[^,]+,/g;

  // extract all matches (for the return value)
  const matches = text.match(regex) || [];
  const uniqueAgents = [...new Set(matches)];
  // remove all matches from the original string
  const cleanedText = text.replace(regex, "");

  return {
    matches:
      uniqueAgents.length > 0
        ? uniqueAgents.map((match) => match.slice(1, -1))
        : [], // strip the @ and the comma
    cleanedText: cleanedText,
  };
};
