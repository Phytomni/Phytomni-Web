// 判断字符串是否为有效的JSON
export const isValidJSON = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// 转换数据格式为 Element Plus Table 格式
export const convertToTableData = (data: { headers: string[]; rows: any[][] }) => {
  return data.rows.map((row) => {
    const obj: Record<string, any> = {};
    data.headers.forEach((header, index) => {
      // 替换空格为下划线，避免属性名中的空格
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

export const extractAtValues = (text: any) => {
  // 使用正则表达式匹配所有以@开头、以,结尾的子串
  const regex = /@[^,]+,/g;

  // 提取所有匹配项（用于返回）
  const matches = text.match(regex) || [];
  const uniqueAgents = [...new Set(matches)];
  // 从原字符串中去除所有匹配项
  const cleanedText = text.replace(regex, "");

  return {
    matches:
      uniqueAgents.length > 0
        ? uniqueAgents.map((match: any) => match.slice(1, -1))
        : [], // 去掉@和,
    cleanedText: cleanedText,
  };
};
