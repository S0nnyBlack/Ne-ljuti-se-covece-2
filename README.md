# Čoveče, ne ljuti se — Arena online

Online igra za 2–4 igrača. Server odlučuje o bacanju, redosledu i dozvoljenim potezima. Sajt prikazuje stanje koje stiže sa servera. Vizuelni izgled polazi od koncepta „Arena Games”.

## Pokretanje

Potreban je Node.js 20 ili noviji. Nema spoljašnjih paketa.

```sh
npm test
npm start
```

Otvori `http://localhost:3000`. `PORT` i `HOST` se mogu zadati kroz okruženje; podrazumevani `HOST` je `0.0.0.0`. Igrač napravi sobu i pošalje pozivni link ostalima. Pregledač čuva pristupni token kako bi se partija nastavila posle osvežavanja. Soba počinje kada se popune sva izabrana mesta. „Nova partija” pravi novu sobu.

## Pravila

- Šestica izvodi figuru iz kućice i daje novo bacanje.
- Svaka boja ima 52 polja zajedničkog kruga, zatim 5 završnih polja. Za cilj je potreban tačan broj koraka.
- Protivnik se vraća u kućicu kada figura stane na njega van četiri obojena početna polja. Izbacivanje daje dodatno bacanje.
- Ako nema dozvoljenog poteza, red prelazi dalje; posle šestice isti igrač baca ponovo.
- Pobeđuje prvi igrač koji dovede sve četiri figure u cilj.

Ovo su pravila iz vizuelnog prototipa. Pre takmičarske upotrebe potvrditi varijante: dodatna zaštitna polja, više figura na jednom polju, tri uzastopne šestice i broj pokušaja kada su sve figure u kućici.

## Arhitektura

- `game.js`: čista pravila i prelazi stanja.
- `server.js`: HTTP API, serversko bacanje kockice, tokeni igrača, SSE obaveštenja i čuvanje partija.
- `public/index.html` i `public/app.js`: tabla i online tok kreiranja/pridruživanja.
- `game.test.js` i `server.test.js`: pravila i API provere.

API: `POST /api/games` (`name`, `seats`), `POST /api/games/:id/join` (`name`), `GET /api/games/:id`, `GET /api/games/:id/events`, `POST /api/games/:id/roll` (`{}`), `POST /api/games/:id/move` (`piece`). Akcije igrača koriste `Authorization: Bearer <token>`. `GET /health` vraća status servera. SSE šalje `state` događaj pri povezivanju i posle svake promene. Ko ima kod sobe može da vidi stanje.

Partije se čuvaju u `data/` kao JSON i učitavaju pri restartu procesa. Taj direktorijum mora biti na trajnom disku i ne sme se javno služiti. Jedan proces treba da poseduje direktorijum; više instanci zahteva zajedničku bazu i transakcije. Pre javnog hostovanja preporučeni su HTTPS, ograničenje broja zahteva i politika čišćenja starih partija. Server trenutno ne uklanja zauzeto mesto ako igrač trajno napusti partiju.
