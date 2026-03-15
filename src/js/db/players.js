import { initDatabase } from './database.js';

/**
 * Get all players ordered by name
 */
export async function getAllPlayers() {
    const db = await initDatabase();
    const result = await db.query(
        'SELECT id, name, created_at FROM players ORDER BY name ASC',
        []
    );
    return result.values || [];
}

/**
 * Get a single player by ID
 */
export async function getPlayerById(id) {
    const db = await initDatabase();
    const result = await db.query(
        'SELECT id, name, created_at FROM players WHERE id = ?',
        [id]
    );
    const rows = result.values || [];
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Create a new player
 * Returns the new player object including the generated ID
 */
export async function createPlayer(name) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Player name cannot be empty');

    const db = await initDatabase();

    // Check for duplicate name
    const existing = await db.query(
        'SELECT id FROM players WHERE LOWER(name) = LOWER(?)',
        [trimmed]
    );
    if ((existing.values || []).length > 0) {
        throw new Error(`A player named "${trimmed}" already exists`);
    }

    const result = await db.run(
        'INSERT INTO players (name) VALUES (?)',
        [trimmed]
    );

    return {
        id: result.changes.lastId,
        name: trimmed
    };
}

/**
 * Rename an existing player
 */
export async function renamePlayer(id, newName) {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Player name cannot be empty');

    const db = await initDatabase();

    // Check for duplicate name (excluding this player)
    const existing = await db.query(
        'SELECT id FROM players WHERE LOWER(name) = LOWER(?) AND id != ?',
        [trimmed, id]
    );
    if ((existing.values || []).length > 0) {
        throw new Error(`A player named "${trimmed}" already exists`);
    }

    await db.run(
        'UPDATE players SET name = ? WHERE id = ?',
        [trimmed, id]
    );

    return await getPlayerById(id);
}

/**
 * Delete a player by ID
 */
export async function deletePlayer(id) {
    const db = await initDatabase();
    await db.run(
        'DELETE FROM players WHERE id = ?',
        [id]
    );
}