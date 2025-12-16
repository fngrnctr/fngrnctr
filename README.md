# FNGRNCTR

A tiny, dark‑mode, black‑and‑white top‑down movement game. Desktop and mobile friendly. Built with a single HTML canvas and plain JavaScript for clarity and extensibility.

## Controls
- Move: WASD or Arrow Keys
- Touch: Drag anywhere to move
- Help: Press H to toggle the on‑screen help

## Local Run
Use any static server. For example with Python:

```bash
cd /Users/johnmiller/Projects/Website
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000/
```

## Deploy to GitHub Pages
1. Create a GitHub repository and push the files in this folder.
2. In the repo settings, enable GitHub Pages for the `main` branch and `/ (root)`.
3. Your site will be available at:

```
https://<your-username>.github.io/<your-repo>/
```

## Customize
- Player speed / size: update `speed` and `size` in `Player` inside [main.js](main.js).
- Colors: the game is intentionally black (`#000`) and white (`#fff`). Adjust in [styles.css](styles.css) and [main.js](main.js) if needed.
- Extensibility: add entities, walls, or collectibles by following the small `Player` pattern.
