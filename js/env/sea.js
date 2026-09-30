// Ocean surface model: the wave functions from "Waves and Clouds" (waveMath.js / shaders.js), mapped into
// real-world metres, and evaluated identically on the GPU (rendering) and the CPU (buoyancy, shells, camera).
//
// The example's sea lives in its own "example units": 16 Gerstner waves stepped by the golden ratio and golden
// angle, the warped chop / ripple / ridge detail layer, and the macro swell. We map it into the world with:
//   horizontal: 1 example unit = S metres    (auto: peak wavelength follows the wave height, or set by hand)
//   vertical:   1 example unit = V metres    (calibrated so the significant wave height Hs is what you ask for)
//   time:       example time   = t * T       (speed 5 = real deep-water wave speed)
// Every parameter in SeaParams is live: change it, call buildSea(), and the GPU and CPU both follow.

const GRAVITY = 9.81;
const WAVE_COUNT = 16;
const GOLDEN_RATIO = 1.61803398875, GOLDEN_ANGLE = 2.39996323;

const SEA_DEFAULTS = {
    // World mapping
    hs: 1.7,               // significant wave height, metres
    autoScale: false,      // tie the wavelength scale to the wave height
    scale: 0.02,           // metres per example unit when autoScale is off (14 m peak wavelength)
    // Example: Gerstner set
    spread: 0.155, steepness: 2.0, medAmplitude: 10.5, medWavelength: 700, speed: 5.0, windDir: 34,
    // Example: detail layer
    sharp: 0.0, chop: 0.0, ripple: 0.0, asym: 1.0,
    // Example: macro swell
    macroOn: true, macroHeight: 100, macroSize: 0.07,
    // Ship mass slider: 0 = a football, 0.5 = the real Fletcher, 1 = two Nimitz-class carriers (shipPhysics.js)
    massPos: 0.5,
    // Example: colouring
    foam: 0.52, colorSpan: 0.45, depthBias: 1.4, deep: '#001e41', peak: '#0082ff'
};
const SeaParams = Object.assign({}, SEA_DEFAULTS);

const Sea = {
    hs: 0, S: 0.2, V: 0.03, T: 0.4, macroT: 1, maxAmp: 0, detailMean: 0,
    waves: [],
    u1: Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4()),   // dir.x, dir.z, w, A      (example units)
    u2: Array.from({ length: WAVE_COUNT }, () => new THREE.Vector4()),   // phase speed, Q*A, -, -
    scale: new THREE.Vector4(),                                          // S, V, T, colour contrast
    wind: new THREE.Vector2(1, 0)
};

const SEA_U = {
    uW1: { value: Sea.u1 },
    uW2: { value: Sea.u2 },
    uSeaScale: { value: Sea.scale },
    uWind: { value: Sea.wind },
    uNormSpan: { value: 1 },
    uEx1: { value: new THREE.Vector4() },   // sharp, chop, ripple, asym
    uEx2: { value: new THREE.Vector4() },   // speed, macro height (0 = off), macro size, detail mean
    uEx3: { value: new THREE.Vector4() },   // depth bias, foam threshold, -, -
    uDeepC: { value: new THREE.Color() },
    uPeakC: { value: new THREE.Color() }
};

// Weather slider -> wave height (m): calm glass to a gale
const seaHsForStorm = storm => 2.2 * Math.pow(0.7 + storm * 0.85, 1.9);

