# MTG Tracker — setup

A mobile web app (plain HTML/JS, no build step) for your Magic sheet.
No Google Cloud project, no OAuth Client ID and no sign-in needed.

- **Reading:** the app reads the sheet directly. The sheet must be shared as *Anyone with the link → Viewer*.
- **Saving** (new matches, new/edited decks): goes through a small Apps Script attached to the sheet (`Code.gs`),
  which writes on behalf of the sheet owner. Anyone who can open the app with the sheet link can save.

## Files
| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `Code.gs` | Apps Script for saving — goes into the sheet, not onto the web host |
| `config.js` | Optional: pre-fill the sheet link for everyone |
| `manifest.json`, `sw.js`, `icon*.png`, `apple-touch-icon.png`, `icon.svg` | Install-as-app support |
| `icons/` | Optional: your own color icons (see below) |
| `i18n.js` | All texts in English and German — edit wording here |
| `sealed.js` | Sealed mode (tournaments, Swiss pairing, round timer) |

## 1. Share the sheet
Google Sheets → **Share** → General access → **Anyone with the link** → *Viewer*.

## 2. Add the Apps Script (sheet owner, once, ~3 minutes)
1. In the sheet: **Extensions → Apps Script**.
2. Delete the sample code, paste the whole content of `Code.gs`, click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, approve the permission prompts (Google may say the app isn't verified:
   *Advanced → Go to … (unsafe)* — it's your own script), and copy the **Web app URL** (ends in `/exec`).

## 3. Host the app (GitHub Pages, free)
1. Create a GitHub repository, e.g. `mtg-tracker`, and upload all files except `Code.gs` (it doesn't hurt if you include it).
2. **Settings → Pages** → *Deploy from a branch* → `main` / root → Save.
3. The app is live at `https://<your-user>.github.io/mtg-tracker/` after a minute.
   Any static host works (Netlify, Cloudflare Pages, …).

Recommended: lock the sheet link with a password (see **Password-locked sheet link** below),
so players never have to type the link.

## 4. Connect saving
There are two different addresses — don't mix them up:
- **App address** — where the app is hosted (e.g. `https://<your-user>.github.io/mtg-tracker/`). This is what players open.
- **Apps Script URL** — the address of the script from step 2, e.g. `https://script.google.com/macros/s/AKfycb…/exec`.
  Lost it? In the Apps Script editor: **Deploy → Manage deployments** → copy the *Web app* URL.

Then, once:
1. Open the **app address** on your phone or computer and enter the sheet link.
2. Tap the ⚙︎ icon → **Write access** → paste the **Apps Script URL** (must end in `/exec`) → **Connect**.
3. "Connected" appears. The app has written the Apps Script URL into a new **Config** tab in your sheet,
   so other players don't need to do this — they only enter the sheet link.

## Password-locked sheet link
Players only enter a password — once, and again only if their browser data gets cleared.
1. Open the app, enter the sheet link yourself, then **Settings → Advanced → Lock sheet with password**.
2. Enter a passphrase (several words, e.g. `blue goblins eat tempo`) twice → **Create locked link** → **Copy line**.
3. On GitHub open `config.js` → ✏️ → replace the line `lockedSheet: '',` with the copied line → **Commit changes**.
4. Tell your players the password.

The link is encrypted in your browser (AES-256, PBKDF2) — GitHub only stores scrambled text, and the password never
leaves the app. Choose a passphrase rather than something short, since the scrambled text is public.
To change the password, repeat the steps. The app also asks the phone to keep its saved data permanently
(usually granted for installed apps), so the password is rarely needed again.

## Install on phones (like an app)
No app store needed. Send your players the app address. Then:
- **Android (Chrome):** open the address → Settings (⚙︎) → **Install app**, or Chrome's ⋮ menu → **Install app**.
- **iPhone (Safari):** open the address → **Share** → **Add to Home Screen**.

The app gets its own icon, opens full screen, and still updates automatically whenever you change the files on GitHub.
Required files for this (all in this folder): `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`, `apple-touch-icon.png`.

## Modes (☰ menu, top left)
- **Duel** — 1-on-1 matches with your constructed decks (Statistics, Table, Matches).
- **Multiplayer** — single games with 3+ players (Statistics, Table, Games). **+** → New game: date, one row per player (player, deck, mulligans; **Add player** adds a row), then pick the winner or Draw. Uses the same decks as Duel. Tap a game to edit or delete it.
- **Sealed** — your own mini tournaments: Statistics, Table (players across tournaments), Tournaments.

### Running a Sealed tournament
1. Sealed → **+** → pick the set (searchable list with set icons, loaded live from Scryfall), choose or add players, round time (default 50 min) → **Start tournament**.
2. **Create pairings for round 1** (random). Later rounds use the Swiss system: players with equal points meet, no rematches, a bye (counts as a 2–0 win) goes to the lowest-ranked player who hasn't had one yet.
3. **Start round** starts the timer. The start time is saved in the sheet, so every phone with the tournament open shows the same countdown; at 0:00 they ring and vibrate. The screen stays on while the timer runs.
   Phones only ring if the app is open (not locked) — tap the screen once after opening so the browser allows sound.
4. Tap a pairing to enter its result. When all results are in: **Next round** or **Finish tournament**.
5. Standings: 3 points per win, 1 per draw; tiebreakers OMW%, GW%, OGW% (official MTG rules, each floored at 33%). Tap a player to set their deck colors.

New sheet tabs `Games` and `GamePlayers` (Multiplayer) and `Tournaments`, `TournamentPlayers` and `TournamentMatches` are created automatically with the first tournament. New players are added to the `Players` tab.

## Editing and deleting matches
In the **Matches** tab, tap a match to edit it (inactive decks can be chosen here) or delete it (tap **Delete** twice).
This needs `Code.gs` version 7 (Multiplayer and deck ids need it too) in the sheet — after replacing the code, use Deploy → Manage deployments → ✏️ → New version.

## Language
Settings → **Language**: *System* (follows the phone's language), *English* or *Deutsch*. Each device remembers its choice.
All texts live in `i18n.js`; change any German wording there (keep the `{placeholders}`).

## Optional: your own color icons
Put one SVG per color into the **`icons`** folder next to `index.html`, named exactly
`W.svg`, `U.svg`, `B.svg`, `R.svg`, `G.svg` (and optionally `C.svg` for colorless):

```
mtg-tracker/
├── index.html
├── app.js
└── icons/
    ├── W.svg
    ├── U.svg
    ├── B.svg
    ├── R.svg
    ├── G.svg
    └── C.svg   (optional)
```

Upload the folder together with the rest of the app (on GitHub: drag the `icons` folder into the repository).
The names are case-sensitive. Any icon that is missing falls back to the built-in letter pip.
Make sure you're allowed to use the images you put there.

## Updating the script later
Use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL.
(A *New deployment* creates a new URL, which you'd then have to connect again.)

## Sheet format (as in your current sheet)
- **Players**: `id`, `name`
- **Decks**: `id`, `name`, `colors` (WUBRG letters, e.g. `UBR`), `tags` (comma separated), `active` (TRUE/FALSE),
  `playerId` (one or more player ids, comma separated — e.g. `p1, p2` for a shared deck)
- **Matches**: `id`, `date`, `playerA`, `deckA`, `playerB`, `deckB`, `onPlay`, `gamesA`, `gamesB`, `notes` (+ `draws`, `mulligansA`, `mulligansB`, added automatically when first used)
  — players are referenced by **name**, decks by **id** (e.g. `d07`); `onPlay` is the name of the player on the play (optional).
- **Games** / **GamePlayers** (created automatically): `id`, `date`, `winner`, `draw`, `notes` / `gameId`, `seat`, `player`, `deck` (deck id), `mulligans`
- **Config** (created automatically): `key`, `value`

Columns are matched by header name, so order doesn't matter and extra columns are left untouched.
New ids continue your numbering (`d28`, `m0112`, …), and dates match the format of the row above.
Decks are referenced by id, so two players can each have a deck with the same name (one player can't have two with the same name), and renaming a deck changes nothing else.

**Older sheets (deck names in Matches/GamePlayers):** after you update `Code.gs` to version 7, the app converts the names to deck ids automatically the next time it's opened (a short "Updated … deck references" message appears). If a name belonged to several decks, the deck of the player in that row is used. Names of decks that no longer exist stay as they are. You can also run it by hand: Apps Script editor → choose `migrateDeckReferences` in the toolbar → Run. Running it again does nothing.

## Good to know
- Anyone with the sheet link can add or change data through the app. Use **File → Version history** in
  Google Sheets to undo mistakes.
- Saves are queued safely if two people save at the same moment (the script uses a lock).

## Test locally
```bash
cd mtg-tracker && python3 -m http.server 8000   # then open http://localhost:8000
```
