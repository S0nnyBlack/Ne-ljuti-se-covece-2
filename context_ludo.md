# Čoveče, ne ljuti se — kontekst projekta

Ažurirano: 29. septembar 2026.
Repozitorijum: https://github.com/S0nnyBlack/Ne-ljuti-se-covece-2
Grana: main. Poslednji pregledani HEAD pre ovog fajla: 0c43a5e (merge PR #5).

## Dogovor i polazna osnova

Korisnik je tražio serversku logiku i sajt za „Čoveče, ne ljuti se”. Polazni vizuelni prototip je covece-ne-ljuti-se-koncept.html iz zadatka nap. Jamb projekat Dice-Jumbo i njegov context_jamb.md korišćeni su samo kao referenca za arhitekturu i dizajn menija. Korisnik je izričito tražio da se projekti ne spajaju. Jamb kod nije menjan.

Prvo je napravljen samostalan Node server u outputs/covece-server ovog zadatka. On je istorijska osnova; za nastavak rada merodavan je ovaj GitHub repo. Korisnik je odobrio zamenu ranijeg sadržaja ovog repozitorijuma.

## Hronologija na main

- 1e696c7: stara aplikacija je zamenjena serverom sa čistim modulom pravila, HTTP API-jem, SSE-om, JSON čuvanjem i sajtom zasnovanim na prototipu. Stari Socket.IO klijent/server, botovi, chat i teme uklonjeni su uz korisnikovu dozvolu.
- fa01b90: meniji i sobe su preuređeni po Jamb uzoru: početni ekran, dve kartice za kreiranje/pridruživanje, čekaonica sa pozivnicom i mestima, domaćinov početak partije. Napuštanje čekaonice oslobađa mesto i prenosi domaćina.
- b2fbf53 / PR #1: bezbednije sobe — kriptografski kodovi od pet znakova, autentifikovani HTTP/SSE, heširani tokeni, idempotentne komande, očekivane revizije, limiti zahteva i čišćenje soba.
- f58f161 / PR #2: Render javni URL se koristi kada PUBLIC_URL nije zadat.
- 212589e / PR #3: pravila usklađena sa klasičnom varijantom i prikazom pravila.
- 9438aab i ddc8a2c: dodata lokalna solo igra sa botovima; resursi premešteni u public direktorijum.
- a104a1d / PR #4: centrirana tabla, zbijen mobilni raspored i pravila u mobilnom meniju.
- 0c43a5e / PR #5: desktop kontrole Space za bacanje i 1–4 za izbor dozvoljene figure.

Ovi commitovi su bili na main pri pregledu 29. septembra. Prethodna lokalna kopija bila je fast-forward usklađena bez konflikta, ali se dalji rad po najnovijoj korisnikovoj instrukciji obavlja isključivo na GitHubu.

## Trenutna arhitektura

- game.js: čista pravila i prelazi stanja za online server i lokalni solo režim.
- room-store.js: čuvanje soba, potvrda komandi i granice trajanja.
- server.js: Node HTTP server, autentifikacija, limiti, bacanje, API, SSE i statički fajlovi. Socket.IO nije deo sadašnje verzije.
- public/index.html, public/menu.css, public/app.js: početni meni, online sto, čekaonica, solo izbor, tabla i pravila.
- public/room-code.js: normalizacija koda ili pozivnog linka.
- public/solo-bots.js: lokalni botovi i njihova bacanja.
- public/keyboard-shortcuts.js: desktop prečice.
- test fajlovi i .github/workflows/tests.yml: provere na GitHub Actions.

Node.js zahtev je 22.8 ili noviji. Nema spoljašnjih npm paketa. Za produkciju su bitni HTTPS, privatni trajni data direktorijum, origin podešavanja i jedan proces po direktorijumu.

## Trenutna pravila

Soba prima 2–4 igrača; domaćin može da počne sa najmanje dva. Pre igre svaki igrač baca za izbor početnog igrača; izjednačeni na vrhu ponovo bacaju. Svako ima četiri figure. Šestica izvodi figuru iz kuće i daje dodatno bacanje. Ako su sve preostale figure u kući, igrač ima do tri pokušaja da dobije šesticu u svom krugu; inače jedno bacanje osim dodatnih bacanja. Krug ima 52 polja, zatim pet završnih polja i cilj uz tačan broj koraka. Sopstvena figura blokira start, krug i završnu stazu, ali ne zajednički cilj. Izbacivanje protivnika važi i na obojenim početnim poljima i daje dodatno bacanje. Nema dodatnih bezbednih polja ni kazne za tri uzastopne šestice. Pobeđuje prvi sa sve četiri figure u cilju. Ovo je trenutno implementirana varijanta; prvobitna lista otvorenih pravila iz prototipa više nije aktuelna.

## Sobe, API i čuvanje

Kod sobe ima pet znakova i služi kao pozivnica, ne kao dozvola za čitanje. Pri kreiranju/pridruživanju igrač dobija 256-bitni token; server čuva SHA-256 heš. Čitanje stanja i SSE zahtevaju Bearer token, a klijent za SSE koristi fetch streaming da token ne stavlja u URL. Pozivni link sadrži samo kod.

Mutacione komande start, roll, move i leave koriste token, requestId i expectedRevision. Ponovljen identičan zahtev vraća originalnu potvrdu; drugačija komanda sa istim ID-jem ili zastarela revizija vraća 409. Poslednjih 128 potvrda po sobi preživljava restart. Izmene se pripremaju na kopiji, zapisuju preko privremenog fajla i atomskog preimenovanja, pa objavljuju u memoriji i SSE-u. Nema fsync, niti podrške za više procesa nad istim data direktorijumom.

Server ima ograničenja za kreiranje, pridruživanje, pristupe, komande i SSE, proveru origin-a i čišćenje isteklih soba. Podrazumevano je najviše 500 soba; neaktivne traju 30 minuta, sve najviše 24 sata, završene 60 minuta. Detalji su u README.md i room-store.js. Stari V1 kodovi od 32 znaka i sesije nisu kompatibilni sa V2.

## Provere i ograničenja

Pre najnovije instrukcije korisnika, 29. septembra lokalno je pokrenuto node --test --test-isolation=none: 28 od 28 testova je prošlo. Obično npm test u tadašnjem Windows sandboxu nije moglo da pokrene test procese zbog spawn EPERM; to nije rezultat samih testova. GitHub Actions workflow postoji za Node 22 i 24, ali CI status za HEAD nije bio potvrđen u tom lokalnom pregledu. Korisnik je zatim izričito naložio da se od sada svi testovi pokreću isključivo na GitHubu i da se ništa više ne radi lokalno. Poštovati to za sav naredni rad.

Vizuelna provera najnovijih ekrana u browseru i aktivne Render verzije nije ponovljena. Solo botovi su lokalni režim u browseru, nisu serverom vođeni online igrači. Za dugotrajne partije ili više instanci potreban je plan za zajedničku bazu i koordinaciju događaja.
