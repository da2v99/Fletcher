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

// Colors (Measure 22)
const HAZE_GRAY = 0x7a828a;  // 5-H
const NAVY_BLUE = 0x323e4b;  // 5-N
const DECK_BLUE = 0x2c343d;  // 20-B
const HULL_RED = 0x5a1c16;
const BRASS = 0x9a7d3a;

let shipGroup;   // the player ship's scene group
let MAT;         // shared ship materials
