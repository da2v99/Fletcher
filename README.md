# Fletcher: Destroyer Command

Command USS Fletcher (DD-445) against Japanese convoys in the Solomons, 1943.

**Run it:** open `index.html` in Chrome or Edge (double-click works; no build step). Three.js r128 and fonts load from CDNs.
Or serve the folder: `python -m http.server 8123` and open http://localhost:8123/game/.

## Controls
| Key | Action |
|---|---|
| W / S | Step the engine-order telegraph (Back Full … Ahead Flank), 0 = All Stop |
| A / D | Rudder (hold) |
| Mouse | Third-person gun crosshair: the 5"/38s train on whatever is under it (a ship, the sea, or max range above the horizon) |
| X | Lock what's under the crosshair: a ship is tracked with lead wherever you look, a point of sea stays put. X on the current lock releases it |
| Space | Fire the 5"/38s at the director's target (also left-click in the captain's view) |
| Left drag / right drag / wheel | Pan / orbit / zoom the camera (a drag in chase view switches to orbit) |
| B | Captain's view on the bridge: mouse look, right-click / Z / wheel = binoculars, X locks the ship under the reticle |
| T | Train out a torpedo mount and fire a 5-torpedo spread |
| Q / E | Move between port wing, open bridge, starboard wing |
| C | Chase / orbit camera (leaves the captain's view) |
| Esc / P | Pause, settings (time of day, weather, volume, and every wave parameter) |

**Weather & Sea settings** (main menu or pause menu) open as a side panel so the sea stays visible. Pausing only
freezes the battle; the waves and ship keep moving so you can see each change live. Wave controls:
wave height (Hs, metres), wavelength scale (auto or manual), speed, wind direction; the example's Gerstner set
(spread, steepness, swell vs detail, med wavelength); detail (sharpness, chop, ripple, asymmetry); macro swell
(on/off, height, size); colour (deep and peak colours, foam threshold, colour span, depth bias). "Reset waves"
restores the defaults (1.7 m sea, 14 m peak wavelength, glassy blue swell) while keeping the current wave height. Moving the Weather slider also sets the wave height.
**Ship mass** (Ship motion section) runs from a football (0.43 kg) through the real Fletcher (2,900 t, the
middle of the slider) to two Nimitz-class carriers (200,000 t). The ship then moves in the waves like a
geometrically similar hull of that mass would (see Ship motion below); steering and speed stay the Fletcher's.

## Ship motion
A rigid body floated by 57 buoyancy columns along the hull:
- Each column feels the sea averaged over its own patch of hull (a box filter per wave) at mid-draft (wave
  pressure decays as e^(-kd)), following the Gerstner surface as it leans and travels. Waves short against the
  hull cancel along its length, so a ship plows through chop and rides the swell.
- Buoyancy is one-sided and acts at the centre of the submerged volume, including the flared topsides and the
  deckhouse: the righting arm peaks near 40° and vanishes near 72°, like a destroyer's.
- Radiation damping and quadratic drag act on the hull's motion relative to the water surface under it, and
  added mass (only while wet) both resists the hull and carries it with the water's acceleration.
- Rotation is about the centre of gravity; heading (steering) and tilt (pitch, roll) are integrated separately.
- **Mass slider = Froude scaling.** Steadiness in a seaway comes from size relative to the waves, so the hull is
  scaled by s = (M / 2,900 t)^(1/3): lengths and draft x s, mass x s³, inertia x s⁵, natural periods x √s.
  Calm-water roll periods: football 0.58 s, Fletcher 8.0 s, 2x Nimitz 16.2 s. Small hulls are drag-dominated
  and ride every wave; in very steep seas a hull under ~5 t can capsize, and a game assist rights it after 1.5 s.
- The macro swell runs at deep-water speed for its wavelength (ω = √(gk)).

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

## License
Fletcher © 2026 [da2v99](https://github.com/da2v99), licensed under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to share and modify for
non-commercial use with credit to da2v99. Commercial use is not allowed without permission.
See [LICENSE](LICENSE).
