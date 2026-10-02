// The visible ocean: a radial grid that follows the camera, displaced by SEA_GLSL and the ship's own waves,
// shaded with Fresnel reflections of the volumetric sky, crest glow, whitecaps and the ship's wake.
//
// Three quality levels (Settings.gfx.ocean):
//   2 — the full surface evaluated per pixel: normals from the exact displaced surface, colour height per pixel
//   1 — surface, normal and colour height per vertex on a lighter grid, plus per-pixel ripples
//   0 — like 1 on a coarser grid with a shorter wake; small enough for phone GPUs and WebGL1's uniform limits
// The two lighter levels keep the per-pixel shader free of the wave arrays, which is what phones choke on.

const WAKE_SPAN = 48;   // seconds of stern track drawn as wake
const wakeTrail = [];   // stern track, newest first: {x, z, t, s (speed 0..1), odo}
let trailU = [], trailOdo = [], trailN = 48;
let sternOdo = 0, lastStern = null;

function resetWake() {
    wakeTrail.length = 0;
    trailU.forEach(v => v.set(0, 0, -1, 0));
    lastStern = null;
}

const OCEAN_GRID = [
    { seg: 160, dr0: 1.0, near: 30, grow: 1.04 },     // 0: ~32k vertices
    { seg: 256, dr0: 0.6, near: 40, grow: 1.03 },     // 1: ~77k
    { seg: 384, dr0: 0.5, near: 40, grow: 1.022 }     // 2: ~150k
];
const OCEAN_TRAIL = [12, 24, 48];

// Dense near the camera, stretching to the horizon; y stores the local grid spacing for anti-aliasing
// The sea reaches well past the haze at the chosen view distance
const oceanRadius = () => 22000 * Math.max(1, Settings.gfx.viewDist || 1);

