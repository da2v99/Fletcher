// Individual fittings for the Fletcher: guns, directors, radars, funnels, boats, railings, flag.

// --- Armament ---

// 5"/38 Mk 30 single enclosed mount (gun faces +Z). Slab-sided shield with a sloped glacis and heavily
// chamfered front corners, rounded roof edges, a gun slot running up the face and over the roof closed by
// a canvas blast bag, pointer / trainer sight ports on the cheeks, and roof sight hoods.
function createGunTurret() {
    const turret = new THREE.Group();
    const M = MAT.turret, D = MAT.turretDark, K = MAT.black;
    const wallX = y => 1.72 - 0.14 * (y - 0.3) / 2.02 + 0.015;   // side wall leans in toward the roof
    addMesh(turret, Cyl(1.78, 1.84, 0.3, 32), D, 0, 0.15, 0);     // training base ring
    addMesh(turret, Cyl(1.86, 1.86, 0.06, 32), MAT.grayDark, 0, 0.03, 0);

    // Shield: straight lower walls, sloped glacis, then a bevelled band that rounds the roof edge
    const base = [[-0.72, 2.12], [0.72, 2.12], [1.58, 1.24], [1.72, 0.42], [1.72, -2.42], [-1.72, -2.42], [-1.72, 0.42], [-1.58, 1.24]];
    const shoulder = [[-0.6, 1.58], [0.6, 1.58], [1.42, 0.86], [1.58, 0.2], [1.58, -2.34], [-1.58, -2.34], [-1.58, 0.2], [-1.42, 0.86]];
    const roof = [[-0.5, 1.4], [0.5, 1.4], [1.26, 0.76], [1.4, 0.14], [1.4, -2.18], [-1.4, -2.18], [-1.4, 0.14], [-1.26, 0.76]];
    addMesh(turret, loftPrism(base, 0.3, shoulder, 2.32), M);
    addMesh(turret, loftPrism(shoulder, 2.32, roof, 2.56), M);
    // Rear overhang lip and a weld seam round the walls
    addMesh(turret, Box(3.5, 0.1, 0.16), D, 0, 2.2, -2.42);
    [-1, 1].forEach(s => addMesh(turret, Box(0.04, 0.05, 2.8), D, s * wallX(1.2), 1.2, -1.0));

    // Gun slot up the glacis and back over the roof, closed by a lumpy canvas blast bag
    addMesh(turret, Box(0.62, 1.5, 0.3), K, 0, 1.55, 1.78).rotation.x = -0.27;
    addMesh(turret, Box(0.62, 0.06, 0.95), K, 0, 2.55, 1.05);
    const bagPath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.05, 1.98), new THREE.Vector3(0, 1.75, 1.84), new THREE.Vector3(0, 2.35, 1.6),
        new THREE.Vector3(0, 2.62, 1.2), new THREE.Vector3(0, 2.66, 0.62)
    ]);
    const bag = new THREE.TubeGeometry(bagPath, 20, 0.3, 12, false);
    const bp = bag.attributes.position, c0 = new THREE.Vector3();
    for (let i = 0; i < bp.count; i++) {
        // Squash into the slot and add folds so it reads as slack canvas
        const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
        const u = Math.floor(i / 13) / 20;
        bagPath.getPointAt(Math.min(1, u), c0);
        const fold = 1 + 0.13 * Math.sin(u * 47 + x * 9) + 0.07 * Math.sin(u * 113 + y * 5);
        bp.setXYZ(i, x * 0.95 * fold, c0.y + (y - c0.y) * 0.62 * fold, c0.z + (z - c0.z) * 0.62 * fold);
    }
    bag.computeVertexNormals();
    addMesh(turret, bag, MAT.canvasBag);

    // Pointer / trainer sight ports on the chamfered cheeks, with hoods
    [-1, 1].forEach(s => {
        const cheek = new THREE.Group();
        cheek.position.set(s * 1.06, 1.92, 1.33);
        cheek.rotation.set(-0.23, s * 0.8, 0, 'YXZ');   // face the chamfer and lean with it
        turret.add(cheek);
        addMesh(cheek, Box(0.4, 0.3, 0.05), K, 0, 0, 0.03);
        addMesh(cheek, Box(0.52, 0.06, 0.22), M, 0, 0.2, 0.1);
        addMesh(cheek, Box(0.34, 0.22, 0.05), K, 0, -0.62, 0.02);   // lower port
        // Side ports and a small ventilator box
        addMesh(turret, Box(0.05, 0.28, 0.4), K, s * wallX(1.75), 1.75, 0.05);
        addMesh(turret, Box(0.05, 0.22, 0.3), K, s * wallX(1.25), 1.25, -0.6);
        addMesh(turret, Box(0.18, 0.5, 0.5), D, s * (wallX(0.9) + 0.08), 0.9, -1.55);
    });

    // Roof: sight hoods either side of the slot, mount captain's hatch, access hatch, periscope stub
    [-1, 1].forEach(s => {
        addMesh(turret, Box(0.46, 0.36, 0.72), M, s * 0.88, 2.74, 0.62);
        addMesh(turret, Box(0.34, 0.16, 0.04), K, s * 0.88, 2.78, 0.99);
    });
    addMesh(turret, Cyl(0.36, 0.4, 0.14, 16), D, 0.7, 2.63, -1.25);
    addMesh(turret, Box(0.8, 0.08, 0.6), D, -0.65, 2.6, -1.4);
    addMesh(turret, Cyl(0.08, 0.08, 0.3, 8), MAT.gunMetal, -0.25, 2.7, -0.4);

    // Rear door, grab rails and ladder rungs
    addMesh(turret, Box(0.9, 1.5, 0.06), D, -0.35, 1.1, -2.44);
    for (let i = 0; i < 4; i++) addMesh(turret, Box(0.45, 0.04, 0.08), MAT.metal, 0.95, 0.65 + i * 0.42, -2.47);
    [-1, 1].forEach(s => addMesh(turret, Box(0.04, 0.04, 1.6), MAT.metal, s * (wallX(2.0) + 0.05), 2.0, -1.2));

    // Gun: painted 5"/38 barrel with a slight taper, muzzle swell and a canvas sleeve at the slot
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.55, 1.0);
    turret.add(pivot);
    const barrelGeo = CylZ(0.1, 0.15, 4.9, 16);
    barrelGeo.translate(0, 0, 2.65);
    addMesh(pivot, barrelGeo, MAT.turretDark);
    addMesh(pivot, CylZ(0.125, 0.115, 0.22, 16), MAT.turretDark, 0, 0, 5.0);
    addMesh(pivot, CylZ(0.2, 0.2, 0.3, 14), MAT.turretDark, 0, 0, 1.1);
    addMesh(pivot, CylZ(0.24, 0.3, 0.7, 12), MAT.canvasBag, 0, 0, 0.8);

    turret.userData.barrel = pivot;
    return turret;
}

