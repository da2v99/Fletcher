// Islands of the Slot: volcanic jungle islands around the ship, with destructible terrain, palms and jungle that
// fall and burn, and Japanese bases: coastal guns that engage the ship, 25 mm AA pits, machine-gun pillboxes,
// barracks, warehouses, fuel tanks, a radio mast, a lookout tower, a pier with landing barges, trucks on the
// camp road and soldiers who go about their day until the shooting starts.
//
// The world is cut into 8 km sectors with at most one island each, generated from a fixed seed so the same
// islands are always in the same place. Islands near the ship are built a few milliseconds per frame (no
// stutter) and dropped again when far astern. Each island is a height field: shell craters dig into it and
// scorch it, and the sea floor shoals up to the beach, so ships can run aground.

const Islands = (() => {
    const SECTOR = 8000, SEED = 1943, MAX_E = 1750;
    let GEN_R = 19000, DROP_R = 25000, viewK = 1;   // build and drop radii, scaled by the view distance
    const HOME = { x: -Math.sin(40 * DEG) * 8600, z: Math.cos(40 * DEG) * 8600 };   // bearing 040 from the start
    const NAMES = ['Vella Lavella', 'Gizo', 'Rendova', 'Ganongga', 'Simbo', 'Tetepare', 'Vangunu', 'Shortland', 'Ballale',
        'Faisi', 'Mono', 'Savo', 'Baga', 'Ranongga', 'Kohinggo', 'Arundel', 'Wana Wana', 'Mbava', 'Fauro', 'Kiambe', 'Liapari',
        'Nusatupe', 'Kolohite', 'Poporang', 'Alu', 'Magusaiai', 'Choiseul Bay', 'Sasavele'];
    // Detail by graphics level: terrain cell (m), max cells across, tree spacing (m), draw distances (m)
    const Q = [
        { cell: 30, maxN: 96, treeSp: 54, nearR: 650, farR: 3200, baseR: 4500, unitR: 1400, surfR: 4000, nearCap: 900 },
        { cell: 19, maxN: 150, treeSp: 33, nearR: 1000, farR: 4800, baseR: 6000, unitR: 2200, surfR: 6000, nearCap: 1800 },
        { cell: 13, maxN: 210, treeSp: 25, nearR: 1500, farR: 6500, baseR: 8000, unitR: 3000, surfR: 8000, nearCap: 3200 }
    ];
    let quality = 1;
    const list = [];             // built islands
    const queue = [];            // specs waiting to be built
    let building = null;         // { spec, gen } being built a few ms per frame
    const fires = [];
    let streamT = 0, shallowT = 0;
    let M = null, G = null;      // shared materials and geometries
    let nearPalm, nearClump, decals, decalN = 0;
    const lastRefill = new THREE.Vector3(1e9, 0, 0);
    let refillNeeded = true;
    const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _n = new THREE.Vector3(),
        _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _ZERO = new THREE.Vector3();

    // ------------------------------------------------------------------ randomness and noise
    function mulberry32(a) {
        return () => {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function hashI(x, z, s) {
        let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 1442695041) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function vnoise(x, z, s) {
        const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
        const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
        const a = hashI(ix, iz, s), b = hashI(ix + 1, iz, s), c = hashI(ix, iz + 1, s), d = hashI(ix + 1, iz + 1, s);
        return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
    }
    function fbm(x, z, s, oct) {
        let sum = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, z * f, s + i * 17); norm += amp; f *= 2.03; amp *= 0.5; }
        return sum / norm;
    }
    function ridged(x, z, s, oct) {
        let sum = 0, amp = 0.5, f = 1, norm = 0;
        for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(2 * vnoise(x * f, z * f, s + i * 31) - 1); sum += amp * n * n; norm += amp; f *= 2.1; amp *= 0.5; }
        return sum / norm;
    }

    // ------------------------------------------------------------------ materials
    function craterTexture() {
        const N = 128, c = document.createElement('canvas');
        c.width = c.height = N;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(14,12,10,0.97)');
        g.addColorStop(0.5, 'rgba(26,21,16,0.9)');
        g.addColorStop(0.68, 'rgba(48,39,29,0.7)');
        g.addColorStop(0.84, 'rgba(46,38,29,0.35)');
        g.addColorStop(1, 'rgba(40,34,28,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, N, N);
        for (let i = 0; i < 180; i++) {
            const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 36;
            ctx.fillStyle = `rgba(${30 + Math.random() * 40 | 0},${24 + Math.random() * 30 | 0},${18 + Math.random() * 20 | 0},${(0.6 * Math.random()).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.8 + Math.random() * 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
        return new THREE.CanvasTexture(c);
    }

    const liftU = { value: 0 }, nearU = { value: 1000 }, farU = { value: 4800 };
    function mats() {
        if (M) return M;
        // Terrain: vertex colours (sand, jungle, rock, scorch) with world-space detail noise. At a distance the
        // depth buffer can't separate a gentle beach from the sea, so far terrain is lifted by about one depth
        // step (uLift * distance^2), which stops the coastline shimmering.
        const terrain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
        terrain.onBeforeCompile = sh => {
            sh.uniforms.uLift = liftU;
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uLift;\nvarying vec3 vWPos;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    vec4 tW = modelMatrix * vec4(transformed, 1.0);
                    vWPos = tW.xyz;
                    vec3 tC = tW.xyz - cameraPosition;
                    transformed.y += uLift * dot(tC, tC);`);
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + NOISE_GLSL)
                .replace('#include <color_fragment>', `#include <color_fragment>
                    float tNear = exp(-length(vWPos - cameraPosition) / 1600.0);
                    float tD = vnoise(vWPos.xz * 0.013) * 0.5 + vnoise(vWPos.xz * 0.071) * 0.3 * (0.4 + 0.6 * tNear)
                             + (vnoise(vWPos.xz * 0.29) * 0.25 + vnoise(vWPos.xz * 1.37) * 0.15) * tNear;
                    diffuseColor.rgb *= 0.74 + 0.48 * tD;
                    diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.3, vWPos.y));`);
        };
        const kitM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.06, flatShading: true, side: THREE.DoubleSide });
        const burnt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide, color: 0x3a3430 });
        const tree = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        // Far trees: the GPU drops the ones close enough to be drawn by the detailed near set, and the ones too far
        const treeFar = new THREE.MeshLambertMaterial({ vertexColors: true });
        treeFar.onBeforeCompile = sh => {
            sh.uniforms.uNearR = nearU;
            sh.uniforms.uFarR = farU;
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uNearR;\nuniform float uFarR;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
                    #ifdef USE_INSTANCING
                    vec3 tI = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    float tDc = distance(tI, cameraPosition);
                    if (tDc < uNearR || tDc > uFarR) transformed = vec3(0.0);
                    #endif`);
        };
        const unit = new THREE.MeshLambertMaterial({ vertexColors: true });
        // Surf: a strip along the real coastline riding the same waves as the ocean, breakers rolling in to the beach
        const surf = new THREE.ShaderMaterial({
            uniforms: Object.assign({}, SEA_U, WEATHER_U),
            vertexShader: SEA_GLSL + `
                uniform float uTime;
                attribute float aEdge;
                varying float vEdge;
                varying vec3 vW;
                void main() {
                    vec3 P = seaSurface(position.xz, uTime, 4.0);
                    float d = length(P - cameraPosition);
                    P.y += 0.22 + d * 0.0005;
                    vEdge = aEdge;
                    vW = P;
                    gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
                }`,
            fragmentShader: NOISE_GLSL + SKY_GLSL + `
                uniform float uFogDensity;
                varying float vEdge;
                varying vec3 vW;
                void main() {
                    float e = vEdge;
                    float n = vnoise(vW.xz * 0.05 + vec2(uTime * 0.04, 0.0));
                    float n2 = vnoise(vW.xz * 0.27 - vec2(0.0, uTime * 0.18));
                    float roll = fract(e * 2.3 + uTime * 0.11 + n * 0.9);
                    float band = smoothstep(0.0, 0.1, roll) * (1.0 - smoothstep(0.1, 0.45, roll)) * (1.0 - smoothstep(0.45, 1.0, e));
                    float swash = 1.0 - smoothstep(0.04, 0.32, e);
                    float foam = max(swash * (0.45 + 0.55 * n2), band * (0.3 + 0.7 * n)) * smoothstep(0.12, 0.5, n2 + n * 0.5);
                    float light = mix(0.4, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.3 * uStorm);
                    vec3 col = vec3(0.9, 0.94, 0.95) * light * (0.82 + 0.25 * max(uSunDir.y, 0.0));
                    float dist = length(cameraPosition - vW);
                    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
                    gl_FragColor = vec4(col, foam * 0.85 * (1.0 - fogF));
                }`,
            transparent: true, depthWrite: false, side: THREE.DoubleSide
        });
        const decal = new THREE.MeshLambertMaterial({ map: craterTexture(), transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
        M = { terrain, kit: kitM, burnt, tree, treeFar, unit, surf, decal };
        return M;
    }

    // ------------------------------------------------------------------ geometry kit (colorKit / MX in geometry.js)
    const kit = colorKit;
    const gable = (w, h, len) => { const g = prism([[-w / 2, 0], [w / 2, 0], [0, h]], -len / 2, len / 2); g.rotateX(-Math.PI / 2); return g; };
    const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);

    // ------------------------------------------------------------------ shared models
    function frondGeo() {
        // A drooping palm frond along +X, folded along its rib
        const L = [0, 2.2, 4.4, 5.6], W = [0.12, 0.8, 0.55, 0.04], Y = [0.15, 0.55, -0.35, -1.7], R = [0.15, 0.26, 0.16, 0];
        const pos = [];
        for (let i = 0; i < 3; i++) {
            const a = [L[i], Y[i], -W[i]], m = [L[i], Y[i] + R[i], 0], b = [L[i], Y[i], W[i]];
            const c = [L[i + 1], Y[i + 1], -W[i + 1]], n = [L[i + 1], Y[i + 1] + R[i + 1], 0], d = [L[i + 1], Y[i + 1], W[i + 1]];
            pos.push(...a, ...m, ...n, ...a, ...n, ...c, ...m, ...b, ...d, ...m, ...d, ...n);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        return g;
    }
    function palmGeo(far) {
        const k = kit(), H = 13;
        if (!far) {
            for (let i = 0; i < 4; i++) {
                const y0 = i / 4 * H, y1 = (i + 1) / 4 * H, x0 = 1.7 * (i / 4) ** 2, x1 = 1.7 * ((i + 1) / 4) ** 2;
                k.strut(x0, y0, 0, x1, y1, 0, 0.23 - i * 0.025, i % 2 ? 0x3d3428 : 0x453a2d, 5);
            }
            for (let f = 0; f < 8; f++) k.add(frondGeo(), f % 2 ? 0x1c3311 : 0x243d15, MX(1.7, H, 0, f / 8 * Math.PI * 2 + 0.2, 0, 0, 1 + (f % 3) * 0.08));
            k.add(ico(0.55), 0x33291a, MX(1.7, H - 0.45, 0));
        } else {
            k.strut(0, 0, 0, 1.2, H * 0.8, 0, 0.3, 0x3d3428, 3);
            k.add(ico(3.6), 0x1f3713, MX(1.6, H - 0.4, 0, 0, 0, 0, 1.5, 0.32, 1.5));
        }
        return k.build([0.7, 1.08]);
    }
    function clumpGeo(far) {
        const k = kit();
        if (!far) {
            k.cyl(0.32, 0.5, 11, 5, 0x2e251b, 0, 5.5, 0);
            k.strut(0.2, 3, 0, 3.4, 9.5, 1.6, 0.25, 0x2e251b);
            k.strut(-0.2, 4, 0, -2.6, 9, -2.2, 0.22, 0x2e251b);
            k.add(ico(5.4), 0x15290e, MX(0, 13.2, 0, 0.4, 0, 0, 1, 0.7, 1));
            k.add(ico(4.1), 0x1b3311, MX(3.6, 10.6, 1.8, 1.1, 0, 0, 1, 0.68, 1));
            k.add(ico(3.7), 0x11220b, MX(-2.8, 10.2, -2.4, 2.0, 0, 0, 1, 0.74, 1));
            k.add(ico(3.0), 0x182e0f, MX(1.2, 15.2, -1.0, 0.7, 0, 0, 1, 0.8, 1));
        } else {
            k.add(ico(6.4), 0x15290e, MX(0.3, 11.6, 0, 0, 0, 0, 1, 0.68, 1));
        }
        return k.build([0.5, 1.12]);
    }
    function soldierGeo() {
        const k = kit(), khaki = 0x4a4630, skin = 0x6a5040;
        k.box(0.15, 0.82, 0.18, 0x403c28, -0.1, 0.41, 0);
        k.box(0.15, 0.82, 0.18, 0x403c28, 0.1, 0.41, 0);
        k.box(0.42, 0.62, 0.26, khaki, 0, 1.13, 0);
        k.box(0.1, 0.58, 0.12, khaki, -0.27, 1.12, 0.02);
        k.box(0.1, 0.58, 0.12, khaki, 0.27, 1.12, 0.02);
        k.add(ico(0.12), skin, MX(0, 1.56, 0));
        k.cyl(0.13, 0.16, 0.12, 7, 0x383a26, 0, 1.66, 0);
        k.box(0.05, 0.05, 1.2, 0x3a2e22, 0.26, 1.15, 0.15, 0, 0.35);   // rifle
        return k.build();
    }
    function truckGeo() {
        const k = kit(), olive = 0x383a26;
        k.box(2.0, 0.5, 6.4, 0x2b2b28, 0, 0.75, 0);                    // chassis
        k.box(1.9, 1.5, 1.7, olive, 0, 1.7, 2.0);                       // cab
        k.box(1.95, 0.6, 0.7, 0x23282c, 0, 2.1, 2.84);                  // windscreen
        k.box(1.6, 1.0, 1.4, olive, 0, 1.4, 3.4);                       // bonnet
        k.box(2.1, 0.7, 3.6, 0x404029, 0, 1.35, -1.3);                  // bed
        k.add(new THREE.CylinderGeometry(1.05, 1.05, 3.5, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), 0x4b4a34, MX(0, 1.7, -1.3, 0, 0, 0, 1, 0.9, 1));
        [[0.95, 2.6], [-0.95, 2.6], [0.95, -0.8], [-0.95, -0.8], [0.95, -2.1], [-0.95, -2.1]].forEach(([x, z]) =>
            k.add(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8).rotateZ(Math.PI / 2), 0x151515, MX(x, 0.45, z)));
        return k.build();
    }
    function sharedGeos() {
        if (G) return G;
        G = { palm: palmGeo(false), palmFar: palmGeo(true), clump: clumpGeo(false), clumpFar: clumpGeo(true), soldier: soldierGeo(), truck: truckGeo() };
        const pl = new THREE.PlaneGeometry(1, 1);
        pl.rotateX(-Math.PI / 2);
        G.decal = pl;
        return G;
    }

    // ------------------------------------------------------------------ base buildings (local: +Z faces the sea)
    function hqGeo() {
        const k = kit();
        k.box(22, 3.4, 12, 0x6c685e, 0, 1.7, 0);
        k.box(20, 3.2, 10.5, 0x726d62, 0, 5.0, 0);
        k.box(23, 0.5, 13, 0x46423b, 0, 3.55, 0);
        k.box(21, 0.6, 11.5, 0x46423b, 0, 6.9, 0);
        for (let i = -4; i <= 4; i++) {
            if (!i) continue;
            k.box(1.3, 1.3, 12.1, 0x23272a, i * 2.3, 1.9, 0);
            k.box(1.3, 1.3, 10.6, 0x23272a, i * 2.1, 5.1, 0);
        }
        k.box(2.2, 2.6, 0.5, 0x2a2420, 0, 1.3, 6.1);
        k.cyl(0.08, 0.1, 9, 5, 0x55504a, 9.5, 11.6, 4.5);
        k.box(2.4, 1.6, 0.05, 0xf2f0ea, 10.75, 15.2, 4.5);
        k.add(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 14), 0xc8102e, MX(10.75, 15.2, 4.5, 0, Math.PI / 2));
        for (let i = -2; i <= 2; i++) k.box(3.4, 1.0, 1.1, 0x6a5f45, i * 4.2, 0.5, 7.6);
        return k.build();
    }
    function barracksGeo() {
        const k = kit();
        k.box(8, 0.7, 26, 0x3e3528, 0, 0.35, 0);
        k.box(7.6, 2.6, 25.6, 0x554734, 0, 2.0, 0);
        k.add(gable(9.0, 2.2, 27), 0x5a4f36, MX(0, 3.25, 0));
        for (let z = -10; z <= 10; z += 4) k.box(7.75, 0.9, 1.4, 0x2a2622, 0, 2.2, z);
        k.box(2, 0.5, 1.4, 0x3e3528, 0, 0.25, 13.6);
        return k.build();
    }
    function warehouseGeo() {
        const k = kit();
        k.box(16, 4.5, 34, 0x57534a, 0, 2.25, 0);
        k.add(new THREE.CylinderGeometry(8.4, 8.4, 34.6, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), 0x4d4b47, MX(0, 4.4, 0, 0, 0, 0, 1, 0.55, 1));
        k.box(6, 4, 0.3, 0x3a3630, 0, 2.0, 17.05);
        for (let i = 0; i < 8; i++) k.cyl(0.35, 0.35, 0.9, 8, 0x4a5a3a, -6 + (i % 4) * 0.8, 0.45, 19 + (i >> 2) * 0.8);
        return k.build();
    }
    function fuelGeo() {
        const k = kit();
        k.cyl(5.5, 5.5, 7.5, 18, 0x5d6152, 0, 3.75, 0);
        k.cyl(0.6, 5.6, 1.3, 18, 0x53574a, 0, 8.15, 0);
        k.box(0.5, 8, 0.2, 0x3a3a36, 0, 4, 5.55);
        k.cyl(6.4, 6.6, 0.5, 18, 0x4d4a41, 0, 0.25, 0);
        return k.build();
    }
    function mastGeo() {
        const k = kit(), H = 38, c = 0x2a2b2c;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => k.strut(a * 2.2, 0, b * 2.2, a * 0.25, H, b * 0.25, 0.09, c));
        for (let y = 4; y < H - 2; y += 5) {
            const w = lerp(2.2, 0.25, y / H);
            k.box(w * 2, 0.08, 0.08, c, 0, y, -w); k.box(w * 2, 0.08, 0.08, c, 0, y, w);
            k.box(0.08, 0.08, w * 2, c, -w, y, 0); k.box(0.08, 0.08, w * 2, c, w, y, 0);
        }
        k.cyl(0.05, 0.05, 6, 4, c, 0, H + 3, 0);
        k.box(5, 0.08, 0.08, c, 0, H - 1, 0);
        k.box(4, 3, 3.4, 0x554734, 5.5, 1.5, 0);
        k.add(gable(4.6, 1.2, 3.8).rotateY(Math.PI / 2), 0x4a4a46, MX(5.5, 3, 0));
        return k.build();
    }
    function towerGeo() {
        const k = kit(), H = 13, c = 0x4a3e2d;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => k.strut(a * 1.9, 0, b * 1.9, a * 1.3, H, b * 1.3, 0.14, c));
        k.strut(-1.7, 2, -1.7, 1.5, 7, -1.5, 0.06, c); k.strut(1.7, 2, 1.7, -1.5, 7, 1.5, 0.06, c);
        k.box(3.4, 0.3, 3.4, 0x4d4130, 0, H, 0);
        k.box(3.4, 0.9, 0.08, 0x4d4130, 0, H + 0.6, -1.66); k.box(3.4, 0.9, 0.08, 0x4d4130, 0, H + 0.6, 1.66);
        k.box(0.08, 0.9, 3.4, 0x4d4130, -1.66, H + 0.6, 0); k.box(0.08, 0.9, 3.4, 0x4d4130, 1.66, H + 0.6, 0);
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => k.box(0.12, 2.2, 0.12, c, a * 1.6, H + 1.1, b * 1.6));
        k.add(new THREE.CylinderGeometry(0, 2.9, 1.4, 4).rotateY(Math.PI / 4), 0x5a4f36, MX(0, H + 2.9, 0));
        return k.build();
    }
    function pillboxGeo() {
        const k = kit();
        k.cyl(3.0, 3.4, 2.2, 6, 0x5a574c, 0, 1.1, 0);
        k.cyl(3.4, 3.4, 0.35, 6, 0x4d4a41, 0, 2.35, 0);
        k.box(2.4, 0.35, 0.6, 0x141414, 0, 1.45, 2.85);
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.5; k.box(1.6, 0.6, 0.8, 0x6a5f45, Math.sin(a) * 4, 0.3, Math.cos(a) * 4, a); }
        return k.build();
    }
    function gunPitGeo() {
        const k = kit();
        k.add(new THREE.CylinderGeometry(7.2, 7.7, 1.7, 20, 1, true), 0x605d53, MX(0, 0.85, 0));
        k.cyl(7.2, 7.2, 0.4, 20, 0x54514a, 0, 0.2, 0);
        k.box(5, 2.2, 3.5, 0x54514a, 0, 1.1, -9.5);
        k.box(1.6, 1.8, 0.3, 0x1e1c1a, 0, 0.9, -7.7);
        for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; if (Math.cos(a) > 0.8) continue; k.box(2.4, 0.7, 1.0, 0x6a5f45, Math.sin(a) * 8.3, 0.35, Math.cos(a) * 8.3, a); }
        return k.build();
    }
    function coastGunGeos() {
        const mount = kit();
        mount.cyl(0.8, 1.05, 1.5, 10, 0x434a3c, 0, 0.75, 0);
        mount.add(prism([[-1.8, -1.4], [1.8, -1.4], [1.8, 1.2], [1.1, 2.0], [-1.1, 2.0], [-1.8, 1.2]], 1.4, 3.6), 0x464d40, MX());
        mount.box(3.2, 0.25, 2.8, 0x3a4035, 0, 3.65, 0.2);
        const barrel = kit();
        barrel.add(CylZ(0.13, 0.19, 7.6, 10), 0x363b31, MX(0, 0, 3.6));
        barrel.add(CylZ(0.22, 0.22, 1.4, 10), 0x363b31, MX(0, 0, 0.3));
        return { mount: mount.build(), barrel: barrel.build() };
    }
    function aaGeos() {
        const pit = kit();
        pit.add(new THREE.TorusGeometry(3.7, 0.7, 4, 14).rotateX(Math.PI / 2), 0x6a5f45, MX(0, 0.45, 0, 0, 0, 0, 1, 1.3, 1));
        pit.cyl(3.4, 3.4, 0.2, 14, 0x4d4638, 0, 0.1, 0);
        pit.cyl(0.3, 0.45, 1.1, 8, 0x3a3e32, 0, 0.55, 0);
        for (let i = 0; i < 3; i++) pit.box(0.6, 0.4, 0.4, 0x4a5a3a, -2.2 + i * 0.7, 0.3, -2.3);
        const mount = kit();
        mount.box(1.1, 0.6, 0.9, 0x3a3e32, 0, 0.3, 0);
        mount.box(0.5, 0.08, 0.5, 0x2a2a2a, -0.8, 0.3, -0.5);
        const guns = kit();
        [-0.22, 0.22].forEach(x => { guns.add(CylZ(0.05, 0.07, 2.4, 6), 0x2c2e2c, MX(x, 0, 1.3)); guns.box(0.16, 0.22, 0.9, 0x3c3e3a, x, 0, 0.1); });
        guns.box(0.5, 0.35, 0.12, 0x4a3f29, 0, 0.32, -0.1);
        return { pit: pit.build(), mount: mount.build(), guns: guns.build() };
    }
    function pierGeo(len) {
        const k = kit();
        k.box(6, 0.4, len, 0x4a3e2d, 0, 2.2, 0);
        for (let z = -len / 2 + 2; z <= len / 2; z += 7) [-2.7, 2.7].forEach(x => k.cyl(0.25, 0.28, 10, 6, 0x4a3c2c, x, -2.8, z));
        for (let z = -len / 2 + 6; z <= len / 2; z += 14) [-2.9, 2.9].forEach(x => k.cyl(0.18, 0.18, 0.5, 6, 0x2a2622, x, 2.65, z));
        k.box(1.6, 0.8, 1.2, 0x4d4130, 1.5, 2.8, len / 2 - 4);
        k.box(1.2, 0.8, 1.2, 0x4d4130, -1.8, 2.8, len / 2 - 8);
        return k.build();
    }

    // ------------------------------------------------------------------ world layout
    function sectorSpec(i, j) {
        const rng = mulberry32((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ SEED) >>> 0);
        if (rng() > 0.52) return null;
        const x = (i + 0.22 + rng() * 0.56) * SECTOR, z = (j + 0.22 + rng() * 0.56) * SECTOR;
        if (Math.hypot(x, z) < 6500 || Math.hypot(x - HOME.x, z - HOME.z) < 7000) return null;   // keep the start clear
        const size = rng(), seed = (rng() * 2147483647) | 0, base = rng() < 0.42;
        return { id: i + ',' + j, seed, x, z, size, base, name: NAMES[(seed >>> 3) % NAMES.length], prefer: null };
    }
    const HOME_SPEC = { id: 'home', seed: 77031, x: HOME.x, z: HOME.z, size: 0.6, base: true, name: 'Kolombangara',
        prefer: { x: -HOME.x / 8600, z: -HOME.z / 8600 } };

    // Kunai grass clearings: open patches in the jungle (no trees, yellow-green from the air)
    function kunaiAt(isl, wx, wz, h) {
        if (h > 0.6 * isl.maxH || isl.low) return 0;
        return smooth(0.68, 0.78, vnoise(wx / 110, wz / 110, isl.seed + 9));
    }

    function heightAt(seed, blobs, c, h0, lx, lz, rough) {
        let s = 0;
        for (let k = 0; k < blobs.length; k++) {
            const b = blobs[k], dx = lx - b.x, dz = lz - b.z;
            s += b.h * Math.exp(-2.2 * (dx * dx + dz * dz) / (b.r * b.r));
        }
        const t = s / h0, tt = t * Math.sqrt(t);
        // Ridges and ravines running down the slopes (domain-warped ridged noise), a ragged coastline lower down
        const wx = lx + 220 * (fbm(lx / 800, lz / 800, seed + 5, 2) - 0.5), wz = lz + 220 * (fbm(lx / 800, lz / 800, seed + 6, 2) - 0.5);
        const r = ridged(wx / 400, wz / 400, seed, 5);
        const n = fbm(lx / 240, lz / 240, seed + 101, 3);
        let H = s - c + h0 * (rough * tt * (r - 0.3) + 0.07 * (n - 0.5));
        if (H > 0) H = H * H / (H + 2.5);    // beaches: the land rises gently out of the water
        if (H > 380) H = 380 + (H - 380) * 0.35;   // keep the peaks in proportion to islands a few km across
        return Math.max(H, -60);
    }

    // Height of island `isl` at local coordinates (bilinear in its grid)
    function sampleLocal(isl, lx, lz) {
        const fx = (lx + isl.E) / isl.cell, fz = (lz + isl.E) / isl.cell;
        if (fx < 0 || fz < 0 || fx > isl.n || fz > isl.n) return -60;
        const i = Math.min(isl.n - 1, Math.floor(fx)), j = Math.min(isl.n - 1, Math.floor(fz));
        const u = fx - i, v = fz - j, N1 = isl.n + 1, H = isl.H, o = j * N1 + i;
        return (H[o] * (1 - u) + H[o + 1] * u) * (1 - v) + (H[o + N1] * (1 - u) + H[o + N1 + 1] * u) * v;
    }
    function gridNormal(isl, i, j, out) {
        const n = isl.n, N1 = n + 1, H = isl.H;
        const i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n, j + 1);
        const gx = (H[j * N1 + i1] - H[j * N1 + i0]) / ((i1 - i0) * isl.cell);
        const gz = (H[j1 * N1 + i] - H[j0 * N1 + i]) / ((j1 - j0) * isl.cell);
        return out.set(-gx, 1, -gz).normalize();
    }

    // The flattest stretch of coast with room for a camp, a little inland from the beach
    function chooseSite(isl, rng, prefer) {
        let best = null;
        for (let k = 0; k < 40; k++) {
            const a = k / 40 * Math.PI * 2 + rng() * 0.05, dx = Math.sin(a), dz = Math.cos(a);
            let rc = -1;
            for (let r = 60; r < isl.E - 80; r += 15) if (sampleLocal(isl, dx * r, dz * r) < 0) { rc = r; break; }
            if (rc < 0) continue;
            for (const back of [120, 160, 200]) {
                const r = rc - back;
                if (r < 40) continue;
                const sx = dx * r, sz = dz * r, h = sampleLocal(isl, sx, sz);
                if (h < 2.5 || h > 40) continue;
                let rough = 0;
                for (let m = 0; m < 12; m++) {
                    const b = m / 12 * Math.PI * 2;
                    for (const rr of [50, 100]) rough = Math.max(rough, Math.abs(sampleLocal(isl, sx + Math.sin(b) * rr, sz + Math.cos(b) * rr) - h));
                }
                let score = rough + h * 0.2;
                if (prefer) score += (1 - (dx * prefer.x + dz * prefer.z)) * 30;
                if (!best || score < best.score) best = { score, x: sx, z: sz, h, dx, dz, coast: back };
            }
        }
        return best;
    }
    function flatten(isl, site) {
        const hp = Math.max(4, site.h), R0 = Math.min(115, site.coast - 45), R1 = R0 + 75, N1 = isl.n + 1;
        site.h = hp;
        for (let j = 0; j <= isl.n; j++) for (let i = 0; i <= isl.n; i++) {
            const lx = -isl.E + i * isl.cell, lz = -isl.E + j * isl.cell;
            const d = Math.hypot(lx - site.x, lz - site.z);
            if (d >= R1) continue;
            const w = smooth(R1, R0, d), k = j * N1 + i;
            isl.H[k] = lerp(isl.H[k], hp, w);
        }
    }

    // ------------------------------------------------------------------ building an island (a generator: a few ms at a time)
    function* buildGen(spec) {
        const mt = mats(), gg = sharedGeos();
        const q = Q[quality], rng = mulberry32(spec.seed);
        const isl = { spec, id: spec.id, name: spec.name, x: spec.x, z: spec.z, seed: spec.seed, ready: false, base: null, lod: -1,
            dirty: null, scorched: false, damaged: false };
        // Shape: a main volcanic peak and a few lesser ones, or (one in four) a low coral island under palms
        const s = spec.size, low = spec.id !== 'home' && rng() < 0.27;
        const r0 = low ? 380 + 520 * s : 420 + 720 * s;
        const h0 = low ? 16 + 22 * rng() : (90 + 260 * Math.pow(s, 0.8)) * (0.8 + 0.4 * rng());
        const blobs = [{ x: 0, z: 0, r: r0, h: h0 }];
        const nb = 1 + Math.floor(rng() * 4);
        for (let i = 0; i < nb; i++) {
            const a = rng() * Math.PI * 2, d = r0 * (0.35 + 0.6 * rng());
            blobs.push({ x: Math.sin(a) * d, z: Math.cos(a) * d, r: r0 * (0.3 + 0.38 * rng()), h: h0 * (low ? 0.6 + 0.4 * rng() : 0.25 + 0.45 * rng()) });
        }
        isl.low = low;
        const rough = low ? 0.08 : 0.42 + 0.2 * rng();
        let E = 0;
        blobs.forEach(b => { E = Math.max(E, Math.hypot(b.x, b.z) + b.r * 1.3); });
        E += 220;
        if (E > MAX_E) { const k = (MAX_E - 220) / (E - 220); blobs.forEach(b => { b.x *= k; b.z *= k; b.r *= k; }); E = MAX_E; }
        const c = low ? h0 * 0.55 : Math.max(0.11 * h0, 14);
        const n = Math.max(48, Math.min(q.maxN, Math.ceil(2 * E / q.cell))), cell = 2 * E / n, N1 = n + 1;
        Object.assign(isl, { E, n, cell, blobs, h0, c, H: new Float32Array(N1 * N1) });
        for (let j = 0; j <= n; j++) {
            const lz = -E + j * cell;
            for (let i = 0; i <= n; i++) isl.H[j * N1 + i] = heightAt(spec.seed, blobs, c, h0, -E + i * cell, lz, rough);
            if (j % 20 === 19) yield;
        }

        // A Japanese base on the flattest stretch of coast
        let site = null;
        if (spec.base) {
            site = chooseSite(isl, rng, spec.prefer);
            if (site) flatten(isl, site);
            yield;
        }
        let maxH = 0;
        for (let k = 0; k < isl.H.length; k++) if (isl.H[k] > maxH) maxH = isl.H[k];
        isl.maxH = maxH;

        // Mesh: positions, normals, colours, three levels of detail sharing the same vertices
        const pos = new Float32Array(N1 * N1 * 3), nor = new Float32Array(N1 * N1 * 3), col = new Float32Array(N1 * N1 * 3);
        isl.colBase = new Float32Array(N1 * N1 * 3);
        isl.scorch = new Float32Array(N1 * N1);
        // Valleys darker, ridges lighter: compare each point with its neighbourhood (box blur, 3 cells)
        const blur = boxBlur(isl.H, N1, 3);
        yield;
        const road = site ? baseRoad(site) : null;
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const k = j * N1 + i, lx = -E + i * cell, lz = -E + j * cell;
                pos[k * 3] = lx; pos[k * 3 + 1] = isl.H[k]; pos[k * 3 + 2] = lz;
                gridNormal(isl, i, j, _n);
                nor[k * 3] = _n.x; nor[k * 3 + 1] = _n.y; nor[k * 3 + 2] = _n.z;
                terrainColor(isl, k, lx, lz, _n.y, blur[k], site, road, isl.colBase, k * 3);
                col[k * 3] = isl.colBase[k * 3]; col[k * 3 + 1] = isl.colBase[k * 3 + 1]; col[k * 3 + 2] = isl.colBase[k * 3 + 2];
            }
            if (j % 30 === 29) yield;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(gridIndex(n, 1));
        geo.computeBoundingSphere();
        isl.lods = [geo];
        [2, 4].forEach(step => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', geo.attributes.position);
            g.setAttribute('normal', geo.attributes.normal);
            g.setAttribute('color', geo.attributes.color);
            g.setIndex(gridIndex(n, step));
            g.boundingSphere = geo.boundingSphere.clone();
            isl.lods.push(g);
        });
        isl.mesh = new THREE.Mesh(geo, mt.terrain);
        isl.mesh.position.set(isl.x, 0, isl.z);
        isl.mesh.receiveShadow = true;
        isl.mesh.matrixAutoUpdate = false;
        isl.mesh.updateMatrix();
        isl.sphere = new THREE.Sphere(new THREE.Vector3(isl.x, maxH * 0.4, isl.z), Math.hypot(E, E) + 30);
        yield;

        // Trees: coconut palms along the shore, broadleaf jungle inland, cleared ground round the camp
        placeTrees(isl, rng, site);
        yield;

        if (site) buildBase(isl, rng, site);
        yield;

        isl.surf = buildSurf(isl);
        isl.radarImg = radarImage(isl);
        // Circles for the ocean's turquoise shallows
        isl.circles = blobs.filter(b => b.h > c * 1.05).map(b => ({ x: isl.x + b.x, z: isl.z + b.z, r: b.r * Math.sqrt(Math.log(b.h / c) / 2.2) }));
        return isl;
    }

    function boxBlur(H, N1, r) {
        const tmp = new Float32Array(H.length), out = new Float32Array(H.length);
        for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
            let s = 0, c = 0;
            for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < N1) { s += H[j * N1 + ii]; c++; } }
            tmp[j * N1 + i] = s / c;
        }
        for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
            let s = 0, c = 0;
            for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < N1) { s += tmp[jj * N1 + i]; c++; } }
            out[j * N1 + i] = s / c;
        }
        return out;
    }

    function gridIndex(n, step) {
        const rows = [];
        for (let v = 0; v < n; v += step) rows.push(v);
        rows.push(n);
        const N1 = n + 1, m = rows.length, idx = new (N1 * N1 > 65535 ? Uint32Array : Uint16Array)((m - 1) * (m - 1) * 6);
        let k = 0;
        for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
            const i0 = rows[a], i1 = rows[a + 1], j0 = rows[b], j1 = rows[b + 1];
            const p00 = j0 * N1 + i0, p10 = j0 * N1 + i1, p01 = j1 * N1 + i0, p11 = j1 * N1 + i1;
            idx[k++] = p00; idx[k++] = p01; idx[k++] = p10;
            idx[k++] = p10; idx[k++] = p01; idx[k++] = p11;
        }
        return new THREE.BufferAttribute(idx, 1);
    }

    // Albedos (the output isn't gamma-encoded and the tropical sun lights them ~2x): coral sand, rainforest
    // canopy seen from above, kunai grass clearings, volcanic rock, camp dirt
    const COL = {
        sand: [0.5, 0.46, 0.36], wet: [0.27, 0.24, 0.19], seabed: [0.3, 0.3, 0.25], grass: [0.14, 0.18, 0.07],
        kunai: [0.27, 0.26, 0.115], jungle: [0.055, 0.1, 0.036], jungle2: [0.085, 0.14, 0.05], rock: [0.23, 0.21, 0.19],
        rockDark: [0.145, 0.135, 0.125], dirt: [0.29, 0.24, 0.165], road: [0.21, 0.18, 0.13], burnt: [0.05, 0.045, 0.04]
    };
    function terrainColor(isl, k, lx, lz, ny, hBlur, site, road, out, o) {
        const h = isl.H[k], wx = isl.x + lx, wz = isl.z + lz, slope = 1 - ny;
        let c;
        const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
        if (h < 0.3) c = mix(COL.seabed, COL.wet, smooth(-3, 0.2, h));
        else if (h < 3) c = mix(mix(COL.wet, COL.sand, smooth(0.3, 0.9, h)), COL.grass, smooth(1.4, 3, h));
        else {
            const nA = fbm(wx / 170, wz / 170, isl.seed + 5, 2);
            c = mix(COL.jungle, COL.jungle2, nA);
            c = mix(c, COL.kunai, kunaiAt(isl, wx, wz, h) * 0.85);
            c = mix(COL.grass, c, smooth(3, 8, h));
        }
        const rk = smooth(0.3, 0.58, slope);
        if (rk > 0) c = mix(c, mix(COL.rock, COL.rockDark, vnoise(wx / 40, wz / 40, isl.seed + 13)), rk);
        if (h > 0.75 * isl.maxH) c = mix(c, COL.rock, 0.25 * smooth(0.75 * isl.maxH, isl.maxH, h));
        if (site) {
            const d = Math.hypot(lx - site.x, lz - site.z);
            if (d < 210) c = mix(c, mix(COL.dirt, COL.kunai, vnoise(wx / 18, wz / 18, isl.seed) * 0.7), smooth(210, 120, d) * 0.85);
            if (road && d < 160 && roadDist(road, lx, lz) < 4.5) c = mix(c, COL.road, 0.85);
        }
        const ao = 0.8 + 0.32 * clamp01(0.5 + (h - hBlur) / 22);
        out[o] = c[0] * ao; out[o + 1] = c[1] * ao; out[o + 2] = c[2] * ao;
    }

    // ------------------------------------------------------------------ trees
    function treeMatrix(t, arr, i) {
        _q.setFromAxisAngle(_up, t.yaw);
        const lean = t.fallen ? 1.47 : t.lean;
        if (lean > 0) _q.premultiply(_q2.setFromAxisAngle(_v2.set(Math.cos(t.dir), 0, -Math.sin(t.dir)), lean));
        _m.compose(_v.set(t.x, t.y - (t.fallen ? 0.6 : 0), t.z), _q, _s.set(t.s, t.s, t.s));
        _m.toArray(arr, i * 16);
    }
    function placeTrees(isl, rng, site) {
        const q = Q[quality], sp = q.treeSp, E = isl.E;
        const palms = [], clumps = [];
        for (let z = -E + sp / 2; z < E; z += sp) for (let x = -E + sp / 2; x < E; x += sp) {
            const lx = x + (rng() - 0.5) * sp * 0.95, lz = z + (rng() - 0.5) * sp * 0.95;
            const h = sampleLocal(isl, lx, lz);
            if (h < 1.5) continue;
            const e = 4, gx = (sampleLocal(isl, lx + e, lz) - sampleLocal(isl, lx - e, lz)) / (2 * e), gz = (sampleLocal(isl, lx, lz + e) - sampleLocal(isl, lx, lz - e)) / (2 * e);
            const slope = Math.hypot(gx, gz);
            if (slope > 0.95) continue;
            if (site) {
                const d = Math.hypot(lx - site.x, lz - site.z);
                if (d < 200 && rng() > (d > 150 ? 0.25 : 0.04)) continue;
                // keep the pier approach clear
                const along = (lx - site.x) * site.dx + (lz - site.z) * site.dz, across = Math.abs((lx - site.x) * site.dz - (lz - site.z) * site.dx);
                if (along > 0 && along < site.coast + 40 && across < 30) continue;
            }
            const wx = isl.x + lx, wz = isl.z + lz;
            const out = gx * gx + gz * gz > 1e-6 ? Math.atan2(-gx, -gz) : rng() * Math.PI * 2;   // downhill: toward the sea
            if (kunaiAt(isl, wx, wz, h) > 0.4 && rng() < 0.92) continue;
            if (h < 12 || isl.low) {
                if (rng() < 0.15) continue;
                palms.push({ x: wx, y: h - 0.3, z: wz, yaw: out - Math.PI / 2 + (rng() - 0.5) * 1.6, s: 0.8 + rng() * 0.45, lean: 0.05 + rng() * 0.18, dir: out, fallen: false, burnt: 0 });
            } else {
                if (rng() < 0.12 || (h > 0.9 * isl.maxH && rng() < 0.5)) continue;
                clumps.push({ x: wx, y: h - 0.5, z: wz, yaw: rng() * Math.PI * 2, s: 0.9 + rng() * 0.65, lean: rng() * 0.06, dir: rng() * Math.PI * 2, fallen: false, burnt: 0 });
            }
        }
        isl.trees = [makeTreeSet(isl, palms, G.palmFar, 'palm'), makeTreeSet(isl, clumps, G.clumpFar, 'clump')];
        // Spatial hash for blasts
        const HC = 64, hn = Math.ceil(2 * E / HC);
        isl.treeHash = { HC, hn, cells: new Array(hn * hn) };
        isl.trees.forEach((set, ti) => set.list.forEach((t, i) => {
            const ci = Math.min(hn - 1, Math.floor((t.x - isl.x + E) / HC)), cj = Math.min(hn - 1, Math.floor((t.z - isl.z + E) / HC));
            const cl = isl.treeHash.cells[cj * hn + ci] || (isl.treeHash.cells[cj * hn + ci] = []);
            cl.push(ti * 1e6 + i);
        }));
    }
    function makeTreeSet(isl, trees, farGeo, kind) {
        const n = trees.length;
        const set = { kind, list: trees, far: null };
        if (!n) return set;
        const far = new THREE.InstancedMesh(farGeo, M.treeFar, n);
        far.frustumCulled = false;
        const arr = far.instanceMatrix.array;
        const c = new THREE.Color();
        trees.forEach((t, i) => {
            treeMatrix(t, arr, i);
            const v = 0.82 + Math.random() * 0.36;
            t.cr = v * (kind === 'palm' ? 1.0 : 0.9 + Math.random() * 0.2); t.cg = v; t.cb = v * (0.85 + Math.random() * 0.2);
            far.setColorAt(i, c.setRGB(t.cr, t.cg, t.cb));
        });
        far.instanceMatrix.needsUpdate = true;
        far.visible = false;
        set.far = far;
        scene.add(far);
        return set;
    }
    function treeColor(t, c) {
        if (t.burnt > 0) return c.setRGB(lerp(t.cr, 0.16, t.burnt), lerp(t.cg, 0.13, t.burnt), lerp(t.cb, 0.1, t.burnt));
        return c.setRGB(t.cr, t.cg, t.cb);
    }

    // Near trees: one detailed instanced set per kind for everything within reach of the camera, refilled as it moves
    function refillNearTrees() {
        const q = Q[quality], cam = camera.position, R = q.nearR + 160, R2 = R * R;
        let np = 0, nc = 0;
        const c = new THREE.Color();
        for (const isl of list) {
            if (!isl.ready || !isl.trees) continue;
            if (Math.hypot(cam.x - isl.x, cam.z - isl.z) - isl.E * 1.42 > R) continue;
            isl.trees.forEach(set => {
                const near = set.kind === 'palm' ? nearPalm : nearClump;
                const cap = near.instanceMatrix.count;
                const src = set.far && set.far.instanceMatrix.array, dst = near.instanceMatrix.array;
                if (!src) return;
                for (let i = 0; i < set.list.length; i++) {
                    const t = set.list[i], dx = t.x - cam.x, dz = t.z - cam.z;
                    if (dx * dx + dz * dz > R2) continue;
                    const k = set.kind === 'palm' ? np : nc;
                    if (k >= cap) break;
                    for (let e = 0; e < 16; e++) dst[k * 16 + e] = src[i * 16 + e];
                    near.setColorAt(k, treeColor(t, c));
                    if (set.kind === 'palm') np++; else nc++;
                }
            });
        }
        nearPalm.count = np; nearClump.count = nc;
        [nearPalm, nearClump].forEach(m => {
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
        });
        lastRefill.copy(cam);
        refillNeeded = false;
    }

    // ------------------------------------------------------------------ surf strip along the coastline
    function buildSurf(isl) {
        const n = isl.n, N1 = n + 1, H = isl.H, E = isl.E, cell = isl.cell, W = 30;
        const pos = [], edge = [];
        const pt = (i0, j0, i1, j1) => {
            const a = H[j0 * N1 + i0], b = H[j1 * N1 + i1], t = a / (a - b);
            const lx = -E + lerp(i0, i1, t) * cell, lz = -E + lerp(j0, j1, t) * cell;
            const e = cell * 0.5;
            let gx = sampleLocal(isl, lx + e, lz) - sampleLocal(isl, lx - e, lz), gz = sampleLocal(isl, lx, lz + e) - sampleLocal(isl, lx, lz - e);
            const gl = Math.hypot(gx, gz) || 1;
            gx /= gl; gz /= gl;   // uphill
            return [isl.x + lx, isl.z + lz, -gx, -gz];
        };
        const quad = (p, q) => {
            const a = [p[0] - p[2] * 3, p[1] - p[3] * 3], b = [q[0] - q[2] * 3, q[1] - q[3] * 3];
            const c = [p[0] + p[2] * W, p[1] + p[3] * W], d = [q[0] + q[2] * W, q[1] + q[3] * W];
            pos.push(a[0], 0, a[1], b[0], 0, b[1], d[0], 0, d[1], a[0], 0, a[1], d[0], 0, d[1], c[0], 0, c[1]);
            edge.push(0, 0, 1, 0, 1, 1);
        };
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const h00 = H[j * N1 + i], h10 = H[j * N1 + i + 1], h01 = H[(j + 1) * N1 + i], h11 = H[(j + 1) * N1 + i + 1];
            const code = (h00 > 0 ? 1 : 0) | (h10 > 0 ? 2 : 0) | (h11 > 0 ? 4 : 0) | (h01 > 0 ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const eB = () => pt(i, j, i + 1, j), eR = () => pt(i + 1, j, i + 1, j + 1), eT = () => pt(i, j + 1, i + 1, j + 1), eL = () => pt(i, j, i, j + 1);
            const segs = {
                1: [[eL, eB]], 2: [[eB, eR]], 3: [[eL, eR]], 4: [[eR, eT]], 6: [[eB, eT]], 7: [[eL, eT]], 8: [[eT, eL]],
                9: [[eT, eB]], 11: [[eT, eR]], 12: [[eR, eL]], 13: [[eR, eB]], 14: [[eB, eL]], 5: [[eL, eB], [eR, eT]], 10: [[eB, eR], [eT, eL]]
            }[code];
            segs.forEach(([f, g]) => quad(f(), g()));
        }
        if (!pos.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
        const mesh = new THREE.Mesh(geo, M.surf);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        mesh.visible = false;
        scene.add(mesh);
        return mesh;
    }

    function radarImage(isl) {
        const RN = 64, cv = document.createElement('canvas');
        cv.width = cv.height = RN;
        const ctx = cv.getContext('2d'), img = ctx.createImageData(RN, RN);
        for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) {
            const h = sampleLocal(isl, -isl.E + (i + 0.5) / RN * 2 * isl.E, -isl.E + (j + 0.5) / RN * 2 * isl.E);
            const o = (j * RN + i) * 4;
            img.data[o] = 110; img.data[o + 1] = 255; img.data[o + 2] = 150;
            img.data[o + 3] = h > 0 ? Math.min(255, 120 + h * 0.6) : 0;
        }
        ctx.putImageData(img, 0, 0);
        return cv;
    }

    // ------------------------------------------------------------------ the base
    const ROAD = [[-44, -80], [44, -80], [44, 30], [-44, 30]];
    function baseRoad(site) {
        // Road loop in island-local coordinates (site frame: +v toward the sea)
        const rx = site.dz, rz = -site.dx;
        return ROAD.map(([u, v]) => [site.x + u * rx + v * site.dx, site.z + u * rz + v * site.dz]);
    }
    function roadDist(road, x, z) {
        let best = Infinity;
        for (let i = 0; i < road.length; i++) {
            const a = road[i], b = road[(i + 1) % road.length];
            const abx = b[0] - a[0], abz = b[1] - a[1], t = clamp01(((x - a[0]) * abx + (z - a[1]) * abz) / (abx * abx + abz * abz));
            best = Math.min(best, Math.hypot(x - a[0] - abx * t, z - a[1] - abz * t));
        }
        return best;
    }

    const KINDS = {
        // hard: how much a near miss hurts it (concrete and sandbags shrug off blast, wood and tanks don't)
        hq: { name: 'Headquarters', hw: 11.5, hd: 6.5, h: 9, hp: 4, score: 250, fire: 70, hard: 0.7 },
        barracks: { name: 'Barracks', hw: 4, hd: 13, h: 5.5, hp: 2, score: 80, fire: 50, hard: 1 },
        warehouse: { name: 'Warehouse', hw: 8, hd: 17, h: 9, hp: 3, score: 100, fire: 60, hard: 1 },
        fuel: { name: 'Fuel tank', hw: 5.6, hd: 5.6, h: 8.8, hp: 1, score: 150, fire: 120, hard: 1 },
        mast: { name: 'Radio mast', hw: 2.4, hd: 2.4, h: 40, hp: 1, score: 120, fire: 0, hard: 0.6 },
        tower: { name: 'Lookout tower', hw: 2, hd: 2, h: 16, hp: 1, score: 40, fire: 20, hard: 0.8 },
        pillbox: { name: 'Pillbox', hw: 3.4, hd: 3.4, h: 2.6, hp: 3, score: 60, fire: 15, hard: 0.3 },
        aa: { name: 'AA position', hw: 4.4, hd: 4.4, h: 3, hp: 1.5, score: 120, fire: 20, hard: 0.6 },
        gun: { name: 'Coastal gun', hw: 7.6, hd: 7.6, h: 5, hp: 3, score: 300, fire: 40, hard: 0.35 },
        pier: { name: 'Pier', hw: 3, hd: 40, h: 3, hp: 4, score: 60, fire: 30, hard: 0.5 },
        truck: { hard: 1 }
    };

    function buildBase(isl, rng, site) {
        const gg = sharedGeos();
        const b = {
            isl, name: isl.name, x: isl.x + site.x, z: isl.z + site.z, fx: site.dx, fz: site.dz, coast: site.coast,
            yaw: Math.atan2(site.dx, site.dz), alert: false, fired: false, destroyed: false, sightT: 0,
            structures: [], guns: [], aa: [], mgs: [], trucks: [], barges: [], soldiers: null, posts: [], group: new THREE.Group()
        };
        b.rx = site.dz; b.rz = -site.dx;
        b.group.position.set(b.x, 0, b.z);
        b.group.rotation.y = b.yaw;
        b.group.visible = false;
        scene.add(b.group);
        const W = (u, v) => ({ x: b.x + u * b.rx + v * b.fx, z: b.z + u * b.rz + v * b.fz });
        const ground = (u, v) => { const w = W(u, v); return sampleLocal(isl, w.x - isl.x, w.z - isl.z); };
        const add = (kind, u, v, rot, geo, yOverride) => {
            const K = KINDS[kind], w = W(u, v);
            const gy = yOverride !== undefined ? yOverride : Math.max(ground(u, v), 0.6);
            const mesh = new THREE.Mesh(geo, M.kit);
            mesh.position.set(u, gy, v);
            mesh.rotation.y = rot;
            b.group.add(mesh);
            const st = {
                kind, base: b, obj: mesh, x: w.x, z: w.z, y: gy, yaw: b.yaw + rot, hw: K.hw, hd: K.hd, h: K.h, hp: K.hp, maxHp: K.hp,
                alive: true, sinking: false, isStructure: true, type: { name: K.name }, heading: 0, speed: 0,
                aimY: gy + Math.min(K.h * 0.35, 3), lockY: gy + Math.min(K.h * 0.5, 8), collapse: -1
            };
            b.structures.push(st);
            return st;
        };
        const rand = (a, c) => a + rng() * (c - a);
        // Camp buildings
        add('hq', 0, -34, 0, hqGeo());
        [-58, -24, 10].forEach(v => add('barracks', -60, v, 0, barracksGeo()));
        [-56, -14].forEach(v => add('warehouse', 62, v, 0, warehouseGeo()));
        [[92, -76], [106, -58], [90, -42]].forEach(([u, v]) => add('fuel', u, v, 0, fuelGeo()));
        add('mast', -18, -86, rand(0, 1), mastGeo());
        add('tower', 24, 38, 0.3, towerGeo());
        // Coastal battery on the seaward edge of the camp, AA pits, beach pillboxes
        const cg = coastGunGeos();
        [-72, 72].forEach(u => {
            const st = add('gun', u, 46, 0, gunPitGeo());
            const yawObj = new THREE.Object3D();
            yawObj.position.set(0, 0.4, 0);
            st.obj.add(yawObj);
            yawObj.add(new THREE.Mesh(cg.mount, M.kit));
            const cradle = new THREE.Object3D();
            cradle.position.set(0, 2.5, 0.4);
            yawObj.add(cradle);
            const barrel = new THREE.Mesh(cg.barrel, M.kit);
            cradle.add(barrel);
            st.gun = { yawObj, cradle, barrel, reload: rand(3, 9), sigma: 900, lastVel: new THREE.Vector3(), el: 0, solT: 0, recoil: 0 };
            b.guns.push(st);
        });
        const ag = aaGeos();
        [[-26, 18], [32, -96]].forEach(([u, v]) => {
            const st = add('aa', u, v, 0, ag.pit);
            const yawObj = new THREE.Object3D();
            yawObj.position.set(0, 1.1, 0);
            st.obj.add(yawObj);
            yawObj.add(new THREE.Mesh(ag.mount, M.kit));
            const cradle = new THREE.Object3D();
            cradle.position.set(0, 0.55, 0);
            yawObj.add(cradle);
            cradle.add(new THREE.Mesh(ag.guns, M.kit));
            st.gun = { yawObj, cradle, burstT: rand(0, 2), rounds: 0, fireT: 0 };
            b.aa.push(st);
        });
        const pb = pillboxGeo();
        [-44, 0, 44].forEach(u => {
            let v = site.coast - 26;
            for (let k = 0; k < 8 && ground(u, v) < 1.2; k++) v -= 8;
            const st = add('pillbox', u, v, 0, pb);
            st.mg = { burstT: rand(0, 3), rounds: 0, fireT: 0 };
            b.mgs.push(st);
        });
        // Pier from the beach out over the water, two landing barges alongside
        const pierLen = 80, pv = site.coast - 6 + pierLen / 2;
        add('pier', 0, pv, 0, pierGeo(pierLen), 0);
        b.pierEnd = W(0, site.coast + pierLen - 12);
        // Defensive posts the garrison runs to when the alarm goes
        b.structures.forEach(st => { if (st.kind === 'pillbox' || st.kind === 'aa' || st.kind === 'gun') for (let k = 0; k < 3; k++) b.posts.push({ x: st.x + rand(-6, 6), z: st.z + rand(-6, 6) }); });
        for (let k = 0; k < 8; k++) { const w = W(rand(-60, 60), rand(site.coast - 50, site.coast - 30)); b.posts.push(w); }   // trenches behind the beach
        // Soldiers
        const nS = quality === 0 ? 18 : quality === 1 ? 28 : 36;
        const sm = new THREE.InstancedMesh(gg.soldier, M.unit, nS);
        sm.frustumCulled = false;
        sm.visible = false;
        const S = [];
        for (let i = 0; i < nS; i++) {
            const w = W(rand(-80, 80), rand(-95, 45));
            S.push({ x: w.x, z: w.z, y: 0, hd: rand(0, 6.28), st: 0, t: rand(0, 6), tx: w.x, tz: w.z, ph: rand(0, 6.28), fall: 0, alive: true });
        }
        b.soldiers = { mesh: sm, S };
        scene.add(sm);
        // Trucks on the camp road
        const road = baseRoad(site).map(([x, z]) => ({ x: isl.x + x, z: isl.z + z }));
        let L = 0;
        const seg = road.map((p, i) => { const q = road[(i + 1) % road.length]; const l = Math.hypot(q.x - p.x, q.z - p.z); const s0 = L; L += l; return { p, q, s0, l }; });
        b.road = { seg, L };
        for (let i = 0; i < 2; i++) {
            const mesh = new THREE.Mesh(gg.truck, M.kit);
            mesh.visible = false;
            scene.add(mesh);
            const tr = { kind: 'truck', base: b, obj: mesh, s: L * i / 2, speed: 5, x: 0, z: 0, y: 0, hw: 1.2, hd: 3.3, h: 2.6, yaw: 0, hp: 0.5, maxHp: 0.5,
                alive: true, sinking: false, isStructure: true, type: { name: 'Truck' }, heading: 0, aimY: 0, lockY: 0, collapse: -1 };
            b.trucks.push(tr);
            b.structures.push(tr);
            placeTruck(tr, 0);
        }
        isl.base = b;
        spawnBarges(b);
    }

    function spawnBarges(b) {
        if (typeof spawnEnemy !== 'function' || !b.pierEnd) return;
        b.barges = [];
        [-1, 1].forEach(side => {
            const x = b.pierEnd.x + b.rx * side * 6.5, z = b.pierEnd.z + b.rz * side * 6.5;
            const e = spawnEnemy('barge', x, z, b.yaw);
            e.island = true;
            e.home = b;
            e.speed = 0;
            e.side = side;
            b.barges.push(e);
        });
    }

    function placeTruck(tr, dt) {
        const R = tr.base.road;
        tr.s = (tr.s + tr.speed * dt) % R.L;
        const sg = R.seg.find(s => tr.s >= s.s0 && tr.s < s.s0 + s.l) || R.seg[0];
        const f = (tr.s - sg.s0) / sg.l;
        tr.x = lerp(sg.p.x, sg.q.x, f); tr.z = lerp(sg.p.z, sg.q.z, f);
        const hd = Math.atan2(sg.q.x - sg.p.x, sg.q.z - sg.p.z);
        tr.heading = hd; tr.yaw = hd;
        tr.y = Math.max(0.5, groundAt(tr.x, tr.z));
        tr.aimY = tr.y + 1; tr.lockY = tr.y + 2;
        tr.obj.position.set(tr.x, tr.y, tr.z);
        tr.obj.rotation.y = hd;
    }

    // ------------------------------------------------------------------ queries
    function groundAt(x, z) {
        let best = -1000;
        for (let k = 0; k < list.length; k++) {
            const isl = list[k];
            if (!isl.ready) continue;
            const lx = x - isl.x, lz = z - isl.z;
            if (lx <= -isl.E || lz <= -isl.E || lx >= isl.E || lz >= isl.E) continue;
            const h = sampleLocal(isl, lx, lz);
            if (h > best) best = h;
        }
        return best;
    }
    function normalAt(x, z, out = _n) {
        const e = 5;
        return out.set(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).normalize();
    }
    function islandAt(x, z) {
        for (const isl of list) if (isl.ready && Math.abs(x - isl.x) < isl.E && Math.abs(z - isl.z) < isl.E) return isl;
        return null;
    }
    function near(x, z, margin = 0) {
        for (const isl of list) if (isl.ready && Math.abs(x - isl.x) < isl.E + margin && Math.abs(z - isl.z) < isl.E + margin) return true;
        return false;
    }
    // Where a ray first meets the land (distance along the ray), or null
    function raycast(o, d, maxDist) {
        let best = maxDist;
        let hit = false;
        for (const isl of list) {
            if (!isl.ready) continue;
            // 2D slab test against the island's square
            let t0 = 0, t1 = best;
            for (const [oc, dc, cc] of [[o.x, d.x, isl.x], [o.z, d.z, isl.z]]) {
                if (Math.abs(dc) < 1e-9) { if (Math.abs(oc - cc) >= isl.E) { t1 = -1; break; } continue; }
                let a = (cc - isl.E - oc) / dc, b = (cc + isl.E - oc) / dc;
                if (a > b) { const tmp = a; a = b; b = tmp; }
                t0 = Math.max(t0, a); t1 = Math.min(t1, b);
            }
            if (t1 <= t0) continue;
            // March, then bisect onto the surface
            let prev = t0, t = t0;
            const top = isl.maxH + 5;
            while (t <= t1) {
                const y = o.y + d.y * t;
                if (y < top) {
                    const g = sampleLocal(isl, o.x + d.x * t - isl.x, o.z + d.z * t - isl.z);
                    if (y < g) {
                        let a = prev, b = t;
                        for (let k = 0; k < 8; k++) {
                            const m = (a + b) / 2, ym = o.y + d.y * m;
                            if (ym < sampleLocal(isl, o.x + d.x * m - isl.x, o.z + d.z * m - isl.z)) b = m; else a = m;
                        }
                        if (b < best) { best = b; hit = true; }
                        break;
                    }
                } else if (d.y >= 0) break;
                prev = t;
                t += Math.max(isl.cell * 0.45, t * 0.003);
            }
        }
        return hit ? best : null;
    }
    // A heading close to `desired` with clear water `look` metres ahead (ships use it to stay off the reefs)
    function isWater(x, z, minDepth) { return groundAt(x, z) < -minDepth; }
    function steer(x, z, heading, desired, look, minDepth) {
        if (!near(x, z, look + 200)) return desired;
        const clear = h => {
            const sx = Math.sin(h), sz = Math.cos(h);
            for (let d = 120; d <= look; d += 120) if (!isWater(x + sx * d, z + sz * d, minDepth)) return false;
            return true;
        };
        if (clear(desired)) return desired;
        for (let k = 1; k <= 9; k++) {
            const a = desired + k * 20 * DEG, b = desired - k * 20 * DEG;
            const first = Math.abs(wrapAngle(a - heading)) <= Math.abs(wrapAngle(b - heading)) ? a : b;
            if (clear(first)) return first;
            const second = first === a ? b : a;
            if (clear(second)) return second;
        }
        return heading + Math.PI;
    }
    // Move a spawn point out of the land and shoals
    function clearSpot(x, z, margin = 400) {
        for (let k = 0; k < 30; k++) {
            let ok = isWater(x, z, 10);
            for (let a = 0; ok && a < 8; a++) ok = isWater(x + Math.sin(a * 0.785) * margin, z + Math.cos(a * 0.785) * margin, 6);
            if (ok) break;
            const isl = islandAt(x, z) || list.reduce((b, i) => (!b || Math.hypot(x - i.x, z - i.z) < Math.hypot(x - b.x, z - b.z) ? i : b), null);
            if (!isl) break;
            const dx = x - isl.x, dz = z - isl.z, l = Math.hypot(dx, dz) || 1;
            x += dx / l * 250; z += dz / l * 250;
        }
        return { x, z };
    }
    // Is a point inside a building (for shells that hit walls rather than the ground)?
    function structureAt(p) {
        for (const isl of list) {
            const b = isl.base;
            if (!b || !isl.ready) continue;
            const dx0 = p.x - b.x, dz0 = p.z - b.z;
            if (dx0 * dx0 + dz0 * dz0 > 320 * 320) continue;
            for (const st of b.structures) {
                if (!st.alive) continue;
                const dx = p.x - st.x, dz = p.z - st.z;
                if (Math.abs(dx) > st.hd + st.hw || Math.abs(dz) > st.hd + st.hw) continue;
                const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
                const lx = dx * c - dz * s, lz = dx * s + dz * c;
                if (Math.abs(lx) < st.hw && Math.abs(lz) < st.hd && p.y > st.y - 0.5 && p.y < st.y + st.h) return st;
            }
        }
        return null;
    }
    function boxDist(st, p) {
        const dx = p.x - st.x, dz = p.z - st.z, c = Math.cos(st.yaw), s = Math.sin(st.yaw);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const ex = Math.max(0, Math.abs(lx) - st.hw), ez = Math.max(0, Math.abs(lz) - st.hd), ey = Math.max(0, p.y - (st.y + st.h), st.y - 1 - p.y);
        return Math.hypot(ex, ez, ey);
    }
    // Shore targets the director can lock (alive, within gun range of the ship)
    function targets() {
        const out = [];
        for (const isl of list) {
            const b = isl.base;
            if (!b || !isl.ready || Math.hypot(b.x - phys.pos.x, b.z - phys.pos.z) > 17000) continue;
            for (const st of b.structures) if (st.alive && st.kind !== 'pier') out.push(st);
        }
        return out;
    }

    // ------------------------------------------------------------------ damage
    // Anything that explodes on or near the land: craters, scorched and felled trees, buildings, soldiers, trucks.
    // power: 1 = a 5" HE shell, ~0.1 = a 40 mm round, 2.5+ = a torpedo or bomb. byPlayer alerts the garrison.
    function impact(p, power = 1, direct = null, byPlayer = true) {
        const isl = islandAt(p.x, p.z);
        if (isl) {
            isl.damaged = true;
            if (power >= 0.4) crater(isl, p, power);
            else if (power >= 0.08) decal(p, 1.6 + power * 6);
            blastTrees(isl, p, power);
        }
        const R = 11 * Math.sqrt(power);
        for (const il of list) {
            const b = il.base;
            if (!b || !il.ready) continue;
            const db = Math.hypot(p.x - b.x, p.z - b.z);
            if (db > 600) continue;
            if (byPlayer && !b.alert) raiseAlert(b, 'attacked');
            if (db > 320) continue;
            for (const st of b.structures) {
                if (!st.alive) continue;
                const hard = KINDS[st.kind].hard, Rk = R * (0.4 + 0.6 * hard);
                const d = st === direct ? 0 : boxDist(st, p);
                if (d > Rk) continue;
                const dmg = st === direct ? power : power * 0.65 * hard * (1 - d / Rk);
                damageStructure(st, dmg, p, byPlayer);
            }
            blastSoldiers(b, p, power, byPlayer);
        }
    }

    function damageStructure(st, dmg, p, byPlayer) {
        if (!st.alive || dmg <= 0) return;
        st.hp -= dmg;
        if (st.hp > 0) {
            if (st.kind !== 'truck' && Math.random() < dmg * 0.5) addFire(p.x, Math.max(p.y, st.y + 1), p.z, rnd(15, 30), 0.6, 2);
            return;
        }
        st.alive = false;
        st.sinking = true;
        const K = KINDS[st.kind];
        const c = _v2.set(st.x, st.y + st.h * 0.3, st.z);
        st.obj.traverse(o => { if (o.isMesh) o.material = M.burnt; });
        st.collapse = 0;
        if (st.kind === 'fuel') {
            FX.fuelBlast(c.clone(), 1);
            playBoom(c, 2.4, 300, 5);
            addFire(st.x, st.y + 3, st.z, 150, 2.5, 4);
            // The blast sets off what's next to it
            setTimeout(() => impact(new THREE.Vector3(st.x, st.y + 2, st.z), 2.2, null, byPlayer), 350);
        } else if (st.kind === 'truck') {
            FX.explosion(c.clone().setY(st.y + 1.5), 0.8);
            addFire(st.x, st.y + 1.5, st.z, 40, 0.7, 1);
        } else {
            FX.explosion(c.clone(), st.kind === 'gun' || st.kind === 'hq' ? 1.4 : 1);
            playBoom(c, 1.4, 600, 2.4);
            if (K && K.fire) addFire(st.x, st.y + Math.min(st.h * 0.4, 4), st.z, K.fire * rnd(0.8, 1.3), st.kind === 'warehouse' || st.kind === 'hq' ? 1.6 : 1, Math.min(st.hw, 6));
        }
        if (typeof director !== 'undefined' && director.lock === st) director.lock = null;
        if (byPlayer && typeof Game !== 'undefined') {
            const score = st.kind === 'truck' ? 50 : K.score;
            Game.onShoreTarget(st, score);
        }
        checkBase(st.base);
    }

    function checkBase(b) {
        if (b.destroyed) return;
        const guns = b.guns.every(g => !g.alive) && b.aa.every(a => !a.alive);
        const rest = b.structures.filter(s => s.alive && s.kind !== 'pier').length / b.structures.length;
        if (guns && rest < 0.35) {
            b.destroyed = true;
            if (typeof Game !== 'undefined') Game.onBaseDestroyed(b);
        }
    }

    function crater(isl, p, power) {
        const R = Math.max(8 * Math.sqrt(power), isl.cell * 1.15), depth = 2.6 * Math.min(power, 3) * Math.min(1, 8 * Math.sqrt(power) / R * 1.5);
        const N1 = isl.n + 1, lx = p.x - isl.x + isl.E, lz = p.z - isl.z + isl.E;
        const i0 = Math.max(0, Math.floor((lx - R * 1.5) / isl.cell)), i1 = Math.min(isl.n, Math.ceil((lx + R * 1.5) / isl.cell));
        const j0 = Math.max(0, Math.floor((lz - R * 1.5) / isl.cell)), j1 = Math.min(isl.n, Math.ceil((lz + R * 1.5) / isl.cell));
        const pos = isl.lods[0].attributes.position.array;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const d = Math.hypot(i * isl.cell - lx, j * isl.cell - lz), k = j * N1 + i;
            if (d < R) {
                const w = 1 - (d / R) * (d / R);
                isl.H[k] -= depth * w * w;
                pos[k * 3 + 1] = isl.H[k];
            }
            if (d < R * 1.5) isl.scorch[k] = Math.min(1, isl.scorch[k] + 0.45 * (1 - d / (R * 1.5)) * Math.min(1, power));
        }
        // Normals and colours round the crater
        const nor = isl.lods[0].attributes.normal.array, col = isl.lods[0].attributes.color.array;
        const ni0 = Math.max(0, i0 - 1), ni1 = Math.min(isl.n, i1 + 1), nj0 = Math.max(0, j0 - 1), nj1 = Math.min(isl.n, j1 + 1);
        for (let j = nj0; j <= nj1; j++) for (let i = ni0; i <= ni1; i++) {
            const k = j * N1 + i;
            gridNormal(isl, i, j, _n);
            nor[k * 3] = _n.x; nor[k * 3 + 1] = _n.y; nor[k * 3 + 2] = _n.z;
            const s = isl.scorch[k] * 0.9;
            col[k * 3] = lerp(isl.colBase[k * 3], COL.burnt[0], s);
            col[k * 3 + 1] = lerp(isl.colBase[k * 3 + 1], COL.burnt[1], s);
            col[k * 3 + 2] = lerp(isl.colBase[k * 3 + 2], COL.burnt[2], s);
        }
        isl.dirty = isl.dirty ? [Math.min(isl.dirty[0], nj0), Math.max(isl.dirty[1], nj1)] : [nj0, nj1];
        isl.damaged = true;
        decal(_v.set(p.x, sampleLocal(isl, p.x - isl.x, p.z - isl.z), p.z), 6.5 * Math.sqrt(Math.min(power, 3)));
    }

    function decal(p, r) {
        if (!decals) return;
        const n = normalAt(p.x, p.z, _v2);
        _q.setFromUnitVectors(_up, n);
        _q.multiply(_q2.setFromAxisAngle(_up, Math.random() * Math.PI * 2));
        _m.compose(_s.copy(p).addScaledVector(n, 0.25), _q, _v.set(r * 2, 1, r * 2));
        decals.setMatrixAt(decalN % decals.instanceMatrix.count, _m);
        decalN++;
        decals.count = Math.min(decalN, decals.instanceMatrix.count);
        decals.instanceMatrix.needsUpdate = true;
    }

    function blastTrees(isl, p, power) {
        if (!isl.treeHash) return;
        const R = 13 * Math.sqrt(power), Rb = R * 2.2, th = isl.treeHash;
        const ci0 = Math.max(0, Math.floor((p.x - isl.x + isl.E - Rb) / th.HC)), ci1 = Math.min(th.hn - 1, Math.floor((p.x - isl.x + isl.E + Rb) / th.HC));
        const cj0 = Math.max(0, Math.floor((p.z - isl.z + isl.E - Rb) / th.HC)), cj1 = Math.min(th.hn - 1, Math.floor((p.z - isl.z + isl.E + Rb) / th.HC));
        let changed = false;
        const c = new THREE.Color();
        for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
            const cell = th.cells[cj * th.hn + ci];
            if (!cell) continue;
            for (const code of cell) {
                const set = isl.trees[Math.floor(code / 1e6)], i = code % 1e6, t = set.list[i];
                const d = Math.hypot(t.x - p.x, t.z - p.z);
                if (d > Rb) continue;
                if (d < R && !t.fallen) {
                    t.fallen = true;
                    t.dir = Math.atan2(t.x - p.x, t.z - p.z);
                    t.burnt = Math.max(t.burnt, 0.85);
                    if (Math.random() < 0.3) addFire(t.x, t.y + 1, t.z, rnd(10, 25), 0.35, 2);
                } else t.burnt = Math.max(t.burnt, 0.6 * (1 - (d - R) / (Rb - R)));
                if (set.far) { treeMatrix(t, set.far.instanceMatrix.array, i); set.far.setColorAt(i, treeColor(t, c)); set.dirty = true; }
                changed = true;
            }
        }
        if (changed) {
            isl.trees.forEach(set => { if (set.dirty && set.far) { set.far.instanceMatrix.needsUpdate = true; set.far.instanceColor.needsUpdate = true; set.dirty = false; } });
            refillNeeded = true;
            isl.damaged = true;
        }
    }

    function blastSoldiers(b, p, power, byPlayer) {
        if (!b.soldiers) return;
        const kill = 8 * Math.sqrt(power), scare = 45 * Math.sqrt(power);
        let killed = 0;
        for (const s of b.soldiers.S) {
            if (!s.alive) continue;
            const d = Math.hypot(s.x - p.x, s.z - p.z);
            if (d < kill * (0.7 + Math.random() * 0.5)) { s.alive = false; s.st = 4; s.fall = 0; s.hd = Math.atan2(s.x - p.x, s.z - p.z) + Math.PI; killed++; }
            else if (d < scare) {
                const l = d || 1;
                s.st = 3; s.t = rnd(2, 4);
                s.tx = s.x + (s.x - p.x) / l * rnd(20, 35); s.tz = s.z + (s.z - p.z) / l * rnd(20, 35);
            }
        }
        if (killed) b.isl.damaged = true;
        if (killed && byPlayer && typeof Game !== 'undefined') Game.onShoreTarget(null, killed * 5, killed);
    }

    // Fires on the land: buildings, trees, fuel
    function addFire(x, y, z, life, power, spread) {
        if (fires.length > 60) fires.shift();
        fires.push({ x, y, z, life, t: 0, power, spread: spread || 1, acc: 0 });
    }
    function updateFires(dt) {
        const cam = camera.position;
        for (let i = fires.length - 1; i >= 0; i--) {
            const f = fires[i];
            f.t += dt;
            if (f.t > f.life) { fires.splice(i, 1); continue; }
            if (Math.abs(cam.x - f.x) > 7000 || Math.abs(cam.z - f.z) > 7000) continue;
            const fade = 1 - f.t / f.life;
            f.acc += dt * f.power * (5 + 7 * fade) * Gfx.particleKeep;
            while (f.acc > 1) {
                f.acc -= 1;
                FX.burn(_v.set(f.x + randn() * f.spread, f.y, f.z + randn() * f.spread), 0.35 + 0.65 * fade);
            }
        }
    }

    // ------------------------------------------------------------------ the garrison
    const COAST_RANGE = 12000, COAST_RELOAD = 13, AA_RANGE = 2600, MG_RANGE = 1500;
    function raiseAlert(b, why) {
        if (b.alert || b.destroyed) return;
        b.alert = true;
        if (typeof Game === 'undefined' || !Game.running) return;
        if (why === 'attacked') hudMessage(`${b.name}: the garrison is alerted — the shore battery is manning its guns`, 'warn');
        if (camera.position.distanceTo(_v.set(b.x, 10, b.z)) < 5000 && typeof playSiren === 'function') playSiren(_v.clone(), 7);
        b.barges.forEach(e => { if (e.alive !== false) e.fleeing = true; });
    }

    const _tp = new THREE.Vector3();
    function tracerHitsPlayer(a, b) {
        const dx = b.x - phys.pos.x, dz = b.z - phys.pos.z, ax = a.x - phys.pos.x, az = a.z - phys.pos.z;
        if (dx * dx + dz * dz > 8100 && ax * ax + az * az > 8100) return null;
        for (let k = 1; k <= 4; k++) if (playerHitTest(_tp.copy(a).lerp(b, k / 4))) return true;
        return null;
    }
    const IJN25 = { color: [0.55, 1.0, 0.6], drag: 3.4e-4, life: 4.2, size: 1.1,
        test: tracerHitsPlayer, onHit: (h, p, prev) => { FX.spark(p, 8); Wreck.bullet(myShip, prev, p, 0.26); if (!playerDmg.sinking) playerDmg.hull -= 0.05; },
        burst: p => FX.flak(p, 0.22) };
    const IJNMG = { color: [0.95, 0.95, 0.8], drag: 6e-4, life: 2.6, size: 0.5,
        test: tracerHitsPlayer, onHit: (h, p, prev) => { FX.spark(p, 3); Wreck.bullet(myShip, prev, p, 0.09); if (!playerDmg.sinking) playerDmg.hull -= 0.006; } };

    function shipAim(from, speed, out) {
        const d = from.distanceTo(phys.pos), tof = d / speed;
        out.set(phys.pos.x + phys.vel.x * tof, phys.pos.y + 6 + 0.5 * GRAVITY * tof * tof * 1.15, phys.pos.z + phys.vel.z * tof);
        return out.sub(from).normalize();
    }

    function updateBase(b, dt, camD) {
        const dPlayer = Math.hypot(phys.pos.x - b.x, phys.pos.z - b.z);
        const live = Game.running && !Game.over && !Game.paused && !playerDmg.sinking;
        if (live && Game.hostile && !b.alert && !b.destroyed && dPlayer < 6500) {
            b.sightT += dt;
            if (b.sightT > 4) raiseAlert(b, 'sighted');
        }
        const engage = b.alert && live && dt > 0;
        if (dt > 0) {
            b.guns.forEach(st => coastGun(b, st, dt, engage, dPlayer));
            b.aa.forEach(st => aaPit(st, dt, engage && dPlayer < AA_RANGE));
            b.mgs.forEach(st => mgNest(st, dt, engage && dPlayer < MG_RANGE));
            b.trucks.forEach(tr => {
                if (!tr.alive) return;
                tr.speed = stepToward(tr.speed, b.alert ? 10 : 5, dt * 2);
                if (camD < Q[quality].unitR * 1.5) placeTruck(tr, dt); else tr.s = (tr.s + tr.speed * dt) % b.road.L;
            });
        }
        if (camD < Q[quality].unitR) updateSoldiers(b, dt);
        // Collapsing wreckage
        b.structures.forEach(st => {
            if (st.collapse < 0 || st.collapse >= 1) return;
            st.collapse = Math.min(1, st.collapse + dt * (st.kind === 'mast' || st.kind === 'tower' ? 0.6 : 1.4));
            const c = st.collapse, e = c * c;
            if (st.kind === 'mast' || st.kind === 'tower') st.obj.rotation.x = e * 1.45;
            else if (st.kind === 'gun') { if (st.gun) st.gun.cradle.rotation.x = 0.22 * e; }
            else if (st.kind === 'aa') { if (st.gun) st.gun.yawObj.rotation.z = 0.5 * e; }
            else if (st.kind === 'truck') st.obj.rotation.z = 0.4 * e;
            else if (st.kind !== 'pier' && st.kind !== 'pillbox') {
                st.obj.scale.y = 1 - 0.62 * e;
                st.obj.rotation.z = 0.06 * e;
            }
        });
    }

    function coastGun(b, st, dt, engage, d) {
        if (!st.alive) return;
        const g = st.gun;
        g.reload -= dt;
        g.recoil = Math.max(0, g.recoil - dt * 1.5);
        g.barrel.position.z = -0.9 * g.recoil;
        const want = engage && d < COAST_RANGE;
        const tYaw = want ? wrapAngle(Math.atan2(phys.pos.x - st.x, phys.pos.z - st.z) - b.yaw) : 0;
        const dy = wrapAngle(tYaw - g.yawObj.rotation.y);
        g.yawObj.rotation.y += Math.max(-dt * 7 * DEG, Math.min(dt * 7 * DEG, dy));
        g.solT -= dt;
        if (g.solT <= 0) {
            g.solT = 0.25;
            const sol = want ? firingSolution(d, -(st.y + 3)) : null;
            g.el = sol ? sol.el : 2 * DEG;
        }
        g.cradle.rotation.x = stepToward(g.cradle.rotation.x, -g.el, dt * 5 * DEG);
        if (!want || g.reload > 0 || Math.abs(dy) > 0.03) return;
        g.reload = COAST_RELOAD * rnd(0.85, 1.2);
        const dv = phys.vel.distanceTo(g.lastVel);
        g.lastVel.copy(phys.vel);
        const floor = 160 + 0.03 * d;
        g.sigma = dv > 2.5 ? Math.max(g.sigma, 550 + 0.05 * d) : Math.max(floor, g.sigma * 0.8);
        const storm = 1 + weather.storm * 0.4;
        g.cradle.updateMatrixWorld(true);
        const muzzle = g.cradle.localToWorld(new THREE.Vector3(0, 0, 7.6));
        const sol0 = firingSolution(d, -muzzle.y);
        const tof = sol0 ? sol0.tof : 20;
        const ax = phys.pos.x + phys.vel.x * tof + randn() * 20 * storm, az = phys.pos.z + phys.vel.z * tof + randn() * 20 * storm;
        const R = Math.hypot(ax - muzzle.x, az - muzzle.z) + randn() * g.sigma * storm;
        const sol = firingSolution(Math.max(200, R), -muzzle.y);
        if (!sol) return;
        const h = Math.atan2(ax - muzzle.x, az - muzzle.z);
        const dir = new THREE.Vector3(Math.sin(h) * Math.cos(sol.el), Math.sin(sol.el), Math.cos(h) * Math.cos(sol.el));
        spawnShell(muzzle, dir, _ZERO, 'enemy', WHITE_SPRAY);
        FX.muzzle(muzzle, dir, _ZERO, 1.2);
        playBoom(muzzle, 1.0, 650, 1.8);
        g.recoil = 1;
        if (!b.fired) {
            b.fired = true;
            hudMessage(`The shore battery on ${b.name} has opened fire!`, 'alert');
            playAlarm();
        }
    }

    function aaPit(st, dt, engage) {
        if (!st.alive) return;
        const g = st.gun, b = st.base;
        const dx = phys.pos.x - st.x, dz = phys.pos.z - st.z;
        const tYaw = wrapAngle(Math.atan2(dx, dz) - b.yaw);
        g.yawObj.rotation.y += Math.max(-dt * 1.2, Math.min(dt * 1.2, wrapAngle(tYaw - g.yawObj.rotation.y)));
        const el = Math.atan2(phys.pos.y + 6 - st.y, Math.hypot(dx, dz));
        g.cradle.rotation.x = stepToward(g.cradle.rotation.x, engage ? -el - 0.02 : -0.6, dt);
        if (!engage) return;
        g.burstT -= dt;
        if (g.burstT <= 0 && g.rounds <= 0) { g.burstT = rnd(1.8, 3.2); g.rounds = 7 + Math.floor(Math.random() * 5); playBurst(_v.set(st.x, st.y + 2, st.z), g.rounds, 0.13, 0.35, 1.3); }
        if (g.rounds <= 0) return;
        g.fireT -= dt;
        while (g.fireT <= 0 && g.rounds > 0) {
            g.fireT += 0.13;
            g.rounds--;
            g.cradle.updateMatrixWorld(true);
            const muzzle = g.cradle.localToWorld(_v.set(0, 0, 2.5));
            const dir = shipAim(muzzle, 820, _v2);
            const spread = 0.008 + 0.004 * weather.storm;
            dir.x += randn() * spread; dir.y += randn() * spread; dir.z += randn() * spread;
            Tracers.fire(muzzle, dir.normalize().multiplyScalar(900), IJN25);
        }
    }

    function mgNest(st, dt, engage) {
        if (!st.alive || !engage) return;
        const g = st.mg;
        g.burstT -= dt;
        if (g.burstT <= 0 && g.rounds <= 0) { g.burstT = rnd(2.5, 5); g.rounds = 10 + Math.floor(Math.random() * 10); playBurst(_v.set(st.x, st.y + 1.5, st.z), 6, 0.07, 0.18, 2.2); }
        if (g.rounds <= 0) return;
        g.fireT -= dt;
        while (g.fireT <= 0 && g.rounds > 0) {
            g.fireT += 0.07;
            g.rounds--;
            const muzzle = _v.set(st.x, st.y + 1.5, st.z);
            const dir = shipAim(muzzle, 700, _v2);
            dir.x += randn() * 0.012; dir.y += randn() * 0.012; dir.z += randn() * 0.012;
            Tracers.fire(muzzle, dir.normalize().multiplyScalar(750), IJNMG);
        }
    }

    function updateSoldiers(b, dt) {
        const { S, mesh } = b.soldiers, isl = b.isl;
        for (let i = 0; i < S.length; i++) {
            const s = S[i];
            if (!s.alive) s.fall = Math.min(1, s.fall + dt * 2.2);
            else if (dt > 0) {
                s.t -= dt;
                if (s.st === 0 && s.t <= 0) {
                    let p;
                    if (b.alert && b.posts.length) p = b.posts[Math.floor(Math.random() * b.posts.length)];
                    else p = { x: b.x + b.rx * rnd(-75, 75) + b.fx * rnd(-90, 40), z: b.z + b.rz * rnd(-75, 75) + b.fz * rnd(-90, 40) };
                    s.tx = p.x + rnd(-3, 3); s.tz = p.z + rnd(-3, 3);
                    s.st = b.alert ? 2 : 1;
                }
                if (s.st >= 1 && s.st <= 3) {
                    const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz), v = s.st === 1 ? 1.4 : s.st === 2 ? 4.4 : 5.6;
                    if (d < 1 || (s.st === 3 && s.t <= 0)) { s.st = 0; s.t = b.alert ? rnd(5, 12) : rnd(3, 14); }
                    else {
                        const step = Math.min(d, v * dt);
                        s.x += dx / d * step; s.z += dz / d * step;
                        s.hd = Math.atan2(dx, dz);
                        s.ph += dt * v * 3.4;
                    }
                }
            }
            s.y = sampleLocal(isl, s.x - isl.x, s.z - isl.z);
            const moving = s.alive && s.st >= 1 && s.st <= 3;
            _q.setFromEuler(_e.set(-s.fall * Math.PI / 2, s.hd, 0, 'YXZ'));
            _m.compose(_v.set(s.x, Math.max(s.y, 0.4) + (moving ? Math.abs(Math.sin(s.ph)) * 0.07 : 0) - s.fall * 0.15, s.z), _q, _s.set(1, 1, 1));
            mesh.setMatrixAt(i, _m);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    // ------------------------------------------------------------------ lifecycle
    function finish(isl) {
        isl.ready = true;
        scene.add(isl.mesh);
        list.push(isl);
        refillNeeded = true;
        shallowT = 0;
    }
    function dispose(isl) {
        if (isl.mesh) { scene.remove(isl.mesh); isl.lods.forEach(g => g.dispose()); }
        if (isl.surf) { scene.remove(isl.surf); isl.surf.geometry.dispose(); }
        (isl.trees || []).forEach(set => { if (set.far) { scene.remove(set.far); set.far.dispose(); } });
        const b = isl.base;
        if (b) {
            scene.remove(b.group);
            b.group.traverse(o => { if (o.isMesh && o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); });
            if (b.soldiers) { scene.remove(b.soldiers.mesh); b.soldiers.mesh.dispose(); }
            b.trucks.forEach(t => scene.remove(t.obj));
            b.structures.forEach(st => { st.alive = false; st.sinking = true; });
            b.barges.forEach(e => {
                const i = enemies.indexOf(e);
                if (i >= 0) { scene.remove(e.obj); enemies.splice(i, 1); }
            });
            if (typeof director !== 'undefined' && director.lock && director.lock.base === b) director.lock = null;
        }
        isl.ready = false;
        refillNeeded = true;
    }

    function stream(cx, cz) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (Math.hypot(list[i].x - cx, list[i].z - cz) > DROP_R) { dispose(list[i]); list.splice(i, 1); }
        }
        const have = id => list.some(l => l.id === id) || queue.some(s => s.id === id) || (building && building.spec.id === id);
        const i0 = Math.floor((cx - GEN_R) / SECTOR), i1 = Math.floor((cx + GEN_R) / SECTOR);
        const j0 = Math.floor((cz - GEN_R) / SECTOR), j1 = Math.floor((cz + GEN_R) / SECTOR);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const s = sectorSpec(i, j);
            if (s && Math.hypot(s.x - cx, s.z - cz) < GEN_R && !have(s.id)) queue.push(s);
        }
        if (Math.hypot(HOME.x - cx, HOME.z - cz) < GEN_R && !have('home')) queue.push(HOME_SPEC);
        queue.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    }

    function pump(budgetMs) {
        const t0 = performance.now();
        while (performance.now() - t0 < budgetMs) {
            if (!building) {
                const spec = queue.shift();
                if (!spec) return;
                building = { spec, gen: buildGen(spec) };
            }
            const r = building.gen.next();
            if (r.done) { finish(r.value); building = null; }
        }
    }

    function makeNearSets(q) {
        nearPalm = new THREE.InstancedMesh(G.palm, M.tree, q.nearCap);
        nearClump = new THREE.InstancedMesh(G.clump, M.tree, q.nearCap);
        [nearPalm, nearClump].forEach(m => {
            m.frustumCulled = false;
            m.setColorAt(0, new THREE.Color(1, 1, 1));   // allocates the colour buffer (sized by count), then empty it
            m.count = 0;
            scene.add(m);
        });
    }

    function init() {
        mats();
        sharedGeos();
        const q = Q[quality = Settings.gfx.terrain ?? 1];
        makeNearSets(q);
        decals = new THREE.InstancedMesh(G.decal, M.decal, 320);
        decals.count = 0;
        decals.frustumCulled = false;
        decals.renderOrder = 1;
        scene.add(decals);
        stream(0, 0);
        // The islands in sight of the start are built now; the rest arrive over the next few seconds
        while (queue.length && Math.hypot(queue[0].x, queue[0].z) < 12000) { building = null; const s = queue.shift(); const gen = buildGen(s); let r; do r = gen.next(); while (!r.done); finish(r.value); }
    }

    // Graphics level changed: rebuild everything at the new detail
    function setQuality(qi) {
        if (qi === quality || !M) return;
        quality = qi;
        while (list.length) dispose(list.pop());
        queue.length = 0; building = null;
        const q = Q[quality];
        [nearPalm, nearClump].forEach(m => { scene.remove(m); m.dispose(); });
        makeNearSets(q);
        stream(phys.pos.x, phys.pos.z);
        pump(1e9);
        refillNeeded = true;
    }

    // View distance (graphics settings): islands are built and kept out to further, trees and surf drawn further
    function setViewDist(k) {
        const vk = Math.min(2.5, Math.max(1, k));
        if (vk === viewK) return;
        viewK = vk;
        GEN_R = 19000 * vk; DROP_R = GEN_R + 6000;
        if (M) stream(phys.pos.x, phys.pos.z);
    }

    // New game: damaged islands are rebuilt fresh, garrisons stand down, barges return to their piers
    function reset() {
        fires.length = 0;
        decalN = 0;
        if (decals) decals.count = 0;
        for (let i = list.length - 1; i >= 0; i--) {
            const isl = list[i];
            const far = Math.hypot(isl.x, isl.z) > DROP_R;
            const b = isl.base;
            const hurt = isl.damaged || (b && b.structures.some(s => !s.alive || s.hp < s.maxHp));
            if (far || hurt) { dispose(isl); list.splice(i, 1); }
            else if (b) {
                Object.assign(b, { alert: false, fired: false, destroyed: false, sightT: 0 });
                b.guns.forEach(st => Object.assign(st.gun, { reload: rnd(3, 9), sigma: 900 }));
                spawnBarges(b);
            }
        }
        queue.length = 0; building = null;
        stream(0, 0);
        while (queue.length && Math.hypot(queue[0].x, queue[0].z) < 12000) { const s = queue.shift(); const gen = buildGen(s); let r; do r = gen.next(); while (!r.done); finish(r.value); }
        refillNeeded = true;
    }

    function update(dt, t) {
        if (!M) return;
        streamT -= dt;
        if (streamT <= 0) { streamT = 0.8; stream(phys.pos.x, phys.pos.z); }
        if (queue.length || building) pump(3.5);
        const q = Q[quality];
        liftU.value = 1.6 / (camera.near * 16777216);
        nearU.value = q.nearR; farU.value = q.farR;
        camera.updateMatrixWorld();
        _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const cam = camera.position;
        for (const isl of list) {
            if (!isl.ready) continue;
            const dC = Math.hypot(cam.x - isl.x, cam.z - isl.z), dEdge = Math.max(0, dC - isl.E * 1.2);
            const inView = _frustum.intersectsSphere(isl.sphere);
            const lod = dEdge < 2200 ? 0 : dEdge < 6500 ? 1 : 2;
            if (lod !== isl.lod) { isl.lod = lod; isl.mesh.geometry = isl.lods[lod]; }
            if (isl.dirty) {
                const g = isl.lods[0], N1 = isl.n + 1, [j0, j1] = isl.dirty;
                ['position', 'normal', 'color'].forEach(a => {
                    const at = g.attributes[a];
                    at.updateRange.offset = j0 * N1 * 3;
                    at.updateRange.count = (j1 - j0 + 1) * N1 * 3;
                    at.needsUpdate = true;
                });
                isl.dirty = null;
            }
            isl.trees.forEach(set => { if (set.far) set.far.visible = inView && dEdge < q.farR * viewK; });
            if (isl.surf) isl.surf.visible = inView && dEdge < q.surfR * viewK;
            const b = isl.base;
            if (b) {
                const dB = Math.hypot(cam.x - b.x, cam.z - b.z);
                b.group.visible = dB < q.baseR;
                b.soldiers.mesh.visible = dB < q.unitR;
                b.trucks.forEach(tr => { tr.obj.visible = dB < q.baseR * 0.7; });
                updateBase(b, dt, dB);
            }
        }
        if (refillNeeded || cam.distanceTo(lastRefill) > 60) refillNearTrees();
        updateFires(dt);
        shallowT -= dt;
        if (shallowT <= 0) {
            shallowT = 0.5;
            const all = [];
            list.forEach(isl => { if (isl.ready) isl.circles.forEach(c => all.push(c)); });
            all.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - a.r - (Math.hypot(b.x - cam.x, b.z - cam.z) - b.r));
            for (let i = 0; i < islandBlobU.length; i++) {
                const c = all[i];
                if (c) islandBlobU[i].set(c.x, c.z, c.r); else islandBlobU[i].set(0, 0, 0);
            }
        }
    }

    // Land on the SG radar's heading-up PPI (scope centre c, radius R, range in metres, ship heading hdg)
    function drawRadar(ctx, c, R, range, hdg) {
        const k = R / range, ch = Math.cos(hdg), sh = Math.sin(hdg);
        ctx.save();
        ctx.beginPath();
        ctx.arc(c, c, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = 0.55;
        for (const isl of list) {
            if (!isl.ready || !isl.radarImg) continue;
            if (Math.hypot(isl.x - phys.pos.x, isl.z - phys.pos.z) - isl.E > range) continue;
            const s = 2 * isl.E / isl.radarImg.width, ox = isl.x - isl.E - phys.pos.x, oz = isl.z - isl.E - phys.pos.z;
            ctx.setTransform(-k * s * ch, -k * s * sh, k * s * sh, -k * s * ch, c + k * (-ch * ox + sh * oz), c + k * (-sh * ox - ch * oz));
            ctx.drawImage(isl.radarImg, 0, 0);
        }
        ctx.restore();
    }

    return {
        init, update, reset, setQuality, setViewDist, groundAt, normalAt, near, raycast, steer, clearSpot, structureAt, targets, impact,
        drawRadar, isWater,
        get list() { return list; },
        get bases() { return list.filter(i => i.ready && i.base).map(i => i.base); },
        alertNear(p) { list.forEach(isl => { const b = isl.base; if (b && Math.hypot(p.x - b.x, p.z - b.z) < 700) raiseAlert(b, 'attacked'); }); }
    };
})();