function buildSea() {
    const P = SeaParams;
    const hs = Math.max(0, P.hs);
    Sea.hs = hs;
    const windRad = P.windDir * DEG;
    Sea.wind.set(Math.cos(windRad), Math.sin(windRad));

    // The example's 16 Gerstner waves (updateGerstnerWaves)
    Sea.waves.length = 0;
    let sumA = 0, sumA2 = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
        const l = P.medWavelength * Math.pow(GOLDEN_RATIO, (i - WAVE_COUNT / 2) * 0.25);
        const w = 2 * Math.PI / l;
        const a = l * (P.medAmplitude / P.medWavelength);
        const phi = P.speed * Math.sqrt(9.8 * w);
        const ang = windRad + i * GOLDEN_ANGLE * P.spread;
        const q = P.steepness / (w * a * WAVE_COUNT);
        const wave = { dx: Math.cos(ang), dz: Math.sin(ang), w, A: a, phi, QA: q * a };
        Sea.waves.push(wave);
        Sea.u1[i].set(wave.dx, wave.dz, w, a);
        Sea.u2[i].set(phi, wave.QA, 0, 0);
        sumA += a;
        sumA2 += a * a;
    }

    // World mapping: V makes 4·sd(Gerstner) = Hs (independent sines: sd = sqrt(ΣA²/2)), S sets the wavelength
    const gerstnerSd = Math.sqrt(sumA2 / 2);
    Sea.S = P.autoScale ? (12 + 22 * hs) / P.medWavelength : Math.max(0.01, P.scale);
    if (P.autoScale) P.scale = Sea.S;
    Sea.V = gerstnerSd > 0 ? (hs / 4) / gerstnerSd : 0;
    Sea.T = 1 / (5 * Math.sqrt(Sea.S));
    Sea.scale.set(Sea.S, Sea.V, Sea.T, THREE.MathUtils.clamp(hs / 2, 0.15, 1));
    // Macro swell clock: the example runs it as fast as the short waves, which makes a 500 m swell rise and
    // fall every few seconds (the whole sea pumping, and the ship with it). Slow it to deep-water dispersion,
    // ω = √(gk) for its main component, so at speed 5 it moves like a real swell of that length.
    const kMacro = 0.002 * Math.max(P.macroSize, 1e-3) * GOLDEN_RATIO / Sea.S;
    Sea.macroT = Math.sqrt(GRAVITY * kMacro) / (0.15 * 5 * Sea.T);

    // Detail layer's mean level (removed so mean sea level stays at 0); depends on the detail settings
    let mean = 0;
    for (let j = 0; j < 3000; j++) mean += exDetailRaw(fract(j * 0.6180339) * 40000 - 20000, fract(j * 0.7548777) * 40000 - 20000, j * 0.37);
    Sea.detailMean = mean / 3000;

    SEA_U.uEx1.value.set(P.sharp, P.chop, P.ripple, P.asym);
    SEA_U.uEx2.value.set(P.speed, P.macroOn ? P.macroHeight : 0, P.macroSize, Sea.detailMean);
    SEA_U.uEx3.value.set(P.depthBias, P.foam, Sea.macroT, 0);
    SEA_U.uDeepC.value.set(P.deep);
    SEA_U.uPeakC.value.set(P.peak);

    // Colour normalisation exactly as in the example's main.js
    const ridgeMaxAmp = 14 + 14 * 0.6 * P.asym;
    const detailAmp = (P.chop * 3.4 + P.ripple * 1.5 + ridgeMaxAmp) * P.asym;
    const macroColorAmp = P.macroOn ? P.macroHeight * 1.5 * 0.5 : 0;
    SEA_U.uNormSpan.value = Math.max(1e-3, (sumA + detailAmp + macroColorAmp) * 2 * P.colorSpan);

    Sea.maxAmp = (sumA + detailAmp + (P.macroOn ? P.macroHeight * 1.5 : 0)) * Sea.V;
}

// ---------------------------------------------------------------- CPU evaluation (mirrors SEA_GLSL exactly)

function exMacro(x, z, t) {
    const P = SeaParams;
    if (!P.macroOn) return 0;
    const f = 0.002 * P.macroSize, phi = GOLDEN_RATIO, sp = P.speed;
    t *= Sea.macroT;
    const m1 = Math.sin(x * f * phi + t * 0.15 * sp) * Math.cos(z * f * phi * phi - t * 0.12 * sp);
    const m2 = Math.sin((x - z) * f * phi * phi * phi + t * 0.1 * sp);
    return (m1 + m2 * 0.5) * P.macroHeight;
}