// Mk 15 quintuple 21" torpedo tube mount (muzzles toward +Z)
function createTorpedoTubes() {
    const group = new THREE.Group();
    addMesh(group, Cyl(1.5, 1.6, 0.4, 24), MAT.grayDark, 0, 0.2, 0);
    addMesh(group, Box(3.3, 0.35, 4.8), MAT.gray, 0, 0.58, 0.5);

    const tubeGeo = CylZ(0.29, 0.29, 7.4, 16);
    const breechGeo = new THREE.SphereGeometry(0.29, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    breechGeo.rotateX(-Math.PI / 2);
    const muzzleGeo = new THREE.CircleGeometry(0.24, 12);
    for (let i = -2; i <= 2; i++) {
        const x = i * 0.64;
        addMesh(group, tubeGeo, MAT.gray, x, 1.08, 0.7);
        addMesh(group, breechGeo, MAT.grayDark, x, 1.08, -3.0);
        addMesh(group, muzzleGeo, MAT.soot, x, 1.08, 4.41);
    }
    // Tube bands
    [-1.9, 0.9, 3.6].forEach(z => addMesh(group, Box(3.36, 0.7, 0.14), MAT.grayDark, 0, 1.08, z));
    // Mount captain's station with sight slit
    addMesh(group, Box(1.0, 0.95, 1.2), MAT.gray, -0.9, 1.85, -2.2);
    addMesh(group, Box(0.8, 0.14, 0.03), MAT.window, -0.9, 2.05, -1.59);
    addMesh(group, Cyl(0.12, 0.12, 0.3, 8), MAT.gunMetal, -0.9, 2.45, -2.0);
    return group;
}

// Twin 40mm Bofors in a splinter tub
function createBofors40Twin() {
    const g = new THREE.Group();
    addMesh(g, Cyl(1.55, 1.55, 1.1, 32, true), MAT.gray, 0, 0.55, 0);
    addMesh(g, Cyl(1.55, 1.55, 0.08, 32), MAT.deck, 0, 0.04, 0);
    const rim = new THREE.TorusGeometry(1.55, 0.05, 6, 40);
    rim.rotateX(Math.PI / 2);
    addMesh(g, rim, MAT.gray, 0, 1.1, 0);

    addMesh(g, Cyl(0.4, 0.5, 0.5, 12), MAT.gunMetal, 0, 0.33, 0);
    addMesh(g, Box(1.2, 0.55, 1.1), MAT.gunMetal, 0, 0.85, 0);
    [-0.85, 0.85].forEach(x => addMesh(g, Box(0.3, 0.08, 0.35), MAT.gunMetal, x, 0.85, -0.25));

    const elev = new THREE.Group();
    elev.position.set(0, 1.15, 0.1);
    elev.rotation.x = -0.35;
    g.add(elev);
    [-0.32, 0.32].forEach(x => {
        addMesh(elev, Box(0.28, 0.4, 1.4), MAT.gunMetal, x, 0, 0.2);
        addMesh(elev, Box(0.26, 0.45, 0.55), MAT.gunMetal, x, 0.4, 0.05);
        addMesh(elev, CylZ(0.045, 0.05, 2.2, 8), MAT.gunMetal, x, 0, 2.0);
        addMesh(elev, CylZ(0.1, 0.05, 0.35, 8), MAT.gunMetal, x, 0, 3.2);
    });
    g.userData.barrel = elev;
    return g;
}

// Single 20mm Oerlikon with curved shield
function createOerlikon() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.3, 0.35, 0.08, 12), MAT.gunMetal, 0, 0.04, 0);
    addMesh(g, Cyl(0.1, 0.16, 1.0, 8), MAT.gunMetal, 0, 0.5, 0);
    const cradle = new THREE.Group();
    cradle.position.set(0, 1.05, 0);
    cradle.rotation.x = -0.25;
    g.add(cradle);
    addMesh(cradle, Box(0.16, 0.2, 0.7), MAT.gunMetal, 0, 0, 0.1);
    addMesh(cradle, CylZ(0.025, 0.03, 1.3, 6), MAT.gunMetal, 0, 0, 1.05);
    addMesh(cradle, Cyl(0.19, 0.19, 0.13, 12), MAT.gunMetal, 0, 0.18, 0.05);
    addMesh(cradle, Box(0.55, 0.05, 0.05), MAT.gunMetal, 0, 0.05, -0.35);
    const shield = new THREE.CylinderGeometry(0.85, 0.85, 0.8, 12, 1, true, -0.6, 1.2);
    addMesh(g, shield, MAT.gray, 0, 1.05, -0.35);
    return g;
}

