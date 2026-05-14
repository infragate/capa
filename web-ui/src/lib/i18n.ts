import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonEn from '../locales/en/common.json';
import projectsEn from '../locales/en/projects.json';
import integrationsEn from '../locales/en/integrations.json';
import registriesEn from '../locales/en/registries.json';

const LOCALE_KEY = 'capa-locale';

function getStoredLocale(): string {
  try {
    return localStorage.getItem(LOCALE_KEY) || 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      projects: projectsEn,
      integrations: integrationsEn,
      registries: registriesEn,
    },
  },
  lng: getStoredLocale(),
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

export function setLocale(locale: string): void {
  i18n.changeLanguage(locale);
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {}
}

export default i18n;
