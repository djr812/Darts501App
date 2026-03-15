import { processThrow, validateThrow, calculatePoints, isBust, isCheckout, loadCheckouts, suggestedCheckouts } from './engines/scoringEngine.js';
import { CHECKOUTS } from '../data/checkouts.js';

document.addEventListener('DOMContentLoaded', () => {
    const log = document.getElementById('log');

    // Load checkout data into the engine
    loadCheckouts(CHECKOUTS);

    function write(msg, pass = true) {
        log.innerHTML += `<p style="color:${pass ? 'green' : 'red'}">${msg}</p>`;
    }

    function test(label, actual, expected) {
        const pass = JSON.stringify(actual) === JSON.stringify(expected);
        write(`${pass ? '✅' : '❌'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`, pass);
    }

    // Previous scoring tests
    test('Valid single 20',      validateThrow(20, 1).valid, true);
    test('Valid treble 20',      validateThrow(20, 3).valid, true);
    test('Valid bull',           validateThrow(25, 1).valid, true);
    test('Valid bullseye',       validateThrow(25, 2).valid, true);
    test('Invalid treble bull',  validateThrow(25, 3).valid, false);
    test('Invalid segment',      validateThrow(21, 1).valid, false);
    test('Valid miss',           validateThrow(0,  1).valid, true);
    test('S20 = 20',             calculatePoints(20, 1), 20);
    test('D20 = 40',             calculatePoints(20, 2), 40);
    test('T20 = 60',             calculatePoints(20, 3), 60);
    test('Bull = 25',            calculatePoints(25, 1), 25);
    test('DBull = 50',           calculatePoints(25, 2), 50);
    test('Not bust: D20 from 40',    isBust(40, 40, 20, 2), false);
    test('Bust: overshoot',          isBust(10, 20, 20, 1), true);
    test('Bust: stranded on 1',      isBust(21, 20, 20, 1), true);
    test('Bust: zero not on double', isBust(20, 20, 20, 1), true);
    test('Checkout: D20 from 40',    isCheckout(40, 20, 2), true);
    test('No checkout: S20 from 20', isCheckout(20, 20, 1), false);
    test('Checkout: DBull from 50',  isCheckout(50, 25, 2), true);

    const r1 = processThrow({ score: 501, dartNumber: 1 }, 20, 3);
    test('T20 from 501: points=60',      r1.points,       60);
    test('T20 from 501: scoreAfter=441', r1.scoreAfter,   441);
    test('T20 from 501: not bust',       r1.isBust,       false);
    test('T20 from 501: turnComplete=false', r1.turnComplete, false);

    const r2 = processThrow({ score: 40, dartNumber: 2 }, 20, 2);
    test('D20 from 40: isCheckout',   r2.isCheckout,   true);
    test('D20 from 40: isBust=false', r2.isBust,       false);
    test('D20 from 40: scoreAfter=0', r2.scoreAfter,   0);
    test('D20 from 40: turnComplete', r2.turnComplete, true);

    const r3 = processThrow({ score: 20, dartNumber: 1 }, 20, 1);
    test('S20 from 20: isBust',          r3.isBust,       true);
    test('S20 from 20: score unchanged', r3.scoreAfter,   20);
    test('S20 from 20: turnComplete',    r3.turnComplete, true);

    // Checkout suggestions
    test('Checkout 40',  suggestedCheckouts(40),  ["D20"]);
    test('Checkout 100', suggestedCheckouts(100), ["T20", "D20"]);
    test('Checkout 170', suggestedCheckouts(170), ["T20", "T20", "DB"]);
    test('Checkout 169 (impossible)', suggestedCheckouts(169), null);
    test('Checkout 1 (invalid)',      suggestedCheckouts(1),   null);
});