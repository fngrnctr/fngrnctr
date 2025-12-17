(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Offscreen ink layer (black) we will erase to reveal red base
    let inkCanvas = document.createElement('canvas');
    let inkCtx = inkCanvas.getContext('2d', { alpha: true });
    const hud = document.getElementById('hud');
    const helpPanel = document.getElementById('help-panel');
    const helpButton = document.getElementById('help-button');

    const STORAGE_KEY = 'bwmove_hud_hidden';
    function setHudHidden(hidden) {
        hud.classList.toggle('hidden', hidden);
        // Show help button only when HUD is hidden
        if (helpButton) helpButton.classList.toggle('hidden', !hidden);
        try { localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0'); } catch { }
    }
    function getHudHidden() {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    class Vec2 {
        constructor(x = 0, y = 0) { this.x = x; this.y = y; }
        set(x, y) { this.x = x; this.y = y; return this; }
        copy(v) { this.x = v.x; this.y = v.y; return this; }
        add(v) { this.x += v.x; this.y += v.y; return this; }
        scale(s) { this.x *= s; this.y *= s; return this; }
        len() { return Math.hypot(this.x, this.y); }
        normalize() { const l = this.len(); if (l > 0) { this.x /= l; this.y /= l; } return this; }
        clone() { return new Vec2(this.x, this.y); }
    }

    const state = { size: { w: 0, h: 0, dpr: 1 } };

    function resize() {
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        const cw = Math.floor(window.innerWidth);
        const ch = Math.floor(window.innerHeight);
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.width = Math.floor(cw * dpr);
        canvas.height = Math.floor(ch * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        state.size.w = cw; state.size.h = ch; state.size.dpr = dpr;

        // Prepare ink layer sized to canvas, filled black
        inkCanvas.width = canvas.width;
        inkCanvas.height = canvas.height;
        inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        inkCtx.clearRect(0, 0, cw, ch);
        inkCtx.fillStyle = '#000';
        inkCtx.fillRect(0, 0, cw, ch);
    }
    window.addEventListener('resize', resize, { passive: true });
    resize();

    class Input {
        constructor() {
            this.keys = new Set();
            this.pointerActive = false;
            this.pointerStart = new Vec2();
            this.pointerPos = new Vec2();
            this.vector = new Vec2();
            this._bind();
        }
        _bind() {
            window.addEventListener('keydown', (e) => {
                const k = e.code;
                if (k === 'KeyH') { setHudHidden(!hud.classList.contains('hidden')); return; }
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(k)) {
                    this.keys.add(k);
                    e.preventDefault();
                }
            });
            window.addEventListener('keyup', (e) => this.keys.delete(e.code));

            const start = (x, y) => { this.pointerActive = true; this.pointerStart.set(x, y); this.pointerPos.set(x, y); };
            const move = (x, y) => { if (this.pointerActive) this.pointerPos.set(x, y); };
            const end = () => { this.pointerActive = false; this.vector.set(0, 0); };

            canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); start(e.clientX, e.clientY); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('pointermove', (e) => { move(e.clientX, e.clientY); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('pointerup', (e) => { end(); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('pointercancel', end);
            // Allow tap/click on help panel to toggle visibility (mobile-friendly)
            if (helpPanel) {
                const toggle = (e) => { setHudHidden(!hud.classList.contains('hidden')); e.preventDefault(); };
                helpPanel.addEventListener('click', toggle);
                helpPanel.addEventListener('pointerdown', (e) => { /* avoid capturing gameplay pointer */ e.stopPropagation(); });
            }
            if (helpButton) {
                helpButton.addEventListener('click', (e) => { setHudHidden(false); e.preventDefault(); });
            }
        }
        getAxis() {
            let x = 0, y = 0;
            if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
            if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
            if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
            if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;

            if (this.pointerActive) {
                const dx = this.pointerPos.x - this.pointerStart.x;
                const dy = this.pointerPos.y - this.pointerStart.y;
                const v = new Vec2(dx, dy);
                if (v.len() > 8) { v.normalize(); this.vector.copy(v); } else { this.vector.set(0, 0); }
            }
            if (this.pointerActive) return this.vector.clone();
            const k = new Vec2(x, y); if (k.len() > 0) k.normalize(); return k;
        }
    }

    class Player {
        constructor() {
            this.pos = new Vec2(state.size.w / 2, state.size.h / 2);
            this.vel = new Vec2(0, 0);
            this.size = 42;
            this.accel = 1000;   // acceleration toward input direction (px/s^2)
            this.maxSpeed = 500; // clamp top speed
            this.drag = 3.5;     // damping coefficient (1/s), lower = more glide
        }
        update(dt, input) {
            const dir = input.getAxis();
            if (dir.len() > 0) {
                this.vel.add(dir.clone().scale(this.accel * dt));
            }
            // Apply drag using exponential decay for smoother feel
            const dragFactor = Math.exp(-this.drag * dt);
            this.vel.scale(dragFactor);

            // Clamp max speed
            const speed = this.vel.len();
            if (speed > this.maxSpeed) {
                this.vel.scale(this.maxSpeed / speed);
            }

            // Integrate position
            this.pos.add(this.vel.clone().scale(dt));

            const half = this.size / 2;
            this.pos.x = clamp(this.pos.x, half, state.size.w - half);
            this.pos.y = clamp(this.pos.y, half, state.size.h - half);

            // Bounce a little if hitting edges (dampen velocity)
            if (this.pos.x === half && this.vel.x < 0) this.vel.x *= -0.3;
            if (this.pos.x === state.size.w - half && this.vel.x > 0) this.vel.x *= -0.3;
            if (this.pos.y === half && this.vel.y < 0) this.vel.y *= -0.3;
            if (this.pos.y === state.size.h - half && this.vel.y > 0) this.vel.y *= -0.3;
        }
        draw(ctx) {
            const half = this.size / 2;
            ctx.fillStyle = '#fff';
            ctx.fillRect(Math.round(this.pos.x - half) + 0.5, Math.round(this.pos.y - half) + 0.5, this.size, this.size);
        }
    }

    const input = new Input();
    const player = new Player();
    let hasInteracted = false;
    let inkAccumulator = 0; // Track how much re-inking has occurred

    // Initialize HUD state from storage
    setHudHidden(getHudHidden());

    let last = performance.now();
    function loop(now) {
        const dt = clamp((now - last) / 1000, 0, 0.05);
        last = now;

        // Base black background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, state.size.w, state.size.h);

        // Backdrop text revealed by erasing: "FNGRNCTR" in red Impact
        const minSide = Math.min(state.size.w, state.size.h);
        const fontSize = Math.floor(minSide * 0.22);
        ctx.fillStyle = '#c00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontSize}px Impact, Haettenschweiler, 'Arial Black', sans-serif`;
        ctx.fillText('FNGRNCTR', state.size.w / 2, state.size.h / 2);

        player.update(dt, input);

        // Erase only after first interaction/movement so no red shows initially
        const speed = player.vel.len();
        const isActive = input.pointerActive || input.keys.size > 0 || speed > 0.1;
        if (!hasInteracted && isActive) hasInteracted = true;

        // Re-ink only when idle, so revealed text persists while moving
        if (hasInteracted) {
            // Track accumulation to accelerate fade as we approach full coverage
            if (isActive) {
                inkAccumulator = 0; // Reset when actively erasing
            } else {
                inkAccumulator += dt;
            }

            // Accelerate re-ink rate based on how long we've been idle
            // Starts at 1.0, ramps up exponentially to ensure full coverage
            const baseRate = 0.4; // opacity per second; lower = slower initial fade
            const boost = Math.min(8, 1 + inkAccumulator * 10.0); // gradual acceleration
            const reinkRate = baseRate * boost;
            const alphaStep = Math.min(1, reinkRate * dt);

            inkCtx.save();
            inkCtx.globalCompositeOperation = 'source-over';
            inkCtx.globalAlpha = alphaStep;
            inkCtx.fillStyle = '#000';
            inkCtx.fillRect(0, 0, state.size.w, state.size.h);
            inkCtx.restore();

            // Ensure complete coverage after sufficient idle time
            if (inkAccumulator > 2) {
                inkCtx.fillStyle = '#000';
                inkCtx.fillRect(0, 0, state.size.w, state.size.h);
            }
        }

        if (hasInteracted && isActive) {
            // Soft-edge circular brush with radius based on speed
            const base = player.size * 0.45; // smaller base brush
            const maxScreenRadius = Math.min(state.size.w, state.size.h) * 0.12; // smaller cap
            // Normalize speed to 0..1; use gentle easing to avoid huge sizes
            const sNorm = Math.min(1, speed / (player.maxSpeed || 400));
            const ease = Math.sqrt(sNorm); // faster early growth, slower near cap
            const radius = Math.max(18, base + ease * (maxScreenRadius - base));
            inkCtx.save();
            inkCtx.globalCompositeOperation = 'destination-out';
            const g = inkCtx.createRadialGradient(player.pos.x, player.pos.y, 0, player.pos.x, player.pos.y, radius);
            // Strong reveal at core, extremely soft outer falloff
            g.addColorStop(0.0, 'rgba(0,0,0,1.0)');
            g.addColorStop(0.6, 'rgba(0,0,0,0.15)');
            g.addColorStop(1.0, 'rgba(0,0,0,0)');
            inkCtx.fillStyle = g;
            inkCtx.beginPath();
            inkCtx.arc(player.pos.x, player.pos.y, radius, 0, Math.PI * 2);
            inkCtx.fill();
            inkCtx.restore();
        }

        // Composite ink layer onto main canvas (remaining black)
        ctx.drawImage(inkCanvas, 0, 0, state.size.w, state.size.h);

        // Draw player icon on top
        player.draw(ctx);

        if (input.pointerActive) {
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(input.pointerStart.x + 0.5, input.pointerStart.y + 0.5);
            ctx.lineTo(input.pointerPos.x + 0.5, input.pointerPos.y + 0.5);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.arc(input.pointerStart.x, input.pointerStart.y, 6, 0, Math.PI * 2);
            ctx.fill();
            // Auto-hide HUD after first interaction for mobile clarity
            if (!hud.classList.contains('hidden')) setHudHidden(true);
        }

        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    window.addEventListener('resize', () => {
        player.pos.set(
            clamp(player.pos.x, player.size / 2, state.size.w - player.size / 2),
            clamp(player.pos.y, player.size / 2, state.size.h - player.size / 2)
        );
    });
})();