// Mk 51 director for the 40mm guns
function createMk51() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.12, 0.18, 1.1, 8), MAT.gunMetal, 0, 0.55, 0);
    addMesh(g, Box(0.5, 0.4, 0.35), MAT.gunMetal, 0, 1.25, 0);
    addMesh(g, CylZ(0.08, 0.08, 0.3, 8), MAT.gunMetal, 0.15, 1.35, 0.25);
    return g;
}

// Mk 6 K-gun depth charge projector (fires outboard toward `side`)
function createKGun(side) {
    const g = new THREE.Group();
    addMesh(g, Box(0.7, 0.2, 0.7), MAT.grayDark, 0, 0.1, 0);
    const tube = addMesh(g, Cyl(0.2, 0.24, 0.9, 10), MAT.gunMetal, side * 0.25, 0.5, 0);
    tube.rotation.z = -side * Math.PI / 4;
    const arbor = addMesh(g, Cyl(0.3, 0.3, 0.62, 12), MAT.charge, side * 0.55, 0.85, 0);
    arbor.rotation.z = -side * Math.PI / 4;
    // Ready rack with spare charges
    addMesh(g, Box(0.9, 0.08, 0.5), MAT.grayDark, -side * 0.6, 0.35, -0.75);
    for (let i = 0; i < 2; i++) addMesh(g, CylX(0.26, 0.6, 10), MAT.charge, -side * 0.6, 0.65 + i * 0.52, -0.75);
    return g;
}

