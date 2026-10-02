// Pooled GPU point particles (spray, smoke, fire) and the effect recipes built on them.
// Particle fields: position / velocity, life, s0 -> s1 size, colour r g b (optionally fading to r1 g1 b1),
// alpha a, drag, grav; optional: delay (s before it appears), fade (alpha fall-off power, default 2),
// floor (a y it can't fall through: it stops there and fades out quickly, e.g. spray landing on the sea),
// s2 (size swells to s1 by a third of its life, then tapers to s2: a tongue of flame), r2 g2 b2 (a third colour
// after r1: white-hot, orange, dull red), turb (swirling turbulence, m/s²), wx wz (the drift it settles into,
// e.g. downwind, instead of coming to rest).

// Sprite textures: 'soft' round glow (fire), 'puff' lumpy cloud (smoke, mist), 'spray' grainy droplets (water).
// Each is a 2 x 2 atlas of different random draws, and every particle picks one and a rotation of its own, so
// no two sprites in a splash or a smoke column look alike.
function particleTexture(kind) {
    const N = 128, c = document.createElement('canvas');
    c.width = c.height = N * 2;
    const ctx = c.getContext('2d');
    let ox = 0, oy = 0;
    const blob = (x, y, r, a) => {
        const g = ctx.createRadialGradient(ox + x, oy + y, 0, ox + x, oy + y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ox + x, oy + y, r, 0, Math.PI * 2); ctx.fill();
    };
    for (let cell = 0; cell < 4; cell++) {
        ox = (cell % 2) * N; oy = Math.floor(cell / 2) * N;
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, N, N); ctx.clip();
        if (kind === 'soft') {
            const g = ctx.createRadialGradient(ox + 64, oy + 64, 0, ox + 64, oy + 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(ox, oy, N, N);
        } else if (kind === 'puff') {
            blob(64, 64, 34 + Math.random() * 10, 0.5);
            for (let i = 0; i < 14 + cell * 3; i++) {
                const a = Math.random() * Math.PI * 2, d = Math.random() * 28;
                blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 10 + Math.random() * 20, 0.3 + Math.random() * 0.12);
            }
        } else {
            // Spray: a denser core or a loose sheet of drops, streaks for the ones flung fast
            blob(64 + (Math.random() - 0.5) * 10, 64 + (Math.random() - 0.5) * 10, 22 + Math.random() * 16, 0.3 + Math.random() * 0.25);
            const n = 50 + cell * 25;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.6 + cell * 0.15) * 56;
                const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
                if (cell === 3 && Math.random() < 0.3) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
                    ctx.lineWidth = 1 + Math.random() * 1.5;
                    ctx.beginPath(); ctx.moveTo(ox + x, oy + y); ctx.lineTo(ox + x + Math.cos(a) * 8, oy + y + Math.sin(a) * 8); ctx.stroke();
                } else blob(x, y, 1.5 + Math.random() * 5.5 * (1 - d / 64), 0.6 + Math.random() * 0.35);
            }
        }
        // Fade the edges so no square corners show
        ctx.globalCompositeOperation = 'destination-in';
        const e = ctx.createRadialGradient(ox + 64, oy + 64, 36, ox + 64, oy + 64, 63);
        e.addColorStop(0, 'rgba(0,0,0,1)');
        e.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = e;
        ctx.fillRect(ox, oy, N, N);
        ctx.restore();
    }
    return new THREE.CanvasTexture(c);
}

