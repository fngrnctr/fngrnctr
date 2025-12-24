(() => {
    'use strict';

    const canvas = document.getElementById('game');
    canvas.style.zIndex = '200';
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Offscreen ink layer (black) we will erase to reveal red base
    let inkCanvas = document.createElement('canvas');
    let inkCtx = inkCanvas.getContext('2d', { alpha: true, willReadFrequently: true });

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
        const dpr = Math.min(1.5, window.devicePixelRatio || 1); // Cap at 2 for performance
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
            this.accel = 1000;   // acceleration toward input direction (px/s^2)
            this.maxSpeed = 500; // clamp top speed
            this.drag = 2.5;     // damping coefficient (1/s), lower = more glide
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
                ctx.drawImage(playerIcon,
                    Math.round(this.pos.x - half),
                    Math.round(this.pos.y - half),
                    this.size, this.size);
                ctx.globalAlpha = 1;
            } else {
                // Fallback to white square while image loads
                ctx.fillStyle = opacity < 1 ? `rgba(255, 255, 255, ${opacity})` : '#000000ff';
                ctx.fillRect(Math.round(this.pos.x - half) + 0.5,
                    Math.round(this.pos.y - half) + 0.5,
                    this.size, this.size);
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
    let selectedAlbumIndex = null; // Track which album is currently focused (null = grid view)

    // Animation state for countdown orbit
    let orbitAngle = 0; // Current angle for orbit rotation

    // Jiggle hint state
    let idleTime = 0; // Track time without interaction
    let jiggleActive = false; // Whether jiggle animation is active
    let postJigglePause = 0; // Track pause time after jiggle ends
    let jiggleCycleCount = 0; // Track number of jiggle cycles (0 = first cycle)
    const JIGGLE_DELAY = 5.0; // Seconds to wait before starting jiggle

    // 6 most recent albums from fngrnctr.bandcamp.com
    const albums = [
        {
            title: 'Ruby',
            url: 'https://fngrnctr.bandcamp.com/album/ruby',
            artUrl: 'https://f4.bcbits.com/img/a2483217735_10.jpg',
            tracks: [
                { name: 'First Day of Summer', url: 'https://fngrnctr.bandcamp.com/track/first-day-of-summer', duration: '02:45' },
                { name: 'Call from Kenneth (Skit)', url: 'https://fngrnctr.bandcamp.com/track/call-from-kenneth-skit', duration: '01:58' },
                { name: 'The Heist', url: 'https://fngrnctr.bandcamp.com/track/the-heist', duration: '02:13' },
                { name: 'Destroy the Ruby, Larry (Skit)', url: 'https://fngrnctr.bandcamp.com/track/destroy-the-ruby-larry-skit', duration: '00:30' },
                { name: 'Three Nights in Dallas', url: 'https://fngrnctr.bandcamp.com/track/three-nights-in-dallas', duration: '02:47' },
                { name: 'Cuffed', url: 'https://fngrnctr.bandcamp.com/track/cuffed', duration: '03:43' },
                { name: 'Failed My Friend', url: 'https://fngrnctr.bandcamp.com/track/failed-my-friend', duration: '02:30' },
                { name: 'Who Put the Ruby in the Sky?', url: 'https://fngrnctr.bandcamp.com/track/who-put-the-ruby-in-the-sky', duration: '03:37' }
            ]
        },
        {
            title: 'Filthy Rich',
            url: 'https://fngrnctr.bandcamp.com/album/filthy-rich',
            artUrl: 'https://f4.bcbits.com/img/a3618756549_10.jpg',
            tracks: [
                { name: 'Wednesday Afternoon', url: 'https://fngrnctr.bandcamp.com/track/wednesday-afternoon', duration: '03:21' },
                { name: 'Butler', url: 'https://fngrnctr.bandcamp.com/track/butler', duration: '02:50' },
                { name: 'Satin Bathrobes', url: 'https://fngrnctr.bandcamp.com/track/satin-bathrobes', duration: '01:55' },
                { name: 'New Day', url: 'https://fngrnctr.bandcamp.com/track/new-day', duration: '01:28' },
                { name: 'Big Bad', url: 'https://fngrnctr.bandcamp.com/track/big-bad', duration: '01:16' },
                { name: 'Filthy Rich', url: 'https://fngrnctr.bandcamp.com/track/filthy-rich', duration: '02:47' },
                { name: 'Clones', url: 'https://fngrnctr.bandcamp.com/track/clones', duration: '03:51' },
                { name: '20,000 Bones', url: 'https://fngrnctr.bandcamp.com/track/20-000-bones', duration: '01:22' },
                { name: 'Growth Mindset', url: 'https://fngrnctr.bandcamp.com/track/growth-mindset', duration: '03:20' },
                { name: 'Fresh Cooked Meal', url: 'https://fngrnctr.bandcamp.com/track/fresh-cooked-meal', duration: '03:34' },
                { name: 'Sludge Factory', url: 'https://fngrnctr.bandcamp.com/track/sludge-factory', duration: '03:06' }
            ]
        },
        {
            title: 'Curse of the Doom Wizard',
            url: 'https://fngrnctr.bandcamp.com/album/curse-of-the-doom-wizard',
            artUrl: 'https://f4.bcbits.com/img/a2806072651_10.jpg',
            tracks: [
                { name: 'Mythic Motel', url: 'https://fngrnctr.bandcamp.com/track/mythic-motel', duration: '02:07' },
                { name: 'Doom', url: 'https://fngrnctr.bandcamp.com/track/doom', duration: '01:32' },
                { name: 'Memento Mori', url: 'https://fngrnctr.bandcamp.com/track/memento-mori', duration: '01:21' },
                { name: 'Born to Die', url: 'https://fngrnctr.bandcamp.com/track/born-to-die', duration: '02:34' },
                { name: 'Junkyard Jam', url: 'https://fngrnctr.bandcamp.com/track/junkyard-jam', duration: '01:57' },
                { name: 'Gasoline', url: 'https://fngrnctr.bandcamp.com/track/gasoline', duration: '03:35' },
                { name: 'Going to Space', url: 'https://fngrnctr.bandcamp.com/track/going-to-space', duration: '03:18' },
                { name: 'Club Berlin', url: 'https://fngrnctr.bandcamp.com/track/club-berlin', duration: '06:31' }
            ]
        },
        {
            title: 'The Ark of Rhyme',
            url: 'https://fngrnctr.bandcamp.com/album/the-ark-of-rhyme',
            artUrl: 'https://f4.bcbits.com/img/a2390029355_10.jpg',
            tracks: [
                { name: 'Business District', url: 'https://fngrnctr.bandcamp.com/track/business-district', duration: '02:53' },
                { name: 'Ready to Rap (Boys in the Back)', url: 'https://fngrnctr.bandcamp.com/track/ready-to-rap-boys-in-the-back', duration: '03:23' },
                { name: 'Sugar', url: 'https://fngrnctr.bandcamp.com/track/sugar', duration: '02:15' },
                { name: 'Down to Get Out', url: 'https://fngrnctr.bandcamp.com/track/down-to-get-out', duration: '03:37' },
                { name: 'Blue Skies Only', url: 'https://fngrnctr.bandcamp.com/track/blue-skies-only', duration: '03:49' },
                { name: 'Barge Pirates', url: 'https://fngrnctr.bandcamp.com/track/barge-pirates', duration: '03:22' }
            ]
        },
        {
            title: 'Totally Bad Dudes',
            url: 'https://fngrnctr.bandcamp.com/album/totally-bad-dudes-2',
            artUrl: 'https://f4.bcbits.com/img/a2322292393_10.jpg',
            tracks: [
                { name: 'Jackals', url: 'https://fngrnctr.bandcamp.com/track/jackals', duration: '03:59' },
                { name: 'Glasgow', url: 'https://fngrnctr.bandcamp.com/track/glasgow', duration: '03:43' },
                { name: 'Bad Dudes', url: 'https://fngrnctr.bandcamp.com/track/bad-dudes', duration: '03:37' },
                { name: 'Nectar Shuffle', url: 'https://fngrnctr.bandcamp.com/track/nectar-shuffle', duration: '02:16' },
                { name: 'Freak 4 U', url: 'https://fngrnctr.bandcamp.com/track/freak-4-u', duration: '03:29' },
                { name: 'Y!KE', url: 'https://fngrnctr.bandcamp.com/track/y-ke', duration: '01:52' },
                { name: 'Deep in the Weekend', url: 'https://fngrnctr.bandcamp.com/track/deep-in-the-weekend', duration: '03:08' },
                { name: 'Say Goodbye', url: 'https://fngrnctr.bandcamp.com/track/say-goodbye', duration: '03:00' }
            ]
        },
        {
            title: 'Adventures in $herwood: Welcome to Smockville',
            url: 'https://fngrnctr.bandcamp.com/album/adventures-in-herwood-welcome-to-smockville',
            artUrl: 'https://f4.bcbits.com/img/a1625422072_10.jpg',
            tracks: [
                { name: 'Straight Beamin\'', url: 'https://fngrnctr.bandcamp.com/track/straight-beamin', duration: '03:48' },
                { name: 'Sherwood Anthem', url: 'https://fngrnctr.bandcamp.com/track/sherwood-anthem', duration: '03:09' },
                { name: 'Welcome to Smockville', url: 'https://fngrnctr.bandcamp.com/track/welcome-to-smockville', duration: '03:56' },
                { name: 'I-80 E', url: 'https://fngrnctr.bandcamp.com/track/i-80-e', duration: '05:40' },
                { name: '31 on a Good Day', url: 'https://fngrnctr.bandcamp.com/track/31-on-a-good-day', duration: '02:06' }
            ]
        },
        {
            title: 'Canonical Nectar',
            url: 'https://fngrnctr.bandcamp.com/album/canonical-nectar-3',
            artUrl: 'https://f4.bcbits.com/img/a0742649748_10.jpg',
            tracks: [
                { name: 'Survival of the Chillest', url: 'https://fngrnctr.bandcamp.com/track/survival-of-the-chillest', duration: '04:41' }
            ]
        },
        {
            title: 'Tony Hawk One',
            url: 'https://fngrnctr.bandcamp.com/album/tony-hawk-one',
            artUrl: 'https://f4.bcbits.com/img/a3694744642_10.jpg',
            tracks: [
                { name: 'Tony Hawk One', url: 'https://fngrnctr.bandcamp.com/track/tony-hawk-one', duration: '04:06' }
            ]
        },
        {
            title: 'Fuck The Environment',
            url: 'https://fngrnctr.bandcamp.com/album/fuck-the-environment',
            artUrl: 'https://f4.bcbits.com/img/a3026720147_10.jpg',
            tracks: [
                { name: 'Fuck the Environment', url: 'https://fngrnctr.bandcamp.com/track/fuck-the-environment', duration: '03:13' }
            ]
        },
        {
            title: 'MEGA BONE SLAM FEST',
            url: 'https://fngrnctr.bandcamp.com/album/fingernectar-presents-mega-bone-slam-fest-a-christmas-adventure',
            artUrl: 'https://f4.bcbits.com/img/a0486793882_10.jpg',
            tracks: [
                { name: 'The Scene Is Set (Intro)', url: 'https://fngrnctr.bandcamp.com/track/the-scene-is-set-intro', duration: '00:35' },
                { name: 'Gimme Presents', url: 'https://fngrnctr.bandcamp.com/track/gimme-presents', duration: '01:59' },
                { name: 'Root Beer', url: 'https://fngrnctr.bandcamp.com/track/root-beer', duration: '04:06' },
                { name: 'Farewell For Now (Outro)', url: 'https://fngrnctr.bandcamp.com/track/farewell-for-now-outro', duration: '00:30' },
                { name: 'Everybody Loves Christmas', url: 'https://fngrnctr.bandcamp.com/track/everybody-loves-christmas', duration: '02:45' }
            ]
        },
        {
            title: 'Sex Erector',
            url: 'https://fngrnctr.bandcamp.com/album/sex-erector',
            artUrl: 'https://f4.bcbits.com/img/a1646405077_10.jpg',
            tracks: [
                { name: 'Whole Lotta Doody', url: 'https://fngrnctr.bandcamp.com/track/whole-lotta-doody', duration: '02:13' }
            ]
        }
    ];

    // Initialize orbit animation data after albums array is defined
    const albumOrbitData = albums.map((_, i) => ({
        angleOffset: (i / albums.length) * Math.PI * 2, // Evenly space albums around circle
        rotationX: 0,
        rotationY: 0
    }));

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

    // Create embedded player container
    const playerContainer = document.createElement('div');
    playerContainer.id = 'player-container';
    playerContainer.style.cssText = `
        position: fixed;
        z-index: 12;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
    `;
    document.body.appendChild(playerContainer);

    const albumElements = albums.map((album, i) => {
        const link = document.createElement('a');
        link.href = album.url;
        link.target = '_blank';
        link.style.cssText = `
            position: absolute;
            cursor: pointer;
            transition: all 0.4s ease;
            border: 2px solid #fff;
            z-index: ${10 + i};
        `;

        // Click handler to focus/unfocus album
        link.addEventListener('click', (e) => {
            // Only handle focus/unfocus, not external navigation
            if (selectedAlbumIndex === null) {
                // Focus this album
                e.preventDefault();
                selectedAlbumIndex = i;
                updateAlbumPositions();
            } else if (selectedAlbumIndex === i) {
                // Unfocus - return to grid
                e.preventDefault();
                selectedAlbumIndex = null;
                updateAlbumPositions();
            } else {
                // Click on different album in sidebar - switch focus
                e.preventDefault();
                selectedAlbumIndex = i;
                updateAlbumPositions();
            }
        });

        link.onmouseenter = () => {
            if (selectedAlbumIndex === null || selectedAlbumIndex !== i) {
                link.style.transform = link.style.transform.includes('scale') ?
                    link.style.transform : 'scale(1.05)';
                link.style.boxShadow = '0 8px 20px rgba(255,255,255,0.3)';
            }
        };
        link.onmouseleave = () => {
            if (selectedAlbumIndex === null || selectedAlbumIndex !== i) {
                link.style.transform = link.style.transform.replace(/scale\([^)]*\)\s*/g, '');
                link.style.boxShadow = 'none';
            }
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

        if (selectedAlbumIndex === null) {
            // Grid view - horizontal row of albums
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
                elem.style.transform = '';
                elem.style.zIndex = 10 + i;
            });

            // Hide player
            playerContainer.style.opacity = '0';
            playerContainer.style.pointerEvents = 'none';
        } else {
            // Focused view - one large album in center, others in sidebar
            const focusedSize = Math.min(400, minSide * 0.5, state.size.h * 0.5);
            const sidebarSize = Math.min(100, minSide * 0.12);
            const sidebarGap = sidebarSize * 0.2;
            const sidebarX = Math.max(20, (state.size.w - focusedSize) / 4 - sidebarSize / 2);

            // Position focused album vertically centered
            const focusedX = (state.size.w - focusedSize) / 2;
            const focusedY = (state.size.h - focusedSize) / 2;

            albumElements.forEach((elem, i) => {
                if (i === selectedAlbumIndex) {
                    // Focused album - center and large
                    elem.style.left = Math.round(focusedX) + 'px';
                    elem.style.top = Math.round(focusedY) + 'px';
                    elem.style.width = focusedSize + 'px';
                    elem.style.height = focusedSize + 'px';
                    elem.style.transform = '';
                    elem.style.zIndex = 100;
                } else {
                    // Sidebar albums - vertical stack on left
                    const sidebarIndex = i < selectedAlbumIndex ? i : i - 1;
                    const totalSidebarHeight = (albums.length - 1) * (sidebarSize + sidebarGap) - sidebarGap;
                    const startY = (state.size.h - totalSidebarHeight) / 2;
                    const y = startY + sidebarIndex * (sidebarSize + sidebarGap);

                    elem.style.left = Math.round(sidebarX) + 'px';
                    elem.style.top = Math.round(y) + 'px';
                    elem.style.width = sidebarSize + 'px';
                    elem.style.height = sidebarSize + 'px';
                    elem.style.transform = '';
                    elem.style.zIndex = 10 + i;
                }
            });

            // Show Bandcamp album embed player to the right of the album
            const albumId = getAlbumId(selectedAlbumIndex);
            const embedUrl = `https://bandcamp.com/EmbeddedPlayer/album=${albumId}/size=large/bgcol=333333/linkcol=ffffff/artwork=none/transparent=true/`;

            playerContainer.innerHTML = `
                <iframe style="border: 0; width: 350px; height: ${focusedSize}px;" 
                        src="${embedUrl}" 
                        seamless>
                </iframe>
            `;

            // Position player to the right of album
            const playerX = focusedX + focusedSize + 20;
            playerContainer.style.left = playerX + 'px';
            playerContainer.style.top = focusedY + 'px';
            playerContainer.style.opacity = '1';
            playerContainer.style.pointerEvents = 'auto';
        }
    }

    // Helper to get Bandcamp album ID from album index
    function getAlbumId(index) {
        const albumIds = [
            '415329228',   // Ruby
            '3668548966',  // Filthy Rich (from user's example embed code)
            '1693447220',  // Curse of the Doom Wizard
            '3585089304',  // The Ark of Rhyme
            '1576237228',  // Totally Bad Dudes
            '3695036422'   // Adventures in $herwood
        ];
        return albumIds[index] || albumIds[0];
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
                // Keep text visible with minimum margin from top
                const minMargin = Math.max(50, fontSize * 0.5);
                const targetY = minMargin + fontSize / 2;
                textYOffset = (state.size.h / 2 - targetY) * eased;

                // Show albums rising with text, evenly spaced across text width
                const albumSize = Math.min(120, minSide * 0.15);
                ctx.measureText('FNGRNCTR');
                const textWidth = ctx.measureText('FNGRNCTR').width;
                const textCenterX = state.size.w / 2;
                const textStartX = textCenterX - textWidth / 2;
                const currentTextY = state.size.h / 2 - textYOffset;
                const albumY = currentTextY + fontSize * 1.2; // Position below text with more space

                albumElements.forEach((elem, i) => {
                    // Spread from left edge to right edge of text (albums evenly distributed)
                    const x = textStartX + (i / (albums.length - 1)) * (textWidth - albumSize);
                    const startY = state.size.h + 100; // Start completely below screen
                    const y = startY + (albumY - startY) * eased;

                    elem.style.left = Math.round(x) + 'px';
                    elem.style.top = Math.round(y) + 'px';
                    elem.style.width = albumSize + 'px';
                    elem.style.height = albumSize + 'px';
                    elem.style.transform = 'none';
                    elem.style.zIndex = 100 + (albums.length - 1 - i);
                });

                albumContainer.style.opacity = '1';
                albumContainer.style.pointerEvents = 'none';
            }
            // After text animation completes, show countdown with orbiting albums then redirect
            if (revealProgress >= 1) {
                redirectTimer += dt;

                // Show and animate albums during countdown (first 5 seconds)
                if (redirectTimer < 5) {
                    // Speed increases as countdown progresses (0.5x to 2.5x speed)
                    const speedMultiplier = 0.5 + (redirectTimer / 5) * 2;
                    orbitAngle += dt * 1.5 * speedMultiplier; // Base speed: 1.5 rad/sec

                    const minSide = Math.min(state.size.w, state.size.h);
                    const albumSize = Math.min(120, minSide * 0.15);
                    const orbitRadius = Math.min(200, minSide * 0.25);
                    const centerX = state.size.w / 2;
                    const centerY = state.size.h / 2;

                    albumElements.forEach((elem, i) => {
                        const data = albumOrbitData[i];
                        const angle = orbitAngle + data.angleOffset;

                        // Calculate orbit position
                        const x = centerX + Math.cos(angle) * orbitRadius - albumSize / 2;
                        const y = centerY + Math.sin(angle) * orbitRadius - albumSize / 2;

                        elem.style.left = Math.round(x) + 'px';
                        elem.style.top = Math.round(y) + 'px';

                        // Update rotation for 3D spinning effect
                        data.rotationY += dt * 180 * speedMultiplier; // Spin on Y axis
                        data.rotationX = Math.sin(angle * 2) * 15; // Subtle wobble on X axis

                        // Apply sizing and 3D transform
                        elem.style.width = albumSize + 'px';
                        elem.style.height = albumSize + 'px';
                        elem.style.transform = `perspective(1000px) rotateX(${data.rotationX}deg) rotateY(${data.rotationY}deg)`;
                        elem.style.zIndex = 100 + (albums.length - 1 - i);
                    });

                    albumContainer.style.opacity = '1';
                    albumContainer.style.pointerEvents = 'none';
                } else if (redirectTimer >= 5 && redirectTimer < 6) {
                    // Black screen for 1 second before redirect
                    albumContainer.style.opacity = '0';
                } else {
                    // Hide albums before redirect
                    albumContainer.style.opacity = '0';
                }

                if (redirectTimer >= 6) {
                    console.log('Redirecting to https://www.theknot.com/fngrnctr');
                    window.location.href = 'https://www.theknot.com/fngrnctr';
                    return; // Stop the loop after redirect
                }
            }
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

        // Apply jiggle movement to actual player position
        if (jiggleActive && !hasInteracted) {
            const time = Date.now() / 1000;
            const freq = 4.0;
            const jiggleDuration = idleTime;
            // Max amplitude increases with each cycle: 2px -> 4px -> 6px
            const maxAmplitudeForCycle = Math.min(6.0, 2.0 + jiggleCycleCount * 2.0);
            const amplitude = Math.min(maxAmplitudeForCycle, 1.0 + Math.floor(jiggleDuration / 0.5));

            // Apply small velocity changes to create jiggle movement
            const jiggleVelX = Math.cos(time * freq) * amplitude * 20; // Velocity component
            const jiggleVelY = Math.sin(time * freq * 1.5) * amplitude * 16;
            player.vel.x = jiggleVelX;
            player.vel.y = jiggleVelY;

            idleTime += dt;

            // Duration increases with each cycle: 1s -> 2s -> 3s
            const jiggleDurationForCycle = Math.min(3.0, 1.0 + jiggleCycleCount);

            // Stop jiggling after duration
            if (idleTime >= jiggleDurationForCycle) {
                jiggleActive = false;
                idleTime = 0;
                postJigglePause = 0;
                jiggleCycleCount++; // Increment cycle count for next jiggle
            }
        }

        // Erase only after first interaction/movement so no red shows initially
        const speed = player.vel.len();
        // Only count actual user input as active, not jiggle movement or coasting
        const userInput = input.pointerActive || input.keys.size > 0;
        const isActive = userInput;
        if (!hasInteracted && isActive) {
            hasInteracted = true;
            // Immediately stop any active jiggle when user interacts
            if (jiggleActive) {
                jiggleActive = false;
                idleTime = 0;
                postJigglePause = 0;
                jiggleCycleCount = 0; // Reset cycle count
            }
        }

        // Jiggle hint logic: start after delay if no interaction, stop when interacting
        if (!hasInteracted && !isActive) {
            // Check if player is at rest (very low velocity)
            const isAtRest = speed < 0.1;

            if (isAtRest && !jiggleActive) {
                postJigglePause += dt;

                // Start jiggling after delay
                if (postJigglePause >= JIGGLE_DELAY) {
                    jiggleActive = true;
                    idleTime = 0; // Reset for tracking jiggle duration
                    postJigglePause = 0;
                }
            }
        } else if (isActive) {
            if (jiggleActive) {
                jiggleActive = false;
            }
            idleTime = 0;
            postJigglePause = 0;
            jiggleCycleCount = 0; // Reset cycle count on interaction
        }

        // Check reveal percentage only when not revealed, when active, and throttled to every 5 frames
        if (!isRevealed && hasInteracted && isActive && frameCount % 5 === 0) {
            const revealPct = calculateRevealPercentage();
            if (revealPct >= 0.98) {
                isRevealed = true;
            }
        }

        // Re-ink only when idle, so revealed text persists while moving
        // Also apply during jiggle cycle when not actively jiggling
        if ((hasInteracted || postJigglePause > 0 || idleTime > 0) && !isRevealed) {
            // Track accumulation to accelerate fade as we approach full coverage
            if (isActive || jiggleActive) {
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

        // Don't re-ink during jiggle animation (allow text to be revealed)
        if (jiggleActive && !hasInteracted) {
            inkAccumulator = 0; // Keep accumulator at zero during jiggle
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

        // Erase during jiggle animation (player is actually moving)
        if (jiggleActive && !hasInteracted && !isRevealed) {
            const base = player.size * 0.45;
            const radius = Math.max(18, base);

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

        // Fade to black before redirect
        if (revealProgress >= 1 && redirectTimer >= 5 && redirectTimer < 6) {
            // Black screen after countdown reaches 1
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, state.size.w, state.size.h);
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
