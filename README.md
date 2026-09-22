# Ne ljuti se čoveče – Online

Premium online multiplayer "Ne ljuti se čoveče" (Ludo) igra. Node.js + Express + Socket.io na serveru, čist HTML/CSS/vanilla JS na klijentu — bez frontend frejmvorka i bez baze podataka.

## Instalacija

```bash
npm install
```

## Pokretanje

```bash
npm start
```

Server po difoltu sluša na portu `3000` (ili na `process.env.PORT` ako je postavljen). Otvori `http://localhost:3000` u browseru. Za test multiplayer-a, otvori isti link u više tabova/uređaja.

## Hostovanje

Aplikacija je jedan Node proces bez baze, pa radi na bilo kom hostu koji podržava Node.js i WebSocket konekcije (npr. Render, Railway, Fly.io, VPS sa `pm2`/`systemd`). Ne zaboravi da hosting platforma prosledi promenljivu `PORT` procesu.

## Nove / redizajnirane funkcionalnosti

- Premium početni ekran sa brendiranjem, karticom za ime igrača, kreiranjem i pridruživanjem sobi.
- Premium lobi: kartica sa šifrom sobe (kopiranje u klipbord sa fallback-om), 4 slota za igrače, dugme "Počni igru" (aktivno samo domaćinu, sa min. 2 igrača).
- Premium tabla: sloj sa dvorištima, bezbednim poljima (★), start poljima u boji igrača, kolonama do centra i "trofej" centrom.
- Glossy figure sa efektom sjaja, pulsirajućim stanjem kada je figura pokretljiva, i glatkom CSS tranzicijom pri pomeranju.
- Moderna kockica sa animacijom bacanja i jasnim stanjima ("Baci kocku" / "Bacanje..." / rezultat).
- Indikator poteza, kartice igrača sa inicijalima, bojom i indikatorima figura kod kuće.
- Aktivnosti igre (log) i lagani real-time chat + brze reakcije (emoji) implementirani preko Socket.io.
- Sistem tema (Tamna, Klasična, Drvena, Zimska, Neon) i panel podešavanja (zvuk, animacije, smanjeno kretanje) — sve se čuva u `localStorage`.
- Premium overlay za pobednika sa konfetama (poštuje `prefers-reduced-motion`).
- Pristupačnost: ARIA labele na ikonicama, fokus stanja, tekstualni indikatori pored boja.

## Backend izmene

- Pošto originalni projekat nije bio priložen, ceo server je napisan od nule prema specifikaciji: sobe, igrači, redosled poteza, bacanje kocke, pomeranje figura, jedenje figura, bezbedna polja, pobednik — sve je server-autoritativno.
- Dodat je real-time chat (`send_chat_message` / `chat_message`) sa validacijom sobe, dužine poruke i osnovnim rate-limitingom (700ms između poruka po igraču).
- Dodate su brze reakcije (`send_reaction` / `reaction`) sa listom dozvoljenih emotikona na serveru.
- Server čisti prazne sobe posle 5 minuta neaktivnosti.

## Novi paketi

- `express` — statički server i osnovna HTTP infrastruktura.
- `socket.io` — real-time komunikacija (soba, potezi, chat, reakcije).

Frontend ne koristi nikakve nove pakete — čist HTML/CSS/JS, uz Google Fonts (Baloo 2, Nunito) učitane preko `<link>`.

## Testiranje koje je urađeno

Kod je pregledan liniju po liniju radi konzistentnosti servera i klijenta (koordinate table, koraci figura, validacija poteza). Zbog ograničenja okruženja u kom je kod pisan (bez pristupa internetu/npm registru), **nije izvršeno stvarno pokretanje `npm install` / `npm start`** niti live test u browseru. Pre puštanja u produkciju preporučuje se:

1. `npm install && npm start`
2. Otvoriti u 2–4 taba i proći kompletan tok: kreiranje sobe → pridruživanje → start → bacanje kocke → pomeranje → jedenje figura → pobeda → nova igra.
3. Proveriti responzivnost na 320px, 390px, 768px, 1440px.
4. Proveriti Console (browser i server) radi grešaka.

## Poznata ograničenja

- Stanje igre čuva se isključivo u memoriji servera — restart servera briše aktivne sobe i partije.
- Nema autentifikacije ni perzistentne baze; nije ni traženo specifikacijom.
- Zvučni efekti su generisani preko Web Audio API (kratki tonovi), a ne pravi audio fajlovi — lagano i bez eksternih asset-a.
- Pravilo "tri šestice zaredom" prekida potez, ali se ne dodeljuje kazna van toga (nije bilo eksplicitno traženo van osnovnog pravila "šestica = još jedan bacaj").
