/**
 * api.js
 * ------
 * Local database API — replaces the Flask REST API.
 * Exposes the same interface as the original api.js so app.js
 * and all game modules need minimal changes.
 */

const API = (() => {

    // ------------------------------------------------------------------
    // Players
    // ------------------------------------------------------------------

    async function getPlayers() {
        const db = window._db;
        const result = await db.query(
            'SELECT id, name FROM players WHERE name != ? ORDER BY name ASC',
            ['CPU']
        );
        return result.values || [];
    }

    async function getCpuPlayer() {
        const db = window._db;
        const result = await db.query(
            'SELECT id, name FROM players WHERE name = ? LIMIT 1',
            ['CPU']
        );
        const rows = result.values || [];
        if (rows.length === 0) throw new Error('CPU player not found');
        return rows[0];
    }

    async function createPlayer(name) {
        const db = window._db;
        const trimmed = name.trim();

        // Check for existing
        const existing = await db.query(
            'SELECT id, name FROM players WHERE LOWER(name) = LOWER(?)',
            [trimmed]
        );
        const rows = existing.values || [];
        if (rows.length > 0) return rows[0];

        const result = await db.run(
            'INSERT INTO players (name) VALUES (?)',
            [trimmed]
        );
        return { id: result.changes.lastId, name: trimmed };
    }

    // ------------------------------------------------------------------
    // Matches
    // ------------------------------------------------------------------

    async function startMatch(config) {
        const db = window._db;

        const result = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win)
             VALUES (?, 'active', ?)`,
            [config.game_type || '501', config.legs_to_win || 1]
        );
        const matchId = result.changes.lastId;

        // Insert match_players
        for (let i = 0; i < config.player_ids.length; i++) {
            await db.run(
                `INSERT INTO match_players (match_id, player_id, position)
                 VALUES (?, ?, ?)`,
                [matchId, config.player_ids[i], i]
            );
        }

        return { id: matchId };
    }

    async function startLeg(config) {
        const db = window._db;
        const result = await db.run(
            `INSERT INTO legs (match_id, leg_number, starting_score)
             VALUES (?, ?, ?)`,
            [config.match_id, 1, config.starting_score || 501]
        );
        return { id: result.changes.lastId };
    }

    async function cancelMatch(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'cancelled',
             completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
        return { ok: true };
    }

    async function restartMatch(matchId) {
        const db = window._db;

        // Delete all legs and related data for this match
        const legs = await db.query(
            'SELECT id FROM legs WHERE match_id = ?', [matchId]
        );
        for (const leg of (legs.values || [])) {
            const turns = await db.query(
                'SELECT id FROM turns WHERE leg_id = ?', [leg.id]
            );
            for (const turn of (turns.values || [])) {
                await db.run('DELETE FROM throws WHERE turn_id = ?', [turn.id]);
            }
            await db.run('DELETE FROM turns WHERE leg_id = ?', [leg.id]);
        }
        await db.run('DELETE FROM legs WHERE match_id = ?', [matchId]);

        // Start a fresh leg
        const legResult = await db.run(
            `INSERT INTO legs (match_id, leg_number, starting_score)
             VALUES (?, 1, 501)`,
            [matchId]
        );
        return { new_leg_id: legResult.changes.lastId };
    }

    // ------------------------------------------------------------------
    // Turns
    // ------------------------------------------------------------------

    async function submitTurn(data) {
        const db = window._db;

        // Calculate total score and bust status from darts
        let scoreBefore = data.score_before;
        let isBust = false;
        let isCheckout = false;
        let totalPoints = 0;

        for (const dart of data.darts) {
            const pts = dart.segment * dart.multiplier;
            const after = scoreBefore - pts;
            if (after < 0 || (after === 1) || (after === 0 && dart.multiplier !== 2)) {
                isBust = true;
                break;
            }
            if (after === 0 && dart.multiplier === 2) {
                isCheckout = true;
                totalPoints += pts;
                scoreBefore = after;
                break;
            }
            totalPoints += pts;
            scoreBefore = after;
        }

        const scoreAfter = isBust ? data.score_before : scoreBefore;

        // Insert turn record
        const turnResult = await db.run(
            `INSERT INTO turns
             (leg_id, player_id, turn_number, score, remaining, is_bust)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                data.leg_id,
                data.player_id,
                data.turn_number || 1,
                totalPoints,
                scoreAfter,
                isBust ? 1 : 0
            ]
        );
        const turnId = turnResult.changes.lastId;

        // Insert individual throws
        for (let i = 0; i < data.darts.length; i++) {
            const dart = data.darts[i];
            await db.run(
                `INSERT INTO throws
                 (turn_id, player_id, segment, multiplier, score, throw_order)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    turnId,
                    data.player_id,
                    dart.segment,
                    dart.multiplier,
                    dart.segment * dart.multiplier,
                    i + 1
                ]
            );
        }

        // Handle checkout — close the leg
        if (isCheckout) {
            await db.run(
                `UPDATE legs SET winner_id = ?, completed_at = datetime('now')
                 WHERE id = ?`,
                [data.player_id, data.leg_id]
            );

            // Check if match is won — count legs won
            const legWins = await db.query(
                `SELECT player_id, COUNT(*) as wins
                 FROM legs WHERE match_id = (
                     SELECT match_id FROM legs WHERE id = ?
                 ) AND winner_id IS NOT NULL
                 GROUP BY player_id`,
                [data.leg_id]
            );

            const matchResult = await db.query(
                'SELECT legs_to_win FROM matches WHERE id = (SELECT match_id FROM legs WHERE id = ?)',
                [data.leg_id]
            );
            const legsToWin = (matchResult.values || [{ legs_to_win: 1 }])[0].legs_to_win;

            // Build legs score object
            const legsScore = {};
            for (const row of (legWins.values || [])) {
                legsScore[row.player_id] = row.wins;
            }

            const playerWins = legsScore[data.player_id] || 1;
            const matchComplete = playerWins >= legsToWin;

            if (matchComplete) {
                await db.run(
                    `UPDATE matches SET status = 'complete',
                     completed_at = datetime('now')
                     WHERE id = (SELECT match_id FROM legs WHERE id = ?)`,
                    [data.leg_id]
                );
            } else {
                // Start next leg
                const legCount = await db.query(
                    'SELECT COUNT(*) as cnt FROM legs WHERE match_id = (SELECT match_id FROM legs WHERE id = ?)',
                    [data.leg_id]
                );
                const nextLegNum = ((legCount.values || [{ cnt: 1 }])[0].cnt || 1) + 1;
                const nextLeg = await db.run(
                    `INSERT INTO legs (match_id, leg_number, starting_score)
                     VALUES ((SELECT match_id FROM legs WHERE id = ?), ?, 501)`,
                    [data.leg_id, nextLegNum]
                );
                return {
                    is_checkout:    true,
                    match_complete: false,
                    legs_score:     legsScore,
                    sets_score:     {},
                    next_leg_id:    nextLeg.changes.lastId,
                };
            }

            return {
                is_checkout:    true,
                match_complete: matchComplete,
                legs_score:     legsScore,
                sets_score:     {},
            };
        }

        return {
            is_checkout: false,
            is_bust:     isBust,
        };
    }

    // ------------------------------------------------------------------
    // Public interface — mirrors original api.js exactly
    // ------------------------------------------------------------------

    return {
        getPlayers,
        getCpuPlayer,
        createPlayer,
        startMatch,
        startLeg,
        cancelMatch,
        restartMatch,
        submitTurn,
    };

})();

window.API = API;