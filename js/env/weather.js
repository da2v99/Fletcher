// Time of day, storm intensity, rain and lightning.
// One set of uniforms (WEATHER_U) is shared by the sky, clouds and ocean shaders so they always agree.

const SUN_DIR = new THREE.Vector3(-1, 0.14, -0.1).normalize();

const WEATHER_U = {
    uSunDir: { value: SUN_DIR },
    uStorm: { value: 0.6 },
    uFlash: { value: 0 },
    uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
    uFogDensity: { value: 0.0002 },
    uTime: { value: 0 }
};

const weather = { storm: 0.6, hour: 6.4, flashT: 9, nextFlash: 6, hemiBase: 0.5 };
let hemiLight, ambLight, sunLight;

// Clear-sky gradient, storm overcast and sun glow. Clouds are volumetric (clouds.js) and composited on top.
const SKY_GLSL = `
    uniform vec3 uSunDir;
    uniform float uTime;
    uniform float uStorm;
    uniform float uFlash;
    uniform vec3 uSunCol;
    // 0 by day and through civil twilight, 1 once the sun is well down: the sky, sea and clouds darken for
    // the stars (stars.js)
    float nightF() { return smoothstep(-0.02, -0.3, uSunDir.y); }
    // 1 with the sun on the horizon, fading out by mid-morning / late afternoon and after dusk: sunrise and sunset
    float goldenF() { return smoothstep(-0.16, 0.0, uSunDir.y) * (1.0 - smoothstep(0.04, 0.38, uSunDir.y)); }
    vec3 skyColor(vec3 d) {
        d = normalize(d);
        float h = d.y, hh = clamp(h, 0.0, 1.0), sy = uSunDir.y;
        float day = smoothstep(-0.1, 0.3, sy), night = nightF(), gold = goldenF();
        float sd = max(dot(d, uSunDir), 0.0);
        // Azimuth: 1 looking toward the sun, 0 away from it
        vec2 dh = d.xz / max(length(d.xz), 1e-4), sh = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
        float az = dot(dh, sh) * 0.5 + 0.5;
        // Day: pale horizon to deep blue
        vec3 col = mix(vec3(0.58, 0.76, 0.93), vec3(0.05, 0.22, 0.62), pow(hh, 0.5));
        // Sunrise / sunset: low sky burning orange toward the sun, through salmon and rose to lavender away from
        // it; a band of rose and violet above, deep indigo overhead. Opposite the sun, as it goes down, the
        // earth's blue-grey shadow rises with the pink Belt of Venus above it.
        vec3 hor = mix(vec3(0.55, 0.50, 0.72), vec3(0.96, 0.60, 0.50), smoothstep(0.1, 0.6, az));
        hor = mix(hor, vec3(1.0, 0.45, 0.12), smoothstep(0.6, 0.98, az));
        vec3 band = mix(vec3(0.58, 0.44, 0.68), vec3(0.88, 0.50, 0.52), az);
        vec3 tw = mix(hor, band, smoothstep(0.0, 0.12 + 0.1 * az, hh));
        tw = mix(tw, vec3(0.10, 0.13, 0.34), smoothstep(0.1, 0.65, hh));
        float anti = 1.0 - az, down = smoothstep(0.03, -0.08, sy);
        tw = mix(tw, vec3(0.30, 0.34, 0.50), anti * down * (1.0 - smoothstep(0.0, 0.07, hh)) * 0.75);
        tw += vec3(0.26, 0.08, 0.13) * anti * smoothstep(-0.14, 0.0, sy) * smoothstep(0.03, 0.08, hh) * (1.0 - smoothstep(0.1, 0.22, hh));
        col = mix(col, tw, gold);
        // Night
        col = mix(col, mix(vec3(0.06, 0.08, 0.16), vec3(0.02, 0.05, 0.16), pow(hh, 0.5)), night);
        float bright = mix(0.45, 1.0, day) * (1.0 - 0.86 * night) * (1.0 + 0.18 * gold);
        col *= bright;
        if (h < 0.0) col = mix(col, vec3(0.16, 0.32, 0.52) * bright, clamp((-h - 0.08) * 3.0, 0.0, 1.0));
        vec3 overcast = mix(vec3(0.44, 0.48, 0.54), vec3(0.24, 0.26, 0.30), smoothstep(0.0, 0.5, h)) * mix(0.5, 1.0, day) * (1.0 - 0.86 * night);
        float gap = gold * pow(sd, 4.0) * exp(-max(h, 0.0) * 12.0);
        col = mix(col, overcast, uStorm * 0.9 * (1.0 - gap * 0.8));
        col += uSunCol * (pow(sd, 8.0) * 0.16 * (1.0 - uStorm * 0.5) + pow(sd, 90.0) * 0.45 * (1.0 - uStorm * 0.9));
        col += vec3(1.0, 0.4, 0.1) * pow(sd, 4.0) * 0.3 * gold * (1.0 - uStorm * 0.7);   // the glow round a low sun
        col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(0.0, 0.3, h));
        return col;
    }
`;

