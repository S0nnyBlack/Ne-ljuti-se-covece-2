export const PIP_POSITIONS = {1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
export function bindBrandDie(button, { getLanguage = () => "sr", random = Math.random } = {}) {
  let value = 5, clicks = 0;
  function render() {
    const star = clicks > 0 && clicks % 10 === 0;
    const en = getLanguage() === "en";
    button.innerHTML = star ? '<span class="brand-star" aria-hidden="true">★</span>' :
      '<span class="brand-face" aria-hidden="true">' + PIP_POSITIONS[value].map(pos =>
        '<i class="brand-pip" style="grid-area:' + Math.ceil(pos / 3) + '/' + ((pos - 1) % 3 + 1) + '"></i>'
      ).join("") + "</span>";
    button.setAttribute("title", en ? "Roll the die" : "Baci kockicu");
    button.setAttribute("aria-label", star ?
      (en ? "A star! Click to roll again." : "Zvezdica! Klikni za novo bacanje.") :
      (en ? "Die shows " + value + ". Click to roll again." : "Kockica pokazuje " + value + ". Klikni za novo bacanje."));
  }
  function click() {
    clicks++;
    if (clicks % 10 !== 0) {
      const others = [1,2,3,4,5,6].filter(candidate => candidate !== value);
      value = others[Math.floor(random() * others.length)];
    }
    render();
  }
  button.addEventListener("click", click);
  render();
  return { render, dispose() { button.removeEventListener("click", click); }, readState() { return { value, clicks }; } };
}
