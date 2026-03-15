/**
 * cpu.js
 * ------
 * CPU player logic for single-player mode.
 *
 * Three difficulty levels, each with a pub-themed name:
 *
 *   easy   → "Warm-Up Dummy"
 *     Barely tries. Aims vaguely at the board, frequently hits singles when
 *     going for trebles, misses doubles badly, and sometimes aims at the
 *     wrong target altogether. Very beatable.
 *
 *   medium → "Pub Regular"
 *     Solid club player. Hits trebles most of the time, follows the checkout
 *     table, but cracks under pressure on doubles. Competitive but beatable.
 *
 *   hard   → "League Night"
 *     Methodical and accurate. Rarely misses trebles, closes out doubles
 *     with authority, always takes the optimal setup shot. Tough to beat.
 */

const CPU = (() => {

    // Clockwise board order — used for adjacent-segment drift
    const BOARD_RING = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

    const DART_DELAY       = 1800;  // increased for Daniel voice — phrases avg ~1.5–2s
    const TURN_START_DELAY = 1400;  // allows 'CPU's turn to throw' to finish before first dart

    // ---------------------------------------------------------------------------
    // Difficulty profiles
    //
    // Each profile defines hit-rate probabilities passed to _applyVariance().
    //
    //   treble_hit      : P(hits intended treble)
    //   treble_single   : P(hits single of same segment, given missed treble)
    //                     remainder → adjacent single
    //   double_hit      : P(hits intended double)
    //   double_single   : P(hits single of same segment, given missed double)
    //   double_miss     : P(misses board entirely outside double, given missed double)
    //                     remainder → adjacent single
    //   single_hit      : P(hits intended single)
    //                     remainder → adjacent single
    //   wrong_target_p  : P(ignores strategy and picks a random segment instead)
    //                     (easy mode brain fade)
    // ---------------------------------------------------------------------------

    const DIFFICULTY_PROFILES = {
        easy: {
            label:          'Warm-Up Dummy',
            treble_hit:     0.38,
            treble_single:  0.42,   // often lands in single
            double_hit:     0.32,
            double_single:  0.28,
            double_miss:    0.28,   // frequently misses board
            single_hit:     0.82,
            wrong_target_p: 0.20,   // 20% brain-fade: aims at random segment
        },
        medium: {
            label:          'Pub Regular',
            treble_hit:     0.72,
            treble_single:  0.55,   // of remaining 28%: ~55% single, rest adjacent
            double_hit:     0.62,
            double_single:  0.40,
            double_miss:    0.35,
            single_hit:     0.94,
            wrong_target_p: 0.04,
        },
        hard: {
            label:          'League Night',
            treble_hit:     0.91,
            treble_single:  0.70,
            double_hit:     0.84,
            double_single:  0.50,
            double_miss:    0.20,
            single_hit:     0.98,
            wrong_target_p: 0.00,
        },
    };

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function _parseDart(notation) {
        if (!notation) return null;
        const s = notation.toUpperCase().trim();
        if (s === 'DB') return { segment: 25, multiplier: 2 };
        if (s === 'OB') return { segment: 25, multiplier: 1 };
        const m = s.match(/^([TDS])(\d+)$/);
        if (!m) return null;
        const multiplier = m[1] === 'T' ? 3 : m[1] === 'D' ? 2 : 1;
        return { segment: parseInt(m[2], 10), multiplier };
    }

    function _adjacentSegment(segment) {
        if (segment === 25) return 25;
        const idx = BOARD_RING.indexOf(segment);
        if (idx === -1) return segment;
        const dir = Math.random() < 0.5 ? 1 : -1;
        return BOARD_RING[(idx + dir + BOARD_RING.length) % BOARD_RING.length];
    }

    function _randomSegment() {
        return BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)];
    }

    // ---------------------------------------------------------------------------
    // Variance — applies the difficulty profile to an intended dart
    // ---------------------------------------------------------------------------

    function _applyVariance(segment, multiplier, profile) {
        // Easy mode brain-fade: occasionally throw at a random segment
        if (profile.wrong_target_p > 0 && Math.random() < profile.wrong_target_p) {
            return { segment: _randomSegment(), multiplier: 1 };
        }

        const r = Math.random();

        if (multiplier === 3) {
            if (r < profile.treble_hit)                                 return { segment, multiplier: 3 };
            // Missed treble: split remaining probability between single same and adjacent
            if (r < profile.treble_hit + (1 - profile.treble_hit) * profile.treble_single)
                                                                        return { segment, multiplier: 1 };
            return { segment: _adjacentSegment(segment), multiplier: 1 };
        }

        if (multiplier === 2) {
            if (r < profile.double_hit)                                 return { segment, multiplier: 2 };
            const rem  = 1 - profile.double_hit;
            const pSin = rem * profile.double_single;
            const pMis = rem * profile.double_miss;
            if (r < profile.double_hit + pSin)                         return { segment, multiplier: 1 };
            if (r < profile.double_hit + pSin + pMis)                  return { segment: 0, multiplier: 1 };
            return { segment: _adjacentSegment(segment), multiplier: 1 };
        }

        // Single
        if (r < profile.single_hit) return { segment, multiplier: 1 };
        return { segment: _adjacentSegment(segment), multiplier: 1 };
    }

    // ---------------------------------------------------------------------------
    // Strategy — chooses the intended dart for this position
    // ---------------------------------------------------------------------------

    function _chooseDart(score, suggestion, doubleOut, difficulty) {
        // Follow checkout suggestion if available
        if (suggestion) {
            const parsed = _parseDart(suggestion);
            if (parsed) return parsed;
        }

        // Easy: sometimes just aim at a random high-value segment instead of T20
        if (difficulty === 'easy' && score > 62 && Math.random() < 0.30) {
            const lazytargets = [
                { segment: 20, multiplier: 1 },
                { segment: 19, multiplier: 1 },
                { segment: 5,  multiplier: 1 },
                { segment: 1,  multiplier: 1 },
            ];
            return lazytargets[Math.floor(Math.random() * lazytargets.length)];
        }

        // Score > 62: aim for T20 (occasionally T19 for variety on medium/hard)
        if (score > 62) {
            const r = Math.random();
            if (difficulty === 'hard') {
                if (r < 0.85) return { segment: 20, multiplier: 3 };
                return { segment: 19, multiplier: 3 };
            }
            if (r < 0.78) return { segment: 20, multiplier: 3 };
            if (r < 0.88) return { segment: 19, multiplier: 3 };
            if (r < 0.93) return { segment: 20, multiplier: 1 };
            return { segment: 5, multiplier: 3 };
        }

        // Score 41–62: set up a double
        if (score > 40) {
            const target = score - 32; // aim to leave D16
            if (target > 0 && target <= 20) return { segment: target, multiplier: 1 };
            return { segment: 20, multiplier: 1 };
        }

        // Score ≤ 40: go for the double
        if (score % 2 === 0 && score <= 40) {
            return { segment: score / 2, multiplier: 2 };
        }

        // Odd ≤ 40: hit S1 to make even
        if (score <= 41) return { segment: 1, multiplier: 1 };

        return { segment: 20, multiplier: 3 };
    }

    // ---------------------------------------------------------------------------
    // Public: play a full turn
    // ---------------------------------------------------------------------------

    /**
     * @param {object}   cpuPlayer   - { id, name, score }
     * @param {object}   gameState   - { legId, doubleOut, difficulty }
     * @param {string[]} suggestions - Checkout suggestion slots (mutated in-place)
     * @param {Function} onDart      - async (segment, multiplier, currentScore) => result
     * @param {Function} onTurnEnd   - (lastResult) => void
     */
    async function playTurn(cpuPlayer, gameState, suggestions, onDart, onTurnEnd) {
        const difficulty = gameState.difficulty || 'medium';
        const profile    = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.medium;

        let score       = cpuPlayer.score;
        let dartsThrown = 0;
        let turnOver    = false;
        let lastResult  = null;

        await _delay(TURN_START_DELAY);

        while (dartsThrown < 3 && !turnOver) {
            const suggestion = suggestions && suggestions[dartsThrown] ? suggestions[dartsThrown] : null;
            const intended   = _chooseDart(score, suggestion, gameState.doubleOut, difficulty);
            const actual     = _applyVariance(intended.segment, intended.multiplier, profile);

            lastResult  = await onDart(actual.segment, actual.multiplier, score);
            dartsThrown++;

            if (lastResult.is_bust) {
                score    = cpuPlayer.score;
                turnOver = true;
            } else if (lastResult.is_checkout) {
                score    = 0;
                turnOver = true;
            } else {
                score = lastResult.score_after;
                if (lastResult.turn_complete) turnOver = true;

                if (!turnOver && lastResult.checkout_suggestion) {
                    const remaining = lastResult.checkout_suggestion;
                    for (let i = 0; i < remaining.length; i++) {
                        if (dartsThrown + i < 3) suggestions[dartsThrown + i] = remaining[i];
                    }
                }
            }

            if (!turnOver) await _delay(DART_DELAY);
        }

        onTurnEnd(lastResult);
    }

    function _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Expose difficulty labels so UI can display them
    var LABELS = {};
    Object.keys(DIFFICULTY_PROFILES).forEach(function(k) {
        LABELS[k] = DIFFICULTY_PROFILES[k].label;
    });

    return { playTurn, LABELS };

})();