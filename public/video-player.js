/**
 * BKPlayer — Vimeo player.js–inspired HTML5 video player
 *
 * Design principles from @vimeo/player (https://github.com/vimeo/player.js):
 *  - Promise-based programmatic API  (play, pause, seek, volume, fullscreen)
 *  - Event emitter with  .on() / .off()  matching Vimeo's event names
 *  - Buffered-range overlay on the seek bar (quality-of-service indicator)
 *  - FastStart awareness: starts playback as soon as enough metadata is loaded
 *    rather than waiting for the full file (works because FFmpeg -movflags+faststart
 *    moves the moov atom to the front of the MP4)
 *
 * Supported events (mirrors Vimeo player.js):
 *   play | pause | ended | timeupdate | progress | seeking | seeked
 *   volumechange | fullscreenchange | bufferstart | bufferend
 *   qualitychange | loaded | error
 *
 * Usage:
 *   const player = new BKPlayer(containerEl, { src: 'https://…/video.mp4' });
 *   player.on('play',       ({ seconds }) => console.log('playing at', seconds));
 *   player.on('timeupdate', ({ seconds, percent }) => updateMyProgressBar(percent));
 *   player.play();
 *   player.setCurrentTime(30);
 */

// ─── Styles (injected once) ────────────────────────────────────────────────────
(function injectPlayerStyles() {
    if (document.getElementById('bk-player-styles')) return;
    const s = document.createElement('style');
    s.id = 'bk-player-styles';
    s.textContent = `
        .bk-player {
            position: relative;
            width: 100%;
            background: #000;
            border-radius: 10px;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1;
            user-select: none;
        }

        /* ── Video element ── */
        .bk-player__video {
            display: block;
            width: 100%;
            height: 100%;
            cursor: pointer;
        }

        /* ── Big-play overlay ── */
        .bk-player__overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity .2s;
            pointer-events: none;
        }
        .bk-player__overlay--hidden { opacity: 0; }
        .bk-player__big-play {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: rgba(9,9,11,.75);
            border: none;
            color: #fff;
            font-size: 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform .15s, background .15s;
            pointer-events: auto;
        }
        .bk-player__big-play:hover { background: rgba(9,9,11,.9); transform: scale(1.06); }

        /* ── Buffer spinner ── */
        .bk-player__spinner {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 44px; height: 44px;
            border: 4px solid rgba(255,255,255,.2);
            border-top-color: #fff;
            border-radius: 50%;
            animation: bk-spin .7s linear infinite;
            display: none;
        }
        .bk-player__spinner--visible { display: block; }
        @keyframes bk-spin { to { transform: translate(-50%,-50%) rotate(360deg); } }

        /* ── Controls bar ── */
        .bk-player__controls {
            position: absolute;
            bottom: 0; left: 0; right: 0;
            padding: 8px 12px 10px;
            background: linear-gradient(transparent, rgba(0,0,0,.7));
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transition: opacity .25s;
        }
        .bk-player:hover .bk-player__controls,
        .bk-player--paused .bk-player__controls { opacity: 1; }

        /* Buttons */
        .bk-player__btn {
            background: none;
            border: none;
            color: #fff;
            cursor: pointer;
            padding: 4px;
            font-size: 1rem;
            line-height: 1;
            flex-shrink: 0;
            transition: transform .1s;
        }
        .bk-player__btn:hover { transform: scale(1.2); }

        /* Time */
        .bk-player__time {
            color: rgba(255,255,255,.9);
            font-size: .78rem;
            white-space: nowrap;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
        }

        /* Seek bar */
        .bk-player__seek-wrap {
            position: relative;
            flex: 1;
            height: 18px;
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .bk-player__seek-track {
            position: absolute;
            width: 100%;
            height: 4px;
            background: rgba(255,255,255,.25);
            border-radius: 2px;
            overflow: hidden;
        }
        /* Buffered range (FastStart visual feedback) */
        .bk-player__buffered {
            position: absolute;
            left: 0; top: 0;
            height: 100%;
            background: rgba(255,255,255,.4);
            width: 0%;
            transition: width .3s;
        }
        /* Played range */
        .bk-player__played {
            position: absolute;
            left: 0; top: 0;
            height: 100%;
            background: #fff;
            width: 0%;
            transition: width .1s;
        }
        .bk-player__seek-input {
            position: absolute;
            width: 100%;
            height: 100%;
            opacity: 0;
            cursor: pointer;
            margin: 0;
        }

        /* Volume */
        .bk-player__vol-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }
        .bk-player__vol-input {
            width: 64px;
            accent-color: #fff;
            cursor: pointer;
        }

        /* Quality select */
        .bk-player__quality {
            background: rgba(0,0,0,.6);
            color: #fff;
            border: 1px solid rgba(255,255,255,.3);
            border-radius: 4px;
            font-size: .75rem;
            padding: 2px 4px;
            cursor: pointer;
            flex-shrink: 0;
        }

        /* FastStart badge */
        .bk-player__faststart {
            font-size: .65rem;
            background: rgba(9,9,11,.55);
            color: rgba(255,255,255,.8);
            padding: 2px 6px;
            border-radius: 10px;
            flex-shrink: 0;
            letter-spacing: .03em;
        }

        /* Fullscreen */
        .bk-player:fullscreen,
        .bk-player:-webkit-full-screen { border-radius: 0; }
        .bk-player:fullscreen .bk-player__video {
            width: 100vw; height: 100vh; object-fit: contain;
        }
    `;
    document.head.appendChild(s);
})();

