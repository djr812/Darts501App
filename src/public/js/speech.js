/**
 * speech.js
 * ---------
 * Darts scorer speech synthesis.
 *
 * Speaks dart scores and remaining totals in classic caller style.
 * Built on Web Speech Synthesis API (supported Safari 7+ / iOS 7+).
 *
 * Public API:
 *   SPEECH.isSupported()               → bool
 *   SPEECH.isEnabled()                 → bool
 *   SPEECH.setEnabled(bool)            → void
 *   SPEECH.announceDartScore(seg,mul,pts) → void — called after each dart
 *   SPEECH.announcePlayer(name)         → void — called at start of each turn
 *   SPEECH.announceRemaining(score)    → void  — called after turn ends (score ≤ 170)
 *   SPEECH.announceBust()              → void
 *   SPEECH.announceCheckout(points)    → void
 */

var SPEECH = (function() {

    var _enabled = true;

    // ------------------------------------------------------------------
    // Support check
    // ------------------------------------------------------------------

    function isSupported() {
        return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }

    function isEnabled() { return _enabled; }

    function setEnabled(val) {
        _enabled = !!val;
        // Cancel any in-flight speech when toggled off
        if (!_enabled && isSupported()) window.speechSynthesis.cancel();
    }

    // ------------------------------------------------------------------
    // Voice selection — British male, consistent across the app
    // ------------------------------------------------------------------

    // Preferred voice names in priority order (iOS / macOS / Android / Windows)
    var PREFERRED_VOICES = [
        'Daniel',           // iOS/macOS — British male (best match)
        'Arthur',           // macOS Ventura+ British male
        'Google UK English Male',   // Chrome / Android
        'Microsoft George', // Windows British male
        'en-GB',            // fallback: any en-GB voice
    ];

    var _voice = null;       // cached after first successful lookup
    var _voiceLoadAttempts = 0;

    function _pickVoice() {
        if (_voice) return _voice;
        if (!isSupported()) return null;
        var voices = window.speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return null;

        // Try preferred names first (case-insensitive partial match)
        for (var pi = 0; pi < PREFERRED_VOICES.length; pi++) {
            var pref = PREFERRED_VOICES[pi].toLowerCase();
            for (var vi = 0; vi < voices.length; vi++) {
                var v = voices[vi];
                if (v.name.toLowerCase().indexOf(pref) !== -1) {
                    _voice = v;
                    return _voice;
                }
            }
        }

        // Last resort: any en-GB voice
        for (var vi2 = 0; vi2 < voices.length; vi2++) {
            if (voices[vi2].lang && voices[vi2].lang.indexOf('en-GB') !== -1) {
                _voice = voices[vi2];
                return _voice;
            }
        }

        return null;
    }

    // iOS loads voices asynchronously — listen for the event and cache the result
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = function () {
            _voice = null;   // reset so next _pickVoice() re-evaluates
            _pickVoice();
        };
    }

    // ------------------------------------------------------------------
    // Core speak helper
    // ------------------------------------------------------------------

    function _speak(text, priority, options) {
        if (!_enabled || !isSupported()) return;
        if (priority) window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        var v = _pickVoice();
        if (v) {
            u.voice = v;
            u.lang  = v.lang;
        } else {
            u.lang  = 'en-GB';
        }
        u.rate   = (options && options.rate)   || 1.05;
        u.pitch  = (options && options.pitch)  || 1.0;
        u.volume = (options && options.volume) || 1.0;
        window.speechSynthesis.speak(u);
    }

    // ------------------------------------------------------------------
    // Public raw speak — used by game modules that call speech directly.
    // Applies the same voice selection as _speak.
    // ------------------------------------------------------------------

    function speak(text, options) {
        if (!_enabled || !isSupported()) return;
        var u = new SpeechSynthesisUtterance(text);
        var v = _pickVoice();
        if (v) {
            u.voice = v;
            u.lang  = v.lang;
        } else {
            u.lang  = 'en-GB';
        }
        u.rate   = (options && options.rate)   || 1.0;
        u.pitch  = (options && options.pitch)  || 1.0;
        u.volume = (options && options.volume) || 1.0;
        window.speechSynthesis.speak(u);
    }

    // ------------------------------------------------------------------
    // Score phrasing
    // Classic darts caller phrases for notable scores
    // ------------------------------------------------------------------

    var SPECIAL_SCORES = {
        180: 'One hundred and eighty!',
        171: 'One hundred and seventy one',
        170: 'Big fish!',
        167: 'One hundred and sixty seven',
        164: 'One hundred and sixty four',
        161: 'One hundred and sixty one',
        160: 'One hundred and sixty',
        157: 'One hundred and fifty seven',
        156: 'One hundred and fifty six',
        155: 'One hundred and fifty five',
        154: 'One hundred and fifty four',
        153: 'One hundred and fifty three',
        152: 'One hundred and fifty two',
        151: 'One hundred and fifty one',
        150: 'One hundred and fifty',
        140: 'Ton forty',
        141: 'Ton forty one',
        100: 'Ton',
        101: 'Ton and one',
        60:  'Sixty',
        26:  'Twenty six',
        41:  'Forty one',
        45:  'Forty five',
        85:  'Eighty five',
    };

    // Numbers 1–20 as words (for "N remaining" phrasing)
    var ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
                'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
                'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
                'nineteen', 'twenty'];
    var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
                'seventy', 'eighty', 'ninety'];

    function _numberToWords(n) {
        if (n === 0) return 'zero';
        if (n <= 20) return ONES[n];
        if (n < 100) {
            var t = Math.floor(n / 10);
            var o = n % 10;
            return o === 0 ? TENS[t] : TENS[t] + ' ' + ONES[o];
        }
        if (n < 200) {
            var rest = n - 100;
            if (rest === 0) return 'one hundred';
            return 'one hundred and ' + _numberToWords(rest);
        }
        // 200–180 range handled above via SPECIAL_SCORES mostly,
        // but handle generically just in case
        var h = Math.floor(n / 100);
        var r = n % 100;
        var base = ONES[h] + ' hundred';
        return r === 0 ? base : base + ' and ' + _numberToWords(r);
    }

    function _phraseScore(points) {
        if (SPECIAL_SCORES[points]) return SPECIAL_SCORES[points];

        // Ton+ range (101–179, excluding specials above)
        if (points >= 101 && points <= 180) {
            return 'One hundred and ' + _numberToWords(points - 100);
        }

        return _numberToWords(points);
    }

    function _phraseRemaining(score) {
        // e.g. "Forty five remaining" / "double top to finish" etc.
        if (score === 0)  return '';           // already checked out
        if (score === 2)  return 'Double one';
        if (score === 50) return 'Bulls Eye';

        // Clean double finish
        if (score <= 40 && score % 2 === 0) {
            return 'Double ' + _numberToWords(score / 2) + ' remaining';
        }

        return _numberToWords(score) + ' remaining';
    }

    // ------------------------------------------------------------------
    // Public announcement methods
    // ------------------------------------------------------------------

    // Segment names for caller phrasing
    var SEGMENT_NAMES = {
        25: 'Outer Bull',
        20: 'twenty',  19: 'nineteen', 18: 'eighteen', 17: 'seventeen',
        16: 'sixteen', 15: 'fifteen',  14: 'fourteen',  13: 'thirteen',
        12: 'twelve',  11: 'eleven',   10: 'ten',        9: 'nine',
         8: 'eight',    7: 'seven',     6: 'six',         5: 'five',
         4: 'four',     3: 'three',     2: 'two',          1: 'one',
    };

    /**
     * Build a caller phrase for a single dart using segment + multiplier.
     * e.g. segment=20, multiplier=3 → "Treble twenty"
     *      segment=20, multiplier=2 → "Double twenty"
     *      segment=20, multiplier=1 → "Twenty"
     *      segment=25, multiplier=2 → "Bulls Eye"  (double bull)
     *      segment=25, multiplier=1 → "Outer Bull"
     */
    function _phraseDart(segment, multiplier, points) {
        if (points === 0) return 'Miss';

        var segName = SEGMENT_NAMES[segment] || _numberToWords(segment);

        // Bull / Bullseye
        if (segment === 25) {
            return multiplier === 2 ? 'Bulls Eye' : 'Outer Bull';
        }

        if (multiplier === 3) return 'Treble ' + segName;
        if (multiplier === 2) return 'Double ' + segName;
        return segName.charAt(0).toUpperCase() + segName.slice(1);
    }

    /**
     * Speak the score of a single dart throw.
     * Called immediately after each dart is recorded.
     *
     * @param {number} segment    — board segment hit (0-25)
     * @param {number} multiplier — 1=single, 2=double, 3=treble
     * @param {number} points     — calculated points (used as fallback)
     */
    function announceDartScore(segment, multiplier, points) {
        if (!_enabled) return;
        _speak(_phraseDart(segment, multiplier, points), true);
    }

    /**
     * Announce whose turn it is to throw.
     * @param {string} playerName
     */
    function announceWelcome(gameType) {
        if (!_enabled) return;
        var spoken = gameType === '501' ? 'Five-oh-one' : gameType === '201' ? 'Two-oh-one' : gameType;
        _speak('Welcome to ' + spoken + ' darts.', false);
    }

    function announcePlayer(playerName) {
        if (!_enabled) return;
        _speak(playerName + "'s turn to throw", false);
    }

    /**
     * Shanghai-specific turn announcement.
     * Says "{Name}, your number is {target}"
     * @param {string} playerName
     * @param {string|number} target  — e.g. "7" or "Bull"
     */
    function announceShanghai(playerName, target) {
        if (!_enabled) return;
        _speak(playerName + ', your number is ' + target, false);
    }

    /**
     * Speak the turn total and remaining score after a full turn.
     * Only announces remaining if score ≤ 170.
     *
     * @param {number} turnPoints  — total scored this turn (score_before - score_after)
     * @param {number} remaining   — player's score after the turn
     */
    function announceTurnEnd(turnPoints, remaining) {
        // Sound effects first (non-blocking)
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (turnPoints === 180) {
                SOUNDS.oneEighty();
            } else if (turnPoints >= 100) {
                SOUNDS.ton();
            }
        }

        if (!_enabled) return;

        var phrase = _phraseScore(turnPoints);

        if (remaining > 0 && remaining <= 170) {
            phrase = phrase + '... ' + _phraseRemaining(remaining);
        }

        // 180 and 170 get emphatic treatment — louder, slightly slower, higher pitch
        if (turnPoints === 180) {
            _speak(phrase, true, { rate: 0.9, pitch: 1.3, volume: 1.0 });
        } else if (turnPoints === 170) {
            _speak(phrase, true, { rate: 0.95, pitch: 1.2, volume: 1.0 });
        } else {
            _speak(phrase, false);
        }
    }

    /**
     * Speak a bust.
     */
    function announceCricketWin(playerName) {
        if (!_enabled) return;
        _speak(playerName + ', You are winner! Hah! Hah! Hah!', true, { rate: 0.88, pitch: 1.25, volume: 1.0 });
    }

    function announceTimer(phrase) {
        if (!_enabled) return;
        _speak(phrase, true);
    }

    function announceBust() {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            SOUNDS.bust();
        }
        _speak('Bust!', true);
    }

    /**
     * Speak a checkout.
     * @param {number} points — the score checked out on
     */
    function announceCheckout(points) {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            SOUNDS.checkout();
        }
        var phrase = _phraseScore(points) + '... checkout!';
        _speak(phrase, true);
    }

    // ------------------------------------------------------------------

    /**
     * Unlock the iOS speech engine by firing a silent utterance inside a
     * user gesture handler. Must be called directly within a tap/click event
     * (e.g. the Start Match button) before any programmatic speech is needed.
     * Safe to call on non-iOS platforms — it's a no-op if already unlocked.
     */
    function unlock() {
        if (!isSupported()) return;
        var u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        u.rate   = 10;   // finish instantly
        window.speechSynthesis.speak(u);
    }

    // ------------------------------------------------------------------

    return {
        isSupported:       isSupported,
        speak:             speak,
        isEnabled:         isEnabled,
        setEnabled:        setEnabled,
        unlock:            unlock,
        announceDartScore: announceDartScore,
        announceWelcome:   announceWelcome,
        announcePlayer:    announcePlayer,
        announceShanghai:  announceShanghai,
        announceTurnEnd:   announceTurnEnd,
        announceBust:      announceBust,
        announceCheckout:  announceCheckout,
        announceCricketWin: announceCricketWin,
        announceTimer:      announceTimer,
    };

}());