function createParticleSystem(maxCount, blending, texture = 'soft') {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxCount * 3), col = new Float32Array(maxCount * 3);
    const size = new Float32Array(maxCount), alpha = new Float32Array(maxCount), pvar = new Float32Array(maxCount);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('pvar', new THREE.BufferAttribute(pvar, 1));   // which sprite and which rotation
    const mat = new THREE.ShaderMaterial({
        // Fog: the scene's own colour object (shared, so it follows the weather and the view) and density
        uniforms: { map: { value: particleTexture(texture) }, scale: { value: 800 }, fogCol: { value: scene.fog.color }, fogDen: { value: 0 },
            additive: { value: blending === THREE.AdditiveBlending ? 1 : 0 }, shade: { value: texture === 'puff' ? 1 : 0 } },
        vertexShader: `
            attribute vec3 pcolor;
            attribute float psize;
            attribute float palpha;
            attribute float pvar;
            uniform float scale;
            uniform float fogDen;
            varying vec3 vC;
            varying float vA;
            varying float vFog;
            varying vec3 vSpr;   // sprite: cos, sin of its rotation, atlas cell
            void main() {
                vC = pcolor; vA = palpha;
                float ang = pvar * 6.2831853;
                vSpr = vec3(cos(ang), sin(ang), floor(fract(pvar * 7.31) * 4.0));
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                float fd = -mv.z * fogDen;
                vFog = 1.0 - exp(-fd * fd);
                gl_PointSize = psize * scale / max(-mv.z, 0.1);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            uniform vec3 fogCol;
            uniform float additive;
            uniform float shade;
            varying vec3 vC;
            varying float vA;
            varying float vFog;
            varying vec3 vSpr;
            void main() {
                vec2 q = gl_PointCoord - 0.5;
                q = vec2(vSpr.x * q.x - vSpr.y * q.y, vSpr.y * q.x + vSpr.x * q.y) + 0.5;
                if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;
                vec2 uv = (clamp(q, 0.01, 0.99) + vec2(mod(vSpr.z, 2.0), floor(vSpr.z / 2.0))) * 0.5;
                float a = texture2D(map, uv).a * vA;
                if (additive > 0.5) a *= 1.0 - vFog;   // glows fade out; smoke and spray take on the haze
                if (a < 0.003) discard;
                vec3 c = vC;
                // Smoke is a lumpy volume, not a flat disc: lit on its upper side, in shadow underneath
                if (shade > 0.5) c *= 0.7 + 0.55 * (1.0 - gl_PointCoord.y) * (0.6 + 0.4 * texture2D(map, uv * 0.5 + 0.25).a);
                gl_FragColor = vec4(additive > 0.5 ? c : mix(c, fogCol, vFog), a);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    const list = [];
    return {
        points,
        // Lighter graphics presets keep a share of the particles (bigger ones, so effects keep their mass)
        emit(p) {
            const keep = Gfx.particleKeep;
            if (keep < 1) {
                if (Math.random() > keep) return;
                const k = 1 / Math.sqrt(keep);
                p.s0 *= k; p.s1 *= k;
            }
            if (list.length < maxCount) list.push(Object.assign({ age: -(p.delay || 0), v: Math.random() }, p));
        },
        clear() { list.length = 0; },
        update(dt, scaleValue) {
            mat.uniforms.scale.value = scaleValue;
            mat.uniforms.fogDen.value = scene.fog.density;
            for (let i = list.length - 1; i >= 0; i--) {
                const p = list[i];
                p.age += dt;
                if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
                if (p.age < 0) continue;
                const damp = Math.exp(-p.drag * dt);
                if (p.wx !== undefined) { p.vx = p.wx + (p.vx - p.wx) * damp; p.vz = p.wz + (p.vz - p.wz) * damp; }
                else { p.vx *= damp; p.vz *= damp; }
                p.vy = p.vy * damp - p.grav * dt;
                if (p.turb) {
                    const ph = p.v * 40, a = p.age;
                    p.vx += Math.sin(a * 2.3 + ph) * p.turb * dt;
                    p.vz += Math.cos(a * 1.9 + ph * 1.3) * p.turb * dt;
                    p.vy += Math.sin(a * 3.1 + ph * 0.7) * p.turb * 0.4 * dt;
                }
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                if (p.floor !== undefined && p.y < p.floor && p.vy < 0) {
                    p.y = p.floor; p.vy = 0; p.vx *= 0.3; p.vz *= 0.3; p.grav = 0;
                    p.age = Math.max(p.age, p.life * 0.8);
                }
            }
            let n = 0;
            for (const p of list) {
                if (p.age < 0) continue;
                const t = p.age / p.life;
                pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
                if (p.r1 === undefined) { col[n * 3] = p.r; col[n * 3 + 1] = p.g; col[n * 3 + 2] = p.b; }
                else if (p.r2 === undefined) { const c = Math.min(1, t * (p.cs || 1)); col[n * 3] = lerp(p.r, p.r1, c); col[n * 3 + 1] = lerp(p.g, p.g1, c); col[n * 3 + 2] = lerp(p.b, p.b1, c); }
                else {
                    const c = Math.min(1, t * (p.cs || 1)) * 2;
                    if (c < 1) { col[n * 3] = lerp(p.r, p.r1, c); col[n * 3 + 1] = lerp(p.g, p.g1, c); col[n * 3 + 2] = lerp(p.b, p.b1, c); }
                    else { col[n * 3] = lerp(p.r1, p.r2, c - 1); col[n * 3 + 1] = lerp(p.g1, p.g2, c - 1); col[n * 3 + 2] = lerp(p.b1, p.b2, c - 1); }
                }
                size[n] = p.s2 === undefined ? lerp(p.s0, p.s1, Math.sqrt(t)) : t < 0.33 ? lerp(p.s0, p.s1, Math.sqrt(t / 0.33)) : lerp(p.s1, p.s2, (t - 0.33) / 0.67);
                pvar[n] = p.v;
                alpha[n] = p.a * Math.min(1, t * 12) * Math.pow(1 - t, p.fade || 2);
                n++;
            }
            geo.setDrawRange(0, n);
            // Upload only the live part of each buffer
            if (n > 0) {
                const A = geo.attributes;
                A.position.updateRange.count = n * 3; A.pcolor.updateRange.count = n * 3;
                A.psize.updateRange.count = n; A.palpha.updateRange.count = n; A.pvar.updateRange.count = n;
                A.position.needsUpdate = A.pcolor.needsUpdate = A.psize.needsUpdate = A.palpha.needsUpdate = A.pvar.needsUpdate = true;
            }
        }
    };
}

let smokeFx, fireFx, sprayFx, muzzleLight, blastLight, fireLight;
const fireNear = { d: Infinity, p: new THREE.Vector3(), k: 0 };   // the blaze nearest the camera this frame
const shockwaves = [];
let shockGeo, shockMat;

function initEffects() {
    smokeFx = createParticleSystem(9000, THREE.NormalBlending, 'puff');
    sprayFx = createParticleSystem(40000, THREE.NormalBlending, 'spray');
    fireFx = createParticleSystem(5000, THREE.AdditiveBlending);
    scene.add(smokeFx.points, sprayFx.points, fireFx.points);
    muzzleLight = new THREE.PointLight(0xffa655, 0, 90, 2);
    blastLight = new THREE.PointLight(0xff9a40, 0, 160, 2);
    fireLight = new THREE.PointLight(0xff7a2e, 0, 45, 2);   // flickering light thrown by the nearest fire
    scene.add(muzzleLight, blastLight, fireLight);
    shockGeo = new THREE.RingGeometry(0.82, 1, 48);
    shockGeo.rotateX(-Math.PI / 2);
    shockMat = new THREE.MeshBasicMaterial({ color: 0xfff1d8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

function updateEffects(dt) {
    const pxScale = window.innerHeight / (2 * Math.tan(camera.fov * DEG / 2));
    smokeFx.update(dt, pxScale);
    sprayFx.update(dt, pxScale);
    fireFx.update(dt, pxScale);
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
    if (fireNear.d < 260 * 260) {
        fireLight.position.copy(fireNear.p).y += 2.5;
        const fl = 0.75 + 0.25 * Math.sin(simTime * 23.0) * Math.sin(simTime * 7.3 + 1.1) + 0.1 * Math.random();
        fireLight.intensity = 3.2 * fireNear.k * fl;
    } else fireLight.intensity = 0;
    fireNear.d = Infinity;
    blastLight.intensity = Math.max(0, blastLight.intensity - dt * 30);
    // Shock rings: a fast, fading ring racing out over the water from a blast
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const w = shockwaves[i];
        w.t += dt;
        const f = w.t / w.life;
        if (f >= 1) { scene.remove(w.mesh); w.mesh.material.dispose(); shockwaves.splice(i, 1); continue; }
        w.mesh.scale.setScalar(w.r * Math.sqrt(f) + 0.5);
        w.mesh.material.opacity = 0.55 * (1 - f) * (1 - f);
    }
}

const WHITE_SPRAY = [0.93, 0.96, 0.98];

const FX = {
    // Water plume from anything hitting the sea at speed. The column keeps building for a fraction of a second
    // (water is still being thrown up as it rises), hangs, spreads into a ragged head and collapses as a curtain
    // of spray, leaving a skirt of white water and mist drifting downwind. No two are alike: each has its own
    // height, one to four jets of different heights, a lean with the wind, a lopsided crown and its own pace.
    // H: height (m), R: column radius, k: particle scale, n: density (1 = a 5" shell's)
    plume(x, y, z, H, R, k, n = 1) {
        H *= rnd(0.8, 1.15);
        const g = GRAVITY, floor = y - 0.3, W = rnd(0.9, 0.98);
        const tall = Math.sqrt(H / 30);                                  // sprites and girth grow with the column
        R *= 0.75 + 0.55 * tall;
        const vTop = Math.sqrt(2 * g * H) * 1.05;                        // a little over, for the air drag
        const lean = Math.min(0.09, 0.02 + Math.random() * 0.05);
        const lx = (Sea.wind.x * 0.6 + randn() * 0.5) * lean, lz = (Sea.wind.y * 0.6 + randn() * 0.5) * lean;
        const build = rnd(0.2, 0.45);
        // Jets: the main one and up to three lesser ones beside it
        const nj = n >= 0.5 ? 1 + Math.floor(Math.random() * 3.3) : (Math.random() < 0.45 ? 2 : 1);
        const jets = [];
        for (let j = 0; j < nj; j++) {
            const a = Math.random() * Math.PI * 2, d = j ? rnd(0.5, 1.5) * R : 0;
            jets.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, h: j ? rnd(0.35, 0.85) : 1, r: R * (j ? rnd(0.45, 0.8) : 1), w: j ? rnd(0.2, 0.45) : 1 });
        }
        const wsum = jets.reduce((s, j) => s + j.w, 0);
        const pick = () => { let r = Math.random() * wsum; for (const j of jets) { r -= j.w; if (r <= 0) return j; } return jets[0]; };
        const wx = Sea.wind.x * 2.5, wz = Sea.wind.y * 2.5;
        // Column(s): fastest in the middle, so each rises as a tapering spike
        for (let i = 0; i < 480 * n; i++) {
            const J = pick(), a = Math.random() * Math.PI * 2, f = Math.sqrt(Math.random()), rr = f * J.r;
            const vy = vTop * Math.sqrt(J.h) * (1 - 0.72 * f * f) * rnd(0.7, 1.04);
            const shade = rnd(0.82, 1) * W;
            sprayFx.emit({ x: J.x + Math.cos(a) * rr, y: y + rnd(0, 0.6), z: J.z + Math.sin(a) * rr, delay: Math.pow(Math.random(), 1.5) * build,
                vx: Math.cos(a) * rnd(0.3, 2.4) * k + lx * vy, vy, vz: Math.sin(a) * rnd(0.3, 2.4) * k + lz * vy,
                life: 2 * vy / g + rnd(0.6, 1.6), s0: rnd(1.5, 2.6) * k * tall, s1: rnd(4.5, 8.5) * k * tall,
                r: shade, g: shade, b: shade * 1.02, a: rnd(0.75, 0.95), fade: rnd(0.9, 1.4), drag: 0.03, grav: g, floor });
        }
        // Head: the top of the main column bursts outward into a ragged crown of spray
        for (let i = 0; i < 90 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(2, 8) * k * tall;
            const vy = vTop * rnd(0.8, 1.0);
            sprayFx.emit({ x, y: y + 0.5, z, delay: rnd(0, build * 0.5), vx: Math.cos(a) * sp + lx * vy, vy, vz: Math.sin(a) * sp + lz * vy,
                life: 2 * vy / g + rnd(0.5, 1.4), s0: rnd(1.4, 2.6) * k * tall, s1: rnd(4.5, 8.5) * k * tall,
                r: W, g: W, b: W, a: 0.65, fade: 1.3, drag: 0.12, grav: g, floor });
        }
        // Crown: droplets flung up and out at impact, thrown harder to one side
        const cb = Math.random() * Math.PI * 2, cs = rnd(0, 0.7);
        for (let i = 0; i < 110 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(5, 16) * k * (1 + cs * Math.cos(a - cb)) * Math.min(2, tall);
            sprayFx.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rnd(0.25, 0.6) * vTop, vz: Math.sin(a) * sp,
                life: rnd(1.6, 3.4) * tall, s0: rnd(0.3, 0.7) * k, s1: rnd(0.8, 1.6) * k, r: W, g: W, b: W, a: 0.95, fade: 0.8, drag: 0.25, grav: g, floor });
        }
        // Base surge: a low ring of white water rolling outwards
        for (let i = 0; i < 70 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(4, 12) * k * Math.min(1.6, tall);
            sprayFx.emit({ x: x + Math.cos(a) * R, y: y + 0.4, z: z + Math.sin(a) * R, delay: rnd(0, 0.4), vx: Math.cos(a) * sp, vy: rnd(0.8, 3) * k, vz: Math.sin(a) * sp,
                life: rnd(1.8, 3.6), s0: 1.6 * k, s1: rnd(4.5, 8) * k * Math.min(1.6, tall), r: 0.92, g: 0.95, b: 0.97, a: 0.55, drag: 1.3, grav: 1.5 });
        }
        // The collapse: a curtain of falling water round the column's foot as it comes down
        const fall = Math.sqrt(2 * H / g) * 2;
        for (let i = 0; i < 60 * n; i++) {
            const a = Math.random() * Math.PI * 2, rr = R * rnd(1, 2.6);
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + rnd(0.2, 0.5) * H, z: z + Math.sin(a) * rr, delay: fall * rnd(0.45, 0.7),
                vx: Math.cos(a) * rnd(1, 3), vy: rnd(-4, 0), vz: Math.sin(a) * rnd(1, 3), life: rnd(1.5, 3), s0: rnd(2, 3.5) * k * tall, s1: rnd(5, 9) * k * tall,
                r: W, g: W, b: W, a: 0.5, fade: 1.2, drag: 0.6, grav: g * 0.8, floor });
        }
        // Mist: hangs at every height of the column as it falls, then drifts off downwind
        for (let i = 0; i < 60 * n; i++) {
            const hgt = Math.pow(Math.random(), 0.7) * H;
            smokeFx.emit({ x: x + randn() * R * 1.4 + lx * hgt, y: y + hgt, z: z + randn() * R * 1.4 + lz * hgt, vx: wx + randn() * 0.8, vy: rnd(-0.7, 0.3), vz: wz + randn() * 0.8,
                delay: rnd(0.4, 1.0) * fall * 0.5, life: rnd(5, 11), s0: rnd(3, 6) * k * tall, s1: rnd(10, 20) * k * tall,
                r: 0.93, g: 0.95, b: 0.97, a: rnd(0.16, 0.28), fade: 1.6, drag: 1.2, grav: 0.12 });
        }
        // Foam patch left on the water
        for (let i = 0; i < 26 * n; i++) {
            const a = Math.random() * Math.PI * 2, rr = rnd(0, 2.6) * R * Math.min(1.6, tall);
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + 0.2, z: z + Math.sin(a) * rr, vx: wx * 0.3 + Math.cos(a) * 0.8, vy: 0, vz: wz * 0.3 + Math.sin(a) * 0.8,
                delay: rnd(0.6, 2.2), life: rnd(6, 12), s0: rnd(2, 3.5) * k, s1: rnd(5, 9) * k, r: 0.9, g: 0.95, b: 0.97, a: 0.5, fade: 1.2, drag: 0.6, grav: 0 });
        }
    },
    // Shell splash: a 5" shell's column ~45 m (scale 2.6 is a torpedo, ~80 m). Always white water (tint kept
    // for callers, not used)
    splash(x, y, z, tint = WHITE_SPRAY, scale = 1) {
        FX.plume(x, y, z, Math.min(85, 46 * Math.pow(scale, 0.55)), 1.3 * Math.sqrt(scale), 0.62 * Math.sqrt(scale), scale);
    },
    // 40 mm (big) or 20 mm round into the sea: thin plumes, ~15 m and ~10 m
    aaSplash(x, y, z, big) {
        FX.plume(x, y, z, big ? rnd(13, 18) : rnd(8.5, 11.5), big ? 0.42 : 0.3, big ? 0.48 : 0.38, big ? 0.2 : 0.13);
    },
    // Torpedo hit: a towering white column and a fireball
    waterColumn(p) {
        FX.splash(p.x, p.y, p.z, WHITE_SPRAY, 2.6);
        FX.explosion(p, 1.6);
    },
    muzzle(p, dir, shipVel, big = 1) {
        for (let i = 0; i < 16; i++) {
            const s = rnd(15, 70);
            fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x * s + randn() * 6, vy: dir.y * s + randn() * 6, vz: dir.z * s + randn() * 6,
                life: rnd(0.07, 0.18), s0: rnd(2.5, 4) * big, s1: rnd(5, 8) * big, r: 1.0, g: rnd(0.55, 0.8), b: 0.25, a: 1.0, drag: 6, grav: 0 });
        }
        for (let i = 0; i < 16; i++) {
            const s = rnd(4, 16);
            smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: dir.x * s + shipVel.x * 0.4 + randn() * 1.5, vy: dir.y * s + randn() * 1.5, vz: dir.z * s + shipVel.z * 0.4 + randn() * 1.5,
                life: rnd(2.5, 5), s0: rnd(1.5, 3), s1: rnd(10, 18) * big, r: 0.9, g: 0.89, b: 0.87, a: 0.4, drag: 1.1, grav: -0.35 });
        }
        if (p.distanceTo(camera.position) < 400) {
            muzzleLight.position.copy(p).addScaledVector(dir, 3);
            muzzleLight.intensity = 6;
        }
    },
    // Shell or torpedo burst: white-hot flash, a fireball that cools from yellow to deep orange to soot,
    // glowing fragments arcing out, dark debris, a shock ring, and a column of oily smoke that lingers.
    explosion(p, scale = 1) {
        fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.12, s0: 7 * scale, s1: 13 * scale, r: 1, g: 0.9, b: 0.7, a: 1, fade: 1, drag: 0, grav: 0 });
        for (let i = 0; i < 38 * scale; i++) {
            const sp = rnd(3, 14) * scale;
            const d = new THREE.Vector3(randn(), Math.abs(randn()) * 0.8 + 0.3, randn()).normalize();
            fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
                life: rnd(0.35, 1.0) * Math.sqrt(scale), s0: rnd(3, 6) * scale, s1: rnd(9, 16) * scale,
                r: 1, g: 0.88, b: 0.55, r1: 0.85, g1: 0.22, b1: 0.03, cs: 1.4, a: 1, fade: 1.5, drag: 3, grav: -2 });
        }
        // Glowing fragments
        for (let i = 0; i < 34 * scale; i++) {
            const sp = rnd(18, 55);
            const d = new THREE.Vector3(randn(), Math.abs(randn()) + 0.4, randn()).normalize();
            fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
                life: rnd(0.6, 1.8), s0: rnd(0.5, 0.9), s1: 0.3, r: 1, g: 0.75, b: 0.35, r1: 0.9, g1: 0.25, b1: 0.05, a: 1, fade: 0.7, drag: 0.6, grav: GRAVITY });
        }
        // Dark debris
        for (let i = 0; i < 18 * scale; i++) {
            const sp = rnd(10, 30);
            const d = new THREE.Vector3(randn(), Math.abs(randn()) + 0.6, randn()).normalize();
            smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp,
                life: rnd(1.2, 2.4), s0: rnd(0.5, 1.0), s1: 0.6, r: 0.08, g: 0.07, b: 0.06, a: 1, fade: 0.5, drag: 0.4, grav: GRAVITY });
        }
        // Smoke: lit orange from below at first, then black, billowing up and drifting
        for (let i = 0; i < 60 * scale; i++) {
            const gray = rnd(0.12, 0.3);
            smokeFx.emit({ x: p.x + randn() * 2, y: p.y + rnd(0, 2), z: p.z + randn() * 2,
                vx: randn() * 4 + Sea.wind.x * 2, vy: rnd(2, 12), vz: randn() * 4 + Sea.wind.y * 2,
                delay: rnd(0.05, 0.5), life: rnd(4, 9), s0: rnd(2, 4) * scale, s1: rnd(9, 18) * scale,
                r: 0.5, g: 0.3, b: 0.15, r1: gray, g1: gray * 0.96, b1: gray * 0.92, cs: 5, a: 0.55, fade: 1.8, drag: 0.9, grav: -0.8 });
        }
        // Shock ring over the water and a flash of light
        const ring = new THREE.Mesh(shockGeo, shockMat.clone());
        ring.position.copy(p);
        scene.add(ring);
        shockwaves.push({ mesh: ring, t: 0, life: 0.45, r: 30 * scale });
        if (p.distanceTo(camera.position) < 1500) {
            blastLight.position.copy(p).y += 4;
            blastLight.intensity = 8 * scale;
        }
    },
    // A fire burning (called many times a second per blaze): tongues of flame that swell and taper as they lick
    // up, white-hot at the root through orange to dull red, swirling as they rise; embers spiralling up out of it;
    // and a dense, oily column of smoke, lit orange from below at first, billowing and shearing off downwind
    burn(p, intensity) {
        const k = intensity, wx = Sea.wind.x * 3, wz = Sea.wind.y * 3;
        for (let i = 0; i < 2; i++) if (Math.random() < 0.75 * k) fireFx.emit({
            x: p.x + randn() * 1.1, y: p.y + rnd(0, 0.5), z: p.z + randn() * 1.1,
            vx: randn() * 0.5, vy: rnd(2.5, 6), vz: randn() * 0.5, wx: wx * 0.4, wz: wz * 0.4,
            life: rnd(0.45, 0.95), s0: rnd(1.0, 2.0) * k, s1: rnd(3.2, 5.5) * k, s2: rnd(0.5, 1.1),
            r: 1, g: 0.86, b: 0.55, r1: 1, g1: 0.45, b1: 0.09, r2: 0.6, g2: 0.1, b2: 0.02, cs: 1, a: 0.8, fade: 0.8, drag: 1.4, grav: -3.5, turb: 7 });
        if (Math.random() < 0.3 * k) fireFx.emit({
            x: p.x + randn(), y: p.y + rnd(0.5, 2), z: p.z + randn(), vx: randn() * 1.5, vy: rnd(4, 10), vz: randn() * 1.5, wx, wz,
            life: rnd(1.5, 3.2), s0: rnd(0.18, 0.32), s1: 0.12, r: 1, g: 0.65, b: 0.25, r1: 0.9, g1: 0.22, b1: 0.03, a: 1, fade: 0.5, drag: 0.7, grav: -1.2, turb: 16 });
        if (Math.random() < 0.8) {
            const g = rnd(0.07, 0.13);
            smokeFx.emit({ x: p.x + randn() * 1.4, y: p.y + rnd(0.8, 2.2), z: p.z + randn() * 1.4,
                vx: randn() * 0.6, vy: rnd(3, 6), vz: randn() * 0.6, wx, wz,
                life: rnd(8, 14), s0: rnd(2, 3.5), s1: rnd(17, 30), r: 0.45, g: 0.25, b: 0.12, r1: g, g1: g * 0.96, b1: g * 0.92, cs: 7,
                a: 0.62 * Math.min(1, k + 0.3), fade: 1.4, drag: 0.35, grav: -0.22, turb: 1.4 });
        }
        // The nearest blaze to the camera lights its surroundings (one shared, flickering light)
        const d = p.distanceToSquared(camera.position);
        if (d < fireNear.d) { fireNear.d = Math.sqrt(d) < 260 ? d : Infinity; fireNear.p.copy(p); fireNear.k = Math.min(1.2, k); }
    },
    // Shell burst on land: a flash and short fireball, a fountain of earth and stones, and a brown-grey dust
    // cloud that billows up and drifts downwind. scale 1 = 5" HE; small values for 40 mm.
    dirt(p, scale = 1) {
        const k = Math.sqrt(scale);
        fireFx.emit({ x: p.x, y: p.y + 1, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.1, s0: 6 * k, s1: 11 * k, r: 1, g: 0.85, b: 0.6, a: 1, fade: 1, drag: 0, grav: 0 });
        for (let i = 0; i < 20 * scale + 2; i++) {
            const sp = rnd(3, 11) * k;
            const d = new THREE.Vector3(randn(), Math.abs(randn()) + 0.5, randn()).normalize();
            fireFx.emit({ x: p.x, y: p.y + 1, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rnd(0.25, 0.6) * k + 0.1,
                s0: rnd(2, 4) * k, s1: rnd(5, 9) * k, r: 1, g: 0.8, b: 0.45, r1: 0.8, g1: 0.25, b1: 0.05, cs: 1.5, a: 1, fade: 1.5, drag: 3, grav: -1 });
        }
        // Earth and stones thrown up and out
        for (let i = 0; i < 70 * scale + 3; i++) {
            const a = Math.random() * Math.PI * 2, out = rnd(2, 13) * k;
            smokeFx.emit({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * out, vy: rnd(9, 30) * k, vz: Math.sin(a) * out,
                life: rnd(1.4, 3.2) * k, s0: rnd(0.5, 1.3) * k, s1: rnd(0.4, 0.8) * k, r: 0.2, g: 0.16, b: 0.11, a: 1, fade: 0.4, drag: 0.35, grav: GRAVITY,
                floor: p.y - 0.5 });
        }
        // Dust: a column that slumps into a drifting cloud
        for (let i = 0; i < 46 * scale + 2; i++) {
            const gray = rnd(0.3, 0.45);
            smokeFx.emit({ x: p.x + randn() * 2 * k, y: p.y + rnd(0, 4) * k, z: p.z + randn() * 2 * k,
                vx: randn() * 3 * k + Sea.wind.x * 2.2, vy: rnd(2, 12) * k, vz: randn() * 3 * k + Sea.wind.y * 2.2,
                delay: rnd(0, 0.4), life: rnd(5, 11) * k + 1, s0: rnd(2.5, 4.5) * k, s1: rnd(11, 22) * k,
                r: 0.48, g: 0.4, b: 0.3, r1: gray, g1: gray * 0.95, b1: gray * 0.88, cs: 2, a: 0.5, fade: 1.6, drag: 1.1, grav: -0.15 });
        }
        if (scale >= 0.5) {
            const ring = new THREE.Mesh(shockGeo, shockMat.clone());
            ring.position.copy(p).y += 0.6;
            scene.add(ring);
            shockwaves.push({ mesh: ring, t: 0, life: 0.4, r: 26 * k });
            if (p.distanceTo(camera.position) < 1500) {
                blastLight.position.copy(p).y += 4;
                blastLight.intensity = 6 * k;
            }
        }
    },
    // Fuel or ammunition going up: a rolling fireball that climbs on its own heat, then a column of black smoke
    fuelBlast(p, scale = 1) {
        FX.explosion(p, 2.2 * scale);
        for (let i = 0; i < 70 * scale; i++) {
            const a = Math.random() * Math.PI * 2, out = rnd(0, 9) * scale;
            fireFx.emit({ x: p.x + Math.cos(a) * out, y: p.y + rnd(0, 6), z: p.z + Math.sin(a) * out,
                vx: Math.cos(a) * rnd(1, 6), vy: rnd(8, 26) * scale, vz: Math.sin(a) * rnd(1, 6), delay: rnd(0, 0.5),
                life: rnd(1.2, 2.8), s0: rnd(7, 12) * scale, s1: rnd(16, 28) * scale,
                r: 1, g: 0.75, b: 0.35, r1: 0.7, g1: 0.18, b1: 0.03, cs: 1.3, a: 1, fade: 1.4, drag: 1.2, grav: -3 });
        }
        for (let i = 0; i < 90 * scale; i++) {
            smokeFx.emit({ x: p.x + randn() * 6, y: p.y + rnd(4, 20), z: p.z + randn() * 6,
                vx: randn() * 3 + Sea.wind.x * 3, vy: rnd(6, 18), vz: randn() * 3 + Sea.wind.y * 3, delay: rnd(0.3, 2.5),
                life: rnd(10, 20), s0: rnd(6, 10) * scale, s1: rnd(30, 55) * scale,
                r: 0.12, g: 0.1, b: 0.09, a: 0.65, fade: 1.6, drag: 0.6, grav: -0.4 });
        }
    },
    // Anti-aircraft burst: a flash and a puff of black smoke that hangs in the air. size 1 = 5" flak
    flak(p, size = 1) {
        fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.09, s0: 5 * size, s1: 9 * size, r: 1, g: 0.8, b: 0.5, a: 1, fade: 1, drag: 0, grav: 0 });
        for (let i = 0; i < 6 + 10 * size; i++) {
            const d = new THREE.Vector3(randn(), randn(), randn()).normalize(), sp = rnd(2, 9) * size;
            smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp + Sea.wind.x, vy: d.y * sp, vz: d.z * sp + Sea.wind.y,
                life: rnd(4, 8), s0: 2 * size, s1: rnd(6, 11) * size, r: 0.09, g: 0.085, b: 0.08, a: 0.7, fade: 1.3, drag: 2.2, grav: -0.05 });
        }
    },
    // Small-calibre round into the sea: a thin white spout
    smallSplash(x, y, z, size = 1) {
        for (let i = 0; i < 10 * size + 3; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(0.3, 1.6) * size;
            sprayFx.emit({ x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: rnd(3, 9) * Math.sqrt(size), vz: Math.sin(a) * sp,
                life: rnd(0.6, 1.3), s0: rnd(0.3, 0.6) * size, s1: rnd(0.9, 1.6) * size, r: 0.93, g: 0.96, b: 0.98, a: 0.8, fade: 1, drag: 0.4, grav: GRAVITY, floor: y - 0.2 });
        }
    },
    // Small-calibre hit on steel: a spray of sparks and a wisp of smoke
    spark(p, n = 10) {
        for (let i = 0; i < n; i++) {
            const d = new THREE.Vector3(randn(), Math.abs(randn()) * 0.6, randn()).normalize(), sp = rnd(8, 30);
            fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, life: rnd(0.2, 0.5),
                s0: rnd(0.3, 0.6), s1: 0.15, r: 1, g: 0.85, b: 0.5, a: 1, fade: 0.8, drag: 1, grav: GRAVITY });
        }
        smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: Sea.wind.x, vy: 1.5, vz: Sea.wind.y, life: rnd(1.5, 3), s0: 0.8, s1: 3.5,
            r: 0.35, g: 0.34, b: 0.33, a: 0.4, drag: 1, grav: -0.2 });
    },
    // Surface bubbles above a running torpedo
    bubbles(x, y, z, strength) {
        smokeFx.emit({ x: x + randn() * 0.4, y: y + 0.1, z: z + randn() * 0.4, vx: 0, vy: 0.2, vz: 0,
            life: rnd(5, 9), s0: 1.2, s1: 3.5, r: 0.9, g: 0.95, b: 0.97, a: 0.55 * strength, drag: 1, grav: 0 });
    }
};
