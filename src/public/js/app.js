/**
 * app.js
 * ------
 * Main game controller.
 *
 * CPU turns are triggered automatically whenever currentPlayer().isCpu is true.
 * The CPU module handles strategy/variance; this module calls the exact same
 * _recordDart() path a human tap uses, so all server logic is identical.
 */

(() => {

    const state = {
        matchId:          null,
        legId:            null,
        gameType:         '501',
        doubleOut:        true,
        setsToWin:        1,
        legsPerSet:       1,
        startingScore:    501,
        players:          [],   // [{ id, name, score, isCpu }]
        currentIndex:     0,
        legCount:         0,   // increments each leg — used to rotate who throws first
        activeMultiplier: 1,
        activeTurnId:     null,
        dartsThisTurn:    0,
        turnScoreBefore:  null,
        turnComplete:     false,
        legOver:          false,
        cpuTurnRunning:   false,
        cpuDifficulty:    'medium',   // 'easy' | 'medium' | 'hard'
        setsScore:        {},
        legsScore:        {},
        // Pending darts buffer — darts scored locally, not yet sent to server
        pendingDarts:     [],         // [{ segment, multiplier, points, scoreAfter, isBust, isCheckout }]
        pendingCheckoutResult: null,  // cached last-dart result if turn ended in checkout/bust
    };

    // ------------------------------------------------------------------
    // Local scoring engine (mirrors scoring_engine.py exactly)
    // ------------------------------------------------------------------

    const _LocalScoring = (() => {
        function calcPoints(seg, mul) {
            return seg * mul;  // works for bull too: 25*1=25, 25*2=50
        }
        function isBust(scoreBefore, points, mul, doubleOut) {
            const after = scoreBefore - points;
            if (after < 0) return true;
            if (doubleOut) {
                if (after === 1) return true;
                if (after === 0 && mul !== 2) return true;
            }
            return false;
        }
        function isCheckout(scoreBefore, seg, mul, doubleOut) {
            const points = calcPoints(seg, mul);
            const after  = scoreBefore - points;
            if (after !== 0) return false;
            return doubleOut ? mul === 2 : true;
        }
        function processThrow(score, dartNumber, seg, mul, doubleOut) {
            const points       = calcPoints(seg, mul);
            const checkoutFlag = isCheckout(score, seg, mul, doubleOut);
            const bustFlag     = checkoutFlag ? false : isBust(score, points, mul, doubleOut);
            const scoreAfter   = bustFlag ? score : score - points;
            const turnComplete = checkoutFlag || bustFlag || dartNumber === 3;
            return { points, scoreAfter, isBust: bustFlag, isCheckout: checkoutFlag, turnComplete };
        }
        return { processThrow };
    })();

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    async function resolvePlayers(selections) {
        const players = [];
        for (const sel of selections) {
            if (sel.isCpu) {
                // Resolve CPU player: try to fetch the existing record first,
                // create it if it doesn't exist yet. This avoids the 409 conflict
                // that occurs because GET /api/players excludes the CPU name.
                state.cpuDifficulty = sel.difficulty || 'medium';
                let cpuRecord = await API.getCpuPlayer().catch(() => null);
                if (!cpuRecord) {
                    cpuRecord = await API.createPlayer('CPU');
                }
                players.push({ id: cpuRecord.id, name: 'CPU', score: state.startingScore, isCpu: true });
            } else if (sel.mode === 'existing') {
                players.push({ id: sel.id, name: sel.name, score: state.startingScore, isCpu: false });
            } else {
                const created = await API.createPlayer(sel.name);
                players.push({ id: created.id, name: created.name, score: state.startingScore, isCpu: false });
            }
        }
        return players;
    }

    async function onStartGame(config) {
        // Unlock iOS speech engine inside this user gesture (tap on Start Match)
        // so the first programmatic utterance is not silently swallowed by Safari.
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);
        const SCORES = { '501': 501, '201': 201, 'Cricket': 0 };
        state.startingScore = SCORES[config.gameType] || 501;
        state.gameType      = config.gameType;
        state.doubleOut     = config.doubleOut;
        state.setsToWin     = config.setsToWin;
        state.legsPerSet    = config.legsPerSet;
        state.legCount      = 0;   // reset so welcome fires on first leg of every new match

        try {
            const players = await resolvePlayers(config.players);

            const cpuPlayer = players.find(p => p.isCpu);
            const match = await API.startMatch({
                player_ids:     players.map(p => p.id),
                sets_to_win:    config.setsToWin,
                legs_per_set:   config.legsPerSet,
                cpu_difficulty: cpuPlayer ? (state.cpuDifficulty || 'medium') : undefined,
            });
            const leg = await API.startLeg({
                match_id:   match.id,
                game_type:  config.gameType,
                double_out: config.doubleOut,
            });

            state.setsScore = {};
            state.legsScore = {};
            players.forEach(p => { state.setsScore[p.id] = 0; state.legsScore[p.id] = 0; });

            state.matchId = match.id;
            state.legId   = leg.id;
            state.players = players;
            state.pendingDarts = [];
            state.pendingCheckoutResult = null;

            UI.buildShell(players, { onMultiplier, onSegment, onUndo, onNextPlayer, onCancel, onRestart }, config.gameType);
            _startLeg(leg.id);

        } catch (err) {
            UI.showToast(err.message.toUpperCase(), 'bust', 4000);
            console.error('[app] Setup error:', err);
        } finally {
            UI.setLoading(false);
        }
    }

    // ------------------------------------------------------------------
    // Leg lifecycle
    // ------------------------------------------------------------------

    function _startLeg(legId) {
        state.legId            = legId;
        state.legCount         = (state.legCount || 0) + 1;
        state.currentIndex     = (state.legCount - 1) % state.players.length;
        state.activeMultiplier = 1;
        state.activeTurnId     = null;
        state.dartsThisTurn    = 0;
        state.turnScoreBefore  = null;
        state.turnComplete     = false;
        state.legOver          = false;
        state.cpuTurnRunning   = false;
        state.pendingDarts     = [];
        state.pendingCheckoutResult = null;

        state.players.forEach(p => {
            p.score = state.startingScore;
            UI.setStartingScore(p.id, state.startingScore);
            UI.clearDartPills(p.id);
            UI.setCheckoutHint(p.id, null);
            UI.updatePlayerSetLegs(p.id, state.setsScore[p.id] || 0, state.legsScore[p.id] || 0);
        });

        UI.setLegStarter(currentPlayer().id);
        UI.setActivePlayer(currentPlayer().id);
        UI.setMultiplierTab(1);
        UI.setNextPlayerEnabled(false);
        UI.setUndoEnabled(true);
        _updateMatchInfo();
        // Announce welcome on the very first leg of the match only
        if (state.legCount === 1) {
            SPEECH.announceWelcome(state.gameType);
        }
        _beginTurn();
    }

    /** Called at the start of every turn (human or CPU). */
    function _beginTurn() {
        const player = currentPlayer();
        UI.setActivePlayer(player.id);
        UI.setCheckoutPanel(player.score, state.doubleOut);
        SPEECH.announcePlayer(player.name);
        if (player.isCpu) {
            UI.setStatus('CPU IS THINKING...');
            UI.setUndoEnabled(false);
            setTimeout(_runCpuTurn, 1600);  // allow announcePlayer speech to finish
        } else {
            UI.setStatus(`${player.name.toUpperCase()}'S TURN — SELECT MULTIPLIER`);
            UI.setUndoEnabled(true);
        }
    }

    function _updateMatchInfo() {
        const rule = state.doubleOut ? 'DOUBLE OUT' : 'SINGLE OUT';
        UI.setMatchInfo(`${state.gameType} · ${rule} · MATCH ${state.matchId}`);
    }

    // ------------------------------------------------------------------
    // Core dart recording — shared by human and CPU paths
    // ------------------------------------------------------------------

    /**
     * Record a single dart via the API and update state + UI.
     * Returns the raw server response (ThrowResult + optional leg info).
     */
    // _recordDart — LOCAL only, no server call.
    // Scores the dart immediately using the JS engine and buffers it in
    // state.pendingDarts. Server is only contacted on _submitPendingTurn().
    function _recordDart(segment, multiplier) {
        const player = currentPlayer();

        // Capture turn start score on first dart
        if (state.dartsThisTurn === 0) {
            state.turnScoreBefore = player.score;
        }

        const dartNumber = state.dartsThisTurn + 1;
        const result = _LocalScoring.processThrow(
            player.score, dartNumber, segment, multiplier, state.doubleOut
        );

        // Buffer the dart
        state.pendingDarts.push({ segment, multiplier,
            points:     result.points,
            scoreAfter: result.scoreAfter,
            isBust:     result.isBust,
            isCheckout: result.isCheckout,
        });
        state.dartsThisTurn++;

        // Update UI immediately — no loading spinner
        UI.addDartPill(player.id, result.points, multiplier, segment);

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.dart();

        if (!result.isBust) {
            SPEECH.announceDartScore(segment, multiplier, result.points);
        }

        if (result.isBust) {
            player.score = state.turnScoreBefore;
            UI.setScore(player.id, player.score);
            UI.flashCard(player.id, 'bust');
        } else if (result.isCheckout) {
            player.score = 0;
            UI.setScore(player.id, 0);
            UI.flashCard(player.id, 'checkout');
        } else {
            player.score = result.scoreAfter;
            UI.setScore(player.id, player.score);
        }

        UI.setCheckoutPanel(player.score, state.doubleOut);

        // Synthesise result shape expected by callers
        return {
            points:            result.points,
            score_before:      state.turnScoreBefore,
            score_after:       result.scoreAfter,
            is_bust:           result.isBust,
            is_checkout:       result.isCheckout,
            turn_complete:     result.turnComplete,
            checkout_suggestion: null,  // will arrive from server after submit
        };
    }

    // Submit the buffered turn to the server in one request.
    // Called by onNextPlayer (normal end of turn) and onSegment (checkout).
    async function _submitPendingTurn() {
        if (state.pendingDarts.length === 0) return null;
        const player = currentPlayer();
        return API.submitTurn({
            leg_id:       state.legId,
            player_id:    player.id,
            score_before: state.turnScoreBefore,
            darts: state.pendingDarts.map(function(d) {
                return { segment: d.segment, multiplier: d.multiplier };
            }),
        });
    }

    // ------------------------------------------------------------------
    // CPU turn
    // ------------------------------------------------------------------

    function _runCpuTurn() {
        if (state.cpuTurnRunning || state.legOver) return;
        state.cpuTurnRunning = true;

        const cpuPlayer  = currentPlayer();
        const suggestions = []; // populated from server responses as darts land

        CPU.playTurn(
            cpuPlayer,
            { legId: state.legId, doubleOut: state.doubleOut, difficulty: state.cpuDifficulty },
            suggestions,
            // onDart — CPU calls this for each throw
            async (segment, multiplier, currentScore) => {
                const result = await _recordDart(segment, multiplier);

                // Feed server's checkout suggestion back into the suggestions array
                // so CPU.playTurn can use it for subsequent darts
                if (result.checkout_suggestion && Array.isArray(result.checkout_suggestion)) {
                    const dartIdx = state.dartsThisTurn; // already incremented
                    result.checkout_suggestion.forEach((s, i) => {
                        suggestions[dartIdx + i] = s;
                    });
                }

                // Status update during CPU turn
                if (!result.is_bust && !result.is_checkout && !result.turn_complete) {
                    const dartsLeft = 3 - state.dartsThisTurn;
                    UI.setStatus(`CPU — ${cpuPlayer.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
                }

                return result;
            },
            // onTurnEnd — called after all darts thrown
            async (lastResult) => {
                state.cpuTurnRunning = false;

                // Submit CPU's buffered darts to server
                if (state.pendingDarts.length > 0) {
                    try {
                        const serverResult = await _submitPendingTurn();
                        state.pendingDarts = [];
                        // Use server's authoritative leg result for checkout
                        if (lastResult && lastResult.is_checkout && serverResult) {
                            lastResult = serverResult;
                        }
                    } catch (err) {
                        console.error('[app] CPU turn submit error:', err);
                        state.pendingDarts = [];
                    }
                }

                if (lastResult && lastResult.is_checkout) {
                    // CPU won the leg
                    state.legOver      = true;
                    state.turnComplete = true;
                    UI.setStatus('CPU CHECKED OUT!', 'success');
                    UI.showToast('CPU WINS THE LEG!', 'bust', 2500);
                    setTimeout(() => _handleLegWin(lastResult, cpuPlayer), 900);

                } else if (lastResult && lastResult.is_bust) {
                    SPEECH.announceBust();
                    UI.showToast('CPU BUST!', 'bust', 1800);
                    UI.setStatus('CPU BUST!', 'bust');
                    state.turnComplete = true;
                    // Auto-advance after pause so human can see the bust
                    setTimeout(_advancePlayer, 2200);  // allow bust announcement to finish

                } else {
                    // Used 3 darts normally
                    state.turnComplete = true;
                    setTimeout(_advancePlayer, 2000);  // allow turn-end announcement to finish
                }
            }
        );
    }

    // ------------------------------------------------------------------
    // Player rotation
    // ------------------------------------------------------------------

    function _advancePlayer() {
        if (state.legOver) return;

        const oldPlayer = currentPlayer();
        UI.clearDartPills(oldPlayer.id);

        state.currentIndex     = (state.currentIndex + 1) % state.players.length;
        state.dartsThisTurn    = 0;
        state.turnComplete     = false;
        state.activeTurnId     = null;
        state.turnScoreBefore  = null;
        state.activeMultiplier = 1;
        state.pendingDarts     = [];
        state.pendingCheckoutResult = null;

        UI.setMultiplierTab(1);
        UI.setNextPlayerEnabled(false);
        _beginTurn();
    }

    // ------------------------------------------------------------------
    // Leg / set / match resolution
    // ------------------------------------------------------------------

    function _handleLegWin(result, winnerPlayer) {
        if (result.sets_score) {
            Object.keys(result.sets_score).forEach(function(pid) {
                state.setsScore[parseInt(pid)] = result.sets_score[pid];
            });
        }
        if (result.legs_score) {
            Object.keys(result.legs_score).forEach(function(pid) {
                state.legsScore[parseInt(pid)] = result.legs_score[pid];
            });
        }

        if (result.match_complete) {
            UI.showCongratsModal(
                winnerPlayer.name,
                state.players,
                result.sets_score || {},
                _returnToSetup
            );
        } else {
            const setWinnerName = result.set_winner_id
                ? (function(){ var pw = state.players.find(function(p){ return p.id === result.set_winner_id; }); return pw ? pw.name : ''; }())
                : null;

            UI.showLegEndModal(
                {
                    legWinnerName: winnerPlayer.name,
                    setComplete:   result.set_complete || false,
                    setWinnerName,
                    setsScore:     result.sets_score || {},
                    legsScore:     result.legs_score || {},
                    legsPerSet:    state.legsPerSet,
                },
                state.players,
                () => _startLeg(result.next_leg_id)
            );
        }
    }

    async function _returnToSetup() {
        const existing = await API.getPlayers().catch(() => []);
        UI.buildSetupScreen(existing, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
    }

    // ------------------------------------------------------------------
    // Human input handlers
    // ------------------------------------------------------------------

    function onMultiplier(multiplier) {
        if (state.turnComplete || state.legOver || currentPlayer().isCpu) return;
        state.activeMultiplier = multiplier;
        UI.setMultiplierTab(multiplier);
        UI.setStatus(`${_multiplierLabel(multiplier)} — SELECT SEGMENT`);
    }

    async function onSegment(segment, forcedMultiplier = null) {
        if (state.legOver || state.cpuTurnRunning) {
            UI.showToast('CPU IS THROWING...', 'info'); return;
        }
        if (state.turnComplete) {
            UI.showToast('TAP NEXT ▶ TO CONTINUE', 'info'); return;
        }
        if (currentPlayer().isCpu) return;

        const multiplier = forcedMultiplier !== null ? forcedMultiplier : state.activeMultiplier;

        // _recordDart is now instant/local — no spinner needed
        const result = _recordDart(segment, multiplier);

        if (result.is_bust) {
            SPEECH.announceBust();
            UI.showToast('BUST!', 'bust', 2500);
            UI.setStatus('BUST — TAP NEXT ▶', 'bust');
            UI.setCheckoutPanel(currentPlayer().score, state.doubleOut);
            state.turnComplete = true;
            UI.setNextPlayerEnabled(true);

        } else if (result.is_checkout) {
            // Checkout: submit to server now (we need leg-win resolution)
            SPEECH.announceCheckout(state.turnScoreBefore);
            state.legOver      = true;
            state.turnComplete = true;
            UI.setNextPlayerEnabled(false);
            UI.setStatus(`${currentPlayer().name.toUpperCase()} CHECKED OUT!`, 'success');
            UI.setCheckoutPanel(null, state.doubleOut);
            UI.setLoading(true);
            try {
                const serverResult = await _submitPendingTurn();
                state.pendingDarts = [];
                setTimeout(() => _handleLegWin(serverResult, currentPlayer()), 800);
            } catch (err) {
                UI.showToast(`SYNC ERROR: ${err.message}`, 'bust', 4000);
                console.error('[app] Checkout submit error:', err);
            } finally {
                UI.setLoading(false);
            }

        } else if (result.turn_complete) {
            var _turnScored = state.turnScoreBefore - currentPlayer().score;
            SPEECH.announceTurnEnd(_turnScored, currentPlayer().score);
            UI.setStatus('END OF TURN — TAP NEXT ▶');
            state.turnComplete = true;
            UI.setNextPlayerEnabled(true);

        } else {
            const dartsLeft = 3 - state.dartsThisTurn;
            UI.setStatus(`${currentPlayer().score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
        }
    }

    function onUndo() {
        if (currentPlayer().isCpu || state.cpuTurnRunning) return;
        if (state.dartsThisTurn === 0 || state.pendingDarts.length === 0) {
            UI.showToast('NOTHING TO UNDO', 'info'); return;
        }

        // Pop the last dart from the local buffer — no server call
        state.pendingDarts.pop();
        state.dartsThisTurn--;
        state.turnComplete = false;

        // Recalculate player score from scratch using buffered darts
        const player = currentPlayer();
        let score = state.turnScoreBefore;
        for (const d of state.pendingDarts) {
            if (d.isBust) { score = state.turnScoreBefore; break; }
            score = d.scoreAfter;
        }
        if (state.dartsThisTurn === 0) {
            score = state.turnScoreBefore;
            state.turnScoreBefore = null;
        }
        player.score = score;

        // Remove last pill from UI
        const dartsRow = document.getElementById(`darts-${player.id}`);
        if (dartsRow && dartsRow.lastChild) dartsRow.removeChild(dartsRow.lastChild);

        UI.setScore(player.id, player.score);
        UI.setNextPlayerEnabled(false);
        UI.setCheckoutHint(player.id, null);
        UI.setCheckoutPanel(player.score, state.doubleOut);

        const dartsLeft = 3 - state.dartsThisTurn;
        UI.setStatus(`UNDONE — ${player.score} REMAINING — ${dartsLeft} DART${dartsLeft !== 1 ? 'S' : ''} LEFT`);
        UI.showToast('DART UNDONE', 'info', 1500);
    }

    async function onNextPlayer() {
        if (!state.turnComplete || state.cpuTurnRunning || currentPlayer().isCpu) return;

        // Submit pending darts to server, then advance
        if (state.pendingDarts.length > 0) {
            UI.setLoading(true);
            try {
                const serverResult = await _submitPendingTurn();
                state.pendingDarts = [];

                // Apply server's checkout suggestion now that we have it
                if (serverResult && serverResult.checkout_suggestion) {
                    const next = state.players[(state.currentIndex + 1) % state.players.length];
                    if (next) UI.setCheckoutHint(next.id, serverResult.checkout_suggestion);
                }
            } catch (err) {
                UI.showToast(`SYNC ERROR: ${err.message}`, 'bust', 4000);
                console.error('[app] Turn submit error:', err);
                // Still advance — don't block the game on a network hiccup
            } finally {
                UI.setLoading(false);
            }
        }

        _advancePlayer();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function currentPlayer()     { return state.players[state.currentIndex]; }
    function _multiplierLabel(m) { return m === 1 ? 'SINGLE' : m === 2 ? 'DOUBLE' : 'TREBLE'; }

    // ------------------------------------------------------------------
    // Match management — Cancel and Restart
    // ------------------------------------------------------------------

    function onCancel() {
        UI.showConfirmModal({
            title:        'CANCEL MATCH?',
            message:      'The match will be abandoned. Scores are kept in the database but excluded from stats. This cannot be undone.',
            confirmLabel: 'YES, CANCEL',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doCancel,
        });
    }

    async function _doCancel() {
        UI.setLoading(true);
        try {
            await API.cancelMatch(state.matchId);
            var existing = await API.getPlayers().catch(function() { return []; });
            UI.buildSetupScreen(existing, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
        } catch (err) {
            UI.showToast('CANCEL FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
        } finally {
            UI.setLoading(false);
        }
    }

    function onRestart() {
        UI.showConfirmModal({
            title:        'RESTART MATCH?',
            message:      'All scores for this match will be permanently deleted and the match will restart from zero. This cannot be undone.',
            confirmLabel: 'YES, RESTART',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doRestart,
        });
    }

    async function _doRestart() {
        UI.setLoading(true);
        try {
            const result = await API.restartMatch(state.matchId);

            // Reset all player scores locally
            state.players.forEach(function(p) {
                p.score = state.startingScore;
            });
            state.setsScore = {};
            state.legsScore = {};
            state.players.forEach(function(p) {
                state.setsScore[p.id] = 0;
                state.legsScore[p.id] = 0;
            });

            _startLeg(result.new_leg_id);
            UI.showToast('MATCH RESTARTED', 'info', 2000);
        } catch (err) {
            UI.showToast('RESTART FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
        } finally {
            UI.setLoading(false);
        }
    }

    // ------------------------------------------------------------------
    // Stats
    // ------------------------------------------------------------------

    function _onPractice() {
        API.getPlayers().then(function(existing) {
            PRACTICE.showSetup(
                existing,
                // onBack — return to setup screen
                function() {
                    API.getPlayers().then(function(p) {
                        UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                    });
                },
                // onStart — begin the practice session
                function(config) {
                    PRACTICE.start(config, function() {
                        // onEnd — back to setup after session
                        API.getPlayers().then(function(p) {
                            UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                        });
                    });
                }
            );
        });
    }

    function _onCricket() {
        API.getPlayers().then(function(existing) {
            _showCricketSetup(existing);
        });
    }

    function _onShanghai() {
        API.getPlayers().then(function(existing) {
            _showShanghaiSetup(existing);
        });
    }

    function _makeSetupRulesBtn(gameType) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'setup-rules-btn';
        btn.textContent = '📖 VIEW RULES';
        btn.addEventListener('click', function () { UI.showRulesModal(gameType); });
        return btn;
    }

    function _onRace1000() {
        API.getPlayers().then(function (existing) { _showRace1000Setup(existing); });
    }

    function _showRace1000Setup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Race to 1000');

        // Variant
        var varSection = document.createElement('div');
        varSection.className = 'setup-section';
        varSection.innerHTML = '<div class="setup-label">SCORING VARIANT</div>';
        var varRow = document.createElement('div');
        varRow.className = 'setup-option-row';
        var selectedVariant = 'twenties';
        [
            { label: '20s Only', value: 'twenties' },
            { label: 'All Numbers', value: 'all' },
        ].forEach(function (opt) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (opt.value === 'twenties' ? ' selected' : '');
            btn.type = 'button';
            btn.textContent = opt.label;
            btn.addEventListener('click', function () {
                varRow.querySelectorAll('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedVariant = opt.value;
            });
            varRow.appendChild(btn);
        });
        varSection.appendChild(varRow);
        inner.appendChild(varSection);

        // Player count — 1 = vs CPU, 2–4 = multiplayer
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        [1, 2, 3, 4].forEach(function (n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function () {
                countRow.querySelectorAll('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function (difficulty) {
                        UI.renderRace1000PlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderRace1000PlayerSlots(existingPlayers, n, namesSection, null);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderRace1000PlayerSlots(existingPlayers, 2, namesSection, null);

        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn'; startBtn.textContent = 'START MATCH'; startBtn.type = 'button';
        startBtn.addEventListener('click', function () {
            var players = UI.collectRace1000Players(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            RACE1000_GAME.start({ players: players, variant: selectedVariant }, function () {
                API.getPlayers().then(function (p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket,
                        _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('race1000'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link'; backLink.type = 'button'; backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function () {
            API.getPlayers().then(function (p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket,
                    _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _onBermuda() {
        API.getPlayers().then(function (existing) { _showBermudaSetup(existing); });
    }

    function _showBermudaSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Bermuda Triangle');

        // Player count — 1 = vs CPU, 2–4 = multiplayer
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        [1, 2, 3, 4].forEach(function (n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function () {
                countRow.querySelectorAll('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function (difficulty) {
                        UI.renderBermudaPlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderBermudaPlayerSlots(existingPlayers, n, namesSection, null);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderBermudaPlayerSlots(existingPlayers, 2, namesSection, null);

        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn'; startBtn.textContent = 'START MATCH'; startBtn.type = 'button';
        startBtn.addEventListener('click', function () {
            var players = UI.collectBermudaPlayers(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            BERMUDA_GAME.start({ players: players }, function () {
                API.getPlayers().then(function (p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('bermuda'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link'; backLink.type = 'button'; backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function () {
            API.getPlayers().then(function (p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _onNineLives() {
        API.getPlayers().then(function (existing) {
            _showNineLivesSetup(existing);
        });
    }

    function _showNineLivesSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Nine Lives');

        // Player count — 1 = vs CPU, 2–4 = multiplayer
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        [1, 2, 3, 4].forEach(function (n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function () {
                countRow.querySelectorAll('.option-btn').forEach(function (b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function (difficulty) {
                        UI.renderNineLivesPlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderNineLivesPlayerSlots(existingPlayers, n, namesSection, null);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderNineLivesPlayerSlots(existingPlayers, 2, namesSection, null);

        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.type = 'button';
        startBtn.addEventListener('click', function () {
            var players = UI.collectNineLivesPlayers(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            NINE_LIVES_GAME.start({ players: players }, function () {
                API.getPlayers().then(function (p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('nine_lives'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function () {
            API.getPlayers().then(function (p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _onKiller() {
        API.getPlayers().then(function(existing) {
            _showKillerSetup(existing);
        });
    }

    function _showKillerSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Killer');

        // Variant selection
        var variantSection = document.createElement('div');
        variantSection.className = 'setup-section';
        variantSection.innerHTML = '<div class="setup-label">VARIANT</div>';
        var variantRow = document.createElement('div');
        variantRow.className = 'setup-option-row';
        var selectedVariant = 'doubles';
        [
            { value: 'doubles', label: 'DOUBLES', hint: 'Standard' },
            { value: 'triples', label: 'TRIPLES', hint: 'Advanced' },
        ].forEach(function(v) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (v.value === 'doubles' ? ' selected' : '');
            btn.dataset.value = v.value;
            btn.type = 'button';
            btn.innerHTML = v.label + '<span class="option-hint">' + v.hint + '</span>';
            btn.addEventListener('click', function() {
                variantRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedVariant = v.value;
            });
            variantRow.appendChild(btn);
        });
        variantSection.appendChild(variantRow);
        inner.appendChild(variantSection);

        // Player count — 1 = vs CPU, 2-6 = multiplayer
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        [1, 2, 3, 4, 5, 6].forEach(function(n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.dataset.value = n;
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function() {
                countRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function(difficulty) {
                        UI.renderRace1000PlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderCricketPlayerSlots(existingPlayers, n, namesSection);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        // Player slots
        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderCricketPlayerSlots(existingPlayers, 2, namesSection);

        // Start button
        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.type = 'button';
        startBtn.addEventListener('click', function() {
            var players = selectedCount === 1
                ? UI.collectRace1000Players(namesSection)
                : UI.collectCricketPlayers(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            KILLER_GAME.start({ players: players, variant: selectedVariant }, function() {
                API.getPlayers().then(function(p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('killer'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function() {
            API.getPlayers().then(function(p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _onBaseball() {
        API.getPlayers().then(function(existing) {
            _showBaseballSetup(existing);
        });
    }

    function _showBaseballSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Baseball');

        // Player count — 1 = vs CPU, 2-4 = multiplayer
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        [1, 2, 3, 4].forEach(function(n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.dataset.value = n;
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function() {
                countRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function(difficulty) {
                        UI.renderRace1000PlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderCricketPlayerSlots(existingPlayers, n, namesSection);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        // Player slots
        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderCricketPlayerSlots(existingPlayers, 2, namesSection);

        // Start button
        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.type = 'button';
        startBtn.addEventListener('click', function() {
            var players = selectedCount === 1
                ? UI.collectRace1000Players(namesSection)
                : UI.collectCricketPlayers(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            BASEBALL_GAME.start({ players: players }, function() {
                API.getPlayers().then(function(p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('baseball'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function() {
            API.getPlayers().then(function(p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _showCricketSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        // Standard header
        UI.appendSetupHeader(inner, 'Cricket');

        // Player count
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var selectedCount = 2;
        var selectedDifficulty = 'medium';
        [1,2,3,4].forEach(function(n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (n === 2 ? ' selected' : '');
            btn.dataset.value = n;
            btn.type = 'button';
            if (n === 1) {
                btn.innerHTML = '1<span class="option-hint">vs CPU</span>';
            } else {
                btn.textContent = n;
            }
            btn.addEventListener('click', function() {
                countRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedCount = n;
                if (n === 1) {
                    UI.showDifficultyModal(function(difficulty) {
                        selectedDifficulty = difficulty;
                        UI.renderCricketPlayerSlots(existingPlayers, 1, namesSection, difficulty);
                    });
                } else {
                    UI.renderCricketPlayerSlots(existingPlayers, n, namesSection);
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);

        // Player name slots
        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';
        inner.appendChild(namesSection);
        UI.renderCricketPlayerSlots(existingPlayers, 2, namesSection);

        // Start button
        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.type = 'button';
        startBtn.addEventListener('click', function() {
            var players = UI.collectCricketPlayers(namesSection);
            if (!players) return;
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            CRICKET_GAME.start({ players: players, difficulty: selectedDifficulty }, function() {
                API.getPlayers().then(function(p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('cricket'));
        inner.appendChild(startBtn);

        // Back link at bottom
        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function() {
            API.getPlayers().then(function(p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    function _showShanghaiSetup(existingPlayers) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        UI.appendSetupHeader(inner, 'Shanghai');

        // Game length
        var lengthSection = document.createElement('div');
        lengthSection.className = 'setup-section';
        lengthSection.innerHTML = '<div class="setup-label">GAME LENGTH</div>';
        var lengthRow = document.createElement('div');
        lengthRow.className = 'setup-option-row';
        var selectedRounds = 7;
        [
            { rounds: 7,  label: '7 ROUNDS',  hint: 'Short' },
            { rounds: 20, label: '20 ROUNDS', hint: 'Full'  },
        ].forEach(function(opt) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (opt.rounds === 7 ? ' selected' : '');
            btn.dataset.rounds = opt.rounds;
            btn.type = 'button';
            btn.innerHTML = opt.label + '<span class="option-hint">' + opt.hint + '</span>';
            btn.addEventListener('click', function() {
                lengthRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedRounds = opt.rounds;
            });
            lengthRow.appendChild(btn);
        });
        lengthSection.appendChild(lengthRow);
        inner.appendChild(lengthSection);

        // Player count
        var countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        var countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        var namesSection = document.createElement('div');
        namesSection.className = 'setup-section';

        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.type = 'button';
        startBtn.disabled = true;

        [1, 2, 3, 4].forEach(function(n) {
            var btn = document.createElement('button');
            btn.className = 'option-btn count-btn';
            btn.dataset.count = n;
            btn.type = 'button';
            btn.innerHTML = n === 1 ? '1<span class="option-hint">vs CPU</span>' : String(n);
            btn.addEventListener('click', function() {
                countRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                if (n === 1) {
                    UI.showDifficultyModal(function(difficulty) {
                        UI.renderShanghaiPlayerSlots(existingPlayers, 1, namesSection, difficulty);
                        startBtn.disabled = false;
                    });
                } else {
                    UI.renderShanghaiPlayerSlots(existingPlayers, n, namesSection, null);
                    startBtn.disabled = false;
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        inner.appendChild(countSection);
        inner.appendChild(namesSection);

        startBtn.addEventListener('click', function() {
            var roundsSel = lengthRow.querySelector('.option-btn.selected');
            if (!roundsSel) { UI.showToast('SELECT GAME LENGTH', 'bust', 2000); return; }
            var players = UI.collectShanghaiPlayers(namesSection);
            if (!players) return;
            var cpuPlayer   = players.find(function(p) { return p.isCpu; });
            var cpuDifficulty = cpuPlayer ? (cpuPlayer.difficulty || 'medium') : 'medium';
            SPEECH.unlock();
            if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
            SHANGHAI_GAME.start({
                players:      players,
                numRounds:    parseInt(roundsSel.dataset.rounds, 10),
                cpuDifficulty: cpuDifficulty,
            }, function() {
                API.getPlayers().then(function(p) {
                    UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
                });
            });
        });
        inner.appendChild(_makeSetupRulesBtn('shanghai'));
        inner.appendChild(startBtn);

        var backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', function() {
            API.getPlayers().then(function(p) {
                UI.buildSetupScreen(p, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
        inner.appendChild(backLink);
    }

    async function _onViewStats() {
        const allPlayers = await API.getPlayers().catch(() => []);
        const humans = allPlayers.filter(p => p.name !== 'CPU');
        if (humans.length === 0) {
            UI.showToast('NO PLAYERS YET — PLAY A MATCH FIRST', 'info', 3000);
            return;
        }
        STATS.showPlayerPicker(humans, (player) => {
            STATS.showStatsScreen(player, async () => {
                // Back button → return to setup screen
                const existing = await API.getPlayers().catch(() => []);
                UI.buildSetupScreen(existing, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
            });
        });
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------

    async function init() {
        const existing = await API.getPlayers().catch(() => []);
        UI.buildSetupScreen(existing, onStartGame, _onViewStats, _onPractice, _onCricket, _onShanghai, _onBaseball, _onKiller, _onNineLives, _onBermuda, _onRace1000);
    }

    window.addEventListener('dbready', init);

})();