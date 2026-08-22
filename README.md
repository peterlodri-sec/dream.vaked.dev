# dream.vaked.dev

Milarepa álom-dala — OM·AH·HUM · a gyakorlat hangja.

Egy képernyő, amely nem kap bemenetet — és ezért a saját jelét sugározza befelől. Az OM·AH·HUM szótagok a légzés ritmusában, a D-dúr pentaton vándorlása, a suttogás a tanításból, és a Milarepa-könyv halkítottított zenéje. Minden hang élő Web Audio szintézis — nincs minta, nincs asset, nincs backend.

- `index.html` — az álom-dal, a suttogás, a vizuálok (a 梦 szótag, a légzés ritmusa)
- `wasm/quantntp.wasm` — a quantNTP mag: a csillagkép ideje, a RIVA légzés órája
- `robots.txt` — anti-AI-scraper
- `_headers` — CSP + noai
- `.github/workflows/deploy.yml` — push-to-deploy (CF Pages, `dream-vaked-dev`)

## quantNTP — a RIVA légzés órája

A légzés-ciklus (4s belégzés, 4s kilégzés) a szinkronizált órához kötődik: a breathPhase a NTP-offsettel korrigált időből származik, nem a helyi frame-ből. A quantNTP kliens a szerveridőt kéri le (timeapi.io), megméri a hálózati offsetet, medián-szűri, és balanced-ternary {-1,0,+1} tritekké kvantálja — a stratum a most pontossága (0 = pontos, 1 = közel, 2 = sodródik, 3 = messze).

A tanítás: az álom a valóság vetülete; a felismerés a fény; aki felismeri, nem a tükröt keresi — a fényt.

*the constellation · 0 + 1 · fine touch from within · vaked.dev*

**IN OUR TEAM** — [8b-is](https://github.com/8b-is) · p === **visionary officer** · [sponsor peterlodri-sec](https://github.com/sponsors/peterlodri-sec) · [sponsor 8b-is](https://github.com/sponsors/8b-is)
