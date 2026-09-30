// The visible ocean: a radial grid that follows the camera, displaced by SEA_GLSL and the ship's own waves,
// shaded with Fresnel reflections of the volumetric sky, crest glow, whitecaps and the ship's wake.

const TRAIL_LEN = 48;
const wakeTrail = [];   // stern track: {x, z, t, s (speed 0..1), odo}
const trailU = Array.from({ length: TRAIL_LEN }, () => new THREE.Vector4(0, 0, -1, 0));
const trailOdo = new Array(TRAIL_LEN).fill(0);
let sternOdo = 0, lastStern = null;

function resetWake() {
    wakeTrail.length = 0;
    trailU.forEach(v => v.set(0, 0, -1, 0));
    lastStern = null;
}

// Dense near the camera, stretching to the horizon; y stores the local grid spacing for anti-aliasing
function createOceanGeometry() {
    const SEG = 384;
    const radii = [0];
    let r = 0, dr = 0.5;
    while (r < 22000) {
        r += dr;
        radii.push(r);
        if (r > 40) dr *= 1.022;
    }
    const pos = [], idx = [];
    radii.forEach((rad, i) => {
        const ringDr = i === 0 ? 0.5 : rad - radii[i - 1];
        const spacing = Math.max(ringDr, 2 * Math.PI * rad / SEG, 0.5);
        for (let s = 0; s < SEG; s++) {
            const a = 2 * Math.PI * s / SEG;
            pos.push(Math.cos(a) * rad, spacing, Math.sin(a) * rad);
        }
    });
    for (let i = 0; i < radii.length - 1; i++) {
        for (let s = 0; s < SEG; s++) {
            const a = i * SEG + s, b = i * SEG + (s + 1) % SEG;
            const c = a + SEG, d = b + SEG;
            idx.push(a, b, c, b, d, c);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
}

function createOcean(skyCube) {
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
        uTrailOdo: { value: trailOdo }
    }, SEA_U, WEATHER_U);

    const mat = new THREE.ShaderMaterial({
        uniforms,
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
            }
        `,
        fragmentShader: NOISE_GLSL + SKY_GLSL + SEA_GLSL + SHIPWAVE_GLSL + `
            uniform samplerCube uSkyCube;
            uniform float uSpeedN;
            uniform vec2 uSternXZ;
            uniform float uSternOdo;
            uniform vec4 uTrail[${TRAIL_LEN}];
            uniform float uTrailOdo[${TRAIL_LEN}];
            uniform float uFogDensity;
            varying vec3 vWorld;
            varying vec2 vXZ0;

            void main() {
                vec2 p0 = vXZ0;
                float fp = length(fwidth(p0));   // metres per pixel
                float dist = length(cameraPosition - vWorld);

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

                // --- The ship: foam along the hull, whitecaps on its own waves, turbulent wake along the stern track ---
                vec2 rel = vWorld.xz - uShipXZ;
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
                    for (int i = 0; i < ${TRAIL_LEN}; i++) {
                        vec4 tp = uTrail[i];
                        if (tp.z < 0.0) break;
                        vec2 ab = tp.xy - prev;
                        float segLen = length(ab);
                        vec2 ap = vWorld.xz - prev;
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

                // --- The example's colouring: normalised wave height -> deep-to-peak gradient, foam on the peaks ---
                float hNorm = clamp((seaColorHeight(p0, uTime) + uNormSpan * 0.5) / uNormSpan, 0.0, 1.0);
                hNorm = 0.5 + (hNorm - 0.5) * uSeaScale.w;
                float colorMix = pow(hNorm, uEx3.x);
                float light = mix(0.4, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.3 * uStorm);
                vec3 deepC = mix(uDeepC, vec3(0.035, 0.07, 0.095), uStorm * 0.85);
                vec3 peakC = mix(uPeakC, vec3(0.24, 0.36, 0.40), uStorm * 0.85);
                vec3 base = mix(deepC, peakC, colorMix);
                float peakFoam = hNorm > uEx3.y ? pow((hNorm - uEx3.y) / max(1.0 - uEx3.y, 1e-3), 2.0) : 0.0;
                base += vec3(peakFoam) * 0.85;

                // Light it: sun on the slopes, sky reflection at grazing angles, sun glitter
                vec3 V = normalize(cameraPosition - vWorld);
                vec3 L = uSunDir;
                vec3 col = base * light * (0.72 + 0.4 * max(dot(N, L), 0.0));
                float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
                vec3 R = reflect(-V, N);
                R.y = abs(R.y);
                vec3 refl = textureCube(uSkyCube, R).rgb + vec3(0.75, 0.8, 1.0) * uFlash * 0.6;
                col = mix(col, refl, fres * 0.55);
                vec3 Hs = normalize(L + V);
                float nh = max(dot(N, Hs), 0.0);
                col += uSunCol * (pow(nh, 700.0) * 1.6 + pow(nh, 80.0) * 0.1) * (1.0 - 0.85 * uStorm) * smoothstep(-0.02, 0.05, uSunDir.y);

                // Ship foam, the wake, and storm streaks on top
                float worldTex = smoothstep(0.3, 0.62, fbm3(p0 * 0.6) + 0.15);
                float wakeTex = smoothstep(0.3, 0.62, fbm3(vec2(wakeU * 0.3, wakeV * 2.6)) + 0.12 + 0.25 * wake);
                float streak = uStorm * smoothstep(0.62, 0.8, fbm3(vec2(dot(p0, uWind) * 0.05, dot(p0, vec2(-uWind.y, uWind.x)) * 0.6) + uTime * 0.02));
                float foam = clamp(max(streak * 0.45, max(shipFoam * worldTex, wake * wakeTex)), 0.0, 1.0);
                col = mix(col, vec3(0.88, 0.92, 0.94) * light * (0.6 + 0.4 * max(dot(N, L), 0.0)), foam * 0.92);
                col += vec3(0.02, 0.12, 0.13) * wake * light;

                float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
                col = mix(col, skyColor(normalize(vec3(-V.x, 0.015, -V.z))), fogF);
                gl_FragColor = vec4(col, 1.0);
            }
        `
    });
    const mesh = new THREE.Mesh(createOceanGeometry(), mat);
    mesh.frustumCulled = false;
    return mesh;
}

// Per-frame: stern track for the wake, ship pose for the ship-generated waves, camera-centred grid
function updateOcean(ocean, t, shipPos, shipQuat, shipVel) {
    const U = ocean.material.uniforms;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(shipQuat);
    const fwdH = new THREE.Vector2(fwd.x, fwd.z).normalize();
    const u = Math.max(0, shipVel.dot(fwd));

    const sternW = new THREE.Vector3(0, 0, -55).applyQuaternion(shipQuat).add(shipPos);
    const stern = new THREE.Vector2(sternW.x, sternW.z);
    if (lastStern) sternOdo += stern.distanceTo(lastStern);
    lastStern = stern.clone();
    if (!wakeTrail.length || t - wakeTrail[0].t > 1.0) {
        wakeTrail.unshift({ x: stern.x, z: stern.y, t, s: u / V_MAX, odo: sternOdo });
        if (wakeTrail.length > TRAIL_LEN) wakeTrail.pop();
    }
    trailU.forEach((v, i) => {
        const p = wakeTrail[i];
        if (p) v.set(p.x, p.z, t - p.t, p.s); else v.set(0, 0, -1, 0);
        trailOdo[i] = p ? p.odo : 0;
    });

    U.uShipXZ.value.set(shipPos.x, shipPos.z);
    U.uShipFwd.value.copy(fwdH);
    U.uSternXZ.value.copy(stern);
    U.uSternOdo.value = sternOdo;
    U.uSpeedN.value = u / V_MAX;
    U.uSpeed.value = u;
    U.uCenter.value.set(camera.position.x, camera.position.z);
}
