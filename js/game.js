// Game flow: menu, Patrol (escalating engagements against IJN forces), Free Cruise (sandbox with unarmed
// transports to shoot at), scoring, replenishment between engagements, and game over.

const Game = {
    mode: 'menu',          // 'menu' | 'patrol' | 'cruise'
    running: false,        // player has the conn
    paused: false,
    hostile: false,        // do enemies shoot back?
    over: false,
    wave: 0, score: 0,
    stats: { rounds: 0, torps: 0, hits: 0, hitsTaken: 0, sunk: 0 },
    phase: 'idle', phaseT: 0,

    resetWorld() {
        clearEnemies();
        clearShells();
        clearTorpedoes();
        smokeFx.clear();
        fireFx.clear();
        resetPhysics();
        resetPlayerDamage();
        resetPlayerWeapons();
        resetWake();
        this.wave = 0;
        this.score = 0;
        this.stats = { rounds: 0, torps: 0, hits: 0, hitsTaken: 0, sunk: 0 };
        this.over = false;
        this.paused = false;
    },

    start(mode) {
        ensureAudio();
        this.resetWorld();
        this.mode = mode;
        this.running = true;
        this.hostile = mode === 'patrol';
        drive.order = 6;   // get under way at standard speed
        phys.vel.set(0, 0, 11);
        showScreen(null);
        document.body.classList.add('playing');
        setCameraMode('chase');
        if (mode === 'patrol') {
            this.phase = 'transit';
            this.phaseT = 6;
            hudMessage('USS Fletcher on patrol, the Slot, Solomon Islands. Radar is searching.', 'info');
        } else {
            this.phase = 'cruise';
            for (let i = 0; i < 4; i++) this.spawnTransport(rnd(3000, 9000), rnd(-1.4, 1.4));
            hudMessage('Free cruise: unarmed transports in the area for gunnery practice.', 'info');
        }
    },

    toMenu() {
        this.running = false;
        this.mode = 'menu';
        this.resetWorld();
        if (captain.active) setCaptain(false);
        document.body.classList.remove('playing');
        setCameraMode('cinematic');
        showScreen('mainMenu');
    },

    setPaused(p) {
        if (!this.running || this.over) return;
        this.paused = p;
        if (p && document.pointerLockElement) document.exitPointerLock();
        showScreen(p ? 'pauseMenu' : null);
    },

    spawnTransport(dist, relBrg) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        const a = Math.atan2(fwd.x, fwd.z) + relBrg;
        spawnEnemy('maru', phys.pos.x + Math.sin(a) * dist, phys.pos.z + Math.cos(a) * dist, Math.random() * Math.PI * 2);
    },

    // Each engagement: a convoy crossing ahead of us, screened by warships that come out to fight
    spawnWave(n) {
        const comp = n === 1 ? ['destroyer', 'maru', 'maru']
            : n === 2 ? ['destroyer', 'destroyer', 'maru', 'maru']
            : n === 3 ? ['cruiser', 'destroyer', 'maru', 'maru', 'maru']
            : ['cruiser', ...Array(Math.min(4, n - 2)).fill('destroyer'), 'maru', 'maru', 'maru'];
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        const brg = Math.atan2(fwd.x, fwd.z) + rnd(-1.0, 1.0);
        const dist = rnd(12500, 15000);
        const cx = phys.pos.x + Math.sin(brg) * dist, cz = phys.pos.z + Math.cos(brg) * dist;
        const course = brg + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) + rnd(-0.3, 0.3);   // crossing our bow
        let mi = 0, wi = 0;
        comp.forEach(type => {
            if (type === 'maru') {
                const off = (mi++ - 1) * 700;   // transports in column
                spawnEnemy('maru', cx - Math.sin(course) * off, cz - Math.cos(course) * off, course);
            } else {
                const side = wi % 2 ? 1 : -1, row = Math.floor(wi++ / 2);
                // Screen on the side facing us
                const sx = cx - Math.sin(brg) * (1500 + row * 900) + Math.cos(course) * side * 900;
                const sz = cz - Math.cos(brg) * (1500 + row * 900) - Math.sin(course) * side * 900;
                spawnEnemy(type, sx, sz, course);
            }
        });
        const warships = comp.filter(t => t !== 'maru').length;
        hudMessage(`ENGAGEMENT ${n}: convoy bearing ${fmt3(compassDeg(Math.sin(brg), Math.cos(brg)))}, ${Math.round(dist * 1.0936 / 1000)}k yds — ${warships} warship${warships > 1 ? 's' : ''} in the screen. General quarters!`, 'alert');
        playAlarm();
        showBanner(`Engagement ${n}`, `${comp.filter(t => t === 'maru').length} transports · ${warships} escort${warships > 1 ? 's' : ''}`);
    },

    update(dt) {
        if (!this.running) return;
        this.phaseT -= dt;
        if (this.mode === 'patrol') {
            if (this.phase === 'transit' && this.phaseT <= 0) {
                this.wave++;
                this.spawnWave(this.wave);
                this.phase = 'battle';
            } else if (this.phase === 'battle' && !playerDmg.sinking && enemies.every(e => e.sinking)) {
                this.phase = 'cleared';
                this.phaseT = 10;
                const bonus = 250 * this.wave;
                this.score += bonus;
                hudMessage(`Engagement ${this.wave} won! +${bonus}. Damage control and replenishment under way.`, 'good');
                showBanner('Engagement won', `+${bonus} points`);
            } else if (this.phase === 'cleared' && this.phaseT <= 0) {
                // Replenish between engagements
                playerDmg.hull = Math.min(100, playerDmg.hull + 35);
                playerDmg.fires.length = 0;
                phys.flood = 0;
                phys.engine = Math.min(1, phys.engine + 0.3);
                guns.forEach(g => { g.disabled = false; });
                torpMounts.forEach(m => { m.left = 5; });
                hudMessage('Repairs made, torpedoes reloaded. Next contact expected shortly.', 'good');
                this.phase = 'transit';
                this.phaseT = 25;
            }
        } else if (this.mode === 'cruise' && enemies.filter(e => !e.sinking).length < 4) {
            this.spawnTransport(rnd(5000, 10000), rnd(-1.4, 1.4));
        }
        if (playerDmg.sinking && !this.over && playerDmg.sinkT > 9) this.gameOver();
    },

    onHit(e) {
        this.stats.hits++;
        this.score += 10;
    },

    onEnemySunk(e) {
        this.stats.sunk++;
        this.score += e.type.score;
        hudMessage(`${e.type.name} sunk! +${e.type.score}`, 'good');
        if (captain.lock === e) captain.lock = null;
    },

    onPlayerSinking() {
        this.running = false;
        drive.order = STOP_IDX;
        if (captain.active) setCaptain(false);
        setCameraMode('cinematic');
        cine.radius = 130; cine.height = 22;
    },

    gameOver() {
        this.over = true;
        $('goStats').innerHTML = `
            <div><span>Engagements fought</span><b>${this.wave}</b></div>
            <div><span>Enemy ships sunk</span><b>${this.stats.sunk}</b></div>
            <div><span>Rounds fired</span><b>${this.stats.rounds}</b></div>
            <div><span>Hits scored</span><b>${this.stats.hits}</b></div>
            <div><span>Torpedoes fired</span><b>${this.stats.torps}</b></div>
            <div><span>Hits taken</span><b>${this.stats.hitsTaken}</b></div>
            <div class="total"><span>Final score</span><b>${this.score.toLocaleString()}</b></div>`;
        showScreen('gameOver');
    }
};
