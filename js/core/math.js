// Scalar helpers used everywhere. Loaded before every other game script.

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(e0, e1, x) { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
const rnd = (a, b) => a + Math.random() * (b - a);
function randn() { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15; }
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const stepToward = (cur, target, maxStep) => cur + Math.max(-maxStep, Math.min(maxStep, target - cur));
const fract = v => v - Math.floor(v);
const DEG = Math.PI / 180;

// Compass bearing (0 = north = +Z, clockwise, east = -X) of a world-space XZ direction
const compassDeg = (dx, dz) => ((Math.atan2(-dx, dz) / DEG) % 360 + 360) % 360;
const fmt3 = deg => String(Math.round(deg) % 360).padStart(3, '0');
