// Pooled GPU point particles (spray, smoke, fire) and the effect recipes built on them.
// Particle fields: position / velocity, life, s0 -> s1 size, colour r g b (optionally fading to r1 g1 b1),
// alpha a, drag, grav; optional: delay (s before it appears), fade (alpha fall-off power, default 2),
// floor (a y it can't fall through: it stops there and fades out quickly, e.g. spray landing on the sea).

// Sprite textures: 'soft' round glow (fire), 'puff' lumpy cloud (smoke, mist), 'spray' grainy droplets (water)
function particleTexture(kind) {
    const N = 128, c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const blob = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    if (kind === 'soft') {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, N, N);
    } else if (kind === 'puff') {
        blob(64, 64, 40, 0.5);
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.random() * 28;
            blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 14 + Math.random() * 18, 0.35);
        }
    } else {
        blob(64, 64, 34, 0.45);
        for (let i = 0; i < 90; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.pow(Math.random(), 0.7) * 54;
            blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + Math.random() * 5 * (1 - d / 64), 0.9);
        }
    }
    // Fade the edges so no square corners show
    ctx.globalCompositeOperation = 'destination-in';
    const e = ctx.createRadialGradient(64, 64, 40, 64, 64, 64);
    e.addColorStop(0, 'rgba(0,0,0,1)');
    e.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = e;
    ctx.fillRect(0, 0, N, N);
    return new THREE.CanvasTexture(c);
}

