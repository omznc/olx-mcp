# olx-mcp (vibe coded nije me briga)

MCP server za [OLX.ba API](https://api-documentation.olx.ba/). Omogućava Claudeu (i drugim MCP
klijentima) da pretražuje OLX, objavljuje i uređuje oglase, upravlja slikama i sponzorstvima.
36 alata koji pokrivaju sve endpointe iz zvanične dokumentacije, plus pretragu oglasa.

## Instalacija

```sh
claude mcp add olx -- npx -y github:omznc/olx-mcp
npx -y github:omznc/olx-mcp login
```

Prva komanda registruje server, druga vas prijavi na OLX. Nakon prijave restartujte Claude Code.

Radi sa Node.js 18+ ili Bunom. `npx` je samo najčešće dostupan; ako koristite Bun, `bunx` radi
isto tako.

<details>
<summary>Drugi MCP klijenti (Cursor, Zed, Windsurf...)</summary>

Server je običan stdio MCP server, pa u konfiguraciju klijenta ide:

```json
{
  "mcpServers": {
    "olx": {
      "command": "npx",
      "args": ["-y", "github:omznc/olx-mcp"]
    }
  }
}
```

</details>

## Ažuriranje

Server se ažurira sam. Pri svakom pokretanju provjeri koji je zadnji commit na `main` i, ako je
instalirana verzija starija, obriše svoj npx cache. Sljedeće pokretanje onda povuče novu verziju,
pa je dovoljno restartovati MCP klijenta.

Ručno, bez čekanja na restart:

```sh
npx -y github:omznc/olx-mcp update
```

Provjera se radi u pozadini, nakon što se server javi klijentu, i ne može odgoditi ni prekinuti
pokretanje. Isključuje se sa `OLX_MCP_NO_AUTO_UPDATE=1`.

Ovo je potrebno jer `npx` zapamti commit sa kojeg je instalirao i poslije ga više ne provjerava:
ponovno pokretanje `npx github:omznc/olx-mcp` samo po sebi nikad ne povuče noviju verziju.

Prijava ostaje sačuvana; token je u `auth.json`, ne u cacheu.

## Prijava

```sh
npx -y github:omznc/olx-mcp login     # traži korisničko ime i lozinku
npx -y github:omznc/olx-mcp status    # provjeri da li prijava radi
npx -y github:omznc/olx-mcp logout    # obriši sačuvani token
```

Lozinka se ne ispisuje dok se kuca i nigdje se ne čuva. Sačuva se samo token koji OLX vrati:

| Sistem | Lokacija |
| --- | --- |
| Linux / macOS | `$XDG_CONFIG_HOME/olx-mcp/auth.json`, inače `~/.config/olx-mcp/auth.json` |
| Windows | `%APPDATA%\olx-mcp\auth.json` |

Na Linuxu i macOS-u fajl dobija dozvole `600`, pa ga čita samo vaš korisnik.

Zato se prijavljujte iz terminala, a ne kroz `olx_login` alat u razgovoru: argumenti alata se
zapisuju u historiju razgovora, pa bi lozinka završila tamo.

### Varijable okruženja

Za CI, servere i slične slučajeve bez terminala. Imaju prioritet nad sačuvanim tokenom:

| Varijabla | Opis |
| --- | --- |
| `OLX_TOKEN` | Gotov bearer token |
| `OLX_USERNAME` + `OLX_PASSWORD` | Server se sam prijavi pri prvom pozivu |
| `OLX_CLIENT_ID` + `OLX_CLIENT_TOKEN` | Stari način autentikacije |
| `OLX_BASE_URL` | Promijeni API adresu (podrazumijevano `https://api.olx.ba`) |
| `OLX_MCP_CONFIG_DIR` | Promijeni gdje se čuva `auth.json` |
| `OLX_MCP_NO_AUTO_UPDATE` | Isključi automatsku provjeru verzije |

## Alati

**Autentikacija**: `olx_login`, `olx_logout`, `olx_auth_status`

**Pretraga**: `olx_search_listings`

