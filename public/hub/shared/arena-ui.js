import { copy } from "./messages.js";
import { LANGUAGE_KEY, resolveLanguage, applyTranslations } from "./language.js";
import { bindBrandDie } from "./brand-die.js";
let saved;
try { saved = localStorage.getItem(LANGUAGE_KEY) || localStorage.getItem("arena.hub.language") || localStorage.getItem("jumboDiceLanguageV1"); } catch {}
const requested = new URLSearchParams(window.location.search).get("lang") ||
  (/\/en\.html$/.test(window.location.pathname) ? "en" : null);
let lang = resolveLanguage({ preferred: navigator.languages || [navigator.language], saved, requested });
const brandDie = bindBrandDie(document.getElementById("brandDie"), { getLanguage: () => lang });
function renderLanguage(){document.documentElement.lang=lang;document.title=lang==='sr'?'Arena Games — Izaberi igru':'Arena Games — Choose a game';applyTranslations(document, copy[lang]);document.querySelector('nav').setAttribute('aria-label',lang==='sr'?'Igre':'Games');document.querySelector('meta[name="description"]').setAttribute('content',lang==='sr'?'Arena Games — Jamb i Ne ljuti se, čoveče. Izaberi igru i zaigraj sa prijateljima.':'Arena Games — Yamb and Ludo. Choose a game and play with friends.');document.getElementById('languageTarget').textContent=lang==='sr'?'English':'Srpski';document.getElementById('language').setAttribute('aria-label',lang==='sr'?'Promeni jezik na engleski':'Switch language to Serbian');brandDie.render();}
document.getElementById('language').addEventListener('click',()=>{lang=lang==='sr'?'en':'sr';try{localStorage.setItem(LANGUAGE_KEY,lang);}catch{}renderLanguage();});
const dialog=document.getElementById('aboutDialog');document.querySelectorAll('[data-game]').forEach(button=>button.addEventListener('click',()=>{const game=button.dataset.game;document.getElementById('dialogTitle').textContent=game==='jamb'?copy[lang].jambTitle:copy[lang].ludoTitle;document.getElementById('dialogText').textContent=copy[lang][game+'Rules'];dialog.showModal();}));
renderLanguage();
