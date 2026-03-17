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
    // Matches (501/201)
    // ------------------------------------------------------------------

    async function startMatch(config) {
        const db = window._db;
        const result = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win)
             VALUES (?, 'active', ?)`,
            [config.game_type || '501', config.legs_to_win || 1]
        );
        const matchId = result.changes.lastId;
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
        const legResult = await db.run(
            `INSERT INTO legs (match_id, leg_number, starting_score)
             VALUES (?, 1, 501)`,
            [matchId]
        );
        return { new_leg_id: legResult.changes.lastId };
    }

    // ------------------------------------------------------------------
    // Turns (501/201)
    // ------------------------------------------------------------------

    async function submitTurn(data) {
        const db = window._db;
        let scoreBefore = data.score_before;
        let isBust = false;
        let isCheckout = false;
        let totalPoints = 0;

        for (const dart of data.darts) {
            const pts = dart.segment * dart.multiplier;
            const after = scoreBefore - pts;
            if (after < 0 || after === 1 || (after === 0 && dart.multiplier !== 2)) {
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

        const turnResult = await db.run(
            `INSERT INTO turns
             (leg_id, player_id, turn_number, score, remaining, is_bust)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [data.leg_id, data.player_id, data.turn_number || 1,
             totalPoints, scoreAfter, isBust ? 1 : 0]
        );
        const turnId = turnResult.changes.lastId;

        for (let i = 0; i < data.darts.length; i++) {
            const dart = data.darts[i];
            await db.run(
                `INSERT INTO throws
                 (turn_id, player_id, segment, multiplier, score, throw_order)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [turnId, data.player_id, dart.segment, dart.multiplier,
                 dart.segment * dart.multiplier, i + 1]
            );
        }

        if (isCheckout) {
            await db.run(
                `UPDATE legs SET winner_id = ?, completed_at = datetime('now')
                 WHERE id = ?`,
                [data.player_id, data.leg_id]
            );
            const legWins = await db.query(
                `SELECT player_id, COUNT(*) as wins FROM legs
                 WHERE match_id = (SELECT match_id FROM legs WHERE id = ?)
                 AND winner_id IS NOT NULL GROUP BY player_id`,
                [data.leg_id]
            );
            const matchResult = await db.query(
                `SELECT legs_to_win FROM matches
                 WHERE id = (SELECT match_id FROM legs WHERE id = ?)`,
                [data.leg_id]
            );
            const legsToWin = ((matchResult.values || [])[0] || { legs_to_win: 1 }).legs_to_win;
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
                const legCount = await db.query(
                    `SELECT COUNT(*) as cnt FROM legs
                     WHERE match_id = (SELECT match_id FROM legs WHERE id = ?)`,
                    [data.leg_id]
                );
                const nextLegNum = (((legCount.values || [])[0] || { cnt: 1 }).cnt || 1) + 1;
                const nextLeg = await db.run(
                    `INSERT INTO legs (match_id, leg_number, starting_score)
                     VALUES ((SELECT match_id FROM legs WHERE id = ?), ?, 501)`,
                    [data.leg_id, nextLegNum]
                );
                return {
                    is_checkout: true,
                    match_complete: false,
                    legs_score: legsScore,
                    sets_score: {},
                    next_leg_id: nextLeg.changes.lastId,
                };
            }
            return {
                is_checkout: true,
                match_complete: matchComplete,
                legs_score: legsScore,
                sets_score: {},
            };
        }

        return { is_checkout: false, is_bust: isBust };
    }

    // ------------------------------------------------------------------
    // Cricket — internal helpers
    // ------------------------------------------------------------------

    async function _buildCricketState(matchId, overrides) {
        const db = window._db;

        const players = await db.query(
            `SELECT p.id, p.name FROM match_players mp
             JOIN players p ON p.id = mp.player_id
             WHERE mp.match_id = ? ORDER BY mp.position`,
            [matchId]
        );
        const playerList = players.values || [];

        const marksRows = await db.query(
            `SELECT player_id, number, marks FROM cricket_marks
             WHERE match_id = ?`,
            [matchId]
        );
        const scoresRows = await db.query(
            `SELECT player_id, score FROM cricket_scores
             WHERE match_id = ?`,
            [matchId]
        );
        const matchRow = await db.query(
            `SELECT status FROM matches WHERE id = ?`, [matchId]
        );

        const marks = {};
        for (const row of (marksRows.values || [])) {
            const pid = String(row.player_id);
            if (!marks[pid]) marks[pid] = {};
            marks[pid][String(row.number)] = row.marks;
        }

        const scores = {};
        for (const row of (scoresRows.values || [])) {
            scores[String(row.player_id)] = row.score;
        }

        const status = ((matchRow.values || [])[0] || { status: 'active' }).status;
        const firstPlayerId = playerList.length > 0 ? String(playerList[0].id) : null;

        return {
            match_id:            matchId,
            players:             playerList,
            marks:               marks,
            scores:              scores,
            status:              status,
            winner_id:           (overrides && overrides.winner_id) || null,
            current_player_id:   (overrides && overrides.current_player_id) || firstPlayerId,
            current_turn_number: (overrides && overrides.current_turn_number) || 1,
            darts_this_turn:     (overrides && overrides.darts_this_turn) || 0,
        };
    }

    // ------------------------------------------------------------------
    // Cricket — public
    // ------------------------------------------------------------------

    async function createCricketMatch(config) {
        const db = window._db;

        const matchResult = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win)
             VALUES ('Cricket', 'active', 1)`
        );
        const matchId = matchResult.changes.lastId;

        for (let i = 0; i < config.player_ids.length; i++) {
            await db.run(
                `INSERT INTO match_players (match_id, player_id, position)
                 VALUES (?, ?, ?)`,
                [matchId, config.player_ids[i], i]
            );
        }

        await db.run(
            `INSERT INTO cricket_matches (match_id, status) VALUES (?, 'active')`,
            [matchId]
        );

        const targets = [15, 16, 17, 18, 19, 20, 25];
        for (const playerId of config.player_ids) {
            for (const number of targets) {
                await db.run(
                    `INSERT INTO cricket_marks (match_id, player_id, number, marks)
                     VALUES (?, ?, ?, 0)`,
                    [matchId, playerId, number]
                );
            }
            await db.run(
                `INSERT INTO cricket_scores (match_id, player_id, score)
                 VALUES (?, ?, 0)`,
                [matchId, playerId]
            );
        }

        return await _buildCricketState(matchId);
    }

    async function getCricketMatch(matchId) {
        return await _buildCricketState(matchId);
    }

    async function recordCricketThrow(matchId, data) {
        const db = window._db;
        const playerId   = data.player_id;
        const segment    = data.segment;
        const multiplier = data.multiplier;

        const throwCount = await db.query(
            `SELECT COUNT(*) as cnt FROM cricket_throws WHERE match_id = ?`,
            [matchId]
        );
        const throwOrder = (((throwCount.values || [])[0] || { cnt: 0 }).cnt) + 1;

        await db.run(
            `INSERT INTO cricket_throws
             (match_id, player_id, number, multiplier, throw_order)
             VALUES (?, ?, ?, ?, ?)`,
            [matchId, playerId, segment, multiplier, throwOrder]
        );

        if (segment === 0 || multiplier === 0) {
            const state = await _buildCricketState(matchId);
            return {
                ...state,
                current_player_id:   String(playerId),
                current_turn_number: data.current_turn || 1,
                darts_this_turn:     data.dart_index || 0,
            };
        }

        const playerRows = await db.query(
            `SELECT player_id FROM match_players WHERE match_id = ?
             ORDER BY position`,
            [matchId]
        );
        const playerIds = (playerRows.values || []).map(r => r.player_id);

        const markRow = await db.query(
            `SELECT marks FROM cricket_marks
             WHERE match_id = ? AND player_id = ? AND number = ?`,
            [matchId, playerId, segment]
        );
        const currentMarks = ((markRow.values || [])[0] || { marks: 0 }).marks;
        const totalHits    = currentMarks + multiplier;
        const newMarks     = Math.min(totalHits, 3);
        const extraHits    = totalHits - 3;

        await db.run(
            `UPDATE cricket_marks SET marks = ?
             WHERE match_id = ? AND player_id = ? AND number = ?`,
            [newMarks, matchId, playerId, segment]
        );

        if (extraHits > 0) {
            let allClosed = true;
            for (const pid of playerIds) {
                if (pid === playerId) continue;
                const oppMark = await db.query(
                    `SELECT marks FROM cricket_marks
                     WHERE match_id = ? AND player_id = ? AND number = ?`,
                    [matchId, pid, segment]
                );
                const oppMarks = ((oppMark.values || [])[0] || { marks: 0 }).marks;
                if (oppMarks < 3) { allClosed = false; break; }
            }
            if (!allClosed) {
                const points = (segment === 25 ? 25 : segment) * extraHits;
                await db.run(
                    `UPDATE cricket_scores SET score = score + ?
                     WHERE match_id = ? AND player_id = ?`,
                    [points, matchId, playerId]
                );
            }
        }

        const allMarks = await db.query(
            `SELECT player_id, number, marks FROM cricket_marks WHERE match_id = ?`,
            [matchId]
        );
        const cricketTargets = [15, 16, 17, 18, 19, 20, 25];
        let winnerId = null;

        for (const pid of playerIds) {
            const pidStr = String(pid);
            const playerMarks = (allMarks.values || []).filter(r => String(r.player_id) === pidStr);
            const allClosed = cricketTargets.every(t => {
                const m = playerMarks.find(r => r.number === t);
                return m && m.marks >= 3;
            });
            if (!allClosed) continue;

            const scoreRows = await db.query(
                `SELECT player_id, score FROM cricket_scores WHERE match_id = ?`,
                [matchId]
            );
            const scores = scoreRows.values || [];
            const myScore = (scores.find(r => String(r.player_id) === pidStr) || { score: 0 }).score;
            const maxOpp  = Math.max(0, ...scores
                .filter(r => String(r.player_id) !== pidStr)
                .map(r => r.score));

            if (myScore >= maxOpp) {
                winnerId = pid;
                break;
            }
        }

        if (winnerId) {
            await db.run(
                `UPDATE matches SET status = 'complete',
                 completed_at = datetime('now') WHERE id = ?`,
                [matchId]
            );
            await db.run(
                `UPDATE cricket_matches SET status = 'complete',
                 completed_at = datetime('now') WHERE match_id = ?`,
                [matchId]
            );
        }

        const state = await _buildCricketState(matchId, { winner_id: winnerId });
        return {
            ...state,
            current_player_id:   String(playerId),
            current_turn_number: data.current_turn || 1,
            darts_this_turn:     data.dart_index || 0,
            winner_id:           winnerId,
        };
    }

    async function undoCricketThrow(matchId) {
        const db = window._db;

        const lastThrow = await db.query(
            `SELECT * FROM cricket_throws WHERE match_id = ?
             ORDER BY id DESC LIMIT 1`,
            [matchId]
        );
        const t = (lastThrow.values || [])[0];
        if (!t) return await _buildCricketState(matchId);

        const markRow = await db.query(
            `SELECT marks FROM cricket_marks
             WHERE match_id = ? AND player_id = ? AND number = ?`,
            [matchId, t.player_id, t.number]
        );
        const currentMarks  = ((markRow.values || [])[0] || { marks: 0 }).marks;
        const restoredMarks = Math.max(0, currentMarks - t.multiplier);

        await db.run(
            `UPDATE cricket_marks SET marks = ?
             WHERE match_id = ? AND player_id = ? AND number = ?`,
            [restoredMarks, matchId, t.player_id, t.number]
        );

        const extraHits = currentMarks - 3;
        if (currentMarks >= 3 && extraHits > 0) {
            const points = (t.number === 25 ? 25 : t.number) * extraHits;
            await db.run(
                `UPDATE cricket_scores SET score = MAX(0, score - ?)
                 WHERE match_id = ? AND player_id = ?`,
                [points, matchId, t.player_id]
            );
        }

        await db.run('DELETE FROM cricket_throws WHERE id = ?', [t.id]);
        await db.run(
            `UPDATE matches SET status = 'active', completed_at = NULL WHERE id = ?`,
            [matchId]
        );
        await db.run(
            `UPDATE cricket_matches SET status = 'active', completed_at = NULL
             WHERE match_id = ?`,
            [matchId]
        );

        return await _buildCricketState(matchId);
    }

    async function endCricketMatch(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'cancelled',
             completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
        return { ok: true };
    }

    async function restartCricketMatch(matchId) {
        const db = window._db;
        await db.run('DELETE FROM cricket_throws WHERE match_id = ?', [matchId]);
        await db.run('DELETE FROM cricket_marks WHERE match_id = ?', [matchId]);
        await db.run('DELETE FROM cricket_scores WHERE match_id = ?', [matchId]);

        const playerRows = await db.query(
            `SELECT player_id FROM match_players WHERE match_id = ?
             ORDER BY position`,
            [matchId]
        );
        const targets = [15, 16, 17, 18, 19, 20, 25];
        for (const row of (playerRows.values || [])) {
            for (const number of targets) {
                await db.run(
                    `INSERT INTO cricket_marks (match_id, player_id, number, marks)
                     VALUES (?, ?, ?, 0)`,
                    [matchId, row.player_id, number]
                );
            }
            await db.run(
                `INSERT INTO cricket_scores (match_id, player_id, score)
                 VALUES (?, ?, 0)`,
                [matchId, row.player_id]
            );
        }

        await db.run(
            `UPDATE matches SET status = 'active', completed_at = NULL WHERE id = ?`,
            [matchId]
        );
        await db.run(
            `UPDATE cricket_matches SET status = 'active', completed_at = NULL
             WHERE match_id = ?`,
            [matchId]
        );

        return await _buildCricketState(matchId);
    }

    // ------------------------------------------------------------------
    // Shanghai — internal helpers
    // ------------------------------------------------------------------

    async function _buildShanghaiState(matchId, overrides) {
        const db = window._db;

        const gameRow = await db.query(
            `SELECT * FROM shanghai_games WHERE match_id = ?`, [matchId]
        );
        const game = (gameRow.values || [])[0] || {};

        const playerRows = await db.query(
            `SELECT p.id, p.name FROM match_players mp
             JOIN players p ON p.id = mp.player_id
             WHERE mp.match_id = ? ORDER BY mp.position`,
            [matchId]
        );
        const playerList = playerRows.values || [];

        const roundRows = await db.query(
            `SELECT * FROM shanghai_rounds WHERE game_id = ? ORDER BY round, player_id`,
            [game.id]
        );
        const allRounds = roundRows.values || [];

        // Build scores: { playerId: totalScore }
        const scores = {};
        for (const p of playerList) {
            scores[String(p.id)] = allRounds
                .filter(r => String(r.player_id) === String(p.id))
                .reduce((sum, r) => sum + (r.score || 0), 0);
        }

        // Build rounds_by_player: { playerId: [{ round_number, score, shanghai }] }
        const roundsByPlayer = {};
        for (const p of playerList) {
            roundsByPlayer[String(p.id)] = allRounds
                .filter(r => String(r.player_id) === String(p.id))
                .map(r => ({
                    round_number: r.round,
                    score:        r.score,
                    shanghai:     r.shanghai === 1,
                }));
        }

        const matchRow = await db.query(
            `SELECT status FROM matches WHERE id = ?`, [matchId]
        );
        const status = ((matchRow.values || [])[0] || { status: 'active' }).status;

        const maxRound     = game.max_round || 7;
        const currentRound = game.current_round || 1;

        // Determine current player: first who hasn't thrown in current round
        const thrownInRound = allRounds
            .filter(r => r.round === currentRound)
            .map(r => String(r.player_id));

        let currentPlayerId = (overrides && overrides.current_player_id)
            ? String(overrides.current_player_id)
            : null;

        if (!currentPlayerId) {
            const nextPlayer = playerList.find(p => !thrownInRound.includes(String(p.id)));
            currentPlayerId = nextPlayer
                ? String(nextPlayer.id)
                : String(playerList[0].id);
        }

        // Target number = current round number (round 1 → target 1, etc.)
        const targetNumber = (overrides && overrides.target_number != null)
            ? overrides.target_number
            : currentRound;

        return {
            match_id:          matchId,
            game_id:           game.id,
            num_rounds:        maxRound,
            target_sequence:   null,
            status:            status,
            winner_id:         (overrides && overrides.winner_id) || null,
            tiebreak:          false,
            current_round:     currentRound,
            target_number:     targetNumber,
            current_player_id: currentPlayerId,
            scores:            scores,
            rounds_by_player:  roundsByPlayer,
            players:           playerList,
        };
    }

    // ------------------------------------------------------------------
    // Shanghai — public
    // ------------------------------------------------------------------

    async function createShanghaiMatch(config) {
        const db = window._db;

        const matchResult = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win)
             VALUES ('Shanghai', 'active', 1)`
        );
        const matchId = matchResult.changes.lastId;

        for (let i = 0; i < config.player_ids.length; i++) {
            await db.run(
                `INSERT INTO match_players (match_id, player_id, position)
                 VALUES (?, ?, ?)`,
                [matchId, config.player_ids[i], i]
            );
        }

        await db.run(
            `INSERT INTO shanghai_games (match_id, max_round, current_round, status)
             VALUES (?, ?, 1, 'active')`,
            [matchId, config.num_rounds || 7]
        );

        return await _buildShanghaiState(matchId);
    }

    async function getShanghaiMatch(matchId) {
        return await _buildShanghaiState(matchId);
    }

    async function submitShanghaiRound(matchId, data) {
        const db = window._db;

        const gameRow = await db.query(
            `SELECT * FROM shanghai_games WHERE match_id = ?`, [matchId]
        );
        const game = (gameRow.values || [])[0];
        if (!game) throw new Error('Shanghai game not found');

        const currentRound = game.current_round;
        const targetNumber = data.target_number || currentRound;
        const darts        = data.darts || [];

        // Record throws
        for (let i = 0; i < darts.length; i++) {
            const dart = darts[i];
            await db.run(
                `INSERT INTO shanghai_throws
                 (game_id, player_id, round, multiplier, throw_order)
                 VALUES (?, ?, ?, ?, ?)`,
                [game.id, data.player_id, currentRound, dart.multiplier, i + 1]
            );
        }

        // Calculate round score — only target number hits count
        let roundScore = 0;
        let hitSingle = false, hitDouble = false, hitTreble = false;
        for (const dart of darts) {
            if (dart.segment === targetNumber) {
                roundScore += targetNumber * dart.multiplier;
                if (dart.multiplier === 1) hitSingle = true;
                if (dart.multiplier === 2) hitDouble = true;
                if (dart.multiplier === 3) hitTreble = true;
            }
        }

        const isShanghai = hitSingle && hitDouble && hitTreble;

        await db.run(
            `INSERT INTO shanghai_rounds (game_id, player_id, round, score, shanghai)
             VALUES (?, ?, ?, ?, ?)`,
            [game.id, data.player_id, currentRound, roundScore, isShanghai ? 1 : 0]
        );

        // Check if all players done this round
        const playerCount = await db.query(
            `SELECT COUNT(*) as cnt FROM match_players WHERE match_id = ?`,
            [matchId]
        );
        const totalPlayers = ((playerCount.values || [])[0] || { cnt: 0 }).cnt;

        const roundDoneRows = await db.query(
            `SELECT COUNT(*) as cnt FROM shanghai_rounds
             WHERE game_id = ? AND round = ?`,
            [game.id, currentRound]
        );
        const roundCount = ((roundDoneRows.values || [])[0] || { cnt: 0 }).cnt;

        let gameComplete = false;
        let winnerId = null;

        if (isShanghai) {
            // Instant win
            gameComplete = true;
            winnerId = data.player_id;
            await db.run(
                `UPDATE shanghai_games SET status = 'complete',
                 completed_at = datetime('now') WHERE id = ?`,
                [game.id]
            );
            await db.run(
                `UPDATE matches SET status = 'complete',
                 completed_at = datetime('now') WHERE id = ?`,
                [matchId]
            );
        } else if (roundCount >= totalPlayers) {
            const nextRound = currentRound + 1;
            if (nextRound > game.max_round) {
                gameComplete = true;
                // Find winner by highest total score
                const scoreRows = await db.query(
                    `SELECT player_id, SUM(score) as total
                     FROM shanghai_rounds WHERE game_id = ?
                     GROUP BY player_id ORDER BY total DESC`,
                    [game.id]
                );
                const topRow = (scoreRows.values || [])[0];
                if (topRow) winnerId = topRow.player_id;

                await db.run(
                    `UPDATE shanghai_games SET status = 'complete',
                     completed_at = datetime('now') WHERE id = ?`,
                    [game.id]
                );
                await db.run(
                    `UPDATE matches SET status = 'complete',
                     completed_at = datetime('now') WHERE id = ?`,
                    [matchId]
                );
            } else {
                await db.run(
                    `UPDATE shanghai_games SET current_round = ? WHERE id = ?`,
                    [nextRound, game.id]
                );
            }
        }

        const state = await _buildShanghaiState(matchId, { winner_id: winnerId });

        return {
            ...state,
            round_result: {
                score:       roundScore,
                is_shanghai: isShanghai,
                tiebreak:    false,
            },
            winner_id: winnerId,
        };
    }

    async function restartShanghaiMatch(matchId) {
        const db = window._db;

        const gameRow = await db.query(
            `SELECT id FROM shanghai_games WHERE match_id = ?`, [matchId]
        );
        const gameId = ((gameRow.values || [])[0] || {}).id;
        if (gameId) {
            await db.run('DELETE FROM shanghai_throws WHERE game_id = ?', [gameId]);
            await db.run('DELETE FROM shanghai_rounds WHERE game_id = ?', [gameId]);
            await db.run(
                `UPDATE shanghai_games SET current_round = 1, status = 'active',
                 completed_at = NULL WHERE id = ?`,
                [gameId]
            );
        }
        await db.run(
            `UPDATE matches SET status = 'active', completed_at = NULL WHERE id = ?`,
            [matchId]
        );
        return await _buildShanghaiState(matchId);
    }

    async function endShanghaiMatch(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'cancelled',
             completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
        return { ok: true };
    }

    // ------------------------------------------------------------------
    // Generic helpers for simple game modes
    // ------------------------------------------------------------------

    // Creates a base match + game record, returns a consistent state shape
    async function _createSimpleMatch(gameType, config, extraInsert) {
        const db = window._db;
        const matchResult = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win) VALUES (?, 'active', 1)`,
            [gameType]
        );
        const matchId = matchResult.changes.lastId;
        for (let i = 0; i < config.player_ids.length; i++) {
            await db.run(
                `INSERT INTO match_players (match_id, player_id, position) VALUES (?, ?, ?)`,
                [matchId, config.player_ids[i], i]
            );
        }
        let gameId = null;
        if (extraInsert) gameId = await extraInsert(matchId);
        return { matchId, gameId };
    }

    async function _getSimplePlayers(matchId) {
        const db = window._db;
        const result = await db.query(
            `SELECT p.id, p.name FROM match_players mp
             JOIN players p ON p.id = mp.player_id
             WHERE mp.match_id = ? ORDER BY mp.position`,
            [matchId]
        );
        return result.values || [];
    }

    function _buildSimpleState(matchId, gameId, players, currentPlayerIndex, extraFields) {
        const currentPlayer = players[currentPlayerIndex] || players[0] || {};
        return {
            match_id:             matchId,
            game_id:              gameId,
            players:              players,
            current_player_index: currentPlayerIndex,
            current_player_id:    currentPlayer.id || null,
            status:               'active',
            winner_id:            null,
            events:               [],
            ...extraFields,
        };
    }

    async function _endSimpleMatch(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
        return { ok: true };
    }

    async function _completeSimpleMatch(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'complete', completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
    }

    // Store throws in a generic JSON blob attached to a match
    // We use legs table as a simple turn log
    async function _logThrows(matchId, playerId, throws) {
        const db = window._db;
        for (let i = 0; i < throws.length; i++) {
            const t = throws[i];
            await db.run(
                `INSERT INTO throws (turn_id, player_id, segment, multiplier, score, throw_order)
                 SELECT id, ?, ?, ?, ?, ?
                 FROM turns WHERE leg_id IN (SELECT id FROM legs WHERE match_id = ?)
                 ORDER BY id DESC LIMIT 1`,
                [playerId, t.segment || 0, t.multiplier || 1,
                 (t.segment || 0) * (t.multiplier || 1), i + 1, matchId]
            );
        }
    }

    async function _ensureTurn(matchId, playerId) {
        const db = window._db;
        // Ensure a leg exists
        let legResult = await db.query(
            'SELECT id FROM legs WHERE match_id = ? LIMIT 1', [matchId]
        );
        let legId;
        if ((legResult.values || []).length === 0) {
            const lr = await db.run(
                `INSERT INTO legs (match_id, leg_number, starting_score) VALUES (?, 1, 0)`,
                [matchId]
            );
            legId = lr.changes.lastId;
        } else {
            legId = legResult.values[0].id;
        }
        // Insert a turn record
        const tr = await db.run(
            `INSERT INTO turns (leg_id, player_id, turn_number, score, remaining, is_bust)
             VALUES (?, ?, 1, 0, 0, 0)`,
            [legId, playerId]
        );
        return { legId, turnId: tr.changes.lastId };
    }

    // ------------------------------------------------------------------
    // Race to 1000
    // ------------------------------------------------------------------

    async function createRace1000Match(config) {
        const db = window._db;
        const { matchId } = await _createSimpleMatch('Race1000', config, async (mid) => {
            const r = await db.run(
                `INSERT INTO legs (match_id, leg_number, starting_score) VALUES (?, 1, 0)`, [mid]
            );
            return r.changes.lastId;
        });
        const players = await _getSimplePlayers(matchId);
        // Give each player a score field
        const playersWithScore = players.map(p => ({ ...p, score: 0 }));
        return _buildSimpleState(matchId, null, playersWithScore, 0, {
            variant: config.variant || 'twenties',
        });
    }

    async function race1000Throw(matchId, data) {
        // Race1000 manages all scoring locally — no DB writes needed
        return { ok: true };
    }

    async function race1000Next(matchId, data) {
        const playerRows = await _getSimplePlayers(matchId);

        // Carry scores forward from data.players (passed by race1000.js _onNext)
        const playersWithScore = playerRows.map(function(p) {
            const existing = (data && data.players)
                ? data.players.find(function(dp) { return String(dp.id) === String(p.id); })
                : null;
            return Object.assign({}, p, { score: existing ? (existing.score || 0) : 0 });
        });

        const currentIndex = (data && data.current_player_index !== undefined)
            ? data.current_player_index : 0;
        const nextIndex = (currentIndex + 1) % playerRows.length;

        // Build scored event for the player who just threw so race1000.js
        // _onNext can update pl.score via scoredEv and speak the turn total
        const events = [];
        if (data && data.players) {
            const currentPlayer = playersWithScore[currentIndex];
            if (currentPlayer) {
                const turnScore = (data.turn_score !== undefined) ? data.turn_score : 0;
                events.push({
                    type:      'scored',
                    player_id: currentPlayer.id,
                    new_score: currentPlayer.score,
                    // turn_points is the delta this turn — used by _speakTurnEnd
                    turn_points: turnScore,
                });
                // Check for win
                if (currentPlayer.score >= 1000) {
                    events.push({
                        type:      'winner',
                        player_id: currentPlayer.id,
                    });
                }
            }
        }

        return _buildSimpleState(matchId, null, playersWithScore, nextIndex, {
            variant:     (data && data.variant) ? data.variant : 'twenties',
            events:      events,
            turn_number: (data && data.turn_number) ? data.turn_number + 1 : 2,
        });
    }

    async function restartRace1000Match(matchId) {
        const players = await _getSimplePlayers(matchId);
        await _completeSimpleMatch(matchId);
        // Create new match with same players
        const playerIds = players.map(p => p.id);
        return createRace1000Match({ player_ids: playerIds, variant: 'twenties' });
    }

    async function endRace1000Match(matchId) {
        return _endSimpleMatch(matchId);
    }

    // ------------------------------------------------------------------
    // Nine Lives
    // ------------------------------------------------------------------

    async function createNineLivesMatch(config) {
        const { matchId } = await _createSimpleMatch('NineLives', config, null);
        const players = await _getSimplePlayers(matchId);
        // Each player starts at target=1, lives=9
        const playersWithState = players.map(p => ({
            ...p, target: 1, lives: 9, eliminated: false, completed: false,
        }));
        return _buildSimpleState(matchId, null, playersWithState, 0, {
            game_id: matchId,
        });
    }

    async function nineLivesThrow(matchId, data) {
        // Nine Lives manages state locally — no DB writes needed for throws
        return { ok: true, events: [] };
    }

    async function nineLivesNext(matchId, data) {
        const playerRows = await _getSimplePlayers(matchId);
        const currentIndex = (data && data.current_player_index !== undefined)
            ? data.current_player_index : 0;
        const hitThisTurn = data ? !!data.hit_this_turn : false;

        // Carry player state forward from data.players
        let players = playerRows.map(function(p) {
            const existing = (data && data.players)
                ? data.players.find(function(dp) { return String(dp.id) === String(p.id); })
                : null;
            return Object.assign({}, p, existing || { target: 1, lives: 9, eliminated: false, completed: false });
        });

        const currentPlayer = players[currentIndex];
        const events = [];

        if (currentPlayer) {
            if (!hitThisTurn) {
                // Miss — deduct a life
                currentPlayer.lives = Math.max(0, (currentPlayer.lives || 1) - 1);
                if (currentPlayer.lives === 0) {
                    currentPlayer.eliminated = true;
                    events.push({ type: 'eliminated', player_id: currentPlayer.id });
                } else {
                    events.push({ type: 'life_lost', player_id: currentPlayer.id, lives_remaining: currentPlayer.lives });
                }
            } else {
                // Hit — advance target
                const newTarget = (currentPlayer.target || 1) + 1;
                if (newTarget > 20) {
                    currentPlayer.completed = true;
                    currentPlayer.target    = 21;
                    events.push({ type: 'winner', player_id: currentPlayer.id });
                } else {
                    currentPlayer.target = newTarget;
                }
            }
        }

        // Check if only one player left alive (last survivor wins)
        const alivePlayers = players.filter(function(p) { return !p.eliminated; });
        if (alivePlayers.length === 1 && players.length > 1) {
            const survivor = alivePlayers[0];
            if (!events.find(function(e) { return e.type === 'winner'; })) {
                events.push({ type: 'winner', player_id: survivor.id });
            }
        }

        // Advance to next non-eliminated player
        let nextIndex = (currentIndex + 1) % players.length;
        let safety = 0;
        while (players[nextIndex] && players[nextIndex].eliminated && safety < players.length) {
            nextIndex = (nextIndex + 1) % players.length;
            safety++;
        }

        return _buildSimpleState(matchId, matchId, players, nextIndex, { events });
    }

    async function restartNineLivesMatch(matchId) {
        const players = await _getSimplePlayers(matchId);
        return createNineLivesMatch({ player_ids: players.map(p => p.id) });
    }

    async function endNineLivesMatch(matchId) {
        return _endSimpleMatch(matchId);
    }

    // ------------------------------------------------------------------
    // Killer
    // ------------------------------------------------------------------

    async function createKillerMatch(config) {
        const { matchId } = await _createSimpleMatch('Killer', config, null);
        const players = await _getSimplePlayers(matchId);

        // Assign random unique numbers 1-20 to each player
        const nums = Array.from({length: 20}, (_, i) => i + 1);
        for (let i = nums.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nums[i], nums[j]] = [nums[j], nums[i]];
        }

        const playersWithState = players.map((p, i) => ({
            ...p,
            assigned_number: nums[i],
            hits:            0,
            is_killer:       false,
            lives:           3,
            eliminated:      false,
        }));

        return _buildSimpleState(matchId, null, playersWithState, 0, {
            game_id: matchId,
            variant: config.variant || 'doubles',
        });
    }

    async function killerThrow(matchId, data) {
        // Killer manages state locally — no DB writes needed for throws
        return { ok: true, events: [] };
    }

    async function killerNext(matchId, data) {
        const playerRows = await _getSimplePlayers(matchId);
        const currentIndex = (data && data.current_player_index !== undefined)
            ? data.current_player_index : 0;

        // Carry full player state (hits, is_killer, lives, eliminated, assigned_number) from data
        const players = playerRows.map(function(p) {
            const existing = (data && data.players)
                ? data.players.find(function(dp) { return String(dp.id) === String(p.id); })
                : null;
            return Object.assign({}, p, existing || {
                assigned_number: null, hits: 0, is_killer: false, lives: 3, eliminated: false
            });
        });

        // Advance to next non-eliminated player
        let nextIndex = (currentIndex + 1) % players.length;
        let safety = 0;
        while (players[nextIndex] && players[nextIndex].eliminated && safety < players.length) {
            nextIndex = (nextIndex + 1) % players.length;
            safety++;
        }

        return _buildSimpleState(matchId, matchId, players, nextIndex, {
            variant: data ? (data.variant || 'doubles') : 'doubles',
            events:  (data && data.events) ? data.events : [],
        });
    }

    async function restartKillerMatch(matchId) {
        const players = await _getSimplePlayers(matchId);
        return createKillerMatch({ player_ids: players.map(p => p.id), variant: 'doubles' });
    }

    async function endKillerMatch(matchId) {
        return _endSimpleMatch(matchId);
    }

    // ------------------------------------------------------------------
    // Bermuda Triangle
    // ------------------------------------------------------------------

    async function createBermudaMatch(config) {
        const { matchId } = await _createSimpleMatch('Bermuda', config, null);
        const players = await _getSimplePlayers(matchId);
        const playersWithScore = players.map(p => ({ ...p, score: 0 }));
        return _buildSimpleState(matchId, null, playersWithScore, 0, {
            current_round: 1,
        });
    }

    async function bermudaThrow(matchId, data) {
        // Bermuda manages scoring locally — no DB writes needed for throws
        return { ok: true };
    }

    async function bermudaNext(matchId, data) {
        const playerRows = await _getSimplePlayers(matchId);
        const currentIndex = (data && data.current_player_index !== undefined)
            ? data.current_player_index : 0;
        const nextIndex = (currentIndex + 1) % playerRows.length;

        // Build events array — carry halved/scored events from data
        const events = (data && data.events) ? data.events : [];

        // Carry scores forward from data.players
        const playersWithScore = playerRows.map(function(p) {
            const existing = (data && data.players)
                ? data.players.find(function(dp) { return String(dp.id) === String(p.id); })
                : null;
            return Object.assign({}, p, { score: existing ? (existing.score || 0) : 0 });
        });

        // Advance round when all players have thrown
        let nextRound = (data && data.current_round) ? data.current_round : 1;
        if (data && data.round_complete) {
            nextRound = Math.min(nextRound + 1, 13);
        }

        return _buildSimpleState(matchId, null, playersWithScore, nextIndex, {
            current_round: nextRound,
            events:        events,
        });
    }

        async function restartBermudaMatch(matchId) {
        const players = await _getSimplePlayers(matchId);
        return createBermudaMatch({ player_ids: players.map(p => p.id) });
    }

    async function endBermudaMatch(matchId) {
        return _endSimpleMatch(matchId);
    }

    // ------------------------------------------------------------------
    // Baseball
    // ------------------------------------------------------------------

    async function createBaseballMatch(config) {
        const { matchId } = await _createSimpleMatch('Baseball', config, null);
        const players = await _getSimplePlayers(matchId);

        // Random start number 1-11
        const startNumber = Math.floor(Math.random() * 11) + 1;

        // Build innings structure: { playerId: { 1: {runs,outs,darts,complete}, ... } }
        const innings = {};
        const totalRuns = {};
        for (const p of players) {
            innings[String(p.id)] = {};
            totalRuns[String(p.id)] = 0;
        }

        return _buildSimpleState(matchId, null, players, 0, {
            game_id:              matchId,
            start_number:         startNumber,
            current_inning:       1,
            innings:              innings,
            total_runs:           totalRuns,
            current_throws:       [],
            darts_in_set:         0,
            high_score_results:   null,
            winner_ids:           null,
        });
    }

    async function recordBaseballThrow(matchId, data) {
        // Baseball manages state locally — no DB writes needed for throws
        return { ok: true };
    }

    async function baseballNext(matchId, data) {
        // Baseball tracks per-player innings independently.
        // All state is managed locally in baseball.js — this function just
        // rotates the player index and echoes the state back unchanged.
        const playerRows  = await _getSimplePlayers(matchId);
        const currentIndex = (data && data.current_player_index !== undefined)
            ? data.current_player_index : 0;
        const numPlayers  = playerRows.length;
        const nextIndex   = (currentIndex + 1) % numPlayers;

        const innings   = (data && data.innings)    ? data.innings    : {};
        const totalRuns = (data && data.total_runs) ? data.total_runs : {};
        const startNum  = (data && data.start_number)   ? data.start_number   : 1;

        // next_inning and status are pre-computed in baseball.js and passed in
        const nextInning = (data && data.next_inning)   ? data.next_inning   : 1;
        const status     = (data && data.status)        ? data.status        : 'active';
        const winnerIds  = (data && data.winner_ids)    ? data.winner_ids    : null;

        const players = playerRows.map(function(p) {
            const existing = (data && data.players)
                ? data.players.find(function(dp) { return String(dp.id) === String(p.id); })
                : null;
            return Object.assign({}, p, existing || {});
        });

        return _buildSimpleState(matchId, matchId, players, nextIndex, {
            start_number:       startNum,
            current_inning:     nextInning,
            innings:            innings,
            total_runs:         totalRuns,
            current_throws:     [],
            darts_in_set:       0,
            winner_ids:         winnerIds,
            high_score_results: null,
            status:             status,
        });
    }

    async function restartBaseballMatch(matchId) {
        const players = await _getSimplePlayers(matchId);
        return createBaseballMatch({ player_ids: players.map(p => p.id) });
    }

    async function endBaseballMatch(matchId) {
        return _endSimpleMatch(matchId);
    }

    // ------------------------------------------------------------------
    // Practice
    // ------------------------------------------------------------------

    async function startPracticeSession(config) {
        const db = window._db;

        // Create a practice match record
        const matchResult = await db.run(
            `INSERT INTO matches (game_type, status, legs_to_win)
             VALUES ('Practice', 'active', 1)`
        );
        const matchId = matchResult.changes.lastId;

        // Link player to match
        await db.run(
            `INSERT INTO match_players (match_id, player_id, position)
             VALUES (?, ?, 0)`,
            [matchId, config.player_id]
        );

        // Create a practice session record
        await db.run(
            `INSERT INTO practice_sessions (player_id, mode)
             VALUES (?, 'free')`,
            [config.player_id]
        );

        // Create a leg
        const legResult = await db.run(
            `INSERT INTO legs (match_id, leg_number, starting_score)
             VALUES (?, 1, 0)`,
            [matchId]
        );
        const legId = legResult.changes.lastId;

        // Create an initial turn
        const turnResult = await db.run(
            `INSERT INTO turns (leg_id, player_id, turn_number, score, remaining, is_bust)
             VALUES (?, ?, 1, 0, 0, 0)`,
            [legId, config.player_id]
        );
        const turnId = turnResult.changes.lastId;

        return {
            match_id: matchId,
            leg_id:   legId,
            turn_id:  turnId,
        };
    }

    async function endPracticeSession(matchId) {
        const db = window._db;
        await db.run(
            `UPDATE matches SET status = 'complete',
             completed_at = datetime('now') WHERE id = ?`,
            [matchId]
        );
        return { ok: true };
    }

    async function recordPracticeThrow(data) {
        const db = window._db;
        await db.run(
            `INSERT INTO practice_throws
             (session_id, player_id, segment, multiplier, score, throw_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [data.session_id || 1, data.player_id, data.segment,
             data.multiplier, data.score, data.throw_order || 1]
        );
        return { ok: true };
    }

    // ------------------------------------------------------------------
    // Public interface
    // ------------------------------------------------------------------


    // ─────────────────────────────────────────────────────────────────
    // Stats API
    // ─────────────────────────────────────────────────────────────────

    async function getPlayerStats(playerId, filters) {
        const db = window._db;

        // ── Records ──────────────────────────────────────────────────
        // Matches played/won (all game types)
        const matchRes = await db.query(`
            SELECT
                COUNT(DISTINCT m.id) AS matches_played,
                SUM(CASE WHEN mp.is_winner = 1 THEN 1 ELSE 0 END) AS matches_won
            FROM match_players mp
            JOIN matches m ON m.id = mp.match_id
            WHERE mp.player_id = ?
              AND m.status IN ('complete','completed')
        `, [playerId]);
        const mr = (matchRes.values || [])[0] || {};

        // Legs played/won (x01 only)
        const legRes = await db.query(`
            SELECT
                COUNT(DISTINCT l.id) AS legs_played,
                SUM(CASE WHEN l.winner_id = ? THEN 1 ELSE 0 END) AS legs_won
            FROM legs l
            JOIN matches m ON m.id = l.match_id
            JOIN match_players mp ON mp.match_id = m.id AND mp.player_id = ?
            WHERE l.completed_at IS NOT NULL
              AND m.game_type IN ('501','201')
        `, [playerId, playerId]);
        const lr = (legRes.values || [])[0] || {};

        // Sets won (x01)
        const setsRes = await db.query(`
            SELECT COUNT(DISTINCT m.id) AS sets_won
            FROM matches m
            JOIN match_players mp ON mp.match_id = m.id
            WHERE mp.player_id = ?
              AND mp.is_winner = 1
              AND m.game_type IN ('501','201')
              AND m.status IN ('complete','completed')
        `, [playerId]);
        const sr = (setsRes.values || [])[0] || {};

        const matchesPlayed = mr.matches_played || 0;
        const matchesWon    = mr.matches_won    || 0;
        const legsPlayed    = lr.legs_played    || 0;
        const legsWon       = lr.legs_won       || 0;
        const matchWinRate  = matchesPlayed > 0 ? Math.round(matchesWon / matchesPlayed * 100) : 0;
        const legWinRate    = legsPlayed    > 0 ? Math.round(legsWon    / legsPlayed    * 100) : 0;

        // ── Scoring (x01 turns) ───────────────────────────────────────
        const turnRes = await db.query(`
            SELECT
                COUNT(*) AS total_turns,
                SUM(t.score) AS total_scored,
                MAX(t.score) AS highest_turn,
                MIN(CASE WHEN t.score > 0 AND t.is_bust = 0 THEN t.score ELSE NULL END) AS lowest_turn,
                SUM(t.is_bust) AS busts,
                SUM(CASE WHEN t.score >= 180 THEN 1 ELSE 0 END) AS one_eighties,
                SUM(CASE WHEN t.score >= 140 AND t.score < 180 THEN 1 ELSE 0 END) AS ton_forties,
                SUM(CASE WHEN t.score >= 100 AND t.score < 140 THEN 1 ELSE 0 END) AS tons
            FROM turns t
            JOIN legs l ON l.id = t.leg_id
            JOIN matches m ON m.id = l.match_id
            WHERE t.player_id = ?
              AND m.game_type IN ('501','201')
              AND t.is_bust = 0
        `, [playerId]);
        const tr = (turnRes.values || [])[0] || {};

        // First 9 darts average
        const first9Res = await db.query(`
            SELECT AVG(sub.first9) AS first9_avg FROM (
                SELECT l.id AS lid, t.player_id,
                    SUM(CASE WHEN t.turn_number <= 3 THEN t.score ELSE 0 END) AS first9
                FROM turns t
                JOIN legs l ON l.id = t.leg_id
                JOIN matches m ON m.id = l.match_id
                WHERE t.player_id = ?
                  AND m.game_type IN ('501','201')
                  AND t.is_bust = 0
                GROUP BY l.id
            ) sub
        `, [playerId]);
        const f9r = (first9Res.values || [])[0] || {};

        // Total darts thrown (x01)
        const dartRes = await db.query(`
            SELECT COUNT(*) AS total_darts, MAX(th.score) AS highest_dart
            FROM throws th
            JOIN turns t ON t.id = th.turn_id
            JOIN legs l ON l.id = t.leg_id
            JOIN matches m ON m.id = l.match_id
            WHERE th.player_id = ?
              AND m.game_type IN ('501','201')
        `, [playerId]);
        const dr = (dartRes.values || [])[0] || {};

        const totalDarts   = dr.total_darts || 0;
        const totalScored  = tr.total_scored || 0;
        const threeDartAvg = totalDarts > 0 ? (totalScored / totalDarts * 3).toFixed(1) : '—';
        const first9Avg    = f9r.first9_avg != null ? parseFloat(f9r.first9_avg).toFixed(1) : '—';

        // ── Checkout stats (x01) ──────────────────────────────────────
        // Find checkout turns (remaining = 0 after turn, not a bust)
        // remaining = 0 and is_bust = 0 means checkout; score = the finishing score (e.g. 32 for D16)
        const coRes = await db.query(`
            SELECT
                MAX(t.score) AS best_checkout,
                AVG(dc.darts) AS avg_darts_to_checkout,
                COUNT(*) AS checkout_count
            FROM turns t
            JOIN legs l ON l.id = t.leg_id
            JOIN matches m ON m.id = l.match_id
            JOIN (SELECT turn_id, COUNT(*) AS darts FROM throws GROUP BY turn_id) dc ON dc.turn_id = t.id
            WHERE t.player_id = ?
              AND t.remaining = 0
              AND t.is_bust = 0
              AND m.game_type IN ('501','201')
        `, [playerId]);
        const cor = (coRes.values || [])[0] || {};

        // Favourite double (most common final dart on checkout turns)
        const favDblRes = await db.query(`
            SELECT th.segment, th.multiplier, COUNT(*) AS cnt
            FROM throws th
            JOIN turns t ON t.id = th.turn_id
            JOIN legs l ON l.id = t.leg_id
            JOIN matches m ON m.id = l.match_id
            WHERE th.player_id = ?
              AND t.remaining = 0
              AND t.is_bust = 0
              AND th.multiplier = 2
              AND m.game_type IN ('501','201')
              AND th.throw_order = (
                  SELECT MAX(th2.throw_order) FROM throws th2 WHERE th2.turn_id = th.turn_id
              )
            GROUP BY th.segment, th.multiplier
            ORDER BY cnt DESC
            LIMIT 1
        `, [playerId]);
        const fdr = (favDblRes.values || [])[0];
        const favDouble = fdr ? {
            notation: (fdr.segment === 25 ? 'BULL' : 'D' + fdr.segment),
            times: fdr.cnt,
        } : null;

        return {
            player: { id: playerId },
            records: {
                matches_played: matchesPlayed,
                matches_won:    matchesWon,
                match_win_rate: matchWinRate,
                legs_played:    legsPlayed,
                legs_won:       legsWon,
                leg_win_rate:   legWinRate,
                sets_won:       sr.sets_won || 0,
                three_dart_avg: threeDartAvg,
            },
            scoring: {
                three_dart_avg: threeDartAvg,
                first9_avg:     first9Avg,
                highest_turn:   tr.highest_turn || 0,
                lowest_turn:    tr.lowest_turn  || '—',
                highest_dart:   dr.highest_dart || 0,
                total_darts:    totalDarts,
                one_eighties:   tr.one_eighties || 0,
                ton_forties:    tr.ton_forties  || 0,
                tons:           tr.tons         || 0,
                busts:          tr.busts        || 0,
            },
            checkout: {
                best_checkout:          cor.best_checkout          || '—',
                best_double_checkout:   cor.best_checkout          || '—',
                best_single_checkout:   '—',
                avg_darts_to_checkout:  cor.avg_darts_to_checkout
                    ? parseFloat(cor.avg_darts_to_checkout).toFixed(1) : '—',
                favourite_double: favDouble,
            },
        };
    }

    async function getPlayerHeatmap(playerId, filters) {
        const db = window._db;
        const matchId = filters && filters.matchId ? filters.matchId : null;

        // Gather throws from x01 games and practice
        let x01Counts = {};
        let practiceMatchId = null;

        if (matchId) {
            // Scoped to a single match — check if it's a practice session
            const mRes = await db.query(`SELECT game_type FROM matches WHERE id = ?`, [matchId]);
            const mRow = (mRes.values || [])[0];
            if (mRow && mRow.game_type === 'practice') {
                practiceMatchId = matchId;
            } else {
                // x01 match
                const throwRes = await db.query(`
                    SELECT th.segment, th.multiplier, COUNT(*) AS cnt
                    FROM throws th
                    JOIN turns t ON t.id = th.turn_id
                    JOIN legs l ON l.id = t.leg_id
                    WHERE l.match_id = ? AND th.player_id = ?
                    GROUP BY th.segment, th.multiplier
                `, [matchId, playerId]);
                (throwRes.values || []).forEach(function(r) {
                    const key = _heatmapKey(r.segment, r.multiplier);
                    if (key) x01Counts[key] = (x01Counts[key] || 0) + r.cnt;
                });
            }
        } else {
            // All x01 throws
            const throwRes = await db.query(`
                SELECT th.segment, th.multiplier, COUNT(*) AS cnt
                FROM throws th
                JOIN turns t ON t.id = th.turn_id
                JOIN legs l ON l.id = t.leg_id
                JOIN matches m ON m.id = l.match_id
                WHERE th.player_id = ?
                  AND m.game_type IN ('501','201')
                GROUP BY th.segment, th.multiplier
            `, [playerId]);
            (throwRes.values || []).forEach(function(r) {
                const key = _heatmapKey(r.segment, r.multiplier);
                if (key) x01Counts[key] = (x01Counts[key] || 0) + r.cnt;
            });

            // All practice throws
            const practiceRes = await db.query(`
                SELECT pt.segment, pt.multiplier, COUNT(*) AS cnt
                FROM practice_throws pt
                WHERE pt.player_id = ?
                GROUP BY pt.segment, pt.multiplier
            `, [playerId]);
            (practiceRes.values || []).forEach(function(r) {
                const key = _heatmapKey(r.segment, r.multiplier);
                if (key) x01Counts[key] = (x01Counts[key] || 0) + r.cnt;
            });
        }

        if (practiceMatchId) {
            // Get practice session id from match
            const sessRes = await db.query(`
                SELECT id FROM practice_sessions
                WHERE player_id = ?
                ORDER BY id DESC LIMIT 1
            `, [playerId]);
            const sessRow = (sessRes.values || [])[0];
            if (sessRow) {
                const practiceRes = await db.query(`
                    SELECT segment, multiplier, COUNT(*) AS cnt
                    FROM practice_throws
                    WHERE session_id = ? AND player_id = ?
                    GROUP BY segment, multiplier
                `, [sessRow.id, playerId]);
                (practiceRes.values || []).forEach(function(r) {
                    const key = _heatmapKey(r.segment, r.multiplier);
                    if (key) x01Counts[key] = (x01Counts[key] || 0) + r.cnt;
                });
            }
        }

        return { counts: x01Counts };
    }

    function _heatmapKey(segment, multiplier) {
        const seg = parseInt(segment, 10);
        const mul = parseInt(multiplier, 10);
        if (seg === 25) return mul === 2 ? 'BULL' : 'OUTER';
        if (seg === 0)  return null; // miss — not tracked on heatmap
        const prefix = mul === 3 ? 'T' : mul === 2 ? 'D' : 'S';
        return prefix + seg;
    }

    async function getPlayerDailyTrend(playerId) {
        const db = window._db;

        // x01 throws per day
        const x01Res = await db.query(`
            SELECT DATE(th.created_at) AS day,
                   COUNT(*) AS darts, SUM(th.score) AS score
            FROM throws th
            JOIN turns t ON t.id = th.turn_id
            JOIN legs l ON l.id = t.leg_id
            JOIN matches m ON m.id = l.match_id
            WHERE th.player_id = ?
              AND m.game_type IN ('501','201')
              AND DATE(th.created_at) >= DATE('now', '-30 days')
            GROUP BY day
        `, [playerId]);

        // Practice throws per day
        const practRes = await db.query(`
            SELECT DATE(pt.created_at) AS day,
                   COUNT(*) AS darts, SUM(pt.score) AS score
            FROM practice_throws pt
            WHERE pt.player_id = ?
              AND DATE(pt.created_at) >= DATE('now', '-30 days')
            GROUP BY day
        `, [playerId]);

        // Merge by day
        const byDay = {};
        (x01Res.values || []).forEach(function(r) {
            if (!byDay[r.day]) byDay[r.day] = { darts: 0, score: 0, sessions: 0 };
            byDay[r.day].darts   += r.darts;
            byDay[r.day].score   += r.score;
            byDay[r.day].sessions += 1;
        });
        (practRes.values || []).forEach(function(r) {
            if (!byDay[r.day]) byDay[r.day] = { darts: 0, score: 0, sessions: 0 };
            byDay[r.day].darts   += r.darts;
            byDay[r.day].score   += r.score;
            byDay[r.day].sessions += 1;
        });

        const days = Object.keys(byDay).sort().map(function(day) {
            const d = byDay[day];
            return {
                date:     day,
                avg:      d.darts > 0 ? parseFloat((d.score / d.darts * 3).toFixed(1)) : 0,
                darts:    d.darts,
                sessions: d.sessions,
            };
        }).filter(function(d) { return d.avg > 0; });

        return { days };
    }

    async function getPlayerHistory(playerId, offset, limit) {
        const db = window._db;
        const lim = limit || 20;
        const off = offset || 0;

        const res = await db.query(`
            SELECT
                m.id AS match_id,
                m.game_type,
                DATE(m.completed_at) AS date,
                mp.is_winner,
                mp2.name AS opponent,
                m.completed_at
            FROM matches m
            JOIN match_players mp  ON mp.match_id  = m.id AND mp.player_id = ?
            LEFT JOIN match_players mp_opp ON mp_opp.match_id = m.id AND mp_opp.player_id != ?
            LEFT JOIN players mp2 ON mp2.id = mp_opp.player_id
            WHERE m.status IN ('complete','completed','cancelled')
            ORDER BY m.completed_at DESC
            LIMIT ? OFFSET ?
        `, [playerId, playerId, lim, off]);

        const rows = res.values || [];

        // Enrich each row with darts + avg
        const sessions = await Promise.all(rows.map(async function(row) {
            const gt = (row.game_type || '').toLowerCase();
            const isPractice = gt === 'practice';

            let darts = 0, avg = '—', score = null, cpuDiff = null;

            if (gt === '501' || gt === '201') {
                const turnRes = await db.query(`
                    SELECT COUNT(th.id) AS darts, SUM(t.score) AS total_score
                    FROM throws th
                    JOIN turns t ON t.id = th.turn_id
                    JOIN legs l ON l.id = t.leg_id
                    WHERE l.match_id = ? AND th.player_id = ?
                `, [row.match_id, playerId]);
                const tr = (turnRes.values || [])[0] || {};
                darts = tr.darts || 0;
                avg   = darts > 0 ? (tr.total_score / darts * 3).toFixed(1) : '—';
            } else if (gt === 'cricket') {
                const dRes = await db.query(`
                    SELECT COUNT(*) AS darts FROM cricket_throws
                    WHERE match_id = ? AND player_id = ?
                `, [row.match_id, playerId]);
                darts = ((dRes.values || [])[0] || {}).darts || 0;
            } else if (gt === 'shanghai') {
                const dRes = await db.query(`
                    SELECT COUNT(*) AS darts FROM shanghai_throws st
                    JOIN shanghai_games sg ON sg.id = st.game_id
                    WHERE sg.match_id = ? AND st.player_id = ?
                `, [row.match_id, playerId]);
                darts = ((dRes.values || [])[0] || {}).darts || 0;
                const scoreRes = await db.query(`
                    SELECT SUM(sr.score) AS total FROM shanghai_rounds sr
                    JOIN shanghai_games sg ON sg.id = sr.game_id
                    WHERE sg.match_id = ? AND sr.player_id = ?
                `, [row.match_id, playerId]);
                score = ((scoreRes.values || [])[0] || {}).total || 0;
            }

            const result = isPractice ? 'PRACTICE'
                : row.is_winner ? 'WIN' : 'LOSS';

            return {
                match_id:   row.match_id,
                game_type:  row.game_type,
                date:       row.date || '—',
                result,
                opponent:   row.opponent || '—',
                darts,
                avg,
                score,
                is_practice: isPractice,
                cpu_difficulty: null,
            };
        }));

        return { sessions };
    }

    async function getMatchScorecard(matchId) {
        const db = window._db;

        const matchRes = await db.query(`SELECT * FROM matches WHERE id = ?`, [matchId]);
        const match = (matchRes.values || [])[0];
        if (!match) throw new Error('Match not found');

        const playerRes = await db.query(`
            SELECT p.id, p.name, mp.is_winner FROM players p
            JOIN match_players mp ON mp.player_id = p.id
            WHERE mp.match_id = ?
            ORDER BY mp.position
        `, [matchId]);
        const players = playerRes.values || [];
        const winnerId = (players.find(p => p.is_winner) || {}).id || null;

        const legRes = await db.query(`
            SELECT * FROM legs WHERE match_id = ? ORDER BY leg_number
        `, [matchId]);
        const legs = legRes.values || [];

        const legsWithTurns = await Promise.all(legs.map(async function(leg) {
            const turnRes = await db.query(`
                SELECT t.id, t.player_id, t.turn_number, t.score, t.remaining,
                       t.is_bust,
                       (t.remaining + t.score) AS score_before
                FROM turns t WHERE t.leg_id = ? ORDER BY t.turn_number, t.player_id
            `, [leg.id]);
            const turns = turnRes.values || [];

            const turnsWithThrows = await Promise.all(turns.map(async function(turn) {
                const throwRes = await db.query(`
                    SELECT segment, multiplier, score,
                           CASE WHEN ? = 0 AND score > 0 THEN 1 ELSE 0 END AS is_checkout
                    FROM throws WHERE turn_id = ? ORDER BY throw_order
                `, [turn.remaining, turn.id]);
                const throwRows = throwRes.values || [];
                return {
                    ...turn,
                    score_after: turn.remaining,
                    is_checkout: turn.remaining === 0 && !turn.is_bust,
                    throws: throwRows.map(function(th) {
                        const mul = th.multiplier;
                        const seg = th.segment;
                        let notation;
                        if (seg === 0) notation = 'MISS';
                        else if (seg === 25) notation = mul === 2 ? 'BULL' : 'OUTER';
                        else notation = (mul === 3 ? 'T' : mul === 2 ? 'D' : '') + seg;
                        return { notation, score: th.score, is_checkout: !!(th.is_checkout) };
                    }),
                };
            }));

            return { ...leg, turns: turnsWithThrows };
        }));

        return {
            match: { ...match, winner_id: winnerId },
            players,
            legs: legsWithTurns,
        };
    }

    async function getGenericScorecard(matchId) {
        const db = window._db;

        const matchRes = await db.query(`SELECT * FROM matches WHERE id = ?`, [matchId]);
        const match = (matchRes.values || [])[0];
        if (!match) throw new Error('Match not found');

        const gt = (match.game_type || '').toLowerCase();

        const playerRes = await db.query(`
            SELECT p.id, p.name, mp.is_winner FROM players p
            JOIN match_players mp ON mp.player_id = p.id
            WHERE mp.match_id = ?
            ORDER BY mp.position
        `, [matchId]);
        const players = playerRes.values || [];
        const winnerId = (players.find(p => p.is_winner) || {}).id || null;

        // For non-01 games without DB storage, return minimal data
        return {
            game_type:    gt,
            match_id:     matchId,
            players,
            winner_id:    winnerId,
            final_scores: {},
            final_states: {},
            turns:        {},
            message:      'Detailed scorecard data is not stored for this game type.',
        };
    }

    async function getShanghaiScorecard(matchId) {
        const db = window._db;

        const matchRes = await db.query(`SELECT * FROM matches WHERE id = ?`, [matchId]);
        const match = (matchRes.values || [])[0];

        const playerRes = await db.query(`
            SELECT p.id, p.name, mp.is_winner FROM players p
            JOIN match_players mp ON mp.player_id = p.id
            WHERE mp.match_id = ? ORDER BY mp.position
        `, [matchId]);
        const players = playerRes.values || [];
        const winnerId = (players.find(p => p.is_winner) || {}).id || null;

        const gameRes = await db.query(`SELECT * FROM shanghai_games WHERE match_id = ?`, [matchId]);
        const game = (gameRes.values || [])[0];
        if (!game) return { game_type: 'shanghai', players, winner_id: winnerId, rounds: {}, throws: {}, totals: {} };

        const roundRes = await db.query(`
            SELECT player_id, round, score, shanghai
            FROM shanghai_rounds WHERE game_id = ?
            ORDER BY round, player_id
        `, [game.id]);

        const throwRes = await db.query(`
            SELECT player_id, round, multiplier, throw_order
            FROM shanghai_throws WHERE game_id = ?
            ORDER BY round, player_id, throw_order
        `, [game.id]);

        // Organise by round
        const rounds = {};
        const throwsByRound = {};
        const totals = {};

        (roundRes.values || []).forEach(function(r) {
            if (!rounds[r.round]) rounds[r.round] = {};
            rounds[r.round][String(r.player_id)] = {
                score:    r.score,
                shanghai: !!r.shanghai,
                target:   r.round, // target = round number for standard Shanghai
            };
            if (!totals[String(r.player_id)]) totals[String(r.player_id)] = 0;
            totals[String(r.player_id)] += r.score;
        });

        (throwRes.values || []).forEach(function(t) {
            if (!throwsByRound[t.round]) throwsByRound[t.round] = {};
            if (!throwsByRound[t.round][String(t.player_id)]) throwsByRound[t.round][String(t.player_id)] = [];
            // Segment for Shanghai is the round target
            const seg = t.round;
            const mul = t.multiplier;
            const pts = (mul === 3 || mul === 2 || mul === 1) ? seg * mul : 0;
            throwsByRound[t.round][String(t.player_id)].push({ seg, mul, pts });
        });

        return {
            game_type: 'shanghai',
            players,
            winner_id: winnerId,
            rounds,
            throws:    throwsByRound,
            totals,
        };
    }

    async function getCricketScorecard(matchId) {
        const db = window._db;

        const playerRes = await db.query(`
            SELECT p.id, p.name, mp.is_winner FROM players p
            JOIN match_players mp ON mp.player_id = p.id
            WHERE mp.match_id = ? ORDER BY mp.position
        `, [matchId]);
        const players = playerRes.values || [];
        const winnerId = (players.find(p => p.is_winner) || {}).id || null;

        // Final marks
        const marksRes = await db.query(`
            SELECT player_id, number, marks FROM cricket_marks WHERE match_id = ?
        `, [matchId]);

        // Final scores
        const scoresRes = await db.query(`
            SELECT player_id, score FROM cricket_scores WHERE match_id = ?
        `, [matchId]);

        // Throws (turn-by-turn)
        const throwRes = await db.query(`
            SELECT player_id, number, multiplier, throw_order, created_at
            FROM cricket_throws WHERE match_id = ?
            ORDER BY created_at, throw_order
        `, [matchId]);

        const finalMarks = {};
        (marksRes.values || []).forEach(function(r) {
            if (!finalMarks[String(r.player_id)]) finalMarks[String(r.player_id)] = {};
            finalMarks[String(r.player_id)][String(r.number)] = r.marks;
        });

        const finalScores = {};
        (scoresRes.values || []).forEach(function(r) {
            finalScores[String(r.player_id)] = r.score;
        });

        // Group throws into turns of 3
        const turnsByPlayer = {};
        (throwRes.values || []).forEach(function(r) {
            const pid = String(r.player_id);
            if (!turnsByPlayer[pid]) turnsByPlayer[pid] = [];
            turnsByPlayer[pid].push(r);
        });

        // Build turns object: { turnNum: { playerId: [darts] } }
        const turns = {};
        players.forEach(function(p) {
            const pid = String(p.id);
            const playerThrows = turnsByPlayer[pid] || [];
            // Group into sets of 3
            for (let i = 0; i < playerThrows.length; i += 3) {
                const tn = Math.floor(i / 3) + 1;
                if (!turns[tn]) turns[tn] = {};
                const slice = playerThrows.slice(i, i + 3);
                turns[tn][pid] = slice.map(function(t) {
                    return {
                        seg:   t.number,
                        mul:   t.multiplier,
                        marks: Math.min(t.multiplier, 3),
                        pts:   0, // scoring pts require complex cricket logic; omit for simplicity
                    };
                });
            }
        });

        return {
            game_type:    'cricket',
            players,
            winner_id:    winnerId,
            final_marks:  finalMarks,
            final_scores: finalScores,
            turns,
        };
    }

    return {
        getPlayers,
        getCpuPlayer,
        createPlayer,
        startMatch,
        startLeg,
        cancelMatch,
        restartMatch,
        submitTurn,
        createCricketMatch,
        getCricketMatch,
        recordCricketThrow,
        undoCricketThrow,
        endCricketMatch,
        restartCricketMatch,
        createShanghaiMatch,
        getShanghaiMatch,
        submitShanghaiRound,
        restartShanghaiMatch,
        endShanghaiMatch,
        createRace1000Match,
        race1000Throw,
        race1000Next,
        restartRace1000Match,
        endRace1000Match,
        createNineLivesMatch,
        nineLivesThrow,
        nineLivesNext,
        restartNineLivesMatch,
        endNineLivesMatch,
        createKillerMatch,
        killerThrow,
        killerNext,
        restartKillerMatch,
        endKillerMatch,
        createBermudaMatch,
        bermudaThrow,
        bermudaNext,
        restartBermudaMatch,
        endBermudaMatch,
        createBaseballMatch,
        recordBaseballThrow,
        baseballNext,
        restartBaseballMatch,
        endBaseballMatch,
        startPracticeSession,
        endPracticeSession,
        recordPracticeThrow,
        getPlayerStats,
        getPlayerHeatmap,
        getPlayerDailyTrend,
        getPlayerHistory,
        getMatchScorecard,
        getGenericScorecard,
        getShanghaiScorecard,
        getCricketScorecard,
    };

})();

window.API = API;