// ─── BKPlayer ─────────────────────────────────────────────────────────────────

class BKPlayer {
    /**
     * @param {HTMLElement|string} container - Container element or its id
     * @param {Object}             options
     * @param {string}  options.src       - Video URL (required)
     * @param {boolean} options.autoplay  - Autoplay (default false)
     * @param {boolean} options.muted     - Muted (default false)
     * @param {boolean} options.loop      - Loop (default false)
     * @param {string}  options.quality   - '720p' | '1080p' label (display only)
     * @param {boolean} options.fastStart - Show FastStart badge (default true)
     */
    constructor(container, options = {}) {
        this._container = typeof container === 'string'
            ? document.getElementById(container)
            : container;

        if (!this._container) throw new Error('BKPlayer: container not found');

        this._opts = {
            autoplay:  false,
            muted:     false,
            loop:      false,
            quality:   '',
            fastStart: true,
            ...options,
        };

        this._listeners      = new Map();
        this._buffering      = false;
        this._destroyed      = false;
        this._src            = options.src || '';
        this._nativeHandlers = [];

        this._build();
        this._bindNativeEvents();

        if (this._src) this.load(this._src);
    }

    // ── DOM construction ─────────────────────────────────────────────────────

    _build() {
        this._container.classList.add('bk-player');

        this._container.innerHTML = `
            <video class="bk-player__video"
                   preload="metadata"
                   ${this._opts.autoplay ? 'autoplay' : ''}
                   ${this._opts.muted    ? 'muted'    : ''}
                   ${this._opts.loop     ? 'loop'     : ''}
                   playsinline></video>

            <div class="bk-player__overlay bk-player__overlay--hidden">
                <button class="bk-player__big-play" aria-label="Oynat"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
            </div>

            <div class="bk-player__spinner" aria-hidden="true"></div>

            <div class="bk-player__controls" role="group" aria-label="Video kontrolleri">
                <button class="bk-player__btn bk-player__play-pause" aria-label="Oynat / Duraklat"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
                <span class="bk-player__time">0:00 / 0:00</span>

                <div class="bk-player__seek-wrap" role="slider" aria-label="Oynatma çubuğu">
                    <div class="bk-player__seek-track">
                        <div class="bk-player__buffered"></div>
                        <div class="bk-player__played"></div>
                    </div>
                    <input type="range" class="bk-player__seek-input"
                           min="0" max="100" step="0.05" value="0"
                           aria-label="Oynatma konumu">
                </div>

                <div class="bk-player__vol-wrap">
                    <button class="bk-player__btn bk-player__mute-btn" aria-label="Sesi kapat/aç"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
                    <input type="range" class="bk-player__vol-input"
                           min="0" max="1" step="0.05" value="1"
                           aria-label="Ses seviyesi">
                </div>

                ${this._opts.quality
                    ? `<select class="bk-player__quality" aria-label="Kalite">
                           <option>${this._opts.quality}</option>
                       </select>`
                    : ''}
                ${this._opts.fastStart
                    ? `<span class="bk-player__faststart" title="moov atom başa taşındı — anında oynatma aktif">⚡ FastStart</span>`
                    : ''}

                <button class="bk-player__btn bk-player__fs-btn" aria-label="Tam ekran"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
            </div>
        `;

        // Cache refs
        this._video      = this._container.querySelector('.bk-player__video');
        this._overlay    = this._container.querySelector('.bk-player__overlay');
        this._bigPlay    = this._container.querySelector('.bk-player__big-play');
        this._spinner    = this._container.querySelector('.bk-player__spinner');
        this._ppBtn      = this._container.querySelector('.bk-player__play-pause');
        this._timeEl     = this._container.querySelector('.bk-player__time');
        this._seekInput  = this._container.querySelector('.bk-player__seek-input');
        this._bufferedEl = this._container.querySelector('.bk-player__buffered');
        this._playedEl   = this._container.querySelector('.bk-player__played');
        this._muteBtn    = this._container.querySelector('.bk-player__mute-btn');
        this._volInput   = this._container.querySelector('.bk-player__vol-input');
        this._fsBtn      = this._container.querySelector('.bk-player__fs-btn');
    }

