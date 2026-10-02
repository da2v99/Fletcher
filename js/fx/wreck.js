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

const Wreck = (() => {
    const MAX_HOLES = 24;
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
    const FRAG_DECL = `
        uniform vec4 uHoles[${MAX_HOLES}];
        uniform vec2 uCut;        // x: break z, y: which side is kept (+1 / -1), 0 = whole
        varying vec3 vWreckLocal;
        float wreckScorch;` + NOISE;
    const FRAG_MAIN = `
        wreckScorch = 0.0;
        for (int i = 0; i < ${MAX_HOLES}; i++) {
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
        #ifdef WRECK_INNER
            if (!gl_FrontFacing) diffuseColor.rgb *= 0.18;   // the inside of the hull, seen through a hole
        #endif`;

    function newUniforms() {
        return {
            uWreckMat: { value: new THREE.Matrix4() }, uWreckInv: { value: new THREE.Matrix4() },
            uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
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
                .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
                .replace('void main() {', 'void main() {\n' + FRAG_MAIN)
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
            maxTilt: opts.maxTilt || 0.55
        };
        rematerial(root, U, !!opts.ownMaterials, opts.inner || (() => false));
        root.userData.wreck = W;
        tracked.add(W);
        return W;
    }

    // ------------------------------------------------------------------ damage
    function addHole(W, local, r) {
        W.U.uHoles.value[W.holes % MAX_HOLES].set(local.x, local.y, local.z, r);
        W.holes++;
    }

    // Push the plating in round the hit: a crater in the mesh itself
    function dent(W, local, normal, R, depth) {
        const R2 = R * R;
        W.root.children.forEach(m => {
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
        addHole(W, local, (power >= 3 ? 1.2 : 0.42) * k * rnd(0.8, 1.2));
        if (power >= 2 && Math.random() < 0.7) addHole(W, _v.copy(local).addScaledVector(normal, -0.6).add(_w.set(randn(), randn() * 0.5, randn()).multiplyScalar(0.8 * k)), 0.7 * k);
        dent(W, local, normal, 1.6 + 1.5 * k, 0.22 * power);
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
        W.U.uCut.value.set(0, 0);
        W.U.uBend.value.set(0, 0, 0, 4);
        W.orig.forEach((arr, g) => { g.attributes.position.array.set(arr); g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); });
        tracked.add(W);
    }

    return { attach, hit, breakApart, pose, update, remove, repair, get: root => root.userData.wreck };
})();