// Mk 3 stern depth charge rack (aft end at -Z)
function createDepthChargeRack() {
    const g = new THREE.Group();
    [-0.45, 0.45].forEach(x => {
        addMesh(g, Box(0.08, 0.12, 5.8), MAT.gray, x, 0.55, 0);
        addMesh(g, Box(0.08, 0.12, 5.8), MAT.gray, x, 1.15, 0);
        for (let z = -2.6; z <= 2.7; z += 1.3) addMesh(g, Box(0.08, 1.2, 0.08), MAT.gray, x, 0.6, z);
    });
    for (let i = 0; i < 7; i++) addMesh(g, CylX(0.28, 0.75, 12), MAT.charge, 0, 0.88, 2.4 - i * 0.78);
    g.rotation.x = -0.06;
    return g;
}

// --- Fire control & sensors ---

function createMk37Director() {
    const g = new THREE.Group();
    addMesh(g, Cyl(1.3, 1.35, 0.3, 24), MAT.grayDark, 0, 0.15, 0);
    const bottom = [[-1.05, 2.1], [1.05, 2.1], [1.45, 1.3], [1.45, -1.9], [-1.45, -1.9], [-1.45, 1.3]];
    const top = [[-0.9, 1.4], [0.9, 1.4], [1.3, 0.9], [1.3, -1.8], [-1.3, -1.8], [-1.3, 0.9]];
    addMesh(g, loftPrism(bottom, 0.3, top, 2.2), MAT.gray);
    // Mk 42 stereo rangefinder "ears"
    addMesh(g, CylX(0.2, 5.0, 12), MAT.gray, 0, 1.55, -0.6);
    [-2.5, 2.5].forEach(x => addMesh(g, Box(0.45, 0.55, 0.55), MAT.gray, x, 1.55, -0.6));
    // Front sight ports, roof hatches
    [-0.6, 0.6].forEach(x => addMesh(g, Box(0.35, 0.18, 0.05), MAT.window, x, 1.5, 1.95));
    addMesh(g, Cyl(0.3, 0.3, 0.12, 10), MAT.gray, -0.7, 2.26, -0.9);
    addMesh(g, Cyl(0.3, 0.3, 0.12, 10), MAT.gray, 0.7, 2.26, -0.9);

    // Mk 12 fire control radar with Mk 22 "orange peel" height finder
    [-0.9, 0.9].forEach(x => strut(g, new THREE.Vector3(x, 2.2, -0.2), new THREE.Vector3(x, 2.95, 0.3), 0.05, MAT.metal));
    const mk12 = new THREE.CylinderGeometry(2.6, 2.6, 1.3, 16, 4, true, -0.5, 1.0);
    mk12.rotateY(Math.PI);
    addMesh(g, mk12, gridMaterial(8, 5), 0, 3.4, 3.0);
    const mk22 = new THREE.SphereGeometry(1.4, 6, 10, -Math.PI / 2 - 0.18, 0.36, Math.PI / 2 - 0.4, 0.8);
    addMesh(g, mk22, gridMaterial(2, 6), 1.65, 3.4, 1.8);
    return g;
}

// SC-2 "bedspring" air search array
function createSC2Radar() {
    const g = new THREE.Group();
    addMesh(g, new THREE.PlaneGeometry(4.6, 1.5), gridMaterial(14, 5));
    [-0.75, 0.75].forEach(y => addMesh(g, Box(4.7, 0.07, 0.07), MAT.metal, 0, y, 0));
    [-2.3, 0, 2.3].forEach(x => addMesh(g, Box(0.07, 1.55, 0.07), MAT.metal, x, 0, 0));
    addMesh(g, Box(0.15, 0.15, 0.6), MAT.metal, 0, 0, -0.3);
    return g;
}

