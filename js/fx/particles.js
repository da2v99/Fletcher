// Pooled GPU point particles (spray, smoke, fire) and the effect recipes built on them.

function createParticleSystem(maxCount, blending) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxCount * 3), col = new Float32Array(maxCount * 3);
    const size = new Float32Array(maxCount), alpha = new Float32Array(maxCount);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: new THREE.CanvasTexture(c) }, scale: { value: 800 } },
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
        emit(p) { if (list.length < maxCount) list.push(Object.assign({ age: 0 }, p)); },
        clear() { list.length = 0; },
        update(dt, scaleValue) {
            mat.uniforms.scale.value = scaleValue;
            for (let i = list.length - 1; i >= 0; i--) {
                const p = list[i];
                p.age += dt;
                if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
                const damp = Math.exp(-p.drag * dt);
                p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.grav * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            }
            let n = 0;
            for (const p of list) {
                const t = p.age / p.life;
                pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
                col[n * 3] = p.r; col[n * 3 + 1] = p.g; col[n * 3 + 2] = p.b;
                size[n] = lerp(p.s0, p.s1, Math.sqrt(t));
                alpha[n] = p.a * Math.min(1, t * 12) * (1 - t) * (1 - t);
                n++;
            }
            geo.setDrawRange(0, n);
            ['position', 'pcolor', 'psize', 'palpha'].forEach(k => { geo.attributes[k].needsUpdate = true; });
        }
    };
}

let smokeFx, fireFx, muzzleLight;

function initEffects() {
    smokeFx = createParticleSystem(9000, THREE.NormalBlending);
    fireFx = createParticleSystem(3000, THREE.AdditiveBlending);
    scene.add(smokeFx.points, fireFx.points);
    muzzleLight = new THREE.PointLight(0xffa655, 0, 90, 2);
    scene.add(muzzleLight);
}

function updateEffects(dt) {
    const pxScale = window.innerHeight / (2 * Math.tan(camera.fov * DEG / 2));
    smokeFx.update(dt, pxScale);
    fireFx.update(dt, pxScale);
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
}

const WHITE_SPRAY = [0.93, 0.96, 0.98];

const FX = {
    // Shell splash; IJN shells carried dye so each ship could spot its own fall of shot
    splash(x, y, z, tint = WHITE_SPRAY, scale = 1) {
        const [r, g, b] = tint;
        for (let i = 0; i < 70 * scale; i++) {
            const a = Math.random() * Math.PI * 2, rr = rnd(0, 2.2) * scale;
            smokeFx.emit({ x: x + Math.cos(a) * rr, y, z: z + Math.sin(a) * rr, vx: Math.cos(a) * rnd(0, 2.5), vy: rnd(12, 30) * Math.sqrt(scale), vz: Math.sin(a) * rnd(0, 2.5),
                life: rnd(2.2, 3.8), s0: rnd(2, 4) * scale, s1: rnd(6, 11) * scale, r, g, b, a: 0.9, drag: 0.35, grav: GRAVITY });
        }
        for (let i = 0; i < 28 * scale; i++) {
            const a = Math.random() * Math.PI * 2;
            smokeFx.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * rnd(4, 9) * scale, vy: rnd(1, 4), vz: Math.sin(a) * rnd(4, 9) * scale,
                life: rnd(1.5, 2.6), s0: 4 * scale, s1: rnd(9, 13) * scale, r: 0.9, g: 0.94, b: 0.96, a: 0.7, drag: 1.2, grav: 2 });
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
    explosion(p, scale = 1) {
        for (let i = 0; i < 45 * scale; i++) {
            fireFx.emit({ x: p.x, y: p.y, z: p.z, vx: randn() * 12 * scale, vy: rnd(4, 22) * scale, vz: randn() * 12 * scale,
                life: rnd(0.3, 0.9), s0: rnd(4, 7) * scale, s1: rnd(9, 15) * scale, r: 1.0, g: rnd(0.45, 0.7), b: 0.2, a: 1.0, drag: 2.5, grav: 2 });
        }
        for (let i = 0; i < 40 * scale; i++) {
            smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: randn() * 5, vy: rnd(3, 12), vz: randn() * 5,
                life: rnd(4, 8), s0: rnd(4, 7), s1: rnd(18, 30) * scale, r: 0.16, g: 0.15, b: 0.14, a: 0.8, drag: 0.8, grav: -0.6 });
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
