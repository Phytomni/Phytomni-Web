// Local-TZ Intl options only — never set timeZone: "UTC".
const date: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

const datetime: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
};

const timestamp: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

export const datetimeFormats = {
  "en-US": { date, datetime, timestamp },
  "zh-CN": { date, datetime, timestamp },
};