// The same sky colour on the CPU (mirrors skyColor() above), for the fog on ships, islands and smoke
const _skyA = new THREE.Color(), _skyB = new THREE.Color(), _skyC = new THREE.Color();
const _skyT = new THREE.Color(), _skyH = new THREE.Color();
const golden = sy => smooth(-0.16, 0, sy) * (1 - smooth(0.04, 0.38, sy));
function skyColorJS(dx, dy, dz, out) {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const S = SUN_DIR, storm = WEATHER_U.uStorm.value, flash = WEATHER_U.uFlash.value, sc = WEATHER_U.uSunCol.value;
    const sy = S.y, hh = clamp01(dy);
    const day = smooth(-0.1, 0.3, sy), night = smooth(-0.02, -0.3, sy), gold = golden(sy);
    const sd = Math.max(dx * S.x + dy * S.y + dz * S.z, 0);
    const dl = Math.max(Math.hypot(dx, dz), 1e-4), sl = Math.max(Math.hypot(S.x, S.z), 1e-4);
    const az = (dx / dl * S.x / sl + dz / dl * S.z / sl) * 0.5 + 0.5;
    out.setRGB(0.58, 0.76, 0.93).lerp(_skyA.setRGB(0.05, 0.22, 0.62), Math.sqrt(hh));
    const hor = _skyH.setRGB(0.55, 0.50, 0.72).lerp(_skyB.setRGB(0.96, 0.60, 0.50), smooth(0.1, 0.6, az)).lerp(_skyB.setRGB(1.0, 0.45, 0.12), smooth(0.6, 0.98, az));
    const band = _skyB.setRGB(lerp(0.58, 0.88, az), lerp(0.44, 0.50, az), lerp(0.68, 0.52, az));
    const tw = _skyT.copy(hor).lerp(band, smooth(0, 0.12 + 0.1 * az, hh)).lerp(_skyA.setRGB(0.10, 0.13, 0.34), smooth(0.1, 0.65, hh));
    const anti = 1 - az, down = smooth(0.03, -0.08, sy);
    tw.lerp(_skyA.setRGB(0.30, 0.34, 0.50), anti * down * (1 - smooth(0, 0.07, hh)) * 0.75);
    const belt = anti * smooth(-0.14, 0, sy) * smooth(0.03, 0.08, hh) * (1 - smooth(0.1, 0.22, hh));
    tw.r += 0.26 * belt; tw.g += 0.08 * belt; tw.b += 0.13 * belt;
    out.lerp(tw, gold);
    out.lerp(_skyA.setRGB(lerp(0.06, 0.02, Math.sqrt(hh)), lerp(0.08, 0.05, Math.sqrt(hh)), 0.16), night);
    const bright = lerp(0.45, 1, day) * (1 - 0.86 * night) * (1 + 0.18 * gold);
    out.multiplyScalar(bright);
    const oc = smooth(0, 0.5, dy), ob = lerp(0.5, 1, day) * (1 - 0.86 * night);
    _skyC.setRGB(lerp(0.44, 0.24, oc) * ob, lerp(0.48, 0.26, oc) * ob, lerp(0.54, 0.30, oc) * ob);
    const gap = gold * Math.pow(sd, 4) * Math.exp(-Math.max(dy, 0) * 12);
    out.lerp(_skyC, storm * 0.9 * (1 - gap * 0.8));
    const glow = Math.pow(sd, 8) * 0.16 * (1 - storm * 0.5) + Math.pow(sd, 90) * 0.45 * (1 - storm * 0.9);
    out.r += sc.r * glow; out.g += sc.g * glow; out.b += sc.b * glow;
    const gg = Math.pow(sd, 4) * 0.3 * gold * (1 - storm * 0.7);
    out.r += gg; out.g += 0.4 * gg; out.b += 0.1 * gg;
    const f = flash * (0.4 + 0.6 * smooth(0, 0.3, dy));
    out.r += 0.75 * f; out.g += 0.8 * f; out.b += f;
    return out;
}

