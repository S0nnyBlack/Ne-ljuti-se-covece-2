# Čoveče, ne ljuti se — Arena online

Online igra za 2–4 igrača. Server odlučuje o bacanju, redosledu i dozvoljenim potezima. Sajt prikazuje stanje koje stiže sa servera. Vizuelni izgled polazi od koncepta „Arena Games”.

## Pokretanje

Potreban je Node.js 22.8 ili noviji. Nema spoljašnjih paketa.

```sh
npm test
npm start
```

Otvori `http://localhost:3000`. `PORT` i `HOST` se mogu zadati kroz okruženje; podrazumevani `HOST` je `0.0.0.0`. Početni ekran vodi na online sto sa odvojenim karticama za kreiranje i pridruživanje. Domaćin u čekaonici deli pozivni link i pokreće partiju kada se pridruže najmanje dva igrača. Pregledač čuva pristupni token kako bi se partija nastavila posle osvežavanja. „Nova partija” pravi novu sobu.

## Pravila

- Svaki igrač baca jednom za početak; najviši broj počinje. Ako više igrača deli najviši rezultat, samo izjednačeni ponovo bacaju dok jedan ne pobedi.
- Svaki igrač ima četiri figure. Šestica izvodi figuru iz kuće na startno polje i daje novo bacanje.
- Dok su sve preostale figure igrača u kući, ima do tri pokušaja da dobije šesticu u svom krugu. Kada ima figuru na tabli, važi jedno bacanje po krugu (osim dodatnih bacanja).
- Svaka boja ima 52 polja zajedničkog kruga, zatim 5 završnih polja. Za cilj je potreban tačan broj koraka.
- Figure se pomeraju u smeru kazaljke na satu. Ne možeš stati na polje koje već zauzima tvoja figura, uključujući sopstveni start i završnu stazu. Zajednički cilj je izuzetak jer sve četiri figure moraju da stignu u njega.
- Protivnik se vraća u kuću kada figura stane na njegovo polje, uključujući obojena startna polja. Izbacivanje daje dodatno bacanje.
- Ako nema dozvoljenog poteza, red prelazi dalje posle poslednjeg pokušaja; posle šestice isti igrač baca ponovo.
- Pobeđuje prvi igrač koji dovede sve četiri figure u cilj.

Nema dodatnih zaštitnih polja ni kazne za tri uzastopne šestice. Soba ostaje za 2–4 igrača; domaćin može da pokrene partiju čim su prisutna najmanje dva igrača. Pravila su prikazana i u prozoru „Pravila igre” i na kartici pored table.

## Arhitektura

- `game.js`: čista pravila i prelazi stanja.
- `server.js`: HTTP API, serversko bacanje kockice, tokeni igrača, SSE obaveštenja i čuvanje partija.
- `public/index.html`, `public/menu.css` i `public/app.js`: početni meni, online sto, čekaonica i tabla.
- `game.test.js` i `server.test.js`: pravila i API provere.

## Bezbedne sobe i API

