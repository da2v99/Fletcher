// Ship dimensions and Measure 22 paint colours for USS Fletcher (DD-445).

// --- Configuration & Constants ---
// Ship-local frame: +Z = bow, +Y = up, Y = 0 is the design waterline, -X = starboard.
const SHIP_LENGTH = 114.7;   // LOA 376' 6"
const SHIP_BEAM = 12.1;      // 39' 7"
const HALF_L = SHIP_LENGTH / 2;
const HALF_B = SHIP_BEAM / 2;
const KEEL_Y = -4.1;         // mean draft 13' 6"
const LVL1_H = 2.45;         // 01 level height above main deck
const HULL_NUMBER = '445';

// Colors (Measure 22). Approximations of the 1941-45 BuShips standards: 5-N and 5-H are distinctly blue-tinted
// greys rather than true navy and neutral grey, and 20-B is a dark slate blue for every horizontal surface.
const HAZE_GRAY = 0x868e97;  // 5-H  (Munsell ~5PB 5.5/1.5)
const NAVY_BLUE = 0x48535f;  // 5-N  (Munsell ~5PB 3.3/2)
const DECK_BLUE = 0x3a424c;  // 20-B (Munsell ~5PB 2.7/1.8)
const HULL_RED = 0x6a2a20;   // anti-fouling red-brown
const BRASS = 0x9a7d3a;

let shipGroup;   // the player ship's scene group
let MAT;         // shared ship materials
