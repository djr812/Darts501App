/**
 * nine_lives.js
 * -------------
 * Nine Lives darts game controller.
 *
 * Public API:
 *   NINE_LIVES_GAME.start(config, onEnd)
 *     config: { players: [{id, name}|{mode:'new', name}] }
 *     onEnd:  called when game ends or is abandoned
 */

var NINE_LIVES_GAME = (function () {

    // ── State ─────────────────────────────────────────────────────────────────
    var _state = {
        matchId:            null,
        gameId:             null,
        players:            [],
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        status:             'active',
        winnerId:           null,
        onEnd:              null,
        multiplier:         1,
        turnNumber:         1,
        setComplete:        false,
        cpuPlayerId:        null,
    };

    // Buffered throws for current set (submitted on NEXT)
    var _pendingThrows  = [];
    var _throwHistory   = [];   // for undo
    var _hitThisTurn    = false;  // did current player hit their target this turn?
    var _pendingWinner  = null;   // detected locally, confirmed on NEXT

    // ── Public ────────────────────────────────────────────────────────────────

    function start(config, onEnd) {
        // Full reset
        _state.matchId            = null;
        _state.gameId             = null;
        _state.players            = [];
        _state.currentPlayerIndex = 0;
        _state.currentPlayerId    = null;
        _state.status             = 'active';
        _state.winnerId           = null;
        _state.onEnd              = null;
        _state.multiplier         = 1;
        _state.turnNumber         = 1;
        _state.setComplete        = false;
        _state.cpuDifficulty  = 'medium';
        _state.cpuTurnRunning = false;
        _pendingThrows  = [];
        _throwHistory   = [];
        _hitThisTurn    = false;
        _pendingWinner  = null;

        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        var _resolvedPlayers = [];
        _resolvePlayers(config.players)
            .then(function (players) {
                _resolvedPlayers = players;
                return API.createNineLivesMatch({
                    player_ids:     players.map(function (p) { return p.id; }),
                    cpu_difficulty: _state.cpuPlayerId ? _state.cpuDifficulty : undefined,
                });
            })
            .then(function (s) {
                _applyState(s);
                _resolvedPlayers.forEach(function (p) {
                    if (p.isCpu) {
                        var sp = _state.players.find(function (x) { return String(x.id) === String(p.id); });
                        if (sp) sp.isCpu = true;
                    }
                });
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                var welcomeMsg   = 'Welcome to Nine Lives Darts';
                var welcomeDelay = SPEECH.isEnabled() ? 400 + welcomeMsg.length * 130 : 0;
                if (SPEECH.isEnabled()) {
                    SPEECH.speak(welcomeMsg, { rate: 1.05, pitch: 1.0 });
                }
                setTimeout(function () {
                    var startDelay = _announceCurrentPlayer(true);
                    if (_isCpuPlayer(_currentPlayer())) {
                        setTimeout(_runCpuTurn, startDelay + 400);
                    }
                }, welcomeDelay);
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[nine_lives] start error:', err);
            });
    }

    // ── Player resolution ─────────────────────────────────────────────────────

    function _resolvePlayers(selections) {
        // Process sequentially to avoid race conditions
        var result = [];
        function resolveNext(i) {
            if (i >= selections.length) return Promise.resolve(result);
            var sel = selections[i];
            var p;
            if (sel.isCpu) {
                p = API.getCpuPlayer()
                    .catch(function () { return null; })
                    .then(function (rec) { return rec || API.createPlayer('CPU'); })
                    .then(function (rec) {
                        _state.cpuDifficulty = sel.difficulty || 'medium';
                        _state.cpuPlayerId = String(rec.id);
                        result.push({ id: rec.id, name: 'CPU', isCpu: true });
                    });
            } else if (sel.mode === 'existing') {
                result.push({ id: sel.id, name: sel.name, isCpu: false });
                p = Promise.resolve();
            } else {
                p = API.createPlayer(sel.name).then(function (rec) {
                    result.push({ id: rec.id, name: rec.name, isCpu: false });
                });
            }
            return p.then(function () { return resolveNext(i + 1); });
        }
        return resolveNext(0);
    }

    // ── State ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.gameId             = s.game_id;
        var prev = _state.players || [];
        _state.players = (s.players || []).map(function (p) {
            var old = prev.find(function (pp) { return String(pp.id) === String(p.id); });
            return Object.assign({}, p, { isCpu: old ? !!old.isCpu : (p.name === 'CPU') });
        });
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
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

    // ── Build screen ──────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-nine-lives';

        // ── Header ────────────────────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'NINE LIVES';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · 1–20 IN ORDER';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('nine_lives'); });
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
        restartBtn.id = 'nl-restart-btn';
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
        undoBtn.id = 'nl-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'nl-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar (left column) — player cards ──────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'nl-sidebar';
        sidebar.className = 'nl-sidebar';
        _renderBoard(sidebar);
        app.appendChild(sidebar);

        // ── Board (right column) ──────────────────────────────────────────────
        var board = document.createElement('main');
        board.id = 'nl-seg-board';
        board.className = 'nl-seg-board';

        // Status banner
        var statusEl = document.createElement('div');
        statusEl.id = 'nl-status';
        statusEl.className = 'nl-status-banner';
        board.appendChild(statusEl);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'nl-pills';
        pills.className = 'nl-pills';
        board.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'nl-tabs';
        tabs.className = 'nl-tabs';
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
        footer.className = 'nl-footer';
        var footerMsg = document.createElement('span');
        footerMsg.id = 'nl-footer-msg';
        footer.appendChild(footerMsg);
        board.appendChild(footer);

        app.appendChild(board);

        _updateStatus();
        _applyTargetHighlight();
    }

    // ── Scoreboard ────────────────────────────────────────────────────────────

    function _renderBoard(container) {
        container.innerHTML = '';
        _state.players.forEach(function (p) {
            var card = document.createElement('div');
            card.id        = 'nl-row-' + p.id;
            card.className = 'nl-player-card' +
                (String(p.id) === String(_state.currentPlayerId) ? ' nl-active' : '') +
                (p.eliminated ? ' nl-eliminated' : '');

            // Name
            var nameEl = document.createElement('div');
            nameEl.className = 'nl-player-name';
            nameEl.textContent = p.name.toUpperCase();

            // Target number — large display
            var targetEl = document.createElement('div');
            targetEl.id        = 'nl-target-' + p.id;
            targetEl.className = 'nl-player-target';
            targetEl.textContent = p.completed ? '✓' : p.target;

            // Lives pips (9 total)
            var livesEl = document.createElement('div');
            livesEl.id        = 'nl-lives-' + p.id;
            livesEl.className = 'nl-lives';
            _renderLives(livesEl, p.lives);

            card.appendChild(nameEl);
            card.appendChild(targetEl);
            card.appendChild(livesEl);
            container.appendChild(card);
        });
    }

    function _renderLives(container, lives) {
        container.innerHTML = '';
        for (var i = 0; i < 9; i++) {
            var pip = document.createElement('span');
            if (i < lives) {
                pip.className = 'nl-life-pip nl-life-pip-on';
                pip.textContent = '\u{1F408}';  // 🐈 cat
            } else {
                pip.className = 'nl-life-pip';
                pip.textContent = '\u26B0';     // ⚰ coffin
            }
            container.appendChild(pip);
        }
    }

    function _updateBoard() {
        _state.players.forEach(function (p) {
            var card = document.getElementById('nl-row-' + p.id);
            if (card) {
                card.className = 'nl-player-card' +
                    (String(p.id) === String(_state.currentPlayerId) ? ' nl-active' : '') +
                    (p.eliminated ? ' nl-eliminated' : '');
            }
            var targetEl = document.getElementById('nl-target-' + p.id);
            if (targetEl) targetEl.textContent = p.completed ? '✓' : p.target;
            var livesEl = document.getElementById('nl-lives-' + p.id);
            if (livesEl) _renderLives(livesEl, p.lives);
        });
    }

    // Compute working state by replaying pending throws locally
    function _workingState() {
        var p = _currentPlayer();
        if (!p) return { target: 1, hit: false };
        var target = p.target;  // never changes mid-turn
        var hit    = false;
        _pendingThrows.forEach(function (t) {
            if (t.segment === target) hit = true;
        });
        return { target: target, hit: hit };
    }

    function _updateBoardWorking() {
        var ws = _workingState();
        var p  = _currentPlayer();
        if (!p) return;
        var targetEl = document.getElementById('nl-target-' + p.id);
        if (targetEl) targetEl.textContent = ws.target > 20 ? '✓' : ws.target;
    }

    function _updateStatus() {
        var banner = document.getElementById('nl-status');
        var footer = document.getElementById('nl-footer-msg');
        var p  = _currentPlayer();
        if (!p) return;
        var ws = _workingState();
        var targetStr = ws.target > 20 ? '20 ✓' : ws.target;
        var livesLeft = p.lives;
        if (banner) banner.textContent = p.name.toUpperCase() + '  —  TARGET: ' + targetStr;
        if (footer) footer.textContent = livesLeft + (livesLeft === 1 ? ' LIFE' : ' LIVES') + ' REMAINING  ·  MUST HIT ' + targetStr + ' TO ADVANCE';
    }

    // ── Segment grid ──────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id        = 'segment-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className      = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type           = 'button';
            btn.textContent    = seg;
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
        miss.className   = 'seg-btn bull-btn';
        miss.type        = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function () { _onThrow(0, 0); });

        var outer = document.createElement('button');
        outer.className   = 'seg-btn bull-btn';
        outer.type        = 'button';
        outer.textContent = 'OUTER';
        outer.addEventListener('click', function () { _onThrow(25, 1); });

        var bull = document.createElement('button');
        bull.className   = 'seg-btn bull-btn bull-btn-inner';
        bull.type        = 'button';
        bull.textContent = 'BULL';
        bull.addEventListener('click', function () { _onThrow(25, 2); });

        row.appendChild(miss);
        row.appendChild(outer);
        row.appendChild(bull);
        return row;
    }

    function _applyTargetHighlight() {
        var ws = _workingState();
        var target = ws.target <= 20 ? ws.target : null;
        document.querySelectorAll('#nl-seg-board .seg-btn[data-segment]').forEach(function (btn) {
            var seg = parseInt(btn.dataset.segment);
            btn.classList.remove('target-highlight');
            if (seg === target) btn.classList.add('target-highlight');
        });
    }

    function _lockBoard(locked) {
        var board = document.getElementById('nl-seg-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('nl-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ── Throw handling ────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        if (_pendingThrows.length >= 3) return;
        if (_state.cpuTurnRunning && !_isCpuPlayer(_currentPlayer())) return;

        var p      = _currentPlayer();
        var ws     = _workingState();
        // First dart to match the target scores the hit; further hits same number are neutral
        var isHit     = (!ws.hit && segment === ws.target && segment !== 0);
        var isNeutral = (ws.hit && segment === ws.target && segment !== 0);

        if (isHit && ws.target === 20) {
            _pendingWinner = p.id;
        }

        _pendingThrows.push({ segment: segment, multiplier: multiplier, isHit: isHit });
        _throwHistory.push({ segment: segment, multiplier: multiplier, isHit: isHit });

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (isHit) SOUNDS.dart();
        }

        // Pill
        _addPill(segment, multiplier, isHit, isNeutral);

        // Per-dart speech (just the number/label)
        // CPU turns: speech is called by throwNext before _onThrow for correct timing
        if (!_state.cpuTurnRunning) {
            _speakDart(segment, multiplier, isHit);
        }

        // Update working target display
        _updateBoardWorking();
        _updateStatus();
        _applyTargetHighlight();

        var ub = document.getElementById('nl-undo-btn');
        if (ub) ub.disabled = false;

        // Lock after 3 darts or after hitting target on final number (instant win)
        if (_pendingThrows.length >= 3 || _pendingWinner !== null) {
            _state.setComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('nl-next-btn');
            if (nb) nb.disabled = false;
        }
    }

    // ── Next ──────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var throws       = _pendingThrows.slice();
        var ws           = _workingState();
        var hitThisTurn  = ws.hit;
        var turnNum      = _state.turnNumber;
        var isWin        = _pendingWinner !== null;

        var submitPromise = throws.length > 0
            ? API.nineLivesThrow(_state.matchId, { throws: throws, turn_number: turnNum })
            : Promise.resolve(null);

        submitPromise
            .then(function (s) {
                if (s) _applyState(s);

                // Check server confirmed win
                if (isWin || (s && s.status === 'complete')) {
                    _state.status  = 'complete';
                    _state.winnerId = _pendingWinner || (s && s.winner_id) || _state.winnerId;
                    UI.setLoading(false);
                    _pendingWinner = null;
                    _clearTurn();
                    _updateBoard();
                    _showResult();
                    return;
                }

                // Pass hit result to /next so it can deduct life if missed
                return API.nineLivesNext(_state.matchId, { hit_this_turn: hitThisTurn });
            })
            .then(function (s) {
                if (!s) return;
                _clearTurn();
                _applyState(s);
                UI.setLoading(false);

                // Process events
                var events = s.events || [];
                var eliminated = events.filter(function (e) { return e.type === 'eliminated'; });
                var lifeLost   = events.filter(function (e) { return e.type === 'life_lost'; });

                // Check for winner declared by server (last survivor)
                var winEvent = events.find(function (e) { return e.type === 'winner'; });
                if (winEvent || s.status === 'complete') {
                    _state.status   = 'complete';
                    _state.winnerId = winEvent ? winEvent.player_id : s.winner_id;
                    _updateBoard();
                    _announceEliminations(eliminated, function () { _showResult(); });
                    return;
                }

                _updateBoard();
                _applyTargetHighlight();

                // Announce life lost / eliminations then next player
                if (!hitThisTurn) {
                    _announceLifeLost(lifeLost, eliminated, function () {
                        var d = _announceCurrentPlayer(false);
                        if (_isCpuPlayer(_currentPlayer())) {
                            setTimeout(_runCpuTurn, d + 400);
                        }
                    });
                } else {
                    var d = _announceCurrentPlayer(false);
                    if (_isCpuPlayer(_currentPlayer())) {
                        setTimeout(_runCpuTurn, d + 400);
                    }
                }
            })
            .catch(function (err) {
                UI.setLoading(false);
                console.error('[nine_lives] next error:', err);
            });
    }

    // ── CPU turn ──────────────────────────────────────────────────────────────

    function _runCpuTurn() {
        if (_state.cpuTurnRunning || _state.status !== 'active') return;
        if (!_isCpuPlayer(_currentPlayer())) return;
        _state.cpuTurnRunning = true;
        _lockBoard(true);
        var nb = document.getElementById('nl-next-btn'); if (nb) nb.disabled = true;
        var ub = document.getElementById('nl-undo-btn'); if (ub) ub.disabled = true;

        var dartsThrown = 0;

        function throwNext() {
            // Stop early if all 3 darts thrown or turn already complete
            if (dartsThrown >= 3 || _state.setComplete) {
                _state.cpuTurnRunning = false;
                _lockBoard(false);
                setTimeout(_onNext, 1800);
                return;
            }
            var ws       = _workingState();
            var dart     = _cpuNLChooseDart(ws.target, ws.hit);
            dartsThrown++;
            var speechDur = _speakDart(dart.segment, dart.multiplier, dart.segment === ws.target);
            _onThrow(dart.segment, dart.multiplier);
            var nextDelay = Math.max(1200, speechDur + 500);
            setTimeout(throwNext, nextDelay);
        }

        setTimeout(throwNext, 600);
    }

    function _cpuNLChooseDart(target, alreadyHit) {
        var profile = _cpuNLProfile();
        var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

        function adjacentTo(seg) {
            var idx = BOARD_RING.indexOf(seg);
            if (idx === -1) return seg;
            return BOARD_RING[(idx + (Math.random() < 0.5 ? 1 : -1) + BOARD_RING.length) % BOARD_RING.length];
        }

        // If already hit this turn, remaining darts are neutral — just throw singles
        // CPU still aims at target (neutral hit) or misses; doesn't matter strategically
        if (alreadyHit) {
            return { segment: target, multiplier: 1 };
        }

        // CPU intends to hit the target with some multiplier
        var r = Math.random();

        // Decide intended multiplier based on difficulty
        var intendedMult;
        if (profile.preferTreble && r < 0.30) {
            intendedMult = 3;
        } else if (r < profile.doubleRate) {
            intendedMult = 2;
        } else {
            intendedMult = 1;
        }

        // Apply accuracy variance
        var acc = Math.random();
        if (acc < profile.hitRate) {
            // Hit — lands on target with intended multiplier
            return { segment: target, multiplier: intendedMult };
        } else if (acc < profile.hitRate + profile.adjacentRate) {
            // Near miss — adjacent segment, single
            return { segment: adjacentTo(target), multiplier: 1 };
        } else if (acc < profile.hitRate + profile.adjacentRate + profile.brainFadeRate) {
            // Brain fade — random segment
            return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
        } else {
            // Complete miss
            return { segment: 0, multiplier: 0 };
        }
    }

    function _cpuNLProfile() {
        var profiles = {
            // Easy: ~4% hit rate per dart → ~11% chance of hitting in a full turn of 3
            // Overwhelmingly misses — adjacent landings, brain fades, complete misses
            easy: {
                preferTreble:  false,
                doubleRate:    0.02,
                hitRate:       0.04,
                adjacentRate:  0.25,
                brainFadeRate: 0.40,
                // remainder (~0.31) = complete miss
            },
            // Medium: ~35% hit rate per dart → ~73% chance of hitting in a full turn
            medium: {
                preferTreble:  false,
                doubleRate:    0.15,
                hitRate:       0.35,
                adjacentRate:  0.25,
                brainFadeRate: 0.20,
            },
            // Hard: ~85% hit rate per dart — dangerous, occasionally aims trebles
            hard: {
                preferTreble:  true,
                doubleRate:    0.30,
                hitRate:       0.85,
                adjacentRate:  0.10,
                brainFadeRate: 0.03,
            },
        };
        return profiles[_state.cpuDifficulty] || profiles.medium;
    }

    function _clearTurn() {
        _state.cpuDifficulty  = 'medium';
        _state.cpuTurnRunning = false;
        _pendingThrows  = [];
        _throwHistory   = [];
        _hitThisTurn    = false;
        _pendingWinner  = null;
        _state.setComplete = false;
        _state.turnNumber++;

        var pills = document.getElementById('nl-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('nl-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('nl-undo-btn');
        if (ub) ub.disabled = true;
        _lockBoard(false);

        // Reset multiplier to Single
        _state.multiplier = 1;
        var tabs = document.getElementById('nl-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var s1 = tabs.querySelector('[data-multiplier="1"]');
            if (s1) s1.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;
    }

    // ── Undo ──────────────────────────────────────────────────────────────────

    function _onUndo() {
        if (_state.cpuTurnRunning) return;
        if (_throwHistory.length === 0) return;

        _throwHistory.pop();
        _pendingThrows.pop();
        _pendingWinner = null;

        if (_state.setComplete) {
            _state.setComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('nl-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('nl-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('nl-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);

        _updateBoardWorking();
        _updateStatus();
        _applyTargetHighlight();
    }

    // ── End ───────────────────────────────────────────────────────────────────

    function _onRestart() {
        UI.showConfirmModal({
            title:        'RESTART MATCH?',
            message:      'All progress will be wiped and the match will restart from scratch. This cannot be undone.',
            confirmLabel: 'YES, RESTART',
            confirmClass: 'confirm-btn-danger',
            onConfirm:    _doRestart,
        });
    }

    function _doRestart() {
        UI.setLoading(true);
        API.restartNineLivesMatch(_state.matchId)
            .then(function (state) {
                _applyState(state);
                _welcomedPlayers = {};
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
            .finally(function () {
                UI.setLoading(false);
            });
    }

    function _onEnd() {
        UI.showConfirmModal({
            title:    'END GAME?',
            message:  'Abandon this Nine Lives match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endNineLivesMatch(_state.matchId)
                    .then(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); })
                    .catch(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); });
            }
        });
    }

    // ── Result screen ─────────────────────────────────────────────────────────

    function _showResult() {
        var winner  = _playerById(_state.winnerId);
        var winName = winner ? winner.name.toUpperCase() : 'WINNER';

        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">🏆 ' + _esc(winName) + ' WINS!</div>' +
            '<div class="setup-subtitle">NINE LIVES DARTS</div>' +
            '</div>';

        // Final standings
        var table = document.createElement('div');
        table.className = 'nl-result-table';

        var head = document.createElement('div');
        head.className = 'nl-result-row nl-result-head';
        head.innerHTML =
            '<span class="nl-result-name">PLAYER</span>' +
            '<span class="nl-result-target">TARGET</span>' +
            '<span class="nl-result-lives">LIVES</span>';
        table.appendChild(head);

        var sorted = _state.players.slice().sort(function (a, b) {
            if (String(a.id) === String(_state.winnerId)) return -1;
            if (String(b.id) === String(_state.winnerId)) return 1;
            if (a.completed && !b.completed) return -1;
            if (!a.completed && b.completed) return 1;
            if (b.target !== a.target) return b.target - a.target;
            return b.lives - a.lives;
        });

        sorted.forEach(function (p) {
            var isWinner = String(p.id) === String(_state.winnerId);
            var row = document.createElement('div');
            row.className = 'nl-result-row' + (isWinner ? ' nl-result-winner' : '');
            row.innerHTML =
                '<span class="nl-result-name">' + _esc(p.name.toUpperCase()) + '</span>' +
                '<span class="nl-result-target">' + (p.completed ? '✓ Done' : p.target) + '</span>' +
                '<span class="nl-result-lives">' + p.lives + '</span>';
            table.appendChild(row);
        });
        inner.appendChild(table);

        var doneBtn = document.createElement('button');
        doneBtn.className   = 'start-btn';
        doneBtn.type        = 'button';
        doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        _speakWinner(winName);
    }

    // ── Pills ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, isHit, isNeutral) {
        var pills = document.getElementById('nl-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0   ? 'MISS' :
                     segment === 25  ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className   = 'dart-pill' + (isHit ? ' pill-hot' : isNeutral ? '' : ' pill-miss');
        pill.textContent = isHit ? segStr + ' ✓' : segStr;
        pills.appendChild(pill);
    }

    // ── Speech ────────────────────────────────────────────────────────────────

    function _speak(text, delay) {
        if (!SPEECH.isEnabled()) return;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(text, { rate: 1.0, pitch: 1.0 });
        }, delay || 200);
    }

    function _announceCurrentPlayer(isFirst) {
        var p = _currentPlayer();
        if (!p) return 0;
        var ws = _workingState();
        var target = ws.target <= 20 ? ws.target : 20;
        var delay  = isFirst ? 600 : 400;
        var msg    = p.name + ', you are targeting ' + target + '.';
        _speak(msg, delay);
        // Return total time before speech finishes so callers can wait
        // 300ms TTS startup + 150ms/char for iOS speech rate
        return delay + 300 + msg.length * 150;
    }

    function _speakDart(segment, multiplier, isHit) {
        if (!SPEECH.isEnabled()) return 0;
        var mulLabel = multiplier === 3 ? 'Treble' : multiplier === 2 ? 'Double' : '';
        var segLabel = segment === 0   ? 'Miss' :
                       segment === 25  ? (multiplier === 2 ? 'Bulls Eye' : 'Outer bull') :
                       (mulLabel ? mulLabel + ' ' + segment : String(segment));
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(segLabel, { rate: 1.0, pitch: 1.0 });
        }, 200);
        // Return estimated duration: 200ms delay + 300ms TTS startup + 150ms/char
        return 200 + 300 + segLabel.length * 150;
    }

    function _announceLifeLost(lifeLostEvents, eliminatedEvents, callback) {
        if (!SPEECH.isEnabled()) {
            if (callback) callback();
            return;
        }
        var msgs = [];
        lifeLostEvents.forEach(function (ev) {
            var pl = _playerById(ev.player_id);
            if (pl) msgs.push(pl.name + ' loses a life. ' + ev.lives_remaining + ' remaining.');
        });
        if (msgs.length === 0) {
            if (callback) setTimeout(callback, 200);
            return;
        }
        var msg = msgs.join(' ');
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 300);
        // 300ms delay + 300ms TTS startup + 150ms/char
        var lifeLostDuration = 300 + 300 + msg.length * 150;
        _announceEliminations(eliminatedEvents, callback, lifeLostDuration);
    }

    function _announceEliminations(events, callback, baseDelay) {
        var msgs = [];
        if (events && events.length) {
            events.forEach(function (ev) {
                var pl = _playerById(ev.player_id);
                if (pl) msgs.push(pl.name + ' is eliminated!');
            });
        }
        var delay = baseDelay || 400;
        if (msgs.length === 0) {
            if (callback) setTimeout(callback, delay);
            return;
        }
        setTimeout(function () {
            if (SPEECH.isEnabled()) {
                window.speechSynthesis && window.speechSynthesis.cancel();
                SPEECH.speak(msgs.join(' '), { rate: 1.0, pitch: 1.0 });
            }
            if (callback) setTimeout(callback, 800 + msgs.join(' ').length * 60);
        }, delay);
    }

    function _speakWinner(winName) {
        _speak(winName + ' wins! Well played.', 800);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();