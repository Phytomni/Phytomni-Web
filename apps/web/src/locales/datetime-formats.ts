import type { DateTimeFormat } from "vue-i18n";

// Local-TZ Intl options only — never set timeZone: "UTC".
const date: DateTimeFormat = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
};

const datetime: DateTimeFormat = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
};

const timestamp: DateTimeFormat = {
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
