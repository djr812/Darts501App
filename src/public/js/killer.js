/**
 * killer.js
 * ---------
 * Multiplayer Killer darts game controller.
 *
 * Public API:
 *   KILLER_GAME.start(config, onEnd)
 *     config: { players: [{id, name}], variant: 'doubles'|'triples' }
 *     onEnd:  called when game ends or is abandoned
 */

var KILLER_GAME = (function () {

    // ── State ─────────────────────────────────────────────────────────────────
    var _state = {
        matchId:            null,
        gameId:             null,
        variant:            'doubles',
        players:            [],       // [{id, name, assigned_number, hits, is_killer, lives, eliminated, isCpu}]
        currentPlayerIndex: 0,
        currentPlayerId:    null,
        status:             'active',
        winnerId:           null,
        onEnd:              null,
        multiplier:         1,
        turnNumber:         1,
        setComplete:        false,    // board locked after 3rd dart
        cpuDifficulty:      'medium',
        cpuTurnRunning:     false,
        cpuPlayerId:        null,
    };

    var _pendingThrows  = [];   // buffered for current set
    var _throwHistory   = [];   // for undo (local copy mirrors pending)
    var _pendingEvents  = [];   // accumulated events from buffered throws
    var _pendingWinner  = null; // set when a win is detected locally; confirmed on NEXT

    // ── Public: start ─────────────────────────────────────────────────────────

    function start(config, onEnd) {
        // Reset all module-level state so a second game starts clean
        _state.matchId            = null;
        _state.gameId             = null;
        _state.variant            = 'doubles';
        _state.players            = [];
        _state.currentPlayerIndex = 0;
        _state.currentPlayerId    = null;
        _state.status             = 'active';
        _state.winnerId           = null;
        _state.onEnd              = null;
        _state.multiplier         = 1;
        _state.turnNumber         = 1;
        _state.setComplete        = false;
        _pendingThrows  = [];
        _throwHistory   = [];
        _pendingEvents  = [];
        _pendingWinner  = null;
        _state.cpuDifficulty  = 'medium';
        _state.cpuTurnRunning = false;
        _state.cpuPlayerId    = null;

        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        var _resolvedPlayers = [];
        _resolvePlayers(config.players)
            .then(function (players) {
                _resolvedPlayers = players;
                return API.createKillerMatch({
                    player_ids:     players.map(function (p) { return p.id; }),
                    variant:        config.variant || 'doubles',
                    cpu_difficulty: _state.cpuPlayerId ? _state.cpuDifficulty : undefined,
                });
            })
            .then(function (s) {
                _applyState(s);
                // Propagate isCpu flag from resolved players into state
                _resolvedPlayers.forEach(function (rp) {
                    var sp = _state.players.find(function (p) { return String(p.id) === String(rp.id); });
                    if (rp.isCpu && sp) sp.isCpu = true;
                });
                _state.onEnd = onEnd;
                UI.setLoading(false);
                _buildScreen();
                _welcomeAndAnnounce(config.variant || 'doubles', function () {
                    if (_isCpuPlayer(_currentPlayer())) {
                        _runCpuTurn();
                    }
                });
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast((err && err.message ? err.message : 'Error starting game').toUpperCase(), 'bust', 4000);
                console.error('[killer] start error:', err);
            });
    }

    // ── Player resolution ─────────────────────────────────────────────────────

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
            return API.createPlayer(sel.name).then(function (p) { return { id: p.id, name: p.name, isCpu: false }; });
        });
        return Promise.all(promises);
    }

    // ── State ─────────────────────────────────────────────────────────────────

    function _applyState(s) {
        _state.matchId            = s.match_id;
        _state.gameId             = s.game_id;
        _state.variant            = s.variant || 'doubles';
        var prev = _state.players;
        _state.players            = (s.players || []).map(function (p) {
            var old = prev.find(function (o) { return String(o.id) === String(p.id); });
            return Object.assign({}, p, { isCpu: old ? !!old.isCpu : (p.name === 'CPU') });
        });
        _state.currentPlayerIndex = s.current_player_index;
        _state.currentPlayerId    = s.current_player_id ? String(s.current_player_id) : null;
        _state.status             = s.status || 'active';
        _state.winnerId           = s.winner_id || null;
    }

    function _currentPlayer() {
        return _state.players.find(function (p) {
            return String(p.id) === String(_state.currentPlayerId);
        }) || _state.players[_state.currentPlayerIndex] || null;
    }

    function _playerById(id) {
        return _state.players.find(function (p) { return String(p.id) === String(id); }) || null;
    }

    // ── Screen build ──────────────────────────────────────────────────────────

    function _buildScreen() {
        ['confirm-modal', 'rules-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-killer';

        // ── Header (unchanged) ───────────────────────────────────────────────
        var header = document.createElement('div');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'KILLER';
        var subEl = document.createElement('div');
        subEl.className = 'gh-match-info';
        subEl.textContent = _state.players.length + ' PLAYERS · ' + _state.variant.toUpperCase();
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function () { UI.showRulesModal('killer'); });
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
        restartBtn.id = 'killer-restart-btn';
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
        undoBtn.id = 'killer-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _onUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'killer-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', _onNext);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Sidebar (left column) — player cards ─────────────────────────────
        var sidebar = document.createElement('aside');
        sidebar.id = 'killer-sidebar';
        sidebar.className = 'killer-sidebar';
        _state.players.forEach(function (p) {
            sidebar.appendChild(_buildPlayerCard(p));
        });
        app.appendChild(sidebar);

        // ── Board (right column) ─────────────────────────────────────────────
        var board = document.createElement('main');
        board.id = 'killer-seg-board';
        board.className = 'killer-seg-board';

        // Status banner
        var statusEl = document.createElement('div');
        statusEl.id = 'killer-status';
        statusEl.className = 'killer-status-banner';
        board.appendChild(statusEl);

        // Dart pills
        var pills = document.createElement('div');
        pills.id = 'killer-pills';
        pills.className = 'killer-pills';
        board.appendChild(pills);

        // Multiplier tabs
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'killer-tabs';
        tabs.className = 'killer-tabs';
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

        // Segment grid
        board.appendChild(_buildGrid());

        // Bull / Miss row
        board.appendChild(_buildBullRow());

        // Footer status bar
        var footer = document.createElement('footer');
        footer.className = 'killer-footer';
        var footerMsg = document.createElement('span');
        footerMsg.id = 'killer-footer-msg';
        footerMsg.textContent = 'SELECT MULTIPLIER THEN SEGMENT';
        footer.appendChild(footerMsg);
        board.appendChild(footer);

        app.appendChild(board);

        _renderBoard();
        _updateStatus();
        _applyHighlights();
    }

    function _buildPlayerCard(p) {
        var card = document.createElement('div');
        card.className = 'killer-player-card';
        card.id = 'killer-row-' + p.id;
        if (String(p.id) === String(_state.currentPlayerId)) card.classList.add('killer-active');
        if (p.eliminated) card.classList.add('killer-eliminated');

        // Name
        var nameEl = document.createElement('div');
        nameEl.className = 'killer-player-name';
        nameEl.textContent = p.name.toUpperCase();
        card.appendChild(nameEl);

        // Assigned number — large, prominent
        var numEl = document.createElement('div');
        numEl.className = 'killer-player-number';
        numEl.textContent = p.assigned_number;
        card.appendChild(numEl);

        // Hits row (pips toward K, or K badge)
        var hitsEl = document.createElement('div');
        hitsEl.id = 'killer-hits-' + p.id;
        hitsEl.className = 'killer-hits';
        _renderHits(hitsEl, p);
        card.appendChild(hitsEl);

        // Lives row
        var livesEl = document.createElement('div');
        livesEl.id = 'killer-lives-' + p.id;
        livesEl.className = 'killer-lives';
        _renderLives(livesEl, p);
        card.appendChild(livesEl);

        return card;
    }

    // ── Scoreboard ────────────────────────────────────────────────────────────

    function _renderBoard() {
        var sidebar = document.getElementById('killer-sidebar');
        if (!sidebar) return;
        sidebar.innerHTML = '';
        _state.players.forEach(function (p) {
            sidebar.appendChild(_buildPlayerCard(p));
        });
    }

    function _renderHits(container, p) {
        container.innerHTML = '';
        if (p.is_killer) {
            var badge = document.createElement('span');
            badge.className = 'killer-badge';
            badge.textContent = 'K';
            container.appendChild(badge);
        } else {
            for (var i = 0; i < 3; i++) {
                var pip = document.createElement('span');
                pip.className = 'killer-hit-pip' + (i < p.hits ? ' killer-hit-pip-on' : '');
                container.appendChild(pip);
            }
        }
    }

    function _renderLives(container, p) {
        container.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var pip = document.createElement('span');
            pip.className = 'killer-life-pip' + (i < p.lives ? ' killer-life-pip-on' : '');
            container.appendChild(pip);
        }
    }

    // Build the player state as it stands after all pending throws
    function _workingPlayerState() {
        var p         = _currentPlayer();
        if (!p) return _state.players.slice();
        var targetMul = _state.variant === 'doubles' ? 2 : 3;
        var working   = _state.players.map(function (pl) {
            return { id: pl.id, hits: pl.hits, is_killer: pl.is_killer,
                     lives: pl.lives, eliminated: pl.eliminated,
                     assigned_number: pl.assigned_number };
        });
        _pendingThrows.forEach(function (t) {
            _applyThrowToWorking(working, t.segment, t.multiplier,
                                 String(p.id), targetMul);
        });
        return working;
    }

    function _updateBoardFromWorking() {
        var working = _workingPlayerState();
        working.forEach(function (wp) {
            var card = document.getElementById('killer-row-' + wp.id);
            if (card) {
                card.className = 'killer-player-card' +
                    (String(wp.id) === String(_state.currentPlayerId) ? ' killer-active' : '') +
                    (wp.eliminated ? ' killer-eliminated' : '');
            }
            var hitsEl = document.getElementById('killer-hits-' + wp.id);
            if (hitsEl) _renderHits(hitsEl, wp);
            var livesEl = document.getElementById('killer-lives-' + wp.id);
            if (livesEl) _renderLives(livesEl, wp);
        });
    }

    function _updateBoard() {
        _state.players.forEach(function (p) {
            var card = document.getElementById('killer-row-' + p.id);
            if (card) {
                card.className = 'killer-player-card' +
                    (String(p.id) === String(_state.currentPlayerId) ? ' killer-active' : '') +
                    (p.eliminated ? ' killer-eliminated' : '');
            }
            var hitsEl = document.getElementById('killer-hits-' + p.id);
            if (hitsEl) _renderHits(hitsEl, p);
            var livesEl = document.getElementById('killer-lives-' + p.id);
            if (livesEl) _renderLives(livesEl, p);
        });
    }

    function _updateStatus() {
        var el     = document.getElementById('killer-status');
        var footer = document.getElementById('killer-footer-msg');
        var p = _currentPlayer();
        if (!p) return;
        var targetStr = _state.variant === 'doubles' ? 'D' : 'T';
        var statusText, footerText;
        if (p.is_killer) {
            statusText = p.name.toUpperCase() + '  —  KILLER';
            footerText = 'AIM FOR OPPONENT ' + targetStr + 's TO TAKE A LIFE';
        } else {
            var needed = 3 - p.hits;
            statusText = p.name.toUpperCase() + '  —  TARGET: ' + targetStr + p.assigned_number;
            footerText = needed + ' HIT' + (needed === 1 ? '' : 'S') + ' TO BECOME KILLER';
        }
        if (el) el.textContent = statusText;
        if (footer) footer.textContent = footerText;
    }

    // ── Segment grid ──────────────────────────────────────────────────────────

    function _buildGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        for (var seg = 1; seg <= 20; seg++) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
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
        var p = _currentPlayer();
        if (!p) return;
        var targetSeg = p.is_killer ? null : p.assigned_number;
        // Highlight assigned numbers of all active (non-eliminated) players
        var activeSets = {};
        _state.players.forEach(function (pl) {
            if (!pl.eliminated) activeSets[pl.assigned_number] = true;
        });

        document.querySelectorAll('#killer-seg-board .seg-btn[data-segment]').forEach(function (btn) {
            var seg = parseInt(btn.dataset.segment);
            btn.classList.remove('target-highlight', 'killer-assigned-highlight');
            if (seg === targetSeg) {
                btn.classList.add('target-highlight');
            } else if (activeSets[seg]) {
                btn.classList.add('killer-assigned-highlight');
            }
        });
    }

    function _lockBoard(locked) {
        var board = document.getElementById('killer-seg-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function (b) { b.disabled = locked; });
        var tabs = document.getElementById('killer-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function (b) { b.disabled = locked; });
    }

    // ── Throw handling ────────────────────────────────────────────────────────

    function _onThrow(segment, multiplier) {
        if (_state.setComplete || _state.status !== 'active') return;
        if (_pendingThrows.length >= 3) return;

        var p         = _currentPlayer();
        var variant   = _state.variant;
        var targetMul = variant === 'doubles' ? 2 : 3;

        // ── Calculate what this dart WOULD do, without touching _state.players ──
        // We use a working copy built from the current pending throw history so
        // that multiple darts in the same set compound correctly.
        var workingPlayers = _state.players.map(function (pl) {
            return { id: pl.id, hits: pl.hits, is_killer: pl.is_killer,
                     lives: pl.lives, eliminated: pl.eliminated,
                     assigned_number: pl.assigned_number };
        });
        // Replay all pending throws on the working copy first
        _pendingThrows.forEach(function (t) {
            _applyThrowToWorking(workingPlayers, t.segment, t.multiplier,
                                 String(p.id), targetMul);
        });
        // Now calculate this dart's effect on the working copy
        var before = workingPlayers.map(function (pl) {
            return { id: pl.id, hits: pl.hits, is_killer: pl.is_killer,
                     lives: pl.lives, eliminated: pl.eliminated };
        });
        _applyThrowToWorking(workingPlayers, segment, multiplier,
                             String(p.id), targetMul);

        // Derive what changed — for pill/speech only, NOT written to _state.players
        var hitsScored  = 0;
        var localEvents = [];
        workingPlayers.forEach(function (wp) {
            var bef = before.find(function (b) { return String(b.id) === String(wp.id); });
            if (!bef) return;
            if (!bef.is_killer && wp.is_killer) {
                localEvents.push({ type: 'killer', player_id: wp.id });
            }
            if (wp.lives < bef.lives) {
                var lost = bef.lives - wp.lives;
                hitsScored += lost;
                for (var i = 0; i < lost; i++) {
                    localEvents.push({ type: 'life_lost', player_id: wp.id });
                }
            }
            if (!bef.eliminated && wp.eliminated) {
                localEvents.push({ type: 'eliminated', player_id: wp.id });
            }
            if (bef.hits < wp.hits && !bef.is_killer) {
                hitsScored += (wp.hits - bef.hits);
            }
        });

        // Check for win on working copy — deferred to NEXT
        var workingSurvivors = workingPlayers.filter(function (wp) { return !wp.eliminated; });
        if (workingSurvivors.length === 1) {
            _pendingWinner = workingSurvivors[0].id;
        }

        // Buffer the throw (state.players is NOT mutated)
        _pendingThrows.push({ segment: segment, multiplier: multiplier });
        _throwHistory.push({ segment: segment, multiplier: multiplier });

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            if (hitsScored > 0) SOUNDS.dart();
        }

        // Pill and speech — describes what the dart did in isolation
        _addPill(segment, multiplier, hitsScored);
        _speakDart(segment, multiplier, hitsScored, localEvents);

        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = false;

        // Update scoreboard to reflect pending throw state
        _updateBoardFromWorking();

        // After 3 darts OR a potential killing dart — lock board, enable NEXT
        if (_pendingThrows.length >= 3 || _pendingWinner !== null) {
            _state.setComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('killer-next-btn');
            if (nb) nb.disabled = false;
        }
    }

    // Apply a single throw to a working-copy players array (no _state mutation)
    function _applyThrowToWorking(players, segment, multiplier, throwerIdStr, targetMul) {
        if (segment === 0 || multiplier !== targetMul) return;
        var rawHits = 1;
        var target  = players.find(function (pl) { return pl.assigned_number === segment; });
        if (!target) return;
        var thrower = players.find(function (pl) { return String(pl.id) === throwerIdStr; });
        if (!thrower) return;
        var isSelf = String(target.id) === throwerIdStr;

        if (!thrower.is_killer) {
            if (isSelf) {
                target.hits = Math.min(target.hits + rawHits, 3);
                if (target.hits >= 3) target.is_killer = true;
            }
        } else {
            if (!target.eliminated) {
                target.lives = Math.max(0, target.lives - rawHits);
                if (target.lives <= 0) target.eliminated = true;
            }
        }
    }

    // ── Next ──────────────────────────────────────────────────────────────────

    function _onNext() {
        UI.setLoading(true);
        var throwsToSubmit = _pendingThrows.slice();
        var turnNum        = _state.turnNumber;
        var isComplete     = _pendingWinner !== null;

        var submitPromise = throwsToSubmit.length > 0
            ? API.killerThrow(_state.matchId, { throws: throwsToSubmit, turn_number: turnNum })
            : Promise.resolve(null);

        submitPromise
            .then(function (s) {
                if (s) {
                    _applyState(s);
                    // Trust the server's winner over the local flag
                    if (s.status === 'complete' && s.winner_id) {
                        _pendingWinner = s.winner_id;
                        isComplete = true;
                    }
                }
                if (isComplete) {
                    _state.status   = 'complete';
                    _state.winnerId = _pendingWinner || _state.winnerId;
                    UI.setLoading(false);
                    _pendingWinner = null;
                    var elimEvents = s ? (s.events || []) : [];
                    _announceEliminations(elimEvents);
                    // Estimate speech duration so result screen waits for it to finish.
                    // Count eliminated players to approximate total announcement length.
                    var elimCount = elimEvents.filter(function(ev) { return ev.type === 'eliminated'; }).length;
                    var speechDelay = elimCount > 0 ? 1000 + elimCount * 2800 : 600;
                    setTimeout(function () { _showResult(); }, speechDelay);
                    return;
                }
                return API.killerNext(_state.matchId);
            })
            .then(function (s) {
                if (!s) return;
                _pendingThrows  = [];
                _throwHistory   = [];
                _pendingEvents  = [];
                _state.setComplete = false;
                _state.turnNumber++;
                _applyState(s);
                UI.setLoading(false);

                _announceEliminations(s.events || []);
                _resetUI();
                _updateBoard();
                _updateStatus();
                _applyHighlights();
                if (_isCpuPlayer(_currentPlayer())) {
                    _runCpuTurn();
                } else {
                    _announceCurrentPlayer();
                }
            })
            .catch(function (err) {
                UI.setLoading(false);
                UI.showToast('ERROR', 'bust', 3000);
                console.error('[killer] next error:', err);
            });
    }

    function _resetUI() {
        var pills = document.getElementById('killer-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('killer-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = true;
        _lockBoard(false);
        // Reset multiplier to Single
        _state.multiplier = 1;
        var tabs = document.getElementById('killer-tabs');
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
        if (_throwHistory.length === 0) return;

        _throwHistory.pop();
        _pendingThrows.pop();

        // Clear any pending winner (state.players was never mutated, so no restore needed)
        _pendingWinner = null;

        // If board was locked after 3rd dart or a potential winner, unlock it
        if (_state.setComplete) {
            _state.setComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('killer-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('killer-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('killer-undo-btn');
        if (ub) ub.disabled = (_throwHistory.length === 0);
        // Revert scoreboard pips to working state after undo
        _updateBoardFromWorking();
    }

    // ── End ───────────────────────────────────────────────────────────────────

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
        API.restartKillerMatch(_state.matchId)
            .then(function (state) {
                _applyState(state);
                _buildScreen();
                UI.showToast('MATCH RESTARTED', 'info', 2000);
                if (_isCpuPlayer(_currentPlayer())) {
                    _runCpuTurn();
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
            message:  'Abandon this Killer match?',
            onConfirm: function () {
                UI.setLoading(true);
                API.endKillerMatch(_state.matchId)
                    .then(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); })
                    .catch(function () { UI.setLoading(false); if (_state.onEnd) _state.onEnd(); });
            }
        });
    }

    // ── Result screen ─────────────────────────────────────────────────────────

    function _showResult() {
        var winner = _playerById(_state.winnerId);
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
            '<div class="setup-subtitle">KILLER DARTS · ' + _state.variant.toUpperCase() + '</div>' +
            '</div>';

        // Final standings table
        var table = document.createElement('div');
        table.className = 'killer-result-table';

        var headRow = document.createElement('div');
        headRow.className = 'killer-result-row killer-result-head';
        headRow.innerHTML =
            '<span class="killer-result-name">PLAYER</span>' +
            '<span class="killer-result-num">№</span>' +
            '<span class="killer-result-status">STATUS</span>' +
            '<span class="killer-result-lives">LIVES</span>';
        table.appendChild(headRow);

        var sorted = _state.players.slice().sort(function (a, b) {
            if (!a.eliminated && b.eliminated) return -1;
            if (a.eliminated && !b.eliminated) return 1;
            return b.lives - a.lives;
        });

        sorted.forEach(function (p) {
            var isWinner = String(p.id) === String(_state.winnerId);
            var row = document.createElement('div');
            row.className = 'killer-result-row' + (isWinner ? ' killer-result-winner' : '');
            row.innerHTML =
                '<span class="killer-result-name">' + _esc(p.name.toUpperCase()) + '</span>' +
                '<span class="killer-result-num">' + p.assigned_number + '</span>' +
                '<span class="killer-result-status">' +
                    (isWinner ? '🏆 WINNER' : p.is_killer ? '☠️ KILLER' : 'PLAYER') +
                '</span>' +
                '<span class="killer-result-lives">' + p.lives + '</span>';
            table.appendChild(row);
        });
        inner.appendChild(table);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO HOME';
        doneBtn.addEventListener('click', function () { if (_state.onEnd) _state.onEnd(); });
        inner.appendChild(doneBtn);

        _speakWinner(winName);
    }

    // ── Pills ─────────────────────────────────────────────────────────────────

    function _addPill(segment, multiplier, hitsScored) {
        var pills = document.getElementById('killer-pills');
        if (!pills) return;
        var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
        var segStr = segment === 0 ? 'MISS' :
                     segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') :
                     mulStr + segment;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (hitsScored > 0 ? '' : ' pill-miss');
        if (hitsScored > 0) pill.className += ' pill-hot';
        pill.textContent = hitsScored > 0
            ? segStr + ' — ' + hitsScored + (hitsScored === 1 ? ' HIT' : ' HITS')
            : segStr + ' — MISS';
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

    function _welcomeAndAnnounce(variant, onCpuCheck) {
        var gameDesc = variant === 'triples' ? 'A game of Trebles' : 'A game of Doubles';
        var msg      = 'Welcome to Killer Darts - ' + gameDesc;
        if (SPEECH.isEnabled()) {
            SPEECH.speak(msg, { rate: 1.05, pitch: 1.0 });
            var welcomeDelay = 400 + msg.length * 130;
            setTimeout(function () {
                _announceAssignments(onCpuCheck);
            }, welcomeDelay);
        } else {
            _announceAssignments(onCpuCheck);
        }
    }

    function _announceAssignments(onDone) {
        var msgs = _state.players.map(function (p) {
            return p.name + ', your number is ' + p.assigned_number + '.';
        });
        if (!SPEECH.isEnabled()) {
            if (onDone) setTimeout(onDone, 300);
            return;
        }
        // Space each announcement by its estimated speaking duration + a comfortable gap
        var cursor = 600;
        msgs.forEach(function (msg) {
            (function (delay, text) {
                setTimeout(function () {
                    SPEECH.speak(text, { rate: 1.0, pitch: 1.0 });
                }, delay);
            })(cursor, msg);
            cursor += 300 + msg.length * 120 + 600;  // estimated duration + 600ms gap
        });
        if (onDone) setTimeout(onDone, cursor);
    }

    function _announceCurrentPlayer() {
        var p = _currentPlayer();
        if (!p) return;
        _speak(p.name + "'s turn to throw.", 400);
    }

    function _announcePlayer() {
        // Returns estimated ms until speech finishes (used by CPU timing)
        if (!SPEECH.isEnabled()) return 0;
        var p = _currentPlayer();
        if (!p) return 0;
        var msg = p.name + "'s turn to throw.";
        var delay = 500;
        var dur   = delay + 200 + msg.length * 120;
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, delay);
        return dur;
    }

    function _announceEliminations(events) {
        if (!SPEECH.isEnabled() || !events || events.length === 0) return;
        var msgs = [];
        events.forEach(function (ev) {
            if (ev.type === 'eliminated') {
                var pl = _playerById(ev.player_id);
                if (pl) msgs.push(pl.name + ' is eliminated!');
            }
        });
        if (msgs.length === 0) return;
        window.speechSynthesis && window.speechSynthesis.cancel();
        SPEECH.speak(msgs.join(' '), { rate: 1.0, pitch: 1.0 });
    }

    function _dartSpeechDuration(segment, multiplier) {
        // Estimates the full spoken message duration including any events that
        // would be generated by this dart on the current working state.
        var mulLabel  = multiplier === 3 ? 'Treble' : multiplier === 2 ? 'Double' : '';
        var segLabel  = segment === 0 ? 'Miss' :
                        segment === 25 ? (multiplier === 2 ? 'Bulls Eye' : 'Outer bull') :
                        (mulLabel ? mulLabel + ' ' + segment : String(segment));
        var parts = [segLabel];

        // Simulate the throw on a working copy to discover what events fire
        var cpu       = _currentPlayer();
        var targetMul = _state.variant === 'doubles' ? 2 : 3;
        if (cpu && segment !== 0 && multiplier === targetMul) {
            var working = _state.players.map(function (pl) {
                return { id: pl.id, hits: pl.hits, is_killer: pl.is_killer,
                         lives: pl.lives, eliminated: pl.eliminated,
                         assigned_number: pl.assigned_number };
            });
            // Replay pending throws first
            _pendingThrows.forEach(function (t) {
                _applyThrowToWorking(working, t.segment, t.multiplier, String(cpu.id), targetMul);
            });
            var before = working.map(function (p) {
                return { id: p.id, hits: p.hits, is_killer: p.is_killer, lives: p.lives };
            });
            _applyThrowToWorking(working, segment, multiplier, String(cpu.id), targetMul);
            working.forEach(function (wp) {
                var bef = before.find(function (b) { return String(b.id) === String(wp.id); });
                if (!bef) return;
                var pl = _playerById(wp.id);
                var name = pl ? pl.name : '';
                if (!bef.is_killer && wp.is_killer) {
                    parts.push(name + ', you are now a killer!');
                }
                if (wp.lives < bef.lives) {
                    var lost = bef.lives - wp.lives;
                    for (var i = 0; i < lost; i++) parts.push(name + ' loses a life.');
                }
            });
        }

        var msg = parts.join(' ');
        return 500 + msg.length * 150;
    }

    function _speakDart(segment, multiplier, hitsScored, events) {
        if (!SPEECH.isEnabled()) return;
        var mulLabel  = multiplier === 3 ? 'Treble' : multiplier === 2 ? 'Double' : '';
        var segLabel  = segment === 0 ? 'Miss' :
                        segment === 25 ? (multiplier === 2 ? 'Bulls Eye' : 'Outer bull') :
                        (mulLabel ? mulLabel + ' ' + segment : String(segment));

        var parts = [segLabel];

        (events || []).forEach(function (ev) {
            var pl = _playerById(ev.player_id);
            var name = pl ? pl.name : '';
            if (ev.type === 'killer') {
                parts.push(name + ', you are now a killer!');
            } else if (ev.type === 'life_lost') {
                parts.push(name + ' loses a life.');
            }
            // 'eliminated' is deferred — announced in _onNext after NEXT is pressed
        });

        var msg = parts.join(' ');
        setTimeout(function () {
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 200);
    }

    function _speakWinner(winName) {
        _speak(winName + ' wins! Well played.', 600);
    }

    // ── CPU turn ──────────────────────────────────────────────────────────────

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
            if (dartsThrown >= 3 || _pendingWinner !== null) {
                _state.cpuTurnRunning = false;
                setTimeout(_onNext, 1800);
                return;
            }
            var dart      = _cpuChooseDart();
            dartsThrown++;
            var speechDur = _dartSpeechDuration(dart.segment, dart.multiplier);
            _onThrow(dart.segment, dart.multiplier);   // _onThrow calls _speakDart internally
            var nextDelay = Math.max(1000, speechDur + 500);
            setTimeout(_throwNext, nextDelay);
        }

        _lockBoard(true);
        var nb = document.getElementById('killer-next-btn'); if (nb) nb.disabled = true;
        var ub = document.getElementById('killer-undo-btn'); if (ub) ub.disabled = true;

        var announceWait = _announcePlayer();
        setTimeout(_throwNext, Math.max(1000, announceWait + 400));
    }

    function _cpuChooseDart() {
        var profile  = _cpuProfile();
        var intended = _cpuIntend();
        return _cpuApplyVariance(intended.segment, intended.multiplier, profile);
    }

    function _cpuIntend() {
        var diff      = _state.cpuDifficulty;
        var targetMul = _state.variant === 'doubles' ? 2 : 3;
        var r         = Math.random();
        var cpu       = _currentPlayer();
        var BOARD_RING = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

        if (!cpu) return { segment: 20, multiplier: 1 };

        // Phase 1: gaining Killer status — hit own number with required multiplier
        if (!cpu.is_killer) {
            var own = cpu.assigned_number;
            if (diff === 'hard') {
                // Hard: mostly hits the required D/T, rare brain fade
                if (r < 0.82) return { segment: own, multiplier: targetMul };
                if (r < 0.92) return { segment: own, multiplier: 1 };
                return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            } else if (diff === 'medium') {
                // Medium: decent chance at D/T, some singles, occasional miss
                if (r < 0.55) return { segment: own, multiplier: targetMul };
                if (r < 0.78) return { segment: own, multiplier: 1 };
                if (r < 0.90) return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
                return { segment: 0, multiplier: 0 };
            } else {
                // Easy: poor accuracy, mainly singles, frequent brain fades
                if (r < 0.20) return { segment: own, multiplier: targetMul };
                if (r < 0.45) return { segment: own, multiplier: 1 };
                if (r < 0.72) return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
                return { segment: 0, multiplier: 0 };
            }
        }

        // Phase 2: CPU is a Killer — pick a live opponent and attack their number
        var targets = _state.players.filter(function (p) {
            return !p.eliminated && String(p.id) !== String(cpu.id);
        });
        if (targets.length === 0) return { segment: 0, multiplier: 0 };

        // Hard: picks the opponent with fewest lives remaining (most dangerous target)
        // Medium/Easy: picks randomly
        var target;
        if (diff === 'hard') {
            target = targets.reduce(function (best, p) {
                return p.lives < best.lives ? p : best;
            }, targets[0]);
        } else {
            target = targets[Math.floor(Math.random() * targets.length)];
        }

        var seg = target.assigned_number;
        if (diff === 'hard') {
            if (r < 0.80) return { segment: seg, multiplier: targetMul };
            if (r < 0.93) return { segment: seg, multiplier: 1 };
            return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
        } else if (diff === 'medium') {
            if (r < 0.52) return { segment: seg, multiplier: targetMul };
            if (r < 0.75) return { segment: seg, multiplier: 1 };
            if (r < 0.90) return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            return { segment: 0, multiplier: 0 };
        } else {
            // Easy: poor aim even when attacking
            if (r < 0.18) return { segment: seg, multiplier: targetMul };
            if (r < 0.40) return { segment: seg, multiplier: 1 };
            if (r < 0.68) return { segment: BOARD_RING[Math.floor(Math.random() * BOARD_RING.length)], multiplier: 1 };
            return { segment: 0, multiplier: 0 };
        }
    }

    function _cpuProfile() {
        var profiles = {
            easy:   { trebleHit: 0.40, trebleSingle: 0.35, doubleHit: 0.50, doubleSingle: 0.30, singleHit: 0.85 },
            medium: { trebleHit: 0.68, trebleSingle: 0.20, doubleHit: 0.65, doubleSingle: 0.20, singleHit: 0.93 },
            hard:   { trebleHit: 0.86, trebleSingle: 0.09, doubleHit: 0.80, doubleSingle: 0.13, singleHit: 0.97 },
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
        if (segment === 0 || multiplier === 0) return { segment: 0, multiplier: 0 };
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { start: start };

})();