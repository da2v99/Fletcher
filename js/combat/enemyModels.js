// Procedural IJN ship models. Each builder returns { group, turrets, torpLaunchers, stacks, len, beam, top }
// in the same local frame as our own ship (+Z bow, Y = 0 waterline).

const IJN = (() => {
    let M = null;
    function mats() {
        if (M) return M;
        const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }, o));
        M = {
            gray: std(0x6f7472),          // Kure arsenal grey
            grayDark: std(0x535856),
            lino: std(0x6b4a36),          // linoleum-covered decks
            wood: std(0x7b6750),
            red: std(0x5c1f18),
            boot: std(0x1c1d1e),
            black: std(0x1a1a1b),
            maruHull: std(0x2a2b2d),
            maruUpper: std(0xc9c2b2),
            gun: std(0x3f4346, { metalness: 0.35 })
        };
        return M;
    }

    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        parent.add(m);
        return m;
    };

    // Hull in three layers: red bottom, black boot, grey topsides; the outline is a convex plan shape
    function hull(g, plan, draft, freeboard, topMat, deckMat) {
        const m = mats();
        const shrink = (s) => plan.map(([x, z]) => [x * s, z * (1 - (1 - s) * 0.15)]);
        add(g, loftPrism(shrink(0.72), -draft, shrink(0.98), -0.3), m.red);
        add(g, loftPrism(shrink(0.98), -0.3, plan, 0.4), m.boot);
        add(g, loftPrism(plan, 0.4, plan, freeboard), topMat);
        add(g, prism(plan.map(([x, z]) => [x * 0.985, z * 0.995]), freeboard - 0.02, freeboard + 0.05), deckMat);
    }

    // Twin gun house (Type A / B style) that trains; barrels in an elevating cradle
    function twinMount(scale = 1) {
        const m = mats();
        const t = new THREE.Group();
        add(t, Cyl(1.6 * scale, 1.7 * scale, 0.35, 16), m.grayDark, 0, 0.17, 0);
        add(t, loftPrism([[-1.5, 1.8], [1.5, 1.8], [1.7, -2.2], [-1.7, -2.2]].map(([x, z]) => [x * scale, z * scale]), 0.35,
                         [[-1.2, 0.9], [1.2, 0.9], [1.5, -2.1], [-1.5, -2.1]].map(([x, z]) => [x * scale, z * scale]), 0.35 + 2.1 * scale), m.gray);
        const cradle = new THREE.Group();
        cradle.position.set(0, 1.3 * scale, 1.0 * scale);
        t.add(cradle);
        [-0.55, 0.55].forEach(x => {
            const b = CylZ(0.09, 0.13, 5.2 * scale, 8);
            b.translate(0, 0, 2.4 * scale);
            add(cradle, b, m.gun, x * scale, 0, 0);
        });
        t.userData.cradle = cradle;
        return t;
    }

    function singleMount() {
        const m = mats();
        const t = new THREE.Group();
        add(t, Cyl(1.0, 1.1, 0.3, 12), m.grayDark, 0, 0.15, 0);
        add(t, loftPrism([[-0.9, 1.2], [0.9, 1.2], [1.1, -1.4], [-1.1, -1.4]], 0.3, [[-0.8, 0.6], [0.8, 0.6], [1.0, -1.3], [-1.0, -1.3]], 2.0), m.gray);
        const cradle = new THREE.Group();
        cradle.position.set(0, 1.2, 0.6);
        t.add(cradle);
        const b = CylZ(0.08, 0.12, 5.5, 8);
        b.translate(0, 0, 2.6);
        add(cradle, b, m.gun);
        t.userData.cradle = cradle;
        return t;
    }

    function torpLauncher(tubes = 3) {
        const m = mats();
        const g = new THREE.Group();
        add(g, Cyl(1.3, 1.4, 0.4, 12), m.grayDark, 0, 0.2, 0);
        for (let i = 0; i < tubes; i++) add(g, CylZ(0.3, 0.3, 8.5, 8), m.gray, (i - (tubes - 1) / 2) * 0.68, 0.9, 0.5);
        add(g, loftPrism([[-1.4, 1.2], [1.4, 1.2], [1.5, -2.8], [-1.5, -2.8]], 0.4, [[-1.2, 0.6], [1.2, 0.6], [1.3, -2.6], [-1.3, -2.6]], 1.9), m.gray);
        return g;
    }

    function stack(g, x, y, z, r, h, rake = 0.12) {
        const m = mats();
        const s = add(g, Cyl(r * 0.92, r, h, 16), m.gray, x, y + h / 2, z);
        s.rotation.x = -rake;
        const cap = add(g, Cyl(r * 0.95, r * 0.93, 0.8, 16), m.black, x, y + h - 0.2, z - Math.sin(rake) * h / 2);
        cap.rotation.x = -rake;
        return new THREE.Vector3(x, y + h, z - Math.sin(rake) * h);
    }

    function mast(g, x, y, z, h, yard) {
        const m = mats();
        add(g, Cyl(0.14, 0.24, h, 8), m.grayDark, x, y + h / 2, z);
        if (yard) add(g, CylX(0.07, yard, 6), m.grayDark, x, y + h * 0.8, z);
    }

    // Fubuki / Kagero-type destroyer, ~118 m
    function destroyer() {
        const m = mats();
        const g = new THREE.Group();
        const plan = [[-4.2, -59], [4.2, -59], [5.2, -44], [5.2, 12], [3.4, 42], [0, 59], [-3.4, 42], [-5.2, 12], [-5.2, -44]];
        hull(g, plan, 3.4, 4.2, m.gray, m.lino);
        // Raised forecastle
        const fc = [[-5.15, 14], [5.15, 14], [3.35, 42], [0, 58.6], [-3.35, 42]];
        add(g, prism(fc, 4.2, 6.6), m.gray);
        add(g, prism(fc.map(([x, z]) => [x * 0.98, z]), 6.58, 6.66), m.lino);
        // Bridge tower
        add(g, Box(6.5, 2.4, 7), m.gray, 0, 7.8, 31);
        add(g, Box(5.2, 2.2, 5), m.gray, 0, 10.1, 31.5);
        add(g, Box(4.2, 1.6, 3.6), m.gray, 0, 12.0, 32);
        add(g, Box(4.3, 0.5, 3.7), m.black, 0, 11.6, 32.1);
        add(g, CylX(0.18, 3.2, 8), m.grayDark, 0, 13.3, 31.5);   // rangefinder
        mast(g, 0, 12.6, 28.5, 12, 6);
        // Funnels, torpedo mounts, after deckhouse, mainmast
        const stacks = [stack(g, 0, 4.2, 18, 1.6, 8.5), stack(g, 0, 4.2, 2, 1.45, 7.5)];
        const t1 = torpLauncher(3); t1.position.set(0, 4.2, 9.5); g.add(t1);
        const t2 = torpLauncher(3); t2.position.set(0, 4.2, -8); g.add(t2);
        add(g, Box(5, 2.3, 16), m.gray, 0, 5.35, -27);
        mast(g, 0, 6.5, -20, 9, 4);
        // Gun mounts: one forward on the forecastle, two aft (one superfiring)
        const turrets = [];
        [[0, 6.66, 45, 0], [0, 6.5, -30, Math.PI], [0, 4.2, -41, Math.PI]].forEach(([x, y, z, yaw]) => {
            const t = twinMount(); t.position.set(x, y, z); t.rotation.y = yaw; t.userData.stowYaw = yaw; t.userData.aft = z < 0; g.add(t); turrets.push(t);
        });
        return { group: g, turrets, torpLaunchers: [t1, t2], stacks, len: 118, beam: 10.4, top: 13 };
    }

    // Maru: a ~110 m freighter pressed into service as a transport
    function maru() {
        const m = mats();
        const g = new THREE.Group();
        const plan = [[-6.6, -55], [6.6, -55], [7.5, -40], [7.5, 25], [5.0, 45], [0, 56], [-5.0, 45], [-7.5, 25], [-7.5, -40]];
        hull(g, plan, 6.2, 5.2, m.maruHull, m.wood);
        add(g, prism([[-5, 40], [5, 40], [0, 55.5]], 5.2, 7.2), m.maruHull);   // raised bow
        add(g, Box(12, 3, 18), m.maruUpper, 0, 6.7, -3);
        add(g, Box(10, 2.6, 12), m.maruUpper, 0, 9.5, -1);
        add(g, Box(7, 2, 5), m.maruUpper, 0, 11.8, 1.5);
        add(g, Box(12.5, 2.2, 8), m.maruUpper, 0, 6.3, -46);
        const stacks = [stack(g, 0, 10.8, -8, 2.1, 8, 0.08)];
        // Cargo hatches, masts with derrick booms
        [30, 18, -22, -34].forEach(z => add(g, Box(6, 0.8, 6), m.wood, 0, 5.6, z));
        [[24, 16], [-28, 14]].forEach(([z, h]) => {
            mast(g, 0, 5.2, z, h, 7);
            [-1, 1].forEach(s => strut(g, new THREE.Vector3(0, 6.2, z), new THREE.Vector3(s * 2.5, 5.2 + h * 0.7, z + (z > 0 ? 7 : -7)), 0.12, m.grayDark));
        });
        const gun = singleMount(); gun.position.set(0, 7.5, -50); gun.rotation.y = Math.PI; gun.userData.stowYaw = Math.PI; gun.userData.aft = true; g.add(gun);
        return { group: g, turrets: [gun], torpLaunchers: [], stacks, len: 111, beam: 15, top: 14 };
    }

    // Nagara-type light cruiser, ~162 m
    function cruiser() {
        const m = mats();
        const g = new THREE.Group();
        const plan = [[-5.6, -81], [5.6, -81], [7.1, -60], [7.1, 20], [4.8, 58], [0, 81], [-4.8, 58], [-7.1, 20], [-7.1, -60]];
        hull(g, plan, 4.8, 5.0, m.gray, m.lino);
        const fc = [[-7.05, 22], [7.05, 22], [4.75, 58], [0, 80.6], [-4.75, 58]];
        add(g, prism(fc, 5.0, 7.6), m.gray);
        add(g, prism(fc.map(([x, z]) => [x * 0.98, z]), 7.58, 7.66), m.lino);
        // Pagoda-style bridge
        add(g, Box(8, 3, 9), m.gray, 0, 9.1, 40);
        add(g, Box(6.5, 3, 7), m.gray, 0, 12.1, 40.5);
        add(g, Box(5, 2.6, 5), m.gray, 0, 14.9, 41);
        add(g, Box(3.8, 1.8, 3.6), m.gray, 0, 17.1, 41.5);
        add(g, CylX(0.2, 4.2, 8), m.grayDark, 0, 18.4, 41);
        mast(g, 0, 16, 36, 16, 8);
        const stacks = [stack(g, 0, 5.0, 22, 1.9, 10), stack(g, 0, 5.0, 10, 1.9, 10), stack(g, 0, 5.0, -2, 1.9, 10)];
        add(g, Box(6, 2.6, 22), m.gray, 0, 6.3, -30);
        mast(g, 0, 7.6, -22, 14, 6);
        const t1 = torpLauncher(4); t1.position.set(-4.2, 5.0, -12); g.add(t1);
        const t2 = torpLauncher(4); t2.position.set(4.2, 5.0, -12); g.add(t2);
        const turrets = [];
        [[0, 7.66, 62, 0], [0, 7.66, 52, 0], [0, 10.6, 44.5, 0], [-5.2, 5.0, 16, 0], [5.2, 5.0, 16, 0], [0, 7.6, -44, Math.PI], [0, 5.0, -55, Math.PI]].forEach(([x, y, z, yaw]) => {
            const t = singleMount(); t.position.set(x, y, z); t.rotation.y = yaw; t.userData.stowYaw = yaw; t.userData.aft = z < 0; g.add(t); turrets.push(t);
        });
        return { group: g, turrets, torpLaunchers: [t1, t2], stacks, len: 162, beam: 14.2, top: 18 };
    }

    return { destroyer, maru, cruiser };
})();
