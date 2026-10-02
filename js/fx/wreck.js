// Structural damage to whole ships: hulls that hole, dent, sag and break in two.
//
// Holes: every material on a ship is extended (onBeforeCompile) to cut jagged spherical holes out of the
// plating wherever a shell or torpedo tore through, with scorched edges; through them you see the dark inside of
// the hull. Holes live in the ship's own frame, so they stay put as she rolls.
// Dents: the hit pushes the plating in around it (a crater in the actual mesh), crumpled with some noise.
// Sag: damage to the keel girder bends the whole hull about the worst of it, ends rising, middle sinking.
// Breaking: enough keel damage (a torpedo or two amidships, a magazine going up) breaks her in two. The ship is
// drawn twice, each copy cut away on one side of a torn, jagged line; each half pivots about the break with its
// end climbing out of the water as it goes down.
// Hits are found on the actual mesh (a ray along the round's path), so holes, craters and bullet holes land
// exactly where it struck: on the hull, a funnel, the bridge, a gun shield. Small-calibre rounds leave bullet
// holes (an instanced decal per ship); thin superstructure plating loses bigger chunks than the hull.

const Wreck = (() => {
    let MAX_HOLES = 0;   // set from the GPU's uniform budget on first use: 40, or 16 on small (phone) GPUs
    const holesCap = () => MAX_HOLES || (MAX_HOLES = renderer.capabilities.maxFragmentUniforms >= 400 ? 40 : 16);
    const BULLETS = 220;
    let rayBudget = 0;
    const _ray = new THREE.Raycaster();
    const tracked = new Set();
    const inject = new WeakMap();   // injected material -> { prev, key0, inner }
    const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _bp = new THREE.Vector3(),
        _X = new THREE.Vector3(1, 0, 0);

    const NOISE = `
        float wkH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float wkNoise(vec3 x) {
            vec3 i = floor(x), f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(wkH(i), wkH(i + vec3(1, 0, 0)), f.x), mix(wkH(i + vec3(0, 1, 0)), wkH(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(wkH(i + vec3(0, 0, 1)), wkH(i + vec3(1, 0, 1)), f.x), mix(wkH(i + vec3(0, 1, 1)), wkH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }`;
    const VERT_DECL = `
        uniform mat4 uWreckMat;
        uniform mat4 uWreckInv;
        uniform vec4 uBend;      // kink z, angle, pivot y, transition half-length
        varying vec3 vWreckLocal;
        vec3 wreckBend(vec3 p) {
            float t = smoothstep(-uBend.w, uBend.w, p.z - uBend.x);
            vec3 q = p - vec3(0.0, uBend.z, uBend.x);
            float a = mix(uBend.y, -uBend.y, t);
            float c = cos(a), s = sin(a);
            q = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
            return q + vec3(0.0, uBend.z, uBend.x);
        }`;
    const VERT_BODY = `
        {
            vec4 wkp = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                wkp = instanceMatrix * wkp;
            #endif
            wkp = modelMatrix * wkp;
            vec3 wkl = (uWreckInv * wkp).xyz;
            vWreckLocal = wkl;
            if (uBend.y != 0.0) {
                mvPosition = viewMatrix * (uWreckMat * vec4(wreckBend(wkl), 1.0));
                gl_Position = projectionMatrix * mvPosition;
            }
        }`;
    const FRAG_DECL = () => `
        uniform vec4 uHoles[${holesCap()}];
        uniform vec4 uHullDim;    // half-beam, half-depth, centre height: which way is 'out' of the hull
        uniform vec2 uCut;        // x: break z, y: which side is kept (+1 / -1), 0 = whole
        varying vec3 vWreckLocal;
        float wreckScorch;` + NOISE;
    const FRAG_MAIN = () => `
        wreckScorch = 0.0;
        for (int i = 0; i < ${holesCap()}; i++) {
            vec4 h = uHoles[i];
            if (h.w <= 0.0) break;
            vec3 d = vWreckLocal - h.xyz;
            float dist = length(d);
            if (dist > h.w * 3.0) continue;
            float r = h.w * (0.62 + 0.55 * wkNoise(vWreckLocal * (3.2 / h.w)) + 0.2 * wkNoise(vWreckLocal * (9.0 / h.w)));
            if (dist < r) discard;
            wreckScorch = max(wreckScorch, 1.0 - smoothstep(r, r * 2.3, dist));
        }
        if (uCut.y != 0.0) {
            float e = (vWreckLocal.z - uCut.x) * uCut.y + (wkNoise(vWreckLocal * 0.55) - 0.5) * 3.2 + (wkNoise(vWreckLocal * 2.7) - 0.5) * 0.9;
            if (e < 0.0) discard;
            wreckScorch = max(wreckScorch, 1.0 - smoothstep(0.0, 2.2, e));
        }`;
    const FRAG_COLOR = `
        diffuseColor.rgb *= 1.0 - 0.82 * wreckScorch;
        // The inside of the hull, seen through a hole: the side of the plating facing the camera (screen-space
        // normal) points into the hull's cross-section rather than out of it
        #if defined(WRECK_INNER) && __VERSION__ >= 300
        {
            vec3 wn = normalize(cross(dFdx(vWreckLocal), dFdy(vWreckLocal)));
            vec3 outw = vec3(vWreckLocal.x / (uHullDim.x * uHullDim.x), (vWreckLocal.y - uHullDim.z) / (uHullDim.y * uHullDim.y), 0.0);
            if (dot(wn, outw) < 0.0) diffuseColor.rgb *= 0.2;
        }
        #endif`;

    function newUniforms() {
        return {
            uWreckMat: { value: new THREE.Matrix4() }, uWreckInv: { value: new THREE.Matrix4() },
            uHoles: { value: Array.from({ length: holesCap() }, () => new THREE.Vector4(0, 0, 0, 0)) },
            uHullDim: { value: new THREE.Vector4(6, 4.5, 0.5, 0) },
            uCut: { value: new THREE.Vector2(0, 0) }, uBend: { value: new THREE.Vector4(0, 0, 0, 4) }
        };
    }

    function wrap(mat, U, base) {
        mat.onBeforeCompile = function (sh, r) {
            if (base.prev) base.prev.call(this, sh, r);
            Object.assign(sh.uniforms, U);
            sh.vertexShader = (base.inner ? '#define WRECK_INNER\n' : '') + sh.vertexShader
                .replace('#include <common>', '#include <common>\n' + VERT_DECL)
                .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
            sh.fragmentShader = (base.inner ? '#define WRECK_INNER\n' : '') + sh.fragmentShader
                .replace('#include <common>', '#include <common>\n' + FRAG_DECL())
                .replace('void main() {', 'void main() {\n' + FRAG_MAIN())
                .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
        };
        mat.customProgramCacheKey = () => base.key0 + (base.inner ? '|wreckI' : '|wreck');
        mat.needsUpdate = true;
        inject.set(mat, base);
        return mat;
    }
    // The material's own shader hook and cache key, taken before we wrap it (clones reuse the original's)
    const baseOf = (m, inner) => inject.get(m) || { prev: m.onBeforeCompile, key0: m.customProgramCacheKey(), inner: !!inner };
    function cloneInjected(mat, U) { return wrap(mat.clone(), U, baseOf(mat)); }

    // Wire every material on this ship to this ship's uniforms: in place when they are hers alone (our
    // Fletcher), else as her own copies (enemy types share materials between ships)
    function rematerial(root, U, own, isInner) {
        const map = new Map();
        root.traverse(o => {
            if (!o.material || o.isPoints || o.isSprite) return;
            const one = m => {
                if (!map.has(m)) {
                    const base = baseOf(m, isInner(m));
                    map.set(m, wrap(own ? m : m.clone(), U, base));
                }
                return map.get(m);
            };
            o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        });
    }

    // Object3D.clone() deep-copies userData through JSON, which can't take the object references ships keep
    // there: set it aside while cloning
    function cloneBare(root) {
        const saved = [];
        root.traverse(o => { saved.push([o, o.userData]); o.userData = {}; });
        const c = root.clone(true);
        saved.forEach(([o, u]) => { o.userData = u; });
        return c;
    }

    // ------------------------------------------------------------------ attaching
    function attach(root, opts = {}) {
        const U = newUniforms();
        const W = {
            root, U, holes: 0, keel: 0, keelZ: 0, keelW: 0, broken: false, breakT: 0, cutZ: 0, half: null,
            len: opts.len || SHIP_LENGTH, beam: opts.beam || SHIP_BEAM, own: new Set(), orig: new Map(), sharedGeo: !!opts.sharedGeo,
            maxTilt: opts.maxTilt || 0.55, deckY: opts.deckY || (() => 4.5), bullets: new Map()
        };
        U.uHullDim.value.set(W.beam / 2, opts.halfDepth || 4.6, opts.midY || 0.5, 0);
        rematerial(root, U, !!opts.ownMaterials, opts.inner || (() => false));
        root.userData.wreck = W;
        tracked.add(W);
        return W;
    }

    // ------------------------------------------------------------------ damage
    function addHole(W, local, r) {
        const i = W.holes % holesCap();
        W.U.uHoles.value[i].set(local.x, local.y, local.z, r);
        if (W.half) W.half.U.uHoles.value[i].set(local.x, local.y, local.z, r);
        W.holes++;
    }

    // ------------------------------------------------------------------ where exactly a round struck
    // Cast along the round's path against the ship's real meshes (both halves once broken), skipping the parts
    // already shot away and the cut-off side of each half. Returns { root, local, normal (ship frame) } or null.
    const _m4 = new THREE.Matrix4(), _n = new THREE.Vector3(), _lp = new THREE.Vector3();
    function surfaceHit(root, from, dir, far) {
        const W = root.userData.wreck;
        if (!W) return null;
        const roots = W.half ? [W.root, W.half.root] : [W.root];
        _ray.set(from, dir);
        _ray.near = 0;
        _ray.far = far;
        let best = null;
        roots.forEach((r, ri) => {
            const t = [];
            r.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.name !== 'decal' && o.visible) t.push(o); });
            r.updateMatrixWorld(true);
            _m4.copy(r.matrixWorld).invert();
            const hits = _ray.intersectObjects(t, false);
            for (const h of hits) {
                if (best && h.distance >= best.dist) break;
                const l = _lp.copy(h.point).applyMatrix4(_m4);
                if (W.broken && (ri === 0 ? l.z < W.cutZ - 1.5 : l.z > W.cutZ + 1.5)) continue;
                let inHole = false;
                const H = W.U.uHoles.value;
                for (let i = 0; i < Math.min(W.holes, H.length); i++) if (H[i].w > 0 && l.distanceTo(_v.set(H[i].x, H[i].y, H[i].z)) < H[i].w * 0.75) { inHole = true; break; }
                if (inHole) continue;
                _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
                if (_n.dot(dir) > 0) _n.negate();
                best = { root: r, dist: h.distance, local: l.clone(), normal: _n.clone().transformDirection(_m4).normalize() };
                break;
            }
        });
        return best;
    }

    // ------------------------------------------------------------------ bullet holes
    let bulletTex = null;
    function makeBulletTex() {
        const N = 64, c = document.createElement('canvas');
        c.width = c.height = N;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 3, 32, 32, 31);
        g.addColorStop(0, 'rgba(20,18,16,0.95)'); g.addColorStop(0.35, 'rgba(40,36,32,0.55)'); g.addColorStop(1, 'rgba(40,36,32,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
        // Paint chipped back to bright steel round a jagged hole
        ctx.fillStyle = 'rgba(150,150,148,0.95)';
        ctx.beginPath();
        for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI * 2, r = 9 * (1 + (Math.random() - 0.5) * 0.6); ctx[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
        ctx.fill();
        ctx.fillStyle = 'rgba(5,5,5,1)';
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 2, r = 5.5 * (1 + (Math.random() - 0.5) * 0.5); ctx[i ? 'lineTo' : 'moveTo'](32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
        ctx.fill();
        const t = new THREE.CanvasTexture(c);
        t.anisotropy = 4;
        return t;
    }
    function bulletMesh(W, root) {
        let b = W.bullets.get(root);
        if (b) return b;
        if (!bulletTex) bulletTex = makeBulletTex();
        const U = root === W.root ? W.U : W.half.U;
        const mat = wrap(new THREE.MeshStandardMaterial({ map: bulletTex, transparent: true, depthWrite: false, roughness: 0.7, metalness: 0.4,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), U, baseOf(new THREE.MeshStandardMaterial()));
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, BULLETS);
        mesh.count = 0;
        mesh.name = 'decal';
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        root.add(mesh);
        b = { mesh, n: 0 };
        W.bullets.set(root, b);
        return b;
    }
    const _bm = new THREE.Matrix4(), _bqq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1), _bd = new THREE.Vector3();
    // A small-calibre round from `from` striking near `to`; size: hole diameter in metres (7.7 mm ~0.08 .. 40 mm ~0.5)
    function bullet(root, from, to, size) {
        const W = root.userData.wreck;
        if (!W || rayBudget <= 0) return false;
        rayBudget--;
        const d = _bd.subVectors(to, from);
        const len = d.length();
        if (len < 1e-3) return false;
        d.divideScalar(len);
        const s = surfaceHit(root, from.clone().addScaledVector(d, -2), d, len + 6);
        if (!s) return false;
        const b = bulletMesh(W, s.root);
        _bqq.setFromUnitVectors(_Z, s.normal);
        _bqq.multiply(new THREE.Quaternion().setFromAxisAngle(_Z, Math.random() * 6.28));
        _bm.compose(s.local.addScaledVector(s.normal, 0.012), _bqq, _bs.setScalar(size * rnd(0.8, 1.3)));
        b.mesh.setMatrixAt(b.n % BULLETS, _bm);
        b.n++;
        b.mesh.count = Math.min(b.n, BULLETS);
        b.mesh.instanceMatrix.needsUpdate = true;
        return true;
    }

    // Push the plating in round the hit: a crater in the mesh itself
    function dent(W, local, normal, R, depth) {
        const R2 = R * R;
        const parts = W.half ? W.root.children.concat(W.half.root.children) : W.root.children;
        parts.forEach(m => {
            if (!m.isMesh || m.isInstancedMesh || !m.geometry || !m.geometry.attributes.position) return;
            if (m.position.lengthSq() > 1e-6 || m.quaternion.w < 0.99999) return;   // only parts in the ship's own frame
            let g = m.geometry;
            if (!g.boundingSphere) g.computeBoundingSphere();
            if (g.boundingSphere.center.distanceTo(local) > g.boundingSphere.radius + R) return;
            if (!W.own.has(g)) {
                if (W.sharedGeo) { g = g.clone(); m.geometry = g; }
                W.own.add(g);
                W.orig.set(g, g.attributes.position.array.slice());
            }
            const p = g.attributes.position, a = p.array;
            let moved = false;
            for (let i = 0; i < p.count; i++) {
                const k = i * 3, dx = a[k] - local.x, dy = a[k + 1] - local.y, dz = a[k + 2] - local.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > R2) continue;
                const f = Math.pow(1 - Math.sqrt(d2) / R, 2);
                const crumple = (Math.sin(a[k] * 7.1 + a[k + 2] * 5.3) * Math.cos(a[k + 1] * 6.7 - a[k + 2] * 3.9)) * 0.35;
                const s = depth * f * (1 + crumple);
                a[k] -= normal.x * s; a[k + 1] -= normal.y * s; a[k + 2] -= normal.z * s;
                moved = true;
            }
            if (moved) {
                p.needsUpdate = true;
                g.computeVertexNormals();
                g.computeBoundingSphere();
            }
        });
    }

    // A hit at `local` (on the hull surface, ship frame) with outward `normal`; power 1 = 5" shell, ~4 = torpedo
    function hit(root, local, normal, power = 1) {
        const W = root.userData.wreck;
        if (!W) return;
        const k = Math.sqrt(power);
        // Thin superstructure plating (deckhouses, funnels, bridge, shields) loses whole chunks; the hull's
        // thicker side plating is holed and pushed in round the hole
        const upper = local.y > W.deckY(local.z) + 0.4;
        const r = (power >= 3 ? 1.3 : upper ? rnd(0.9, 1.5) : rnd(0.5, 0.8)) * k;
        addHole(W, _v.copy(local).addScaledVector(normal, upper ? -0.35 * r : -0.1 * r), r);
        if (upper && Math.random() < 0.6) addHole(W, _v.copy(local).addScaledVector(normal, -r * 1.1).add(_w.set(randn(), randn() * 0.6, randn()).multiplyScalar(0.5 * r)), r * rnd(0.6, 0.9));
        if (power >= 2 && Math.random() < 0.7) addHole(W, _v.copy(local).addScaledVector(normal, -0.6).add(_w.set(randn(), randn() * 0.5, randn()).multiplyScalar(0.8 * k)), 0.7 * k);
        dent(W, local, normal, 2.0 + 1.6 * k, (upper ? 0.45 : 0.3) * power);
        // The keel girder: hits low and amidships do the most harm to her back
        const mid = 1 - Math.min(1, Math.abs(local.z) / (W.len * 0.45));
        const low = local.y < 1.5 ? 1 : 0.35;
        const harm = power * power * 4 * (0.3 + 0.7 * mid) * low;
        W.keelZ = (W.keelZ * W.keelW + local.z * harm) / (W.keelW + harm);
        W.keelW += harm;
        W.keel += harm;
        if (!W.broken) W.U.uBend.value.set(W.keelZ, Math.min(0.075, W.keel / 100 * 0.075), 0, W.len * 0.06);
        return W.keel;
    }

    // ------------------------------------------------------------------ breaking in two
    function breakApart(root, cutZ) {
        const W = root.userData.wreck;
        if (!W || W.broken) return;
        W.broken = true;
        W.breakT = 0;
        W.cutZ = cutZ === undefined ? THREE.MathUtils.clamp(W.keelZ || 0, -W.len * 0.25, W.len * 0.25) : cutZ;
        W.U.uBend.value.y = 0;
        W.U.uCut.value.set(W.cutZ, 1);   // this copy keeps the bow
        const half = cloneBare(root);
        const U2 = newUniforms();
        U2.uHoles.value.forEach((h, i) => h.copy(W.U.uHoles.value[i]));
        U2.uCut.value.set(W.cutZ, -1);   // the copy keeps the stern
        U2.uHullDim.value.copy(W.U.uHullDim.value);
        const map = new Map();
        half.traverse(o => {
            if (!o.material || o.isPoints) return;
            const one = m => { if (!map.has(m)) map.set(m, cloneInjected(m, U2)); return map.get(m); };
            o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        });
        root.parent.add(half);
        W.half = { root: half, U: U2 };
        tracked.add(W);
        // The break: a blast of fire, smoke and wreckage out of the torn hull
        const p = root.localToWorld(_v.set(0, 1.5, W.cutZ));
        FX.explosion(p, 2.4);
        FX.fuelBlast(p, 0.6);
        playBoom(p, 2, 260, 4.5);
        Debris.burst(p, 46, 1.2, { speed: 1.3, smoky: 0.6, burning: 0.5 });
        Debris.burst(p, 24, 0.9, { speed: 0.6, kind: 4 });
        if (typeof cameraShake === 'function' && root === myShip) cameraShake(2.5);
    }

    // Each frame, after the ship's pose is set: the two halves pivot about the break, ends climbing as the
    // middle goes down, drifting a little apart
    function pose(root, dt) {
        const W = root.userData.wreck;
        if (!W || !W.broken) return;
        W.breakT += dt;
        const th = W.maxTilt * smooth(0, 1, W.breakT / 28) + 0.04 * Math.sin(W.breakT * 0.4);
        const gap = Math.min(5, W.breakT * 0.25);
        _bq.copy(root.quaternion);
        _bp.copy(root.position);
        const piv = _w.set(0, 0, W.cutZ);
        const place = (obj, phi, shift) => {
            _q.setFromAxisAngle(_X, phi);
            obj.quaternion.copy(_bq).multiply(_q);
            _v.copy(piv).applyQuaternion(_q).negate().add(piv);
            _v.z += shift;
            obj.position.copy(_v.applyQuaternion(_bq)).add(_bp);
            obj.updateMatrixWorld(true);
        };
        place(W.half.root, th, -gap);
        place(root, -th, gap);
    }

    function update() {
        rayBudget = 8;   // bullet-hole ray casts per frame
        tracked.forEach(W => {
            if (!W.root.parent) { tracked.delete(W); if (W.half && W.half.root.parent) W.half.root.parent.remove(W.half.root); return; }
            W.root.updateMatrixWorld(true);
            W.U.uWreckMat.value.copy(W.root.matrixWorld);
            W.U.uWreckInv.value.copy(W.root.matrixWorld).invert();
            if (W.half) {
                W.half.U.uWreckMat.value.copy(W.half.root.matrixWorld);
                W.half.U.uWreckInv.value.copy(W.half.root.matrixWorld).invert();
            }
        });
    }

    function remove(root) {
        const W = root.userData.wreck;
        if (!W) return;
        if (W.half && W.half.root.parent) W.half.root.parent.remove(W.half.root);
        if (W.sharedGeo && !root.parent) { W.own.forEach(g => g.dispose()); W.own.clear(); W.orig.clear(); }   // her dented copies
    }

    // A fresh hull for a new game: holes filled, dents knocked out, back straight, in one piece
    function repair(root) {
        const W = root.userData.wreck;
        if (!W) return;
        remove(root);
        W.half = null;
        W.broken = false;
        W.holes = W.keel = W.keelZ = W.keelW = 0;
        W.U.uHoles.value.forEach(h => h.set(0, 0, 0, 0));
        W.bullets.forEach((b, r) => { b.n = 0; b.mesh.count = 0; });
        W.U.uCut.value.set(0, 0);
        W.U.uBend.value.set(0, 0, 0, 4);
        W.orig.forEach((arr, g) => { g.attributes.position.array.set(arr); g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); });
        tracked.add(W);
    }

    return { attach, hit, surfaceHit, bullet, breakApart, pose, update, remove, repair, get: root => root.userData.wreck };
})();