// Every frame: the fog on ships, islands and smoke is the horizon colour in the direction you are looking,
// exactly what the sea's own far fog and the sky behind them fade to (sun glow, dawn tint, overcast and all)
const _fogDir = new THREE.Vector3();
function updateFogColor() {
    camera.getWorldDirection(_fogDir);
    const h = Math.hypot(_fogDir.x, _fogDir.z);
    if (h < 1e-3) _fogDir.set(1, 0, 0); else _fogDir.set(_fogDir.x / h, 0, _fogDir.z / h);
    skyColorJS(_fogDir.x, 0.015, _fogDir.z, scene.fog.color);
}

function applyWeather() {
    const s = weather.storm;
    const el = 78 * DEG * Math.sin(Math.PI * (weather.hour - 6) / 12);
    const az = (90 + (weather.hour - 6) / 6 * 90) * DEG;   // rises in the east (-X), south at noon
    SUN_DIR.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const dawn = 1 - smooth(0.05, 0.45, SUN_DIR.y);
    const day = smooth(-0.1, 0.3, SUN_DIR.y);
    const night = smooth(-0.02, -0.3, SUN_DIR.y);   // matches nightF() in SKY_GLSL
    weather.night = night;
    // The sun reddens as it nears the horizon; the light it throws is golden, then deep orange
    const gold = golden(SUN_DIR.y);
    const sunCol = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1, 0.58, 0.32), dawn).lerp(new THREE.Color(1, 0.36, 0.12), 1 - smooth(-0.02, 0.1, SUN_DIR.y));
    WEATHER_U.uSunCol.value.copy(sunCol);
    WEATHER_U.uStorm.value = s;
    WEATHER_U.uFogDensity.value = lerp(0.00011, 0.00032, s);

    sunLight.color.copy(sunCol);
    sunLight.intensity = 1.6 * smooth(-0.02, 0.12, SUN_DIR.y) * (1 - 0.78 * s);
    hemiLight.color.set(0xbfdcff).lerp(new THREE.Color(0x8e98a6), s).lerp(new THREE.Color(0xd9a08e), gold * 0.55 * (1 - s));
    hemiLight.groundColor.set(0x0f2a45).lerp(new THREE.Color(0x1a2026), s).lerp(new THREE.Color(0x2a2140), gold * 0.5);
    weather.hemiBase = (0.5 + 0.15 * s) * (0.4 + 0.6 * day) * (1 - 0.7 * night);
    hemiLight.intensity = weather.hemiBase;
    ambLight.intensity = 0.22 * (0.45 + 0.55 * day) * (1 - 0.6 * night);

    // Ship fog uses the same horizon colour and density law as the sky and ocean shaders
    const hz = new THREE.Color(0.58, 0.76, 0.93).lerp(new THREE.Color(0.66, 0.64, 0.72), dawn).multiplyScalar(lerp(0.45, 1, day) * (1 - 0.86 * night));
    const oc = new THREE.Color(0.44, 0.48, 0.54).multiplyScalar(lerp(0.5, 1, day) * (1 - 0.86 * night));
    scene.fog.color.copy(hz.lerp(oc, s * 0.9));
    scene.fog.density = WEATHER_U.uFogDensity.value;
    if (typeof Clouds !== 'undefined') Clouds.invalidate();
}

