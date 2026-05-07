# Snake Game

A modern, polished take on the classic Snake game — built with plain **HTML Canvas + CSS + JavaScript** (no frameworks).

## Features

- Smooth fixed-timestep gameplay (consistent movement speed across devices)
- **Sound system** with mute + volume control (persists in `localStorage`)
- **Difficulty** presets (Easy / Normal / Hard)
- **Pause/Resume** (`Space`) + **Restart** (`R`)
- **High score** saved locally
- Optional **wrap walls** mode
- **Bonus food** that appears briefly for extra points
- Keyboard controls (Arrow keys / WASD) + basic touch swipe support

## Play

Open `index.html` in a browser.

For the most reliable audio support (recommended), run a tiny local web server:

```bash
python -m http.server 5173
```

Then open:

`http://localhost:5173`

## Controls

- Move: `Arrow Keys` or `W A S D`
- Start / Pause / Resume: `Space`
- Restart: `R`

## Project Structure

- `index.html` — UI + canvas
- `styles.css` — layout and styling
- `snakeGame.js` — game logic, rendering, input, sound
- `assets/sfx/` — sound effects

## Notes

- Settings and high score are stored in `localStorage` under `snake_game_v1`.

## License

MIT — see `LICENSE`.
