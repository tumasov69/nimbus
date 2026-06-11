import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { pl } from "./pl";
import { pt } from "./pt";
import { ru } from "./ru";
import { tr } from "./tr";
import { uk } from "./uk";
import { zh } from "./zh";

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "pl", name: "Polski" },
  { code: "pt", name: "Português" },
  { code: "tr", name: "Türkçe" },
  { code: "zh", name: "中文" },
];

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

export function detectSystemLanguage(): string {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split("-")[0];
    if (SUPPORTED.has(code)) return code;
  }
  return "en";
}

/** Resolves the stored preference ("" = system) into a concrete language. */
export function resolveLanguage(stored: string): string {
  return SUPPORTED.has(stored) ? stored : detectSystemLanguage();
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    uk: { translation: uk },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    pl: { translation: pl },
    pt: { translation: pt },
    tr: { translation: tr },
    zh: { translation: zh },
  },
  lng: detectSystemLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
