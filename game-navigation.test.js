import test from "node:test";
import assert from "node:assert/strict";
import { bindBrandDice } from "./public/game-navigation.js";
import { translateText, translations, createDomTranslator } from "./public/game-i18n.js";
import { readFile } from "node:fs/promises";
function button() {
  const attributes = new Map(), handlers = new Map();
  return { innerHTML:"", setAttribute:(k,v)=>attributes.set(k,v), getAttribute:k=>attributes.get(k),
    addEventListener:(k,v)=>handlers.set(k,v), removeEventListener:(k,v)=>{if(handlers.get(k)===v)handlers.delete(k);},
    click:()=>handlers.get("click")?.() };
}
test("desktop and mobile decorative dice share face, clicks and language without changing a game", () => {
  const desktop=button(), mobile=button(); let language="sr";
  const dice=bindBrandDice([desktop,mobile], {random:()=>0, getLanguage:()=>language});
  const game={die:6,revision:7}; const before=structuredClone(game);
  for(let i=1;i<=10;i++) {
    (i%2?desktop:mobile).click();
    assert.equal(desktop.innerHTML,mobile.innerHTML);
    assert.equal(dice.readState().clicks,i);
  }
  assert.match(desktop.innerHTML,/★/);
  language="en"; const state=dice.readState(); dice.render();
  assert.deepEqual(dice.readState(),state); assert.match(mobile.getAttribute("aria-label"),/^A star/);
  mobile.click(); assert.doesNotMatch(desktop.innerHTML,/★/);
  assert.deepEqual(game,before);
  const final=dice.readState(); dice.dispose(); desktop.click(); mobile.click(); assert.deepEqual(dice.readState(),final);
});
test("game copy translates in English and preserves the original Serbian text", () => {
  assert.ok(translations.size>150);
  for(const [sr,en] of translations) {
    assert.ok(en.trim()); assert.equal(translateText(sr,"en"),en); assert.equal(translateText(sr,"sr"),sr);
  }
  assert.equal(translateText("  Solo igra  ","en"),"  Solo game  ");
  assert.equal(translateText("2–4 igrača","en"),"2–4 players");
  assert.equal(translateText("2/4 igrača","en"),"2/4 players");
  assert.equal(translateText("Arena Games · online partija","en"),"Arena Games · online game");
  assert.equal(translateText("Jamb je na potezu.","en"),"Jamb's turn.");
  assert.equal(translateText("Crveni: figura 3 ide 6 polja · izbacivanje","en"),"Crveni: piece 3 moves 6 spaces · capture");
  assert.equal(translateText("<script>alert(1)</script>: kockica 6","en"),"<script>alert(1)</script>: die 6");
});
test("DOM translation restores Serbian, handles new state and skips player names", () => {
  const previous={document:globalThis.document,Node:globalThis.Node,NodeFilter:globalThis.NodeFilter,MutationObserver:globalThis.MutationObserver};
  let observe;
  const element={nodeType:1,closest:()=>null,hasAttribute:()=>false};
  const text={nodeType:3,nodeValue:"Solo igra",parentElement:element};
  const name={nodeType:3,nodeValue:"Crveni",parentElement:{closest:()=>({})}};
  const nodes=[element,text,name];
  globalThis.Node={TEXT_NODE:3,ELEMENT_NODE:1}; globalThis.NodeFilter={SHOW_TEXT:4,SHOW_ELEMENT:1};
  globalThis.document={createTreeWalker:()=>{let i=0;return {currentNode:nodes[0],nextNode:()=>nodes[++i]||null};}};
  globalThis.MutationObserver=class {constructor(fn){observe=fn;}observe(){}disconnect(){}};
  try {
    const translator=createDomTranslator(element); translator.setLanguage("en");
    assert.equal(text.nodeValue,"Solo game"); assert.equal(name.nodeValue,"Crveni");
    translator.setLanguage("sr"); assert.equal(text.nodeValue,"Solo igra");
    text.nodeValue="Potez 12"; translator.setLanguage("en"); assert.equal(text.nodeValue,"Turn 12");
    observe(); assert.equal(text.nodeValue,"Turn 12");
    translator.setLanguage("sr"); assert.equal(text.nodeValue,"Potez 12"); translator.disconnect();
  } finally { for(const [key,value] of Object.entries(previous)) { if(value===undefined)delete globalThis[key];else globalThis[key]=value; } }
});
test("game entry keeps direct game links, interactive controls and centered responsive cards", async () => {
  const page=await readFile(new URL("./public/index.html",import.meta.url),"utf8");
  const css=await readFile(new URL("./public/menu.css",import.meta.url),"utf8");
  const app=await readFile(new URL("./public/app.js",import.meta.url),"utf8");
  assert.equal((page.match(/data-brand-die/g)||[]).length,2);
  assert.equal((page.match(/data-game-language/g)||[]).length,2);
  assert.equal((page.match(/href="https:\/\/dice-jumbo-2\.onrender\.com\/jamb"/g)||[]).length,2);
  assert.equal((page.match(/href="\/" data-arena-home/g)||[]).length,2);
  assert.match(page,/id="homeRules"/); assert.match(page,/id="soloBtn"/); assert.match(page,/id="enterOnline"/);
  assert.match(css,/#homeView/); assert.match(css,/max-width: 640px/); assert.match(css,/prefers-reduced-motion/);
  assert.match(app,/dataset\.userContent/); assert.match(app,/homeRules.*showRules/);
});