function createParticleSystem(maxCount, blending, texture = 'soft') {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxCount * 3), col = new Float32Array(maxCount * 3);
    const size = new Float32Array(maxCount), alpha = new Float32Array(maxCount);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
        // Fog: the scene's own colour object (shared, so it follows the weather and the view) and density
        uniforms: { map: { value: particleTexture(texture) }, scale: { value: 800 }, fogCol: { value: scene.fog.color }, fogDen: { value: 0 },
            additive: { value: blending === THREE.AdditiveBlending ? 1 : 0 } },
        vertexShader: `
            attribute vec3 pcolor;
            attribute float psize;
            attribute float palpha;
            uniform float scale;
            uniform float fogDen;
            varying vec3 vC;
            varying float vA;
            varying float vFog;
            void main() {
                vC = pcolor; vA = palpha;
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
            varying vec3 vC;
            varying float vA;
            varying float vFog;
            void main() {
                float a = texture2D(map, gl_PointCoord).a * vA;
                if (additive > 0.5) a *= 1.0 - vFog;   // glows fade out; smoke and spray take on the haze
                if (a < 0.003) discard;
                gl_FragColor = vec4(additive > 0.5 ? vC : mix(vC, fogCol, vFog), a);
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
            if (list.length < maxCount) list.push(Object.assign({ age: -(p.delay || 0) }, p));
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
                p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.grav * dt;
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
                else { const c = Math.min(1, t * (p.cs || 1)); col[n * 3] = lerp(p.r, p.r1, c); col[n * 3 + 1] = lerp(p.g, p.g1, c); col[n * 3 + 2] = lerp(p.b, p.b1, c); }
                size[n] = lerp(p.s0, p.s1, Math.sqrt(t));
                alpha[n] = p.a * Math.min(1, t * 12) * Math.pow(1 - t, p.fade || 2);
                n++;
            }
            geo.setDrawRange(0, n);
            // Upload only the live part of each buffer
            if (n > 0) {
                const A = geo.attributes;
                A.position.updateRange.count = n * 3; A.pcolor.updateRange.count = n * 3;
                A.psize.updateRange.count = n; A.palpha.updateRange.count = n;
                A.position.needsUpdate = A.pcolor.needsUpdate = A.psize.needsUpdate = A.palpha.needsUpdate = true;
            }
        }
    };
}

let smokeFx, fireFx, sprayFx, muzzleLight, blastLight;
const shockwaves = [];
let shockGeo, shockMat;

function initEffects() {
    smokeFx = createParticleSystem(9000, THREE.NormalBlending, 'puff');
    sprayFx = createParticleSystem(22000, THREE.NormalBlending, 'spray');
    fireFx = createParticleSystem(5000, THREE.AdditiveBlending);
    scene.add(smokeFx.points, sprayFx.points, fireFx.points);
    muzzleLight = new THREE.PointLight(0xffa655, 0, 90, 2);
    blastLight = new THREE.PointLight(0xff9a40, 0, 160, 2);
    scene.add(muzzleLight, blastLight);
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
    // Water plume from anything hitting the sea at speed. A shell's energy throws up a column that keeps
    // building for a fraction of a second (water is still being thrown up as it rises), hangs, spreads into a
    // ragged head and collapses as a curtain of spray, leaving a skirt of white water and mist drifting
    // downwind. H: height (m), R: column radius, k: particle scale, n: density (1 = a 5" shell's)
    plume(x, y, z, H, R, k, n = 1) {
        const vMax = Math.sqrt(2 * GRAVITY * H);
        const wx = Sea.wind.x * 2.5, wz = Sea.wind.y * 2.5;
        const floor = y - 0.3;
        const W = 0.95;
        // Column: built over ~0.3 s, fastest in the middle so it rises as a tapering spike
        for (let i = 0; i < 300 * n; i++) {
            const a = Math.random() * Math.PI * 2, f = Math.sqrt(Math.random()), rr = f * R;
            const vy = vMax * (1 - 0.75 * f * f) * rnd(0.72, 1.05);
            const shade = rnd(0.84, 1) * W;
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + rnd(0, 0.6), z: z + Math.sin(a) * rr, delay: Math.pow(Math.random(), 1.6) * 0.3,
                vx: Math.cos(a) * rnd(0.3, 2.2) * k, vy, vz: Math.sin(a) * rnd(0.3, 2.2) * k,
                life: 2 * vy / GRAVITY + rnd(0.6, 1.4), s0: rnd(1.0, 1.8) * k, s1: rnd(3.2, 5.5) * k,
                r: shade, g: shade, b: shade * 1.02, a: 0.85, fade: 1.1, drag: 0.22, grav: GRAVITY, floor });
        }
        // Head: the top of the column bursts outward into a ragged crown of spray
        for (let i = 0; i < 90 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(2, 7) * k;
            const vy = vMax * rnd(0.82, 1.0);
            sprayFx.emit({ x, y: y + 0.5, z, delay: rnd(0, 0.12), vx: Math.cos(a) * sp, vy, vz: Math.sin(a) * sp,
                life: 2 * vy / GRAVITY + rnd(0.5, 1.2), s0: rnd(1.4, 2.4) * k, s1: rnd(4.5, 7.5) * k,
                r: W, g: W, b: W, a: 0.7, fade: 1.3, drag: 0.5, grav: GRAVITY, floor });
        }
        // Crown: droplets flung up and out at the moment of impact
        for (let i = 0; i < 110 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(5, 15) * k;
            sprayFx.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rnd(0.35, 0.8) * vMax, vz: Math.sin(a) * sp,
                life: rnd(1.4, 3.0) * Math.sqrt(H / 30), s0: rnd(0.3, 0.6) * k, s1: rnd(0.7, 1.4) * k,
                r: W, g: W, b: W, a: 0.95, fade: 0.8, drag: 0.3, grav: GRAVITY, floor });
        }
        // Base surge: a low ring of white water rolling outwards
        for (let i = 0; i < 70 * n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(4, 11) * k;
            sprayFx.emit({ x: x + Math.cos(a) * R, y: y + 0.4, z: z + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: rnd(0.8, 2.8) * k, vz: Math.sin(a) * sp,
                life: rnd(1.6, 3.2), s0: 1.6 * k, s1: rnd(4.5, 7) * k, r: 0.92, g: 0.95, b: 0.97, a: 0.55, drag: 1.4, grav: 1.5 });
        }
        // Mist: hangs at every height of the column as it falls, then drifts off downwind
        for (let i = 0; i < 55 * n; i++) {
            const hgt = Math.pow(Math.random(), 0.7) * H;
            smokeFx.emit({ x: x + randn() * R * 1.2, y: y + hgt, z: z + randn() * R * 1.2, vx: wx + randn() * 0.7, vy: rnd(-0.6, 0.3), vz: wz + randn() * 0.7,
                delay: rnd(0.5, 2.0) * Math.sqrt(H / 30), life: rnd(4, 9), s0: rnd(3, 5) * k, s1: rnd(10, 18) * k,
                r: 0.93, g: 0.95, b: 0.97, a: 0.24, fade: 1.6, drag: 1.2, grav: 0.12 });
        }
        // Foam patch left on the water
        for (let i = 0; i < 26 * n; i++) {
            const a = Math.random() * Math.PI * 2, rr = rnd(0, 2.4) * R;
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + 0.2, z: z + Math.sin(a) * rr, vx: wx * 0.3 + Math.cos(a) * 0.8, vy: 0, vz: wz * 0.3 + Math.sin(a) * 0.8,
                delay: rnd(0.6, 1.8), life: rnd(6, 11), s0: rnd(2, 3.5) * k, s1: rnd(5, 8) * k, r: 0.9, g: 0.95, b: 0.97, a: 0.5, fade: 1.2, drag: 0.6, grav: 0 });
        }
    },
    // Shell splash: a 5" shell throws water ~30 m up; scale 2.6 is a torpedo. Always white water (tint kept
    // for callers, not used)
    splash(x, y, z, tint = WHITE_SPRAY, scale = 1) {
        FX.plume(x, y, z, 31 * Math.pow(scale, 0.8), 2.3 * Math.sqrt(scale), Math.sqrt(scale), scale);
    },
    // 40 mm (big) or 20 mm round into the sea: a high-velocity round still throws a 6-12 m plume
    aaSplash(x, y, z, big) {
        FX.plume(x, y, z, big ? rnd(9, 13) : rnd(5.5, 8), big ? 0.65 : 0.45, big ? 0.5 : 0.38, big ? 0.16 : 0.1);
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
    burn(p, intensity) {
        smokeFx.emit({ x: p.x + randn() * 2, y: p.y, z: p.z + randn() * 2, vx: 2.5 + randn(), vy: rnd(3, 7), vz: 1.2 + randn(),
            life: rnd(6, 11), s0: rnd(3, 6), s1: rnd(20, 34), r: 0.14, g: 0.13, b: 0.13, a: 0.55 * intensity, drag: 0.3, grav: -0.3 });
        if (Math.random() < 0.6 * intensity) fireFx.emit({ x: p.x + randn() * 1.5, y: p.y, z: p.z + randn() * 1.5, vx: randn(), vy: rnd(2, 6), vz: randn(),
            life: rnd(0.3, 0.7), s0: rnd(2.5, 4.5), s1: rnd(4, 7), r: 1.0, g: 0.5, b: 0.15, a: 0.9, drag: 1, grav: -1 });
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