function weatherLabel(s) {
    return [[0.15, 'Clear'], [0.35, 'Fair, scattered cloud'], [0.55, 'Overcast, squalls'], [0.8, 'Stormy'], [2, 'Heavy storm']].find(([lim]) => s <= lim)[1];
}
function timeLabel(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// --- Rain: streaks that live relative to the camera and fall with the wind ---
function createRain() {
    const N = 6000;
    const pos = new Float32Array(N * 6);
    const drops = Array.from({ length: N }, () => new THREE.Vector3(rnd(-45, 45), rnd(-20, 30), rnd(-45, 45)));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.3, depthWrite: false }));
    lines.frustumCulled = false;
    const rv = new THREE.Vector3();
    return {
        lines,
        update(dt, shipVel) {
            const n = Math.floor(N * smooth(0.3, 0.9, weather.storm));
            geo.setDrawRange(0, n * 2);
            if (!n) return;
            rv.set(6 - shipVel.x, -17, 3.5 - shipVel.z);
            const c = camera.position;
            for (let i = 0; i < n; i++) {
                const d = drops[i];
                d.addScaledVector(rv, dt);
                if (d.y < -20) d.y += 50;
                if (d.x > 45) d.x -= 90; else if (d.x < -45) d.x += 90;
                if (d.z > 45) d.z -= 90; else if (d.z < -45) d.z += 90;
                const k = i * 6;
                pos[k] = c.x + d.x; pos[k + 1] = c.y + d.y; pos[k + 2] = c.z + d.z;
                pos[k + 3] = pos[k] - rv.x * 0.05; pos[k + 4] = pos[k + 1] - rv.y * 0.05; pos[k + 5] = pos[k + 2] - rv.z * 0.05;
            }
            geo.attributes.position.needsUpdate = true;
        }
    };
}

// --- Lightning: forked bolts on the horizon, sky flash, delayed thunder ---
const lightningBolts = [];
function strikeLightning() {
    const a = Math.random() * Math.PI * 2, d = rnd(2500, 8000);
    const start = new THREE.Vector3(camera.position.x + Math.cos(a) * d, rnd(1100, 1600), camera.position.z + Math.sin(a) * d);
    const mat = new THREE.LineBasicMaterial({ color: 0xeef2ff, fog: false, transparent: true });
    const fork = (from, minY, jitter) => {
        const pts = [from.clone()];
        const cur = from.clone();
        while (cur.y > minY) {
            cur.x += randn() * jitter; cur.z += randn() * jitter; cur.y -= rnd(60, 180);
            pts.push(cur.clone());
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        scene.add(line);
        lightningBolts.push({ line, life: 0.22 });
        return pts;
    };
    const pts = fork(start, 0, 110);
    if (Math.random() < 0.6) fork(pts[Math.floor(pts.length / 2)], 250, 160);
    weather.flashT = 0;
    playBoom(new THREE.Vector3(start.x, 400, start.z), 1.4, 220, 4.5);
}

function updateLightning(dt) {
    if (weather.storm > 0.55) {
        weather.nextFlash -= dt;
        if (weather.nextFlash <= 0) {
            weather.nextFlash = rnd(5, 18) / (weather.storm * 1.2);
            strikeLightning();
        }
    }
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
        const b = lightningBolts[i];
        b.life -= dt;
        b.line.material.opacity = Math.random() < 0.7 ? 1 : 0.2;
        if (b.life <= 0) {
            scene.remove(b.line);
            b.line.geometry.dispose();
            lightningBolts.splice(i, 1);
        }
    }
    weather.flashT += dt;
    const f = weather.flashT < 0.45 ? (Math.random() < 0.6 ? 1 : 0.25) * (1 - weather.flashT / 0.45) : 0;
    WEATHER_U.uFlash.value = f * 0.9;
    hemiLight.intensity = weather.hemiBase + f * 1.2;
}
