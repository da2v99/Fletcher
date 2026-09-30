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

function createMaterials() {
    const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.72, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }, o));
    return {
        gray: std(HAZE_GRAY),
        grayDark: std(0x5f676e),
        grayLight: std(0x8d949a),
        deck: new THREE.MeshStandardMaterial({ color: DECK_BLUE, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide }),
        black: std(0x1b1c1e, { roughness: 0.9 }),
        soot: std(0x0b0b0b, { roughness: 1.0 }),
        gunMetal: std(0x4b5157, { metalness: 0.4, roughness: 0.5 }),
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
