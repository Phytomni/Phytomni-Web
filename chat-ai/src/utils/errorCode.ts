import { i18n } from '@/locales';

export default {
  '401': () => i18n.global.t('errorCode.401'),
  '403': () => i18n.global.t('errorCode.403'),
  '404': () => i18n.global.t('errorCode.404'),
  default: () => i18n.global.t('errorCode.default'),
};
