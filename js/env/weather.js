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
    vec3 skyColor(vec3 d) {
        d = normalize(d);
        float h = d.y;
        float dawn = 1.0 - smoothstep(0.05, 0.45, uSunDir.y);
        float day = smoothstep(-0.1, 0.3, uSunDir.y);
        float sd = max(dot(d, uSunDir), 0.0);
        vec3 zenith = mix(vec3(0.05, 0.22, 0.62), vec3(0.12, 0.18, 0.38), dawn);
        vec3 horizon = mix(vec3(0.58, 0.76, 0.93), vec3(0.66, 0.64, 0.72), dawn);
        horizon += vec3(0.55, 0.22, 0.02) * dawn * pow(sd, 2.5);
        float night = nightF();
        float bright = mix(0.45, 1.0, day) * (1.0 - 0.86 * night);
        zenith = mix(zenith, vec3(0.02, 0.05, 0.16), night);
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5)) * bright;
        if (h < 0.0) col = mix(col, vec3(0.16, 0.32, 0.52) * bright, clamp(-h * 4.0, 0.0, 1.0));
        vec3 overcast = mix(vec3(0.44, 0.48, 0.54), vec3(0.24, 0.26, 0.30), smoothstep(0.0, 0.5, h)) * mix(0.5, 1.0, day) * (1.0 - 0.86 * night);
        float gap = dawn * pow(sd, 4.0) * exp(-max(h, 0.0) * 12.0);
        col = mix(col, overcast, uStorm * 0.9 * (1.0 - gap * 0.8));
        col += uSunCol * (pow(sd, 8.0) * 0.16 * (1.0 - uStorm * 0.5) + pow(sd, 90.0) * 0.45 * (1.0 - uStorm * 0.9));
        col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(0.0, 0.3, h));
        return col;
    }
`;

function applyWeather() {
    const s = weather.storm;
    const el = 78 * DEG * Math.sin(Math.PI * (weather.hour - 6) / 12);
    const az = (90 + (weather.hour - 6) / 6 * 90) * DEG;   // rises in the east (-X), south at noon
    SUN_DIR.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const dawn = 1 - smooth(0.05, 0.45, SUN_DIR.y);
    const day = smooth(-0.1, 0.3, SUN_DIR.y);
    const night = smooth(-0.02, -0.3, SUN_DIR.y);   // matches nightF() in SKY_GLSL
    weather.night = night;
    const sunCol = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1, 0.58, 0.32), dawn);
    WEATHER_U.uSunCol.value.copy(sunCol);
    WEATHER_U.uStorm.value = s;
    WEATHER_U.uFogDensity.value = lerp(0.00011, 0.00032, s);

    sunLight.color.copy(sunCol);
    sunLight.intensity = 1.6 * smooth(-0.02, 0.12, SUN_DIR.y) * (1 - 0.78 * s);
    hemiLight.color.set(0xbfdcff).lerp(new THREE.Color(0x8e98a6), s).lerp(new THREE.Color(0xc9a898), dawn * 0.3);
    hemiLight.groundColor.set(0x0f2a45).lerp(new THREE.Color(0x1a2026), s);
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