// SG surface search "cheese" antenna
function createSGRadar() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.3, 0.35, 0.5, 10), MAT.gray, 0, 0.25, 0);
    const dish = new THREE.CylinderGeometry(1.0, 1.0, 0.45, 12, 1, true, -0.7, 1.4);
    dish.rotateY(Math.PI);
    addMesh(g, dish, gridMaterial(6, 2, 0x55595e), 0, 0.85, 1.0);
    addMesh(g, Box(0.08, 0.08, 0.8), MAT.metal, 0, 0.85, 0.2);
    return g;
}

function createSearchlight() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.18, 0.25, 0.5, 10), MAT.gray, 0, 0.25, 0);
    [-0.5, 0.5].forEach(x => addMesh(g, Box(0.08, 0.7, 0.15), MAT.gray, x, 0.8, 0));
    addMesh(g, CylZ(0.42, 0.42, 0.75, 16), MAT.gray, 0, 1.0, 0);
    addMesh(g, new THREE.CircleGeometry(0.37, 16), MAT.glass, 0, 1.0, 0.38);
    addMesh(g, Cyl(0.15, 0.2, 0.2, 8), MAT.gray, 0, 1.5, -0.05);
    return g;
}

// --- Funnels ---

function createFunnel(h, len, wid, withWhistle) {
    const g = new THREE.Group();
    const rake = 0.07;
    const rakeGeo = geo => {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - p.getY(i) * rake);
        geo.computeVertexNormals();
        return geo;
    };
    const oval = (rTop, rBot, height, y0, open) => {
        const geo = new THREE.CylinderGeometry(rTop, rBot, height, 36, 4, open);
        geo.scale(wid / 2, 1, len / 2);
        geo.translate(0, y0 + height / 2, 0);
        return rakeGeo(geo);
    };
    const funnelMat = new THREE.MeshStandardMaterial({ color: HAZE_GRAY, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });

    addMesh(g, oval(1.1, 1.14, 0.9, -0.3, false), MAT.gray);              // base collar
    addMesh(g, oval(0.95, 1.0, h, 0, true), funnelMat);                  // stack
    addMesh(g, oval(0.99, 0.975, 1.1, h - 1.0, true), MAT.black);        // black cap band
    addMesh(g, oval(1.04, 0.99, 0.14, h - 0.04, true), MAT.black);       // flared lip
    addMesh(g, oval(1.0, 1.0, 0.1, h * 0.55, true), MAT.grayDark);       // stiffening band

    const inside = new THREE.CircleGeometry(1, 36);
    inside.rotateX(-Math.PI / 2);
    inside.scale(wid / 2 * 0.93, 1, len / 2 * 0.93);
    inside.translate(0, h - 0.5, 0);
    addMesh(g, rakeGeo(inside), MAT.soot);

    // Clinker screen
    const pts = [];
    const yTop = h + 0.08, shift = -yTop * rake;
    for (let z = -len / 2 + 0.3; z < len / 2; z += 0.4) {
        const xe = wid / 2 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * z / len, 2)));
        pts.push(new THREE.Vector3(-xe, yTop, z + shift), new THREE.Vector3(xe, yTop, z + shift));
    }
    for (let x = -wid / 2 + 0.3; x < wid / 2; x += 0.4) {
        const ze = len / 2 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * x / wid, 2)));
        pts.push(new THREE.Vector3(x, yTop, -ze + shift), new THREE.Vector3(x, yTop, ze + shift));
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x222222 })));

    // Steam / exhaust pipes on the after face
    [-0.35, 0.35].forEach(x => {
        const zb = -len / 2 - 0.15;
        strut(g, new THREE.Vector3(x, 0.4, zb), new THREE.Vector3(x, h + 0.5, zb - (h + 0.5) * rake), 0.1, MAT.gray, 8);
        addMesh(g, Cyl(0.14, 0.12, 0.2, 8), MAT.black, x, h + 0.5, zb - (h + 0.5) * rake);
    });
    // Ladder rungs up the side
    for (let y = 0.8; y < h - 1.2; y += 0.45) addMesh(g, Box(0.05, 0.04, 0.4), MAT.metal, wid / 2 + 0.06, y, -0.6 - y * rake);
    if (withWhistle) {
        const wy = h * 0.72;
        addMesh(g, Box(0.5, 0.08, 0.35), MAT.gray, 0, wy, len / 2 + 0.1 - wy * rake);
        addMesh(g, Cyl(0.12, 0.1, 0.5, 8), MAT.brass, 0, wy + 0.3, len / 2 + 0.15 - wy * rake);
    }
    g.userData.topY = h;
    g.userData.rake = rake;
    return g;
}

