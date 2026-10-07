# MTG League — setup

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
| `manifest.json`, `icon.svg` | "Add to Home Screen" support |

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
1. Create a GitHub repository, e.g. `mtg-league`, and upload all files except `Code.gs` (it doesn't hurt if you include it).
2. **Settings → Pages** → *Deploy from a branch* → `main` / root → Save.
3. The app is live at `https://<your-user>.github.io/mtg-league/` after a minute.
   Any static host works (Netlify, Cloudflare Pages, …).

Optional: put your sheet link in `config.js` (`defaultSheet: 'https://docs.google.com/…'`) so players just tap *Continue*.

## 4. Connect saving
Open the app → enter the sheet link → **Settings → Write access** → paste the Web app URL → **Connect**.
The app stores the URL in a new **Config** tab in the sheet, so every other player gets saving automatically.

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
cd mtg-league && python3 -m http.server 8000   # then open http://localhost:8000
```
