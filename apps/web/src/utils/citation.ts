// 格式化详细引用信息
export const formatDetailedCitation = (doc: any): string => {
  const parts = [];

  // 作者
  if (doc.au) {
    parts.push(doc.au);
  }

  // 标题
  if (doc.ti) {
    // 移除HTML标签
    const cleanTitle = doc.ti.replace(/<[^>]*>/g, "");
    parts.push(`"${cleanTitle}"`);
  }

  // 期刊名称
  if (doc.so) {
    parts.push(doc.so);
  }

  // 卷号、页码和年份组合
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

  // 添加年份（用括号包围）
  if (doc.py) {
    if (volumePageYear) {
      volumePageYear += `, (${doc.py})`;
    } else {
      volumePageYear = `(${doc.py})`;
    }
  }

  // 如果有卷号页码年份信息，添加到parts中
  if (volumePageYear) {
    parts.push(volumePageYear);
  }

  return parts.join(". ");
};
