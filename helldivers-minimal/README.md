# HellBrowsers

**Minimal co-op game, for Super Earth**

A lightweight browser co-op top-down shooter inspired by Helldivers.  
Runs from static files on GitHub Pages or any static host. Solo works offline. Multiplayer uses PeerJS (WebRTC).

## Quick start

```bash
cd helldivers-minimal   # or wherever you put the folder
npx serve .
# or:  python -m http.server 8000
```

Open the URL in a modern browser. Click **SOLO DEPLOY** — gameplay should start immediately.

## Controls

| Action | Input |
|--------|-------|
| Move | W A S D |
| Aim / Fire | Mouse + Left click |
| Sprint | Shift (hold) |
| Reload | R |
| Stratagems | Hold **Ctrl**, then directional W/A/S/D |
| Pause | Esc |

**Stratagem codes** (while holding Ctrl):

- Resupply — ↓ ↓ ↑ →
- Orbital Strike — → → ↑
- Reinforce — ↑ ↓ → ← ↑
- Eagle Strafing — ↑ → →

Survive waves of bugs, call stratagems, then stand in the extract zone (blue circle) after wave 3 with all living divers.

## Multiplayer

1. Host clicks **HOST SQUAD** and copies the full Peer ID.
2. Others paste that ID and click Connect.
3. Host presses **START MISSION**.

Requires a working network and a browser that supports WebRTC. Solo always works even if PeerJS fails to load.

## Files

- `index.html` — entry point
- `css/style.css`
- `js/` — storage, audio, network, entities, game, main
- `game.qmd` — Quarto example page with iframe embed

## Quarto / GitHub Pages

Drop the folder into your site. Link to `index.html` or embed:

```markdown
\`\`\`{=html}
<iframe src="helldivers-minimal/index.html" width="100%" height="700" style="border:2px solid #333;border-radius:4px;" allow="autoplay"></iframe>
\`\`\`
```

## Notes

Fan project. Not affiliated with Arrowhead Game Studios.  
Built so people without Helldivers (or who want >4 players) can still enjoy a bit of the co-op loop in the browser.
