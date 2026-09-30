# Fletcher: Destroyer Command

Command USS Fletcher (DD-445) against Japanese convoys in the Solomons, 1943.

**Run it:** open `index.html` in Chrome or Edge (double-click works; no build step). Three.js r128 and fonts load from CDNs.
Or serve the folder: `python -m http.server 8123` and open http://localhost:8123/game/.

## Controls
| Key | Action |
|---|---|
| W / S | Step the engine-order telegraph (Back Full … Ahead Flank), X = All Stop |
| A / D | Rudder (hold) |
| V | Captain's view on the bridge: mouse look, right-click / Z / wheel = binoculars |
| Left-click / Space | Fire the 5"/38s at the director's target (crosshair on a hull locks it) |
| T | Train out a torpedo mount and fire a 5-torpedo spread |
| Q / E | Move between port wing, open bridge, starboard wing |
| C | Chase / orbit camera |
| Esc / P | Pause, settings (time of day, weather, volume, and every wave parameter) |

**Weather & Sea settings** (main menu or pause menu) open as a side panel so the sea stays visible. Pausing only
freezes the battle; the waves and ship keep moving so you can see each change live. Wave controls:
wave height (Hs, metres), wavelength scale (auto or manual), speed, wind direction; the example's Gerstner set
(spread, steepness, swell vs detail, med wavelength); detail (sharpness, chop, ripple, asymmetry); macro swell
(on/off, height, size); colour (deep and peak colours, foam threshold, colour span, depth bias). "Reset waves"
restores the defaults while keeping the current wave height. Moving the Weather slider also sets the wave height.

## Code layout (`js/`)
| Folder | What lives there |
|---|---|
| `core/` | Ship constants, math helpers, geometry helpers |
| `ship/` | The Fletcher model: hull lines, fittings, assembly |
| `env/` | `sea.js` wave model (shared by GPU and CPU), `ocean.js` surface shader, `clouds.js` volumetric sky, `weather.js`, `shipWaves.js` (Kelvin wake) |
| `physics/` | Rigid-body buoyancy and handling, flooding |
| `fx/` | Particles (spray, smoke, fire) and synthesised audio |
| `combat/` | Ballistics and shells, torpedoes, enemy models and AI, our weapons, damage model |
| `view/` | Cameras and the captain's binocular view |
| `ui/` | HUD, SG radar scope, menus |
| `game.js`, `main.js` | Game flow and the main loop |

Scripts are plain (non-module) files loaded in order by `index.html`, so the game also runs straight from disk.

## The sea
`env/sea.js` uses the wave functions from `../Waves and Clouds` (16 golden-ratio Gerstner waves, the warped chop/ridge
detail layer, the macro swell, and the height-gradient colouring) scaled from the example's units into metres for the
chosen sea state. `waterHeight()` evaluates exactly the same maths on the CPU, so buoyancy, shell splashes and
torpedo depth match the surface you see.
