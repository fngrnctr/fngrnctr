(() => {
    'use strict';

    const canvas = document.getElementById('game');
    canvas.style.zIndex = '200';
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // Offscreen ink layer (black) we will erase to reveal red base
    let inkCanvas = document.createElement('canvas');
    let inkCtx = inkCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    // Timestamp canvas to track when each pixel was last revealed
    let timestampCanvas = document.createElement('canvas');
    let timestampCtx = timestampCanvas.getContext('2d', { alpha: false });

    // Load player icon image
    const playerIcon = new Image();
    playerIcon.src = 'nectar-preview.png';

    // Load revealed image
    const cloudsImage = new Image();
    cloudsImage.src = 'clouds.png';

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
        const dpr = Math.min(1.5, window.devicePixelRatio || 1); // Cap for performance
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

        // Prepare timestamp canvas
        timestampCanvas.width = canvas.width;
        timestampCanvas.height = canvas.height;
        timestampCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        timestampCtx.fillStyle = '#000';
        timestampCtx.fillRect(0, 0, cw, ch);
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

    // Merch items
    const merch = [
        {
            name: 'Saved My Life T-shirt',
            description: 'Did FNGRNCTR save your life? Let the world know.',
            price: '$31.00',
            imageUrl: 'https://f4.bcbits.com/img/0042903607_10.jpg',
            url: 'https://fngrnctr.bandcamp.com/merch/saved-my-life-t-shirt',
            uppercase: true
        },
        {
            name: 'cool-kid_01 (KeNFT)',
            description: 'First pressing of 14 billion. From the "Ken\'s Coolest" collection.',
            price: '31 ETH',
            imageUrl: 'https://i2c.seadn.io/ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/e69d71dda3c7d45a8d1ed3aa238369/b5e69d71dda3c7d45a8d1ed3aa238369.jpeg?w=1000',
            url: 'https://opensea.io/item/ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/26061901186007371607264970581182361421104974378862169005074243448716214140929'
        }
    ];

    // All albums from fngrnctr.bandcamp.com
    const albums = [
        {
            title: 'Nectarville, USA',
            url: 'https://fngrnctr.bandcamp.com/album/nectarville-usa',
            artUrl: 'https://f4.bcbits.com/img/a0368239433_10.jpg',
            tracks: [
                { name: 'Scooter', url: 'https://fngrnctr.bandcamp.com/track/scooter', duration: '03:33' },
                { name: 'Tum Tum Chicken', url: 'https://fngrnctr.bandcamp.com/track/tum-tum-chicken', duration: '02:44' },
                { name: 'Gas Day', url: 'https://fngrnctr.bandcamp.com/track/gas-day', duration: '03:20' },
                { name: 'School Dance', url: 'https://fngrnctr.bandcamp.com/track/school-dance', duration: '02:52' }
            ]
        },
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
                // Fade instructional text at same rate
                const instructions = document.getElementById('instructions');
                if (instructions) {
                    instructions.style.opacity = playerOpacity;
                }
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

                // Show albums rising with image, evenly spaced across image width
                const albumSize = Math.min(120, minSide * 0.15);
                const imageWidth = fontSize * 3; // Approximate width based on image aspect ratio
                const textCenterX = state.size.w / 2;
                const textStartX = textCenterX - imageWidth / 2;
                const currentTextY = state.size.h / 2 - textYOffset;
                const albumY = currentTextY + fontSize * 1.2; // Position below image with more space

                albumElements.forEach((elem, i) => {
                    // Spread from left edge to right edge of image (albums evenly distributed)
                    const x = textStartX + (i / (albums.length - 1)) * (imageWidth - albumSize);
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
                    showSite();
                    return; // Stop the loop after site is shown
                }
            }
        }

        // Backdrop image revealed by erasing: clouds.png with transparency preserved
        const minSide = Math.min(state.size.w, state.size.h);
        const fontSize = Math.floor(minSide * 0.22);

        // Draw the clouds image if loaded
        if (cloudsImage.complete && cloudsImage.naturalWidth > 0) {
            const imageHeight = fontSize;
            const imageWidth = (cloudsImage.naturalWidth / cloudsImage.naturalHeight) * imageHeight;
            const x = state.size.w / 2 - imageWidth / 2;
            const y = state.size.h / 2 - textYOffset - imageHeight / 2;
            ctx.drawImage(cloudsImage, x, y, imageWidth, imageHeight);
        }

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
            if (revealPct >= 0.95) {
                isRevealed = true;
            }
        }

        // Re-ink only when idle, so revealed text persists while moving
        // Also apply during jiggle cycle when not actively jiggling
        const reinkCondition = (hasInteracted || postJigglePause > 0 || idleTime > 0) && !isRevealed;

        if (reinkCondition) {
            // Skip expensive pixel processing while actively erasing for smoother mobile performance
            if (!isActive) {
                // Check for pixels that need to fade
                const now = Date.now();
                const fadeDelay = 3000; // 4 seconds after last reveal
                const fadeDuration = 4500; // Fade over 6 seconds

                // Calculate fade rate from duration (opacity units per second)
                const fadeRate = 255 / (fadeDuration / 1000);

                // Get timestamp and ink data
                const tsData = timestampCtx.getImageData(0, 0, timestampCanvas.width, timestampCanvas.height);
                const tsPixels = tsData.data;
                const inkData = inkCtx.getImageData(0, 0, inkCanvas.width, inkCanvas.height);
                const inkPixels = inkData.data;

                let anyFading = false;

                for (let i = 0; i < tsPixels.length; i += 4) {
                    // Skip fully opaque pixels for performance
                    if (inkPixels[i + 3] === 255) continue;

                    // Decode 32-bit timestamp from RGBA (in milliseconds)
                    const timestamp = (tsPixels[i] << 24) | (tsPixels[i + 1] << 16) | (tsPixels[i + 2] << 8) | tsPixels[i + 3];

                    if (timestamp > 0) {
                        const timeSinceReveal = now - timestamp;

                        if (timeSinceReveal > fadeDelay) {
                            anyFading = true;
                            // Calculate fade progress for this pixel
                            const fadeTime = timeSinceReveal - fadeDelay;
                            const fadeProgress = Math.min(1.0, fadeTime / fadeDuration);

                            // Quadratic easing for acceleration
                            const easedProgress = fadeProgress * fadeProgress;

                            // Target opacity (0 = transparent, 255 = black)
                            const targetAlpha = Math.floor(easedProgress * 255);

                            // Gradually increase alpha towards target (fade back to black)
                            if (inkPixels[i + 3] < targetAlpha) {
                                inkPixels[i + 3] = Math.min(255, inkPixels[i + 3] + Math.ceil(dt * fadeRate));
                            }
                        }
                    }
                }

                if (anyFading) {
                    inkCtx.putImageData(inkData, 0, 0);
                }
            }

            // Track idle time for full reset
            if (isActive || jiggleActive) {
                inkAccumulator = 0;
            } else {
                inkAccumulator += dt;

                // Full reset after sufficient idle time
                if (inkAccumulator > 4.5 && inkAccumulator < 4.6) {
                    inkCtx.globalAlpha = 1;
                    inkCtx.fillStyle = '#000';
                    inkCtx.fillRect(0, 0, state.size.w, state.size.h);
                    timestampCtx.fillStyle = '#000';
                    timestampCtx.fillRect(0, 0, state.size.w, state.size.h);
                    inkAccumulator = 0;
                }
            }
        }

        // Don't re-ink during jiggle animation (allow text to be revealed)
        if (jiggleActive && !hasInteracted) {
            inkAccumulator = 0; // Keep accumulator at zero during jiggle
        }

        if (hasInteracted && isActive && !isRevealed) {
            // Soft-edge circular brush with radius based on speed
            const base = player.size * 0.55; // base brush size
            const maxScreenRadius = Math.min(state.size.w, state.size.h) * 0.15; // max radius cap
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

            // Record timestamp when this pixel was revealed (encode 32-bit timestamp in RGBA)
            // Use destination-over so we only write to pixels that don't already have a timestamp
            const now = Date.now();
            const r = (now >>> 24) & 0xFF;
            const g_val = (now >>> 16) & 0xFF;
            const b = (now >>> 8) & 0xFF;
            const a = now & 0xFF;
            timestampCtx.globalCompositeOperation = 'destination-over'; // Don't overwrite existing timestamps
            timestampCtx.fillStyle = `rgba(${r},${g_val},${b},${a / 255})`;
            timestampCtx.beginPath();
            timestampCtx.arc(player.pos.x, player.pos.y, radius, 0, Math.PI * 2);
            timestampCtx.fill();
            timestampCtx.globalCompositeOperation = 'source-over';
        }

        // Erase during jiggle animation (player is actually moving)
        if (jiggleActive && !hasInteracted && !isRevealed) {
            const base = player.size * 0.55;
            const radius = Math.max(22, base);

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

            // Record timestamp (only for newly revealed pixels)
            const now = Date.now();
            const r = (now >>> 24) & 0xFF;
            const g_val = (now >>> 16) & 0xFF;
            const b = (now >>> 8) & 0xFF;
            const a = now & 0xFF;
            timestampCtx.globalCompositeOperation = 'destination-over';
            timestampCtx.fillStyle = `rgba(${r},${g_val},${b},${a / 255})`;
            timestampCtx.beginPath();
            timestampCtx.arc(player.pos.x, player.pos.y, radius, 0, Math.PI * 2);
            timestampCtx.fill();
            timestampCtx.globalCompositeOperation = 'source-over';
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
    // requestAnimationFrame(loop); // temporarily disabled — go straight to site
    showSite();

    function showSite() {
        // Hide game elements
        canvas.style.display = 'none';
        albumContainer.style.display = 'none';
        playerContainer.style.display = 'none';

        // Build album grid
        const musicSection = document.getElementById('section-music');
        const grid = document.createElement('div');
        grid.className = 'album-grid';
        albums.forEach(album => {
            const item = document.createElement('a');
            item.href = album.url;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
            item.className = 'album-item';

            const img = document.createElement('img');
            img.src = album.artUrl;
            img.alt = album.title;
            img.draggable = false;

            const title = document.createElement('span');
            title.className = 'album-title';
            title.textContent = album.title;

            item.appendChild(img);
            item.appendChild(title);
            grid.appendChild(item);
        });
        musicSection.appendChild(grid);

        // Build merch grid
        const merchSection = document.getElementById('section-merch');
        merchSection.innerHTML = '';
        const merchGrid = document.createElement('div');
        merchGrid.className = 'merch-grid';
        merch.forEach(item => {
            const card = document.createElement('div');
            card.className = 'merch-card';

            const imgWrap = document.createElement('a');
            imgWrap.className = 'merch-img';
            imgWrap.href = item.url;
            imgWrap.target = '_blank';
            imgWrap.rel = 'noopener noreferrer';
            if (item.imageUrl) {
                const img = document.createElement('img');
                img.src = item.imageUrl;
                img.alt = item.name;
                img.draggable = false;
                imgWrap.appendChild(img);
            }

            const name = document.createElement('span');
            name.className = 'merch-name';
            if (item.uppercase) name.style.textTransform = 'uppercase';
            name.textContent = item.name;

            const desc = document.createElement('span');
            desc.className = 'merch-desc';
            desc.textContent = item.description || '';
            if (!item.description) desc.style.display = 'none';

            const price = document.createElement('span');
            price.className = 'merch-price';
            price.textContent = item.price;

            const cta = document.createElement('a');
            cta.href = item.url;
            cta.target = '_blank';
            cta.rel = 'noopener noreferrer';
            cta.className = 'merch-cta';
            cta.textContent = 'BUY →';

            card.appendChild(imgWrap);
            card.appendChild(name);
            card.appendChild(desc);
            card.appendChild(price);
            card.appendChild(cta);
            merchGrid.appendChild(card);
        });
        merchSection.appendChild(merchGrid);

        // Fade site in
        const site = document.getElementById('site');
        site.classList.remove('hidden');
        requestAnimationFrame(() => site.classList.add('visible'));

        // Nav section switching
        const navLinks = site.querySelectorAll('[data-section]');
        const sections = site.querySelectorAll('.site-section');

        function showSection(name, pushState = true) {
            sections.forEach(s => {
                const isTarget = s.id === 'section-' + name;
                s.classList.toggle('hidden', !isTarget);
                if (isTarget) {
                    s.classList.remove('fadein');
                    void s.offsetWidth; // force reflow to restart animation
                    s.classList.add('fadein');
                }
            });
            navLinks.forEach(a => a.classList.toggle('active', a.dataset.section === name));

            // Only allow scrolling on sections that need it; home must stay locked
            const scrollableSections = ['music', 'merch'];
            site.classList.toggle('scrollable', scrollableSections.includes(name));
            site.scrollTop = 0; // reset scroll position when switching sections

            // Update URL hash; home gets a clean URL with no hash
            if (pushState) {
                const hash = name === 'home' ? '' : '#' + name;
                history.pushState({ section: name }, '', location.pathname + hash);
            }
        }

        navLinks.forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                showSection(link.dataset.section);
            });
        });

        // Back/forward button support
        window.addEventListener('popstate', (e) => {
            const name = (e.state && e.state.section) || 'home';
            showSection(name, false);
        });

        // Respect hash on initial load (e.g. direct link to /#music)
        const validSections = ['home', 'music', 'merch'];
        const initialHash = location.hash.replace('#', '');
        const initialSection = validSections.includes(initialHash) ? initialHash : 'home';
        // Replace current history entry so popstate has a state object
        history.replaceState({ section: initialSection }, '', location.pathname + (initialSection === 'home' ? '' : '#' + initialSection));
        showSection(initialSection, false);
        const scooter = initScooter();
        initSpinner(scooter);
    }

    /** Flying bird (Scooter) that occasionally crosses the home section. */
    function initScooter() {
        const homeSection = document.getElementById('section-home');
        if (!homeSection) return;

        const birdImg = document.createElement('img');
        birdImg.src = 'scooter.png';
        birdImg.alt = '';
        birdImg.draggable = false;
        const HIT_PAD = 12; // px of invisible padding around the bird for easier tapping
        birdImg.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1;
            opacity: 0;
            will-change: transform, opacity;
            user-select: none;
            -webkit-user-drag: none;
            padding: ${HIT_PAD}px;
            box-sizing: content-box;
        `;
        document.getElementById('site').appendChild(birdImg);

        // Barf that hits the bird sticks to him until his next flight. This layer
        // copies his transform and is masked to his silhouette.
        const gunk = document.createElement('div');
        gunk.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 1;
            opacity: 0;
            will-change: transform, opacity;
            -webkit-mask-image: url(scooter.png);
            mask-image: url(scooter.png);
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
        `;
        document.getElementById('site').appendChild(gunk);
        const MAX_GUNK = 90; // globs, 3 per hit

        // Low-res alpha map of the sprite, so barf only hits where he actually is
        let alphaMap = null;

        function addGlob(u, v, size, color, drip) {
            const glob = document.createElement('div');
            glob.style.cssText = `
                position: absolute;
                left: ${HIT_PAD + u - size}px;
                top: ${HIT_PAD + v - size}px;
                width: ${size * 2}px;
                height: ${size * 2 * drip}px;
                background: ${color};
                border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
            `;
            gunk.appendChild(glob);
        }
        function buildAlphaMap() {
            if (!birdImg.naturalWidth) return;
            const w = 120;
            const h = Math.round(w * birdImg.naturalHeight / birdImg.naturalWidth);
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const cctx = c.getContext('2d');
            cctx.drawImage(birdImg, 0, 0, w, h);
            alphaMap = { data: cctx.getImageData(0, 0, w, h).data, w, h };
        }
        if (birdImg.complete) buildAlphaMap();
        else birdImg.addEventListener('load', buildAlphaMap);

        // Where the bird is right now (null when he's off screen)
        let flight = null;

        // Speech bubble for when the bird is tapped
        const quips = [
            "Hey, I'm zoomin' here!",
            "Knock it off!",
            "Yank out your yen!",
            "Scoot scoot, baby!",
            "There goes my Tum Tum chicken!",
            "Buy some merch, dummy!",
            "Don't you have somewhere to be?",
            "www.fngrnctr.biz",
            "Find my parents, their names are Fanny and Jimbo. Please!"
        ];
        const bubble = document.createElement('div');
        bubble.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 6;
            color: #E29755;
            font: bold 13px/1.3 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            max-width: 140px;
            text-align: center;
            opacity: 0;
            transition: opacity 0.4s ease, transform 0.6s ease;
        `;
        document.getElementById('site').appendChild(bubble);

        // What he says when he gets barfed on
        const barfQuips = [
            "Bro, wtf!!",
            "No!!",
            "Not again!",
            "Better out than in!",
            "My feathers!",
            "I just got these washed!",
            "Say it, don't spray it!",
            "Ugh, it's in my beak!",
            "Is that Tum Tum chicken?!",
            "I'm zoomin' here, not a puke bucket!",
        ];
        let lastBarfQuipIndex = -1;

        let bubbleTimer = null;
        let lastQuipIndex = -1;
        function showBubble(x, y, text) {
            clearTimeout(bubbleTimer);
            if (text) {
                bubble.textContent = text;
            } else {
                let idx;
                do { idx = Math.floor(Math.random() * quips.length); } while (idx === lastQuipIndex && quips.length > 1);
                lastQuipIndex = idx;
                bubble.textContent = quips[idx];
            }
            // Reset transition so it appears instantly at click point
            bubble.style.transition = 'none';
            bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
            bubble.style.opacity = '1';
            // Force reflow, then animate upward and fade
            void bubble.offsetWidth;
            bubble.style.transition = 'opacity 0.4s ease, transform 0.6s ease';
            bubble.style.transform = `translate(${x}px, ${y - 30}px) translate(-50%, -50%)`;
            bubbleTimer = setTimeout(() => {
                bubble.style.opacity = '0';
            }, 1500); // long enough to read
        }

        birdImg.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            showBubble(e.clientX, e.clientY);
        });

        // Size the bird to ~10% of the hero image dimensions
        function getBirdSize() {
            const heroW = Math.min(480, window.innerWidth * 0.8);
            return Math.round(heroW * 0.10);
        }

        let flyTimeout = null;

        function scheduleFlight() {
            // Random interval between 6–10 seconds
            const delay = (6 + Math.random() * 4) * 1000;
            flyTimeout = setTimeout(fly, delay);
        }

        /** `target` (optional): { x, inMs } — time the flight to cross screen x after inMs. */
        function fly(target) {
            // Only fly when home section is visible
            const homeVisible = !homeSection.classList.contains('hidden');
            if (!homeVisible) { scheduleFlight(); return; }

            const birdSize = getBirdSize();
            const birdH = birdSize * 0.38; // aspect ratio of the image ~2.6:1
            birdImg.style.width = birdSize + 'px';
            birdImg.style.height = 'auto';

            // Fresh flight, clean bird
            const spriteH = birdSize * birdImg.naturalHeight / (birdImg.naturalWidth || 1);
            gunk.replaceChildren();
            gunk.style.width = (birdSize + 2 * HIT_PAD) + 'px';
            gunk.style.height = (spriteH + 2 * HIT_PAD) + 'px';
            gunk.style.webkitMaskSize = gunk.style.maskSize = `${birdSize}px ${spriteH}px`;
            gunk.style.webkitMaskPosition = gunk.style.maskPosition = `${HIT_PAD}px ${HIT_PAD}px`;

            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Pick direction: left-to-right or right-to-left
            let goingRight = Math.random() > 0.5;

            // Flight duration: usually 10–14s, ~10% chance of a fast zip (4–6s)
            let isFast = Math.random() < 0.10;
            let duration = isFast
                ? 4000 + Math.random() * 2000
                : 10000 + Math.random() * 4000;

            if (target) {
                // Come from a random side, as long as the speed it needs looks like a normal flight
                const plans = [true, false].map(right => {
                    const sx = right ? -birdSize - 20 : vw + 20;
                    const ex = right ? vw + 20 : -birdSize - 20;
                    const frac = (target.x - birdSize / 2 - sx) / (ex - sx);
                    return { right, duration: target.inMs / frac };
                }).filter(p => p.duration >= 3000 && p.duration <= 20000);
                if (plans.length) {
                    const plan = plans[Math.floor(Math.random() * plans.length)];
                    goingRight = plan.right;
                    duration = plan.duration;
                    isFast = duration < 7000;
                }
            }

            // The bird image faces right, so flip when going left
            const scaleX = goingRight ? 1 : -1;

            const startX = goingRight ? -birdSize - 20 : vw + 20;
            const endX = goingRight ? vw + 20 : -birdSize - 20;

            // Fly low to the ground — bottom 15% of the page
            const minY = vh * 0.85;
            const maxY = vh * 0.95;
            const baseY = minY + Math.random() * (maxY - minY);

            // Gentle sine wave parameters for bobbing (minimal when fast)
            const bobAmp = isFast ? 3 + Math.random() * 4 : 15 + Math.random() * 25; // px
            const bobFreq = isFast ? 0.5 + Math.random() * 0.5 : 1.5 + Math.random() * 1.5; // full waves during flight
            // Slight diagonal drift
            const driftY = (Math.random() - 0.5) * vh * 0.15;

            let startTime = null;

            function animate(ts) {
                if (!startTime) startTime = ts;
                const elapsed = ts - startTime;
                const t = Math.min(elapsed / duration, 1);

                // Ease: slight acceleration then deceleration
                const eased = t;

                const x = startX + (endX - startX) * eased;
                const bob = Math.sin(t * bobFreq * Math.PI * 2) * bobAmp;
                const y = baseY + driftY * t + bob;

                // Fade in/out at edges
                let opacity = 1;
                if (t < 0.08) opacity = t / 0.08;
                else if (t > 0.92) opacity = (1 - t) / 0.08;

                // Slight wing-flap rotation
                const flapAngle = Math.sin(ts / 120) * 4; // degrees

                const transform = `translate(${x - HIT_PAD}px, ${y - HIT_PAD}px) scaleX(${scaleX}) rotate(${flapAngle}deg)`;
                birdImg.style.transform = transform;
                birdImg.style.opacity = opacity;
                gunk.style.transform = transform;
                gunk.style.opacity = opacity;
                flight = { ...flight, x, y, w: birdSize, h: spriteH, scaleX, flapAngle, opacity };

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    birdImg.style.opacity = 0;
                    gunk.style.opacity = 0;
                    flight = null;
                    birdImg.style.pointerEvents = 'none';
                    scheduleFlight();
                }
            }

            birdImg.style.pointerEvents = 'auto';
            requestAnimationFrame(animate);
        }

        /**
         * Called by the barf for each falling drop. If it hits the bird, the drop
         * sticks to him and this returns true so the barf stops drawing it.
         */
        function catchBarf(x, y, r, color) {
            if (!flight || !alphaMap || flight.opacity < 0.3) return false;
            const { w, h } = flight;
            // Undo the flight transform (flip, then flap) to get a point on the sprite
            const dx = (x - (flight.x + w / 2)) * flight.scaleX;
            const dy = y - (flight.y + h / 2);
            const a = -flight.flapAngle * Math.PI / 180;
            const cu = dx * Math.cos(a) - dy * Math.sin(a) + w / 2;
            const cv = dx * Math.sin(a) + dy * Math.cos(a) + h / 2;
            if (cu < -r || cv < -r || cu >= w + r || cv >= h + r) return false;

            // Hit if any part of the drop touches him: try its centre, then its edges
            const solid = (u, v) => {
                if (u < 0 || v < 0 || u >= w || v >= h) return false;
                const ai = Math.floor(u / w * alphaMap.w);
                const aj = Math.floor(v / h * alphaMap.h);
                return alphaMap.data[(aj * alphaMap.w + ai) * 4 + 3] >= 128;
            };
            const hit = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]
                .map(([ox, oy]) => [cu + ox, cv + oy])
                .find(([u, v]) => solid(u, v));
            if (!hit) return false;
            const [u, v] = hit;

            // A splat plus a couple of spatters, big enough to read on a small bird
            if (gunk.childElementCount < MAX_GUNK) {
                const size = Math.max(2.5, r * 0.6);
                addGlob(u, v, size, color, 1 + Math.random() * 0.8); // some globs sag into drips
                for (let i = 0; i < 2; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    const dist = size * (1.2 + Math.random());
                    addGlob(u + Math.cos(ang) * dist, v + Math.sin(ang) * dist, size * 0.45, color, 1);
                }
            }
            if (!flight.hit) {
                flight.hit = true;
                let idx;
                do { idx = Math.floor(Math.random() * barfQuips.length); } while (idx === lastBarfQuipIndex);
                lastBarfQuipIndex = idx;
                showBubble(flight.x + w / 2, flight.y - 12, barfQuips[idx]);
            }
            return true;
        }

        /** Barf is about to fall at screen x: if he's not already out, send him through it. */
        function callIn(x, inMs) {
            if (flight || homeSection.classList.contains('hidden')) return;
            clearTimeout(flyTimeout);
            fly({ x, inMs });
        }

        // First flight after a short delay
        flyTimeout = setTimeout(fly, 3000 + Math.random() * 2000);

        return { catchBarf, callIn };
    }

    /** Fidget-spinner physics for the home hero image. */
    function initSpinner(scooter) {
        const wrap = document.querySelector('.spinner-wrap');
        if (!wrap) return;
        const rotor = wrap.querySelector('.spinner-rotor');

        // ── State ────────────────────────────────────────────────────────────
        let angle = 0;       // current rotation, radians
        let angularVel = 0;       // radians per millisecond
        let isDragging = false;
        let lastAngle = 0;       // pointer angle on last move
        let lastMoveTime = 0;
        let rafId = null;
        let lastFrameTime = null;

        // Friction: velocity decays to this fraction each second.
        // Lower = more resistance. Range guide:
        //   0.80 → light / floaty   (~12 s coast)
        //   0.55 → medium           (~6 s coast)
        //   0.25 → heavy / grippy   (~2 s coast)
        //   0.10 → nearly instant stop
        const FRICTION_PER_SEC = 0.45;
        const MIN_VEL = 0.00005; // rad/ms — below this we stop the loop

        // ── Helpers ──────────────────────────────────────────────────────────
        function centerOf() {
            const r = wrap.getBoundingClientRect();
            return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
        }

        function pointerAngle(e) {
            const c = centerOf();
            return Math.atan2(e.clientY - c.y, e.clientX - c.x);
        }

        /** Shortest signed angular difference a→b, range (−π, π]. */
        function deltaAngle(a, b) {
            let d = b - a;
            if (d > Math.PI) d -= 2 * Math.PI;
            if (d < -Math.PI) d += 2 * Math.PI;
            return d;
        }

        function applyTransform() {
            const s = barf.shake;
            rotor.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${angle + s.rot}rad) scale(${s.scale})`;
        }

        const barf = initBarf(wrap, rotor, {
            getAngle: () => angle,
            getAngularVel: () => angularVel,
            applyTransform,
            settle,
            unlock: () => { locked = false; },
        }, scooter);

        // ── Settling (while barfing) ─────────────────────────────────────────
        // A critically damped spring brakes the spin and returns the hero upright.
        const SETTLE_RATE = 0.004; // natural frequency, rad/ms (~1.6 s to settle)
        let locked = false;        // ignore input while the face is barfing
        let settleTarget = 0;
        let onSettled = null;

        function settle(done) {
            locked = true;
            onSettled = done;
            isDragging = false;
            wrap.classList.remove('grabbing');
            // Aim for the upright position nearest where the spin would naturally stop
            const TWO_PI = 2 * Math.PI;
            settleTarget = Math.round((angle + angularVel / SETTLE_RATE) / TWO_PI) * TWO_PI;
            startLoop();
        }

        function settleStep(dt) {
            const k = SETTLE_RATE * SETTLE_RATE;
            angularVel += (-k * (angle - settleTarget) - 2 * SETTLE_RATE * angularVel) * dt;
            angle += angularVel * dt;
            const done = Math.abs(angle - settleTarget) < 0.01 && Math.abs(angularVel) < 0.001;
            if (done) { angle = 0; angularVel = 0; }
            return !done;
        }

        // ── Animation loop (free spin) ───────────────────────────────────────
        function tick(ts) {
            if (lastFrameTime === null) lastFrameTime = ts;
            const dt = Math.min(ts - lastFrameTime, 64); // cap to avoid huge jumps
            lastFrameTime = ts;

            if (locked) {
                const moving = settleStep(dt);
                applyTransform();
                rafId = moving ? requestAnimationFrame(tick) : null;
                if (!moving && onSettled) { const done = onSettled; onSettled = null; done(); }
                return;
            }

            angularVel *= Math.pow(FRICTION_PER_SEC, dt / 1000);

            if (Math.abs(angularVel) < MIN_VEL) {
                angularVel = 0;
                rafId = null;
                return; // stop the loop — no waste
            }

            const step = angularVel * dt;
            angle += step;
            barf.addSpin(step);
            applyTransform();
            rafId = requestAnimationFrame(tick);
        }

        function startLoop() {
            if (rafId) return;
            lastFrameTime = null;
            rafId = requestAnimationFrame(tick);
        }

        // ── Pointer events ───────────────────────────────────────────────────
        wrap.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.button !== undefined) return; // left-click / touch only
            if (locked) return;
            wrap.setPointerCapture(e.pointerId);
            isDragging = true;
            lastAngle = pointerAngle(e);
            lastMoveTime = e.timeStamp;
            angularVel = 0; // finger grabs and momentarily stops it — realistic!
            // Cancel free-spin loop while dragging (we'll update synchronously in pointermove)
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            wrap.classList.add('grabbing');
            e.preventDefault();
        }, { passive: false });

        wrap.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const now = e.timeStamp;
            const curr = pointerAngle(e);
            const delta = deltaAngle(lastAngle, curr);
            const dt = Math.max(now - lastMoveTime, 1);

            // Image follows finger exactly — no interpolation lag.
            angle += delta;
            barf.addSpin(delta);
            applyTransform();

            // Running angular velocity — used for release flick.
            // Blend 70 % new sample + 30 % old to smooth single-frame noise.
            angularVel = delta / dt * 0.7 + angularVel * 0.3;

            lastAngle = curr;
            lastMoveTime = now;
            e.preventDefault();
        }, { passive: false });

        function onRelease(e) {
            if (!isDragging) return;
            isDragging = false;
            wrap.classList.remove('grabbing');
            // If the pointer was stationary for >120 ms before release, kill velocity.
            if (e.timeStamp - lastMoveTime > 120) angularVel = 0;
            if (Math.abs(angularVel) > MIN_VEL) startLoop();
        }

        wrap.addEventListener('pointerup', onRelease);
        wrap.addEventListener('pointercancel', onRelease);
    }

    /**
     * Barf easter egg: spin the hero enough and the face in the "N" turns green,
     * gags, then barfs. Returns hooks the spinner calls on every rotation step.
     */
    function initBarf(wrap, rotor, spinner, scooter) {
        const gagFace = rotor.querySelector('[data-face="gag"]');
        const heaveFace = rotor.querySelector('[data-face="heave"]');
        const tint = rotor.querySelector('.face-tint');
        const homeSection = document.getElementById('section-home');

        // Mouth in the heave face, as fractions of the hero image's width/height
        const MOUTH = { x: 0.1151, y: 0.754, w: 0.04 };

        // Nausea is measured in revolutions and slowly drains on its own.
        const BARF_AT = 3;          // revolutions of built-up nausea before barfing
        const DRAIN_PER_SEC = 0.025;  // revolutions/sec of recovery
        const TINT_FROM = 0.35;     // fraction of BARF_AT where the face starts going green
        const GAG_MS = 1800;          // anticipation shudder once upright, before the first heave
        const SCOOTER_ARRIVE_MS = 5000; // after triggering: brake + shudder + ~1.5 s of barf
        const SCOOTER_CALL_CHANCE = 0.1; // how often a barf sends Scooter through it
        const SCOOTER_FIRST_CALL_AT = 3;  // the first couple of barfs are always Scooter-free
        // Barfing comes in heaves: [start ms, duration ms, strength]
        const HEAVES = [[0, 700, 1], [1000, 450, 0.6], [1650, 950, 1], [2900, 800, 0.8], [3900, 500, 0.5]];
        const HEAVE_TOTAL_MS = 5000;
        const COOLDOWN_MS = 3000;
        const DROPS_PER_MS = 0.35;  // at full heave strength
        const GRAVITY = 0.0022;     // px/ms²
        // Rocking: the heaves are violent enough to sway the whole hero
        const ROCK_AMP = 0.12;       // radians at full heave strength
        const ROCK_PERIOD_MS = 450;
        // Pile: a heightfield along the bottom of the screen that drops land on
        const PILE_CELL = 4;         // px per pile column
        const PILE_VOLUME = 0.12;    // share of each drop's area that ends up in the pile
        const PILE_SLUMP = 0.2;     // how fast the pile spreads sideways (per 60fps frame, ≤ 0.4)
        const PILE_HOLD_MS = 3000;   // pile sits this long after the last drop lands…
        const PILE_DRAIN_MS = 700;   // …then sinks away with this time constant
        const MAX_CHUNKS = 600;
        const COLORS = ['#a3b83a', '#c9c24b', '#8a9e2f', '#d9cf7a', '#b9a640', '#7c8f2a'];

        const canvas = document.createElement('canvas');
        canvas.className = 'barf-canvas';
        document.getElementById('site').appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let dpr = 1;
        function resizeCanvas() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(window.innerWidth * dpr);
            canvas.height = Math.round(window.innerHeight * dpr);
            const next = new Float32Array(Math.ceil(window.innerWidth / PILE_CELL) + 1);
            next.set(pile.subarray(0, next.length));
            pile = next;
        }

        // ── State ────────────────────────────────────────────────────────────
        let nausea = 0;           // revolutions
        let barfCount = 0;        // barfs triggered this page load
        let tintLevel = 0;        // 0–1, eased toward its target
        let phase = 'idle';       // idle → settle → gag → heave → idle
        let phaseStart = 0;
        let cooldownUntil = 0;
        let emitCarry = 0;        // fractional drops left over between frames
        let rockEnv = 0;          // eased heave strength driving the rocking
        let rockPhase = 0;
        let drops = [];
        let pile = new Float32Array(0);
        let chunks = [];          // lumps sitting in the pile: { x, hy, w, h, color }
        let lastLandAt = 0;
        let rafId = null;
        let lastTs = null;
        const shake = { x: 0, y: 0, scale: 1, rot: 0 };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        function setPhase(name) {
            phase = name;
            phaseStart = performance.now();
            // Keep the gag face under the heave face so the crossfade never flashes the original
            gagFace.classList.toggle('show', name === 'gag' || name === 'heave');
            heaveFace.classList.toggle('show', name === 'heave');
        }

        function addSpin(deltaRad) {
            if (phase !== 'idle' || performance.now() < cooldownUntil) return;
            nausea += Math.abs(deltaRad) / (2 * Math.PI);
            if (nausea >= BARF_AT) {
                // Brake back upright first, then gag, then barf
                setPhase('settle');
                spinner.settle(() => setPhase('gag'));
                barfCount++;
                // Sometimes send Scooter flying through where the barf will land (mouth x once upright)
                if (scooter && barfCount >= SCOOTER_FIRST_CALL_AT && Math.random() < SCOOTER_CALL_CHANCE) {
                    const r = wrap.getBoundingClientRect();
                    const mouthX = r.left + r.width / 2 + (MOUTH.x - 0.5) * rotor.offsetWidth;
                    scooter.callIn(mouthX, SCOOTER_ARRIVE_MS);
                }
            }
            start();
        }

        // ── Particles ────────────────────────────────────────────────────────
        function spawn(count, strength) {
            const angle = spinner.getAngle();
            const omega = spinner.getAngularVel();
            const r = wrap.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const w = rotor.offsetWidth;
            const h = rotor.offsetHeight;
            const sizeScale = w / 480;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            for (let i = 0; i < count; i++) {
                // Point across the mouth, in image space relative to the hero's centre
                const lx = (MOUTH.x + (Math.random() - 0.5) * MOUTH.w - 0.5) * w;
                const ly = (MOUTH.y - 0.5) * h;
                const ox = lx * cos - ly * sin;
                const oy = lx * sin + ly * cos;

                // Out of the mouth: mostly "down" in image space, fanned out a bit
                const vlx = (Math.random() - 0.5) * 0.25 * strength;
                const vly = (0.08 + Math.random() * 0.22) * strength;
                // Plus the spin's tangential velocity, so a spinning face sprays like a sprinkler
                const fling = 0.45;
                const x = cx + ox;
                const y = cy + oy;
                drops.push({
                    x, y, px: x, py: y,
                    vx: vlx * cos - vly * sin - omega * oy * fling,
                    vy: vlx * sin + vly * cos + omega * ox * fling,
                    r0: (1 + Math.random() * 1.5) * sizeScale,
                    r1: (2.5 + Math.random() * 4.5) * sizeScale,
                    age: 0,
                    color: COLORS[(Math.random() * COLORS.length) | 0],
                    droplet: false,
                });
            }
        }

        function pileAt(x) {
            const i = clamp(Math.round(x / PILE_CELL), 0, pile.length - 1);
            return pile[i] || 0;
        }

        function land(d, now) {
            if (d.droplet) return;
            const size = d.r1;
            const surface = pileAt(d.x);
            // Spread the drop's volume over a few columns with a triangular falloff
            const area = Math.PI * size * size * PILE_VOLUME;
            const reach = Math.max(2, Math.round(size * 2 / PILE_CELL));
            const centre = Math.round(d.x / PILE_CELL);
            const total = reach * reach; // sum of triangle weights
            for (let k = -reach + 1; k < reach; k++) {
                const i = centre + k;
                if (i < 0 || i >= pile.length) continue;
                pile[i] += area * (reach - Math.abs(k)) / total / PILE_CELL;
            }
            chunks.push({
                x: d.x,
                hy: surface,
                w: size * (1.2 + Math.random()),
                h: size * (0.5 + Math.random() * 0.4),
                color: d.color,
            });
            if (chunks.length > MAX_CHUNKS) chunks.shift();
            lastLandAt = now;
            // A couple of small droplets bounce off the floor
            if (Math.random() < 0.3) {
                for (let i = 0; i < 2; i++) {
                    drops.push({
                        x: d.x, y: d.y, px: d.x, py: d.y,
                        vx: (Math.random() - 0.5) * 0.3,
                        vy: -(0.15 + Math.random() * 0.25),
                        r0: size * 0.35, r1: size * 0.35,
                        age: 1000,
                        color: d.color,
                        droplet: true,
                    });
                }
            }
        }

        function heaveStrength(t) {
            let s = 0;
            for (const [at, dur, strength] of HEAVES) {
                if (t >= at && t < at + dur) s = Math.max(s, strength * Math.sin(Math.PI * (t - at) / dur));
            }
            return s;
        }

        function updatePile(dt, now) {
            // Slump: the pile spreads out sideways like a thick liquid
            const f = Math.min(PILE_SLUMP * dt / 16, 0.4);
            let prev = pile[0];
            for (let i = 1; i < pile.length - 1; i++) {
                const cur = pile[i];
                pile[i] = cur + f * (prev + pile[i + 1] - 2 * cur);
                prev = cur;
            }
            // After a while with nothing landing, it drains away into the floor
            if (now - lastLandAt > PILE_HOLD_MS) {
                const k = Math.exp(-dt / PILE_DRAIN_MS);
                let max = 0;
                for (let i = 0; i < pile.length; i++) {
                    pile[i] *= k;
                    if (pile[i] > max) max = pile[i];
                }
                if (max < 0.3) { pile.fill(0); chunks = []; }
            }
        }

        function pileIsEmpty() {
            return chunks.length === 0 && !pile.some(h => h > 0.3);
        }

        // ── Loop ─────────────────────────────────────────────────────────────
        function frame(ts) {
            if (lastTs === null) lastTs = ts;
            const dt = Math.min(ts - lastTs, 64);
            lastTs = ts;
            const now = performance.now();
            const t = now - phaseStart;
            const sizeScale = rotor.offsetWidth / 480;

            shake.x = 0; shake.y = 0; shake.scale = 1;
            let tintTarget = 0;
            let rockDrive = 0;    // 0–1, how hard the hero rocks this frame

            if (phase === 'idle') {
                nausea = Math.max(0, nausea - DRAIN_PER_SEC * dt / 1000);
                tintTarget = clamp((nausea / BARF_AT - TINT_FROM) / (1 - TINT_FROM), 0, 1);
            } else if (phase === 'settle') {
                tintTarget = 1;
            } else if (phase === 'gag') {
                tintTarget = 1;
                // Slight shudder that builds: something's about to happen
                const amp = 1.5 * sizeScale * (1 + 2.5 * (t / GAG_MS));
                shake.x = (Math.random() - 0.5) * amp;
                shake.y = (Math.random() - 0.5) * amp;
                // …with a gentle wobble that grows toward the heave's bigger rocking
                rockDrive = 0.15 + 0.3 * (t / GAG_MS);
                if (t >= GAG_MS) setPhase('heave');
            } else if (phase === 'heave') {
                tintTarget = 1;
                const s = heaveStrength(t);
                rockDrive = s;
                shake.scale = 1 + 0.025 * s;
                shake.y = -3 * sizeScale * s;
                emitCarry += DROPS_PER_MS * s * dt;
                const n = Math.floor(emitCarry);
                emitCarry -= n;
                if (n > 0) spawn(n, 0.6 + 0.6 * s);
                if (t >= HEAVE_TOTAL_MS) {
                    nausea = 0;
                    emitCarry = 0;
                    cooldownUntil = now + COOLDOWN_MS;
                    setPhase('idle');
                    spinner.unlock();
                }
            }

            // Rocking follows the heaves, lingering a little between them
            rockEnv += (rockDrive - rockEnv) * (1 - Math.exp(-dt / 220));
            rockPhase += dt / ROCK_PERIOD_MS * 2 * Math.PI;
            shake.rot = ROCK_AMP * rockEnv * Math.sin(rockPhase);

            tintLevel += (tintTarget - tintLevel) * (1 - Math.exp(-dt / 250));
            tint.style.opacity = (tintLevel * 0.5).toFixed(3);
            spinner.applyTransform();

            // Don't let barf spill onto the other sections
            if (homeSection.classList.contains('hidden')) { drops = []; chunks = []; pile.fill(0); }

            const floor = window.innerHeight;
            const width = window.innerWidth;
            for (const d of drops) {
                d.px = d.x; d.py = d.y;
                d.vy += GRAVITY * dt;
                d.x += d.vx * dt;
                d.y += d.vy * dt;
                d.age += dt;
            }
            // Barf that hits Scooter sticks to him instead of falling
            if (scooter) drops = drops.filter(d => !scooter.catchBarf(d.x, d.y, d.r1, d.color));
            const landed = d => d.y >= floor - pileAt(d.x);
            drops.filter(landed).forEach(d => land(d, now));
            drops = drops.filter(d => !landed(d) && d.x > -50 && d.x < width + 50);
            updatePile(dt, now);

            draw(now, floor);

            const settled = phase === 'idle' && nausea === 0 && tintLevel < 0.01
                && rockEnv < 0.005 && drops.length === 0 && pileIsEmpty();
            if (settled) {
                tintLevel = 0;
                tint.style.opacity = '0';
                shake.rot = 0;
                spinner.applyTransform();
                rafId = null;
                return;
            }
            rafId = requestAnimationFrame(frame);
        }

        function draw(now, floor) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            drawPile(floor);

            // Drops are drawn as short round-capped streaks so the stream reads as liquid.
            // They swell as they leave the mouth, as if coming towards the viewer.
            ctx.globalAlpha = 0.95;
            ctx.lineCap = 'round';
            for (const d of drops) {
                const grow = Math.min(d.age / 250, 1);
                ctx.strokeStyle = d.color;
                ctx.lineWidth = 2 * (d.r0 + (d.r1 - d.r0) * grow);
                ctx.beginPath();
                ctx.moveTo(d.px, d.py);
                ctx.lineTo(d.x + 0.01, d.y);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        function drawPile(floor) {
            let max = 0;
            for (let i = 0; i < pile.length; i++) if (pile[i] > max) max = pile[i];
            if (max < 0.3) return;

            ctx.beginPath();
            ctx.moveTo(0, floor);
            for (let i = 0; i < pile.length; i++) ctx.lineTo(i * PILE_CELL, floor - pile[i]);
            ctx.lineTo(canvas.width / dpr, floor);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, floor - max, 0, floor);
            grad.addColorStop(0, '#c9c24b');
            grad.addColorStop(1, '#6f8226');
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = grad;
            ctx.fill();

            // Lumps stay where they landed, but sink as the pile drains
            for (const c of chunks) {
                const y = floor - Math.min(c.hy, pileAt(c.x));
                ctx.fillStyle = c.color;
                ctx.beginPath();
                ctx.ellipse(c.x, y, c.w, c.h, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Wet highlight along the surface
            ctx.beginPath();
            for (let i = 0; i < pile.length; i++) {
                const y = floor - pile[i] + 1;
                if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * PILE_CELL, y);
            }
            ctx.strokeStyle = 'rgba(240, 235, 160, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        function start() {
            if (rafId) return;
            lastTs = null;
            rafId = requestAnimationFrame(frame);
        }

        return { addSpin, shake };
    }

    window.addEventListener('resize', () => {
        player.pos.set(
            clamp(player.pos.x, player.size / 2, state.size.w - player.size / 2),
            clamp(player.pos.y, player.size / 2, state.size.h - player.size / 2)
        );
    });
})();
