/**
 * sounds.js
 * ---------
 * Procedural sound effects for Darts 501.
 * All sounds synthesised via Web Audio API — no external files required.
 *
 * Public API:
 *   SOUNDS.isSupported()    → bool
 *   SOUNDS.isEnabled()      → bool
 *   SOUNDS.setEnabled(bool) → void
 *   SOUNDS.unlock()         → void  — call on first user gesture (iOS requirement)
 *   SOUNDS.dart()           → void  — dart thud on board
 *   SOUNDS.bust()           → void  — wah-waaah fail sound
 *   SOUNDS.checkout()       → void  — triumphant fanfare
 *   SOUNDS.ton()            → void  — subtle rising tone for 100+
 *   SOUNDS.oneEighty()      → void  — emphatic for 180
 */

var SOUNDS = (function() {

    var _enabled = true;
    var _ctx     = null;   // AudioContext — created lazily on first use

    // ------------------------------------------------------------------
    // Support + enable/disable
    // ------------------------------------------------------------------

    function isSupported() {
        return !!(window.AudioContext || window.webkitAudioContext);
    }

    function isEnabled() { return _enabled; }

    function setEnabled(val) {
        _enabled = !!val;
    }

    // ------------------------------------------------------------------
    // AudioContext — created once, resumed on iOS after user gesture
    // ------------------------------------------------------------------

    function _getCtx() {
        if (!isSupported()) return null;
        if (!_ctx) {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            _ctx = new Ctx();
        }
        // iOS suspends context until resumed after a gesture
        if (_ctx.state === 'suspended') {
            _ctx.resume();
        }
        return _ctx;
    }

    /**
     * Call once on any user gesture (tap) to unlock audio on iOS.
     * Safe to call multiple times.
     */
    function unlock() {
        var ctx = _getCtx();
        if (!ctx) return;
        // Play a silent buffer to unlock the audio context on iOS
        var buf = ctx.createBuffer(1, 1, 22050);
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
    }

    // ------------------------------------------------------------------
    // Core helpers
    // ------------------------------------------------------------------

    /**
     * Create a gain node with an optional envelope.
     * @param {AudioContext} ctx
     * @param {number} peak     — peak gain value
     * @param {number} attack   — attack time in seconds
     * @param {number} decay    — decay time in seconds
     * @param {number} startAt  — ctx.currentTime offset to start
     */
    function _gain(ctx, peak, attack, decay, startAt) {
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, startAt);
        g.gain.linearRampToValueAtTime(peak, startAt + attack);
        g.gain.exponentialRampToValueAtTime(0.001, startAt + attack + decay);
        return g;
    }

    /**
     * Play a simple oscillator tone.
     * @param {AudioContext} ctx
     * @param {string} type     — 'sine' | 'square' | 'sawtooth' | 'triangle'
     * @param {number} freq     — frequency in Hz
     * @param {number} gain     — peak gain (0–1)
     * @param {number} start    — ctx.currentTime offset
     * @param {number} duration — seconds
     */
    function _tone(ctx, type, freq, gain, start, duration) {
        var osc = ctx.createOscillator();
        var g   = _gain(ctx, gain, 0.005, duration, start);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.05);
    }

    /**
     * Play a noise burst (white noise filtered).
     * @param {AudioContext} ctx
     * @param {number} gain      — peak gain
     * @param {number} start     — ctx.currentTime offset
     * @param {number} duration  — seconds
     * @param {number} filterHz  — lowpass cutoff
     */
    function _noise(ctx, gain, start, duration, filterHz) {
        var bufSize = Math.floor(ctx.sampleRate * duration);
        var buf     = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        var data    = buf.getChannelData(0);
        for (var i = 0; i < bufSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }
        var src    = ctx.createBufferSource();
        src.buffer = buf;

        var filter = ctx.createBiquadFilter();
        filter.type            = 'lowpass';
        filter.frequency.value = filterHz || 2000;

        var g = _gain(ctx, gain, 0.002, duration, start);
        src.connect(filter);
        filter.connect(g);
        g.connect(ctx.destination);
        src.start(start);
    }

    // ------------------------------------------------------------------
    // Sound effects
    // ------------------------------------------------------------------

    /**
     * Dart ding — clean bell-like tone with a quick natural decay.
     * Two sine partials (fundamental + octave) give a warm, rounded ding.
     */
    function dart() {
        if (!_enabled) return;
        var ctx = _getCtx();
        if (!ctx) return;

        var t = ctx.currentTime;

        // Fundamental — 880 Hz (A5), bright but not harsh
        var osc1 = ctx.createOscillator();
        var g1   = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = 880;
        g1.gain.setValueAtTime(0.35, t);
        g1.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc1.connect(g1);
        g1.connect(ctx.destination);
        osc1.start(t);
        osc1.stop(t + 0.65);

        // Octave harmonic — 1760 Hz, quieter, fades faster
        var osc2 = ctx.createOscillator();
        var g2   = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 1760;
        g2.gain.setValueAtTime(0.12, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc2.connect(g2);
        g2.connect(ctx.destination);
        osc2.start(t);
        osc2.stop(t + 0.3);

        // Soft attack transient — tiny noise click to give it a percussive onset
        _noise(ctx, 0.06, t, 0.018, 6000);
    }

    /**
     * Bust — descending wah-waaah trombone-style fail sound.
     */
    function bust() {
        if (!_enabled) return;
        var ctx = _getCtx();
        if (!ctx) return;

        var t = ctx.currentTime;

        // Two descending tones — classic "sad trombone" feel
        var notes = [
            { freq: 466, start: 0,    dur: 0.18 },
            { freq: 370, start: 0.18, dur: 0.18 },
            { freq: 311, start: 0.36, dur: 0.18 },
            { freq: 233, start: 0.54, dur: 0.35 },
        ];

        notes.forEach(function(n) {
            var osc = ctx.createOscillator();
            var g   = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(n.freq, t + n.start);

            // Add vibrato on last note
            if (n.start > 0.5) {
                var lfo = ctx.createOscillator();
                var lfoG = ctx.createGain();
                lfo.frequency.value = 6;
                lfoG.gain.value     = 8;
                lfo.connect(lfoG);
                lfoG.connect(osc.frequency);
                lfo.start(t + n.start);
                lfo.stop(t + n.start + n.dur + 0.05);
            }

            // Soft lowpass to round off the sawtooth harshness
            var filter = ctx.createBiquadFilter();
            filter.type            = 'lowpass';
            filter.frequency.value = 800;

            g.gain.setValueAtTime(0, t + n.start);
            g.gain.linearRampToValueAtTime(0.25, t + n.start + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);

            osc.connect(filter);
            filter.connect(g);
            g.connect(ctx.destination);
            osc.start(t + n.start);
            osc.stop(t + n.start + n.dur + 0.05);
        });
    }

    /**
     * Checkout — short ascending fanfare.
     */
    function checkout() {
        if (!_enabled) return;
        var ctx = _getCtx();
        if (!ctx) return;

        var t = ctx.currentTime;

        // Ascending major arpeggio — C E G C
        var notes = [
            { freq: 523, start: 0,    dur: 0.12 },
            { freq: 659, start: 0.1,  dur: 0.12 },
            { freq: 784, start: 0.2,  dur: 0.12 },
            { freq: 1047, start: 0.3, dur: 0.35 },
        ];

        notes.forEach(function(n) {
            // Bell-like tone: sine + slight triangle mix
            ['sine', 'triangle'].forEach(function(type, i) {
                var osc = ctx.createOscillator();
                var g   = ctx.createGain();
                osc.type = type;
                osc.frequency.value = n.freq;

                g.gain.setValueAtTime(0, t + n.start);
                g.gain.linearRampToValueAtTime(i === 0 ? 0.3 : 0.1, t + n.start + 0.01);
                g.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);

                osc.connect(g);
                g.connect(ctx.destination);
                osc.start(t + n.start);
                osc.stop(t + n.start + n.dur + 0.05);
            });
        });

        // Shimmer noise on the final note
        _noise(ctx, 0.08, t + 0.3, 0.35, 8000);
    }

    /**
     * Ton (100+) — subtle rising two-note acknowledgement.
     */
    function ton() {
        if (!_enabled) return;
        var ctx = _getCtx();
        if (!ctx) return;

        var t = ctx.currentTime;
        _tone(ctx, 'sine', 440, 0.2, t,       0.12);
        _tone(ctx, 'sine', 554, 0.2, t + 0.1, 0.2);
    }

    /**
     * One-eighty — emphatic three-note rising fanfare, louder than ton().
     */
    function oneEighty() {
        if (!_enabled) return;
        var ctx = _getCtx();
        if (!ctx) return;

        var t = ctx.currentTime;

        // Three punchy rising notes
        var notes = [
            { freq: 523, start: 0,    dur: 0.15 },
            { freq: 659, start: 0.12, dur: 0.15 },
            { freq: 880, start: 0.24, dur: 0.4  },
        ];

        notes.forEach(function(n) {
            var osc = ctx.createOscillator();
            var g   = ctx.createGain();
            osc.type = 'square';

            // Soften with lowpass
            var filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 1200;

            osc.frequency.value = n.freq;
            g.gain.setValueAtTime(0, t + n.start);
            g.gain.linearRampToValueAtTime(0.35, t + n.start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);

            osc.connect(filter);
            filter.connect(g);
            g.connect(ctx.destination);
            osc.start(t + n.start);
            osc.stop(t + n.start + n.dur + 0.05);
        });

        // Noise crash on final note
        _noise(ctx, 0.12, t + 0.24, 0.4, 5000);
    }

    // ------------------------------------------------------------------

    return {
        isSupported: isSupported,
        isEnabled:   isEnabled,
        setEnabled:  setEnabled,
        unlock:      unlock,
        dart:        dart,
        bust:        bust,
        checkout:    checkout,
        ton:         ton,
        oneEighty:   oneEighty,
    };

}());