Model je prilagođen iz [secure-four-player-rooms šablona](https://github.com/S0nnyBlack/Dice-Jumbo/tree/051fb4709fae86b255007c166967aae5e3ad040a/templates/secure-four-player-rooms). Zadržani su HTTP/SSE, postojeći izgled i pravila za 2–4 igrača; Socket.IO nije dodat.

Nove sobe imaju **tačno 5 znakova**, iz kriptografskog generatora (bez I, O, 0 i 1). Kod je pozivnica za slobodno mesto, a ne dozvola za čitanje partije. Link ostaje `?room=ABCDE`; klijent prihvata mala slova i kompletan pozivni link. Token ima 256 bita; server čuva samo SHA-256 heš. Token se vraća samo prilikom kreiranja/pridruživanja, čuva se u lokalnom skladištu pregledača i nikada se ne stavlja u link ili stanje sobe.

- `POST /api/games`: `{ name, seats }`; vraća kod, token, mesto i stanje.
- `POST /api/games/:id/join`: `{ name }`; isti format odgovora.
- `GET /api/games/:id` i `GET /api/games/:id/events`: zahtevaju `Authorization: Bearer <token>`. SSE koristi fetch streaming da tajna ne bi bila u URL-u.
- `POST /api/games/:id/start|roll|leave`: `{ requestId, expectedRevision }` i token.
- `POST /api/games/:id/move`: isti metapodaci plus `piece`.
- `GET /health`: javni status servera.

Klijent pravi UUID po komandi; ponovljeni transportni zahtev koristi isti ID i reviziju. Server trajno čuva poslednjih 128 potvrda po sobi. Duplikat vraća originalno stanje bez drugog poteza, a drugačija komanda sa istim ID-jem i zastarela revizija vraćaju 409. Stariji zahtevi izvan istorije i dalje ne mogu ponoviti potez jer imaju staru reviziju. Posle 409 klijent preuzima novo stanje i igrač ponovo bira potez. Samo domaćin pokreće igru. Napuštanje lobija prenosi domaćinstvo i poništava token; taj token može ponoviti samo tačnu potvrdu već uspešnog napuštanja. Aktivna partija se ne može prekinuti komandom leave.

Svaka izmena nastaje na kopiji, zatim se zapisuje preko privremenog fajla i atomskog preimenovanja, pa tek onda objavljuje u memoriji i SSE-u. Neuspešan upis ne menja partiju niti troši ID komande. Jedan Node proces mora posedovati direktorijum `data/`; više instanci zahteva zajedničku transakcionu bazu i distribuciju događaja. Ovo nije garancija trajnosti u slučaju gubitka napajanja (nema fsync).

## Ograničenja i postavljanje

U produkciji postaviti `NODE_ENV=production` i `PUBLIC_URL=https://vas-domen.example` iza HTTPS reverse proxy-ja. Na Render web servisu server automatski koristi `RENDER_EXTERNAL_URL` kada `PUBLIC_URL` nije postavljen, tako da ručno podešavanje nije potrebno za podrazumevani `onrender.com` domen. Ako se koristi sopstveni domen, postaviti `PUBLIC_URL` na taj domen; on ima prednost nad Render URL-om. Origin se proverava prema izabranom URL-u; bez njega razvojni server očekuje sopstveni HTTP origin. Nema otvorenog CORS-a. Proxy mora prosleđivati Authorization i omogućiti SSE bez baferovanja. Server namerno ne veruje X-Forwarded-For: iza proxy-ja sve korisnike može računati kao jedan izvor. Za veću publiku dodati ograničenja na pouzdanom proxy-ju i tek tada eksplicitno implementirati provereno izdvajanje IP adrese.

Podrazumevane granice su 500 soba, 5 kreiranja/minut, 20 pokušaja pridruživanja/minut i 120 pristupa/minut po izvornoj IP adresi (uključujući pogrešne kodove i tokene), uz ukupno 240 API zahteva/minut. Komande su dodatno ograničene na 120/minut po tokenu. SSE: do 2 toka po igraču, 16 po IP adresi i 2000 ukupno; spori primaoci se zatvaraju. Telo zahteva ima najviše 4096 bajtova. Rate-limit tabela ima najviše 10.000 ključeva i čisti se svake minute. Kod od 5 znakova ima manji prostor od originalnog šablona i ne treba ga smatrati tajnom; ograničenja pokušaja su zato obavezna.

Sobe bez uspešne izmene 30 minuta, sobe starije od 24 sata i završene sobe starije od 60 minuta brišu se iz memorije i sa diska. Čitanje i SSE pingovi ne produžavaju trajanje. Provera teče svake minute, pri pristupu i pri restartu; istek zatvara tokove. Podešavanja su u RoomStore limits opciji za kontrolisano serversko prilagođavanje. Direktorijum data mora biti privatan i na trajnom disku.

**Prelazak sa stare verzije:** stari kodovi od 32 znaka i sesije V1 se ne učitavaju u novi protokol; rasporediti verziju između partija. Pre postavljanja sačuvati rezervnu kopiju data direktorijuma ako su stare partije potrebne. Stari JSON fajlovi i prekinuti privremeni upisi uklanjaju se kada su stariji od 24 sata. Nove V2 sobe i potvrde komandi nastavljaju se posle restarta. Kreiranje i pridruživanje nisu automatski ponavljani: izgubljen odgovor može ostaviti praznu sobu ili zauzeto mesto do isteka.

## Provera

`npm test` proverava originalna pravila igre, autorizaciju HTTP/SSE, kodove i heševe, restart, duplikate, istovremene i zastarele komande, rollback nakon greške upisa, prenos domaćinstva, granice pokušaja, kapacitet, poreklo zahteva i istek. GitHub Actions pokreće iste testove na Node 22 i 24.