// --- Boats, rafts, deck fittings ---

// 26 ft motor whaleboat (double-ended)
function createWhaleboat() {
    const g = new THREE.Group();
    const hullGeo = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const p = hullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        p.setX(i, p.getX(i) * (1 - 0.35 * z * z));
    }
    hullGeo.scale(1.05, 0.85, 3.95);
    hullGeo.computeVertexNormals();
    addMesh(g, hullGeo, MAT.gray);
    // Gunwale
    const rimPts = [];
    for (let i = 0; i < 48; i++) {
        const a = Math.PI * 2 * i / 48;
        const zn = Math.cos(a);
        rimPts.push(new THREE.Vector3(Math.sin(a) * 1.05 * (1 - 0.35 * zn * zn), 0, zn * 3.95));
    }
    addMesh(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 64, 0.05, 5, true), MAT.grayDark);
    addMesh(g, Box(1.2, 0.05, 5.0), MAT.wood, 0, -0.55, 0);
    [-2.0, 0.2, 1.8].forEach(z => addMesh(g, Box(1.7, 0.06, 0.25), MAT.wood, 0, -0.2, z));
    addMesh(g, Box(0.7, 0.5, 1.1), MAT.grayDark, 0, -0.3, -1.1);   // engine box
    addMesh(g, Box(0.05, 0.6, 0.4), MAT.grayDark, 0, -0.55, -3.9); // rudder
    return g;
}

// Carley float life raft (mounted vertically, long axis along Z)
function createCarleyFloat() {
    const g = new THREE.Group();
    const pts = [];
    const hw = 1.25, hh = 0.6, r = 0.35;
    const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, Math.PI / 2], [-(hw - r), -(hh - r), Math.PI], [hw - r, -(hh - r), Math.PI * 1.5]];
    corners.forEach(([cz, cy, a0]) => {
        for (let i = 0; i <= 6; i++) {
            const a = a0 + (Math.PI / 2) * i / 6;
            pts.push(new THREE.Vector3(0, cy + Math.sin(a) * r, cz + Math.cos(a) * r));
        }
    });
    addMesh(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.16, 6, true), MAT.grayLight);
    const grating = addMesh(g, new THREE.PlaneGeometry(2.3, 1.0), gridMaterial(8, 4, 0x4a4f54));
    grating.rotation.y = Math.PI / 2;
    return g;
}

// Stockless anchor, shackle at origin, hanging toward -Y, flukes spread along X
function createStocklessAnchor() {
    const g = new THREE.Group();
    const m = MAT.black;
    addMesh(g, Box(0.22, 1.6, 0.16), m, 0, -0.9, 0);
    addMesh(g, Box(0.9, 0.3, 0.35), m, 0, -1.75, 0);
    [-1, 1].forEach(s => {
        const f = addMesh(g, Box(0.3, 0.9, 0.14), m, s * 0.42, -1.35, 0.05);
        f.rotation.z = s * 0.35;
    });
    addMesh(g, new THREE.TorusGeometry(0.14, 0.045, 6, 12), m, 0, 0, 0);
    return g;
}

function createBollard() {
    const g = new THREE.Group();
    addMesh(g, Box(1.0, 0.08, 0.45), MAT.grayDark, 0, 0.04, 0);
    [-0.28, 0.28].forEach(x => {
        addMesh(g, Cyl(0.15, 0.15, 0.45, 10), MAT.grayDark, x, 0.3, 0);
        addMesh(g, Cyl(0.19, 0.19, 0.06, 10), MAT.grayDark, x, 0.55, 0);
    });
    return g;
}

