import { initDatabase, getDb } from './db/database.js';
import { loadCheckouts } from './engines/scoringEngine.js';
import { CHECKOUTS } from '../data/checkouts.js';

loadCheckouts(CHECKOUTS);

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

const LEGACY_SCRIPTS = [
    '/js/checkout.js',
    '/js/sounds.js',
    '/js/speech.js',
    '/js/api.js',
    '/js/ui.js',
    '/js/cpu.js',
    '/js/stats.js',
    '/js/analysis.js',
    '/js/practice.js',
    '/js/cricket.js',
    '/js/shanghai.js',
    '/js/race1000.js',
    '/js/bermuda.js',
    '/js/nine_lives.js',
    '/js/killer.js',
    '/js/baseball.js',
    '/js/app.js',
];

async function boot() {
    try {
        // Load all legacy scripts in order
        for (const src of LEGACY_SCRIPTS) {
            await loadScript(src);
        }
        console.log('[main] Legacy scripts loaded');

        // Initialise database
        await initDatabase();
        window._db = getDb();
        console.log('[main] Database ready');

        // Signal app.js to initialise
        window.dispatchEvent(new Event('dbready'));

    } catch (err) {
        console.error('[main] Boot failed:', err);
        document.getElementById('app').innerHTML =
            `<div style="padding:40px;color:red;font-family:sans-serif;">
                <h2>Startup Error</h2>
                <p>${err.message}</p>
             </div>`;
    }
}

boot();