function exDetailRaw(x, z, t) {
    const P = SeaParams;
    const sp = P.speed * 0.5, sharp = P.sharp, chop = P.chop, ripple = P.ripple, asym = P.asym;
    const chopSharp = Math.max(sharp * 0.8, 0.4);
    // pow() bases are floored above zero: asymmetry > 1.67 pushes |w3b| past 1, and pow(0, 0) is NaN on GPUs
    const w3 = Math.sin(x * 0.08 + t * 1.2 * sp) * Math.cos(z * 0.08 - t * 1.0 * sp);
    const w3b = Math.sin((x * 0.7 - z * 0.7) * 0.09 + t * 1.4 * sp) * 0.6 * asym;
    const h3 = Math.pow(Math.max(1 - Math.abs(w3), 1e-5), chopSharp) * chop;
    const h3b = Math.pow(Math.max(1 - Math.abs(w3b), 1e-5), chopSharp) * chop * 0.4;
    const h4 = Math.sin(x * 0.2 - t * 2.0 * sp) * ripple;
    const h4b = Math.sin((x * 0.15 + z * 0.25) + t * 1.7 * sp) * ripple * 0.5 * asym;
    const warpStr = 25 * asym;
    const warpX = Math.sin(z * 0.004 + t * 0.15 * sp) * warpStr;
    const warpY = Math.cos(x * 0.005 + t * 0.12 * sp) * warpStr * 0.85;
    const h5 = Math.sin((x + warpX) * 0.02 + t * 0.5 * sp) * Math.cos((z + warpY) * 0.018 - t * 0.35 * sp) * (chop * 2) * asym;
    const warpStr2 = 40 * asym;
    const wx = Math.sin(z * 0.003 - t * 0.1 * sp) * warpStr2;
    const wy = Math.cos(x * 0.003 + t * 0.1 * sp) * warpStr2;
    const w2a = Math.sin((x + wx) * 0.023 - t * 0.8 * sp + (z + wy) * 0.015);
    const w2b = Math.sin(((x + wx) * 0.5 + (z + wy) * 0.87) * 0.019 + t * 0.6 * sp);
    const modA = Math.sin((x - z) * 0.004 + t * 0.2) * 0.5 + 0.5;
    const modB = Math.cos((x + z) * 0.005 - t * 0.2) * 0.5 + 0.5;
    const hRidge1 = Math.pow(Math.max(1 - Math.abs(w2a), 1e-5), sharp) * 14 * modA;
    const hRidge2 = Math.pow(Math.max(1 - Math.abs(w2b), 1e-5), sharp) * 14 * 0.6 * asym * modB;
    return h3 + h3b + h4 + h4b + h5 + hRidge1 + hRidge2;
}

// Gerstner + macro displacement in metres at undisplaced world point (x, z)
const _sd = { x: 0, y: 0, z: 0 };
function seaDisplace(x, z, t) {
    const S = Sea.S, V = Sea.V, te = t * Sea.T;
    const px = x / S, pz = z / S;
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < Sea.waves.length; i++) {
        const w = Sea.waves[i];
        const inner = w.w * (w.dx * px + w.dz * pz) + w.phi * te;
        const c = Math.cos(inner);
        dx += w.QA * w.dx * c;
        dz += w.QA * w.dz * c;
        dy += w.A * Math.sin(inner);
    }
    _sd.x = dx * V; _sd.z = dz * V;
    _sd.y = (dy + exMacro(px, pz, te)) * V;
    return _sd;
}

// Detail layer in metres, evaluated at the displaced (world) position like the example does
const seaDetail = (x, z, t) => (exDetailRaw(x / Sea.S, z / Sea.S, t * Sea.T) - Sea.detailMean) * Sea.V;

