import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en, type Messages } from "./en";
import { hi } from "./hi";

/* Regional-ready: add a dictionary file and an entry here. Missing keys fall back to English. */
export const LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const DICTS: Record<Lang, Partial<Messages>> = { en, hi };
const STORAGE_KEY = "vc.lang";

export type MessageKey = keyof Messages;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s = (DICTS[lang]?.[key] ?? en[key] ?? key) as string;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "en" || v === "hi" ? v : null;
  } catch {
    return null;
  }
}

type Ctx = { lang: Lang; hasChosen: boolean; setLang: (l: Lang) => void; t: (k: MessageKey, v?: Record<string, string | number>) => string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const stored = readStored();
  const [lang, setLangState] = useState<Lang>(initial ?? stored ?? "en");
  const [hasChosen, setHasChosen] = useState<boolean>(!!stored || !!initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setHasChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: keep in memory */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<Ctx>(() => ({ lang, hasChosen, setLang, t: (k, v) => translate(lang, k, v) }), [lang, hasChosen, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

export { en, hi };
export type { Messages };