function createOceanGeometry(q) {
    const { seg: SEG, dr0, near, grow } = OCEAN_GRID[q];
    const radii = [0];
    let r = 0, dr = dr0;
    const R = oceanRadius();
    while (r < R) {
        r += dr;
        radii.push(r);
        if (r > near) dr *= grow;
    }
    const pos = new Float32Array(radii.length * SEG * 3);
    let k = 0;
    radii.forEach((rad, i) => {
        const ringDr = i === 0 ? dr0 : rad - radii[i - 1];
        const spacing = Math.max(ringDr, 2 * Math.PI * rad / SEG, dr0);
        for (let s = 0; s < SEG; s++) {
            const a = 2 * Math.PI * s / SEG;
            pos[k++] = Math.cos(a) * rad; pos[k++] = spacing; pos[k++] = Math.sin(a) * rad;
        }
    });
    const nIdx = (radii.length - 1) * SEG * 6;
    const idx = nIdx > 65535 * 6 || radii.length * SEG > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
    k = 0;
    for (let i = 0; i < radii.length - 1; i++) {
        for (let s = 0; s < SEG; s++) {
            const a = i * SEG + s, b = i * SEG + (s + 1) % SEG;
            const c = a + SEG, d = b + SEG;
            idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
}

// Sea-colour uniforms for the per-vertex variants (SEA_GLSL declares them for the full one)
const SEA_COLOR_DECL = `
    uniform vec4 uSeaScale;
    uniform float uNormSpan;
    uniform vec4 uEx3;
    uniform vec3 uDeepC;
    uniform vec3 uPeakC;
    uniform vec2 uWind;
`;

// The wake along the stern track and the foam hugging the hull (shared by every variant)
function wakeGLSL(n) {
    return `
    uniform float uSpeedN;
    uniform vec2 uSternXZ;
    uniform float uSternOdo;
    uniform vec4 uTrail[${n}];
    uniform float uTrailOdo[${n}];
    // out: x = hull foam, y = wake strength, z = wake u (along track), w = wake v (across)
    vec4 shipFoamWake(vec3 world, float hs) {
        vec2 rel = world.xz - uShipXZ;
        float along = dot(rel, uShipFwd);
        float across = abs(dot(rel, vec2(-uShipFwd.y, uShipFwd.x)));
        float shipFoam = 0.0, wake = 0.0, wakeU = 0.0, wakeV = 0.0;
        if (length(rel) < 2500.0) {
            if (uSpeedN > 0.02) {
                float hb = hullHalfWL(along);
                if (hb > 0.0) {
                    float dd = across - hb;
                    float w = 0.4 + uSpeedN * (0.6 + 1.6 * smoothstep(-40.0, 50.0, along));
                    shipFoam = smoothstep(w, 0.0, dd) * step(-1.5, dd) * clamp(uSpeedN * 1.6, 0.0, 1.0);
                }
                float ampS = max(uSpeed * uSpeed / 9.81 * 0.05, 0.15);
                shipFoam = max(shipFoam, smoothstep(0.35, 0.85, hs / ampS) * smoothstep(3.0, 8.0, uSpeed));
            }
            vec2 prev = uSternXZ;
            float prevAge = 0.0, prevSp = uSpeedN, prevOdo = uSternOdo, aftDist = 0.0;
            for (int i = 0; i < ${n}; i++) {
                vec4 tp = uTrail[i];
                if (tp.z < 0.0) break;
                vec2 ab = tp.xy - prev;
                float segLen = length(ab);
                vec2 ap = world.xz - prev;
                float along0 = dot(ap, ab) / max(segLen, 1e-3);
                float h = clamp(along0 / max(segLen, 1e-3), 0.0, 1.0);
                float d = length(ap - ab * h);
                float age = mix(prevAge, tp.z, h);
                float sp = clamp(mix(prevSp, tp.w, h) * 1.4, 0.0, 1.0);
                float w = 5.0 + (aftDist + segLen * h) * 0.02 + age * 0.05;
                float wv = exp(-d * d / (w * w)) * exp(-age / 32.0) * sp;
                if (i == 0) wv *= smoothstep(-8.0, 2.0, along0);
                if (wv > wake) {
                    wake = wv;
                    wakeU = mix(prevOdo, uTrailOdo[i], h);
                    wakeV = d * sign(ab.x * ap.y - ab.y * ap.x) / w;
                }
                prev = tp.xy; prevAge = tp.z; prevSp = tp.w; prevOdo = uTrailOdo[i]; aftDist += segLen;
            }
        }
        return vec4(shipFoam, wake, wakeU, wakeV);
    }`;
}

// Short wind waves and capillaries, for the normal only (shading, not buoyancy): octaves of gradient noise, each
// stretched along its crests and turned to its own heading round the wind, drifting at its own deep-water speed.
// Their strength wanders in big soft patches (cat's paws and slicks), so no two stretches of sea look alike and
// the regular interference pattern of the Gerstner set no longer shows. Each octave fades out once a pixel
// covers too much of its wavelength. Returns the surface slope (dh/dx, dh/dz).
function rippleGLSL(octaves) {
    return `
    vec2 rippleGrad(vec2 i) { float h = hash12(i) * 6.2831853; return vec2(cos(h), sin(h)); }
    // Gradient noise with analytic derivatives: x = value, yz = d/dp
    vec3 gnoised(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
        vec2 ga = rippleGrad(i), gb = rippleGrad(i + vec2(1.0, 0.0)), gc = rippleGrad(i + vec2(0.0, 1.0)), gd = rippleGrad(i + vec2(1.0, 1.0));
        float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0)), vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
        float k = va - vb - vc + vd;
        return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k,
                    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va));
    }
    vec2 seaRipples(vec2 xz, float t, float fp) {
        vec2 wd = uWind, wp = vec2(-uWind.y, uWind.x);
        // Gusts: patches of rougher and glassier water a few hundred metres across, drifting downwind
        vec2 pq = xz - wd * t * 3.0;
        float patchy = vnoise(pq * 0.0045) * 0.6 + vnoise(pq * 0.017 + 7.3) * 0.4;
        float gust = mix(0.3, 1.35, smoothstep(0.22, 0.78, patchy));
        float rough = (0.55 + 0.6 * uSeaScale.w) * (1.0 + 0.6 * uStorm);
        vec2 g = vec2(0.0);
        float lambda = 7.5, ang = 0.0;
        for (int i = 0; i < ${octaves}; i++) {
            float fade = 1.0 - smoothstep(lambda * 0.12, lambda * 0.45, fp);
            if (fade > 0.0) {
                vec2 dir = cos(ang) * wd + sin(ang) * wp, per = vec2(-dir.y, dir.x);
                float k = 6.2831853 / lambda;
                float c = sqrt(9.81 / k);                                   // deep-water phase speed
                vec2 q = vec2(dot(xz, dir) - c * t, dot(xz, per) * 0.42) / lambda + float(i) * vec2(31.7, 17.1);
                vec3 n = gnoised(q);
                // Slope of a height field a·λ·n(q): constant steepness per octave
                g += (n.y * dir + n.z * 0.42 * per) * 0.075 * fade;
            }
            lambda *= 0.53;
            ang += 2.39996 * (0.35 + 0.1 * float(i));                      // golden-angle headings round the wind
        }
        return g * gust * rough;
    }`;
}

// The surface seen from below (underwater.js drives the uniforms): Snell's window, the whole sky squeezed into a
// cone overhead and rippling with the waves, and outside it the dark water reflected back down, all in the murk
const UNDER_U = { uUnder: { value: 0 }, uUnderCol: { value: new THREE.Color(0.02, 0.09, 0.1) }, uUnderDens: { value: 0.05 } };
const UNDER_GLSL = `
    uniform float uUnder;
    uniform vec3 uUnderCol;
    uniform float uUnderDens;
    vec3 underSurface(vec3 world, vec3 N) {
        vec3 V = normalize(world - cameraPosition);
        vec3 T = refract(V, -N, 1.333);
        vec3 col = uUnderCol * 1.4;
        if (dot(T, T) > 0.01) {
            vec3 sky = skyColor(T) + uSunCol * pow(max(dot(T, uSunDir), 0.0), 40.0) * 1.5 * (1.0 - uStorm * 0.8);
            col = mix(col, sky * 0.9, smoothstep(0.0, 0.25, T.y));
        }
        float dist = length(world - cameraPosition);
        return mix(col, uUnderCol, 1.0 - exp(-dist * uUnderDens));
    }
`;

// Colour, light, foam and fog: the example's height-gradient palette lit by our sun and sky
const OCEAN_SHADE_GLSL = `
    uniform samplerCube uSkyCube;
    uniform float uFogDensity;
    uniform sampler2D uReflTex;
    uniform mat4 uReflMat;
    uniform float uReflOn;
    uniform vec4 uSlick[16];
    // Oil and fuel on the water (slicks.js): xy centre, z radius, w how black. Ragged edges from a noise field
    // shared by all of them; sheen is the thin rim where the film shows colours
    float slickAt(vec2 xz, out float sheen) {
        sheen = 0.0;
        if (uSlick[0].z <= 0.0) return 0.0;
        float n = vnoise(xz * 0.016) * 0.6 + vnoise(xz * 0.065 + 3.7) * 0.4;
        float s = 0.0;
        for (int i = 0; i < 16; i++) {
            vec4 k = uSlick[i];
            if (k.z <= 0.0) break;
            float r = length(xz - k.xy) / k.z;
            if (r > 1.7) continue;
            float e = r + (n - 0.5) * 1.1;
            s = max(s, (1.0 - smoothstep(0.35, 0.95, e)) * k.w);
            sheen = max(sheen, (smoothstep(0.3, 0.8, e) - smoothstep(0.85, 1.25, e)) * k.w);
        }
        return s;
    }
    vec3 shadeSea(vec3 world, vec2 p0, vec3 N, float colorH, vec4 fw, float shore) {
        float dist = length(cameraPosition - world);
        float sheen, oil = slickAt(world.xz, sheen);
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), oil * 0.75));   // the film damps the ripples: glassy
        float hNorm = clamp((colorH + uNormSpan * 0.5) / uNormSpan, 0.0, 1.0);
        hNorm = 0.5 + (hNorm - 0.5) * uSeaScale.w;
        float colorMix = pow(hNorm, uEx3.x);
        float light = mix(0.4, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.3 * uStorm) * (1.0 - 0.8 * nightF());
        vec3 deepC = mix(uDeepC, vec3(0.035, 0.07, 0.095), uStorm * 0.85);
        vec3 peakC = mix(uPeakC, vec3(0.24, 0.36, 0.40), uStorm * 0.85);
        vec3 base = mix(deepC, peakC, colorMix);
        float peakFoam = hNorm > uEx3.y ? pow((hNorm - uEx3.y) / max(1.0 - uEx3.y, 1e-3), 2.0) : 0.0;
        base += vec3(peakFoam) * 0.85;

        // Light it: sun on the slopes, sky reflection at grazing angles, sun glitter
        vec3 V = normalize(cameraPosition - world);
        vec3 L = uSunDir;
        vec3 col = base * light * (0.72 + 0.4 * max(dot(N, L), 0.0));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = textureCube(uSkyCube, R).rgb;
        if (uReflOn > 0.5) {
            // Planar reflection (reflect.js): the mirrored world, rippled by the wave normals; the sky cube
            // fills in where the ripples reach past the edge of the mirrored view
            vec4 rp = uReflMat * vec4(world, 1.0);
            vec2 ruv = rp.xy / rp.w + N.xz * 0.05;
            vec2 edge = smoothstep(0.0, 0.04, ruv) * smoothstep(1.0, 0.96, ruv);
            refl = mix(refl, texture2D(uReflTex, clamp(ruv, 0.002, 0.998)).rgb, edge.x * edge.y);
        }
        refl += vec3(0.75, 0.8, 1.0) * uFlash * 0.6;
        col = mix(col, refl, fres * mix(0.55, 0.78, uReflOn));
        vec3 Hs = normalize(L + V);
        float nh = max(dot(N, Hs), 0.0);
        col += uSunCol * (pow(nh, 700.0) * 1.6 + pow(nh, 80.0) * 0.1) * (1.0 - 0.85 * uStorm) * smoothstep(-0.02, 0.05, uSunDir.y);

        // Oil: black film over the water's own colour (the glassy reflection stays), a rainbow at the thin rim
        if (oil + sheen > 0.0) {
            col = mix(col, vec3(0.014, 0.012, 0.01) * light + refl * fres * 0.4, oil * 0.92);
            vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + world.x * 0.011 + world.z * 0.008 + dot(N, V) * 2.0));
            col += rainbow * sheen * 0.07 * light;
        }

        // Ship foam, the wake, and storm streaks on top
        float worldTex = smoothstep(0.3, 0.62, fbm3(p0 * 0.6) + 0.15);
        float wakeTex = smoothstep(0.3, 0.62, fbm3(vec2(fw.z * 0.3, fw.w * 2.6)) + 0.12 + 0.25 * fw.y);
        float streak = uStorm * smoothstep(0.62, 0.8, fbm3(vec2(dot(p0, uWind) * 0.05, dot(p0, vec2(-uWind.y, uWind.x)) * 0.6) + uTime * 0.02));
        float foam = clamp(max(streak * 0.45, max(fw.x * worldTex, fw.y * wakeTex)), 0.0, 1.0);
        col = mix(col, vec3(0.88, 0.92, 0.94) * light * (0.6 + 0.4 * max(dot(N, L), 0.0)), foam * 0.92 * (1.0 - oil * 0.7));
        col += vec3(0.02, 0.12, 0.13) * fw.y * light;
        col += islandShallows(world.xz, dist, shore) * light;

        float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
        return mix(col, skyColor(normalize(vec3(-V.x, 0.015, -V.z))), fogF);
    }
`;

// Turquoise shallows and reefs around the islands (blobs: xy = centre, z = radius; filled in by islands.js; the
// surf itself is a strip along the real coastline, islands.js).
// The light ocean levels find the shore distance per vertex, keeping the blob array out of the pixel shader.
const ISLAND_BLOBS = 24;
const islandBlobU = Array.from({ length: ISLAND_BLOBS }, () => new THREE.Vector3(0, 0, 0));
const ISLAND_DECL = `
    uniform vec3 uIsland[${ISLAND_BLOBS}];
    float islandShore(vec2 xz) {
        float shore = 1e5;
        for (int i = 0; i < ${ISLAND_BLOBS}; i++) {
            vec3 b = uIsland[i];
            if (b.z <= 0.0) break;
            shore = min(shore, length(xz - b.xy) - b.z);
        }
        return shore;
    }
`;
const ISLAND_SHADE = `
    vec3 islandShallows(vec2 xz, float dist, float shore) {
        if (shore > 400.0) return vec3(0.0);
        float shallow = 1.0 - smoothstep(-40.0, 280.0, shore);
        float reef = smoothstep(0.45, 0.75, vnoise(xz * 0.012)) * (1.0 - smoothstep(0.0, 160.0, abs(shore - 60.0)));
        return vec3(0.0, 0.17, 0.14) * shallow + vec3(0.03, 0.08, 0.05) * reef;
    }
`;

function oceanShaders(q) {
    const nT = OCEAN_TRAIL[q];
    if (q === 2) {
        return {
            vertexShader: SEA_GLSL + SHIPWAVE_GLSL + `
                uniform float uTime;
                uniform vec2 uCenter;
                varying vec3 vWorld;
                varying vec2 vXZ0;
                void main() {
                    vec2 p0 = position.xz + uCenter;
                    float sp = position.y;
                    vWorld = seaSurface(p0, uTime, sp);
                    vWorld.y += shipWaves(p0, sp);
                    vXZ0 = p0;
                    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
                }`,
            fragmentShader: NOISE_GLSL + SKY_GLSL + SEA_GLSL + SHIPWAVE_GLSL + ISLAND_DECL + ISLAND_SHADE + wakeGLSL(nT) + rippleGLSL(5) + UNDER_GLSL + OCEAN_SHADE_GLSL + `
                varying vec3 vWorld;
                varying vec2 vXZ0;
                void main() {
                    vec2 p0 = vXZ0;
                    float fp = length(fwidth(p0));   // metres per pixel
                    // Surface normal from the exact displaced surface (finite differences over the grid point)
                    float e = max(0.35, fp * 0.7);
                    vec3 P0 = seaSurface(p0, uTime, fp);
                    vec3 tx = seaSurface(p0 + vec2(e, 0.0), uTime, fp) - P0;
                    vec3 tz = seaSurface(p0 + vec2(0.0, e), uTime, fp) - P0;
                    float hs = shipWaves(p0, fp);
                    if (uSpeed > 0.5) {
                        tx.y += shipWaves(p0 + vec2(e, 0.0), fp) - hs;
                        tz.y += shipWaves(p0 + vec2(0.0, e), fp) - hs;
                    }
                    vec3 N = normalize(cross(tz, tx));
                    vec2 rg = seaRipples(vWorld.xz, uTime, fp);
                    N = normalize(N + vec3(-rg.x, 0.0, -rg.y) * N.y);
                    if (!gl_FrontFacing) { gl_FragColor = vec4(underSurface(vWorld, N), 1.0); return; }
                    vec4 fw = shipFoamWake(vWorld, hs);
                    gl_FragColor = vec4(shadeSea(vWorld, p0, N, seaColorHeight(p0, uTime), fw, islandShore(vWorld.xz)), 1.0);
                }`
        };
    }
    return {
        vertexShader: SEA_GLSL + SHIPWAVE_GLSL + ISLAND_DECL + `
            uniform float uTime;
            uniform vec2 uCenter;
            varying vec3 vWorld;
            varying vec2 vXZ0;
            varying vec3 vN;
            varying float vHC;
            varying float vHS;
            varying float vShore;
            void main() {
                vec2 p0 = position.xz + uCenter;
                float sp = position.y;
                vec3 P = seaSurface(p0, uTime, sp);
                float e = max(0.6, sp * 0.75);
                vec3 tx = seaSurface(p0 + vec2(e, 0.0), uTime, sp) - P;
                vec3 tz = seaSurface(p0 + vec2(0.0, e), uTime, sp) - P;
                float hs = shipWaves(p0, sp);
                if (uSpeed > 0.5) {
                    tx.y += shipWaves(p0 + vec2(e, 0.0), sp) - hs;
                    tz.y += shipWaves(p0 + vec2(0.0, e), sp) - hs;
                }
                P.y += hs;
                vN = normalize(cross(tz, tx));
                vHC = seaColorHeight(p0, uTime);
                vHS = hs;
                vWorld = P;
                vXZ0 = p0;
                vShore = islandShore(P.xz);
                gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
            }`,
        fragmentShader: NOISE_GLSL + SKY_GLSL + SEA_COLOR_DECL + SHIPWAVE_GLSL + ISLAND_SHADE + wakeGLSL(nT) + rippleGLSL(q === 1 ? 4 : 3) + UNDER_GLSL + OCEAN_SHADE_GLSL + `
            varying vec3 vWorld;
            varying vec2 vXZ0;
            varying vec3 vN;
            varying float vHC;
            varying float vHS;
            varying float vShore;
            void main() {
                vec3 N = normalize(vN);
                // Per-pixel wind waves and ripples on top of the per-vertex surface
                vec2 rg = seaRipples(vWorld.xz, uTime, length(fwidth(vXZ0)));
                N = normalize(N + vec3(-rg.x, 0.0, -rg.y) * N.y);
                if (!gl_FrontFacing) { gl_FragColor = vec4(underSurface(vWorld, N), 1.0); return; }
                vec4 fw = shipFoamWake(vWorld, vHS);
                gl_FragColor = vec4(shadeSea(vWorld, vXZ0, N, vHC, fw, vShore), 1.0);
            }`
    };
}

let oceanQ = -1;
function createOcean(skyCube, q = Settings.gfx.ocean) {
    oceanQ = q;
    trailN = OCEAN_TRAIL[q];
    trailU = Array.from({ length: trailN }, () => new THREE.Vector4(0, 0, -1, 0));
    trailOdo = new Array(trailN).fill(0);
    const uniforms = Object.assign({
        uCenter: { value: new THREE.Vector2() },
        uSkyCube: { value: skyCube },
        uShipXZ: { value: new THREE.Vector2() },
        uShipFwd: { value: new THREE.Vector2(0, 1) },
        uSpeed: { value: 0 },
        uSpeedN: { value: 0 },
        uSternXZ: { value: new THREE.Vector2() },
        uSternOdo: { value: 0 },
        uTrail: { value: trailU },
        uTrailOdo: { value: trailOdo },
        uIsland: { value: islandBlobU }
    }, SEA_U, WEATHER_U, UNDER_U, REFL_U, SLICK_U);
    const mat = new THREE.ShaderMaterial(Object.assign({ uniforms, extensions: { derivatives: true } }, oceanShaders(q)));
    const mesh = new THREE.Mesh(createOceanGeometry(q), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;   // after the boats' water masks (person.js), so no sea shows inside an open boat
    mesh.userData.quality = q;
    mesh.userData.radius = oceanRadius();
    return mesh;
}

// Rebuild the ocean at another quality level (settings change, or the device couldn't compile this one)
function rebuildOcean(q) {
    const vis = ocean ? ocean.visible : true;
    const sky = ocean ? ocean.material.uniforms.uSkyCube.value : Clouds.texture;
    if (ocean) {
        scene.remove(ocean);
        ocean.geometry.dispose();
        ocean.material.dispose();
    }
    ocean = createOcean(sky, q);
    ocean.visible = vis;
    scene.add(ocean);
    resetWake();
}

// Per-frame: stern track for the wake, ship pose for the ship-generated waves, camera-centred grid
const _ofwd = new THREE.Vector3(), _osw = new THREE.Vector3(), _ofh = new THREE.Vector2(), _ost = new THREE.Vector2();
function updateOcean(ocean, t, shipPos, shipQuat, shipVel) {
    const U = ocean.material.uniforms;
    const fwd = _ofwd.set(0, 0, 1).applyQuaternion(shipQuat);
    const fwdH = _ofh.set(fwd.x, fwd.z).normalize();
    const u = Math.max(0, shipVel.dot(fwd));

    const sternW = _osw.set(0, 0, -55).applyQuaternion(shipQuat).add(shipPos);
    const stern = _ost.set(sternW.x, sternW.z);
    if (lastStern) sternOdo += stern.distanceTo(lastStern);
    lastStern = lastStern ? lastStern.copy(stern) : stern.clone();
    const step = WAKE_SPAN / trailN;
    if (!wakeTrail.length || t - wakeTrail[0].t > step) {
        wakeTrail.unshift({ x: stern.x, z: stern.y, t, s: u / V_MAX, odo: sternOdo });
        if (wakeTrail.length > trailN) wakeTrail.length = trailN;
    }
    for (let i = 0; i < trailN; i++) {
        const p = wakeTrail[i];
        if (p) trailU[i].set(p.x, p.z, t - p.t, p.s); else trailU[i].set(0, 0, -1, 0);
        trailOdo[i] = p ? p.odo : 0;
    }

    U.uShipXZ.value.set(shipPos.x, shipPos.z);
    U.uShipFwd.value.copy(fwdH);
    U.uSternXZ.value.copy(stern);
    U.uSternOdo.value = sternOdo;
    U.uSpeedN.value = u / V_MAX;
    U.uSpeed.value = u;
    U.uCenter.value.set(camera.position.x, camera.position.z);
}