    // ── Event binding ─────────────────────────────────────────────────────────

    _bindNativeEvents() {
        const v = this._video;
        const add = (el, evt, fn) => {
            el.addEventListener(evt, fn);
            this._nativeHandlers.push({ el, evt, fn });
        };

        // Play / Pause
        add(v, 'play',  () => { this._syncPlayPauseBtn(); this._hideOverlay(); this._emit('play',  { seconds: v.currentTime }); });
        add(v, 'pause', () => { this._syncPlayPauseBtn(); this._showOverlay(); this._emit('pause', { seconds: v.currentTime }); this._container.classList.add('bk-player--paused'); });
        add(v, 'ended', () => { this._syncPlayPauseBtn(); this._showOverlay(); this._emit('ended', { seconds: v.currentTime }); });

        // Time
        add(v, 'timeupdate', () => {
            const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
            this._seekInput.value = pct;
            this._playedEl.style.width = pct + '%';
            this._timeEl.textContent   = `${this._fmt(v.currentTime)} / ${this._fmt(v.duration)}`;
            this._emit('timeupdate', { seconds: v.currentTime, percent: pct / 100, duration: v.duration });
        });

        // Buffer (FastStart visual feedback — shows how much has been pre-loaded)
        add(v, 'progress', () => {
            if (!v.duration) return;
            let bufferedEnd = 0;
            for (let i = 0; i < v.buffered.length; i++) {
                if (v.buffered.start(i) <= v.currentTime) {
                    bufferedEnd = Math.max(bufferedEnd, v.buffered.end(i));
                }
            }
            const pct = (bufferedEnd / v.duration) * 100;
            this._bufferedEl.style.width = pct + '%';
            this._emit('progress', { seconds: bufferedEnd, percent: pct / 100 });
        });

        // Seeking
        add(v, 'seeking',  () => this._emit('seeking',  { seconds: v.currentTime }));
        add(v, 'seeked',   () => this._emit('seeked',   { seconds: v.currentTime }));

        // Volume
        add(v, 'volumechange', () => {
            this._syncMuteBtn();
            this._volInput.value = v.muted ? 0 : v.volume;
            this._emit('volumechange', { volume: v.volume, muted: v.muted });
        });

        // Buffer states
        add(v, 'waiting', () => {
            this._buffering = true;
            this._spinner.classList.add('bk-player__spinner--visible');
            this._emit('bufferstart', {});
        });
        add(v, 'playing', () => {
            this._buffering = false;
            this._spinner.classList.remove('bk-player__spinner--visible');
            this._container.classList.remove('bk-player--paused');
            this._emit('bufferend', {});
        });

        // Load / duration
        add(v, 'loadedmetadata', () => {
            this._timeEl.textContent = `0:00 / ${this._fmt(v.duration)}`;
            this._emit('loaded', { duration: v.duration });
        });
        add(v, 'durationchange', () => this._emit('durationchange', { duration: v.duration }));

        // Error
        add(v, 'error', () => {
            const msg = v.error ? v.error.message : 'Unknown playback error';
            this._emit('error', { message: msg });
        });

        // Fullscreen (store refs for cleanup in destroy)
        this._fsChange = () => {
            const isFull = !!(document.fullscreenElement === this._container);
            this._fsBtn.innerHTML = isFull
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
            this._emit('fullscreenchange', { fullscreen: isFull });
        };
        add(document, 'fullscreenchange',       this._fsChange);
        add(document, 'webkitfullscreenchange', this._fsChange);

        // Control interactions
        add(this._bigPlay, 'click', () => this._togglePlay());
        add(this._video, 'click',   () => this._togglePlay());
        add(this._ppBtn, 'click',   () => this._togglePlay());

        add(this._seekInput, 'input', () => {
            if (!v.duration) return;
            v.currentTime = (this._seekInput.value / 100) * v.duration;
        });

        add(this._muteBtn, 'click', () => { v.muted = !v.muted; });
        add(this._volInput, 'input',  () => { v.volume = this._volInput.value; v.muted = false; });
        add(this._fsBtn, 'click', () => this._toggleFullscreen());

        // Keyboard shortcuts (when container is focused)
        this._container.setAttribute('tabindex', '0');
        add(this._container, 'keydown', (e) => {
            switch (e.key) {
                case ' ': case 'k': this._togglePlay();              e.preventDefault(); break;
                case 'ArrowRight':  v.currentTime = Math.min(v.currentTime + 5, v.duration || 0);  break;
                case 'ArrowLeft':   v.currentTime = Math.max(v.currentTime - 5, 0);                break;
                case 'ArrowUp':     v.volume = Math.min(v.volume + 0.1, 1);                        break;
                case 'ArrowDown':   v.volume = Math.max(v.volume - 0.1, 0);                        break;
                case 'm':           v.muted = !v.muted;                                            break;
                case 'f':           this._toggleFullscreen();                                      break;
            }
        });
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    _togglePlay() {
        this._video.paused ? this._video.play().catch(() => {}) : this._video.pause();
    }

    _toggleFullscreen() {
        if (!document.fullscreenElement) {
            this._container.requestFullscreen?.() || this._container.webkitRequestFullscreen?.();
        } else {
            document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        }
    }

    _showOverlay() { this._overlay.classList.remove('bk-player__overlay--hidden'); }
    _hideOverlay() { this._overlay.classList.add('bk-player__overlay--hidden'); }

    _syncPlayPauseBtn() {
        const playIco  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        const pauseIco = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        const playIcoLg  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
        const pauseIcoLg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        this._ppBtn.innerHTML    = this._video.paused ? playIco  : pauseIco;
        this._bigPlay.innerHTML  = this._video.paused ? playIcoLg : pauseIcoLg;
    }

    _syncMuteBtn() {
        const v = this._video;
        this._muteBtn.innerHTML = v.muted || v.volume === 0
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    }

    _fmt(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // ── Event emitter ─────────────────────────────────────────────────────────

    /**
     * Register event listener.
     * @param {string}   event    - Event name (play, pause, timeupdate, …)
     * @param {Function} callback - Called with event data object
     * @returns {BKPlayer} this (chainable)
     */
    on(event, callback) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(callback);
        return this;
    }

    /**
     * Remove event listener.
     * @returns {BKPlayer} this (chainable)
     */
    off(event, callback) {
        if (!this._listeners.has(event)) return this;
        this._listeners.set(event, this._listeners.get(event).filter(l => l !== callback));
        return this;
    }

    _emit(event, data) {
        (this._listeners.get(event) || []).forEach(fn => {
            try { fn(data); } catch (e) { console.error(`BKPlayer event handler error (${event}):`, e); }
        });
    }

    // ── Public programmatic API (Promise-based, mirrors Vimeo player.js) ──────

    /** Load a new video source */
    load(src) {
        this._src       = src;
        this._video.src = src;
        this._video.load();
        return this;
    }

    /** Start playback. Returns a Promise that resolves when playback begins. */
    play() { return this._video.play(); }

    /** Pause playback. Returns a resolved Promise. */
    pause() { this._video.pause(); return Promise.resolve(); }

    /** @returns {Promise<boolean>} */
    getPaused()  { return Promise.resolve(this._video.paused); }

    /** @returns {Promise<boolean>} */
    getEnded()   { return Promise.resolve(this._video.ended); }

    /** @returns {Promise<number>} Current time in seconds */
    getCurrentTime() { return Promise.resolve(this._video.currentTime); }

    /**
     * Seek to a position.
     * @param {number} seconds
     * @returns {Promise<number>} New time
     */
    setCurrentTime(seconds) {
        this._video.currentTime = seconds;
        return Promise.resolve(seconds);
    }

    /** @returns {Promise<number>} Total duration in seconds */
    getDuration() { return Promise.resolve(this._video.duration || 0); }

    /**
     * Set volume.
     * @param {number} fraction - 0.0 – 1.0
     * @returns {Promise<number>}
     */
    setVolume(fraction) {
        this._video.volume = Math.max(0, Math.min(1, fraction));
        return Promise.resolve(this._video.volume);
    }

    /** @returns {Promise<number>} Volume 0.0 – 1.0 */
    getVolume() { return Promise.resolve(this._video.volume); }

    /** @param {boolean} muted */
    setMuted(muted) { this._video.muted = muted; return Promise.resolve(muted); }

    /** @returns {Promise<boolean>} */
    getMuted()  { return Promise.resolve(this._video.muted); }

    /** @param {number} rate - e.g. 0.5, 1, 1.5, 2 */
    setPlaybackRate(rate) {
        this._video.playbackRate = rate;
        this._emit('playbackratechange', { playbackRate: rate });
        return Promise.resolve(rate);
    }

    /** @returns {Promise<number>} */
    getPlaybackRate() { return Promise.resolve(this._video.playbackRate); }

    /** Enter fullscreen */
    requestFullscreen() {
        return this._container.requestFullscreen?.()
            || this._container.webkitRequestFullscreen?.()
            || Promise.resolve();
    }

    /** Exit fullscreen */
    exitFullscreen() {
        return document.exitFullscreen?.() || Promise.resolve();
    }

    /** @returns {Promise<boolean>} */
    getFullscreen() {
        return Promise.resolve(document.fullscreenElement === this._container);
    }

    /**
     * Switch to a different quality source.
     * @param {string} quality - label, e.g. '720p'
     * @param {string} src     - new video URL
     */
    setQuality(quality, src) {
        const currentTime = this._video.currentTime;
        const wasPaused   = this._video.paused;
        this._video.src   = src;
        this._video.load();
        this._video.currentTime = currentTime;
        if (!wasPaused) this._video.play().catch(() => {});
        this._emit('qualitychange', { quality });
        return Promise.resolve(quality);
    }

    /**
     * Destroy the player and remove all listeners.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        // Remove all native event listeners to prevent memory leaks
        (this._nativeHandlers || []).forEach(({ el, evt, fn }) => {
            try { el.removeEventListener(evt, fn); } catch (_) {}
        });
        this._nativeHandlers = [];

        this._video.pause();
        this._video.removeAttribute('src');
        this._video.load();
        this._listeners.clear();
        this._container.innerHTML = '';
        this._container.classList.remove('bk-player', 'bk-player--paused');
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
window.BKPlayer = BKPlayer;
