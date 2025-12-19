(() => {
    'use strict';

    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Offscreen ink layer (black) we will erase to reveal red base
    let inkCanvas = document.createElement('canvas');
    let inkCtx = inkCanvas.getContext('2d', { alpha: true });

    // Load player icon image
    const playerIcon = new Image();
    playerIcon.src = 'nectar-preview.png';

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
        const dpr = Math.min(2, window.devicePixelRatio || 1); // Cap at 2 for performance
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

    // Prevent text selection on all touch/mouse events
    document.addEventListener('selectstart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    class Input {
        constructor() {
            this.keys = new Set();
            this.pointerActive = false;
            this.pointerPos = new Vec2();
            this._bind();
        }
        _bind() {
            window.addEventListener('keydown', (e) => {
                const k = e.code;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(k)) {
                    this.keys.add(k);
                    e.preventDefault();
                }
            });
            window.addEventListener('keyup', (e) => this.keys.delete(e.code));

            const start = (x, y) => { this.pointerActive = true; this.pointerPos.set(x, y); };
            const move = (x, y) => { if (this.pointerActive) this.pointerPos.set(x, y); };
            const end = () => { this.pointerActive = false; };

            canvas.addEventListener('pointerdown', (e) => {
                canvas.setPointerCapture(e.pointerId);
                start(e.clientX, e.clientY);
                e.preventDefault();
            }, { passive: false });
            canvas.addEventListener('pointermove', (e) => { move(e.clientX, e.clientY); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('pointerup', (e) => { end(); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('pointercancel', end);
        }
        getAxis() {
            let x = 0, y = 0;
            if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
            if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
            if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
            if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;

            const k = new Vec2(x, y);
            if (k.len() > 0) k.normalize();
            return k;
        }
        getPointerTarget() {
            return this.pointerActive ? this.pointerPos.clone() : null;
        }
    }

    class Player {
        constructor() {
            this.pos = new Vec2(state.size.w / 2, state.size.h / 2);
            this.vel = new Vec2(0, 0);
            this.size = 42;
            this.accel = 900;   // acceleration toward input direction (px/s^2)
            this.maxSpeed = 500; // clamp top speed
            this.drag = 3.5;     // damping coefficient (1/s), lower = more glide
        }
        update(dt, input, allowInput = true) {
            // Check for direct pointer control first
            const pointerTarget = input.getPointerTarget();
            if (pointerTarget && allowInput) {
                // Move player directly to pointer position with smooth interpolation
                const dx = pointerTarget.x - this.pos.x;
                const dy = pointerTarget.y - this.pos.y;
                const distance = Math.hypot(dx, dy);

                if (distance > 1) {
                    // Smooth follow with velocity for natural motion
                    const followSpeed = 12; // Higher = snappier follow
                    this.vel.x = dx * followSpeed;
                    this.vel.y = dy * followSpeed;
                } else {
                    // Close enough, just set position directly
                    this.pos.copy(pointerTarget);
                    this.vel.set(0, 0);
                }
            } else if (allowInput) {
                // Keyboard control
                const dir = input.getAxis();
                if (dir.len() > 0) {
                    this.vel.add(dir.clone().scale(this.accel * dt));
                }
                // Apply drag using exponential decay for smoother feel
                const dragFactor = Math.exp(-this.drag * dt);
                this.vel.scale(dragFactor);
            } else {
                // No input allowed, but apply drag to existing velocity
                const dragFactor = Math.exp(-this.drag * dt);
                this.vel.scale(dragFactor);
            }

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
        draw(ctx, opacity = 1) {
            const half = this.size / 2;
            if (playerIcon.complete) {
                ctx.globalAlpha = opacity;
                ctx.drawImage(playerIcon, Math.round(this.pos.x - half), Math.round(this.pos.y - half), this.size, this.size);
                ctx.globalAlpha = 1;
            } else {
                // Fallback to white square while image loads
                ctx.fillStyle = opacity < 1 ? `rgba(255, 255, 255, ${opacity})` : '#000000ff';
                ctx.fillRect(Math.round(this.pos.x - half) + 0.5, Math.round(this.pos.y - half) + 0.5, this.size, this.size);
            }
        }
    }

    const input = new Input();
    const player = new Player();
    let hasInteracted = false;
    let inkAccumulator = 0; // Track how much re-inking has occurred
    let isRevealed = false; // Track if text is fully revealed
    let revealProgress = 0; // Animation progress 0..1 for rising text
    let textYOffset = 0; // Current vertical offset of text
    let playerOpacity = 1; // Player fade opacity
    let fadeDelay = 0; // Delay timer before text rises
    let frameCount = 0; // For throttling expensive operations
    let redirectTimer = 0; // Timer for redirect after animation completes
    let albumsOpacity = 0; // Opacity for album grid fade-in
    let albumsLoaded = 0; // Track how many album images have loaded

    // 6 most recent albums from fngrnctr.bandcamp.com
    const albums = [
        {
            title: 'Ruby',
            url: 'https://fngrnctr.bandcamp.com/album/ruby',
            artUrl: 'https://f4.bcbits.com/img/a2483217735_10.jpg'
        },
        {
            title: 'Filthy Rich',
            url: 'https://fngrnctr.bandcamp.com/album/filthy-rich',
            artUrl: 'https://f4.bcbits.com/img/a3618756549_10.jpg'
        },
        {
            title: 'Curse of the Doom Wizard',
            url: 'https://fngrnctr.bandcamp.com/album/curse-of-the-doom-wizard',
            artUrl: 'https://f4.bcbits.com/img/a2806072651_10.jpg'
        },
        {
            title: 'The Ark of Rhyme',
            url: 'https://fngrnctr.bandcamp.com/album/the-ark-of-rhyme',
            artUrl: 'https://f4.bcbits.com/img/a2390029355_10.jpg'
        },
        {
            title: 'Totally Bad Dudes',
            url: 'https://fngrnctr.bandcamp.com/album/totally-bad-dudes-2',
            artUrl: 'https://f4.bcbits.com/img/a2322292393_10.jpg'
        },
        {
            title: 'Adventures in $herwood: Welcome to Smockville',
            url: 'https://fngrnctr.bandcamp.com/album/adventures-in-herwood-welcome-to-smockville',
            artUrl: 'https://f4.bcbits.com/img/a1625422072_10.jpg'
        }
    ];

    // Create HTML elements for album art (avoids CORS canvas issues)
    const albumContainer = document.createElement('div');
    albumContainer.id = 'album-container';
    albumContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
        opacity: 0;
        transition: opacity 0.8s ease;
    `;
    document.body.appendChild(albumContainer);

    const albumElements = albums.map((album, i) => {
        const link = document.createElement('a');
        link.href = album.url;
        link.target = '_blank';
        link.style.cssText = `
            position: absolute;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            border: 2px solid #fff;
        `;
        link.onmouseenter = () => {
            link.style.transform = 'scale(1.05)';
            link.style.boxShadow = '0 8px 20px rgba(255,255,255,0.3)';
        };
        link.onmouseleave = () => {
            link.style.transform = 'scale(1)';
            link.style.boxShadow = 'none';
        };

        const img = document.createElement('img');
        img.src = album.artUrl;
        img.alt = album.title;
        img.draggable = false;
        img.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
            user-select: none;
            -webkit-user-drag: none;
        `;
        img.onload = () => { albumsLoaded++; };
        img.onerror = () => { console.error('Failed to load album art:', album.title); };

        link.appendChild(img);
        albumContainer.appendChild(link);
        return link;
    });

    // Function to update album positions
    function updateAlbumPositions() {
        const minSide = Math.min(state.size.w, state.size.h);
        const albumSize = Math.min(120, minSide * 0.15);
        const gap = albumSize * 0.15;
        const totalWidth = albums.length * albumSize + (albums.length - 1) * gap;
        const startX = (state.size.w - totalWidth) / 2;
        const centerY = state.size.h / 2;

        albumElements.forEach((elem, i) => {
            const x = startX + i * (albumSize + gap);
            const y = centerY - albumSize / 2;
            elem.style.left = Math.round(x) + 'px';
            elem.style.top = Math.round(y) + 'px';
            elem.style.width = albumSize + 'px';
            elem.style.height = albumSize + 'px';
        });
    }

    // Update album positions on resize
    window.addEventListener('resize', updateAlbumPositions, { passive: true });
    updateAlbumPositions();

    // Function to calculate reveal percentage by sampling ink layer
    function calculateRevealPercentage() {
        if (!hasInteracted) return 0;

        // Sample a grid of points around the text area to check transparency
        const centerX = Math.floor(state.size.w / 2);
        const centerY = Math.floor(state.size.h / 2);
        const minSide = Math.min(state.size.w, state.size.h);
        const sampleWidth = Math.floor(minSide * 0.5);
        const sampleHeight = Math.floor(minSide * 0.15);

        const step = 30; // Sample every 30 pixels for better performance
        let totalSamples = 0;
        let revealedSamples = 0;

        const x0 = Math.max(0, centerX - sampleWidth / 2);
        const y0 = Math.max(0, centerY - sampleHeight / 2);
        const x1 = Math.min(state.size.w, centerX + sampleWidth / 2);
        const y1 = Math.min(state.size.h, centerY + sampleHeight / 2);

        for (let x = x0; x < x1; x += step) {
            for (let y = y0; y < y1; y += step) {
                totalSamples++;
                const imgData = inkCtx.getImageData(x * state.size.dpr, y * state.size.dpr, 1, 1);
                const alpha = imgData.data[3];
                // Consider revealed if alpha is below threshold (more transparent)
                if (alpha < 128) revealedSamples++;
            }
        }

        return totalSamples > 0 ? revealedSamples / totalSamples : 0;
    }

    let last = performance.now();
    function loop(now) {
        const dt = clamp((now - last) / 1000, 0, 0.05);
        last = now;
        frameCount++;

        // Base black background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, state.size.w, state.size.h);

        // Fade out player and gradually reveal remaining ink
        if (isRevealed) {
            if (fadeDelay < 2) {
                fadeDelay += dt;
                // Fade player out over 2 seconds
                playerOpacity = Math.max(0, 1 - (fadeDelay / 2));
                // Gradually reveal remaining ink over same 2 seconds
                const revealAmount = fadeDelay / 2; // 0 to 1 over 2 seconds
                inkCtx.globalCompositeOperation = 'destination-out';
                inkCtx.globalAlpha = revealAmount * 0.5; // Gradual fade
                inkCtx.fillStyle = '#000';
                inkCtx.fillRect(0, 0, state.size.w, state.size.h);
                inkCtx.globalAlpha = 1;
                inkCtx.globalCompositeOperation = 'source-over';
            }
            if (fadeDelay >= 1.5 && revealProgress < 1) {
                // Start text animation after 1.5 second delay
                revealProgress = Math.min(1, revealProgress + dt * 0.333); // 3 second animation
                // Ease out cubic for smooth deceleration
                const eased = 1 - Math.pow(1 - revealProgress, 3);
                const minSide = Math.min(state.size.w, state.size.h);
                const fontSize = Math.floor(minSide * 0.22);
                const targetY = fontSize * 0.6; // Position near top
                textYOffset = (state.size.h / 2 - targetY) * eased;
            }
            // Fade in albums after text animation completes
            if (revealProgress >= 1 && albumsOpacity < 1) {
                albumsOpacity = Math.min(1, albumsOpacity + dt * 0.8); // Fade in over ~1.25 seconds
                albumContainer.style.opacity = albumsOpacity;
                // Enable interactions once fully visible
                if (albumsOpacity >= 1) {
                    albumContainer.style.pointerEvents = 'auto';
                }
            }
            // After text animation completes, wait 3 seconds then redirect
            // TEMPORARILY DISABLED - Adding new feature
            // if (revealProgress >= 1) {
            //     redirectTimer += dt;
            //     if (redirectTimer >= 3) {
            //         console.log('Redirecting to https://www.theknot.com/fngrnctr');
            //         window.location.href = 'https://www.theknot.com/fngrnctr';
            //         return; // Stop the loop after redirect
            //     }
            // }
        }

        // Backdrop text revealed by erasing: "FNGRNCTR" in white Impact
        const minSide = Math.min(state.size.w, state.size.h);
        const fontSize = Math.floor(minSide * 0.22);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontSize}px Impact, Haettenschweiler, 'Arial Black', sans-serif`;
        ctx.fillText('FNGRNCTR', state.size.w / 2, state.size.h / 2 - textYOffset);

        player.update(dt, input, !isRevealed);

        // Erase only after first interaction/movement so no red shows initially
        const speed = player.vel.len();
        const isActive = input.pointerActive || input.keys.size > 0 || speed > 0.1;
        if (!hasInteracted && isActive) hasInteracted = true;

        // Check reveal percentage only when not revealed, when active, and throttled to every 5 frames
        if (!isRevealed && hasInteracted && isActive && frameCount % 5 === 0) {
            const revealPct = calculateRevealPercentage();
            if (revealPct >= 0.98) {
                isRevealed = true;
            }
        }

        // Re-ink only when idle, so revealed text persists while moving
        if (hasInteracted && !isRevealed) {
            // Track accumulation to accelerate fade as we approach full coverage
            if (isActive) {
                inkAccumulator = 0; // Reset when actively erasing
            } else {
                inkAccumulator += dt;
            }

            // Accelerate re-ink rate based on how long we've been idle
            // Starts at 1.0, ramps up exponentially to ensure full coverage
            const baseRate = 0.3; // opacity per second; lower = slower initial fade
            const boost = Math.min(8, 1 + inkAccumulator * 10.0); // gradual acceleration
            const reinkRate = baseRate * boost;
            const alphaStep = Math.min(1, reinkRate * dt);

            inkCtx.globalCompositeOperation = 'source-over';
            inkCtx.globalAlpha = alphaStep;
            inkCtx.fillStyle = '#000';
            inkCtx.fillRect(0, 0, state.size.w, state.size.h);
            inkCtx.globalAlpha = 1;
            inkCtx.globalCompositeOperation = 'source-over';

            // Ensure complete coverage after sufficient idle time
            if (inkAccumulator > 2) {
                inkCtx.fillStyle = '#000';
                inkCtx.fillRect(0, 0, state.size.w, state.size.h);
            }
        }

        if (hasInteracted && isActive && !isRevealed) {
            // Soft-edge circular brush with radius based on speed
            const base = player.size * 0.45; // smaller base brush
            const maxScreenRadius = Math.min(state.size.w, state.size.h) * 0.12; // smaller cap
            // Normalize speed to 0..1; use gentle easing to avoid huge sizes
            const sNorm = Math.min(1, speed / (player.maxSpeed || 400));
            const ease = Math.sqrt(sNorm); // faster early growth, slower near cap
            const radius = Math.max(18, base + ease * (maxScreenRadius - base));

            inkCtx.globalCompositeOperation = 'destination-out';
            const g = inkCtx.createRadialGradient(player.pos.x, player.pos.y, 0, player.pos.x, player.pos.y, radius);
            g.addColorStop(0.0, 'rgba(0,0,0,1.0)');
            g.addColorStop(0.6, 'rgba(0,0,0,0.15)');
            g.addColorStop(1.0, 'rgba(0,0,0,0)');
            inkCtx.fillStyle = g;
            inkCtx.beginPath();
            inkCtx.arc(player.pos.x, player.pos.y, radius, 0, Math.PI * 2);
            inkCtx.fill();
            inkCtx.globalCompositeOperation = 'source-over';
        }

        // Composite ink layer onto main canvas (remaining black)
        ctx.drawImage(inkCanvas, 0, 0, state.size.w, state.size.h);

        // Draw player icon on top
        player.draw(ctx, playerOpacity);

        // Albums are now rendered as HTML elements (see albumContainer)

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