**Oglasi**: `olx_get_listing`, `olx_create_listing`, `olx_update_listing`,
`olx_publish_listing`, `olx_delete_listing`, `olx_finish_listing`, `olx_hide_listing`,
`olx_unhide_listing`, `olx_refresh_listing`, `olx_refresh_limits`, `olx_listing_limits`,
`olx_upload_listing_images`, `olx_delete_listing_image`, `olx_set_main_listing_image`

**Korisnici**: `olx_me`, `olx_user_listings` (aktivni / završeni / neaktivni / istekli / skriveni)

**Kategorije**: `olx_categories`, `olx_category`, `olx_category_attributes`,
`olx_category_brands`, `olx_category_brand_models`, `olx_suggest_category`, `olx_find_category`

**Lokacije**: `olx_cities`, `olx_city`, `olx_countries`, `olx_country_states`,
`olx_canton_cities`

**Sponzorstva**: `olx_sponsor_price`, `olx_sponsor_listing`, `olx_set_discount`,
`olx_finish_discount`

Samo `olx_search_listings` radi bez prijave; sve ostalo traži token.

## Objavljivanje oglasa

1. `olx_suggest_category`: nađite `category_id` na osnovu opisa artikla.
2. `olx_category_attributes`: pogledajte koje atribute ta kategorija traži.
3. `olx_create_listing`: vraća id novog oglasa, status `DRAFT`.
4. `olx_upload_listing_images`: lokalni fajlovi i/ili URL-ovi slika.
5. `olx_publish_listing`: oglas ide live.

**`DRAFT` nije privatan draft.** Provjereno na live API-ju: prvi `olx_update_listing` nad draftom
ga objavi. Status pređe u `active` i oglas je javno vidljiv, isto kao da je pozvan
`olx_publish_listing`. Zato oglas pravite tek kad je sadržaj gotov, a ne uz plan da se popravi
poslije.

## Pažnja: troši novac ili je nepovratno

- `olx_sponsor_listing` skida sredstva sa OLX računa. Prvo provjerite cijenu sa `olx_sponsor_price`.
- `olx_refresh_listing` je besplatan samo unutar limita iz `olx_refresh_limits`.
- `olx_delete_listing` se ne može poništiti; `olx_hide_listing` i `olx_finish_listing` mogu.
- `olx_publish_listing` čini oglas javno vidljivim na OLX-u.
- `olx_update_listing` nad `DRAFT` oglasom ga takođe objavi, vidi gore.

Opisi ovih alata upozoravaju model da prvo pita korisnika, ali to je uputa modelu, ne tehnička
zabrana.

## Napomene

- `GET /search` (iza `olx_search_listings`) **nije** dio zvanične dokumentacije. To je endpoint
  koji koristi sam OLX sajt, provjeren na live API-ju. Ne traži prijavu i može se promijeniti bez
  najave. Svi ostali alati odgovaraju dokumentovanim endpointima.
- Alati koji vraćaju velike odgovore (`olx_search_listings`, `olx_user_listings`,
  `olx_get_listing`, `olx_me`, `olx_cities`, `olx_categories`, `olx_category_attributes`) daju
  sažetak, da ne troše kontekst modela. Svaki od njih prima `full: true` za sirovi OLX odgovor.
- OLX vraća `403` ili `404` za endpointe za koje račun nema dozvolu, pa `404` ne znači uvijek da
  resurs ne postoji.
- Sve cijene su u KM (BAM).
- Ovo je nezvaničan projekat i nije povezan sa OLX-om.

## Razvoj

Za rad na projektu treba [Bun](https://bun.sh).

```sh
bun install
bun run start        # pokreni server iz src/
bun test             # pokreće server preko stdio i testira ga kao pravi MCP klijent
bun run typecheck
bun run build        # bundluje src/ u dist/index.js
```

`dist/index.js` je namjerno u repozitoriju: `npx github:omznc/olx-mcp` ga pokreće direktno iz
klona, bez build koraka. Ako mijenjate `src/`, pokrenite `bun run build` i commitujte `dist/`.
CI pada ako je `dist/` zastario.

## Licenca

MIT
