/**
 * baseball.js
 * -----------
 * Multiplayer Baseball Darts game controller.
 *
 * Public API:
 *   BASEBALL_GAME.start(config, onEnd)
 *     config: { players: [{id, name}] }
 *     onEnd:  called when game ends or is abandoned
 */

var BASEBALL_GAME = (function () {

    var _state = {
        matchId:            null,
        gameId:             null,
        players:            [],
        startNumber:        1,
        currentInning:      1,
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        innings:            {},   // { pid: { inningNum: { runs, outs, darts, complete } } }
        totalRuns:          {},   // { pid: total }
        currentThrows:      [],   // throws in current set
        dartsInSet:         0,
        status:             'active',
        winnerIds:          null,
        highScoreResults:   null,
        onEnd:              null,
        // Local UI state
        setComplete:        false,  // board locked after 3rd dart in a set
        inningComplete:     false,  // 3 outs reached — inning is over
        inningEndSpeechDur: 0,      // estimated ms for inning-end speech (used by CPU)
        // CPU
        cpuDifficulty:      'medium',
        cpuTurnRunning:     false,
        cpuPlayerId:        null,
    };

    var _throwHistory  = []; // local undo stack (cleared on NEXT)
    var _pendingThrows = []; // buffered throws for current set, submitted on NEXT
    var _welcomedPlayers = {}; // { playerId: true } — tracks first-turn welcome

    // ─────────────────────────────────────────────────────────────────
    // Public: start
    // ─────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _state.cpuDifficulty  = 'medium';
        _state.cpuTurnRunning = false;
        _state.cpuPlayerId    = null;
        _welcomedPlayers      = {};

        var _resolvedPlayers = [];
        _resolvePlayers(config.players)
            .then(function (players) {
                _resolvedPlayers = players;
                return API.createBaseballMatch({ player_ids: players.map(function (p) { return p.id; }), cpu_difficulty: _state.cpuPlayerId ? _state.cpuDifficulty : undefined });
            })
            .then(function (state) {
                _applyState(state);
                _resolvedPlayers.forEach(function (rp) {
                    var sp = _state.players.find(function (p) { return String(p.id) === String(rp.id); });
                    if (rp.isCpu && sp) sp.isCpu = true;
                });
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                if (_isCpuPlayer(_currentPlayer())) {
                    _runCpuTurn();
                } else {
                    _announceCurrentPlayer(true);
                }
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast((err && err.message ? err.message : 'Error starting game').toUpperCase(), 'bust', 4000);
                console.error('[baseball] start error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Player resolution
    // ─────────────────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        var promises = selections.map(function (sel) {
            if (sel.isCpu || sel.mode === 'cpu') {
                return API.getCpuPlayer().then(function (rec) {
                    if (sel.difficulty) _state.cpuDifficulty = sel.difficulty;
                    _state.cpuPlayerId = String(rec.id);
                    return { id: rec.id, name: 'CPU', isCpu: true };
                });
            }
            if (sel.mode === 'existing') {
                return Promise.resolve({ id: sel.id, name: sel.name, isCpu: false });
            }
            return API.createPlayer(sel.name)
                .then(function (p) { return { id: p.id, name: p.name, isCpu: false }; });
        });
        return Promise.all(promises);
    }

    // ─────────────────────────────────────────────────────────────────
    // State application
    // ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.gameId             = s.game_id;
        var prev = _state.players;
        _state.players            = (s.players || []).map(function (p) {
            var old = prev.find(function (o) { return String(o.id) === String(p.id); });
            return Object.assign({}, p, { isCpu: old ? !!old.isCpu : (p.name === 'CPU') });
        });
        _state.startNumber        = s.start_number;
        _state.currentInning      = s.current_inning;
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
        _state.innings            = s.innings || {};
        _state.totalRuns          = s.total_runs || {};
        _state.currentThrows      = s.current_throws || [];
        _state.dartsInSet         = s.darts_in_set || 0;
        _state.status             = s.status || 'active';
        _state.winnerIds          = s.winner_ids || null;
        _state.highScoreResults   = s.high_score_results || null;

        // NOTE: setComplete / inningComplete are driven by _endSet and _onNext,
        // not derived from server state, to avoid re-locking after NEXT is pressed.
    }

    function _currentInningData() {
        var pid = String(_state.currentPlayerId);
        var inns = _state.innings[pid];
        if (!inns) return null;
        return inns[_state.currentInning] || null;
    }

    function _targetNumber() {
        return _state.startNumber + _state.currentInning - 1;
    }

    function _currentPlayer() {
        return _state.players.find(function (p) {
            return String(p.id) === String(_state.currentPlayerId);
        }) || _state.players[_state.currentPlayerIndex] || null;
    }

    // ─────────────────────────────────────────────────────────────────
    // Screen build
    // ─────────────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-baseball';

        // ── Header ───────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'BASEBALL';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.id = 'bb-mp-subtitle';
        subEl.textContent = _state.players.length + ' PLAYERS · 9 INNINGS';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('baseball'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', _onEnd);
        var restartBtn = document.createElement('button');
        restartBtn.id = 'bbmp-restart-btn';
        restartBtn.className = 'gh-btn gh-btn-red';
        restartBtn.type = 'button';
        restartBtn.textContent = '↺ RESTART';
        restartBtn.addEventListener('click', _onRestart);
        centreSlot.appendChild(endBtn);
        centreSlot.appendChild(restartBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'bbmp-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'bbmp-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar (left column) ─────────────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'bbmp-sidebar';
        sidebar.className = 'bbmp-sidebar';

        // Scoreboard table inside sidebar
        var scoreBoard = document.createElement('div');
        scoreBoard.id = 'bbmp-scoreboard';
        scoreBoard.className = 'bbmp-scoreboard';
        _renderScoreboard(scoreBoard);
        sidebar.appendChild(scoreBoard);

        app.appendChild(sidebar);

        // ── Board (right column) ──────────────────────────────────────
        var board = document.createElement('main');
        board.id = 'bbmp-board';
        board.className = 'bbmp-board';

        // Status banner
        var statusBar = document.createElement('div');
        statusBar.id = 'bbmp-status';
        statusBar.className = 'bbmp-status-banner';
        board.appendChild(statusBar);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'bbmp-pills';
        pills.className = 'bbmp-pills';
        board.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'bbmp-tabs';
        tabs.className = 'bbmp-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.textContent = tab.label;
            UI.addTouchSafeListener(btn, function () {
                if (_state.setComplete) return;
                _state.multiplier = tab.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        board.appendChild(tabs);

        // Segment grid + bull row
        board.appendChild(_buildGrid());
        board.appendChild(_buildBullRow());

        // Footer hint
        var footer = document.createElement('footer');
        footer.className = 'bbmp-footer';
        var footerMsg = document.createElement('span');
        footerMsg.id = 'bbmp-footer-msg';
        footer.appendChild(footerMsg);
        board.appendChild(footer);

        app.appendChild(board);

        _updateStatus();
        _applyTargetHighlight();
    }

    // ─────────────────────────────────────────────────────────────────
    // Segment grid
    // ─────────────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        var target = _targetNumber();
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn' + (seg === target ? ' target-highlight' : '');
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            (function (s) {
                btn.addEventListener('click', function () { _onThrow(s, _state.multiplier); });
            })(seg);
            grid.appendChild(btn);
        }
        return grid;
    }

    function _buildBullRow() {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function () { _onThrow(0, 0); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function () { _onThrow(25, 1); });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function () { _onThrow(25, 2); });
        row.appendChild(bull);

        return row;
    }

    function _applyTargetHighlight() {
        document.querySelectorAll('#bbmp-board .seg-btn').forEach(function (btn) {
            btn.classList.remove('target-highlight');
        });
        var t = _targetNumber();
        var btn = document.querySelector('#bbmp-board .seg-btn[data-segment="' + t + '"]');
        if (btn) btn.classList.add('target-highlight');
    }

    // ─────────────────────────────────────────────────────────────────
    // Scoreboard
    // ─────────────────────────────────────────────────────────────────

    function _renderScoreboard(container) {
        container.innerHTML = '';
        var numInnings = 9;
        var startNum   = _state.startNumber;

        // Header row: blank + inning numbers + total
        var headRow = document.createElement('div');
        headRow.className = 'bbmp-sb-row bbmp-sb-head';
        var nameCell = document.createElement('div');
        nameCell.className = 'bbmp-sb-name';
        headRow.appendChild(nameCell);
        for (var i = 0; i < numInnings; i++) {
            var hCell = document.createElement('div');
            hCell.className = 'bbmp-sb-cell bbmp-sb-inn-head';
            hCell.textContent = startNum + i;
            headRow.appendChild(hCell);
        }
        var totHead = document.createElement('div');
        totHead.className = 'bbmp-sb-cell bbmp-sb-total-head';
        totHead.textContent = 'R';
        headRow.appendChild(totHead);
        container.appendChild(headRow);

        // One row per player
        _state.players.forEach(function (p) {
            var pid  = String(p.id);
            var row  = document.createElement('div');
            row.className = 'bbmp-sb-row' +
                (pid === String(_state.currentPlayerId) ? ' bbmp-sb-active' : '');
            row.id = 'bbmp-row-' + pid;

            var nCell = document.createElement('div');
            nCell.className = 'bbmp-sb-name';
            nCell.textContent = p.name.toUpperCase();
            row.appendChild(nCell);

            for (var inn = 1; inn <= numInnings; inn++) {
                var cell = document.createElement('div');
                var isCurrentCell = (pid === String(_state.currentPlayerId) &&
                                     inn === _state.currentInning);
                cell.className = 'bbmp-sb-cell' +
                    (isCurrentCell ? ' bbmp-sb-cell-current' : '');
                cell.id = 'bbmp-cell-' + pid + '-' + inn;

                var innData = (_state.innings[pid] || {})[inn];
                if (innData && innData.complete) {
                    cell.textContent = innData.runs;
                } else if (isCurrentCell) {
                    var cur = _currentInningData();
                    cell.textContent = cur ? cur.runs : '·';
                } else {
                    cell.textContent = '·';
                }
                row.appendChild(cell);
            }

            var totCell = document.createElement('div');
            totCell.className = 'bbmp-sb-cell bbmp-sb-total';
            totCell.id = 'bbmp-total-' + pid;
            totCell.textContent = _state.totalRuns[pid] || 0;
            row.appendChild(totCell);

            container.appendChild(row);
        });

        // Outs indicators for current player
        var outsRow = document.createElement('div');
        outsRow.className = 'bbmp-outs-row';
        outsRow.id = 'bbmp-outs-row';
        _renderOuts(outsRow);
        container.appendChild(outsRow);
    }

    function _renderOuts(container) {
        container.innerHTML = '';
        var label = document.createElement('span');
        label.className = 'bbmp-outs-label';
        label.textContent = 'OUTS:';
        container.appendChild(label);
        var inn = _currentInningData();
        var outs = inn ? inn.outs : 0;
        for (var i = 0; i < 3; i++) {
            var pip = document.createElement('span');
            pip.className = 'bb-out-pip' + (i < outs ? ' bb-out-pip-on' : '');
            container.appendChild(pip);
        }
    }

    function _updateScoreboard() {
        // Update active row highlight
        _state.players.forEach(function (p) {
            var pid = String(p.id);
            var row = document.getElementById('bbmp-row-' + pid);
            if (row) {
                row.classList.toggle('bbmp-sb-active', pid === String(_state.currentPlayerId));
            }
            // Update all inning cells for this player
            for (var inn = 1; inn <= 9; inn++) {
                var cell = document.getElementById('bbmp-cell-' + pid + '-' + inn);
                if (!cell) continue;
                var isCurrentCell = (pid === String(_state.currentPlayerId) &&
                                     inn === _state.currentInning);
                cell.className = 'bbmp-sb-cell' + (isCurrentCell ? ' bbmp-sb-cell-current' : '');
                var innData = (_state.innings[pid] || {})[inn];
                if (innData && innData.complete) {
                    cell.textContent = innData.runs;
                } else if (isCurrentCell) {
                    var cur = _currentInningData();
                    cell.textContent = cur ? cur.runs : '·';
                } else {
                    cell.textContent = '·';
                }
            }
            var totCell = document.getElementById('bbmp-total-' + pid);
            if (totCell) totCell.textContent = _state.totalRuns[pid] || 0;
        });
        var outsRow = document.getElementById('bbmp-outs-row');
        if (outsRow) _renderOuts(outsRow);
    }

    // ─────────────────────────────────────────────────────────────────
    // Status bar
    // ─────────────────────────────────────────────────────────────────

    function _updateStatus() {
        var banner  = document.getElementById('bbmp-status');
        var footer  = document.getElementById('bbmp-footer-msg');
        var player  = _currentPlayer();
        var name    = player ? player.name.toUpperCase() : '';
        var inn     = _currentInningData();
        var outs    = inn ? inn.outs : 0;
        var target  = _targetNumber();
        if (_state.status !== 'active') {
            if (banner) banner.textContent = 'GAME OVER';
            if (footer) footer.textContent = '';
            return;
        }
        var outsLeft  = 3 - outs;
        var bannerTxt = name + '  —  INNING ' + _state.currentInning + ' / 9  —  TARGET ' + target;
        var footerTxt = outsLeft + (outsLeft === 1 ? ' OUT' : ' OUTS') + ' REMAINING  ·  HIT ' + target + ' TO SCORE RUNS';
        if (banner) banner.textContent = bannerTxt;
        if (footer) footer.textContent = footerTxt;
    }

    // ─────────────────────────────────────────────────────────────────
    // Throw handling
    // ─────────────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        // Enforce max 3 darts per set locally
        if (_pendingThrows.length >= 3) return;

        var target = _targetNumber();
        var isHit  = (segment === target);
        var runs   = isHit ? multiplier : 0;
        var isOut  = !isHit;

        // Buffer the throw
        _pendingThrows.push({ segment: segment, multiplier: multiplier, runs: runs, isOut: isOut });
        _throwHistory.push({ segment: segment, multiplier: multiplier, runs: runs, isOut: isOut });

        // Update local display state
        if (!_state.innings[String(_state.currentPlayerId)]) {
            _state.innings[String(_state.currentPlayerId)] = {};
        }
        var pid = String(_state.currentPlayerId);
        if (!_state.innings[pid][_state.currentInning]) {
            _state.innings[pid][_state.currentInning] = { runs: 0, outs: 0, darts: 0, complete: false };
        }
        var inn = _state.innings[pid][_state.currentInning];
        inn.runs  += runs;
        inn.outs  += isOut ? 1 : 0;
        inn.darts += 1;
        _state.totalRuns[pid] = (_state.totalRuns[pid] || 0) + runs;

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            isHit ? SOUNDS.dart() : (SOUNDS.bust && SOUNDS.bust());
        }

        // Pill
        _addPill(segment, multiplier, runs, isHit);

        // Speech
        _speakDart(isHit, runs);

        _updateScoreboard();
        _updateStatus();

        var undoBtn = document.getElementById('bbmp-undo-btn');
        if (undoBtn) undoBtn.disabled = false;

        // After 3 darts — lock board, enable NEXT
        if (_pendingThrows.length >= 3) {
            _endSet(inn);
        }
    }

    function _endSet(inn) {
        _state.setComplete   = true;
        _state.inningComplete = inn && inn.outs >= 3;

        _lockBoard(true);
        var nb = document.getElementById('bbmp-next-btn');
        if (nb) nb.disabled = false;

        if (_state.inningComplete) {
            _state.inningEndSpeechDur = _speakInningEnd(inn);
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                setTimeout(function () { SOUNDS.checkout && SOUNDS.checkout(); }, 300);
            }
        } else {
            // Announce outs remaining
            if (SPEECH.isEnabled()) {
                var outsLeft = 3 - inn.outs;
                setTimeout(function () {
                    SPEECH.speak(outsLeft + (outsLeft === 1 ? ' out' : ' outs') + ' remaining.', { rate: 1.0, pitch: 1.0 });
                }, 700);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Next
    // ─────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var inningComplete = _state.inningComplete;
        var throwsToSubmit = _pendingThrows.slice(); // copy before clearing

        // Submit buffered throws first, then advance
        var submitPromise = throwsToSubmit.length > 0
            ? API.recordBaseballThrow(_state.matchId, { throws: throwsToSubmit })
            : Promise.resolve(null);

        submitPromise
            .then(function () {
                return API.baseballNext(_state.matchId, { inning_complete: inningComplete });
            })
            .then(function (s) {
                _throwHistory  = [];
                _pendingThrows = [];
                _applyState(s);
                // Must reset AFTER _applyState so it doesn't re-derive them
                _state.setComplete    = false;
                _state.inningComplete = false;
                UI.setLoading(false);

                // Clear pills & reset buttons
                var pills = document.getElementById('bbmp-pills');
                if (pills) pills.innerHTML = '';
                var nb = document.getElementById('bbmp-next-btn');
                if (nb) nb.disabled = true;
                var ub = document.getElementById('bbmp-undo-btn');
                if (ub) ub.disabled = true;
                _lockBoard(false);

                // Reset multiplier tab to Single
                _state.multiplier = 1;
                var tabs = document.getElementById('bbmp-tabs');
                if (tabs) {
                    tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                        b.classList.remove('active-single', 'active-double', 'active-treble');
                    });
                    var s1 = tabs.querySelector('[data-multiplier="1"]');
                    if (s1) s1.classList.add('active-single');
                }
                document.body.dataset.multiplier = 1;

                if (s.status === 'complete') {
                    _showResult(s);
                    return;
                }

                _updateScoreboard();
                _updateStatus();
                _applyTargetHighlight();
                if (_isCpuPlayer(_currentPlayer())) {
                    _runCpuTurn();
                } else {
                    _announceCurrentPlayer(false);
                }
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast('ERROR', 'bust', 3000);
                console.error('[baseball] next error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Undo
    // ─────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_throwHistory.length === 0) return;

        var last = _throwHistory.pop();
        _pendingThrows.pop();

        // Reverse the local state update
        var pid = String(_state.currentPlayerId);
        var inn = _state.innings[pid] && _state.innings[pid][_state.currentInning];
        if (inn) {
            inn.runs  -= last.runs;
            inn.outs  -= last.isOut ? 1 : 0;
            inn.darts -= 1;
        }
        _state.totalRuns[pid] = (_state.totalRuns[pid] || 0) - last.runs;

        // If board was locked after 3rd dart, unlock it
        if (_state.setComplete) {
            _state.setComplete    = false;
            _state.inningComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('bbmp-next-btn');
            if (nb) nb.disabled = true;
        }

        // Remove last pill
        var pills = document.getElementById('bbmp-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('bbmp-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateScoreboard();
        _updateStatus();
    }

    // ─────────────────────────────────────────────────────────────────
    // End / abandon
    // ─────────────────────────────────────────────────────────────────

    function _onRestart() {
        UI.showConfirmModal({
            title:        'RESTART MATCH?',
            message:      'All scores will be wiped and the match will restart from scratch. This cannot be undone.',
            confirmLabel: 'YES, RESTART',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doRestart,
        });
    }

    function _doRestart() {
        UI.setLoading(true);
        API.restartBaseballMatch(_state.matchId)
            .then(function (state) {
                _applyState(state);
                _buildScreen();
                UI.showToast('MATCH RESTARTED', 'info', 2000);
                if (_isCpuPlayer(_currentPlayer())) {
                    _runCpuTurn();
                } else {
                    _announceCurrentPlayer(true);
                }
            })
            .catch(function (err) {
                UI.showToast('RESTART FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
            })
            .finally(function () {
                UI.setLoading(false);
            });
    }

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Baseball match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endBaseballMatch(_state.matchId)
                    .then(function () {
                        UI.setLoading(false);
                        if (_state.onEnd) _state.onEnd();
                    })
                    .catch(function () {
                        UI.setLoading(false);
                        if (_state.onEnd) _state.onEnd();
                    });
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Result screen
    // ─────────────────────────────────────────────────────────────────

    function _showResult(s) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var winnerIds = (s.winner_ids || '').split(',').map(function (x) { return x.trim(); });
        var winners   = _state.players.filter(function (p) {
            return winnerIds.indexOf(String(p.id)) !== -1;
        });
        var isTie     = winners.length > 1;
        var titleText = isTie ? 'TIE GAME!' : (winners.length ? winners[0].name.toUpperCase() + ' WINS!' : 'GAME OVER');

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">' + _esc(titleText) + '</div>' +
            '<div class="setup-subtitle">BASEBALL DARTS — 9 INNINGS</div>' +
            '</div>';

        // Full scorecard
        var scorecard = document.createElement('div');
        scorecard.className = 'bbmp-result-scorecard';
        var headRow = document.createElement('div');
        headRow.className = 'bbmp-result-row bbmp-result-head';
        headRow.innerHTML = '<span class="bbmp-result-name">PLAYER</span>';
        for (var i = 0; i < 9; i++) {
            headRow.innerHTML += '<span class="bbmp-result-cell">' + (_state.startNumber + i) + '</span>';
        }
        headRow.innerHTML += '<span class="bbmp-result-cell bbmp-result-total">TOT</span>';
        scorecard.appendChild(headRow);

        _state.players.forEach(function (p) {
            var pid    = String(p.id);
            var isWin  = winnerIds.indexOf(pid) !== -1;
            var pRow   = document.createElement('div');
            pRow.className = 'bbmp-result-row' + (isWin ? ' bbmp-result-winner' : '');
            pRow.innerHTML = '<span class="bbmp-result-name">' + _esc(p.name.toUpperCase()) + '</span>';
            var total = 0;
            for (var inn = 1; inn <= 9; inn++) {
                var innData = (s.innings[pid] || {})[inn];
                var r = innData ? innData.runs : 0;
                total += r;
                pRow.innerHTML += '<span class="bbmp-result-cell">' + r + '</span>';
            }
            pRow.innerHTML += '<span class="bbmp-result-cell bbmp-result-total">' + total + '</span>';
            scorecard.appendChild(pRow);
        });
        inner.appendChild(scorecard);

        // High score notifications
        if (s.high_score_results) {
            var hsWrap = document.createElement('div');
            hsWrap.className = 'bbmp-hs-wrap';
            s.high_score_results.forEach(function (r) {
                if (!r.is_new_high) return;
                var player = _state.players.find(function (p) { return String(p.id) === String(r.player_id); });
                var name   = player ? player.name : 'Player';
                var line   = document.createElement('div');
                line.className = 'bbmp-hs-line';
                line.textContent = '🏆 ' + name.toUpperCase() + ' — NEW HIGH SCORE: ' + r.high_score;
                hsWrap.appendChild(line);
            });
            if (hsWrap.children.length) inner.appendChild(hsWrap);
        }

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        // Speech
        _speakResult(titleText, s.high_score_results);
    }

    // ─────────────────────────────────────────────────────────────────
    // Board lock
    // ─────────────────────────────────────────────────────────────────

    function _lockBoard(locked) {
        var board = document.getElementById('bbmp-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('bbmp-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (btn) {
            btn.disabled = locked;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Pills
    // ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, runs, isHit) {
        var pills = document.getElementById('bbmp-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0 ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (isHit ? (runs >= 3 ? ' pill-hot' : '') : ' pill-miss');
        pill.textContent = isHit
            ? (segStr + ' — ' + runs + (runs === 1 ? ' RUN' : ' RUNS'))
            : (segStr + ' — OUT');
        pills.appendChild(pill);
    }

    // ─────────────────────────────────────────────────────────────────
    // Speech
    // ─────────────────────────────────────────────────────────────────

    function _speak(text, delay) {
        if (!SPEECH.isEnabled()) return;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(text, { rate: 1.0, pitch: 1.0 });
        }, delay || 200);
    }

    function _announceCurrentPlayer(isFirst) {
        var player = _currentPlayer();
        if (!player) return 0;
        var pid    = String(player.id);
        // If not explicitly told isFirst, derive it from whether we've welcomed them before
        if (isFirst === undefined) {
            isFirst = !_welcomedPlayers[pid];
        }
        _welcomedPlayers[pid] = true;
        var target = _targetNumber();
        var msg = isFirst
            ? player.name + ', welcome to Baseball Darts. In inning ' + _state.currentInning +
              ' you are targeting number ' + target + '.'
            : player.name + '. Inning ' + _state.currentInning + '. Target number ' + target + '.';
        _speak(msg, 400);
        return 400 + 200 + msg.length * 120;
    }

    function _speakDart(isHit, runs) {
        if (!SPEECH.isEnabled()) return 0;
        var msg = isHit
            ? (runs === 1 ? 'Single. 1 run.' : runs === 2 ? 'Double. 2 runs.' : 'Treble. 3 runs.')
            : 'Out.';
        _speak(msg, 200);
        return 300 + msg.length * 120;
    }

    function _dartSpeechDuration(segment, multiplier) {
        // Estimates full speech duration for a dart on the current target — used by CPU timing
        var target = _targetNumber();
        var isHit  = (segment === target);
        var runs   = isHit ? multiplier : 0;
        var msg    = isHit
            ? (runs === 1 ? 'Single. 1 run.' : runs === 2 ? 'Double. 2 runs.' : 'Treble. 3 runs.')
            : 'Out.';
        return 300 + msg.length * 120;
    }

    function _speakInningEnd(inn) {
        if (!SPEECH.isEnabled()) return 0;
        var player = _currentPlayer();
        var name   = player ? player.name : '';
        var runs   = inn ? inn.runs : 0;
        var msg    = 'Inning ' + _state.currentInning + ' over for ' + name + '. ' +
                     runs + (runs === 1 ? ' run' : ' runs') + ' this inning.';
        _speak(msg, 500);
        // Return estimated ms until speech finishes (500ms delay + startup + per-char rate)
        return 500 + 300 + msg.length * 150;
    }

    function _speakResult(titleText, hsResults) {
        if (!SPEECH.isEnabled()) return;
        var msg = titleText + ' ';
        if (hsResults) {
            hsResults.forEach(function (r) {
                if (r.is_new_high) {
                    var player = _state.players.find(function (p) { return String(p.id) === String(r.player_id); });
                    msg += (player ? player.name : 'Player') + ' made a new high score of ' + r.high_score + '. ';
                }
            });
        }
        _speak(msg, 1000);
    }

    // ─────────────────────────────────────────────────────────────────
    // CPU turn
    // ─────────────────────────────────────────────────────────────────

    function _isCpuPlayer(p) {
        if (!p) return false;
        if (_state.cpuPlayerId && String(p.id) === _state.cpuPlayerId) return true;
        return p.isCpu === true || p.name === 'CPU';
    }

    function _runCpuTurn() {
        if (_state.cpuTurnRunning || _state.status !== 'active') return;
        if (!_isCpuPlayer(_currentPlayer())) return;
        _state.cpuTurnRunning = true;

        var dartsThrown = 0;

        function _throwNext() {
            if (dartsThrown >= 3 || _state.setComplete) {
                _state.cpuTurnRunning = false;
                // If the inning just ended, wait for the "Inning over for..." speech to finish
                var endDelay = _state.inningComplete
                    ? Math.max(1800, (_state.inningEndSpeechDur || 0) + 600)
                    : 700;
                _state.inningEndSpeechDur = 0;
                setTimeout(_onNext, endDelay);
                return;
            }
            var dart      = _cpuChooseDart();
            dartsThrown++;
            var speechDur = _dartSpeechDuration(dart.segment, dart.multiplier);
            _onThrow(dart.segment, dart.multiplier);
            var nextDelay = Math.max(1000, speechDur + 500);
            setTimeout(_throwNext, nextDelay);
        }

        _lockBoard(true);
        var nb = document.getElementById('bbmp-next-btn'); if (nb) nb.disabled = true;
        var ub = document.getElementById('bbmp-undo-btn'); if (ub) ub.disabled = true;

        var announceWait = _announceCurrentPlayer();
        setTimeout(_throwNext, Math.max(1000, announceWait + 400));
    }

    function _cpuChooseDart() {
        var profile  = _cpuProfile();
        var intended = _cpuIntend();
        return _cpuApplyVariance(intended.segment, intended.multiplier, profile);
    }

    function _cpuIntend() {
        var diff   = _state.cpuDifficulty;
        var target = _targetNumber();
        var r      = Math.random();
        var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

        // All difficulties aim for the target number; accuracy determines whether they hit it
        if (diff === 'hard') {
            // Hard: mostly trebles, some doubles, rare singles
            if (r < 0.55) return { segment: target, multiplier: 3 };
            if (r < 0.80) return { segment: target, multiplier: 2 };
            return { segment: target, multiplier: 1 };
        } else if (diff === 'medium') {
            // Medium: mix of multipliers, some misses to adjacent
            if (r < 0.30) return { segment: target, multiplier: 3 };
            if (r < 0.58) return { segment: target, multiplier: 2 };
            if (r < 0.82) return { segment: target, multiplier: 1 };
            return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
        } else {
            // Easy: mainly singles, frequent misses to other segments
            if (r < 0.08) return { segment: target, multiplier: 3 };
            if (r < 0.20) return { segment: target, multiplier: 2 };
            if (r < 0.45) return { segment: target, multiplier: 1 };
            return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
        }
    }

    function _cpuProfile() {
        // missChance: probability per dart of going completely off-target (= an out).
        // This is checked FIRST in _cpuApplyVariance before any multiplier variance,
        // guaranteeing that every difficulty level produces outs regularly.
        //   easy:   ~55% chance of an out per dart  → usually 1-3 outs per inning
        //   medium: ~30% chance of an out per dart  → usually 0-2 outs per inning
        //   hard:   ~15% chance of an out per dart  → usually 0-1 outs per inning, occasionally 0
        var profiles = {
            easy:   { missChance: 0.55, trebleHit: 0.40, trebleSingle: 0.35, doubleHit: 0.50, doubleSingle: 0.30, singleHit: 0.75 },
            medium: { missChance: 0.30, trebleHit: 0.68, trebleSingle: 0.20, doubleHit: 0.65, doubleSingle: 0.20, singleHit: 0.88 },
            hard:   { missChance: 0.15, trebleHit: 0.86, trebleSingle: 0.09, doubleHit: 0.80, doubleSingle: 0.13, singleHit: 0.95 },
        };
        return profiles[_state.cpuDifficulty] || profiles.medium;
    }

    function _cpuApplyVariance(segment, multiplier, profile) {
        var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        function adjacent(seg) {
            var idx = BOARD_RING.indexOf(seg);
            if (idx === -1) return seg;
            return BOARD_RING[(idx + (Math.random() < 0.5 ? 1 : -1) + BOARD_RING.length) % BOARD_RING.length];
        }
        // Apply guaranteed miss chance first — this ensures outs happen at all difficulty levels
        if (Math.random() < profile.missChance) {
            return { segment: adjacent(segment), multiplier: 1 };
        }
        var r = Math.random();
        if (multiplier === 3) {
            if (r < profile.trebleHit) return { segment: segment, multiplier: 3 };
            if (r < profile.trebleHit + profile.trebleSingle) return { segment: segment, multiplier: 1 };
            return { segment: adjacent(segment), multiplier: 1 };
        }
        if (multiplier === 2) {
            if (r < profile.doubleHit) return { segment: segment, multiplier: 2 };
            if (r < profile.doubleHit + profile.doubleSingle) return { segment: segment, multiplier: 1 };
            return { segment: adjacent(segment), multiplier: 1 };
        }
        if (r < profile.singleHit) return { segment: segment, multiplier: 1 };
        return { segment: adjacent(segment), multiplier: 1 };
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();