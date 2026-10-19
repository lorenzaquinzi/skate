# Skate

A tiny endless skateboard runner, in the spirit of Chrome's offline dinosaur. Skate down a street, jump the obstacles (cones, bins, hydrants, benches, barriers), and beat your high score. One hit ends the run.

Pure line art drawn on a canvas in the page colours, so it follows light / dark mode. No dependencies, no build step.

## Controls

| Action | Keys | Touch |
| --- | --- | --- |
| Jump (hold for a higher one) | `Space` / `↑` / `W` | tap |
| Kickflip (+10) | press again in the air | tap in the air |
| Drop faster | `↓` / `S` | — |
| Grind a bench (+15) | land on top of it from a jump | same |
| Ollie off the bench | jump while grinding | tap |

Any key (`Space`, `↑`, `↓`, `W`, `S`, `Enter`) or a click / tap anywhere starts a run, and starts a new one after Game over. The Start button sits at the bottom.

The best score is kept in `localStorage`.

## Run

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Origin

Extracted from the hero "game" variant of [portfolio26](https://github.com/lorenzaquinzi/portfolio26) (`hero.js` / `hero.css`) as a standalone page.
