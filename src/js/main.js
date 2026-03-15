import { initDatabase } from './db/database.js';
import { createPlayer, getAllPlayers, renamePlayer, deletePlayer } from './db/players.js';

document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');
    const log = document.getElementById('log');

    function write(msg) {
        log.innerHTML += `<p>${msg}</p>`;
        console.log(msg);
    }

    try {
        await initDatabase();
        status.textContent = '✅ Database ready';

        // Clean up any leftover test players first
        const before = await getAllPlayers();
        for (const p of before) {
            await deletePlayer(p.id);
        }
        write(`Cleared ${before.length} existing player(s)`);

        // Create some players
        const alice = await createPlayer('Alice');
        write(`Created: ${alice.name} (id=${alice.id})`);

        const bob = await createPlayer('Bob');
        write(`Created: ${bob.name} (id=${bob.id})`);

        // List all players
        const players = await getAllPlayers();
        write(`All players: ${players.map(p => p.name).join(', ')}`);

        // Rename one
        const renamed = await renamePlayer(alice.id, 'Alice2');
        write(`Renamed to: ${renamed.name}`);

        // Delete one
        await deletePlayer(bob.id);
        write(`Deleted Bob`);

        // Final list
        const remaining = await getAllPlayers();
        write(`Remaining: ${remaining.map(p => p.name).join(', ')}`);

    } catch (err) {
        status.textContent = '❌ Error: ' + err.message;
        console.error(err);
    }
});