function createMushroomVent() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.25, 0.25, 0.8, 10), MAT.gray, 0, 0.4, 0);
    addMesh(g, Cyl(0.35, 0.48, 0.18, 12), MAT.gray, 0, 0.88, 0);
    return g;
}

// Cowl ventilator facing +Z
function createCowlVent() {
    const g = new THREE.Group();
    addMesh(g, Cyl(0.3, 0.3, 1.3, 12), MAT.gray, 0, 0.65, 0);
    addMesh(g, new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.gray, 0, 1.3, -0.05);
    const mouth = addMesh(g, Cyl(0.45, 0.33, 0.5, 14, true), MAT.gray, 0, 1.45, 0.25);
    mouth.rotation.x = Math.PI / 2;
    addMesh(g, new THREE.CircleGeometry(0.4, 14), MAT.soot, 0, 1.45, 0.25);
    return g;
}

function createDoor() {
    return new THREE.Mesh(Box(0.06, 1.75, 0.8), MAT.grayDark);
}

// --- Railings (instanced stanchions + wire lifelines) ---
function createRailing(paths, height, levels, spacing) {
    const group = new THREE.Group();
    const railMat = new THREE.LineBasicMaterial({ color: 0x8a9096 });
    const posts = [];
    paths.forEach(({ pts, closed }) => {
        const P = closed ? pts.concat([pts[0]]) : pts;
        posts.push(P[0].clone());
        let carry = 0;
        for (let i = 0; i < P.length - 1; i++) {
            const a = P[i], b = P[i + 1], d = a.distanceTo(b);
            let s = spacing - carry;
            while (s <= d) { posts.push(a.clone().lerp(b, s / d)); s += spacing; }
            carry = d - (s - spacing);
        }
        if (!closed) posts.push(P[P.length - 1].clone());
        for (let h = 1; h <= levels; h++) {
            const off = height * h / levels;
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(P.map(p => new THREE.Vector3(p.x, p.y + off, p.z))), railMat));
        }
    });
    const postGeo = Cyl(0.03, 0.03, height, 4);
    postGeo.translate(0, height / 2, 0);
    const inst = new THREE.InstancedMesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x8a9096 }), posts.length);
    const dummy = new THREE.Object3D();
    posts.forEach((p, i) => { dummy.position.copy(p); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); });
    group.add(inst);
    return group;
}

function deckEdgePath(zFrom, zTo, side, inset, step = 0.8) {
    const pts = [];
    const n = Math.max(1, Math.ceil(Math.abs(zTo - zFrom) / step));
    for (let i = 0; i <= n; i++) {
        const z = lerp(zFrom, zTo, i / n);
        pts.push(new THREE.Vector3(side * Math.max(0.02, deckHalfWidth(z) - inset), sheerY(z), z));
    }
    return pts;
}

function roofEdgePath(zFrom, zTo, side, hwFn, step = 0.8) {
    const pts = [];
    const n = Math.max(1, Math.ceil(Math.abs(zTo - zFrom) / step));
    for (let i = 0; i <= n; i++) {
        const z = lerp(zFrom, zTo, i / n);
        pts.push(new THREE.Vector3(side * (hwFn(z) - 0.08), lvl1(z), z));
    }
    return pts;
}

// --- Flag (48-star ensign) ---
function createEnsign() {
    const c = document.createElement('canvas');
    c.width = 190; c.height = 100;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 13; i++) {
        ctx.fillStyle = i % 2 ? '#f2f2f2' : '#b22234';
        ctx.fillRect(0, i * 100 / 13, 190, 100 / 13 + 0.5);
    }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, 76, 54);
    ctx.fillStyle = '#fff';
    for (let r = 0; r < 6; r++) for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        ctx.arc(5 + k * 9.4, 5 + r * 8.8, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1.9, 1.0, 12, 4);
    geo.rotateY(Math.PI / 2);           // plane in the Y-Z plane
    geo.translate(0, -0.5, -0.95);      // hoist at origin, flying toward -Z
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.userData.basePos = geo.attributes.position.array.slice();
    flag.castShadow = true;
    return flag;
}
