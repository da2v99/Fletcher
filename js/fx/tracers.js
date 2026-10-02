// Tracer rounds from the automatic weapons: our 40 mm Bofors and 20 mm Oerlikons, the Japanese 25 mm and
// machine guns ashore. Each round flies for real (gravity, drag) and is drawn as a glowing streak with a hot
// head. The caller supplies what a round can hit (test) and what happens when it does (onHit, onLand, onWater,
// burst when its time fuze or tracer burns out). One draw call for all the streaks and one for the heads.

const Tracers = (() => {
    const MAX = 1400;
    const live = [], pool = [];
    let linePos, lineCol, lineGeo, headPos, headCol, headSize, headGeo, headMat;

    function init() {
        lineGeo = new THREE.BufferGeometry();
        linePos = new Float32Array(MAX * 6);
        lineCol = new Float32Array(MAX * 6);
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
        lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
        const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
            vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
        }));
        lines.frustumCulled = false;
        lines.renderOrder = 3;

        headGeo = new THREE.BufferGeometry();
        headPos = new Float32Array(MAX * 3);
        headCol = new Float32Array(MAX * 3);
        headSize = new Float32Array(MAX);
        headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3).setUsage(THREE.DynamicDrawUsage));
        headGeo.setAttribute('pcolor', new THREE.BufferAttribute(headCol, 3).setUsage(THREE.DynamicDrawUsage));
        headGeo.setAttribute('psize', new THREE.BufferAttribute(headSize, 1).setUsage(THREE.DynamicDrawUsage));
        headMat = new THREE.ShaderMaterial({
            uniforms: { scale: { value: 800 } },
            vertexShader: `
                attribute vec3 pcolor;
                attribute float psize;
                uniform float scale;
                varying vec3 vC;
                void main() {
                    vC = pcolor;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = clamp(psize * scale / max(-mv.z, 0.1), 2.0, 48.0);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                varying vec3 vC;
                void main() {
                    vec2 d = gl_PointCoord - 0.5;
                    float a = max(0.0, 1.0 - dot(d, d) * 4.0);
                    gl_FragColor = vec4(vC * a * a, 1.0);
                }`,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        const heads = new THREE.Points(headGeo, headMat);
        heads.frustumCulled = false;
        heads.renderOrder = 3;
        scene.add(lines, heads);
    }

    // p: muzzle, v: velocity (m/s). o: { color [r,g,b], drag (1/m), life (s), size (m), test(prev, cur) -> hit,
    // onHit(hit, p, prev: where the round was a moment before), onLand(p), onWater(p), burst(p) }. o is shared by every round of a weapon: keep it static.
    function fire(p, v, o) {
        if (live.length >= MAX) return;
        const r = pool.pop() || { p: new THREE.Vector3(), v: new THREE.Vector3(), prev: new THREE.Vector3(), age: 0, o: null };
        r.p.copy(p); r.prev.copy(p); r.v.copy(v); r.age = 0; r.o = o;
        live.push(r);
    }

    function clear() { while (live.length) pool.push(live.pop()); }

    function update(dt, t) {
        if (!lineGeo) return;
        if (dt > 0) {
            for (let i = live.length - 1; i >= 0; i--) {
                const r = live[i], o = r.o;
                r.prev.copy(r.p);
                const sp = r.v.length();
                r.v.multiplyScalar(1 / (1 + o.drag * sp * dt));   // quadratic drag, implicit so it can't overshoot
                r.v.y -= GRAVITY * dt;
                r.p.addScaledVector(r.v, dt);
                r.age += dt;
                let end = false;
                if (o.test) {
                    const hit = o.test(r.prev, r.p);
                    if (hit) { if (o.onHit) o.onHit(hit, r.p, r.prev); end = true; }
                }
                if (!end && r.p.y < 450) {
                    const g = Islands.groundAt(r.p.x, r.p.z);
                    if (r.p.y < g) { if (o.onLand) o.onLand(r.p); end = true; }
                    else if (r.p.y < 3 && r.p.y < waterHeight(r.p.x, r.p.z, t)) { if (o.onWater) o.onWater(r.p); end = true; }
                }
                if (!end && r.age > o.life) { if (o.burst) o.burst(r.p); end = true; }
                if (end) { live[i] = live[live.length - 1]; live.pop(); pool.push(r); }
            }
        }
        // Streaks: the path the round covered in the last ~25 ms (a camera exposure), fading into the fog
        const cam = camera.position, dens = scene.fog ? scene.fog.density : 0;
        let n = 0;
        for (const r of live) {
            const o = r.o, c = o.color;
            const d = r.p.distanceTo(cam);
            const f = Math.exp(-Math.pow(d * dens, 2)) * Math.min(1, r.age * 30) * (o.fade ? Math.max(0, 1 - r.age / o.life) * 0.6 + 0.4 : 1);
            const k = n * 6, sp = 0.025;
            linePos[k] = r.p.x - r.v.x * sp; linePos[k + 1] = r.p.y - r.v.y * sp; linePos[k + 2] = r.p.z - r.v.z * sp;
            linePos[k + 3] = r.p.x; linePos[k + 4] = r.p.y; linePos[k + 5] = r.p.z;
            lineCol[k] = c[0] * f * 0.35; lineCol[k + 1] = c[1] * f * 0.35; lineCol[k + 2] = c[2] * f * 0.35;
            lineCol[k + 3] = c[0] * f; lineCol[k + 4] = c[1] * f; lineCol[k + 5] = c[2] * f;
            headPos[n * 3] = r.p.x; headPos[n * 3 + 1] = r.p.y; headPos[n * 3 + 2] = r.p.z;
            headCol[n * 3] = c[0] * f; headCol[n * 3 + 1] = c[1] * f; headCol[n * 3 + 2] = c[2] * f;
            headSize[n] = o.size;
            n++;
        }
        lineGeo.setDrawRange(0, n * 2);
        headGeo.setDrawRange(0, n);
        if (n > 0) {
            const A = lineGeo.attributes, B = headGeo.attributes;
            A.position.updateRange.count = A.color.updateRange.count = n * 6;
            B.position.updateRange.count = B.pcolor.updateRange.count = n * 3;
            B.psize.updateRange.count = n;
            A.position.needsUpdate = A.color.needsUpdate = B.position.needsUpdate = B.pcolor.needsUpdate = B.psize.needsUpdate = true;
        }
        headMat.uniforms.scale.value = window.innerHeight / (2 * Math.tan(camera.fov * DEG / 2));
    }

    return { init, fire, update, clear, get count() { return live.length; } };
})();
