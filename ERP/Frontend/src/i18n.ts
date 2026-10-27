import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import enTranslation from './locales/en/translation.json';
import rwTranslation from './locales/rw/translation.json';
import frTranslation from './locales/fr/translation.json';
import swTranslation from './locales/sw/translation.json';

const resources = {
    en: {
        translation: enTranslation,
    },
    rw: {
        translation: rwTranslation,
    },
    fr: {
        translation: frTranslation,
    },
    sw: {
        translation: swTranslation,
    },
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'en',
        supportedLngs: ['en', 'rw', 'fr', 'sw'],

        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'i18nextLng',
        },

        interpolation: {
            escapeValue: false,
        },

        react: {
            useSuspense: false,
        },
    });

export default i18n;
