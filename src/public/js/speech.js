/**
 * speech.js
 * ---------
 * Darts scorer speech synthesis.
 *
 * Uses @capacitor-community/text-to-speech for Android/iOS native TTS.
 * Falls back to Web Speech API if the Capacitor plugin is not available
 * (e.g. when running in a desktop browser during development).
 *
 * Public API (unchanged from original):
 *   SPEECH.isSupported()                  → bool
 *   SPEECH.isEnabled()                    → bool
 *   SPEECH.setEnabled(bool)               → void
 *   SPEECH.unlock()                       → void  (no-op for native TTS)
 *   SPEECH.speak(text, options)           → void
 *   SPEECH.announceDartScore(seg,mul,pts) → void
 *   SPEECH.announcePlayer(name)           → void
 *   SPEECH.announceWelcome(gameType)      → void
 *   SPEECH.announceShanghai(name, target) → void
 *   SPEECH.announceTurnEnd(pts, rem)      → void
 *   SPEECH.announceBust()                 → void
 *   SPEECH.announceCheckout(points)       → void
 *   SPEECH.announceCricketWin(name)       → void
 *   SPEECH.announceTimer(phrase)          → void
 */

var SPEECH = (function () {

    var _enabled = true;

    // ------------------------------------------------------------------
    // Detect which TTS engine to use
    // ------------------------------------------------------------------

    function _getPlugin() {
        return (window.Capacitor &&
                window.Capacitor.Plugins &&
                window.Capacitor.Plugins.TextToSpeech)
            ? window.Capacitor.Plugins.TextToSpeech
            : null;
    }

    function isSupported() {
        if (_getPlugin()) return true;
        return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }

    function isEnabled() { return _enabled; }

    function setEnabled(val) {
        _enabled = !!val;
        if (!_enabled) {
            var plugin = _getPlugin();
            if (plugin) {
                plugin.stop().catch(function () {});
            } else if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        }
    }

    // ------------------------------------------------------------------
    // Voice selection for native TTS
    // Preferred en-GB voices in priority order based on Android availability
    // ------------------------------------------------------------------

    var _cachedVoiceURI = null;
    var _voicesLoaded   = false;
    var _voiceList      = [];

    var PREFERRED_VOICE_URIS = [
        'en-gb-x-gba-local',   // British English local (Android)
        'en-gb-x-gbb-local',   // British English local variant
        'en-gb-x-gbc-local',   // British English local variant
        'en-gb-x-gbd-local',   // British English local variant
        'en-gb-x-gbe-local',   // British English local variant
        'en-gb-x-rjs-local',   // British English local variant
    ];

    function _loadVoices() {
        if (_voicesLoaded) return Promise.resolve();
        var plugin = _getPlugin();
        if (!plugin) { _voicesLoaded = true; return Promise.resolve(); }
        return plugin.getSupportedVoices()
            .then(function (result) {
                _voiceList = result.voices || [];
                _voicesLoaded = true;
                // Pre-select best en-GB voice
                _pickVoiceURI();
            })
            .catch(function () {
                _voicesLoaded = true;
            });
    }

    function _pickVoiceURI() {
        if (_cachedVoiceURI) return _cachedVoiceURI;

        // Try preferred URIs first
        for (var i = 0; i < PREFERRED_VOICE_URIS.length; i++) {
            var pref = PREFERRED_VOICE_URIS[i];
            var found = _voiceList.find(function (v) {
                return v.voiceURI === pref;
            });
            if (found) {
                _cachedVoiceURI = found.voiceURI;
                return _cachedVoiceURI;
            }
        }

        // Fall back to any local en-GB voice
        var engb = _voiceList.find(function (v) {
            return v.lang === 'en-GB' && v.localService;
        });
        if (engb) {
            _cachedVoiceURI = engb.voiceURI;
            return _cachedVoiceURI;
        }

        // Fall back to any en-GB voice
        var anyEngb = _voiceList.find(function (v) {
            return v.lang === 'en-GB';
        });
        if (anyEngb) {
            _cachedVoiceURI = anyEngb.voiceURI;
            return _cachedVoiceURI;
        }

        // Fall back to any en-US voice
        var enus = _voiceList.find(function (v) {
            return v.lang === 'en-US' && v.localService;
        });
        if (enus) {
            _cachedVoiceURI = enus.voiceURI;
            return _cachedVoiceURI;
        }

        return null;
    }

    // Initialise voice list as soon as possible
    _loadVoices();

    // ------------------------------------------------------------------
    // Core speak helper — queues utterances sequentially
    // ------------------------------------------------------------------

    var _speakQueue  = [];
    var _speakBusy   = false;

    function _processQueue() {
        if (_speakBusy || _speakQueue.length === 0) return;
        var item = _speakQueue.shift();
        _speakBusy = true;

        var plugin = _getPlugin();

        if (plugin) {
            var voiceURI = _pickVoiceURI();
            var params = {
                text:     item.text,
                lang:     'en-GB',
                rate:     item.rate  || 1.05,
                pitch:    item.pitch || 1.0,
                volume:   item.volume || 1.0,
                category: 'ambient',
            };
            if (voiceURI) params.voiceURI = voiceURI;

            plugin.speak(params)
                .then(function () {
                    _speakBusy = false;
                    _processQueue();
                })
                .catch(function (err) {
                    console.warn('[speech] TTS error:', err);
                    _speakBusy = false;
                    _processQueue();
                });
        } else if (window.speechSynthesis) {
            // Web Speech API fallback (desktop browser)
            var u = new SpeechSynthesisUtterance(item.text);
            u.lang    = 'en-GB';
            u.rate    = item.rate   || 1.05;
            u.pitch   = item.pitch  || 1.0;
            u.volume  = item.volume || 1.0;
            u.onend   = function () { _speakBusy = false; _processQueue(); };
            u.onerror = function () { _speakBusy = false; _processQueue(); };
            window.speechSynthesis.speak(u);
        } else {
            _speakBusy = false;
        }
    }

    function _speak(text, interrupt, options) {
        if (!_enabled || !isSupported()) return;
        if (interrupt) {
            // Cancel current speech and clear queue
            _speakQueue = [];
            _speakBusy  = false;
            var plugin = _getPlugin();
            if (plugin) {
                plugin.stop().catch(function () {}).finally(function () {
                    _speakQueue.push({
                        text:   text,
                        rate:   (options && options.rate)   || 1.05,
                        pitch:  (options && options.pitch)  || 1.0,
                        volume: (options && options.volume) || 1.0,
                    });
                    _processQueue();
                });
            } else {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                _speakQueue.push({
                    text:   text,
                    rate:   (options && options.rate)   || 1.05,
                    pitch:  (options && options.pitch)  || 1.0,
                    volume: (options && options.volume) || 1.0,
                });
                _processQueue();
            }
        } else {
            _speakQueue.push({
                text:   text,
                rate:   (options && options.rate)   || 1.05,
                pitch:  (options && options.pitch)  || 1.0,
                volume: (options && options.volume) || 1.0,
            });
            _processQueue();
        }
    }

    // ------------------------------------------------------------------
    // Public raw speak
    // ------------------------------------------------------------------

    function speak(text, options) {
        _speak(text, false, options);
    }

    // ------------------------------------------------------------------
    // unlock — no-op for native TTS, kept for API compatibility
    // ------------------------------------------------------------------

    function unlock() {
        // Native TTS doesn't need an unlock gesture.
        // For Web Speech API fallback, fire a silent utterance.
        if (!_getPlugin() && window.speechSynthesis) {
            var u = new SpeechSynthesisUtterance('');
            u.volume = 0;
            u.rate   = 10;
            window.speechSynthesis.speak(u);
        }
        // Preload voices if not done yet
        _loadVoices();
    }

    // ------------------------------------------------------------------
    // Score phrasing (identical to original)
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
        var h = Math.floor(n / 100);
        var r = n % 100;
        var base = ONES[h] + ' hundred';
        return r === 0 ? base : base + ' and ' + _numberToWords(r);
    }

    function _phraseScore(points) {
        if (SPECIAL_SCORES[points]) return SPECIAL_SCORES[points];
        if (points >= 101 && points <= 180) {
            return 'One hundred and ' + _numberToWords(points - 100);
        }
        return _numberToWords(points);
    }

    function _phraseRemaining(score) {
        if (score === 0)  return '';
        if (score === 2)  return 'Double one';
        if (score === 50) return 'Bulls Eye';
        if (score <= 40 && score % 2 === 0) {
            return 'Double ' + _numberToWords(score / 2) + ' remaining';
        }
        return _numberToWords(score) + ' remaining';
    }

    var SEGMENT_NAMES = {
        25: 'Outer Bull',
        20: 'twenty',  19: 'nineteen', 18: 'eighteen', 17: 'seventeen',
        16: 'sixteen', 15: 'fifteen',  14: 'fourteen',  13: 'thirteen',
        12: 'twelve',  11: 'eleven',   10: 'ten',        9: 'nine',
         8: 'eight',    7: 'seven',     6: 'six',         5: 'five',
         4: 'four',     3: 'three',     2: 'two',          1: 'one',
    };

    function _phraseDart(segment, multiplier, points) {
        if (points === 0) return 'Miss';
        var segName = SEGMENT_NAMES[segment] || _numberToWords(segment);
        if (segment === 25) {
            return multiplier === 2 ? 'Bulls Eye' : 'Outer Bull';
        }
        if (multiplier === 3) return 'Treble ' + segName;
        if (multiplier === 2) return 'Double ' + segName;
        return segName.charAt(0).toUpperCase() + segName.slice(1);
    }

    // ------------------------------------------------------------------
    // Public announcement methods (identical signatures to original)
    // ------------------------------------------------------------------

    function announceDartScore(segment, multiplier, points) {
        if (!_enabled) return;
        _speak(_phraseDart(segment, multiplier, points), true);
    }

    function announceWelcome(gameType) {
        if (!_enabled) return;
        var spoken = gameType === '501' ? 'Five-oh-one'
                   : gameType === '201' ? 'Two-oh-one'
                   : gameType;
        _speak('Welcome to ' + spoken + ' darts.', false);
    }

    function announcePlayer(playerName) {
        if (!_enabled) return;
        _speak(playerName + "'s turn to throw", false);
    }

    function announceShanghai(playerName, target) {
        if (!_enabled) return;
        _speak(playerName + ', your number is ' + target, false);
    }

    function announceTurnEnd(turnPoints, remaining) {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (turnPoints === 180) SOUNDS.oneEighty();
            else if (turnPoints >= 100) SOUNDS.ton();
        }
        if (!_enabled) return;

        var phrase = _phraseScore(turnPoints);
        if (remaining > 0 && remaining <= 170) {
            phrase = phrase + '... ' + _phraseRemaining(remaining);
        }

        if (turnPoints === 180) {
            _speak(phrase, true, { rate: 0.9, pitch: 1.3, volume: 1.0 });
        } else if (turnPoints === 170) {
            _speak(phrase, true, { rate: 0.95, pitch: 1.2, volume: 1.0 });
        } else {
            _speak(phrase, false);
        }
    }

    function announceBust() {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.bust();
        _speak('Bust!', true);
    }

    function announceCheckout(points) {
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
        var phrase = _phraseScore(points) + '... checkout!';
        _speak(phrase, true);
    }

    function announceCricketWin(playerName) {
        if (!_enabled) return;
        _speak(playerName + ', You are winner! Hah! Hah! Hah!', true, { rate: 0.88, pitch: 1.25, volume: 1.0 });
    }

    function announceTimer(phrase) {
        if (!_enabled) return;
        _speak(phrase, true);
    }

    // ------------------------------------------------------------------

    return {
        isSupported:        isSupported,
        isEnabled:          isEnabled,
        setEnabled:         setEnabled,
        unlock:             unlock,
        speak:              speak,
        announceDartScore:  announceDartScore,
        announceWelcome:    announceWelcome,
        announcePlayer:     announcePlayer,
        announceShanghai:   announceShanghai,
        announceTurnEnd:    announceTurnEnd,
        announceBust:       announceBust,
        announceCheckout:   announceCheckout,
        announceCricketWin: announceCricketWin,
        announceTimer:      announceTimer,
    };

}());