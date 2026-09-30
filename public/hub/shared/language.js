export const LANGUAGE_KEY = "arena.ui.language.v1";
export function detectLanguage(preferred = []) {
  const locales = Array.isArray(preferred) ? preferred : [preferred];
  for (const locale of locales) {
    const code = String(locale || "").toLowerCase().split(/[-_]/, 1)[0];
    if (code === "sr" || code === "en") return code;
  }
  return "sr";
}
export function resolveLanguage({ preferred = [], saved, requested } = {}) {
  if (requested === "sr" || requested === "en") return requested;
  if (saved === "sr" || saved === "en") return saved;
  return detectLanguage(preferred);
}
export function applyTranslations(root, messages) {
  const bindings = [
    ["data-i18n", null],
    ["data-i18n-aria", "aria-label"],
    ["data-i18n-title", "title"],
    ["data-i18n-placeholder", "placeholder"]
  ];
  for (const [keyAttribute, targetAttribute] of bindings) {
    for (const element of root.querySelectorAll("[" + keyAttribute + "]")) {
      const key = element.getAttribute(keyAttribute);
      if (!Object.hasOwn(messages, key)) throw new Error("Missing translation: " + key);
      if (targetAttribute) element.setAttribute(targetAttribute, messages[key]);
      else element.textContent = messages[key];
    }
  }
}
