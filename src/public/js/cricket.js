/**
 * cricket.js
 * ----------
 * Full-screen Cricket darts game controller.
 *
 * Public API:
 *   CRICKET_GAME.start(config, onEnd)
 *     config: { players: [{id, name, isCpu}], ... }
 *     onEnd:  called when game ends or is abandoned
 */

var CRICKET_GAME = (function () {

    // Cricket numbers in display order (top to bottom)
    var NUMBERS = [20, 19, 18, 17, 16, 15, 25];
    var NUMBER_LABELS = { 25: 'BULL' };

    var _state = {
        matchId:          null,
        players:          [],      // [{ id, name }]
        marks:            {},      // { playerId: { number: 0-3 } }
        scores:           {},      // { playerId: points }
        currentPlayerId:  null,
        currentTurn:      1,
        dartsThisTurn:    0,
        multiplier:       1,
        turnComplete:     false,   // waiting for NEXT after 3rd dart
        status:           'active',
        winnerId:         null,
        onEnd:            null,
        isFirstTurn:      false,
        pendingDarts:     [],      // buffered darts for current turn (flushed on NEXT)
        cpuTurnRunning:   false,
        cpuDifficulty:    'medium',
        cpuPlayerId:      null,
    };

    // ─────────────────────────────────────────────────────────────────
    // Local Cricket scoring engine
    // Mirrors server logic so UI can update instantly without a round-trip.
    // ─────────────────────────────────────────────────────────────────

    var _LocalCricket = {
        processThrow: function(segment, multiplier, marks, scores, players, currentPlayerId) {
            var valid = [15, 16, 17, 18, 19, 20, 25];
            if (valid.indexOf(segment) === -1 || segment === 0) {
                return { marksAdded: 0, pointsScored: 0, newMarks: marks, newScores: scores, isWin: false };
            }
            var pid       = String(currentPlayerId);
            var newMarks  = JSON.parse(JSON.stringify(marks));
            var newScores = JSON.parse(JSON.stringify(scores));
            if (!newMarks[pid]) newMarks[pid] = {};
            var current = newMarks[pid][String(segment)] || 0;
            var hits    = multiplier;
            var marksAdded = 0, pointsScored = 0;

            if (current < 3) {
                var toClose  = 3 - current;
                marksAdded   = Math.min(hits, toClose);
                var overflow = hits - toClose;
                newMarks[pid][String(segment)] = Math.min(current + hits, 3);
                if (overflow > 0) {
                    var oppsClosed = players.every(function(p) {
                        if (String(p.id) === pid) return true;
                        return ((newMarks[String(p.id)] || {})[String(segment)] || 0) >= 3;
                    });
                    if (!oppsClosed) {
                        pointsScored = overflow * (segment === 25 ? 25 : segment);
                        newScores[pid] = (newScores[pid] || 0) + pointsScored;
                    }
                }
            } else {
                var oppsClosed2 = players.every(function(p) {
                    if (String(p.id) === pid) return true;
                    return ((newMarks[String(p.id)] || {})[String(segment)] || 0) >= 3;
                });
                if (!oppsClosed2) {
                    pointsScored = hits * (segment === 25 ? 25 : segment);
                    newScores[pid] = (newScores[pid] || 0) + pointsScored;
                }
            }

            var myMarks   = newMarks[pid] || {};
            var allClosed = [15,16,17,18,19,20,25].every(function(n) {
                return (myMarks[String(n)] || 0) >= 3;
            });
            var myScore = newScores[pid] || 0;
            var isWin   = allClosed && players.every(function(p) {
                return myScore >= (newScores[String(p.id)] || 0);
            });

            return { marksAdded: marksAdded, pointsScored: pointsScored,
                     newMarks: newMarks, newScores: newScores, isWin: isWin };
        },
    };

    // ─────────────────────────────────────────────────────────────────
    // Public: start
    // ─────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePlayers(config.players, config.difficulty)
            .then(function (players) {
                return API.createCricketMatch({ player_ids: players.map(function (p) { return p.id; }) })
                    .then(function (state) {
                        return { players: players, state: state };
                    });
            })
            .then(function (result) {
                _applyState(result.state);
                _state.onEnd = onEnd;
                _state.isFirstTurn = true;
                UI.setLoading(false);
                _buildScreen();
                _announcePlayer();
                if (_isCpuTurn()) _scheduleCpuTurn();
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast(err.message.toUpperCase(), 'bust', 4000);
                console.error('[cricket] start error:', err);
            });
    }

    // ─────────────────────────────────────────────────────────────────
    // Player resolution (reuse pattern from practice.js)
    // ─────────────────────────────────────────────────────────────────

    function _resolvePlayers(selections, difficulty) {
        var promises = selections.map(function (sel) {
            if (sel.isCpu) {
                return API.getCpuPlayer()
                    .catch(function() { return null; })
                    .then(function(record) {
                        if (record) return record;
                        return API.createPlayer('CPU');
                    })
                    .then(function(p) { return { id: p.id, name: 'CPU' }; });
            } else if (sel.mode === 'existing') {
                return Promise.resolve({ id: sel.id, name: sel.name });
            } else {
                return API.createPlayer(sel.name)
                    .then(function (p) { return { id: p.id, name: p.name }; });
            }
        });
        return Promise.all(promises).then(function(players) {
            selections.forEach(function(sel, i) {
                if (sel.isCpu) {
                    _state.cpuPlayerId   = String(players[i].id);
                    _state.cpuDifficulty = difficulty || sel.difficulty || 'medium';
                }
            });
            return players;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId         = s.match_id;
        _state.players         = s.players;
        _state.currentPlayerId = s.current_player_id;
        _state.currentTurn     = s.current_turn_number;
        _state.dartsThisTurn   = s.darts_this_turn;
        _state.status          = s.status;
        _state.winnerId        = s.winner_id;

        // Normalise all keys to strings so marks[pid][num] always works
        // regardless of whether JSON gave us integer or string keys
        _state.marks  = {};
        _state.scores = {};
        Object.keys(s.marks).forEach(function(pid) {
            _state.marks[String(pid)] = {};
            Object.keys(s.marks[pid]).forEach(function(num) {
                _state.marks[String(pid)][String(num)] = s.marks[pid][num];
            });
        });
        Object.keys(s.scores).forEach(function(pid) {
            _state.scores[String(pid)] = s.scores[pid];
        });
        // Also normalise currentPlayerId to string
        _state.currentPlayerId = String(s.current_player_id);
    }

    // ─────────────────────────────────────────────────────────────────
    // Screen build
    // ─────────────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-cricket';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.id = 'cricket-header';
        header.className = 'cricket-header game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'CRICKET';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · 15–BULL';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { UI.showRulesModal('cricket'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.id = 'cricket-end-btn';
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', _onEnd);
        var restartBtn = document.createElement('button');
        restartBtn.id = 'cricket-restart-btn';
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
        undoBtn.id = 'cricket-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'cricket-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar — scoreboard ──────────────────────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'cricket-sidebar';
        sidebar.className = 'cricket-sidebar';
        _renderBoard(sidebar);
        app.appendChild(sidebar);

        // ── Board (right column) ──────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'cricket-seg-board';
        segBoard.className = 'cricket-seg-board';

        // Status banner
        var statusEl = document.createElement('div');
        statusEl.id = 'cricket-status';
        statusEl.className = 'cricket-status-banner';
        _updateStatusBanner(statusEl);
        segBoard.appendChild(statusEl);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'cricket-pills';
        pills.className = 'cricket-pills';
        segBoard.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'cricket-tabs';
        tabs.className = 'cricket-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (t) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (t.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = t.mul;
            btn.dataset.activeClass = t.cls;
            btn.type = 'button';
            btn.textContent = t.label;
            UI.addTouchSafeListener(btn, function () {
                if (_state.turnComplete) return;
                _state.multiplier = t.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(t.cls);
                document.body.dataset.multiplier = t.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        segBoard.appendChild(tabs);

        // Full segment grid (1–20)
        var grid = document.createElement('div');
        grid.id = 'cricket-seg-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            (function (s) {
                var btn = document.createElement('button');
                btn.className = 'seg-btn' + (s >= 15 ? ' cricket-target' : '');
                btn.dataset.segment = s;
                btn.type = 'button';
                btn.textContent = s;
                btn.addEventListener('click', function () {
                    if (_state.turnComplete) return;
                    _throwDart(s, _state.multiplier);
                });
                grid.appendChild(btn);
            })(seg);
        }
        segBoard.appendChild(grid);

        // Bull row (MISS / OUTER / BULL)
        var bullRow = document.createElement('div');
        bullRow.className = 'bull-row';
        var missBtn = document.createElement('button');
        missBtn.className = 'seg-btn bull-btn';
        missBtn.type = 'button';
        missBtn.textContent = 'MISS';
        missBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(0, 0);
        });
        var outerBtn = document.createElement('button');
        outerBtn.className = 'seg-btn bull-btn cricket-target';
        outerBtn.type = 'button';
        outerBtn.textContent = 'OUTER';
        outerBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(25, 1);
        });
        var bullBtn = document.createElement('button');
        bullBtn.className = 'seg-btn bull-btn bull-btn-inner cricket-target';
        bullBtn.type = 'button';
        bullBtn.textContent = 'BULL';
        bullBtn.addEventListener('click', function () {
            if (_state.turnComplete) return;
            _throwDart(25, 2);
        });
        bullRow.appendChild(missBtn);
        bullRow.appendChild(outerBtn);
        bullRow.appendChild(bullBtn);
        segBoard.appendChild(bullRow);

        // Footer
        var footer = document.createElement('footer');
        footer.className = 'cricket-footer';
        footer.textContent = 'CRICKET NUMBERS: 15 · 16 · 17 · 18 · 19 · 20 · BULL';
        segBoard.appendChild(footer);

        app.appendChild(segBoard);
    }

    // ─────────────────────────────────────────────────────────────────
    // Scoreboard render
    // ─────────────────────────────────────────────────────────────────

    function _renderBoard(container) {
        container.innerHTML = '';
        var nPlayers = _state.players.length;

        // Build grid: col 0 = number label, col 1..n = player cols
        // Header row: blank | player names + scores
        var headerRow = document.createElement('div');
        headerRow.className = 'cricket-row cricket-row-header';

        var numLbl = document.createElement('div');
        numLbl.className = 'cricket-cell cricket-num-col';
        headerRow.appendChild(numLbl);

        _state.players.forEach(function (p) {
            var cell = document.createElement('div');
            cell.className = 'cricket-cell cricket-player-header' +
    (String(p.id) === String(_state.currentPlayerId) ? ' cricket-active-player' : '');
            cell.id = 'cricket-ph-' + p.id;

            var nameEl = document.createElement('div');
            nameEl.className = 'cricket-player-name';
            nameEl.textContent = p.name.toUpperCase();

            var scoreEl = document.createElement('div');
            scoreEl.className = 'cricket-player-score';
            scoreEl.id = 'cricket-score-' + p.id;
            scoreEl.textContent = (_state.scores[String(p.id)] || 0);

            cell.appendChild(nameEl);
            cell.appendChild(scoreEl);
            headerRow.appendChild(cell);
        });
        container.appendChild(headerRow);

        // Number rows
        NUMBERS.forEach(function (num) {
            var row = document.createElement('div');
            row.className = 'cricket-row';
            row.id = 'cricket-row-' + num;

            var numCell = document.createElement('div');
            numCell.className = 'cricket-cell cricket-num-col';

            var numLabel = document.createElement('div');
            numLabel.className = 'cricket-num-label';
            numLabel.textContent = NUMBER_LABELS[num] || num;
            numCell.appendChild(numLabel);

            // Status badge: OPEN (someone can score), CLOSED (all players have 3 marks)
            var allClosed = _state.players.every(function(p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });
            // "Owned" = at least one player has closed it but not all
            var anyOpen = _state.players.some(function(p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });

            var badge = document.createElement('div');
            if (allClosed) {
                badge.className = 'cricket-num-badge badge-closed';
                badge.textContent = 'CLOSED';
            } else if (anyOpen) {
                badge.className = 'cricket-num-badge badge-open';
                badge.textContent = 'OPEN';
            } else {
                badge.className = 'cricket-num-badge badge-none';
                badge.textContent = '';
            }
            numCell.appendChild(badge);
            row.appendChild(numCell);

            _state.players.forEach(function (p) {
                var cell = document.createElement('div');
                cell.className = 'cricket-cell cricket-marks-cell';
                cell.id = 'cricket-marks-' + p.id + '-' + num;
                var marks = (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)]) || 0;
                cell.appendChild(_buildMarksEl(marks));
                row.appendChild(cell);
            });

            container.appendChild(row);
        });

        _updateRowHighlights();
    }

    function _buildMarksEl(marks) {
        var el = document.createElement('div');
        el.className = 'cricket-marks';
        if (marks === 0) {
            el.innerHTML = '';
        } else if (marks === 1) {
            el.innerHTML = '<span class="cricket-mark cricket-mark-slash">╱</span>';
        } else if (marks === 2) {
            el.innerHTML = '<span class="cricket-mark cricket-mark-x">✕</span>';
        } else {
            el.innerHTML = '<span class="cricket-mark cricket-mark-closed">⊗</span>';
        }
        return el;
    }

    function _updateMarkCell(playerId, number, marks) {
        var cell = document.getElementById('cricket-marks-' + playerId + '-' + number);
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(_buildMarksEl(marks));
        }
    }

    function _updateScoreDisplay(playerId, points) {
        var el = document.getElementById('cricket-score-' + playerId);
        if (el) el.textContent = points;
    }

    function _updateActivePlayer() {
        document.querySelectorAll('.cricket-player-header').forEach(function (el) {
            el.classList.remove('cricket-active-player');
        });
        var active = document.getElementById('cricket-ph-' + String(_state.currentPlayerId));
        if (active) active.classList.add('cricket-active-player');
    }

    function _updateRowHighlights() {
        // Highlight rows where at least one player can still score or close
        NUMBERS.forEach(function (num) {
            var row = document.getElementById('cricket-row-' + num);
            if (!row) return;
            var allClosed = _state.players.every(function (p) {
                return (_state.marks[String(p.id)] && _state.marks[String(p.id)][String(num)] >= 3);
            });
            if (allClosed) {
                row.classList.add('cricket-row-closed');
            } else {
                row.classList.remove('cricket-row-closed');
            }
        });
    }

    function _addPill(num, multiplier, marksAdded, points) {
        var pills = document.getElementById('cricket-pills');
        if (!pills) return;

        var label;
        if (num === 0) {
            label = 'MISS';
        } else if (num === 25) {
            label = multiplier === 2 ? 'BULL' : 'OUTER';
        } else {
            label = (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : '') + num;
        }

        var pill = document.createElement('div');
        pill.className = 'dart-pill' +
            (num === 0 ? ' pill-miss' : '') +
            (points > 0 ? ' pill-hot' : '');
        pill.textContent = label + (points > 0 ? ' (+' + points + ')' : marksAdded > 0 ? ' ×' + marksAdded : '');
        pills.appendChild(pill);
    }

    function _clearPills() {
        var pills = document.getElementById('cricket-pills');
        if (pills) pills.innerHTML = '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Throw
    // ─────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────
    // _throwDart — LOCAL only, no server call.
    // Scores the dart instantly from JS state and buffers it in
    // _state.pendingDarts. Server is only contacted on _flushPendingTurn().
    // ─────────────────────────────────────────────────────────────────
    function _throwDart(segment, multiplier) {
        if (_state.turnComplete || _state.status !== 'active') return;

        if (multiplier === undefined) multiplier = _state.multiplier;
        if (segment === 0) multiplier = 0;

        // Score locally
        var result = _LocalCricket.processThrow(
            segment, multiplier,
            _state.marks, _state.scores,
            _state.players, _state.currentPlayerId
        );

        // Apply to local state immediately
        _state.marks  = result.newMarks;
        _state.scores = result.newScores;
        _state.dartsThisTurn++;

        // Buffer dart for server flush
        _state.pendingDarts.push({ segment: segment, multiplier: multiplier });

        // Update UI instantly
        var board = document.getElementById('cricket-sidebar');
        if (board) _renderBoard(board);
        _addPill(segment, multiplier, result.marksAdded, result.pointsScored);
        _updateStatusBanner();

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (result.isWin) SOUNDS.checkout();
            else if (result.pointsScored > 0) SOUNDS.ton();
            else SOUNDS.dart();
        }

        // Speech
        if (SPEECH.isEnabled()) {
            var speechPts = segment === 0 ? 0 : (result.pointsScored > 0 ? result.pointsScored : 1);
            setTimeout(function() {
                SPEECH.announceDartScore(segment, multiplier, speechPts);
            }, 300);
        }

        // Win detected locally — flush immediately then show modal
        if (result.isWin) {
            _state.turnComplete = true;
            _lockBoard(true);
            _flushPendingTurn(function(serverState) {
                var winnerId = serverState && serverState.winner_id
                    ? serverState.winner_id
                    : _state.currentPlayerId;
                setTimeout(function() { _showWinModal(winnerId); }, 600);
            });
            return;
        }

        // After 3 darts — show NEXT and flush
        if (_state.dartsThisTurn >= 3) {
            _state.turnComplete = true;
            var nextBtn = document.getElementById('cricket-next-btn');
            if (nextBtn) nextBtn.disabled = false;
            var undoBtn2 = document.getElementById('cricket-undo-btn');
            if (undoBtn2) undoBtn2.disabled = false;
            // Flush to server in background while player reads board
            _flushPendingTurn(null);
            return;
        }

        // More darts to throw
        var undoBtn = document.getElementById('cricket-undo-btn');
        if (undoBtn) undoBtn.disabled = false;
    }

    // Send all buffered darts to the server sequentially.
    // onComplete(serverState) called after last dart, or null on error.
    function _flushPendingTurn(onComplete) {
        if (_state.pendingDarts.length === 0) {
            if (onComplete) onComplete(null);
            return;
        }
        var darts   = _state.pendingDarts.slice();
        _state.pendingDarts = [];
        var lastState = null;

        function sendNext(i) {
            if (i >= darts.length) {
                // Re-sync authoritative state from server
                if (lastState) _applyState(lastState);
                if (onComplete) onComplete(lastState);
                return;
            }
            API.recordCricketThrow(_state.matchId, {
                player_id:  _state.currentPlayerId,
                segment:    darts[i].segment,
                multiplier: darts[i].multiplier,
            })
            .then(function(s) {
                lastState = s;
                sendNext(i + 1);
            })
            .catch(function(err) {
                console.error('[cricket] flush error dart ' + i + ':', err);
                // Continue flushing remaining darts even on error
                sendNext(i + 1);
            });
        }
        sendNext(0);
    }

    // ─────────────────────────────────────────────────────────────────
    // Next / Undo
    // ─────────────────────────────────────────────────────────────────

    function _onNext() {
        if (_state.cpuTurnRunning) return;

        var nextBtn = document.getElementById('cricket-next-btn');
        if (nextBtn) nextBtn.disabled = true;
        var undoBtn = document.getElementById('cricket-undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        // Ensure any un-flushed darts reach the server before advancing.
        // (Normally flushed already after dart 3, but guards edge cases.)
        function _advance() {
            _state.turnComplete  = false;
            _state.dartsThisTurn = 0;
            _state.multiplier    = 1;
            _state.pendingDarts  = [];
            _clearPills();
            _updateActivePlayer();

            // Reset multiplier tab to single
            var tabs = document.getElementById('cricket-tabs');
            if (tabs) {
                tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                var singleTab = tabs.querySelector('[data-multiplier="1"]');
                if (singleTab) singleTab.classList.add('active-single');
            }
            document.body.dataset.multiplier = 1;

            _lockBoard(false);
            _updateStatusBanner();
            _announcePlayer();

            if (_isCpuTurn()) _scheduleCpuTurn();
        }

        if (_state.pendingDarts.length > 0) {
            _flushPendingTurn(function() { _advance(); });
        } else {
            _advance();
        }
    }

    function _onUndo() {
        if (_state.cpuTurnRunning) return;

        // If the dart is still in the local buffer, pop it without a server call
        if (_state.pendingDarts.length > 0) {
            _state.pendingDarts.pop();
            _state.dartsThisTurn--;
            _state.turnComplete = false;

            // Re-sync local marks/scores from server state (simplest correctness guarantee)
            _lockBoard(true);
            API.getCricketMatch(_state.matchId)
                .then(function(s) {
                    _applyState(s);
                    var board = document.getElementById('cricket-sidebar');
                    if (board) _renderBoard(board);

                    var pills = document.getElementById('cricket-pills');
                    if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

                    var nextBtn = document.getElementById('cricket-next-btn');
                    if (nextBtn) nextBtn.disabled = true;
                    var undoBtn = document.getElementById('cricket-undo-btn');
                    if (undoBtn) undoBtn.disabled = _state.dartsThisTurn === 0;

                    _lockBoard(false);
                })
                .catch(function() { _lockBoard(false); });
            return;
        }

        // Dart already flushed to server — use server undo
        _lockBoard(true);
        API.undoCricketThrow(_state.matchId)
            .then(function (s) {
                _applyState(s);
                var board = document.getElementById('cricket-sidebar');
                if (board) _renderBoard(board);

                var pills = document.getElementById('cricket-pills');
                if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

                _state.turnComplete  = false;
                _state.dartsThisTurn = s.darts_this_turn || 0;
                var nextBtn = document.getElementById('cricket-next-btn');
                if (nextBtn) nextBtn.disabled = true;
                var undoBtn = document.getElementById('cricket-undo-btn');
                if (undoBtn) undoBtn.disabled = _state.dartsThisTurn === 0;

                _lockBoard(false);
            })
            .catch(function () {
                _lockBoard(false);
                UI.showToast('UNDO FAILED', 'bust', 2000);
            });
    }

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
        API.restartCricketMatch(_state.matchId)
            .then(function() {
                return API.getCricketMatch(_state.matchId);
            })
            .then(function(state) {
                _applyState(state);
                _buildScreen();
                _announcePlayer();
                UI.showToast('MATCH RESTARTED', 'info', 2000);
            })
            .catch(function(err) {
                UI.showToast('RESTART FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
            })
            .finally(function() {
                UI.setLoading(false);
            });
    }

    function _onEnd() {
        UI.showConfirmModal({
            title:        'ABANDON MATCH?',
            message:      'This Cricket match will be cancelled and you will return to the home screen.',
            confirmLabel: 'YES, END MATCH',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    function() {
                API.endCricketMatch(_state.matchId).catch(function(){});
                if (_state.onEnd) _state.onEnd();
            },
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Board locking
    // ─────────────────────────────────────────────────────────────────

    function _updateStatusBanner(el) {
        el = el || document.getElementById('cricket-status');
        if (!el) return;
        var p = _state.players.find(function (pl) { return String(pl.id) === String(_state.currentPlayerId); });
        el.textContent = p ? p.name.toUpperCase() + '  —  DART ' + (_state.dartsThisTurn + 1) + ' OF 3' : '';
    }

    function _lockBoard(locked) {
        var grid = document.getElementById('cricket-seg-grid');
        if (grid) grid.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var bullRow = document.querySelector('.cricket-seg-board .bull-row');
        if (bullRow) bullRow.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('cricket-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ─────────────────────────────────────────────────────────────────
    // Win modal
    // ─────────────────────────────────────────────────────────────────

    function _showWinModal(winnerId) {
        var winner = _state.players.find(function (p) { return String(p.id) === String(winnerId); });
        if (!winner) return;

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
        if (SPEECH.isEnabled()) {
            setTimeout(function () {
                SPEECH.announceCricketWin && SPEECH.announceCricketWin(winner.name);
            }, 400);
        }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box cricket-win-box';

        box.innerHTML =
            '<div class="cricket-win-icon">🏆</div>' +
            '<div class="modal-title">' + _esc(winner.name.toUpperCase()) + ' WINS!</div>' +
            '<div class="modal-subtitle">CRICKET</div>' +
            '<div class="cricket-win-scores">' +
            _state.players.map(function (p) {
                return '<div class="cricket-win-score-row' + (String(p.id) === String(winnerId) ? ' cricket-win-winner' : '') + '">' +
                    '<span>' + _esc(p.name) + '</span>' +
                    '<span>' + (_state.scores[String(p.id)] || 0) + ' pts</span>' +
                    '</div>';
            }).join('') +
            '</div>';

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.addEventListener('click', function () {
            overlay.remove();
            if (_state.onEnd) _state.onEnd();
        });
        box.appendChild(doneBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ─────────────────────────────────────────────────────────────────
    // Speech
    // ─────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────
    // CPU turn
    // ─────────────────────────────────────────────────────────────────

    function _isCpuTurn() {
        return _state.cpuPlayerId &&
               String(_state.currentPlayerId) === String(_state.cpuPlayerId) &&
               _state.status === 'active';
    }

    var _CPU_PROFILES = {
        easy:   { trebleHit: 0.15, doubleHit: 0.25, singleHit: 0.65, missRate: 0.20 },
        medium: { trebleHit: 0.35, doubleHit: 0.55, singleHit: 0.85, missRate: 0.08 },
        hard:   { trebleHit: 0.72, doubleHit: 0.82, singleHit: 0.96, missRate: 0.02 },
    };

    var _ADJACENT = {
        20:[5,1], 1:[20,18], 2:[15,17], 3:[19,17], 4:[18,13], 5:[20,12],
        6:[13,10], 7:[16,19], 8:[11,16], 9:[14,12], 10:[15,6], 11:[8,14],
        12:[9,5], 13:[4,6], 14:[11,9], 15:[2,10], 16:[8,7], 17:[3,2],
        18:[4,1], 19:[3,7], 25:[25,25],
    };

    function _cpuApplyVariance(segment, multiplier) {
        var profile = _CPU_PROFILES[_state.cpuDifficulty] || _CPU_PROFILES.medium;
        if (Math.random() < profile.missRate) return { segment: 0, multiplier: 0 };
        var r = Math.random();
        var actualMul;
        if (multiplier === 3) {
            if (r < profile.trebleHit) actualMul = 3;
            else if (r < profile.doubleHit) actualMul = 2;
            else if (r < profile.singleHit) actualMul = 1;
            else {
                var adj = _ADJACENT[segment] || [segment];
                return { segment: adj[Math.floor(Math.random() * adj.length)], multiplier: 1 };
            }
        } else if (multiplier === 2) {
            if (r < profile.doubleHit) actualMul = 2;
            else if (r < profile.singleHit) actualMul = 1;
            else {
                var adj2 = _ADJACENT[segment] || [segment];
                return { segment: adj2[Math.floor(Math.random() * adj2.length)], multiplier: 1 };
            }
        } else {
            actualMul = r < profile.singleHit ? 1 : 0;
            if (actualMul === 0) return { segment: 0, multiplier: 0 };
        }
        return { segment: segment, multiplier: actualMul };
    }

    function _cpuIntend() {
        var pid    = String(_state.cpuPlayerId);
        var myMarks = _state.marks[pid] || {};
        // Priority: close numbers 20→15→Bull
        var targets = [20, 19, 18, 17, 16, 15, 25];
        for (var i = 0; i < targets.length; i++) {
            var n = targets[i];
            if ((myMarks[String(n)] || 0) < 3) {
                return { segment: n, multiplier: n === 25 ? 2 : 3 };
            }
        }
        // All closed — score on numbers opponents still have open
        for (var j = 0; j < targets.length; j++) {
            var n2 = targets[j];
            var oppOpen = _state.players.some(function(p) {
                if (String(p.id) === pid) return false;
                return ((_state.marks[String(p.id)] || {})[String(n2)] || 0) < 3;
            });
            if (oppOpen) return { segment: n2, multiplier: n2 === 25 ? 2 : 3 };
        }
        return { segment: 20, multiplier: 3 };
    }

    function _scheduleCpuTurn() {
        var delay = SPEECH.isEnabled() ? 2200 : 600;
        setTimeout(function() { _doCpuTurn(0); }, delay);
    }

    function _doCpuTurn(dartIndex) {
        if (_state.status !== 'active') return;
        if (dartIndex >= 3) {
            setTimeout(function() {
                _state.cpuTurnRunning = false;
                _onNext();
            }, 900);
            return;
        }

        _state.cpuTurnRunning = true;
        _lockBoard(true);

        var intended = _cpuIntend();
        var actual   = _cpuApplyVariance(intended.segment, intended.multiplier);

        setTimeout(function() {
            if (_state.status !== 'active') { _state.cpuTurnRunning = false; return; }

            // CPU uses direct server call (no local buffer) so board stays authoritative
            API.recordCricketThrow(_state.matchId, {
                player_id:  _state.cpuPlayerId,
                segment:    actual.segment,
                multiplier: actual.multiplier,
            })
            .then(function(s) {
                var last = s.last_throw;
                _applyState(s);

                var board = document.getElementById('cricket-sidebar');
                if (board) _renderBoard(board);
                _addPill(last.segment, last.multiplier, last.marks_added, last.points_scored);
                _updateStatusBanner();

                if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                    if (s.status === 'complete') SOUNDS.checkout();
                    else if (last.points_scored > 0) SOUNDS.ton();
                    else SOUNDS.dart();
                }

                if (s.status === 'complete') {
                    _state.cpuTurnRunning = false;
                    _lockBoard(true);
                    setTimeout(function() { _showWinModal(s.winner_id); }, 600);
                    return;
                }

                if (SPEECH.isEnabled()) {
                    var speechPts = last.segment === 0 ? 0 : (last.points_scored > 0 ? last.points_scored : 1);
                    var phrase    = last.segment === 0 ? 'Miss'
                                  : (last.multiplier === 3 ? 'Treble ' : last.multiplier === 2 ? 'Double ' : '')
                                    + (last.segment === 25 ? (last.multiplier === 2 ? 'Bulls Eye' : 'Outer Bull') : last.segment);
                    var speechWait = 200 + Math.max(1200, phrase.length * 95 + 400);
                    setTimeout(function() {
                        SPEECH.announceDartScore(last.segment, last.multiplier, speechPts);
                    }, 200);
                    setTimeout(function() { _doCpuTurn(dartIndex + 1); }, speechWait);
                } else {
                    setTimeout(function() { _doCpuTurn(dartIndex + 1); }, 700);
                }
            })
            .catch(function(err) {
                _state.cpuTurnRunning = false;
                _lockBoard(false);
                console.error('[cricket] CPU throw error:', err);
            });
        }, 600);
    }

    function _announcePlayer() {
        if (!SPEECH.isEnabled()) return;
        var player = _state.players.find(function (p) { return String(p.id) === String(_state.currentPlayerId); });
        if (!player) return;
        if (_state.isFirstTurn) {
            // First turn: speak welcome then player announce as a chain,
            // each in its own setTimeout so iOS TTS wakes up between them.
            _state.isFirstTurn = false;
            var welcomeMsg = 'Welcome to Cricket darts.';
            var playerMsg  = player.name + "'s turn to throw";
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(welcomeMsg, { rate: 1.05, pitch: 1.0 });
            }, 400);
            // Delay player announce until after welcome finishes
            // 400ms start delay + 300ms TTS startup + 150ms/char
            var welcomeDur = 400 + 300 + welcomeMsg.length * 150;
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(playerMsg, { rate: 1.05, pitch: 1.0 });
            }, welcomeDur + 300);
        } else {
            setTimeout(function () {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(player.name + "'s turn to throw", { rate: 1.05, pitch: 1.0 });
            }, 300);
        }
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