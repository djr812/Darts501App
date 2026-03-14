import { initDatabase } from './db/database.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDatabase();
        document.getElementById('status').textContent =
            '✅ Database initialised successfully!';
    } catch (err) {
        document.getElementById('status').textContent =
            '❌ Error: ' + err.message;
        console.error(err);
    }
});