// Height of the sea surface at world (x, z): invert the horizontal Gerstner motion to find the grid point under it
function waterHeight(x, z, t) {
    let x0 = x, z0 = z;
    for (let i = 0; i < 4; i++) {
        const d = seaDisplace(x0, z0, t);
        x0 = x - d.x;
        z0 = z - d.z;
    }
    return seaDisplace(x0, z0, t).y + seaDetail(x, z, t);
}

// Sea level felt by a patch of hull (len metres along the ship's heading (fx, fz), wid across, pressure taken
// at depth metres below the surface) for buoyancy:
//  - Pressure acts over the whole patch, so each wave is box-filtered by sinc(k·len/2)·sinc(k·wid/2). Waves
//    much shorter than the patch average out instead of being point-sampled (which aliases them into kicks).
//  - Wave pressure decays as e^(-k·d) below the surface (the Smith effect): a deep keel barely feels short waves.
//  - The filtered surface is still a Gerstner surface, so its crests lean and travel sideways: invert that
//    horizontal motion to find the surface actually over (x, z), as waterHeight() does.
//  - The small-scale detail layer (chop, ridges: a few metres across) only reaches small, shallow patches.
// A tiny patch at zero depth gives exactly waterHeight(); a big deep one gives the smooth swell a ship rides.
// Also leaves, in seaPatchKin and straight from the wave equations (same filtering): v, the rate the surface
// rises at this fixed spot; gx, gz, its slope (so a hull moving at U sees it rise at v + U·g); and a, the water's
// vertical acceleration. Hydrodynamic damping and added mass act against these.
const sinc = u => Math.abs(u) < 1e-4 ? 1 : Math.sin(u) / u;
const _pr = new Float64Array(WAVE_COUNT);
const seaPatchKin = { v: 0, a: 0, gx: 0, gz: 0 };
function seaPatchHeight(x, z, t, fx, fz, len, wid, depth = 0) {
    const S = Sea.S, V = Sea.V, te = t * Sea.T, waves = Sea.waves, n = waves.length;
    for (let i = 0; i < n; i++) {
        const w = waves[i], k = w.w / S;   // rad per metre
        _pr[i] = sinc(k * (w.dx * fx + w.dz * fz) * len / 2) * sinc(k * (w.dx * fz - w.dz * fx) * wid / 2) * Math.exp(-k * depth);
    }
    let x0 = x, z0 = z;
    for (let it = 0; it < 4; it++) {
        const px = x0 / S, pz = z0 / S;
        let dx = 0, dz = 0;
        for (let i = 0; i < n; i++) {
            const w = waves[i];
            const c = Math.cos(w.w * (w.dx * px + w.dz * pz) + w.phi * te) * w.QA * _pr[i];
            dx += w.dx * c;
            dz += w.dz * c;
        }
        // Relaxed fixed-point step: steep (Q > 1) seas fold over and plain iteration can oscillate
        x0 += 0.8 * (x - dx * V - x0);
        z0 += 0.8 * (z - dz * V - z0);
    }
    const px = x0 / S, pz = z0 / S;
    // Surface point Y(x0, t) carried sideways by D(x0, t): Y, its gradient and rate, D's Jacobian and rate
    let y = 0, yt = 0, ay = 0, yx = 0, yz = 0, dt_x = 0, dt_z = 0, jxx = 0, jxz = 0, jzz = 0;
    for (let i = 0; i < n; i++) {
        const w = waves[i], ar = w.A * _pr[i], qa = w.QA * _pr[i], om = w.phi * Sea.T, km = w.w / S;
        const th = w.w * (w.dx * px + w.dz * pz) + w.phi * te;
        const sn = Math.sin(th), cs = Math.cos(th);
        y += ar * sn;
        yt += ar * om * cs;
        ay -= ar * om * om * sn;
        yx += ar * km * w.dx * cs;
        yz += ar * km * w.dz * cs;
        dt_x -= qa * om * sn * w.dx;
        dt_z -= qa * om * sn * w.dz;
        const jj = -qa * km * sn;
        jxx += jj * w.dx * w.dx; jxz += jj * w.dx * w.dz; jzz += jj * w.dz * w.dz;
    }
    // At a fixed spot the surface is made by different water over time: dη/dt = Y_t - ∇Y·J⁻¹·D_t, and its slope
    // is J⁻ᵀ∇Y, with J = I + ∂D/∂x0 (kept from folding flat where crests overturn)
    const a11 = 1 + jxx * V, a12 = jxz * V, a22 = 1 + jzz * V;
    const det = Math.max(0.25, a11 * a22 - a12 * a12);
    const i11 = a22 / det, i12 = -a12 / det, i22 = a11 / det;
    const ux = -(i11 * dt_x + i12 * dt_z) * V, uz = -(i12 * dt_x + i22 * dt_z) * V;   // dx0/dt, metres per second
    const gx = (i11 * yx + i12 * yz) * V, gz = (i12 * yx + i22 * yz) * V;
    const macroK = 0.002 * SeaParams.macroSize * GOLDEN_RATIO / S, mf = Math.exp(-macroK * depth);
    const m0 = exMacro(px, pz, te);
    const mv = (exMacro(px, pz, te + 1e-3) - m0) / 1e-3 * Sea.T;
    seaPatchKin.v = (yt + mv * mf) * V + (yx * ux + yz * uz) * V;
    seaPatchKin.gx = gx;
    seaPatchKin.gz = gz;
    seaPatchKin.a = ay * V;
    const size = Math.max(len, wid), fd = Math.exp(-size * size / 16 - depth * 0.8);
    return (y + m0 * mf) * V + (fd > 0.005 ? fd * seaDetail(x, z, t) : 0);
}

