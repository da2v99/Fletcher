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
        uniforms: { map: { value: particleTexture(texture) }, scale: { value: 800 } },
        vertexShader: `
            attribute vec3 pcolor;
            attribute float psize;
            attribute float palpha;
            uniform float scale;
            varying vec3 vC;
            varying float vA;
            void main() {
                vC = pcolor; vA = palpha;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = psize * scale / max(-mv.z, 0.1);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            varying vec3 vC;
            varying float vA;
            void main() {
                float a = texture2D(map, gl_PointCoord).a * vA;
                if (a < 0.003) discard;
                gl_FragColor = vec4(vC, a);
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
        emit(p) { if (list.length < maxCount) list.push(Object.assign({ age: -(p.delay || 0) }, p)); },
        clear() { list.length = 0; },
        update(dt, scaleValue) {
            mat.uniforms.scale.value = scaleValue;
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
            ['position', 'pcolor', 'psize', 'palpha'].forEach(k => { geo.attributes[k].needsUpdate = true; });
        }
    };
}

let smokeFx, fireFx, sprayFx, muzzleLight, blastLight;
const shockwaves = [];
let shockGeo, shockMat;

function initEffects() {
    smokeFx = createParticleSystem(9000, THREE.NormalBlending, 'puff');
    sprayFx = createParticleSystem(14000, THREE.NormalBlending, 'spray');
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
    // Shell splash: a fast crown of spray, a tall column that slows, hangs and collapses, a base surge racing
    // out over the water, then drifting mist and a foam patch. A 5" shell throws up ~20-25 m; scale 2.6 is a
    // torpedo. IJN shells carried dye so each ship could spot its own fall of shot.
    splash(x, y, z, tint = WHITE_SPRAY, scale = 1) {
        const [r, g, b] = tint;
        const H = 23 * Math.pow(scale, 0.8), vMax = Math.sqrt(2 * GRAVITY * H), R = 2.2 * Math.sqrt(scale);
        const wx = Sea.wind.x * 2.5, wz = Sea.wind.y * 2.5;   // spray drifts downwind
        const floor = y - 0.3, k = Math.sqrt(scale);
        // Column: fastest in the middle, so it rises as a tapering spike and then slumps
        for (let i = 0; i < 260 * scale; i++) {
            const a = Math.random() * Math.PI * 2, f = Math.sqrt(Math.random()), rr = f * R;
            const vy = vMax * (1 - 0.8 * f * f) * rnd(0.7, 1.04);
            const shade = rnd(0.86, 1);
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + rnd(0, 0.8), z: z + Math.sin(a) * rr,
                vx: Math.cos(a) * rnd(0.2, 1.8) * k, vy, vz: Math.sin(a) * rnd(0.2, 1.8) * k,
                life: 2 * vy / GRAVITY + rnd(0.4, 1.0), s0: rnd(0.9, 1.6) * k, s1: rnd(2.6, 4.4) * k,
                r: r * shade, g: g * shade, b: b * shade, a: 0.8, fade: 1.2, drag: 0.1, grav: GRAVITY, floor });
        }
        // Crown: droplets flung up and out at the moment of impact
        for (let i = 0; i < 120 * scale; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(5, 15) * k;
            sprayFx.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rnd(7, 19) * k, vz: Math.sin(a) * sp,
                life: rnd(1.4, 3.0), s0: rnd(0.3, 0.6) * k, s1: rnd(0.7, 1.3) * k,
                r, g, b, a: 0.95, fade: 0.8, drag: 0.3, grav: GRAVITY, floor });
        }
        // Base surge: a low ring of spray rolling outwards
        for (let i = 0; i < 60 * scale; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(4, 11) * k;
            sprayFx.emit({ x: x + Math.cos(a) * R, y: y + 0.4, z: z + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: rnd(0.8, 2.6), vz: Math.sin(a) * sp,
                life: rnd(1.6, 3.0), s0: 1.6 * k, s1: rnd(4, 6.5) * k, r: 0.9, g: 0.94, b: 0.96, a: 0.55, drag: 1.4, grav: 1.5 });
        }
        // Mist left hanging as the column falls, drifting downwind
        for (let i = 0; i < 40 * scale; i++) {
            const hgt = rnd(0.05, 0.8) * H;
            smokeFx.emit({ x: x + randn() * R, y: y + hgt, z: z + randn() * R, vx: wx + randn() * 0.6, vy: rnd(-0.5, 0.4), vz: wz + randn() * 0.6,
                delay: rnd(0.8, 2.4) * k, life: rnd(4, 8), s0: rnd(3, 5) * k, s1: rnd(9, 15) * k,
                r: lerp(0.92, r, 0.5), g: lerp(0.95, g, 0.5), b: lerp(0.97, b, 0.5), a: 0.22, fade: 1.6, drag: 1.2, grav: 0.1 });
        }
        // Foam patch left on the water
        for (let i = 0; i < 26 * scale; i++) {
            const a = Math.random() * Math.PI * 2, rr = rnd(0, 2.2) * R;
            sprayFx.emit({ x: x + Math.cos(a) * rr, y: y + 0.2, z: z + Math.sin(a) * rr, vx: wx * 0.3 + Math.cos(a) * 0.8, vy: 0, vz: wz * 0.3 + Math.sin(a) * 0.8,
                delay: rnd(0.6, 1.8), life: rnd(6, 11), s0: rnd(2, 3.5) * k, s1: rnd(5, 8) * k, r: 0.9, g: 0.95, b: 0.97, a: 0.5, fade: 1.2, drag: 0.6, grav: 0 });
        }
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
    // Surface bubbles above a running torpedo
    bubbles(x, y, z, strength) {
        smokeFx.emit({ x: x + randn() * 0.4, y: y + 0.1, z: z + randn() * 0.4, vx: 0, vy: 0.2, vz: 0,
            life: rnd(5, 9), s0: 1.2, s1: 3.5, r: 0.9, g: 0.95, b: 0.97, a: 0.55 * strength, drag: 1, grav: 0 });
    }
};
