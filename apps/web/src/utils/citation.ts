// Format a detailed citation string
export const formatDetailedCitation = (doc: any): string => {
  const parts = [];

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
