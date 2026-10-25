# Tetrix

A Tetris-style falling-block game in plain HTML, CSS, and JavaScript. It has no dependencies and no build step.

**Play:** https://sed1565.github.io/tetrix/

## Features

- Standard 10×20 field with the 7 tetrominoes
- SRS rotation with wall kicks
- 7-bag randomizer and a 4-piece preview
- Hold piece, ghost piece, and lock delay
- Guideline gravity curve, a level-up every 10 lines
- Scoring: 100 / 300 / 500 / 800 × level, plus soft and hard drop bonuses
- Best score saved in localStorage
- On-screen touch controls for mobile

## Controls

| Key | Action |
| --- | --- |
| ← / → | Move |
| ↓ | Soft drop |
| Space | Hard drop |
| ↑ / X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| C / Shift | Hold |
| P / Esc | Pause |
| Enter | Start / restart |

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```
