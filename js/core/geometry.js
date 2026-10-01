// Small geometry helpers shared by every model builder (player ship, enemies, effects).

// --- Generic geometry helpers ---

function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
}
const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
function CylZ(rt, rb, h, seg = 12) { const g = Cyl(rt, rb, h, seg); g.rotateX(Math.PI / 2); return g; }   // axis along +Z (rt at +Z end)
function CylX(r, h, seg = 12) { const g = Cyl(r, r, h, seg); g.rotateZ(Math.PI / 2); return g; }

// Cylinder between two points
function strut(parent, p1, p2, r, mat, seg = 6) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const m = addMesh(parent, Cyl(r, r, len, seg), mat);
    m.position.copy(p1).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
}

// Closed solid from a bottom and top outline ([x, z] pairs, same count, convex)
function loftPrism(bottom, y0, top, y1) {
    const B = bottom.map(p => new THREE.Vector3(p[0], y0, p[1]));
    const T = top.map(p => new THREE.Vector3(p[0], y1, p[1]));
    const n = B.length, pos = [];
    const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(B[i], B[j], T[j]);
        tri(B[i], T[j], T[i]);
    }
    for (let i = 1; i < n - 1; i++) {
        tri(T[0], T[i], T[i + 1]);
        tri(B[0], B[i + 1], B[i]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
}
const prism = (outline, y0, y1) => loftPrism(outline, y0, outline, y1);

// Rectangle with a semi-elliptical front: back edge at zBack, straight sides to zStraight, front bulge of depth
function roundFrontOutline(hw, zBack, zStraight, depth, segs = 10) {
    const pts = [[-hw, zBack], [hw, zBack]];
    for (let i = 0; i <= segs; i++) {
        const a = Math.PI * i / segs;
        pts.push([hw * Math.cos(a), zStraight + depth * Math.sin(a)]);
    }
    return pts;
}

// Deckhouse whose floor and roof follow the main-deck sheer (like the real 01 level)
function makeDeckhouse(zF, zB, hwFn, H) {
    const pos = [];
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const N = Math.max(2, Math.ceil((zF - zB) / 0.4));
    const ring = z => {
        const w = hwFn(z), yb = sheerY(z) - 0.6, yt = sheerY(z) + H;
        return [[-w, yb, z], [w, yb, z], [w, yt, z], [-w, yt, z]];
    };
    let prev = ring(zB);
    quad(prev[0], prev[1], prev[2], prev[3]);
    for (let i = 1; i <= N; i++) {
        const cur = ring(zB + (zF - zB) * i / N);
        quad(prev[1], cur[1], cur[2], prev[2]);
        quad(prev[2], cur[2], cur[3], prev[3]);
        quad(prev[3], cur[3], cur[0], prev[0]);
        prev = cur;
    }
    quad(prev[0], prev[1], prev[2], prev[3]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
}

// See-through grid texture for radar arrays / gratings
let gridBaseTex = null;
function gridMaterial(repX, repY, color = 0x3a3f44) {
    if (!gridBaseTex) {
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d');
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, 32, 32);
        gridBaseTex = new THREE.CanvasTexture(c);
    }
    const tex = gridBaseTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);
    return new THREE.MeshStandardMaterial({ color, map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.3 });
}

// Hex colour -> 'vec3(r, g, b)' for shader snippets
const glslColor = hex => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };

// Measure 22: haze grey on vertical surfaces, deck blue on everything that faces the sky
function measure22(mat) {
    mat.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vUp;')
            .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vUp;')
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
                `vec4 diffuseColor = vec4(mix(diffuse, ${glslColor(DECK_BLUE)}, smoothstep(0.82, 0.95, abs(vUp))), opacity);`);
    };
    return mat;
}

// Painted steel with procedural weathering: soot and grime pooling low, rust streaks running down from
// seams and fittings, chipped lighter edges. Works in object space so each part weathers on its own.
function weathered(mat, amount = 1) {
    mat.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec3 vObjPos;
                float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float wNoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
                }`)
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
                vec3 wp = vObjPos;
                float across = wp.x + wp.z * 0.93;
                float blotch = wNoise(wp.xz * 1.7 + wp.y * 0.6) * 0.6 + wNoise(vec2(across, wp.y) * 5.0) * 0.4;
                // Vertical streaks: narrow columns, stronger lower down
                float col = wNoise(vec2(across * 9.0, wp.y * 0.35));
                float streak = smoothstep(0.62, 0.95, col) * (0.55 + 0.45 * wNoise(vec2(across * 3.0, wp.y * 2.0)));
                float grime = clamp((0.9 - wp.y) * 0.25, 0.0, 0.3) + (blotch - 0.5) * 0.18;
                vec3 c = diffuse * (1.0 - ${amount.toFixed(2)} * (grime + streak * 0.22));
                c = mix(c, vec3(0.42, 0.28, 0.2) * 0.8, ${amount.toFixed(2)} * streak * 0.18 * wNoise(vec2(across * 21.0, wp.y * 4.0)));
                vec4 diffuseColor = vec4(c, opacity);`);
    };
    return mat;
}

