// Assembles the complete USS Fletcher model from the hull and parts modules.

// --- MAIN BUILD SHIP ---
function buildShip(scene) {
    shipGroup = new THREE.Group();
    const aaMounts = [];             // light AA, collected as they're built (aa.js crews them)
    shipGroup.userData.aa = aaMounts;
    MAT = createMaterials();
    const rig = [];   // rigging line segments, added at the end

    // --- 1. The Hull ---
    const hull = new THREE.Mesh(createHullGeometry(), createHullMaterial());
    hull.castShadow = true;
    hull.receiveShadow = true;
    shipGroup.add(hull);

    // --- 2. The Deck ---
    const deck = new THREE.Mesh(createDeckGeometry(), MAT.deck);
    deck.receiveShadow = true;
    shipGroup.add(deck);

    // Bilge keels
    [1, -1].forEach(side => {
        const pos = [];
        const N = 60;
        for (let i = 0; i <= N; i++) {
            const zs = lerp(-18, 16, i / N);
            const bot = keelY(zs), top = sheerY(zs), t = 0.1, dt = 0.01;
            const x0 = sectionX(zs, t), y0 = bot + (top - bot) * t;
            const x1 = sectionX(zs, t + dt), y1 = bot + (top - bot) * (t + dt);
            const nrm = new THREE.Vector2(y1 - y0, -(x1 - x0)).normalize();
            const w = 0.5 * Math.min(1, Math.min(i, N - i) / 6);
            pos.push(side * x0, y0, zs, side * (x0 + nrm.x * w), y0 + nrm.y * w, zs);
        }
        const idx = [];
        for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        addMesh(shipGroup, geo, MAT.red);
    });

    // --- Deck Railings (main deck lifelines, bow to stern) ---
    const mainRail = deckEdgePath(HALF_L - 0.8, -HALF_L + 0.5, 1, 0.1)
        .concat(deckEdgePath(-HALF_L + 0.5, HALF_L - 0.8, -1, 0.1));
    shipGroup.add(createRailing([{ pts: mainRail, closed: true }], 1.0, 3, 1.25));

    // --- 3. Superstructure ---
    // Forward deckhouse (01 level) with a rounded front under Mt 52
    const hwA = z => z > 32 ? lerp(3.4, 2.0, Math.pow((z - 32) / 3, 2)) : 3.4;
    addMesh(shipGroup, makeDeckhouse(35, 8.5, hwA, LVL1_H), MAT.gray);
    // Machinery casing between the funnels
    const hwB = () => 2.6;
    addMesh(shipGroup, makeDeckhouse(8.5, -9.5, hwB, LVL1_H), MAT.gray);
    // After deckhouse with rounded after corners
    const hwC = z => z < -35 ? lerp(3.2, 2.2, Math.pow((-35 - z) / 1.5, 2)) : 3.2;
    addMesh(shipGroup, makeDeckhouse(-9.5, -36.5, hwC, LVL1_H), MAT.gray);

    // 01-level lifelines
    shipGroup.add(createRailing([
        { pts: roofEdgePath(33, 11.8, 1, hwA) }, { pts: roofEdgePath(33, 11.8, -1, hwA) },
        { pts: roofEdgePath(8.4, -3.2, 1, hwB) }, { pts: roofEdgePath(8.4, -3.2, -1, hwB) },
        { pts: roofEdgePath(-7.2, -9.4, 1, hwB) }, { pts: roofEdgePath(-7.2, -9.4, -1, hwB) },
        { pts: roofEdgePath(-9.6, -36.4, 1, hwC).concat(roofEdgePath(-36.4, -9.6, -1, hwC)) }
    ], 0.9, 2, 1.2));

    // Watertight doors and scuttles on the deckhouse sides
    const portholeGeo = CylX(0.13, 0.05, 10);
    [1, -1].forEach(side => {
        [[31.0, hwA], [21.5, hwA], [-11.2, hwC], [-24.8, hwC]].forEach(([z, hw]) => {
            const d = createDoor();
            d.position.set(side * (hw(z) + 0.03), sheerY(z) + 0.875, z);
            shipGroup.add(d);
        });
        for (let z = 29.5; z > 12; z -= 1.5) {
            if (Math.abs(z - 21.5) < 1) continue;
            addMesh(shipGroup, portholeGeo, MAT.window, side * (hwA(z) + 0.02), sheerY(z) + 1.5, z);
        }
        for (let z = -14; z > -34; z -= 1.6) {
            if (Math.abs(z + 24.8) < 1) continue;
            addMesh(shipGroup, portholeGeo, MAT.window, side * (hwC(z) + 0.02), sheerY(z) + 1.5, z);
        }
    });

    // --- Bridge structure ---
    const BRIDGE_Y = lvl1(23) + 2.4;   // navigating bridge deck
    // 02 level block (chart house, radio, CIC)
    addMesh(shipGroup, prism(roundFrontOutline(2.6, 16.5, 26.2, 2.0, 12), lvl1(16.5) - 0.3, BRIDGE_Y), MAT.gray);
    [1, -1].forEach(side => {
        for (let z = 25.5; z > 17; z -= 1.4) addMesh(shipGroup, portholeGeo, MAT.window, side * 2.62, BRIDGE_Y - 1.0, z);
    });

    // Round-front pilothouse
    const PH_TOP = BRIDGE_Y + 2.3;
    addMesh(shipGroup, prism(roundFrontOutline(2.3, 22.8, 25.4, 2.3, 14), BRIDGE_Y, PH_TOP), MAT.gray);
    addMesh(shipGroup, prism(roundFrontOutline(2.45, 22.65, 25.4, 2.45, 14), PH_TOP, PH_TOP + 0.12), MAT.gray);
    // Pilothouse windows around the round front
    for (let i = -5; i <= 5; i++) {
        const a = i * (Math.PI / 12);
        const w = addMesh(shipGroup, Box(0.48, 0.6, 0.06), MAT.window, Math.sin(a) * 2.32, BRIDGE_Y + 1.55, 25.4 + Math.cos(a) * 2.32);
        w.rotation.y = a;
    }
    // Open bridge windscreen atop the pilothouse
    const screen = new THREE.CylinderGeometry(2.45, 2.45, 1.0, 20, 1, true, -1.75, 3.5);
    addMesh(shipGroup, screen, MAT.gray, 0, PH_TOP + 0.62, 25.4);
    [-1, 1].forEach(s => addMesh(shipGroup, Box(0.06, 1.0, 2.6), MAT.gray, s * 2.42, PH_TOP + 0.62, 23.95));
    addMesh(shipGroup, Cyl(0.18, 0.22, 1.1, 10), MAT.gunMetal, 0, PH_TOP + 0.67, 26.3);   // gyro repeater / pelorus
    [-1.2, 1.2].forEach(x => addMesh(shipGroup, Cyl(0.12, 0.15, 1.0, 8), MAT.gunMetal, x, PH_TOP + 0.62, 25.6));

    // Bridge wings with splinter shields
    addMesh(shipGroup, Box(11.4, 0.2, 3.0), MAT.gray, 0, BRIDGE_Y - 0.1, 25.2);
    [-1, 1].forEach(s => {
        addMesh(shipGroup, Box(0.08, 1.15, 3.0), MAT.gray, s * 5.66, BRIDGE_Y + 0.58, 25.2);
        addMesh(shipGroup, Box(3.3, 1.15, 0.08), MAT.gray, s * 4.05, BRIDGE_Y + 0.58, 26.68);
        addMesh(shipGroup, Box(3.3, 1.15, 0.08), MAT.gray, s * 4.05, BRIDGE_Y + 0.58, 23.72);
        strut(shipGroup, new THREE.Vector3(s * 3.4, lvl1(25) - 0.8, 25.2), new THREE.Vector3(s * 5.4, BRIDGE_Y - 0.2, 25.2), 0.09, MAT.gray);
        const oer = createOerlikon();
        oer.position.set(s * 4.7, BRIDGE_Y, 25.2);
        oer.rotation.y = s * 0.6;
        shipGroup.add(oer);
        aaMounts.push({ obj: oer, kind: 20, side: s, name: `20 mm ${s > 0 ? 'port' : 'stbd'} bridge wing` });
    });

    // Mk 37 director on its trunk behind the pilothouse
    const DIR_Y = PH_TOP + 0.6;
    addMesh(shipGroup, Cyl(1.25, 1.3, DIR_Y - BRIDGE_Y, 24), MAT.gray, 0, (BRIDGE_Y + DIR_Y) / 2, 21.2);
    const mk37 = createMk37Director();
    mk37.position.set(0, DIR_Y, 21.2);
    shipGroup.add(mk37);
    shipGroup.userData.mk37 = mk37;
    // Captain's stations: port wing, open bridge atop the pilothouse, starboard wing
    shipGroup.userData.eyes = [
        new THREE.Vector3(5.2, BRIDGE_Y + 1.7, 24.3),
        new THREE.Vector3(0, PH_TOP + 1.75, 24.9),
        new THREE.Vector3(-5.2, BRIDGE_Y + 1.7, 24.3)
    ];

    // --- Foremast: tripod with SC-2 and SG radars ---
    const MAST_Z = 18.0;
    const mast = new THREE.Group();
    mast.position.set(0, BRIDGE_Y, MAST_Z);
    shipGroup.add(mast);
    const MAST_H = 16.5;
    addMesh(mast, Cyl(0.13, 0.24, MAST_H, 10), MAT.gray, 0, MAST_H / 2, 0);
    [-1, 1].forEach(s => strut(mast, new THREE.Vector3(s * 1.5, 0, -1.2), new THREE.Vector3(0, 8.5, -0.05), 0.12, MAT.gray, 8));
    // Lookout platform
    addMesh(mast, Cyl(1.0, 1.0, 0.1, 20), MAT.gray, 0, 6.8, 0);
    const platRim = new THREE.TorusGeometry(1.0, 0.03, 4, 24);
    platRim.rotateX(Math.PI / 2);
    addMesh(mast, platRim, MAT.metal, 0, 7.6, 0);
    // Yardarm with footropes and signal halyards
    addMesh(mast, CylX(0.07, 7.2, 8), MAT.gray, 0, 11.5, 0);
    [-1, 1].forEach(s => rig.push(
        [new THREE.Vector3(s * 3.5, BRIDGE_Y + 11.5, MAST_Z), new THREE.Vector3(s * 5.3, BRIDGE_Y + 1.1, 23.8)],
        [new THREE.Vector3(s * 2.5, BRIDGE_Y + 11.5, MAST_Z), new THREE.Vector3(s * 4.5, BRIDGE_Y + 1.1, 23.8)]
    ));
    // SC-2 bedspring on the forward side of the mast
    const sc2 = createSC2Radar();
    sc2.position.set(0, 13.8, 0.55);
    mast.add(sc2);
    // SG on the masthead
    addMesh(mast, Cyl(0.55, 0.55, 0.08, 14), MAT.gray, 0, MAST_H, 0);
    const sg = createSGRadar();
    sg.position.set(0, MAST_H + 0.05, 0);
    mast.add(sg);
    addMesh(mast, Cyl(0.02, 0.03, 2.2, 4), MAT.metal, 0.35, MAST_H + 1.1, -0.2);   // whip antenna
    // Gaff with ensign
    strut(mast, new THREE.Vector3(0, 10.2, -0.1), new THREE.Vector3(0, 11.2, -2.6), 0.05, MAT.gray);
    const ensign = createEnsign();
    ensign.position.set(0, BRIDGE_Y + 11.15, MAST_Z - 2.6);
    shipGroup.add(ensign);
    shipGroup.userData.flag = ensign;
    // Forestay to the jackstaff
    rig.push([new THREE.Vector3(0, BRIDGE_Y + 15.5, MAST_Z + 0.1), new THREE.Vector3(0, sheerY(56.6) + 3.4, 56.6)]);

    // --- 4. Funnels ---
    const fwdFunnelZ = 13.5, aftFunnelZ = -3.8, FUNNEL_TOP = 14.4;
    const funnel1 = createFunnel(FUNNEL_TOP - lvl1(fwdFunnelZ), 4.4, 2.7, true);
    funnel1.position.set(0, lvl1(fwdFunnelZ), fwdFunnelZ);
    shipGroup.add(funnel1);

    const funnel2 = createFunnel(FUNNEL_TOP - 0.1 - lvl1(aftFunnelZ), 4.4, 2.7, false);
    funnel2.position.set(0, lvl1(aftFunnelZ), aftFunnelZ);
    shipGroup.add(funnel2);

    // Antenna pole on the after stack
    const f2top = funnel2.userData.topY, f2rake = funnel2.userData.rake;
    const poleBase = new THREE.Vector3(0, lvl1(aftFunnelZ) + f2top - 1.5, aftFunnelZ - 2.3 - (f2top - 1.5) * f2rake);
    const poleTop = poleBase.clone().add(new THREE.Vector3(0, 4.5, -0.35));
    strut(shipGroup, poleBase, poleTop, 0.07, MAT.gray);
    [-1, 1].forEach(s => rig.push(
        [new THREE.Vector3(s * 3.4, BRIDGE_Y + 11.5, MAST_Z), poleTop],
        [poleTop, new THREE.Vector3(s * 2.8, lvl1(-35) + 0.9, -35.5)]
    ));

    // Searchlight platform on the forward face of the after stack
    const slY = lvl1(0) + 2.6;
    addMesh(shipGroup, Box(2.6, 0.15, 2.0), MAT.gray, 0, slY, -0.6);
    [-1.1, 1.1].forEach(x => strut(shipGroup, new THREE.Vector3(x, lvl1(0.3), 0.3), new THREE.Vector3(x, slY, 0.3), 0.08, MAT.gray));
    const searchlight = createSearchlight();
    searchlight.position.set(0, slY + 0.07, -0.4);
    shipGroup.add(searchlight);

    // --- 5. Armament (5"/38 mounts) ---
    const turrets = [];
    const placeMount = (z, y, facingAft) => {
        const t = createGunTurret();
        t.position.set(0, y, z);
        if (facingAft) t.rotation.y = Math.PI;
        shipGroup.add(t);
        turrets.push(t);
        return t;
    };
    placeMount(39.0, sheerY(39.0) - 0.05, false);   // Mt 51 — main deck
    placeMount(31.5, lvl1(31.5), false);            // Mt 52 — superfiring on 01 level
    placeMount(-22.2, lvl1(-22.2), false);          // Mt 53 — after deckhouse
    placeMount(-33.2, lvl1(-33.2), true);           // Mt 54 — after deckhouse
    placeMount(-42.0, sheerY(-42.0) - 0.05, true);  // Mt 55 — main deck aft
    shipGroup.userData.turrets = turrets;

    // --- 6. Torpedo Tubes (stowed fore and aft on the centerline) ---
    const tt1 = createTorpedoTubes();
    tt1.position.set(0, lvl1(4.8), 4.8);
    shipGroup.add(tt1);

    const tt2 = createTorpedoTubes();
    tt2.position.set(0, lvl1(-13.2), -13.2);
    shipGroup.add(tt2);
    shipGroup.userData.torpMounts = [tt1, tt2];

    // --- 7. Light AA: 5 × twin 40mm, 20mm singles ---
    const addSponson40 = (x, z) => {
        const y = lvl1(z);
        addMesh(shipGroup, Box(3.4, 0.2, 3.6), MAT.gray, x, y - 0.1, z);
        const side = Math.sign(x);
        strut(shipGroup, new THREE.Vector3(x + side * 1.4, sheerY(z), z + 1.4), new THREE.Vector3(x + side * 1.4, y - 0.2, z + 1.4), 0.1, MAT.gray);
        strut(shipGroup, new THREE.Vector3(x + side * 1.4, sheerY(z), z - 1.4), new THREE.Vector3(x + side * 1.4, y - 0.2, z - 1.4), 0.1, MAT.gray);
        const b = createBofors40Twin();
        b.position.set(x, y, z);
        b.rotation.y = side * 0.5;
        shipGroup.add(b);
        aaMounts.push({ obj: b, kind: 40, side, name: `40 mm ${side > 0 ? 'port' : 'stbd'} ${z > 0 ? 'forward' : 'waist'}` });
        return b;
    };
    [-1, 1].forEach(s => {
        addSponson40(s * 3.7, 9.9);    // abaft the forward stack
        addSponson40(s * 3.7, -5.2);   // abreast the after stack
        const d1 = createMk51(); d1.position.set(s * 3.3, lvl1(12.2), 12.2); shipGroup.add(d1);
        const d2 = createMk51(); d2.position.set(s * 3.1, lvl1(-7.6), -7.6); shipGroup.add(d2);
    });
    // Elevated centerline 40mm between Mt 53 and Mt 54
    const bandY = lvl1(-28.2) + 1.8;
    addMesh(shipGroup, Box(4.2, 1.8 + 0.3, 4.4), MAT.gray, 0, lvl1(-28.2) + 0.9 - 0.15, -28.3);
    const aft40 = createBofors40Twin();
    aft40.position.set(0, bandY, -27.6);
    aft40.rotation.y = Math.PI;
    shipGroup.add(aft40);
    aaMounts.push({ obj: aft40, kind: 40, side: 0, name: '40 mm centreline aft' });
    const aftDir = createMk51(); aftDir.position.set(0, bandY, -29.8); shipGroup.add(aftDir);
    shipGroup.add(createRailing([{ pts: [
        new THREE.Vector3(-2.02, bandY, -26.2), new THREE.Vector3(-2.02, bandY, -30.4),
        new THREE.Vector3(2.02, bandY, -30.4), new THREE.Vector3(2.02, bandY, -26.2)] }], 0.9, 2, 1.0));

    // 20mm: 01 level abreast Mt 52, and on the fantail
    [-1, 1].forEach(s => {
        const o1 = createOerlikon(); o1.position.set(s * 2.9, lvl1(28.0), 28.0); o1.rotation.y = s * 0.5; shipGroup.add(o1);
        const o2 = createOerlikon(); o2.position.set(s * 3.2, sheerY(-52.5), -52.5); o2.rotation.y = Math.PI - s * 0.5; shipGroup.add(o2);
        aaMounts.push({ obj: o1, kind: 20, side: s, name: `20 mm ${s > 0 ? 'port' : 'stbd'} 01 level` });
        aaMounts.push({ obj: o2, kind: 20, side: s, name: `20 mm ${s > 0 ? 'port' : 'stbd'} fantail` });
    });

    // --- 8. ASW: K-guns and stern racks ---
    [-1, 1].forEach(s => {
        [[-38.0, 4.5], [-46.5, 4.2], [-49.8, 3.9]].forEach(([z, x]) => {
            const k = createKGun(s);
            k.position.set(s * x, sheerY(z), z);
            shipGroup.add(k);
        });
        const rack = createDepthChargeRack();
        rack.position.set(s * 1.5, sheerY(-53.6) - 0.05, -53.6);
        shipGroup.add(rack);
    });

    // --- 9. Boats & rafts ---
    // 26 ft motor whaleboat in radial davits, starboard side abreast the forward stack
    const boatZ = 16.5, boatX = -5.3, boatY = 6.2;
    const boat = createWhaleboat();
    boat.position.set(boatX, boatY + 0.85, boatZ);
    shipGroup.add(boat);
    [-2.9, 2.9].forEach(dz => {
        const z = boatZ + dz;
        const baseX = -(deckHalfWidth(z) - 0.35);
        const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(baseX, sheerY(z), z),
            new THREE.Vector3(baseX, boatY + 3.6, z),
            new THREE.Vector3(boatX, boatY + 3.2, z)
        );
        addMesh(shipGroup, new THREE.TubeGeometry(curve, 12, 0.09, 6, false), MAT.gray);
        rig.push([new THREE.Vector3(boatX, boatY + 3.15, z), new THREE.Vector3(boatX, boatY + 0.9, z)]);
    });

    // Carley floats on the casing and deckhouse sides
    [1, -1].forEach(side => {
        [[1.5, 2.6], [-7.6, 2.6], [-17.5, 3.2], [-30.5, 3.2]].forEach(([z, hw]) => {
            const raft = createCarleyFloat();
            raft.position.set(side * (hw + 0.2), sheerY(z) + 1.2, z);
            shipGroup.add(raft);
        });
    });

    // --- 10. Forecastle fittings: anchors, chain, windlass ---
    const windlassZ = 44.8;
    addMesh(shipGroup, Box(0.7, 0.75, 1.0), MAT.grayDark, 0, sheerY(windlassZ) + 0.37, windlassZ);
    [-1, 1].forEach(s => {
        addMesh(shipGroup, CylX(0.42, 0.35, 16), MAT.grayDark, s * 0.72, sheerY(windlassZ) + 0.55, windlassZ);
        const brake = new THREE.TorusGeometry(0.3, 0.04, 6, 14);
        brake.rotateY(Math.PI / 2);
        addMesh(shipGroup, brake, MAT.metal, s * 1.05, sheerY(windlassZ) + 0.55, windlassZ);
    });

    const linkGeo = new THREE.TorusGeometry(0.085, 0.028, 5, 10);
    linkGeo.scale(1.5, 1, 1);
    const links = [];
    [-1, 1].forEach(s => {
        const a = new THREE.Vector3(s * 1.3, sheerY(48.4) + 0.08, 48.4);
        const b = new THREE.Vector3(s * 0.72, sheerY(windlassZ) + 0.2, windlassZ + 0.4);
        const dir = new THREE.Vector3().subVectors(b, a);
        const n = Math.floor(dir.length() / 0.2);
        dir.normalize();
        for (let i = 0; i <= n; i++) links.push({ p: a.clone().lerp(b, i / n), dir, odd: i % 2 });
        // Deck hawse pipe
        const ring = new THREE.TorusGeometry(0.3, 0.07, 6, 14);
        ring.rotateX(Math.PI / 2);
        addMesh(shipGroup, ring, MAT.grayDark, a.x, a.y, a.z);
    });
    const chain = new THREE.InstancedMesh(linkGeo, MAT.black, links.length);
    const dummy = new THREE.Object3D();
    links.forEach((l, i) => {
        dummy.position.copy(l.p);
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), l.dir);
        dummy.rotateX(l.odd ? Math.PI / 2 : 0);
        dummy.updateMatrix();
        chain.setMatrixAt(i, dummy.matrix);
    });
    chain.castShadow = true;
    shipGroup.add(chain);

    // Anchors housed in the hull hawse pipes, lying flat against the flared bow
    const hawseZ = 48.8, hawseY = sheerY(48.8) - 1.2;
    [1, -1].forEach(side => {
        const eps = 0.05;
        const P = (zs, y) => new THREE.Vector3(side * hullX(zs, y), y, zs);
        const p0 = P(hawseZ, hawseY);
        const tZ = P(hawseZ + eps, hawseY).sub(P(hawseZ - eps, hawseY)).normalize();
        const tY = P(hawseZ, hawseY + eps).sub(P(hawseZ, hawseY - eps)).normalize();
        const nrm = new THREE.Vector3().crossVectors(tY, tZ).multiplyScalar(side).normalize();
        if (nrm.x * side < 0) nrm.negate();
        const along = new THREE.Vector3().crossVectors(tY, nrm).normalize();
        const basis = new THREE.Matrix4().makeBasis(along, tY, nrm);

        const ring = addMesh(shipGroup, new THREE.TorusGeometry(0.34, 0.08, 6, 16), MAT.grayDark);
        ring.position.copy(p0).addScaledVector(nrm, 0.04);
        ring.quaternion.setFromRotationMatrix(basis);
        const hole = addMesh(shipGroup, new THREE.CircleGeometry(0.3, 14), MAT.soot);
        hole.position.copy(p0).addScaledVector(nrm, 0.03);
        hole.quaternion.setFromRotationMatrix(basis);

        const anchor = createStocklessAnchor();
        anchor.position.copy(p0).addScaledVector(nrm, 0.14).addScaledVector(tY, 0.1);
        anchor.quaternion.setFromRotationMatrix(basis);
        shipGroup.add(anchor);
    });

    // Jackstaff, flagstaff
    addMesh(shipGroup, Cyl(0.04, 0.07, 3.6, 6), MAT.gray, 0, sheerY(56.6) + 1.8, 56.6);
    addMesh(shipGroup, Cyl(0.04, 0.07, 3.0, 6), MAT.gray, 0, sheerY(-56.7) + 1.5, -56.7);

    // Bollards, vents
    [[50.5, 0.95], [30.0, 4.5], [-15.0, 5.4], [-44.5, 4.3]].forEach(([z, x]) => {
        [-1, 1].forEach(s => {
            const b = createBollard();
            b.position.set(s * x, sheerY(z), z);
            b.rotation.y = Math.PI / 2;
            shipGroup.add(b);
        });
    });
    [-1, 1].forEach(s => {
        const mv = createMushroomVent(); mv.position.set(s * 2.0, sheerY(42.5), 42.5); shipGroup.add(mv);
        const c1 = createCowlVent(); c1.position.set(s * 4.4, sheerY(3.0), 3.0); shipGroup.add(c1);
        const c2 = createCowlVent(); c2.position.set(s * 4.6, sheerY(-16.5), -16.5); c2.rotation.y = Math.PI; shipGroup.add(c2);
    });

    // --- 11. Running gear: shafts, struts, props, skeg, rudder ---
    const brassMat = MAT.brass;
    const redMat = MAT.red;
    const PROP_Z = -46.5, PROP_Y = -4.1, PROP_X = 2.6;

    // Skeg
    const skegShape = new THREE.Shape();
    skegShape.moveTo(28, -4.0);
    skegShape.lineTo(44, keelY(-44) + 0.2);
    skegShape.lineTo(44, -4.1);
    skegShape.lineTo(28, -4.1);
    const skegGeo = new THREE.ExtrudeGeometry(skegShape, { depth: 0.2, bevelEnabled: false });
    skegGeo.rotateY(Math.PI / 2);
    skegGeo.translate(-0.1, 0, 0);
    addMesh(shipGroup, skegGeo, redMat);

    // Rudder with stock
    const rudderShape = new THREE.Shape();
    rudderShape.moveTo(49.8, -1.6);
    rudderShape.lineTo(52.4, -1.6);
    rudderShape.lineTo(52.2, -4.2);
    rudderShape.lineTo(49.9, -4.3);
    const rudderGeo = new THREE.ExtrudeGeometry(rudderShape, { depth: 0.28, bevelEnabled: false });
    rudderGeo.rotateY(Math.PI / 2);
    rudderGeo.translate(-0.14, 0, 0);
    addMesh(shipGroup, rudderGeo, redMat);

    const props = [];
    [-1, 1].forEach(s => {
        const hub = new THREE.Vector3(s * PROP_X, PROP_Y, PROP_Z);
        strut(shipGroup, new THREE.Vector3(s * 1.9, -3.75, -26), hub.clone().add(new THREE.Vector3(0, 0, 0.3)), 0.15, brassMat, 10);
        // V-strut (A-bracket)
        const sp = new THREE.Vector3(s * 2.55, PROP_Y + 0.02, -44.2);
        strut(shipGroup, sp, new THREE.Vector3(s * 1.2, keelY(-44) + 0.3, -44.2), 0.1, redMat);
        strut(shipGroup, sp, new THREE.Vector3(s * 3.9, keelY(-44) + 0.4, -44.2), 0.1, redMat);
        addMesh(shipGroup, CylZ(0.24, 0.24, 0.9, 12), redMat, sp.x, sp.y, sp.z);

        // Three-bladed propeller
        const prop = new THREE.Group();
        prop.position.copy(hub);
        const cone = addMesh(prop, CylZ(0.08, 0.36, 0.9, 12), brassMat, 0, 0, -0.35);
        const bladeShape = new THREE.Shape();
        bladeShape.moveTo(0, 0.25);
        bladeShape.bezierCurveTo(0.55, 0.5, 0.6, 1.1, 0.15, 1.35);
        bladeShape.bezierCurveTo(-0.2, 1.3, -0.4, 0.7, -0.25, 0.25);
        const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.04, bevelEnabled: false });
        for (let i = 0; i < 3; i++) {
            const pivot = new THREE.Group();
            pivot.rotation.z = (Math.PI * 2 / 3) * i;
            const blade = addMesh(pivot, bladeGeo, brassMat);
            blade.rotation.y = s * 0.55;
            prop.add(pivot);
        }
        shipGroup.add(prop);
        props.push(prop);
    });
    shipGroup.userData.props = props;

    // --- 12. Rigging lines ---
    const rigPts = [];
    rig.forEach(([a, b]) => rigPts.push(a, b));
    shipGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rigPts), new THREE.LineBasicMaterial({ color: 0x2a2d30 })));

    shipGroup.traverse(o => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
    scene.add(shipGroup);
    return shipGroup;
}
