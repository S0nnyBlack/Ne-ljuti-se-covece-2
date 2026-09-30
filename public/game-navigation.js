import { bindBrandDie } from "./hub/shared/brand-die.js";
import { LANGUAGE_KEY, resolveLanguage } from "./hub/shared/language.js";
import { createDomTranslator, translateText } from "./game-i18n.js";

// One decorative die state is shared by the desktop and mobile presentations.
export function bindBrandDice(elements, options = {}) {
  const proxy = {
    set innerHTML(markup) { elements.forEach(element => { element.innerHTML = markup; }); },
    setAttribute(name, value) { elements.forEach(element => element.setAttribute(name, value)); },
    addEventListener(name, handler) { elements.forEach(element => element.addEventListener(name, handler)); },
    removeEventListener(name, handler) { elements.forEach(element => element.removeEventListener(name, handler)); }
  };
  return bindBrandDie(proxy, options);
}

export function initializeGameNavigation() {
  let saved;
  try { saved = localStorage.getItem(LANGUAGE_KEY); } catch {}
  let language = resolveLanguage({ preferred: navigator.languages || [navigator.language], saved, requested: new URLSearchParams(location.search).get("lang") });
  const translator = createDomTranslator(document.body, language);
  const die = bindBrandDice([...document.querySelectorAll("[data-brand-die]")], { getLanguage: () => language });
  function render() {
    document.documentElement.lang = language;
    document.title = language === "en" ? "Ludo — Arena Games" : "Čoveče, ne ljuti se — Arena Games";
    document.querySelectorAll("[data-game-language]").forEach(button => {
      const icon = document.createElement("span");
      icon.textContent = "🌐"; icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "language-label"; label.textContent = language === "sr" ? "English" : "Srpski";
      button.replaceChildren(icon, label);
      button.setAttribute("aria-label", language === "sr" ? "Promeni jezik na engleski" : "Switch language to Serbian");
    });
    translator.setLanguage(language);
    die.render();
  }
  document.querySelectorAll("[data-game-language]").forEach(button => button.addEventListener("click", () => {
    language = language === "sr" ? "en" : "sr";
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch {}
    render();
  }));
  render();
  return { translate: text => translateText(text, language), getLanguage: () => language };
}
