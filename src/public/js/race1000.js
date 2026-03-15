/**
 * race1000.js
 * -----------
 * Race to 1000 darts game controller.
 *
 * Public API:
 *   RACE1000_GAME.start(config, onEnd)
 *     config: { players: [{id,name}|{mode:'new',name}], variant: 'twenties'|'all' }
 *     onEnd:  called when game ends or is abandoned
 */

var RACE1000_GAME = (function () {

    var WIN_TARGET = 1000;
    var _R1K_RING_R    = 54;
    var _R1K_RING_CX   = 64;
    var _R1K_RING_CY   = 64;
    var _R1K_RING_CIRC = +(2 * Math.PI * 54).toFixed(4);

    // ── State ─────────────────────────────────────────────────────────────────
    var _state = {
        matchId:            null,
        players:            [],
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        variant:            'twenties',
        status:             'active',
        winnerId:           null,
        onEnd:              null,
        multiplier:         1,
        setComplete:        false,
        turnNumber:         1,
        targetSet:          false,   // someone reached 1000 this round but round not over
        cpuDifficulty:      'medium',
        cpuTurnRunning:     false,
        cpuPlayerId:        null,
    };

    var _pendingThrows = [];
    var _throwHistory  = [];

    // ── Public ────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        _state.matchId            = null;
        _state.players            = [];
        _state.currentPlayerIndex = 0;
        _state.currentPlayerId    = null;
        _state.variant            = config.variant || 'twenties';
        _state.status             = 'active';
        _state.winnerId           = null;
        _state.onEnd              = null;
        _state.multiplier         = 1;
        _state.setComplete        = false;
        _state.turnNumber         = 1;
        _state.targetSet          = false;
        _state.cpuDifficulty      = 'medium';
        _state.cpuTurnRunning     = false;
        _state.cpuPlayerId        = null;
        _pendingThrows = [];
        _throwHistory  = [];

        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        var _resolvedPlayers = [];

        _resolvePlayers(config.players)
            .then(function (players) {
                _resolvedPlayers = players;
                return API.createRace1000Match({
                    player_ids:     players.map(function (p) { return p.id; }),
                    variant:        _state.variant,
                    cpu_difficulty: _state.cpuPlayerId ? _state.cpuDifficulty : undefined,
                });
            })
            .then(function (s) {
                _applyState(s);
                _state.onEnd = onEnd;
                UI.setLoading(false);
                // Propagate isCpu flag from resolved players into state
                _resolvedPlayers.forEach(function (p) {
                    if (p.isCpu) {
                        var sp = _state.players.find(function (x) { return String(x.id) === String(p.id); });
                        if (sp) sp.isCpu = true;
                    }
                });
                _buildScreen();
                var welcomeMsg   = 'Welcome to the Race to 1000';
                var welcomeDelay = SPEECH.isEnabled() ? 400 + welcomeMsg.length * 130 : 0;
                if (SPEECH.isEnabled()) {
                    SPEECH.speak(welcomeMsg, { rate: 1.05, pitch: 1.0 });
                }
                setTimeout(function () {
                    if (_isCpuPlayer(_currentPlayer())) {
                        // _runCpuTurn calls _announcePlayer internally and waits for it
                        _runCpuTurn();
                    } else {
                        _announcePlayer(true);
                    }
                }, welcomeDelay);
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[race1000] start error:', err);
            });
    }

    // ── Player resolution ─────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        return Promise.all(selections.map(function (sel) {
            if (sel.isCpu) {
                // Use dedicated getCpuPlayer — finds existing record without risking 409
                return API.getCpuPlayer()
                    .catch(function () { return null; })
                    .then(function (rec) {
                        if (!rec) return API.createPlayer('CPU');
                        return rec;
                    })
                    .then(function (rec) {
                        _state.cpuDifficulty = sel.difficulty || 'medium';
                        _state.cpuPlayerId = String(rec.id);
                        return { id: rec.id, name: 'CPU', isCpu: true };
                    });
            }
            if (sel.mode === 'existing') return Promise.resolve({ id: sel.id, name: sel.name, isCpu: false });
            return API.createPlayer(sel.name).then(function (p) { return { id: p.id, name: p.name, isCpu: false }; });
        }));
    }

    // ── State helpers ─────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId = s.match_id;
        var prevPlayers = _state.players || [];
        _state.players = (s.players || []).map(function (p) {
            var prev = prevPlayers.find(function (pp) { return String(pp.id) === String(p.id); });
            return Object.assign({}, p, { isCpu: prev ? !!prev.isCpu : (p.name === 'CPU') });
        });
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
        _state.variant            = s.variant || 'twenties';
        _state.status             = s.status || 'active';
        _state.winnerId           = s.winner_id || null;
    }

    function _isCpuPlayer(p) {
        if (!p) return false;
        if (_state.cpuPlayerId && String(p.id) === _state.cpuPlayerId) return true;
        return p.isCpu === true || p.name === 'CPU';
    }

    function _currentPlayer() {
        return _state.players.find(function (p) {
            return String(p.id) === String(_state.currentPlayerId);
        }) || _state.players[_state.currentPlayerIndex] || null;
    }

    function _playerById(id) {
        return _state.players.find(function (p) { return String(p.id) === String(id); }) || null;
    }

    // ── Score dart locally (mirrors backend) ──────────────────────────────────

    function _scoreDart(segment, multiplier) {
        if (segment === 0) return 0;
        if (_state.variant === 'twenties') return segment === 20 ? segment * multiplier : 0;
        return segment * multiplier;
    }

    function _turnTotal() {
        return _pendingThrows.reduce(function (sum, t) { return sum + t.points; }, 0);
    }

    // ── Build screen ──────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-race1000';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'RACE TO 1000';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        var varLabel = _state.variant === 'twenties' ? '20s ONLY' : 'ALL NUMBERS';
        subEl.textContent = _state.players.length + ' PLAYERS · ' + varLabel;
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('race1000'); });
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
        restartBtn.id = 'r1k-restart-btn';
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
        undoBtn.id = 'r1k-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'r1k-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar — player cards with SVG rings ─────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'r1k-sidebar';
        sidebar.className = 'r1k-sidebar';
        _renderCards(sidebar);
        app.appendChild(sidebar);

        // ── Board (right column) ──────────────────────────────────────────────
        var board = document.createElement('main');
        board.id = 'r1k-seg-board';
        board.className = 'r1k-seg-board';

        // Status banner
        var statusEl = document.createElement('div');
        statusEl.id = 'r1k-status';
        statusEl.className = 'r1k-status-banner';
        board.appendChild(statusEl);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'r1k-pills';
        pills.className = 'r1k-pills';
        board.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'r1k-tabs';
        tabs.className = 'r1k-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function (tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
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
        footer.className = 'r1k-footer';
        var footerMsg = document.createElement('span');
        footerMsg.id = 'r1k-footer-msg';
        footer.appendChild(footerMsg);
        board.appendChild(footer);

        app.appendChild(board);

        _updateStatus();
        _applyHighlights();
    }

    // ── Progress bars ─────────────────────────────────────────────────────────

    // ── Leader detection ─────────────────────────────────────────────────────

    function _leaderId() {
        var maxScore = -1;
        var leader   = null;
        var tied     = false;
        _state.players.forEach(function (p) {
            if (p.score > maxScore) { maxScore = p.score; leader = p.id; tied = false; }
            else if (p.score === maxScore) { tied = true; }
        });
        return (maxScore === 0 || tied) ? null : leader;
    }

    // Returns 'leader' or 'trailing' — drives ring colour
    function _ringRole(playerId) {
        var lid = _leaderId();
        return (lid !== null && String(playerId) === String(lid)) ? 'leader' : 'trailing';
    }

    // ── SVG ring helpers ──────────────────────────────────────────────────────

    function _renderCards(container) {
        container.innerHTML = '';
        var ns = 'http://www.w3.org/2000/svg';
        _state.players.forEach(function (p) {
            var isActive = String(p.id) === String(_state.currentPlayerId);
            var role     = _ringRole(p.id);

            var card = document.createElement('div');
            card.id        = 'r1k-card-' + p.id;
            card.className = 'r1k-player-card' + (isActive ? ' r1k-active' : '') + ' r1k-ring-' + role;

            // Name
            var nameEl = document.createElement('div');
            nameEl.className = 'r1k-player-name';
            nameEl.textContent = p.name.toUpperCase();
            card.appendChild(nameEl);

            // SVG progress ring
            var svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 128 128');
            svg.setAttribute('class', 'r1k-ring-svg');
            svg.id = 'r1k-ring-' + p.id;

            var track = document.createElementNS(ns, 'circle');
            track.setAttribute('cx', _R1K_RING_CX);
            track.setAttribute('cy', _R1K_RING_CY);
            track.setAttribute('r',  _R1K_RING_R);
            track.setAttribute('class', 'r1k-ring-track');
            svg.appendChild(track);

            var arc = document.createElementNS(ns, 'circle');
            arc.setAttribute('cx', _R1K_RING_CX);
            arc.setAttribute('cy', _R1K_RING_CY);
            arc.setAttribute('r',  _R1K_RING_R);
            arc.setAttribute('class', 'r1k-ring-arc');
            arc.setAttribute('stroke-dasharray',  _R1K_RING_CIRC);
            // Start at 0 progress (empty arc), fill as score rises toward 1000
            var initFraction = Math.min(1, p.score / WIN_TARGET);
            var initOffset   = +(_R1K_RING_CIRC * (1 - initFraction)).toFixed(4);
            arc.setAttribute('stroke-dashoffset', initOffset);
            arc.id = 'r1k-arc-' + p.id;
            svg.appendChild(arc);

            // Score text inside ring
            var text = document.createElementNS(ns, 'text');
            text.setAttribute('x', _R1K_RING_CX);
            text.setAttribute('y', _R1K_RING_CY);
            text.setAttribute('dy', '0.32em');
            text.setAttribute('transform', 'rotate(90 ' + _R1K_RING_CX + ' ' + _R1K_RING_CY + ')');
            text.setAttribute('class', 'r1k-ring-text');
            text.id = 'r1k-score-' + p.id;
            text.textContent = p.score;
            svg.appendChild(text);

            card.appendChild(svg);

            // Turn sub ("+X" delta shown during active turn)
            var subEl = document.createElement('div');
            subEl.id        = 'r1k-sub-' + p.id;
            subEl.className = 'r1k-player-sub';
            card.appendChild(subEl);

            // "Needs N" hint
            var needEl = document.createElement('div');
            needEl.id        = 'r1k-need-' + p.id;
            needEl.className = 'r1k-player-need';
            var need = Math.max(0, WIN_TARGET - p.score);
            needEl.textContent = need > 0 ? 'NEEDS ' + need : 'DONE!';
            card.appendChild(needEl);

            container.appendChild(card);
        });
    }

    function _updateCards() {
        _state.players.forEach(function (p) {
            var isActive = String(p.id) === String(_state.currentPlayerId);
            var role     = _ringRole(p.id);

            // Card classes
            var card = document.getElementById('r1k-card-' + p.id);
            if (card) {
                card.className = 'r1k-player-card' + (isActive ? ' r1k-active' : '') + ' r1k-ring-' + role;
            }

            // Arc offset (counts up: more score = less offset = more arc)
            var arc = document.getElementById('r1k-arc-' + p.id);
            if (arc) {
                var fraction = Math.min(1, p.score / WIN_TARGET);
                var offset   = +(_R1K_RING_CIRC * (1 - fraction)).toFixed(4);
                arc.setAttribute('stroke-dashoffset', offset);
            }

            // Score text
            var scoreEl = document.getElementById('r1k-score-' + p.id);
            if (scoreEl) scoreEl.textContent = p.score;

            // Needs hint
            var needEl = document.getElementById('r1k-need-' + p.id);
            if (needEl) {
                var need = Math.max(0, WIN_TARGET - p.score);
                needEl.textContent = need > 0 ? 'NEEDS ' + need : 'DONE!';
            }
        });
    }

    // Keep _updateBoard as alias so _onNext call still works
    function _updateBoard() { _updateCards(); }

    function _updateTurnSub() {
        var tot = _turnTotal();
        _state.players.forEach(function (pl) {
            var subEl = document.getElementById('r1k-sub-' + pl.id);
            if (!subEl) return;
            if (String(pl.id) === String(_state.currentPlayerId) && _pendingThrows.length > 0) {
                subEl.textContent = tot > 0 ? '+' + tot : '';
                subEl.className   = 'r1k-player-sub' + (tot > 0 ? ' r1k-sub-scoring' : '');
            } else {
                subEl.textContent = '';
                subEl.className   = 'r1k-player-sub';
            }
        });
    }

    function _updateStatus() {
        var banner = document.getElementById('r1k-status');
        var footer = document.getElementById('r1k-footer-msg');
        var p = _currentPlayer();
        if (!p) return;
        var varStr = _state.variant === 'twenties' ? '20s ONLY' : 'ALL NUMBERS';
        var need   = Math.max(0, WIN_TARGET - p.score);
        if (banner) banner.textContent = p.name.toUpperCase() + '  —  ' + varStr;
        if (footer) footer.textContent = need > 0 ? 'NEEDS ' + need + ' MORE TO WIN' : 'TARGET REACHED!';
    }

    // ── Segment grid ──────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id        = 'segment-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className       = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type            = 'button';
            btn.textContent     = seg;
            (function (s) {
                btn.addEventListener('click', function () { _onThrow(s, _state.multiplier); });
            })(seg);
            grid.appendChild(btn);
        }
        return grid;
    }

    function _buildBullRow() {
        var row = document.createElement('div');
        row.id        = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn'; miss.type = 'button'; miss.textContent = 'MISS';
        miss.addEventListener('click', function () { _onThrow(0, 0); });

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn'; outer.type = 'button'; outer.textContent = 'OUTER';
        outer.addEventListener('click', function () { _onThrow(25, 1); });

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner'; bull.type = 'button'; bull.textContent = 'BULL';
        bull.addEventListener('click', function () { _onThrow(25, 2); });

        row.appendChild(miss); row.appendChild(outer); row.appendChild(bull);
        return row;
    }

    function _applyHighlights() {
        // In twenties variant, highlight the 20 button; all numbers variant — no highlight
        document.querySelectorAll('#r1k-seg-board .seg-btn[data-segment]').forEach(function (btn) {
            btn.classList.remove('target-highlight');
            if (_state.variant === 'twenties' && parseInt(btn.dataset.segment) === 20) {
                btn.classList.add('target-highlight');
            }
        });
    }

    function _lockBoard(locked) {
        var board = document.getElementById('r1k-seg-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('r1k-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ── Throw handling ────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        // Block human input during CPU turn (CPU calls _onThrow directly)
        if (_state.cpuTurnRunning && !_isCpuPlayer(_currentPlayer())) return;
        if (_pendingThrows.length >= 3) return;

        var pts = _scoreDart(segment, multiplier);

        _pendingThrows.push({ segment: segment, multiplier: multiplier, points: pts });
        _throwHistory.push({ segment: segment, multiplier: multiplier, points: pts });

        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled() && pts > 0) SOUNDS.dart();

        _addPill(segment, multiplier, pts);
        var dartDuration = _speakDart(segment, multiplier, pts);
        _updateTurnSub();

        var ub = document.getElementById('r1k-undo-btn');
        if (ub) ub.disabled = false;

        if (_pendingThrows.length >= 3) {
            _state.setComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('r1k-next-btn');
            if (nb) nb.disabled = false;
        }
    }

    // ── Next ──────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var throws   = _pendingThrows.slice();
        var turnNum  = _state.turnNumber;

        var submitPromise = throws.length > 0
            ? API.race1000Throw(_state.matchId, { throws: throws, turn_number: turnNum })
            : Promise.resolve(null);

        submitPromise
            .then(function () {
                return API.race1000Next(_state.matchId, { turn_number: turnNum });
            })
            .then(function (s) {
                var events = s.events || [];
                _applyState(s);
                UI.setLoading(false);
                _clearTurn();

                // Increment local turn counter when round wraps
                var scoredEv = events.find(function (e) { return e.type === 'scored'; });
                if (scoredEv) {
                    // Update the specific player score in _state.players for immediate UI
                    var pl = _playerById(scoredEv.player_id);
                    if (pl) pl.score = scoredEv.new_score;
                }

                _updateBoard();
                _updateCards();
                _updateStatus();

                var winnerEv   = events.find(function (e) { return e.type === 'winner'; });
                var targetSetEv = events.find(function (e) { return e.type === 'target_set'; });

                if (winnerEv) {
                    var winnerPl = _playerById(winnerEv.player_id);
                    var delay    = 400;
                    if (scoredEv) {
                        delay = _speakTurnEnd(scoredEv, true);
                    }
                    setTimeout(function () { _showResult(winnerEv); }, delay);
                    return;
                }

                _state.turnNumber++;

                // Announce target set (player reached 1000 but others still to throw)
                var afterDelay = 400;
                if (targetSetEv) {
                    var tsPl = _playerById(targetSetEv.player_id);
                    if (tsPl && SPEECH.isEnabled()) {
                        var tsMsg = tsPl.name + ' has set the target at ' + targetSetEv.score +
                                    '! Others still to throw.';
                        setTimeout(function () {
                            window.speechSynthesis && window.speechSynthesis.cancel();
                            SPEECH.speak(tsMsg, { rate: 1.0, pitch: 1.0 });
                        }, afterDelay);
                        afterDelay += 600 + tsMsg.length * 75;
                    }
                } else if (scoredEv) {
                    afterDelay = _speakTurnEnd(scoredEv, false);
                }

                setTimeout(function () {
                    if (_isCpuPlayer(_currentPlayer())) {
                        // _runCpuTurn calls _announcePlayer internally and waits for it
                        _runCpuTurn();
                    } else {
                        _announcePlayer(false);
                    }
                }, afterDelay);
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[race1000] next error:', err);
            });
    }

    // ── CPU turn ──────────────────────────────────────────────────────────────

    function _runCpuTurn() {
        if (_state.cpuTurnRunning || _state.status !== 'active') return;
        if (!_isCpuPlayer(_currentPlayer())) return;
        _state.cpuTurnRunning = true;

        var dartsThrown = 0;

        function _throwNext() {
            if (dartsThrown >= 3) {
                _state.cpuTurnRunning = false;
                _lockBoard(false);
                setTimeout(_onNext, 600);
                return;
            }
            var dart = _cpuChooseDart();
            dartsThrown++;
            // Speak the dart and wait for it to finish before throwing the next one
            var speechDur = _speakDart(dart.segment, dart.multiplier, 0);
            _onThrow(dart.segment, dart.multiplier);
            var nextDelay = Math.max(1000, speechDur + 450);
            setTimeout(_throwNext, nextDelay);
        }

        _lockBoard(true);
        var nb = document.getElementById('r1k-next-btn'); if (nb) nb.disabled = true;
        var ub = document.getElementById('r1k-undo-btn'); if (ub) ub.disabled = true;

        // Wait for "CPU's turn to throw" announcement to finish before first dart
        var announceWait = _announcePlayer(false);
        setTimeout(_throwNext, Math.max(1000, announceWait + 400));
    }

    function _cpuChooseDart() {
        var profile  = _cpuProfile();
        var intended = _cpuIntend();
        return _cpuApplyVariance(intended.segment, intended.multiplier, profile);
    }

    function _cpuIntend() {
        var diff = _state.cpuDifficulty;
        var r = Math.random();
        var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

        if (_state.variant === 'twenties') {
            if (diff === 'hard') {
                // Hard (was Medium): T20 60%, D20 20%, S20 20%
                if (r < 0.60) return { segment: 20, multiplier: 3 };
                if (r < 0.80) return { segment: 20, multiplier: 2 };
                return { segment: 20, multiplier: 1 };
            } else if (diff === 'medium') {
                // Medium (was Easy): T20 35%, D20 25%, S20 25%, brain fade 15%
                if (r < 0.35) return { segment: 20, multiplier: 3 };
                if (r < 0.60) return { segment: 20, multiplier: 2 };
                if (r < 0.85) return { segment: 20, multiplier: 1 };
                return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            } else {
                // Easy (new): T20 <5%, D20 <10%, lots of S20/S1/S5, regular brain fades
                if (r < 0.04) return { segment: 20, multiplier: 3 };
                if (r < 0.12) return { segment: 20, multiplier: 2 };
                if (r < 0.35) return { segment: 20, multiplier: 1 };
                if (r < 0.52) return { segment: 1,  multiplier: 1 };
                if (r < 0.67) return { segment: 5,  multiplier: 1 };
                return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            }
        } else {
            // All-numbers variant
            if (diff === 'hard') {
                // Hard: mostly T20, occasional T19
                if (r < 0.85) return { segment: 20, multiplier: 3 };
                return { segment: 19, multiplier: 3 };
            } else if (diff === 'medium') {
                // Medium: mix of T20, D20, S20 with some brain fades
                if (r < 0.35) return { segment: 20, multiplier: 3 };
                if (r < 0.60) return { segment: 20, multiplier: 2 };
                if (r < 0.80) return { segment: 20, multiplier: 1 };
                return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            } else {
                // Easy: T20 <5%, D20 <10%, mainly singles, lots of S1/S5, regular brain fades
                if (r < 0.04) return { segment: 20, multiplier: 3 };
                if (r < 0.12) return { segment: 20, multiplier: 2 };
                if (r < 0.30) return { segment: 20, multiplier: 1 };
                if (r < 0.47) return { segment: 1,  multiplier: 1 };
                if (r < 0.62) return { segment: 5,  multiplier: 1 };
                return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            }
        }
    }

    function _cpuProfile() {
        var profiles = {
            easy:   { trebleHit: 0.45, trebleSingle: 0.30, doubleHit: 0.55, doubleSingle: 0.25, singleHit: 0.88 },
            medium: { trebleHit: 0.72, trebleSingle: 0.18, doubleHit: 0.68, doubleSingle: 0.18, singleHit: 0.94 },
            hard:   { trebleHit: 0.88, trebleSingle: 0.08, doubleHit: 0.82, doubleSingle: 0.12, singleHit: 0.98 },
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
        var r = Math.random();
        if (multiplier === 3) {
            if (r < profile.trebleHit) return { segment: segment, multiplier: 3 };
            if (r < profile.trebleHit + profile.trebleSingle) return { segment: segment, multiplier: 1 };
            return { segment: adjacent(segment), multiplier: 1 };
        }
        if (multiplier === 2) {
            if (r < profile.doubleHit) return { segment: segment, multiplier: 2 };
            if (r < profile.doubleHit + profile.doubleSingle) return { segment: segment, multiplier: 1 };
            return { segment: 0, multiplier: 0 };
        }
        if (r < profile.singleHit) return { segment: segment, multiplier: 1 };
        return { segment: adjacent(segment), multiplier: 1 };
    }

    function _clearTurn() {
        _pendingThrows  = [];
        _throwHistory   = [];
        _state.setComplete = false;

        var pills = document.getElementById('r1k-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('r1k-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('r1k-undo-btn');
        if (ub) ub.disabled = true;
        _lockBoard(false);

        _state.multiplier = 1;
        var tabs = document.getElementById('r1k-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var s1 = tabs.querySelector('[data-multiplier="1"]');
            if (s1) s1.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;

        _state.players.forEach(function (p) {
            var subEl = document.getElementById('r1k-sub-' + p.id);
            if (subEl) { subEl.textContent = ''; subEl.className = 'r1k-player-sub'; }
        });
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_state.cpuTurnRunning) return;
        if (_throwHistory.length === 0) return;

        _throwHistory.pop();
        _pendingThrows.pop();

        if (_state.setComplete) {
            _state.setComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('r1k-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('r1k-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('r1k-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateTurnSub();
    }

    // ── End ───────────────────────────────────────────────────────────────────

    function _onRestart() {
        UI.showConfirmModal({
            title:        'RESTART MATCH?',
            message:      'All scores will be reset to zero. This cannot be undone.',
            confirmLabel: 'YES, RESTART',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doRestart,
        });
    }

    function _doRestart() {
        UI.setLoading(true);
        API.restartRace1000Match(_state.matchId)
            .then(function (state) {
                _applyState(state);
                _buildScreen();
                UI.showToast('MATCH RESTARTED', 'info', 2000);
                var startDelay = _announceCurrentPlayer(true);
                if (_isCpuPlayer(_currentPlayer())) {
                    setTimeout(_runCpuTurn, startDelay + 400);
                }
            })
            .catch(function (err) {
                UI.showToast('RESTART FAILED: ' + err.message.toUpperCase(), 'bust', 3000);
            })
            .finally(function () { UI.setLoading(false); });
    }

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Race to 1000 match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endRace1000Match(_state.matchId)
                    .then(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); })
                    .catch(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); });
            }
        });
    }

    // ── Result screen ─────────────────────────────────────────────────────────

    function _showResult(winnerEv) {
        var winnerPl = _playerById(winnerEv.player_id) ||
                       _playerById(String(winnerEv.player_id));
        var winName  = winnerPl ? winnerPl.name.toUpperCase() : 'WINNER';

        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">🏁 ' + _esc(winName) + ' WINS!</div>' +
            '<div class="setup-subtitle">RACE TO 1000 · ' +
            (_state.variant === 'twenties' ? '20s ONLY' : 'ALL NUMBERS') + '</div>' +
            '</div>';

        // Standings table
        var table = document.createElement('div');
        table.className = 'r1k-result-table';

        var head = document.createElement('div');
        head.className = 'r1k-result-row r1k-result-head';
        head.innerHTML =
            '<span class="r1k-result-name">PLAYER</span>' +
            '<span class="r1k-result-score">SCORE</span>';
        table.appendChild(head);

        var sorted = _state.players.slice().sort(function (a, b) { return b.score - a.score; });
        sorted.forEach(function (p) {
            var isWin = String(p.id) === String(winnerEv.player_id);
            var row = document.createElement('div');
            row.className = 'r1k-result-row' + (isWin ? ' r1k-result-winner' : '');
            row.innerHTML =
                '<span class="r1k-result-name">' + _esc(p.name.toUpperCase()) +
                (isWin ? ' 🏁' : '') + '</span>' +
                '<span class="r1k-result-score">' + p.score + '</span>';
            table.appendChild(row);
        });
        inner.appendChild(table);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn'; doneBtn.type = 'button'; doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        if (SPEECH.isEnabled()) {
            setTimeout(function () {
                var msg = winName + ' wins the race to one thousand! Well played.';
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
            }, 800);
        }
    }

    // ── Pills ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, points) {
        var pills = document.getElementById('r1k-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0  ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className   = 'dart-pill' + (points > 0 ? ' pill-hot' : ' pill-miss');
        pill.textContent = points > 0 ? segStr + ' +' + points : segStr;
        pills.appendChild(pill);
    }

    // ── Speech ────────────────────────────────────────────────────────────────

    function _announcePlayer(isFirst) {
        // Returns estimated ms until speech is finished (delay + speaking time)
        if (!SPEECH.isEnabled()) return 0;
        var p = _currentPlayer();
        if (!p) return 0;
        var msg   = p.name + "'s turn to throw.";
        var delay = isFirst ? 700 : 500;
        var dur   = delay + 200 + msg.length * 120;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, delay);
        return dur;
    }

    function _speakDart(segment, multiplier, points) {
        // Returns estimated speech duration in ms
        if (!SPEECH.isEnabled()) return 0;
        var label;
        if (segment === 0) {
            label = 'Miss';
        } else if (segment === 25) {
            label = multiplier === 2 ? 'Bulls Eye' : 'Outer bull';
        } else {
            var mulLabel = multiplier === 3 ? 'Treble ' : multiplier === 2 ? 'Double ' : '';
            label = mulLabel + segment;
        }
        window.speechSynthesis && window.speechSynthesis.cancel();
        SPEECH.speak(label, { rate: 1.0, pitch: 1.0 });
        return 300 + label.length * 120;
    }

    function _speakTurnSummary() {
        if (!SPEECH.isEnabled()) return;
        var total = _turnTotal();
        var msg   = total > 0 ? total + ' this turn.' : 'No score this turn.';
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 600);
    }

    // Speak "X this turn. Total: Y." Returns ms to wait before chaining.
    function _speakTurnEnd(scoredEv, isFinal) {
        if (!SPEECH.isEnabled()) return 400;
        var p   = _playerById(scoredEv.player_id);
        var msg = (scoredEv.turn_points > 0
            ? scoredEv.turn_points + ' this turn. '
            : 'No score this turn. ') +
            (p ? p.name + "'s total is " + scoredEv.new_score + '.' : '');
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 300);
        return 300 + 2600 + msg.length * 95;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();