# SKYWARD: IRON HORIZON

An arcade naval air-combat game for the browser, built in vanilla Three.js + Vite. You fly a fighter jet over the Iron Horizon islands and clear five escalating enemy waves with cannon and lock-on missiles. The UI is in Korean.

- **Real assets from the Patch library**: a PBR fighter jet (player and enemy LODs), a vintage propeller fighter, a Poly Haven HDRI sky that also lights the scene, photogrammetry coastline rocks, and grass, rock and beach PBR terrain materials. See [ASSET_CREDITS.md](ASSET_CREDITS.md).
- **Arcade flight model**: bank-to-turn assist, wings-level auto assist, boost energy, and a stall feel.
- **Dogfighting AI**: pursues with lead, evades, extends after overshoots and avoids terrain. Enemy missiles arrive from wave 3.
- **HUD**: blue/cyan cockpit style with amber target brackets, pitch ladder, flight-path marker, gun lead pipper, lock ring, radar, and speed, altitude, health and weapon readouts.
- **Input**: keyboard, gamepad (standard mapping, works in menus too) and touch (virtual stick plus buttons).
- **Persistence and sound**: best score is kept in localStorage. Sound is procedural WebAudio with an on/off toggle.

## Run

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 7622 --strictPort
npm test
npm run build      # outputs dist/ (self-contained, relative paths)
```

The Patch asset files live in `public/assets/patch/`. `npm run assets` downloads them again using parallel ranged requests and checks each file's SHA-256.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Pitch / roll | W S A D / arrows | left stick | stick |
| Yaw | Q / E | right stick ↔ | — |
| Boost | Shift | left trigger | BST |
| Cannon | Space | right trigger | GUN |
| Missile | M / F | bottom button / left shoulder | MSL |
| Next target | T / R | right shoulder / right button | TGT |
| Camera | C | top button | CAM |
| Pause | P | start | II |

Esc belongs to the Patch overlay. The game also pauses when the window loses focus.

## Code layout

- `src/simulation.js`: the `FlightSimulation` class (renderer, assets, effects, camera, input, telemetry).
- `src/engine/game.js`: the headless combat core (waves, weapons, damage, scoring, telemetry).
- `src/engine/flight.js`: the flight model. `ai.js`: enemy AI. `terrain.js`: procedural islands shared by physics and rendering.
- `src/engine/render.js`: terrain material blending, ocean shader, clouds, particles, tracers.
- `src/engine/hud.js`: the in-world HUD overlay. `input.js`: keyboard, gamepad and touch. `camera.js`: chase camera.
- `src/main.js`, `src/style.css`, `index.html`: screens, HUD binding, radar and touch UI.
- `tests/`: Vitest tests for the simulation.

## Patch test mode

Opening the game with `?patch-test=1` skips the menus. A test-only autopilot then flies the same controls a player has, and the game logs `pass <check>` when each listed condition actually happens. The checks are listed in `patch-recipe.draft.json`. That file is a **draft release recipe**, not pch project config. `patch.json` is left for `pch init`, which writes it once there is an authorised Patch project. The draft's `test` and `credits` get merged in then.
