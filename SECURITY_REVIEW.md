# Bezbednosni pregled i priprema naloga

Datum: 30. septembar 2026. Opseg: main izvorni kod oba Arena sajta, sobe, korisnički unos, javne rute i postojeće provere. Izmene i testovi rađeni su preko GitHub-a. Nisu izvođeni napadi opterećenja na produkciju.

## Nalazi

| Nalaz | Rizik i postupak |
| --- | --- |
| Jamb: token kombinovao mali nasumični broj i vreme | Premalo nepredvidivosti za pristup tuđoj sesiji. Zamenjen sa 32 kriptografski nasumična bajta; server indeksira SHA-256 heš. |
| Jamb: otvoren pristup transportu sa bilo kog domena | Tuđa stranica mogla je da otvara veze i pravi gostujuće sobe. Origin se proverava i za WebSocket i za polling; opaque/null i cross-site browser zahtevi se odbijaju. |
| Jamb: neograničene sobe/veze i komande | Rizik iscrpljivanja memorije i procesora. Dodati kapaciteti, ograničenja po vezi i mrežnom izvoru, limit poruke i apsolutno trajanje sobe. |
| Jamb: komande bez oznake poteza i identiteta zahteva | Odložena komanda mogla je da pogodi kasniji potez istog igrača. Novi turnId i requestId odbijaju zastarele i ponovljene komande; server ostaje autoritet za bodovanje. |
| Oba sajta: nedovoljna zaštita u pregledaču | Dodati CSP, zabrana ugrađivanja u tuđi iframe, nosniff, no-referrer i zabrana nepotrebnih dozvola. Script CSP dozvoljava samo sopstveni domen. |
| Jamb: učitavanje izvršnog klijentskog koda sa CDN-a | Socket.IO klijent sada dolazi sa sopstvenog servera iz instalirane zavisnosti. |

## Pregled postojećih granica

- Čoveče već koristi kriptografske kodove i tokene, heš tokena na serveru, autorizovane GET/SSE rute, revizije, potvrde komandi, ograničene zahteve i čišćenje soba. Bez tokena kod sobe ne daje pravo da se čita partija.
- Serveri proveravaju igrača na potezu i dozvoljene unose; klijentska ili solo izmena ne daje privilegije u online partiji.
- Jamb korisnička imena se HTML-escape-uju; Čoveče ih upisuje preko textContent. U pregledanim putanjama nije potvrđena izvršiva HTML injekcija. Dodata je provera stvarnog Jamb renderera sa zlonamernim imenom.
- Javni fajlovi su ograničeni na dozvoljene resurse. Server, room-store, podaci i konfiguracija nisu javne rute.
- Šifra sobe je pozivnica za slobodno mesto, a ne identitet naloga. Kratak kod i dalje može biti pogođen; limiti otežavaju masovno pogađanje. Privatne sobe za naloge treba da dobiju eksplicitnu kontrolu članstva.

## Šta mora da postoji pre uključivanja naloga

1. Posebna serverska autentifikacija naloga. Token gostujuće sobe ne postaje token naloga.
2. Sesija naloga u Secure, HttpOnly, SameSite kolačiću; server čuva samo heš nepredvidivog identifikatora. Ne stavljati lozinke ili sesije naloga u URL/localStorage. Obnavljanje pri prijavi/promeni privilegija, rok neaktivnosti i apsolutni rok, opoziv pri odjavi i promeni lozinke.
3. Izabrati jedan kanonski domen/autoritet za naloge. Dva sadašnja onrender.com porekla nemaju zajedničko localStorage niti zajednički kolačić. Za zajedničku prijavu koristiti standardni OIDC tok sa proverom state/nonce i PKCE, umesto prosleđivanja session tokena kroz linkove.
4. Serverska autorizacija svakog resursa po userId i članstvu. Nikada ne verovati userId, admin ulozi, rezultatu ili email-verifikaciji koje šalje klijent.
5. Trajna baza sa rezervnim kopijama i ograničenim DB nalogom. Render memorija/ephemeral filesystem za partije nisu trajno skladište naloga. Parametrizovani upiti i migracije.
6. Ako se lozinke obrađuju u aplikaciji: Argon2id uz per-user salt, odgovarajući trošak i bez čuvanja originala. Ako se koristi održavan auth servis, odgovornost i dozvole moraju biti jasno definisani. Ne pisati sopstveni kripto/protokol.
7. Zaštita login/registracija/reset ruta: ograničenja po nalogu i mreži, generički odgovori, verifikacija emaila, jednokratni vremenski ograničeni reset tokeni čiji se heš čuva i opoziv prethodnih sesija.
8. Za cookie autentifikaciju dodati CSRF zaštitu svih promena stanja, proveru Origin i zaštitu WebSocket handshaka. CORS ne zamenjuje autorizaciju.
9. MFA za administratore; odvojene privilegije. Privatni podaci i tokeni ne ulaze u logove, publicGame ili odgovor drugom igraču.
10. Testovi za pristup tuđem nalogu/partiji, CSRF, session fixation, isteka/opoziva, reset replay, brute force i XSS. Pregled i testiranje auth implementacije pre produkcijskog uključivanja.

## Ograničenja pregleda

Ovo je pregled izvornog koda i konkretnih regresija, ne potvrda da je sajt neprobojan. Nisu provereni privatna Render konfiguracija, svi Git istorijski tajni podaci, infrastruktura, penetracioni testovi ili budući auth kod. Aplikativni limiti ne zaustavljaju velike distribuirane napade; zaštita hostinga/proxy-ja i praćenje potrošnje ostaju potrebni.

Style CSP dopušta inline stilove jer postojeći raspored i pozicije kockica/figura zavise od njih. Inline izvršni skriptovi i eval nisu dopušteni. Gostujući tokeni još koriste browser storage radi postojećeg reconnect-a; za naloge je potreban gore opisan cookie model.

Na Render-u mrežne kvote koriste stvarni transportni remoteAddress i ne veruju proizvoljnom X-Forwarded-For. Proxy može objediniti više ljudi pod istom adresom; kvote treba podesiti prema stvarnoj upotrebi i dokumentovanoj pouzdanoj proxy konfiguraciji.

## Reference

- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
