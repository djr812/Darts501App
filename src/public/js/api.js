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
    // Public interface
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
    };

})();

window.API = API;