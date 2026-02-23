# FNGRNCTR – Copilot Instructions

## What this project is

Static website for **FNGRNCTR** (Fingernectar), a music act. Live at [fngrnctr.biz](https://www.fngrnctr.biz).

No framework, no build step — plain HTML/CSS/JS. Three files do everything:

| File | Purpose |
|------|---------|
| `index.html` | Shell: canvas + hidden `#site` landing page markup |
| `main.js` | All game logic + `showSite()` that reveals the landing page |
| `styles.css` | All styles, including landing page layout |

## User experience flow

1. User lands on a black canvas.
2. They move a character (mouse/touch/keyboard) to erase black ink and reveal a hidden image (`clouds.png`).
3. Once ~95% revealed, a short animation plays (player fades, albums orbit, screen fades to black).
4. `showSite()` fires — canvas is hidden and the `#site` landing page fades in.

## Landing page (`#site`)

- **Nav:** `FNGRNCTR` logo (links to home section) | `MUSIC` | `MERCH`
- **HOME section:** hero image (`clouds.png`)
- **MUSIC section:** album grid built from the `albums` array in `main.js`; each card links to Bandcamp in a new tab
- **MERCH section:** placeholder "Coming soon." — actively being built on branch `feature/merch-section`

## Key conventions

- **Vanilla JS only** — no npm, no bundler, no framework
- **Conventional commits** (`feat:`, `fix:`, `chore:`, etc.)
- Test locally: `python3 -m http.server 8000` (must use a server, not `file://`, due to image loading)
- Images (`clouds.png`, `nectar-preview.png`) are in the repo root alongside the source files
- Album art is loaded from Bandcamp CDN (`f4.bcbits.com`)

## Active work

Branch `feature/merch-section` — adding a merch store to the MERCH section of the landing page. Keep merch UI minimal and consistent with the existing black/white aesthetic.
