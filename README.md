# Fletcher: Destroyer Command

Command USS Fletcher (DD-445) in the Solomons, 1943: Japanese convoys and their escorts, shore batteries on the
islands, and air raids. Plays on desktop and on phones (touch controls, gyro steering).

**Run it:** open `index.html` in a browser (double-click works; no build step). Three.js r128 and fonts load from
CDNs. Or serve the folder: `python -m http.server 8123` and open http://localhost:8123/. On a phone, "Add to Home
Screen" runs it fullscreen.

## Controls
| Key | Action |
|---|---|
| W / S | Step the engine-order telegraph (Back Full … Ahead Flank), 0 = All Stop |
| A / D | Rudder (hold) |
| Mouse | Third-person gun crosshair: the 5"/38s train on whatever is under it (a ship, the shore, the sea, or max range above the horizon) |
| X | Lock what's under the crosshair: a ship, a shore target (gun, AA pit, building, truck) or a plane is tracked with lead; a point of sea or shore stays put. X on the current lock releases it |
| Space | Fire the 5"/38s at the director's target (also left-click in the captain's view). Locked on a plane they fire VT proximity-fuzed shells |
| Left click | Gun-aim camera: the mouse is captured and orbits the camera round the ship, the crosshair sits fixed in the centre (sub-pixel aim). Click / Space fires, right mouse holds a 3× zoom, wheel sets the distance, X locks, Esc frees the mouse |
| Right drag / middle drag / wheel | Orbit / pan / zoom the camera (a drag in chase view switches to orbit) |
| B | Captain's view on the bridge: mouse look, right-click / Z / wheel = binoculars, X locks the target under the reticle |
| G | Man an AA gun (the 40 mm or 20 mm that best covers the nearest plane). Mouse aims, click / Space fires, wheel or right mouse / Z for a little magnification (up to 2×), R: every mount that bears follows your sight and fires with you, Q / E next gun, X locks the plane in your sight for the 5"/38s, G leaves. The AI captain has the conn and the 5"/38s meanwhile |
| V | Step out onto the deck yourself (see On foot below); V again returns to the ship view |
| T | Train out a torpedo mount and fire a 5-torpedo spread |
| Q / E | Move between port wing, open bridge, starboard wing (captain's view) |
| C | Chase / orbit camera (leaves the captain's view or the AA gun) |
| Esc / P | Pause, settings |

**Touch:** a brass engine-order telegraph (drag the lever), a rudder slider or ship's wheel (or tilt the phone),
FIRE (hold), LOCK, TORP, AA and VIEW buttons. Tap a target to lock it, drag to look around, pinch for the
binoculars. On an AA gun: drag (or tilt, with gyro aim on) to aim, hold FIRE, EXIT to leave.

**Settings** (main or pause menu), saved in the browser:
- *Graphics:* presets from Low (phones) to Cinematic, render resolution, dynamic resolution and target frame rate,
  ocean, island, cloud and shadow detail, effects density, and the cinematic pass: bloom, light shafts, sun flare,
  colour grade, vignette, film grain, 2.39:1 letterbox, FXAA or MSAA.
- *Controls:* touch controls on/off, steering (slider, wheel or gyro tilt), gyro aim, sensitivities, left-handed
  layout, button size, vibration, AI gunners on the 40 mm / 20 mm, air raid frequency, telegraph bell.
- *Sea & Weather* and *Sound* as below.

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

## Aiming
All mouse look (binoculars, AA sight, gun-aim camera, on foot) uses pointer lock with raw, unaccelerated mouse
counts where the browser offers them, and is sub-pixel: the mouse moves a target angle and the view eases onto it
within a frame or two, so it glides through every in-between angle rather than stepping a whole count at a time.
Sensitivity scales with the field of view, a little more finely at high magnification, and aim is taken along an
exact ray through the screen centre.

## The AI captain
While you are on an AA gun or on foot, the captain has the conn: closes surface contacts and fights them
broadside on with a weave, combs torpedo tracks, swings hard under diving bombers, keeps off the shoals, and fights
the 5"/38s (your own director lock wins; otherwise the most dangerous target in range, planes boring in first).
Your A / D still override the rudder while held. If you go over the side with no enemy about, the captain comes about for
you and stops (man overboard).

## On foot
**V** puts you on deck (on the bridge if you were in the captain's view). **WASD** walk, **Shift** run, **Space**
jumps or climbs a low wall (deckhouses, the bridge, the open bridge on the pilothouse roof), **mouse** looks, **F**
uses what is in front of you: man the AA gun beside you, take the conn on the bridge, lower the whaleboat at the
starboard davits. Jump the lifelines to go over the side. In the water: **WASD** swim, **C / Ctrl** dive,
**Space** rise (watch your breath), **F** climbs a scramble net back aboard or into the whaleboat; swim to an
island and you wade ashore. In the boat: **W / S** row, **A / D** turn, **Shift** pull hard, **F** over the side.

When she goes down the whaleboat is put in the water. Stay aboard (on deck or on the bridge) and you go down with
her: the light fails as you sink, the murk closes in, air pours out of the hull, she settles on the bottom
(70 m) and the fish come to look; **Space** lets go and you swim for the surface. From the game-over screen,
"Swim for it" puts you in the water beside the wreck with the boat close by. Keyboard and mouse only.

## Destruction
Hits throw wreckage (plate, beams, machinery) that tumbles, trails smoke, splashes, floats and sinks; shell holes
and soot are torn into the hull and deckhouse sides where they struck. Badly hurt enemy warships can have a gun
mount blown clean off, and a ship that blows up throws out a storm of debris.

## Sky
Stars are individual points (about 14,000, with a Milky Way band and its dark rift) drawn at screen resolution,
fading in after sunset, twinkling low down and hidden by cloud; the time slider now runs into full night
(04:24-19:36). The cloud cube is sharper and its texels are filtered away.

## Islands
Volcanic jungle islands and low palm islets, generated from a fixed seed in 8 km sectors and streamed in around the
ship. Each is a height field: shells dig craters and scorch it, trees within a blast fall and burn, and the sea floor
shoals up to the beach, so a ship can run aground (hard groundings tear the bottom open). About two in five have a
Japanese base: two coastal guns that engage you out to 12 km once alerted, 25 mm AA pits and machine-gun pillboxes
firing tracers at close range, barracks, warehouses, fuel tanks that go up in a fireball, a radio mast, a lookout
tower, trucks on the camp road, soldiers who run for cover, and landing barges that flee along the coast. Every third
engagement on patrol is a shore bombardment: silence the battery while a destroyer guards the approaches.

## Air raids and AA
Every few minutes a raid comes in on radar: Aichi D3A "Val" dive bombers push over from ~3,400 m into a 55-60° dive
and release at ~500 m; Nakajima B5N "Kate" torpedo bombers drop Type 91 aerial torpedoes (42 kn, ~2 km run) at about
1,000 m off the beam; Zeros strafe with 20 mm and 7.7 mm. Hard turns throw off the dive bombers; comb the torpedo
tracks. The five twin 40 mm Bofors and six 20 mm Oerlikons are crewed by AI gunners (they lead the target for time of
flight and drop, need a moment to get on, and can't fire into the ship), or take a gun yourself.

## Code layout (`js/`)
| Folder | What lives there |
|---|---|
| `core/` | Ship constants, math helpers, geometry helpers, saved settings and graphics presets |
| `ship/` | The Fletcher model: hull lines, fittings, assembly |
| `env/` | `sea.js` wave model (shared by GPU and CPU), `ocean.js` surface shader, `clouds.js` volumetric sky, `stars.js`, `underwater.js` (murk, fish), `weather.js`, `shipWaves.js` (Kelvin wake) |
| `physics/` | Rigid-body buoyancy and handling, flooding |
| `fx/` | Particles (spray, smoke, fire), debris and hull damage, tracers, synthesised audio, post-processing and the renderer |
| `combat/` | Ballistics and shells, torpedoes, enemy ship models and AI, aircraft and air raids, our 5"/38s, torpedoes and AA battery, the AI captain, damage model |
| `world/` | Islands: terrain, jungle, bases and their garrisons |
| `view/` | Cameras, aiming, the captain's binocular view, and you on foot |
| `ui/` | HUD, SG radar scope, menus, settings panel, touch controls |
| `game.js`, `main.js` | Game flow and the main loop |

Scripts are plain (non-module) files loaded in order by `index.html`, so the game also runs straight from disk.

## The sea
`env/sea.js` uses the wave functions from `../Waves and Clouds` (16 golden-ratio Gerstner waves, the warped chop/ridge
detail layer, the macro swell, and the height-gradient colouring) scaled from the example's units into metres for the
chosen sea state. `waterHeight()` evaluates exactly the same maths on the CPU, so buoyancy, shell splashes and
torpedo depth match the surface you see. On top, for shading only, the ocean shader adds short wind waves and
ripples per pixel: octaves of gradient noise, each stretched along its crests, turned to its own heading round
the wind and drifting at its own deep-water speed, with their strength varying in big soft gust patches, so the
small waves don't repeat.

## License
Fletcher © 2026 [da2v99](https://github.com/da2v99), licensed under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to share and modify for
non-commercial use with credit to da2v99. Commercial use is not allowed without permission.
See [LICENSE](LICENSE).