function createMaterials() {
    const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.72, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }, o));
    return {
        gray: measure22(std(HAZE_GRAY)),
        grayDark: std(0x6b737c),
        grayLight: std(0x969ea6),
        turret: weathered(std(0x7f878f, { roughness: 0.85 })),
        turretDark: weathered(std(0x737b84, { roughness: 0.8 })),
        canvasBag: weathered(std(0xcbbd98, { roughness: 1.0, flatShading: false }), 0.8),
        deck: new THREE.MeshStandardMaterial({ color: DECK_BLUE, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide }),
        black: std(0x1b1c1e, { roughness: 0.9 }),
        soot: std(0x0b0b0b, { roughness: 1.0 }),
        gunMetal: std(0x575e65, { metalness: 0.4, roughness: 0.5 }),
        metal: std(0x6c7278, { metalness: 0.5, roughness: 0.5 }),
        window: std(0x0e1318, { roughness: 0.15, metalness: 0.8 }),
        canvas: std(0x8a8570, { roughness: 1.0 }),
        glass: std(0xcfd8dd, { roughness: 0.1, metalness: 0.6, emissive: 0x222222 }),
        red: std(HULL_RED),
        brass: std(BRASS, { metalness: 0.75, roughness: 0.35, flatShading: false }),
        charge: std(0x3d4247),
        wood: std(0x6b5a44, { roughness: 0.95 })
    };
}

// --- Vertex-coloured kit: primitives with a colour each, merged into one geometry (one draw call per model) ---
const _kv = new THREE.Vector3(), _kv2 = new THREE.Vector3(), _kq = new THREE.Quaternion(), _ke = new THREE.Euler(), _ks = new THREE.Vector3(), _kUp = new THREE.Vector3(0, 1, 0);
// Transform: position, then yaw (y), pitch (x), roll (z) in YXZ order, then scale
function MX(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    return new THREE.Matrix4().compose(_kv.set(x, y, z), _kq.setFromEuler(_ke.set(rx, ry, rz, 'YXZ')), _ks.set(sx, sy, sz));
}
function colorKit() {
    const parts = [];
    const api = {
        // color: a hex, or [top, bottom] to paint by facing (upper surfaces / undersides, e.g. aircraft camouflage)
        add(geo, color, m) {
            parts.push({ geo, color: Array.isArray(color) ? color.map(c => new THREE.Color(c)) : new THREE.Color(color), m });
            return api;
        },
        box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return api.add(new THREE.BoxGeometry(w, h, d), color, MX(x, y, z, ry, rx, rz)); },
        cyl(rt, rb, h, seg, color, x, y, z, ry = 0, rx = 0, rz = 0) { return api.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, MX(x, y, z, ry, rx, rz)); },
        strut(x0, y0, z0, x1, y1, z1, r, color, seg = 4) {
            const d = _kv2.set(x1 - x0, y1 - y0, z1 - z0), len = d.length();
            const m = new THREE.Matrix4().compose(_kv.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
                _kq.setFromUnitVectors(_kUp, d.normalize()), _ks.set(1, 1, 1));
            return api.add(new THREE.CylinderGeometry(r, r, len, seg), color, m);
        },
        // shade: optional [bottom, top] brightness gradient over the model's height (foliage)
        build(shade = null) {
            let n = 0;
            const geos = parts.map(p => {
                const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
                if (g !== p.geo) p.geo.dispose();
                if (!g.attributes.normal) g.computeVertexNormals();
                g.applyMatrix4(p.m);
                n += g.attributes.position.count;
                return g;
            });
            const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
            let k = 0, y0 = Infinity, y1 = -Infinity;
            geos.forEach((g, i) => {
                const c = parts[i].color, cnt = g.attributes.position.count;
                pos.set(g.attributes.position.array, k * 3);
                nor.set(g.attributes.normal.array, k * 3);
                for (let v = 0; v < cnt; v++) {
                    const cc = Array.isArray(c) ? (nor[(k + v) * 3 + 1] > -0.15 ? c[0] : c[1]) : c;
                    col[(k + v) * 3] = cc.r; col[(k + v) * 3 + 1] = cc.g; col[(k + v) * 3 + 2] = cc.b;
                    const y = pos[(k + v) * 3 + 1];
                    if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
                k += cnt;
                g.dispose();
            });
            if (shade) for (let v = 0; v < n; v++) {
                const f = lerp(shade[0], shade[1], (pos[v * 3 + 1] - y0) / Math.max(1e-3, y1 - y0));
                col[v * 3] *= f; col[v * 3 + 1] *= f; col[v * 3 + 2] *= f;
            }
            const out = new THREE.BufferGeometry();
            out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
            out.setAttribute('color', new THREE.BufferAttribute(col, 3));
            out.computeBoundingSphere();
            return out;
        }
    };
    return api;
}
