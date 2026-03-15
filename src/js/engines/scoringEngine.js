/**
 * scoringEngine.js
 * ----------------
 * Pure JavaScript scoring engine for 501 darts.
 *
 * All functions are stateless — they receive the current game state as
 * input and return a result. The database layer is responsible for
 * persisting state.
 *
 * Ported from app/services/scoring_engine.py
 */

// ---------------------------------------------------------------------------
// Result container
// ---------------------------------------------------------------------------

export class ThrowResult {
    /**
     * @param {number}  points       - Points scored by this dart (0 if bust)
     * @param {number}  scoreAfter   - Player's remaining score after this dart
     * @param {boolean} isBust       - True if the throw resulted in a bust
     * @param {boolean} isCheckout   - True if the throw won the leg
     * @param {boolean} turnComplete - True if the turn is now over
     * @param {string}  error        - Non-empty string if throw was rejected
     */
    constructor(points, scoreAfter, isBust, isCheckout, turnComplete, error) {
        this.points       = points;
        this.scoreAfter   = scoreAfter;
        this.isBust       = isBust;
        this.isCheckout   = isCheckout;
        this.turnComplete = turnComplete;
        this.error        = error;
    }

    toString() {
        return `ThrowResult(points=${this.points}, scoreAfter=${this.scoreAfter}, ` +
               `isBust=${this.isBust}, isCheckout=${this.isCheckout}, ` +
               `turnComplete=${this.turnComplete}, error='${this.error}')`;
    }
}


// ---------------------------------------------------------------------------
// Checkout table — loaded once at module import time
// ---------------------------------------------------------------------------

let CHECKOUTS = {};

/**
 * Load checkout suggestions from a JSON object.
 * Call this once at app startup with the imported checkouts data.
 * @param {Object} data - The parsed checkouts.json object
 */
export function loadCheckouts(data) {
    CHECKOUTS = data || {};
}


// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a segment/multiplier combination is physically possible
 * on a standard dartboard.
 *
 * Bull (segment 25) only accepts multiplier 1 (outer bull, 25pts)
 * or multiplier 2 (bullseye, 50pts). Treble bull does not exist.
 *
 * Segment 0 represents a miss (no score). Multiplier must be 1.
 *
 * @param {number} segment    - Board segment (0-20 or 25)
 * @param {number} multiplier - 1=single, 2=double, 3=treble
 * @returns {{ valid: boolean, error: string }}
 */
export function validateThrow(segment, multiplier) {
    if (segment === 25) {
        if (multiplier !== 1 && multiplier !== 2) {
            return { valid: false, error: 'Bull only accepts multiplier 1 (25pts) or 2 (50pts)' };
        }
        return { valid: true, error: '' };
    }

    if (segment < 0 || segment > 20) {
        return { valid: false, error: `Invalid segment: ${segment}. Must be 0-20 or 25 (bull)` };
    }

    if (multiplier < 1 || multiplier > 3) {
        return { valid: false, error: `Invalid multiplier: ${multiplier}. Must be 1 (single), 2 (double), or 3 (treble)` };
    }

    return { valid: true, error: '' };
}


// ---------------------------------------------------------------------------
// Points calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the points value of a dart.
 *
 * Assumes validateThrow() has already been called.
 *
 * @param {number} segment    - Board segment (0-20 or 25)
 * @param {number} multiplier - 1=single, 2=double, 3=treble
 * @returns {number} Points scored
 */
export function calculatePoints(segment, multiplier) {
    if (segment === 25) {
        return 25 * multiplier; // 25 or 50
    }
    return segment * multiplier;
}


// ---------------------------------------------------------------------------
// Bust detection
// ---------------------------------------------------------------------------

/**
 * Determine whether a dart results in a bust.
 *
 * Bust conditions (doubleOut=true, standard rules):
 *   1. scoreAfter < 0  — went below zero
 *   2. scoreAfter == 1 — stranded; no double scores 1
 *   3. scoreAfter == 0 — reached zero but NOT on a double
 *
 * Bust conditions (doubleOut=false, single out):
 *   1. scoreAfter < 0  — went below zero only
 *
 * @param {number}  scoreBefore - Player's score before this dart
 * @param {number}  points      - Points scored by this dart
 * @param {number}  segment     - Segment hit
 * @param {number}  multiplier  - Multiplier of the dart
 * @param {boolean} doubleOut   - True = must finish on a double (default)
 * @returns {boolean}
 */
