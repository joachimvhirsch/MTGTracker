# MTG Tracker — setup

A mobile web app (plain HTML/JS, no build step) for your Magic league sheet.
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

Recommended: lock the sheet link with a league password (see **Password-locked sheet link** below),
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
Players only enter a league password — once, and again only if their browser data gets cleared.
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
- **Matches**: `id`, `date`, `playerA`, `deckA`, `playerB`, `deckB`, `onPlay`, `gamesA`, `gamesB`, `notes`
  — players and decks are referenced by **name**; `onPlay` is the name of the player on the play (optional).
- **Config** (created automatically): `key`, `value`

Columns are matched by header name, so order doesn't matter and extra columns are left untouched.
New ids continue your numbering (`d28`, `m0112`, …), and dates match the format of the row above.
Renaming a deck also renames it in the Matches tab; deck names must be unique.

## Good to know
- Anyone with the sheet link can add or change data through the app. Use **File → Version history** in
  Google Sheets to undo mistakes.
- Saves are queued safely if two people save at the same moment (the script uses a lock).

## Test locally
```bash
cd mtg-tracker && python3 -m http.server 8000   # then open http://localhost:8000
```