// ---------------------------------------------------------------- GPU evaluation

const SEA_GLSL = `
    uniform vec4 uW1[${WAVE_COUNT}];
    uniform vec4 uW2[${WAVE_COUNT}];
    uniform vec4 uSeaScale;      // S, V, T, colour contrast
    uniform vec2 uWind;
    uniform float uNormSpan;
    uniform vec4 uEx1;           // sharp, chop, ripple, asym
    uniform vec4 uEx2;           // speed, macro height (0 = off), macro size, detail mean
    uniform vec4 uEx3;           // depth bias, foam threshold, macro swell clock
    uniform vec3 uDeepC;
    uniform vec3 uPeakC;

    float exMacro(vec2 pos, float t) {
        if (uEx2.y <= 0.0) return 0.0;
        float f = 0.002 * uEx2.z, phi = 1.6180339887, sp = uEx2.x;
        t *= uEx3.z;
        float m1 = sin(pos.x * f * phi + t * 0.15 * sp) * cos(pos.y * f * phi * phi - t * 0.12 * sp);
        float m2 = sin((pos.x - pos.y) * f * phi * phi * phi + t * 0.1 * sp);
        return (m1 + m2 * 0.5) * uEx2.y;
    }

    float exDetail(vec2 pos, float t) {
        float sp = uEx2.x * 0.5, sharp = uEx1.x, chop = uEx1.y, ripple = uEx1.z, asym = uEx1.w;
        float chopSharp = max(sharp * 0.8, 0.4);
        float w3 = sin(pos.x * 0.08 + t * 1.2 * sp) * cos(pos.y * 0.08 - t * 1.0 * sp);
        float w3b = sin((pos.x * 0.7 - pos.y * 0.7) * 0.09 + t * 1.4 * sp) * 0.6 * asym;
        float h3 = pow(max(1.0 - abs(w3), 1e-5), chopSharp) * chop;
        float h3b = pow(max(1.0 - abs(w3b), 1e-5), chopSharp) * chop * 0.4;
        float h4 = sin(pos.x * 0.2 - t * 2.0 * sp) * ripple;
        float h4b = sin((pos.x * 0.15 + pos.y * 0.25) + t * 1.7 * sp) * ripple * 0.5 * asym;
        float warpStr = 25.0 * asym;
        float warpX = sin(pos.y * 0.004 + t * 0.15 * sp) * warpStr;
        float warpY = cos(pos.x * 0.005 + t * 0.12 * sp) * warpStr * 0.85;
        float h5 = sin((pos.x + warpX) * 0.02 + t * 0.5 * sp) * cos((pos.y + warpY) * 0.018 - t * 0.35 * sp) * (chop * 2.0) * asym;
        float warpStr2 = 40.0 * asym;
        float wx = sin(pos.y * 0.003 - t * 0.1 * sp) * warpStr2;
        float wy = cos(pos.x * 0.003 + t * 0.1 * sp) * warpStr2;
        float w2a = sin((pos.x + wx) * 0.023 - t * 0.8 * sp + (pos.y + wy) * 0.015);
        float w2b = sin(((pos.x + wx) * 0.5 + (pos.y + wy) * 0.87) * 0.019 + t * 0.6 * sp);
        float modA = sin((pos.x - pos.y) * 0.004 + t * 0.2) * 0.5 + 0.5;
        float modB = cos((pos.x + pos.y) * 0.005 - t * 0.2) * 0.5 + 0.5;
        float hRidge1 = pow(max(1.0 - abs(w2a), 1e-5), sharp) * 14.0 * modA;
        float hRidge2 = pow(max(1.0 - abs(w2b), 1e-5), sharp) * 14.0 * 0.6 * asym * modB;
        return h3 + h3b + h4 + h4b + h5 + hRidge1 + hRidge2;
    }

    // Gerstner + macro displacement (metres) at undisplaced point p0; sp = sampling footprint for anti-aliasing
    vec3 seaDisplace(vec2 p0, float t, float sp) {
        float S = uSeaScale.x, V = uSeaScale.y, te = t * uSeaScale.z;
        vec2 pe = p0 / S;
        vec3 d = vec3(0.0);
        for (int i = 0; i < ${WAVE_COUNT}; i++) {
            float w = uW1[i].z;
            float fade = smoothstep(2.5 * sp, 6.0 * sp, 6.2831853 / w * S);
            float inner = w * dot(uW1[i].xy, pe) + uW2[i].x * te;
            d.xz += uW1[i].xy * uW2[i].y * cos(inner) * fade;
            d.y += uW1[i].w * sin(inner) * fade;
        }
        d.y += exMacro(pe, te);
        return d * V;
    }

    // Detail layer (metres) at a displaced world position, faded where the sampling can't resolve it
    float seaDetail(vec2 p, float t, float sp) {
        float S = uSeaScale.x;
        float fade = smoothstep(2.5 * sp, 6.0 * sp, 30.0 * S);
        return (exDetail(p / S, t * uSeaScale.z) - uEx2.w) * uSeaScale.y * fade;
    }

    // World position of the surface above grid point p0
    vec3 seaSurface(vec2 p0, float t, float sp) {
        vec3 d = seaDisplace(p0, t, sp);
        vec2 xz = p0 + d.xz;
        return vec3(xz.x, d.y + seaDetail(xz, t, sp), xz.y);
    }

    // The example's colour height (example units): Gerstner + detail + half the macro swell
    float seaColorHeight(vec2 p0, float t) {
        float S = uSeaScale.x, te = t * uSeaScale.z;
        vec2 pe = p0 / S;
        float h = 0.0;
        for (int i = 0; i < ${WAVE_COUNT}; i++) h += uW1[i].w * sin(uW1[i].z * dot(uW1[i].xy, pe) + uW2[i].x * te);
        return h + exDetail(pe, te) + exMacro(pe, te) * 0.5;
    }
`;