export function isBust(scoreBefore, points, segment, multiplier, doubleOut = true) {
    const scoreAfter = scoreBefore - points;

    if (scoreAfter < 0) return true; // Overshot — always a bust

    if (doubleOut) {
        if (scoreAfter === 1) return true;           // Stranded
        if (scoreAfter === 0 && multiplier !== 2) return true; // Must finish on double
    }

    return false;
}


// ---------------------------------------------------------------------------
// Checkout detection
// ---------------------------------------------------------------------------

/**
 * Determine whether a dart completes the leg (checkout).
 *
 * doubleOut=true  (standard): scoreAfter must be 0 AND multiplier must be 2.
 * doubleOut=false (single out): scoreAfter must be 0, any multiplier valid.
 *
 * D-Bull (segment=25, multiplier=2) is always a valid checkout in both modes.
 *
 * @param {number}  scoreBefore - Player's score before this dart
 * @param {number}  segment     - Segment hit
 * @param {number}  multiplier  - Multiplier of the dart
 * @param {boolean} doubleOut   - True = double required to finish
 * @returns {boolean}
 */
export function isCheckout(scoreBefore, segment, multiplier, doubleOut = true) {
    const points     = calculatePoints(segment, multiplier);
    const scoreAfter = scoreBefore - points;

    if (scoreAfter !== 0) return false;

    if (doubleOut) {
        return multiplier === 2; // Must be a double
    }

    return true; // Single out: any dart reaching zero wins
}


// ---------------------------------------------------------------------------
// Primary interface
// ---------------------------------------------------------------------------

/**
 * Process a single dart throw and return the full outcome.
 *
 * This is the main entry point. It orchestrates validation, scoring,
 * bust detection, and checkout detection in the correct order.
 *
 * Checkout is evaluated BEFORE bust — a valid finish is never a bust.
 *
 * @param {Object}  state             - Current game state
 * @param {number}  state.score       - Player's current remaining score
 * @param {number}  state.dartNumber  - Which dart in the turn this is (1, 2, or 3)
 * @param {number}  segment           - Board segment hit (0-20 or 25)
 * @param {number}  multiplier        - 1=single, 2=double, 3=treble
 * @param {boolean} doubleOut         - True = must finish on a double (default)
 * @returns {ThrowResult}
 */
export function processThrow(state, segment, multiplier, doubleOut = true) {
    const scoreBefore  = state.score;
    const dartNumber   = state.dartNumber;

    // --- Validate the throw first ---
    const { valid, error } = validateThrow(segment, multiplier);
    if (!valid) {
        return new ThrowResult(0, scoreBefore, false, false, false, error);
    }

    const points = calculatePoints(segment, multiplier);

    // --- Checkout must be checked before bust ---
    // A dart landing on zero via a double is a checkout, not a bust.
    // Evaluate checkout first and skip bust check if confirmed.
    const isCheckoutFlag = isCheckout(scoreBefore, segment, multiplier, doubleOut);
    const isBustFlag     = isCheckoutFlag ? false : isBust(
        scoreBefore, points, segment, multiplier, doubleOut
    );

    // Turn ends on: checkout, bust, or using all 3 darts
    const turnComplete = isCheckoutFlag || isBustFlag || (dartNumber === 3);

    // On a bust the score does not change — reversion to turn-start score
    // is handled by the database layer using the stored score_before value.
    const scoreAfter = isBustFlag ? scoreBefore : scoreBefore - points;

    return new ThrowResult(
        points,
        scoreAfter,
        isBustFlag,
        isCheckoutFlag,
        turnComplete,
        ''
    );
}


// ---------------------------------------------------------------------------
// Checkout suggestions
// ---------------------------------------------------------------------------

/**
 * Return a suggested dart combination to finish from the given score.
 *
 * Covers all valid finishes from 2 to 170.
 * Returns null for impossible scores or scores outside the valid range.
 *
 * @param {number} score - Player's current remaining score
 * @returns {Array|null} Array of dart suggestion strings, or null
 */
export function suggestedCheckouts(score) {
    const impossible = new Set([159, 162, 163, 165, 166, 168, 169]);

    if (impossible.has(score) || score < 2 || score > 170) {
        return null;
    }

    return CHECKOUTS[String(score)] || null;
}