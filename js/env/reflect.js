// Planar water reflections ("RTX" in the graphics menu): the world is drawn a second time from the camera
// mirrored in the sea, into a texture the ocean samples where the cube map would only give it the sky. Ships,
// islands, smoke, fires, flares and explosions all show in the water, rippled by the waves' normals.
// 0 off (sky cube only), 1 half resolution, 2 full resolution.
const REFL_U = { uReflTex: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 } };

const WaterReflect = (() => {
    const SCALE = [0, 0.5, 1];
    const CLIP_Y = -0.4;    // a little under the mean surface, so the troughs still mirror the hull at the waterline
    let rt = null;
    const cam = new THREE.PerspectiveCamera();
    const fwd = new THREE.Vector3(), tgt = new THREE.Vector3(), plane = new THREE.Plane(), N = new THREE.Vector3(0, 1, 0);
    const clip = new THREE.Vector4(), q = new THREE.Vector4(), size = new THREE.Vector2();
    const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

    function release() {
        if (rt) { rt.dispose(); rt = null; }
        REFL_U.uReflTex.value = null;
        REFL_U.uReflOn.value = 0;
    }

    // Before the main pass. Returns true when it drew the world (so the main pass can skip the matrix update).
    function render(renderer, scene, camera, mainScale) {
        const lv = Settings.gfx.reflections | 0;
        if (!lv) { if (rt) release(); return false; }
        REFL_U.uReflOn.value = 0;
        if (!ocean || !ocean.visible || camera.position.y < 0.6 || (typeof Underwater !== 'undefined' && Underwater.under)) return false;

        renderer.getDrawingBufferSize(size);
        const w = Math.max(32, Math.round(size.x * mainScale * SCALE[lv])), h = Math.max(32, Math.round(size.y * mainScale * SCALE[lv]));
        if (!rt) {
            rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
        } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

        // The mirrored camera: position, view target and up all reflected in the plane y = 0
        camera.updateMatrixWorld();
        camera.getWorldDirection(fwd);
        cam.position.set(camera.position.x, -camera.position.y, camera.position.z);
        tgt.copy(camera.position).add(fwd);
        tgt.y = -tgt.y;
        cam.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        cam.up.y = -cam.up.y;
        cam.lookAt(tgt);
        cam.near = camera.near; cam.far = camera.far;
        cam.layers.mask = camera.layers.mask;
        cam.updateMatrixWorld();
        cam.projectionMatrix.copy(camera.projectionMatrix);
        REFL_U.uReflMat.value.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

        // Oblique near plane on the sea surface, so nothing under the water ends up in its reflection
        plane.setFromNormalAndCoplanarPoint(N, tgt.set(0, CLIP_Y, 0)).applyMatrix4(cam.matrixWorldInverse);
        clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
        const e = cam.projectionMatrix.elements;
        q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
        clip.multiplyScalar(2 / clip.dot(q));
        e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;

        // The sea and the rain round the camera stay out; particles keep their size at this resolution
        const rainVis = rain ? rain.lines.visible : false;
        ocean.visible = false;
        if (rain) rain.lines.visible = false;
        const pts = [smokeFx, sprayFx, fireFx].filter(Boolean).map(s => s.points.material.uniforms.scale);
        pts.forEach(u => { u.value *= SCALE[lv]; });
        const autoShadow = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;     // last frame's shadow map is fine down there

        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.setRenderTarget(prev);

        renderer.shadowMap.autoUpdate = autoShadow;
        pts.forEach(u => { u.value /= SCALE[lv]; });
        if (rain) rain.lines.visible = rainVis;
        ocean.visible = true;

        REFL_U.uReflTex.value = rt.texture;
        REFL_U.uReflOn.value = 1;
        return true;
    }

    return { render, release };
})();
