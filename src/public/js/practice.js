/**
 * practice.js
 * -----------
 * Free practice mode — record throws with no game structure.
 *
 * Flow:
 *   1. PRACTICE button on setup screen → PRACTICE.showSetup(existingPlayers, onBack)
 *   2. Player selects duration and player name → PRACTICE.start(config)
 *   3. Practice screen: multiplier tabs + dartboard + timer + stats
 *   4. Timer expires or user taps End → summary shown → back to setup
 *
 * All throws are saved to the database via existing /api/throws endpoint
 * and flow into stats/AI analysis automatically.
 */

var PRACTICE = (function() {

    // ------------------------------------------------------------------
    // Practice Setup Screen
    // ------------------------------------------------------------------

    /**
     * Show the practice setup screen.
     * @param {Array}    existingPlayers  — [{ id, name }] from API
     * @param {Function} onBack           — called when user taps Back
     * @param {Function} onStart          — called with { player, duration } to begin
     */
    function showSetup(existingPlayers, onBack, onStart) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        // Title
        var title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = '<div class="setup-logo">DARTS 501</div><div class="setup-subtitle">PRACTICE MODE</div>';
        inner.appendChild(title);

        // ---- Player selection (reuse same mechanism as match setup) ----
        var playerSection = document.createElement('div');
        playerSection.className = 'setup-section';
        playerSection.innerHTML = '<div class="setup-label">PLAYER</div>';

        var slotContainer = document.createElement('div');
        slotContainer.id = 'practice-player-slot';

        // Build a single player slot using the shared _buildPlayerSlot mechanism
        // We replicate the slot inline here since _buildPlayerSlot is private to UI
        var slot = _buildPracticePlayerSlot(existingPlayers);
        slotContainer.appendChild(slot);
        playerSection.appendChild(slotContainer);
        inner.appendChild(playerSection);

        // ---- Practice Mode ----
        var modeSection = document.createElement('div');
        modeSection.className = 'setup-section';
        modeSection.innerHTML = '<div class="setup-label">PRACTICE MODE</div>';
        var modeRow = document.createElement('div');
        modeRow.className = 'setup-option-row';

        var selectedMode = 'free';
        var selectedTarget = null; // { type, label, segment, multiplier } for segment mode

        // Target badge — shows selected target when segment mode active
        var targetBadge = document.createElement('div');
        targetBadge.id = 'practice-target-badge';
        targetBadge.className = 'practice-target-badge hidden';

        var freeModeBtn = document.createElement('button');
        freeModeBtn.className = 'option-btn selected';
        freeModeBtn.dataset.value = 'free';
        freeModeBtn.type = 'button';
        freeModeBtn.textContent = 'FREE THROW';

        var targetModeBtn = document.createElement('button');
        targetModeBtn.className = 'option-btn';
        targetModeBtn.dataset.value = 'target';
        targetModeBtn.type = 'button';
        targetModeBtn.textContent = 'TARGET';

        var TIMERLESS_MODES = ['bobs27', 'checkout121', 'baseball', 'warmup'];

        freeModeBtn.addEventListener('click', function() {
            freeModeBtn.classList.add('selected');
            targetModeBtn.classList.remove('selected');
            selectedMode = 'free';
            selectedTarget = null;
            targetBadge.className = 'practice-target-badge hidden';
            targetBadge.textContent = '';
            durationSection.style.display = '';
        });

        targetModeBtn.addEventListener('click', function() {
            _showTargetModal(function(target) {
                selectedMode = target.type;
                selectedTarget = target;
                freeModeBtn.classList.remove('selected');
                targetModeBtn.classList.add('selected');
                targetBadge.className = 'practice-target-badge';
                targetBadge.textContent = target.label;
                // Hide duration picker for timer-free games
                durationSection.style.display =
                    TIMERLESS_MODES.indexOf(target.type) !== -1 ? 'none' : '';
            });
        });

        modeRow.appendChild(freeModeBtn);
        modeRow.appendChild(targetModeBtn);
        modeSection.appendChild(modeRow);
        modeSection.appendChild(targetBadge);
        inner.appendChild(modeSection);

        // ---- Duration ----
        var durationSection = document.createElement('div');
        durationSection.className = 'setup-section';
        durationSection.innerHTML = '<div class="setup-label">PRACTICE DURATION</div>';
        var durationRow = document.createElement('div');
        durationRow.className = 'setup-option-row';

        var selectedDuration = 10;
        [5, 10, 15, 30].forEach(function(mins) {
            var btn = document.createElement('button');
            btn.className = 'option-btn' + (mins === 10 ? ' selected' : '');
            btn.dataset.value = mins;
            btn.type = 'button';
            btn.innerHTML = mins + '<span class="option-hint">min</span>';
            btn.addEventListener('click', function() {
                durationRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                selectedDuration = mins;
            });
            durationRow.appendChild(btn);
        });
        durationSection.appendChild(durationRow);
        inner.appendChild(durationSection);

        // ---- Start button ----
        var startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START PRACTICE';
        startBtn.type = 'button';

        startBtn.addEventListener('click', function() {
            var playerData = _collectPracticePlayer(slot);
            if (!playerData) return;
            if (selectedMode !== 'free' && !selectedTarget) {
                UI.showToast('PLEASE SELECT A TARGET', 'bust', 2000);
                return;
            }
            onStart({
                player:          playerData,
                durationMinutes: selectedDuration,
                targetMode:      selectedMode,
                targetConfig:    selectedTarget,
            });
        });
        inner.appendChild(startBtn);

        // ---- Back button ----
        var backBtn = document.createElement('button');
        backBtn.className = 'practice-back-btn';
        backBtn.type = 'button';
        backBtn.textContent = '← BACK TO MATCH SETUP';
        backBtn.addEventListener('click', onBack);
        inner.appendChild(backBtn);
    }

    // ------------------------------------------------------------------
    // Single player slot (mirrors _buildPlayerSlot in ui.js)
    // ------------------------------------------------------------------

    function _buildPracticePlayerSlot(existingPlayers) {
        var slot = document.createElement('div');
        slot.className = 'name-slot';
        slot.dataset.index = 0;

        var toggleRow = document.createElement('div');
        toggleRow.className = 'slot-toggle-row';

        var newBtn = document.createElement('button');
        newBtn.className = 'slot-toggle-btn active';
        newBtn.textContent = '+ NEW';
        newBtn.type = 'button';

        var existingBtn = document.createElement('button');
        existingBtn.className = 'slot-toggle-btn';
        existingBtn.textContent = 'EXISTING';
        existingBtn.type = 'button';
        if (existingPlayers.length === 0) {
            existingBtn.disabled = true;
            existingBtn.title = 'No existing players';
        }
        toggleRow.appendChild(newBtn);
        toggleRow.appendChild(existingBtn);
        slot.appendChild(toggleRow);

        var newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'name-input';
        newInput.placeholder = 'Your name';
        newInput.maxLength = 20;
        newInput.autocomplete = 'off';
        newInput.autocorrect = 'off';
        newInput.autocapitalize = 'words';
        newInput.spellcheck = false;
        newInput.addEventListener('input', function() { newInput.classList.remove('error'); });
        slot.appendChild(newInput);

        var existingSelect = document.createElement('select');
        existingSelect.className = 'name-select';
        existingSelect.style.display = 'none';
        var ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— Select player —';
        ph.disabled = true; ph.selected = true;
        existingSelect.appendChild(ph);
        existingPlayers.filter(function(p) { return p.name !== 'CPU'; }).forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            existingSelect.appendChild(opt);
        });
        existingSelect.addEventListener('change', function() { existingSelect.classList.remove('error'); });
        slot.appendChild(existingSelect);

        function activateMode(mode) {
            if (mode === 'new') {
                newBtn.classList.add('active'); existingBtn.classList.remove('active');
                newInput.style.display = ''; existingSelect.style.display = 'none';
                slot.dataset.mode = 'new'; newInput.focus();
            } else {
                existingBtn.classList.add('active'); newBtn.classList.remove('active');
                newInput.style.display = 'none'; existingSelect.style.display = '';
                slot.dataset.mode = 'existing'; existingSelect.focus();
            }
        }
        newBtn.addEventListener('click', function() { activateMode('new'); });
        existingBtn.addEventListener('click', function() { activateMode('existing'); });
        slot.dataset.mode = 'new';
        return slot;
    }

    function _collectPracticePlayer(slot) {
        var mode = slot.dataset.mode;
        if (mode === 'existing') {
            var sel = slot.querySelector('.name-select');
            if (!sel.value) { sel.classList.add('error'); sel.focus(); return null; }
            return { mode: 'existing', id: parseInt(sel.value, 10), name: sel.options[sel.selectedIndex].textContent };
        } else {
            var input = slot.querySelector('.name-input');
            var name = input.value.trim();
            if (!name) { input.classList.add('error'); input.focus(); return null; }
            return { mode: 'new', name: name };
        }
    }

    // ------------------------------------------------------------------
    // Practice Screen
    // ------------------------------------------------------------------

    var _state = {
        matchId:       null,
        legId:         null,
        turnId:        null,
        pendingDarts:  [],    // buffered darts not yet sent to server
        playerId:      null,
        playerName:    '',
        dartsThrown:   0,
        totalScore:    0,
        turnScore:     0,
        segmentCounts: {},   // { '20': 5, 'T20': 3, ... }
        timerSeconds:  0,
        timerInterval: null,
        multiplier:    1,
        turnDarts:     0,     // darts in current turn (max 3)
        turnComplete:  false, // true after 3rd dart — waiting for NEXT
        timerExpired:  false, // true when timer hits 0 — board stays open for last darts
        onEnd:         null,  // stored so target completion can call it from any function
        // Target practice fields
        targetMode:    'free',   // 'free'|'segment'|'trebles'|'doubles'|'checkout'|'clock'
        targetConfig:  null,     // { segment, multiplier } for 'segment' mode
        targetHits:    0,
        targetAttempts:0,
        clockIndex:    0,        // 0-19, which number we're aiming at in clock mode
        // Bob's 27 state
        bobs27Score:   27,
        bobs27Double:  1,        // 1-20, 25 = Bull
        bobs27Rounds:  0,
        // Warm Up Routine state
        warmupSegmentIndex: 0,    // 0=20, 1=11, 2=3, 3=6
        warmupScore:        0,    // total across all 4 segments
        warmupSegScores:    [0,0,0,0], // per-segment scores
        warmupTimerSec:     300,  // 5 min per segment
        warmupHighScore:    0,
        warmupTurnScore:    0,    // points in current set of 3 darts
        warmupTurnDarts:    0,    // darts in current set
        warmupSetComplete:  false,
        warmupInterval:     null,
        // Baseball Darts state
        baseballInning:    1,
        baseballTarget:    1,      // current target number (start + inning - 1)
        baseballStartNum:  1,      // randomly chosen start
        baseballRuns:      0,      // total runs this game
        baseballOuts:      0,      // outs in current inning
        baseballInningRuns:0,      // runs in current inning
        baseballDarts:     0,      // darts thrown in current inning
        baseballHighScore: 0,      // loaded from DB at game start
        baseballInningComplete: false,
        // 121 Checkouts state
        c121Target:    121,
        c121DartLimit: 9,
        c121DartsUsed: 0,
        c121Score:     121,
        c121ScoreAtTurnStart: 121,
        c121Attempts:  0,
        c121Successes: 0,
    };

    /**
     * Start a practice session.
     * @param {object} config  — { player: {id?, name, mode}, durationMinutes }
     * @param {Function} onEnd — called when session ends, returns to setup
     */
    function start(config, onEnd) {
        SPEECH.unlock();
        if (typeof SOUNDS !== 'undefined') SOUNDS.unlock();
        UI.setLoading(true);

        _resolvePracticePlayer(config.player)
            .then(function(player) {
                _state.playerId   = player.id;
                _state.playerName = player.name;
                var TIMERLESS = ['bobs27', 'checkout121', 'baseball', 'warmup'];
                _state.timerSeconds = TIMERLESS.indexOf(config.targetMode) !== -1
                    ? 0
                    : config.durationMinutes * 60;
                _state.timerExpired = false;
                _state.dartsThrown   = 0;
                _state.totalScore    = 0;
                _state.turnScore     = 0;
                _state.segmentCounts = {};
                _state.multiplier    = 1;
                _state.turnDarts     = 0;
                _state.targetMode    = config.targetMode    || 'free';
                _state.targetConfig  = config.targetConfig  || null;
                _state.targetHits    = 0;
                _state.targetAttempts = 0;
                _state.clockIndex    = 0;
                // Bob's 27
                _state.bobs27Score   = 27;
                _state.bobs27Double  = 1;
                _state.bobs27Rounds  = 0;
                // 121 Checkouts
                _state.c121Target    = 121;
                _state.c121DartLimit = config.targetConfig ? (config.targetConfig.dartLimit || 9) : 9;
                _state.c121DartsUsed = 0;
                _state.c121Score     = 121;
                _state.c121ScoreAtTurnStart = 121;
                _state.c121Attempts  = 0;
                _state.c121Successes = 0;
                // Warm Up Routine
                _state.warmupSegmentIndex = 0;
                _state.warmupScore        = 0;
                _state.warmupSegScores    = [0,0,0,0];
                _state.warmupTimerSec     = 300;
                _state.warmupHighScore    = 0;
                _state.warmupTurnScore    = 0;
                _state.warmupTurnDarts    = 0;
                _state.warmupSetComplete  = false;
                _state.warmupInterval     = null;
                // Baseball
                var _bbStart = Math.floor(Math.random() * 11) + 1;
                _state.baseballInning    = 1;
                _state.baseballStartNum  = _bbStart;
                _state.baseballTarget    = _bbStart;
                _state.baseballRuns      = 0;
                _state.baseballOuts      = 0;
                _state.baseballInningRuns= 0;
                _state.baseballDarts     = 0;
                _state.baseballHighScore = 0;
                _state.baseballInningComplete = false;
                _state.onEnd         = onEnd;

                // Create a practice match + leg + turn in the DB
                return _createPracticeSession(player.id);
            })
            .then(function(session) {
                _state.matchId = session.matchId;
                _state.legId   = session.legId;
                _state.turnId  = session.turnId;
                UI.setLoading(false);
                var welcomeMsg   = 'Welcome to Dart Practice';
                var welcomeDelay = SPEECH.isEnabled() ? 400 + welcomeMsg.length * 130 : 0;
                if (SPEECH.isEnabled()) {
                    SPEECH.speak(welcomeMsg, { rate: 1.05, pitch: 1.0 });
                }
                setTimeout(function () {
                    if (_state.targetMode === 'bobs27') {
                        _startBobs27(onEnd);
                    } else if (_state.targetMode === 'checkout121') {
                        _startCheckout121(onEnd);
                    } else if (_state.targetMode === 'baseball') {
                        _startBaseball(onEnd);
                    } else if (_state.targetMode === 'warmup') {
                        _startWarmup(onEnd);
                    } else {
                        _buildPracticeScreen(onEnd);
                        _startTimer(onEnd);
                        if (SPEECH.isEnabled()) {
                            SPEECH.announcePlayer(_state.playerName);
                        }
                    }
                }, welcomeDelay);
            })
            .catch(function(err) {
                UI.setLoading(false);
                UI.showToast('ERROR: ' + err.message, 'bust', 3000);
            });
    }

    function _resolvePracticePlayer(playerConfig) {
        if (playerConfig.mode === 'existing') {
            return Promise.resolve({ id: playerConfig.id, name: playerConfig.name });
        }
        return API.createPlayer(playerConfig.name)
            .catch(function(err) {
                // 409 = already exists, fetch the existing player
                if (err.status === 409 || (err.message && err.message.indexOf('409') !== -1)) {
                    return API.getPlayers().then(function(players) {
                        var found = players.find(function(p) {
                            return p.name.toLowerCase() === playerConfig.name.toLowerCase();
                        });
                        if (found) return found;
                        throw new Error('Could not resolve player');
                    });
                }
                throw err;
            });
    }

    function _createPracticeSession(playerId) {
        return API.startPracticeSession({ player_id: playerId })
            .then(function(session) {
                return {
                    matchId: session.match_id,
                    legId:   session.leg_id,
                    turnId:  session.turn_id,
                };
            });
    }

    // ------------------------------------------------------------------
    // Practice Screen UI
    // ------------------------------------------------------------------

    function _buildPracticeScreen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // Header
        var header = document.createElement('header');
        header.id = 'practice-header';
        header.className = 'game-header';

        // ── Left: player name + timer + rules ──
        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'PRACTICE';
        var timerEl = document.createElement('div');
        timerEl.id = 'practice-timer';
        timerEl.className = 'gh-match-info practice-timer-inline';
        timerEl.textContent = _formatTime(_state.timerSeconds);
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(timerEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() {
            if (typeof UI !== 'undefined') UI.showRulesModal('practice');
        });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        // ── Centre: End ──
        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', function() { _endSession(onEnd); });
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        // ── Right: Undo + Next ──
        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'practice-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', function() { _undoPracticeDart(); });
        var nextBtn = document.createElement('button');
        nextBtn.id = 'practice-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _advanceToNextTurn(); });
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);

        app.appendChild(header);

        // Stats strip — layout depends on target mode
        var strip = document.createElement('div');
        strip.id = 'practice-strip';
        strip.className = 'practice-strip';
        if (_state.targetMode === 'free') {
            strip.innerHTML =
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-darts">0</div><div class="practice-stat-label">DARTS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-avg">0.0</div><div class="practice-stat-label">AVG / DART</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-turn">0.0</div><div class="practice-stat-label">3-DART AVG</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-best">—</div><div class="practice-stat-label">BEST SEG</div></div>';
        } else {
            var targetLabel = _state.targetMode === 'clock'
                ? _clockTarget()
                : (_state.targetConfig ? _state.targetConfig.label : '—');
            strip.innerHTML =
                '<div class="practice-stat practice-stat-target"><div class="practice-stat-value" id="prac-target">' + targetLabel + '</div><div class="practice-stat-label">TARGET</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-hits">0</div><div class="practice-stat-label">HITS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-attempts">0</div><div class="practice-stat-label">DARTS</div></div>' +
                '<div class="practice-stat"><div class="practice-stat-value" id="prac-rate">0%</div><div class="practice-stat-label">HIT RATE</div></div>';
        }
        app.appendChild(strip);

        // Dart pills for current turn
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // Multiplier tabs
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tab.label;
            btn.dataset.multiplier = tab.multiplier;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            UI.addTouchSafeListener(btn, function() {
                _state.multiplier = tab.multiplier;
                document.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.multiplier;
            });
            tabs.appendChild(btn);
        });
        app.appendChild(tabs);
        // Set Single as default active
        tabs.querySelector('[data-multiplier="1"]').classList.add('active-single');
        document.body.dataset.multiplier = 1;

        // Segment grid (reuse existing structure from game board)
        var board = document.createElement('main');
        board.id = 'practice-board';
        board.appendChild(_buildPracticeSegmentGrid());
        board.appendChild(_buildPracticeBullRow());
        app.appendChild(board);

        // Highlight target segment(s) on the grid
        _applyTargetHighlights();
    }

    function _buildPracticeSegmentGrid() {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        var segments = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
        segments.forEach(function(seg) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            btn.addEventListener('click', function() { _recordPracticeDart(seg); });
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildPracticeBullRow() {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _recordPracticeDart(0); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function() {
            _recordPracticeDart(25, 1);
        });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function() {
            _recordPracticeDart(25, 2);
        });
        row.appendChild(bull);

        return row;
    }

    // ------------------------------------------------------------------
    // Dart recording
    // ------------------------------------------------------------------

    // _recordPracticeDart — local only, no server call.
    // Darts are buffered in _state.pendingDarts and submitted in bulk
    // when the player taps NEXT. Timer expiry and END discard pending darts.
    function _recordPracticeDart(segment, forcedMultiplier) {
        var multiplier = (forcedMultiplier !== undefined) ? forcedMultiplier : _state.multiplier;
        var points = segment === 0 ? 0 : segment * multiplier;

        if (_state.turnDarts % 3 === 0) {
            _state.turnScore = 0;
        }

        _state.dartsThrown++;
        _state.totalScore += points;
        _state.turnScore  += points;
        _state.turnDarts++;

        // Buffer dart for later submission
        _state.pendingDarts.push({ segment: segment, multiplier: multiplier, points: points });

        // Track segment hits for heatmap/best segment display
        if (segment > 0) {
            var key = (multiplier > 1 ? (multiplier === 2 ? 'D' : 'T') : '') + segment;
            _state.segmentCounts[key] = (_state.segmentCounts[key] || 0) + 1;
        }

        // Track target hits
        if (_state.targetMode !== 'free' && segment > 0) {
            _state.targetAttempts++;
            if (_isTargetHit(segment, multiplier)) {
                _state.targetHits++;
                if (_state.targetMode === 'clock') {
                    _state.clockIndex++;
                    _applyTargetHighlights();
                    if (_state.clockIndex === 20) {
                        _addDartPill(segment, multiplier, points);
                        _updatePracticeStats();
                        _clockComplete(_state.onEnd);
                        return;
                    }
                }
            }
        }

        // Enable undo
        var undoB = document.getElementById('practice-undo-btn');
        if (undoB) undoB.disabled = false;

        // Sounds + speech — instant, no waiting on server
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.dart();
        if (SPEECH.isEnabled()) SPEECH.announceDartScore(segment, multiplier, points);

        // After 3rd dart: activate NEXT, lock board
        var dartsInTurn = _state.turnDarts % 3;
        if (dartsInTurn === 0) {
            _state.turnComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('practice-next-btn');
            if (nb) nb.disabled = false;
            if (SPEECH.isEnabled()) {
                // Capture turnScore NOW — it will be reset to 0 if the next dart
                // is thrown before the setTimeout fires (e.g. rapid entry)
                var capturedTurnScore = _state.turnScore;
                // Estimate dart label speech duration so we don't cut it off
                var mulLabel = multiplier === 3 ? 'Treble ' : multiplier === 2 ? 'Double ' : '';
                var dartLabel = segment === 0 ? 'Miss' :
                                segment === 25 ? (multiplier === 2 ? 'Bulls Eye' : 'Outer bull') :
                                (mulLabel + segment);
                var dartDuration = 200 + dartLabel.length * 80;
                setTimeout(function() {
                    SPEECH.announceTurnEnd(capturedTurnScore, 0);
                }, dartDuration + 200);
            }
        }

        _addDartPill(segment, multiplier, points);
        _updatePracticeStats();
    }

    function _addDartPill(segment, multiplier, points) {
        var pills = document.getElementById('practice-pills');
        if (!pills) return;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (points === 0 ? ' pill-miss' : points >= 60 ? ' pill-hot' : '');
        var label = points === 0 ? 'MISS' : CHECKOUT.formatDart(
            (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : 'S') + segment
        );
        pill.textContent = label + ' (' + points + ')';
        pills.appendChild(pill);
    }

    function _updatePracticeStats() {
        if (_state.targetMode === 'free') {
            var dartsEl = document.getElementById('prac-darts');
            var avgEl   = document.getElementById('prac-avg');
            var turnEl  = document.getElementById('prac-turn');
            var bestEl  = document.getElementById('prac-best');

            if (dartsEl) dartsEl.textContent = _state.dartsThrown;

            var avg = _state.dartsThrown > 0
                ? (_state.totalScore / _state.dartsThrown).toFixed(1) : '0.0';
            if (avgEl) avgEl.textContent = avg;

            var threeAvg = (_state.totalScore / Math.max(1, _state.dartsThrown) * 3).toFixed(1);
            if (turnEl) turnEl.textContent = threeAvg;

            var bestKey = '—'; var bestCount = 0;
            Object.keys(_state.segmentCounts).forEach(function(key) {
                if (_state.segmentCounts[key] > bestCount) {
                    bestCount = _state.segmentCounts[key]; bestKey = key;
                }
            });
            if (bestEl) bestEl.textContent = bestKey;
        } else {
            var targetEl   = document.getElementById('prac-target');
            var hitsEl     = document.getElementById('prac-hits');
            var attemptsEl = document.getElementById('prac-attempts');
            var rateEl     = document.getElementById('prac-rate');

            if (targetEl) {
                targetEl.textContent = _state.targetMode === 'clock'
                    ? _clockTarget() : (_state.targetConfig ? _state.targetConfig.label : '—');
            }
            if (hitsEl)     hitsEl.textContent     = _state.targetHits;
            if (attemptsEl) attemptsEl.textContent  = _state.targetAttempts;
            var rate = _state.targetAttempts > 0
                ? Math.round((_state.targetHits / _state.targetAttempts) * 100) + '%' : '0%';
            if (rateEl) rateEl.textContent = rate;
        }
    }

    // ------------------------------------------------------------------
    // Timer
    // ------------------------------------------------------------------

    function _startTimer(onEnd) {
        _state.timerInterval = setInterval(function() {
            _state.timerSeconds--;
            var timerEl = document.getElementById('practice-timer');
            if (timerEl) timerEl.textContent = _formatTime(_state.timerSeconds);

            // Warning colour in last 60 seconds
            if (_state.timerSeconds <= 60 && timerEl) {
                timerEl.classList.add('timer-warning');
            }

            // "Last darts" call at 20 seconds
            if (_state.timerSeconds === 20 && SPEECH.isEnabled()) {
                SPEECH.announceTimer && SPEECH.announceTimer('Last darts');
            }

            if (_state.timerSeconds <= 0) {
                clearInterval(_state.timerInterval);
                _state.timerExpired = true;
                // Don't end session yet — allow last darts to be entered.
                // _advanceToNextTurn will call _endSession when NEXT is pressed.
                var timerEl = document.getElementById('practice-timer');
                if (timerEl) timerEl.textContent = 'TIME';
                if (SPEECH.isEnabled()) {
                    SPEECH.announceTimer && SPEECH.announceTimer('Time is up. Finish your darts.');
                }
                // If the board is currently locked (mid-turn NEXT pending), unlock it
                // so the player can enter their final set
                if (_state.turnComplete) {
                    // They've already thrown 3 — NEXT will end the session
                } else {
                    // Board is open — keep it open, nothing to do
                }
                // Make NEXT button visible and labelled to end session
                var nb = document.getElementById('practice-next-btn');
                if (nb) {
                    nb.disabled = false;
                    nb.textContent = 'FINISH ▶';
                }
            }
        }, 1000);
    }

    function _formatTime(seconds) {
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ------------------------------------------------------------------
    // End session + summary
    // ------------------------------------------------------------------

    function _endSession(onEnd) {
        clearInterval(_state.timerInterval);

        // Discard any pending darts — partial turn is abandoned on END/timer
        _state.pendingDarts = [];

        // Close the practice match on the server
        API.endPracticeSession(_state.matchId)
            .catch(function() {}) // non-fatal
            .then(function() {
                _showSummary(onEnd);
            });
    }

    function _showSummary(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = '<div class="setup-logo">PRACTICE DONE</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div>';
        inner.appendChild(title);

        // Heatmap
        var heatmapContainer = document.createElement('div');
        heatmapContainer.className = 'practice-heatmap';
        heatmapContainer.appendChild(_buildHeatmap());
        inner.appendChild(heatmapContainer);

        // Summary stats
        var summary = document.createElement('div');
        summary.className = 'practice-summary';

        var avg = _state.dartsThrown > 0
            ? (_state.totalScore / _state.dartsThrown).toFixed(1) : '0.0';
        var threeAvg = (parseFloat(avg) * 3).toFixed(1);
        var bestKey = '—';
        var bestCount = 0;
        Object.keys(_state.segmentCounts).forEach(function(key) {
            if (_state.segmentCounts[key] > bestCount) {
                bestCount = _state.segmentCounts[key];
                bestKey = key + ' ×' + bestCount;
            }
        });

        var summaryRows;
        if (_state.targetMode === 'free') {
            summaryRows = [
                { label: 'DARTS THROWN',  value: _state.dartsThrown },
                { label: 'TOTAL SCORE',   value: _state.totalScore },
                { label: 'AVG PER DART',  value: avg },
                { label: '3-DART AVG',    value: threeAvg },
                { label: 'MOST HIT',      value: bestKey },
            ];
        } else {
            var hitRate = _state.targetAttempts > 0
                ? Math.round((_state.targetHits / _state.targetAttempts) * 100) + '%' : '0%';
            var targetLabel = _state.targetConfig
                ? _state.targetConfig.label : _state.targetMode.toUpperCase();
            summaryRows = [
                { label: 'TARGET',        value: targetLabel },
                { label: 'DARTS THROWN',  value: _state.targetAttempts },
                { label: 'HITS',          value: _state.targetHits },
                { label: 'HIT RATE',      value: hitRate },
            ];
            if (_state.targetMode === 'clock') {
                summaryRows.push({ label: 'REACHED', value: _state.clockIndex + '/20' });
            }
        }
        summaryRows.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML =
                '<span class="practice-summary-label">' + row.label + '</span>' +
                '<span class="practice-summary-value">' + row.value + '</span>';
            summary.appendChild(item);
        });
        inner.appendChild(summary);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }


    // ------------------------------------------------------------------
    // Target practice helpers
    // ------------------------------------------------------------------

    var CHECKOUT_DOUBLES = [20,16,10,8,4,2,1,25]; // D25 = Bull

    function _clockTarget() {
        return (_state.clockIndex < 20)
            ? String(_state.clockIndex + 1)
            : 'DONE';
    }

    function _isTargetHit(segment, multiplier) {
        switch (_state.targetMode) {
            case 'segment':
                var tc = _state.targetConfig;
                if (!tc) return false;
                if (tc.segment === 25) {
                    // Bull family: match exact multiplier (outer vs inner are distinct targets)
                    return segment === 25 && multiplier === tc.multiplier;
                }
                // When a single segment is the target, singles/doubles/trebles of
                // that segment all count as hits — only misses on other numbers don't.
                // When doubles or trebles are explicitly targeted (tc.multiplier > 1),
                // keep exact matching so stats are specific.
                if (tc.multiplier === 1) {
                    return segment === tc.segment;  // any multiplier on the target segment
                }
                return segment === tc.segment && multiplier === tc.multiplier;
            case 'trebles':
                return multiplier === 3;
            case 'doubles':
                return multiplier === 2 || (segment === 25 && multiplier === 2);
            case 'checkout':
                // Any double on a checkout double segment, or Bull
                return (multiplier === 2 && CHECKOUT_DOUBLES.indexOf(segment) !== -1);
            case 'clock':
                if (_state.clockIndex >= 20) return false; // already done
                var target = _state.clockIndex + 1;
                return segment === target; // any multiplier counts
            default:
                return false;
        }
    }

    function _applyTargetHighlights() {
        if (_state.targetMode === 'free') return;

        // Clear existing highlights
        document.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.classList.remove('target-highlight');
        });

        function highlight(seg) {
            // Segment grid buttons
            var btn = document.querySelector('#segment-grid .seg-btn[data-segment="' + seg + '"]');
            if (btn) btn.classList.add('target-highlight');
            // Bull row buttons
            var bullBtn = document.querySelector('#bull-row .seg-btn[data-segment="' + seg + '"]');
            if (bullBtn) bullBtn.classList.add('target-highlight');
        }

        function highlightMiss() {
            var missBtn = document.querySelector('#bull-row .seg-btn:not([data-segment])');
            // Don't highlight MISS button
        }

        switch (_state.targetMode) {
            case 'segment':
                var tc = _state.targetConfig;
                if (tc) highlight(tc.segment);
                break;
            case 'trebles':
                for (var s = 1; s <= 20; s++) highlight(s);
                break;
            case 'doubles':
                for (var s = 1; s <= 20; s++) highlight(s);
                highlight(25);
                break;
            case 'checkout':
                CHECKOUT_DOUBLES.forEach(function(seg) { highlight(seg); });
                break;
            case 'clock':
                var t = _state.clockIndex + 1;
                if (t <= 20) highlight(t);
                break;
        }

        // For trebles/doubles modes also lock the multiplier tab
        if (_state.targetMode === 'trebles') {
            _setMultiplierTab(3);
        } else if (_state.targetMode === 'doubles' || _state.targetMode === 'checkout') {
            _setMultiplierTab(2);
        }
    }

    function _setMultiplierTab(mul) {
        _state.multiplier = mul;
        document.querySelectorAll('.tab-btn').forEach(function(b) {
            b.classList.remove('active-single', 'active-double', 'active-treble');
        });
        var cls = mul === 3 ? 'active-treble' : mul === 2 ? 'active-double' : 'active-single';
        var tab = document.querySelector('.tab-btn[data-multiplier="' + mul + '"]');
        if (tab) tab.classList.add(cls);
        document.body.dataset.multiplier = mul;
    }

    // ------------------------------------------------------------------
    // Target selection modal
    // ------------------------------------------------------------------

    function _showTargetModal(onSelect) {
        var existing = document.getElementById('target-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'target-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box target-modal-box';

        var titleEl = document.createElement('div');
        titleEl.className = 'modal-title';
        titleEl.textContent = 'SELECT TARGET';
        box.appendChild(titleEl);

        // ---- Category tabs ----
        var cats = [
            { id: 'single',   label: 'SINGLE SEGMENT' },
            { id: 'group',    label: 'GROUP TARGET'   },
        ];
        var catBar = document.createElement('div');
        catBar.className = 'target-cat-bar';
        var activeCat = 'single';

        var panels = {};

        cats.forEach(function(cat, i) {
            var btn = document.createElement('button');
            btn.className = 'target-cat-btn' + (i === 0 ? ' active' : '');
            btn.type = 'button';
            btn.textContent = cat.label;
            btn.addEventListener('click', function() {
                activeCat = cat.id;
                catBar.querySelectorAll('.target-cat-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                Object.keys(panels).forEach(function(k) {
                    panels[k].style.display = k === cat.id ? '' : 'none';
                });
            });
            catBar.appendChild(btn);
        });
        box.appendChild(catBar);

        // ── Single segment panel ──
        var singlePanel = document.createElement('div');
        singlePanel.className = 'target-panel';
        panels['single'] = singlePanel;

        var segCats = [
            { label: 'TREBLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 3, prefix: 'T' },
            { label: 'DOUBLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 2, prefix: 'D' },
            { label: 'SINGLES', segs: [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],
              mul: 1, prefix: 'S' },
            { label: 'BULL',    segs: [25],
              mul: null, prefix: null },
        ];

        var activeSegCat = 0;
        var segCatBar = document.createElement('div');
        segCatBar.className = 'target-segcat-bar';
        var segPanels = {};

        segCats.forEach(function(sc, i) {
            var scBtn = document.createElement('button');
            scBtn.className = 'target-segcat-btn' + (i === 0 ? ' active' : '');
            scBtn.type = 'button';
            scBtn.textContent = sc.label;
            scBtn.addEventListener('click', function() {
                segCatBar.querySelectorAll('.target-segcat-btn').forEach(function(b) { b.classList.remove('active'); });
                scBtn.classList.add('active');
                Object.keys(segPanels).forEach(function(k) {
                    segPanels[k].style.display = k === String(i) ? '' : 'none';
                });
            });
            segCatBar.appendChild(scBtn);
        });
        singlePanel.appendChild(segCatBar);

        segCats.forEach(function(sc, i) {
            var grid = document.createElement('div');
            grid.className = 'target-seg-grid';
            grid.style.display = i === 0 ? '' : 'none';
            segPanels[String(i)] = grid;

            if (sc.label === 'BULL') {
                // Two options: Outer Bull (S25) and Bull (D25)
                [{label: 'OUTER BULL', seg: 25, mul: 1},
                 {label: 'BULL',       seg: 25, mul: 2}].forEach(function(b) {
                    var btn = document.createElement('button');
                    btn.className = 'target-seg-btn';
                    btn.type = 'button';
                    btn.textContent = b.label;
                    btn.addEventListener('click', function() {
                        overlay.remove();
                        onSelect({
                            type:      'segment',
                            label:     b.label,
                            segment:   b.seg,
                            multiplier: b.mul,
                        });
                    });
                    grid.appendChild(btn);
                });
            } else {
                sc.segs.forEach(function(seg) {
                    var btn = document.createElement('button');
                    btn.className = 'target-seg-btn';
                    btn.type = 'button';
                    btn.textContent = sc.prefix + seg;
                    btn.addEventListener('click', function() {
                        overlay.remove();
                        onSelect({
                            type:       'segment',
                            label:      sc.prefix + seg,
                            segment:    seg,
                            multiplier: sc.mul,
                        });
                    });
                    grid.appendChild(btn);
                });
            }
            singlePanel.appendChild(grid);
        });
        box.appendChild(singlePanel);

        // ── Group targets panel ──
        var groupPanel = document.createElement('div');
        groupPanel.className = 'target-panel';
        groupPanel.style.display = 'none';
        panels['group'] = groupPanel;

        var groups = [
            { type: 'warmup', label: 'WARM UP ROUTINE',
              desc: 'N→E→S→W compass points (20→11→3→6) — 5 mins each, score for target & neighbours' },
            { type: 'trebles',  label: 'ALL TREBLES',
              desc: 'Hit any treble — tracks treble rate across all segments' },
            { type: 'doubles',  label: 'ALL DOUBLES',
              desc: 'Hit any double — great for checkout training' },
            { type: 'checkout', label: 'CHECKOUT DOUBLES',
              desc: 'D20 D16 D10 D8 D4 D2 D1 Bull — the key finishing doubles' },
            { type: 'clock',    label: 'AROUND THE CLOCK',
              desc: 'Hit 1 through 20 in order — any multiplier counts' },
            { type: 'bobs27',   label: "BOB'S 27",
              desc: 'Doubles practice — start at 27 pts, hit each double to advance, miss costs points' },
            { type: 'checkout121', label: '121 CHECKOUTS',
              desc: 'Start at 121, check out in 9 or 12 darts — double finish required' },
            { type: 'baseball',    label: 'BASEBALL DARTS',
              desc: '9 innings, random starting number — score runs, avoid outs, beat your high score' },
        ];

        groups.forEach(function(g) {
            var card = document.createElement('button');
            card.className = 'target-group-card';
            card.type = 'button';
            card.innerHTML =
                '<span class="target-group-label">' + g.label + '</span>' +
                '<span class="target-group-desc">'  + g.desc  + '</span>';
            card.addEventListener('click', function() {
                if (g.type === 'checkout121') {
                    // Ask dart limit before closing modal
                    _show121DartPicker(overlay, onSelect);
                    return;
                }
                overlay.remove();
                onSelect({
                    type:  g.type,
                    label: g.label,
                    segment:    null,
                    multiplier: null,
                });
            });
            groupPanel.appendChild(card);
        });
        box.appendChild(groupPanel);

        // Cancel
        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'stats-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕  CANCEL';
        cancelBtn.addEventListener('click', function() { overlay.remove(); });
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // 121 Checkouts — dart limit picker (sub-panel inside target modal)
    // ------------------------------------------------------------------

    function _show121DartPicker(overlay, onSelect) {
        // Replace modal box content with a simple picker
        var box = overlay.querySelector('.modal-box');
        box.innerHTML =
            '<div class="modal-title">121 CHECKOUTS</div>' +
            '<div class="target-121-subtitle">How many darts to attempt each checkout?</div>';

        [9, 12].forEach(function(n) {
            var btn = document.createElement('button');
            btn.className = 'target-group-card';
            btn.type = 'button';
            btn.innerHTML =
                '<span class="target-group-label">' + n + ' DARTS</span>' +
                '<span class="target-group-desc">' +
                    (n === 9 ? 'Standard — 3 visits of 3 darts' : 'Extended — 4 visits of 3 darts') +
                '</span>';
            btn.addEventListener('click', function() {
                overlay.remove();
                onSelect({
                    type:       'checkout121',
                    label:      '121 CHECKOUTS (' + n + ' darts)',
                    segment:    null,
                    multiplier: null,
                    dartLimit:  n,
                });
            });
            box.appendChild(btn);
        });

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'stats-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕  CANCEL';
        cancelBtn.addEventListener('click', function() { overlay.remove(); });
        box.appendChild(cancelBtn);
    }

    // ------------------------------------------------------------------
    // Undo last dart
    // ------------------------------------------------------------------

    // _undoPracticeDart — local only, pops from buffer, no server call.
    function _undoPracticeDart() {
        var dartsThisTurn = _state.turnDarts % 3 === 0 && _state.turnComplete
            ? 3
            : _state.turnDarts % 3;
        if (dartsThisTurn === 0 || _state.pendingDarts.length === 0) return;

        var undoBtn = document.getElementById('practice-undo-btn');

        // Pop from local buffer
        var deleted = _state.pendingDarts.pop();
        var points  = deleted.points || 0;
        var seg     = deleted.segment;
        var mul     = deleted.multiplier;

        // Reverse state
        _state.dartsThrown = Math.max(0, _state.dartsThrown - 1);
        _state.totalScore  = Math.max(0, _state.totalScore  - points);
        _state.turnScore   = Math.max(0, _state.turnScore   - points);
        _state.turnDarts   = Math.max(0, _state.turnDarts   - 1);

        // Unlock board if we just undid the 3rd dart
        if (_state.turnComplete) {
            _state.turnComplete = false;
            _lockBoard(false);
            var nb = document.getElementById('practice-next-btn');
            if (nb) nb.disabled = true;
        }

        // Reverse segment count
        if (seg > 0) {
            var key = (mul > 1 ? (mul === 2 ? 'D' : 'T') : '') + seg;
            _state.segmentCounts[key] = Math.max(0, (_state.segmentCounts[key] || 1) - 1);
            if (_state.segmentCounts[key] === 0) delete _state.segmentCounts[key];
        }

        // Remove last pill
        var pills = document.getElementById('practice-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        // Disable undo if no more buffered darts
        if (undoBtn) undoBtn.disabled = (_state.pendingDarts.length === 0);

        if (_state.turnDarts % 3 > 0 && SPEECH.isEnabled()) {
            setTimeout(function() { SPEECH.announceTurnEnd(_state.turnScore, 0); }, 400);
        }

        _updatePracticeStats();
    }

    function _resetMultiplierTabs() {
        _state.multiplier = 1;
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) {
            tabs.querySelectorAll('.tab-btn').forEach(function(b) {
                b.classList.remove('active-single', 'active-double', 'active-treble');
            });
            var s1 = tabs.querySelector('[data-multiplier="1"]');
            if (s1) s1.classList.add('active-single');
        }
        document.body.dataset.multiplier = 1;
    }

    function _advanceToNextTurn() {
        // Submit buffered darts to server, then clear and unlock
        var darts = _state.pendingDarts.slice();
        _state.pendingDarts = [];

        if (darts.length > 0) {
            API.submitTurn({
                leg_id:       _state.legId,
                player_id:    _state.playerId,
                score_before: 501,   // practice has no countdown — server ignores bust/checkout
                darts: darts.map(function(d) {
                    return { segment: d.segment, multiplier: d.multiplier };
                }),
            }).catch(function(err) {
                console.error('[practice] Turn submit error:', err);
                // Non-fatal — session stats are tracked locally
            });
        }

        // If the timer has expired, this NEXT press ends the session
        if (_state.timerExpired) {
            _endSession(_state.onEnd);
            return;
        }

        // Clear pills, unlock board, reset turn state immediately
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';

        var nextBtn = document.getElementById('practice-next-btn');
        if (nextBtn) nextBtn.disabled = true;

        var undoBtn = document.getElementById('practice-undo-btn');
        if (undoBtn) undoBtn.disabled = true;

        _state.turnComplete = false;
        _state.turnScore    = 0;
        _resetMultiplierTabs();
        _lockBoard(false);
    }

    function _lockBoard(locked) {
        var board = document.getElementById('practice-board');
        if (!board) return;
        board.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
    }

    // ------------------------------------------------------------------
    // Around the Clock completion
    // ------------------------------------------------------------------

    function _clockComplete(onEnd) {
        // Stop the timer
        if (_state.timerInterval) {
            clearInterval(_state.timerInterval);
            _state.timerInterval = null;
        }

        // Discard any partial turn — clock completed mid-turn
        _state.pendingDarts = [];

        // End the DB session
        API.endPracticeSession(_state.matchId).catch(function() {});

        // Play checkout sound + speech
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            SOUNDS.checkout();
        }
        if (SPEECH.isEnabled()) {
            setTimeout(function() {
                SPEECH.announceCheckout(0);  // triggers sound guard already called above
            }, 300);
        }

        // Show congratulations modal
        var overlay = document.createElement('div');
        overlay.id = 'clock-complete-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box clock-complete-box';

        box.innerHTML =
            '<div class="clock-complete-icon">🎯</div>' +
            '<div class="modal-title">AROUND THE CLOCK!</div>' +
            '<div class="modal-subtitle">All 20 segments hit in order</div>' +
            '<div class="clock-complete-stats">' +
                '<div class="clock-complete-stat">' +
                    '<span class="clock-stat-value">' + _state.targetAttempts + '</span>' +
                    '<span class="clock-stat-label">DARTS THROWN</span>' +
                '</div>' +
                '<div class="clock-complete-stat">' +
                    '<span class="clock-stat-value">' +
                        Math.round((_state.targetHits / Math.max(1, _state.targetAttempts)) * 100) + '%' +
                    '</span>' +
                    '<span class="clock-stat-label">HIT RATE</span>' +
                '</div>' +
            '</div>';

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.type = 'button';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.addEventListener('click', function() {
            overlay.remove();
            onEnd();
        });
        box.appendChild(doneBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // BOB'S 27 — doubles ladder practice game
    // ------------------------------------------------------------------

    var BOBS27_SEQUENCE = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,25];

    function _startBobs27(onEnd) {
        _state.bobs27Score  = 27;
        _state.bobs27Double = 1;
        _state.bobs27Rounds = 0;
        _buildBobs27Screen(onEnd);
        _bobs27Announce();
    }

    function _bobs27CurrentDouble() {
        return BOBS27_SEQUENCE[BOBS27_SEQUENCE.indexOf(_state.bobs27Double)];
    }

    function _bobs27Announce() {
        if (!SPEECH.isEnabled()) return;
        var d = _state.bobs27Double;
        var label = d === 25 ? 'Double Bull' : 'Double ' + d;
        var msg = _state.playerName + ', you are targeting ' + label +
                  '. Your current score is ' + _state.bobs27Score + '.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 300);
    }

    function _buildBobs27Screen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // Header
        var header = document.createElement('header');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = "BOB'S 27";
        var timerEl = document.createElement('div');
        timerEl.id = 'practice-timer';
        timerEl.className = 'gh-match-info practice-timer-inline';
        timerEl.textContent = _formatTime(_state.timerSeconds);
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(timerEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { if (typeof UI !== 'undefined') UI.showRulesModal('bobs27'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', function() { _bobs27End(onEnd, false); });
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'b27-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _bobs27Undo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'b27-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _bobs27Next(onEnd); });
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // Score display
        var scoreWrap = document.createElement('div');
        scoreWrap.className = 'b27-score-wrap';
        scoreWrap.innerHTML =
            '<div class="b27-score-label">SCORE</div>' +
            '<div class="b27-score-value" id="b27-score">' + _state.bobs27Score + '</div>' +
            '<div class="b27-target-label">TARGET</div>' +
            '<div class="b27-target-value" id="b27-target">' +
                (_state.bobs27Double === 25 ? 'D-BULL' : 'D' + _state.bobs27Double) +
            '</div>';
        app.appendChild(scoreWrap);

        // Dart pills
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // Progress row — show which doubles remain
        var progressWrap = document.createElement('div');
        progressWrap.className = 'b27-progress-wrap';
        _buildBobs27Progress(progressWrap);
        app.appendChild(progressWrap);

        // Multiplier tabs — fully interactive; selected multiplier used in _bobs27Throw
        _state.multiplier = 2; // default to Double
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 2 ? ' active-double' : '');
            btn.dataset.multiplier = tab.mul;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.textContent = tab.label;
            UI.addTouchSafeListener(btn, function() {
                _state.multiplier = tab.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.mul;
            });
            tabs.appendChild(btn);
        });
        app.appendChild(tabs);
        document.body.dataset.multiplier = 2;

        // Segment grid — highlight current target
        var board = document.createElement('main');
        board.id = 'practice-board';
        board.appendChild(_buildBobs27Grid(onEnd));
        board.appendChild(_buildBobs27BullRow(onEnd));
        app.appendChild(board);

        // No timer for Bob's 27 — hide timer display
        var b27Timer = document.getElementById('practice-timer');
        if (b27Timer) { b27Timer.textContent = ''; b27Timer.style.display = 'none'; }
    }

    function _buildBobs27Progress(wrap) {
        wrap.innerHTML = '';
        wrap.className = 'b27-progress-wrap';
        var idx = BOBS27_SEQUENCE.indexOf(_state.bobs27Double);
        BOBS27_SEQUENCE.forEach(function(d, i) {
            var pip = document.createElement('span');
            pip.className = 'b27-pip';
            if (i < idx) pip.classList.add('b27-pip-done');
            else if (i === idx) pip.classList.add('b27-pip-current');
            pip.textContent = d === 25 ? 'B' : d;
            wrap.appendChild(pip);
        });
    }

    function _buildBobs27Grid(onEnd) {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(function(seg) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn' + (seg === _state.bobs27Double ? ' target-highlight' : '');
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            btn.addEventListener('click', function() { _bobs27Throw(seg, _state.multiplier, onEnd); });
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildBobs27BullRow(onEnd) {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        // MISS button
        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _bobs27Throw(0, 0, onEnd); });
        row.appendChild(miss);

        // Outer Bull (S25) — counts as a miss for Bob's 27
        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function() { _bobs27Throw(25, 1, onEnd); });
        row.appendChild(outer);

        // Inner Bull (D25) — counts as a hit if targeting Bull
        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner' +
            (_state.bobs27Double === 25 ? ' target-highlight' : '');
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function() { _bobs27Throw(25, 2, onEnd); });
        row.appendChild(bull);

        return row;
    }

    // Each throw is immediate (no 3-dart buffering) — every dart has instant effect
    var _b27History = []; // stack of { score, double } for undo

    function _bobs27Throw(segment, multiplier, onEnd) {
        // No turn-complete locking in Bob's 27 — every dart is always live

        var target = _state.bobs27Double;
        var hitValue  = target === 25 ? 50 : target * 2; // points scored on a hit (double value)
        var missValue = target === 25 ? 25 : target;     // points deducted on a miss (segment value)
        var isHit = (multiplier === 2 && segment === target);
        var change = isHit ? hitValue : -missValue;

        // Push undo snapshot
        _b27History.push({ score: _state.bobs27Score, double: target, dartsThrown: _state.dartsThrown });

        _state.bobs27Score += change;
        _state.dartsThrown++;
        _state.turnDarts++;

        // Enable undo
        var undoBtn = document.getElementById('b27-undo-btn');
        if (undoBtn) undoBtn.disabled = false;

        // Pill
        var pills = document.getElementById('practice-pills');
        if (pills) {
            var pill = document.createElement('div');
            pill.className = 'dart-pill' + (isHit ? ' pill-hot' : ' pill-miss');
            var dLabel = target === 25 ? 'D-BULL' : 'D' + target;
            pill.textContent = isHit ? ('HIT ' + dLabel + ' (+' + hitValue + ')') :
                                       ('MISS ' + dLabel + ' (-' + missValue + ')');
            pills.appendChild(pill);
        }

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.dart();

        // Check bust
        if (_state.bobs27Score <= 0) {
            _state.bobs27Score = 0;
            _updateBobs27Display();
            setTimeout(function() { _bobs27GameOver(onEnd); }, 600);
            return;
        }

        // Advance if hit — clear pills and move to next double
        if (isHit) {
            _state.turnDarts = 0;
            _state.turnComplete = false;
            var idx = BOBS27_SEQUENCE.indexOf(target);
            if (idx < BOBS27_SEQUENCE.length - 1) {
                _state.bobs27Double = BOBS27_SEQUENCE[idx + 1];
                _updateBobs27Display();
                if (pills) pills.innerHTML = '';
                _bobs27Announce();
                if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
                    setTimeout(function() { SOUNDS.checkout(); }, 200);
                }
                // Check if all 21 doubles completed
                if (_state.bobs27Double === BOBS27_SEQUENCE[BOBS27_SEQUENCE.length - 1] && idx === BOBS27_SEQUENCE.length - 2) {
                    // Just advanced past D20 — will hit Bull next, keep going
                }
            } else {
                // Completed D-Bull — game won!
                _updateBobs27Display();
                setTimeout(function() { _bobs27Win(onEnd); }, 400);
                return;
            }
        } else {
            // Miss — check if 3 darts thrown on this double
            if (_state.turnDarts % 3 === 0) {
                _state.bobs27Rounds++;
                _state.turnComplete = true;
                _bobs27LockBoard(true);
                var nb = document.getElementById('b27-next-btn');
                if (nb) nb.disabled = false;
                if (SPEECH.isEnabled()) {
                    setTimeout(function() {
                        var msg = 'Score is ' + _state.bobs27Score + '.';
                        SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
                    }, 600);
                }
            }
            _updateBobs27Display();
        }
    }

    function _bobs27Next(onEnd) {
        _state.turnDarts    = 0;
        _state.turnComplete = false;
        _bobs27LockBoard(false);
        _resetMultiplierTabs();
        var nb = document.getElementById('b27-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('b27-undo-btn');
        if (ub) ub.disabled = true;
        _b27History = []; // clear undo history at turn boundary
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';
        _bobs27Announce();
    }

    function _bobs27LockBoard(locked) {
        var board = document.getElementById('practice-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
    }

    function _updateBobs27Display() {
        var scoreEl = document.getElementById('b27-score');
        if (scoreEl) scoreEl.textContent = _state.bobs27Score;
        var targetEl = document.getElementById('b27-target');
        if (targetEl) targetEl.textContent = _state.bobs27Double === 25 ? 'D-BULL' : 'D' + _state.bobs27Double;
        // Refresh progress pips
        var progressWrap = document.querySelector('.b27-progress-wrap');
        if (progressWrap) _buildBobs27Progress(progressWrap);
        // Refresh segment highlights
        document.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.classList.remove('target-highlight');
            var seg = parseInt(btn.dataset.segment);
            if (seg === _state.bobs27Double) btn.classList.add('target-highlight');
        });
    }

    function _bobs27Undo() {
        if (_b27History.length === 0) return;
        var snap = _b27History.pop();
        _state.bobs27Score  = snap.score;
        _state.bobs27Double = snap.double;
        _state.dartsThrown  = snap.dartsThrown;
        _state.turnDarts    = (_state.turnDarts > 0) ? _state.turnDarts - 1 : 0;
        // If board was locked after 3rd dart, unlock it
        if (_state.turnComplete) {
            _state.turnComplete = false;
            _bobs27LockBoard(false);
            var nb = document.getElementById('b27-next-btn');
            if (nb) nb.disabled = true;
        }
        _updateBobs27Display();
        var pills = document.getElementById('practice-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);
        var undoBtn = document.getElementById('b27-undo-btn');
        if (undoBtn) undoBtn.disabled = (_b27History.length === 0);
    }

    function _bobs27End(onEnd, timedOut) {
        clearInterval(_state.timerInterval);
        API.endPracticeSession(_state.matchId).catch(function() {});
        _showBobs27Summary(onEnd);
    }

    function _bobs27GameOver(onEnd) {
        clearInterval(_state.timerInterval);
        API.endPracticeSession(_state.matchId).catch(function() {});
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.bust && SOUNDS.bust();
        _showBobs27Summary(onEnd, true);
    }

    function _bobs27Win(onEnd) {
        clearInterval(_state.timerInterval);
        API.endPracticeSession(_state.matchId).catch(function() {});
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
        _showBobs27Summary(onEnd, false, true);
    }

    function _showBobs27Summary(onEnd, busted, won) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var lastDoubleIdx = BOBS27_SEQUENCE.indexOf(_state.bobs27Double);
        var lastDoubleLabel = _state.bobs27Double === 25 ? 'D-Bull' : 'D' + _state.bobs27Double;
        var doublesHit = lastDoubleIdx; // number of doubles successfully cleared

        var titleText = won ? 'LEGEND!' : busted ? 'BUSTED!' : 'SESSION DONE';
        var subtitleText = won ? 'All 21 doubles completed!' :
                           busted ? 'Score hit zero on ' + lastDoubleLabel :
                           'Reached ' + lastDoubleLabel;

        inner.innerHTML =
            '<div id="setup-title"><div class="setup-logo">' + titleText + '</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div></div>';

        var summaryEl = document.createElement('div');
        summaryEl.className = 'practice-summary';
        [
            { label: 'REACHED',       value: lastDoubleLabel },
            { label: 'DOUBLES HIT',   value: doublesHit + ' / 21' },
            { label: 'FINAL SCORE',   value: _state.bobs27Score },
            { label: 'DARTS THROWN',  value: _state.dartsThrown },
        ].forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML = '<span class="practice-summary-label">' + row.label + '</span>' +
                             '<span class="practice-summary-value">' + row.value + '</span>';
            summaryEl.appendChild(item);
        });
        inner.appendChild(summaryEl);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }

    // ------------------------------------------------------------------
    // 121 CHECKOUTS — solo checkout practice game
    // ------------------------------------------------------------------

    function _startCheckout121(onEnd) {
        _state.c121Target    = 121;
        _state.c121DartsUsed = 0;
        _state.c121Score     = 121;
        _state.c121ScoreAtTurnStart = 121;
        _state.c121Attempts  = 0;
        _state.c121Successes = 0;
        _b27History = []; // reuse history stack for 121 undo
        _buildCheckout121Screen(onEnd);
        // No timer for 121 Checkouts — hide timer display
        var c121Timer = document.getElementById('practice-timer');
        if (c121Timer) { c121Timer.textContent = ''; c121Timer.style.display = 'none'; }
        _c121Announce();
    }

    function _c121Announce() {
        if (!SPEECH.isEnabled()) return;
        var dartsLeft = _state.c121DartLimit - _state.c121DartsUsed;
        var msg = _state.playerName + ', you need ' + _state.c121Score + '. ' +
                  dartsLeft + ' darts remaining.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 300);
    }

    function _buildCheckout121Screen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // Header
        var header = document.createElement('header');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = '121 CHECKOUTS';
        var timerEl = document.createElement('div');
        timerEl.id = 'practice-timer';
        timerEl.className = 'gh-match-info practice-timer-inline';
        timerEl.textContent = _formatTime(_state.timerSeconds);
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(timerEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { if (typeof UI !== 'undefined') UI.showRulesModal('checkout121'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', function() { _c121End(onEnd); });
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'c121-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _c121Undo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'c121-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _c121AdvanceTurn(onEnd); });
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // Score / info display
        var scoreWrap = document.createElement('div');
        scoreWrap.className = 'c121-score-wrap';
        scoreWrap.innerHTML =
            '<div class="c121-score-block"><div class="c121-score-label">TARGET</div>' +
            '<div class="c121-score-value" id="c121-score">' + _state.c121Score + '</div></div>' +
            '<div class="c121-score-block"><div class="c121-score-label">DARTS LEFT</div>' +
            '<div class="c121-score-value" id="c121-darts-left">' + _state.c121DartLimit + '</div></div>' +
            '<div class="c121-score-block"><div class="c121-score-label">ATTEMPTS</div>' +
            '<div class="c121-score-value" id="c121-attempts">' + _state.c121Attempts + '</div></div>' +
            '<div class="c121-score-block"><div class="c121-score-label">HITS</div>' +
            '<div class="c121-score-value" id="c121-successes">' + _state.c121Successes + '</div></div>';
        app.appendChild(scoreWrap);

        // Status message
        var statusEl = document.createElement('div');
        statusEl.id = 'c121-status';
        statusEl.className = 'c121-status';
        statusEl.textContent = 'CHECKOUT IN ' + _state.c121DartLimit + ' DARTS';
        app.appendChild(statusEl);

        // Dart pills
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // Multiplier tabs
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tab.label;
            btn.dataset.multiplier = tab.multiplier;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            UI.addTouchSafeListener(btn, function() {
                _state.multiplier = tab.multiplier;
                document.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.multiplier;
            });
            tabs.appendChild(btn);
        });
        tabs.querySelector('[data-multiplier="1"]').classList.add('active-single');
        document.body.dataset.multiplier = 1;
        app.appendChild(tabs);

        // Segment grid
        var board = document.createElement('main');
        board.id = 'practice-board';
        board.appendChild(_buildC121Grid(onEnd));
        board.appendChild(_buildC121BullRow(onEnd));
        app.appendChild(board);

        _c121UpdateCheckoutHint();
    }

    function _buildC121Grid(onEnd) {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(function(seg) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            btn.addEventListener('click', function() { _c121Throw(seg, _state.multiplier, onEnd); });
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildC121BullRow(onEnd) {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _c121Throw(0, 0, onEnd); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function() { _c121Throw(25, 1, onEnd); });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function() { _c121Throw(25, 2, onEnd); });
        row.appendChild(bull);

        return row;
    }

    // c121 throw history for undo
    var _c121ThrowHistory = [];

    function _c121Throw(segment, multiplier, onEnd) {
        if (_state.turnComplete) return;

        var points   = segment === 0 ? 0 : segment * multiplier;
        var newScore = _state.c121Score - points;
        var dartsUsed = _state.c121DartsUsed + 1;

        // Bust conditions: gone negative, exact 1 (no double possible), or
        // overshot to 0 without a double finish
        var isBust = false;
        if (newScore < 0) {
            isBust = true;
        } else if (newScore === 1) {
            isBust = true; // can't finish on a double from 1
        } else if (newScore === 0 && multiplier !== 2) {
            isBust = true; // must finish on a double
        }

        // Push undo snapshot before mutating state
        _c121ThrowHistory.push({
            score:     _state.c121Score,
            dartsUsed: _state.c121DartsUsed,
            turnDarts: _state.turnDarts,
            turnComplete: _state.turnComplete,
            scoreAtTurnStart: _state.c121ScoreAtTurnStart,
        });

        // Enable undo
        var undoBtn = document.getElementById('c121-undo-btn');
        if (undoBtn) undoBtn.disabled = false;

        if (isBust) {
            // Show bust pill then reset score to turn-start value
            _state.c121DartsUsed = dartsUsed;
            _state.turnDarts++;
            _addC121Pill(segment, multiplier, points, true);
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.bust && SOUNDS.bust();
            var statusEl = document.getElementById('c121-status');
            if (statusEl) { statusEl.textContent = 'BUST!'; statusEl.className = 'c121-status c121-bust'; }
            // Reset score to what it was at start of this turn
            _state.c121Score = _state.c121ScoreAtTurnStart;
            _c121UpdateDisplay(onEnd);
            // Lock board, force NEXT
            _lockBoard(true);
            _state.turnComplete = true;
            var nextBtn = document.getElementById('c121-next-btn');
            if (nextBtn) nextBtn.disabled = false;
            return;
        }

        // Normal throw
        _state.c121Score  = newScore;
        _state.c121DartsUsed = dartsUsed;
        _state.turnDarts++;
        _state.dartsThrown++;

        _addC121Pill(segment, multiplier, points, false);
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.dart();
        if (SPEECH.isEnabled()) SPEECH.announceDartScore(segment, multiplier, points);

        // Checkout!
        if (newScore === 0) {
            _state.c121Successes++;
            _state.c121Attempts++;
            if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) SOUNDS.checkout();
            // Advance target
            _state.c121Target = _state.c121Target + 1;
            _state.c121Score  = _state.c121Target;
            _state.c121ScoreAtTurnStart = _state.c121Target;
            _state.c121DartsUsed = 0;
            _state.turnDarts  = 0;
            _state.turnComplete = false;
            var pills = document.getElementById('practice-pills');
            if (pills) pills.innerHTML = '';
            _c121UpdateDisplay(onEnd);
            var statusEl2 = document.getElementById('c121-status');
            if (statusEl2) { statusEl2.textContent = 'CHECKOUT! NOW ' + _state.c121Target; statusEl2.className = 'c121-status c121-success'; }
            _lockBoard(false);
            if (SPEECH.isEnabled()) {
                setTimeout(function() {
                    SPEECH.speak('Checkout! Next target: ' + _state.c121Target, { rate: 1.0 });
                }, 600);
            }
            return;
        }

        _c121UpdateDisplay(onEnd);
        _c121UpdateCheckoutHint();

        // After 3 darts: lock + NEXT — or auto-fail if darts exhausted
        var dartsInTurn = _state.turnDarts % 3;
        if (dartsInTurn === 0) {
            _state.turnComplete = true;
            _lockBoard(true);
            var nb = document.getElementById('c121-next-btn');
            if (nb) nb.disabled = false;
            if (SPEECH.isEnabled()) {
                var left = _state.c121DartLimit - _state.c121DartsUsed;
                setTimeout(function() {
                    SPEECH.speak(_state.c121Score + ' left. ' + left + ' darts remaining.', { rate: 1.0 });
                }, 900);
            }
            // If all darts used and not checked out — fail
            if (_state.c121DartsUsed >= _state.c121DartLimit) {
                _c121Fail(onEnd);
            }
        }
    }

    function _c121Fail(onEnd) {
        // Attempt failed — drop target by 1 (minimum 121), reset
        _state.c121Attempts++;
        _state.c121Target = Math.max(121, _state.c121Target - 1);
        _state.c121Score  = _state.c121Target;
        _state.c121ScoreAtTurnStart = _state.c121Target;
        _state.c121DartsUsed = 0;
        _state.turnDarts  = 0;
        _state.turnComplete = true; // keep board locked until NEXT pressed
        var statusEl = document.getElementById('c121-status');
        if (statusEl) {
            statusEl.textContent = 'FAILED — BACK TO ' + _state.c121Target;
            statusEl.className = 'c121-status c121-bust';
        }
        _c121UpdateDisplay(onEnd);
        var nextBtn = document.getElementById('c121-next-btn');
        if (nextBtn) nextBtn.disabled = false;
    }

    function _c121AdvanceTurn(onEnd) {
        _state.turnComplete  = false;
        _state.turnDarts     = 0;
        // c121DartsUsed intentionally NOT reset here — it accumulates across visits
        _state.c121ScoreAtTurnStart = _state.c121Score;
        _c121ThrowHistory    = [];
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';
        var nextBtn = document.getElementById('c121-next-btn');
        if (nextBtn) nextBtn.disabled = true;
        var undoBtn = document.getElementById('c121-undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        var statusEl = document.getElementById('c121-status');
        if (statusEl) {
            var remaining = _state.c121DartLimit - _state.c121DartsUsed;
            statusEl.textContent = remaining + ' DART' + (remaining === 1 ? '' : 'S') + ' REMAINING';
            statusEl.className = 'c121-status';
        }
        _resetMultiplierTabs();
        _lockBoard(false);
        _c121UpdateDisplay(onEnd);
        _c121UpdateCheckoutHint();
        _c121Announce();
    }

    function _c121Undo() {
        if (_c121ThrowHistory.length === 0) return;
        var snap = _c121ThrowHistory.pop();
        _state.c121Score     = snap.score;
        _state.c121DartsUsed = snap.dartsUsed;
        _state.turnDarts     = snap.turnDarts;
        _state.c121ScoreAtTurnStart = snap.scoreAtTurnStart;
        if (_state.turnComplete) {
            _state.turnComplete = false;
            _lockBoard(false);
            var nextBtn = document.getElementById('c121-next-btn');
            if (nextBtn) nextBtn.disabled = true;
        }
        _state.dartsThrown = Math.max(0, _state.dartsThrown - 1);
        var pills = document.getElementById('practice-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);
        var undoBtn = document.getElementById('c121-undo-btn');
        if (undoBtn) undoBtn.disabled = (_c121ThrowHistory.length === 0);
        var statusEl = document.getElementById('c121-status');
        if (statusEl) { statusEl.textContent = 'CHECKOUT IN ' + _state.c121DartLimit + ' DARTS'; statusEl.className = 'c121-status'; }
        _c121UpdateDisplay(null);
        _c121UpdateCheckoutHint();
    }

    function _addC121Pill(segment, multiplier, points, isBust) {
        var pills = document.getElementById('practice-pills');
        if (!pills) return;
        var pill = document.createElement('div');
        pill.className = 'dart-pill' + (isBust ? ' pill-miss' :
            points === 0 ? ' pill-miss' : points >= 60 ? ' pill-hot' : '');
        var label = segment === 0 ? 'MISS' :
            (multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : 'S') + segment;
        pill.textContent = isBust ? label + ' BUST' : label + ' (' + points + ')';
        pills.appendChild(pill);
    }

    function _c121UpdateDisplay(onEnd) {
        var scoreEl = document.getElementById('c121-score');
        if (scoreEl) scoreEl.textContent = _state.c121Score;
        var dartsLeftEl = document.getElementById('c121-darts-left');
        if (dartsLeftEl) dartsLeftEl.textContent = Math.max(0, _state.c121DartLimit - _state.c121DartsUsed);
        var attemptsEl = document.getElementById('c121-attempts');
        if (attemptsEl) attemptsEl.textContent = _state.c121Attempts;
        var successEl = document.getElementById('c121-successes');
        if (successEl) successEl.textContent = _state.c121Successes;
    }

    function _c121UpdateCheckoutHint() {
        // Highlight doubles on the board when score is a valid checkout
        document.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.classList.remove('target-highlight');
        });
        var score = _state.c121Score;
        if (score <= 50 && score % 2 === 0 && score >= 2) {
            // Highlight the finishing double
            var d = score / 2;
            if (d <= 20) {
                var btn = document.querySelector('#segment-grid .seg-btn[data-segment="' + d + '"]');
                if (btn) btn.classList.add('target-highlight');
            } else if (d === 25) {
                var bullBtn = document.querySelector('#bull-row .bull-btn-inner');
                if (bullBtn) bullBtn.classList.add('target-highlight');
            }
        }
    }

    function _c121End(onEnd) {
        clearInterval(_state.timerInterval);
        API.endPracticeSession(_state.matchId).catch(function() {});
        _showCheckout121Summary(onEnd);
    }

    function _showCheckout121Summary(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var rate = _state.c121Attempts > 0
            ? Math.round((_state.c121Successes / _state.c121Attempts) * 100) + '%' : '0%';

        inner.innerHTML =
            '<div id="setup-title"><div class="setup-logo">SESSION DONE</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div></div>';

        var summaryEl = document.createElement('div');
        summaryEl.className = 'practice-summary';
        [
            { label: 'HIGHEST REACHED', value: _state.c121Target },
            { label: 'ATTEMPTS',        value: _state.c121Attempts },
            { label: 'CHECKOUTS HIT',   value: _state.c121Successes },
            { label: 'SUCCESS RATE',    value: rate },
            { label: 'DARTS THROWN',    value: _state.dartsThrown },
        ].forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML = '<span class="practice-summary-label">' + row.label + '</span>' +
                             '<span class="practice-summary-value">' + row.value + '</span>';
            summaryEl.appendChild(item);
        });
        inner.appendChild(summaryEl);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }

    // ------------------------------------------------------------------
    // WARM UP ROUTINE  (N→E→S→W: 20→11→3→6, 5 min each)
    // ------------------------------------------------------------------

    var WARMUP_SEGMENTS  = [20, 11, 3, 6];
    var WARMUP_LABELS    = { 20: 'NORTH (20)', 11: 'EAST (11)', 3: 'SOUTH (3)', 6: 'WEST (6)' };
    // Neighbours: segment → [left, right] (either side on the board)
    var WARMUP_NEIGHBOURS = {
        20: [1,  5],
        11: [14, 8],
        3:  [17, 19],
        6:  [13, 10],
    };

    function _startWarmup(onEnd) {
        API.getWarmupHighScore(_state.playerId)
            .then(function(res) {
                _state.warmupHighScore = res ? (res.score || 0) : 0;
            })
            .catch(function() { _state.warmupHighScore = 0; })
            .then(function() {
                _buildWarmupScreen(onEnd);
                _warmupAnnounceStart();
                _warmupStartSegmentTimer(onEnd);
            });
    }

    function _buildWarmupScreen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // ── Header ──────────────────────────────────────────────────
        var header = document.createElement('header');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'WARM UP';
        var timerEl = document.createElement('div');
        timerEl.id = 'warmup-timer';
        timerEl.className = 'gh-match-info practice-timer-inline';
        timerEl.textContent = '5:00';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(timerEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { if (typeof UI !== 'undefined') UI.showRulesModal('warmup'); });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', function() { _warmupEnd(onEnd); });
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'warmup-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _warmupUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'warmup-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _warmupNext(onEnd); });
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Score display ────────────────────────────────────────────
        var scoreWrap = document.createElement('div');
        scoreWrap.className = 'wu-score-wrap';
        scoreWrap.innerHTML =
            '<div class="wu-stat-block">' +
                '<div class="wu-stat-label">SEGMENT</div>' +
                '<div class="wu-stat-value wu-target" id="wu-target">' +
                    WARMUP_SEGMENTS[_state.warmupSegmentIndex] + '</div>' +
            '</div>' +
            '<div class="wu-stat-block">' +
                '<div class="wu-stat-label">SCORE</div>' +
                '<div class="wu-stat-value" id="wu-score">' + _state.warmupScore + '</div>' +
            '</div>' +
            '<div class="wu-stat-block">' +
                '<div class="wu-stat-label">HIGH SCORE</div>' +
                '<div class="wu-stat-value wu-hs" id="wu-hs">' + _state.warmupHighScore + '</div>' +
            '</div>';
        app.appendChild(scoreWrap);

        // ── Compass progress strip ────────────────────────────────────
        var compassWrap = document.createElement('div');
        compassWrap.className = 'wu-compass-wrap';
        compassWrap.id = 'wu-compass';
        _warmupRenderCompass(compassWrap);
        app.appendChild(compassWrap);

        // ── Status ───────────────────────────────────────────────────
        var statusEl = document.createElement('div');
        statusEl.id = 'wu-status';
        statusEl.className = 'wu-status';
        statusEl.textContent = _warmupStatusText();
        app.appendChild(statusEl);

        // ── Dart pills ───────────────────────────────────────────────
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // ── Multiplier tabs ──────────────────────────────────────────
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.textContent = tab.label;
            UI.addTouchSafeListener(btn, function() {
                if (_state.warmupSetComplete) return;
                _state.multiplier = tab.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        app.appendChild(tabs);

        // ── Segment grid ─────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'practice-board';
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        for (var s = 1; s <= 20; s++) {
            (function(seg) {
                var btn = document.createElement('button');
                btn.className = 'seg-btn';
                btn.dataset.segment = seg;
                btn.type = 'button';
                btn.textContent = seg;
                btn.addEventListener('click', function() { _warmupThrow(seg, _state.multiplier, onEnd); });
                grid.appendChild(btn);
            })(s);
        }
        segBoard.appendChild(grid);

        // Bull row
        var bullRow = document.createElement('div');
        bullRow.id = 'bull-row';
        bullRow.className = 'bull-row';
        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn'; miss.type = 'button'; miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _warmupThrow(0, 0, onEnd); });
        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn'; outer.type = 'button'; outer.textContent = 'OUTER';
        outer.addEventListener('click', function() { _warmupThrow(25, 1, onEnd); });
        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner'; bull.type = 'button'; bull.textContent = 'BULL';
        bull.addEventListener('click', function() { _warmupThrow(25, 2, onEnd); });
        bullRow.appendChild(miss); bullRow.appendChild(outer); bullRow.appendChild(bull);
        segBoard.appendChild(bullRow);
        app.appendChild(segBoard);

        _warmupApplyHighlight();
    }

    function _warmupStatusText() {
        var seg = WARMUP_SEGMENTS[_state.warmupSegmentIndex];
        var neighbours = WARMUP_NEIGHBOURS[seg];
        return WARMUP_LABELS[seg] + '  ·  Neighbours: ' + neighbours[0] + ' & ' + neighbours[1] +
               '  ·  Turn: ' + _state.warmupTurnScore + ' pts';
    }

    function _warmupRenderCompass(container) {
        container.innerHTML = '';
        var dirs = ['N','E','S','W'];
        WARMUP_SEGMENTS.forEach(function(seg, idx) {
            var pip = document.createElement('div');
            var state = idx < _state.warmupSegmentIndex ? 'done' :
                        idx === _state.warmupSegmentIndex ? 'current' : 'pending';
            pip.className = 'wu-compass-pip wu-pip-' + state;
            pip.innerHTML = '<span class="wu-pip-dir">' + dirs[idx] + '</span>' +
                            '<span class="wu-pip-seg">' + seg + '</span>';
            container.appendChild(pip);
        });
    }

    function _warmupApplyHighlight() {
        var target = WARMUP_SEGMENTS[_state.warmupSegmentIndex];
        var neighbours = WARMUP_NEIGHBOURS[target];
        document.querySelectorAll('#segment-grid .seg-btn').forEach(function(btn) {
            var seg = parseInt(btn.dataset.segment);
            btn.classList.remove('target-highlight', 'wu-neighbour-highlight');
            if (seg === target) btn.classList.add('target-highlight');
            else if (neighbours.indexOf(seg) !== -1) btn.classList.add('wu-neighbour-highlight');
        });
    }

    // ── Undo history ─────────────────────────────────────────────────────────
    var _wuHistory = [];

    function _warmupThrow(segment, multiplier, onEnd) {
        if (_state.warmupSetComplete) return;

        var target     = WARMUP_SEGMENTS[_state.warmupSegmentIndex];
        var neighbours = WARMUP_NEIGHBOURS[target];
        var points = 0;
        if (segment === target)                    points = 2;
        else if (neighbours.indexOf(segment) !== -1) points = 1;

        _wuHistory.push({
            score:      _state.warmupScore,
            segScore:   _state.warmupSegScores[_state.warmupSegmentIndex],
            turnScore:  _state.warmupTurnScore,
            turnDarts:  _state.warmupTurnDarts,
            dartsThrown:_state.dartsThrown,
            setComplete:false,
        });

        _state.warmupScore += points;
        _state.warmupSegScores[_state.warmupSegmentIndex] += points;
        _state.warmupTurnScore  += points;
        _state.warmupTurnDarts++;
        _state.dartsThrown++;

        // Enable undo
        var ub = document.getElementById('warmup-undo-btn');
        if (ub) ub.disabled = false;

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            points > 0 ? SOUNDS.dart() : null;
        }

        // Per-dart speech (confirmation only — no segment total)
        if (SPEECH.isEnabled()) {
            var dartMsg = points === 2 ? '2 points' : points === 1 ? '1 point' : 'Miss';
            window.speechSynthesis && window.speechSynthesis.cancel();
            SPEECH.speak(dartMsg, { rate: 1.0, pitch: 1.0 });
        }

        // Pill
        var pills = document.getElementById('practice-pills');
        if (pills) {
            var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
            var segStr = segment === 0 ? 'MISS' : segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') : mulStr + segment;
            var pill = document.createElement('div');
            pill.className = 'dart-pill' + (points === 2 ? ' pill-hot' : points === 1 ? '' : ' pill-miss');
            pill.textContent = segStr + ' — ' + points + (points === 1 ? ' pt' : ' pts');
            pills.appendChild(pill);
        }

        _warmupUpdateDisplay();

        // After 3 darts — lock and show NEXT, then announce turn total
        if (_state.warmupTurnDarts >= 3) {
            _state.warmupSetComplete = true;
            _warmupLockBoard(true);
            var nb = document.getElementById('warmup-next-btn');
            if (nb) nb.disabled = false;

            // Announce turn total after a short pause (lets per-dart call finish)
            if (SPEECH.isEnabled()) {
                var ts = _state.warmupTurnScore;
                setTimeout(function() {
                    window.speechSynthesis && window.speechSynthesis.cancel();
                    SPEECH.speak(ts + (ts === 1 ? ' point this turn.' : ' points this turn.'), { rate: 1.0, pitch: 1.0 });
                }, 900);
            }
        }
    }

    function _warmupNext(onEnd) {
        _state.warmupSetComplete = false;
        _state.warmupTurnScore   = 0;
        _state.warmupTurnDarts   = 0;
        _wuHistory = [];
        _warmupLockBoard(false);
        _resetMultiplierTabs();
        var nb = document.getElementById('warmup-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('warmup-undo-btn');
        if (ub) ub.disabled = true;
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';
        var statusEl = document.getElementById('wu-status');
        if (statusEl) statusEl.textContent = _warmupStatusText();
    }

    function _warmupUndo() {
        if (_wuHistory.length === 0) return;
        var snap = _wuHistory.pop();
        _state.warmupScore = snap.score;
        _state.warmupSegScores[_state.warmupSegmentIndex] = snap.segScore;
        _state.warmupTurnScore  = snap.turnScore;
        _state.warmupTurnDarts  = snap.turnDarts;
        _state.dartsThrown      = snap.dartsThrown;

        if (_state.warmupSetComplete) {
            _state.warmupSetComplete = false;
            _warmupLockBoard(false);
            var nb = document.getElementById('warmup-next-btn');
            if (nb) nb.disabled = true;
        }

        var pills = document.getElementById('practice-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var ub = document.getElementById('warmup-undo-btn');
        if (ub) ub.disabled = (_wuHistory.length === 0);

        _warmupUpdateDisplay();
    }

    function _warmupLockBoard(locked) {
        var board = document.getElementById('practice-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function(b) { b.disabled = locked; });
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function(b) { b.disabled = locked; });
    }

    function _warmupUpdateDisplay() {
        var scoreEl = document.getElementById('wu-score');
        if (scoreEl) scoreEl.textContent = _state.warmupScore;
        var statusEl = document.getElementById('wu-status');
        if (statusEl) statusEl.textContent = _warmupStatusText();
    }

    // ── Per-segment timer ────────────────────────────────────────────────────

    function _warmupStartSegmentTimer(onEnd) {
        _state.warmupTimerSec = 300;
        _warmupTickTimer(onEnd);
        _state.warmupInterval = setInterval(function() { _warmupTickTimer(onEnd); }, 1000);
    }

    function _warmupTickTimer(onEnd) {
        _state.warmupTimerSec--;
        var el = document.getElementById('warmup-timer');
        if (el) {
            el.textContent = _formatTime(Math.max(0, _state.warmupTimerSec));
            el.classList.toggle('timer-warning', _state.warmupTimerSec <= 60);
        }

        if (_state.warmupTimerSec === 30 && SPEECH.isEnabled()) {
            SPEECH.speak('30 seconds remaining.', { rate: 1.0, pitch: 1.0 });
        }

        if (_state.warmupTimerSec <= 0) {
            clearInterval(_state.warmupInterval);
            _warmupSegmentEnd(onEnd);
        }
    }

    function _warmupSegmentEnd(onEnd) {
        // Force-complete any open set so board is clean
        _state.warmupSetComplete = false;
        _state.warmupTurnScore   = 0;
        _state.warmupTurnDarts   = 0;
        _wuHistory = [];
        _warmupLockBoard(true);
        var nb = document.getElementById('warmup-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('warmup-undo-btn');
        if (ub) ub.disabled = true;

        var segScore = _state.warmupSegScores[_state.warmupSegmentIndex];

        if (SPEECH.isEnabled()) {
            var seg = WARMUP_SEGMENTS[_state.warmupSegmentIndex];
            SPEECH.speak('Time up on ' + seg + '. You scored ' + segScore + ' points.', { rate: 1.0, pitch: 1.0 });
        }

        // Advance to next segment or finish
        _state.warmupSegmentIndex++;
        if (_state.warmupSegmentIndex >= WARMUP_SEGMENTS.length) {
            setTimeout(function() { _warmupFinish(onEnd); }, 1500);
            return;
        }

        // Next segment — rebuild screen fresh
        setTimeout(function() {
            _buildWarmupScreen(onEnd);
            _warmupApplyHighlight();
            _warmupAnnounceSegment();
            _warmupStartSegmentTimer(onEnd);
        }, 1200);
    }

    function _warmupFinish(onEnd) {
        var total = _state.warmupScore;
        API.endPracticeSession(_state.matchId).catch(function() {});
        API.submitWarmupScore(_state.playerId, total)
            .then(function(res) {
                var isNew = res && res.is_new_high;
                var hs    = res ? res.high_score : Math.max(total, _state.warmupHighScore);
                _warmupAnnounceEnd(total, isNew, hs);
                _showWarmupSummary(onEnd, total, isNew, hs);
            })
            .catch(function() {
                _showWarmupSummary(onEnd, total, false, _state.warmupHighScore);
            });
    }

    function _warmupEnd(onEnd) {
        clearInterval(_state.warmupInterval);
        API.endPracticeSession(_state.matchId).catch(function() {});
        _showWarmupSummary(onEnd, _state.warmupScore, false, _state.warmupHighScore);
    }

    function _warmupAnnounceStart() {
        if (!SPEECH.isEnabled()) return;
        var hs  = _state.warmupHighScore;
        var seg = WARMUP_SEGMENTS[0];
        setTimeout(function() {
            SPEECH.speak(_state.playerName + ', your current high score is ' + hs + '. ' +
                    'You are targeting segment ' + seg + '.', { rate: 1.0, pitch: 1.0 });
        }, 400);
    }

    function _warmupAnnounceSegment() {
        if (!SPEECH.isEnabled()) return;
        var seg = WARMUP_SEGMENTS[_state.warmupSegmentIndex];
        setTimeout(function() {
            SPEECH.speak('You are targeting segment ' + seg + '.', { rate: 1.0, pitch: 1.0 });
        }, 400);
    }

    function _warmupAnnounceEnd(total, isNew, hs) {
        if (!SPEECH.isEnabled()) return;
        var msg = _state.playerName + ', your total score was ' + total + '. ';
        msg += isNew
            ? 'New high score of ' + hs + '!'
            : 'Your current high score is ' + hs + '.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 800);
    }

    function _showWarmupSummary(onEnd, total, isNew, hs) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">' + (isNew ? 'NEW HIGH SCORE!' : 'WARM UP COMPLETE') + '</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div>' +
            '</div>';

        // Per-segment breakdown
        var scorecard = document.createElement('div');
        scorecard.className = 'wu-summary-scorecard';
        var dirs = ['N','E','S','W'];
        WARMUP_SEGMENTS.forEach(function(seg, idx) {
            var row = document.createElement('div');
            row.className = 'wu-summary-row';
            row.innerHTML =
                '<span class="wu-summary-dir">' + dirs[idx] + '</span>' +
                '<span class="wu-summary-seg">Segment ' + seg + '</span>' +
                '<span class="wu-summary-pts">' + (_state.warmupSegScores[idx] || 0) + ' pts</span>';
            scorecard.appendChild(row);
        });
        inner.appendChild(scorecard);

        var summaryEl = document.createElement('div');
        summaryEl.className = 'practice-summary';
        [
            { label: 'TOTAL SCORE', value: total },
            { label: isNew ? '🏆 NEW HIGH SCORE' : 'HIGH SCORE', value: hs },
            { label: 'DARTS THROWN', value: _state.dartsThrown },
        ].forEach(function(r) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML =
                '<span class="practice-summary-label">' + r.label + '</span>' +
                '<span class="practice-summary-value">' + r.value + '</span>';
            summaryEl.appendChild(item);
        });
        inner.appendChild(summaryEl);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }

    // ------------------------------------------------------------------
    // BASEBALL DARTS
    // ------------------------------------------------------------------

    function _startBaseball(onEnd) {
        // Fetch high score from DB, then build screen
        API.getBaseballHighScore(_state.playerId)
            .then(function(res) {
                _state.baseballHighScore = res ? (res.score || 0) : 0;
            })
            .catch(function() { _state.baseballHighScore = 0; })
            .then(function() {
                _buildBaseballScreen(onEnd);
                _baseballAnnounceInning(true);
            });
    }

    function _buildBaseballScreen(onEnd) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-practice';

        // ── Header ──────────────────────────────────────────────────────
        var header = document.createElement('header');
        header.className = 'game-header';

        var leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';
        var titleEl = document.createElement('div');
        titleEl.className = 'gh-game-name';
        titleEl.textContent = 'BASEBALL';
        var subtitleEl = document.createElement('div');
        subtitleEl.className = 'gh-match-info';
        subtitleEl.textContent = '9 INNINGS';
        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subtitleEl);
        leftSlot.appendChild(titleWrap);
        var rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() {
            if (typeof UI !== 'undefined') UI.showRulesModal('baseball');
        });
        leftSlot.appendChild(rulesBtn);
        header.appendChild(leftSlot);

        var centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';
        var endBtn = document.createElement('button');
        endBtn.className = 'gh-btn gh-btn-red';
        endBtn.type = 'button';
        endBtn.textContent = '✕ END';
        endBtn.addEventListener('click', function() { _baseballEnd(onEnd); });
        centreSlot.appendChild(endBtn);
        header.appendChild(centreSlot);

        var rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';
        var undoBtn = document.createElement('button');
        undoBtn.id = 'bb-undo-btn';
        undoBtn.className = 'gh-btn gh-btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', _baseballUndo);
        var nextBtn = document.createElement('button');
        nextBtn.id = 'bb-next-btn';
        nextBtn.className = 'gh-btn gh-btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;
        nextBtn.addEventListener('click', function() { _baseballNext(onEnd); });
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);
        header.appendChild(rightSlot);
        app.appendChild(header);

        // ── Scoreboard ──────────────────────────────────────────────────
        var board = document.createElement('div');
        board.className = 'bb-board';
        board.innerHTML =
            '<div class="bb-stat-block">' +
                '<div class="bb-stat-label">INNING</div>' +
                '<div class="bb-stat-value" id="bb-inning">' + _state.baseballInning + ' / 9</div>' +
            '</div>' +
            '<div class="bb-stat-block">' +
                '<div class="bb-stat-label">TARGET</div>' +
                '<div class="bb-stat-value bb-target" id="bb-target">' + _state.baseballTarget + '</div>' +
            '</div>' +
            '<div class="bb-stat-block">' +
                '<div class="bb-stat-label">RUNS</div>' +
                '<div class="bb-stat-value bb-runs" id="bb-runs">' + _state.baseballRuns + '</div>' +
            '</div>' +
            '<div class="bb-stat-block">' +
                '<div class="bb-stat-label">OUTS</div>' +
                '<div class="bb-outs-row" id="bb-outs-row"></div>' +
            '</div>';
        app.appendChild(board);
        _baseballRenderOuts();

        // ── Inning runs strip ────────────────────────────────────────────
        var inningStrip = document.createElement('div');
        inningStrip.className = 'bb-inning-strip';
        inningStrip.id = 'bb-inning-strip';
        _baseballRenderInningStrip(inningStrip);
        app.appendChild(inningStrip);

        // ── Status ───────────────────────────────────────────────────────
        var statusEl = document.createElement('div');
        statusEl.id = 'bb-status';
        statusEl.className = 'bb-status';
        statusEl.textContent = 'INNING ' + _state.baseballInning + '  —  TARGET: ' + _state.baseballTarget;
        app.appendChild(statusEl);

        // ── Dart pills ───────────────────────────────────────────────────
        var pillRow = document.createElement('div');
        pillRow.id = 'practice-pills';
        pillRow.className = 'practice-pills';
        app.appendChild(pillRow);

        // ── Multiplier tabs ──────────────────────────────────────────────
        _state.multiplier = 1;
        var tabs = document.createElement('div');
        tabs.id = 'multiplier-tabs';
        [
            { label: 'Single', mul: 1, cls: 'active-single' },
            { label: 'Double', mul: 2, cls: 'active-double' },
            { label: 'Treble', mul: 3, cls: 'active-treble' },
        ].forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'tab-btn' + (tab.mul === 1 ? ' active-single' : '');
            btn.dataset.multiplier = tab.mul;
            btn.dataset.activeClass = tab.cls;
            btn.type = 'button';
            btn.textContent = tab.label;
            UI.addTouchSafeListener(btn, function() {
                _state.multiplier = tab.mul;
                tabs.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active-single', 'active-double', 'active-treble');
                });
                btn.classList.add(tab.cls);
                document.body.dataset.multiplier = tab.mul;
            });
            tabs.appendChild(btn);
        });
        document.body.dataset.multiplier = 1;
        app.appendChild(tabs);

        // ── Segment grid ─────────────────────────────────────────────────
        var segBoard = document.createElement('main');
        segBoard.id = 'practice-board';
        segBoard.appendChild(_buildBaseballGrid(onEnd));
        segBoard.appendChild(_buildBaseballBullRow(onEnd));
        app.appendChild(segBoard);

        _baseballApplyHighlight();
    }

    function _buildBaseballGrid(onEnd) {
        var grid = document.createElement('div');
        grid.id = 'segment-grid';
        grid.className = 'segment-grid';
        [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].forEach(function(seg) {
            var btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.dataset.segment = seg;
            btn.type = 'button';
            btn.textContent = seg;
            if (seg === _state.baseballTarget) btn.classList.add('target-highlight');
            btn.addEventListener('click', function() { _baseballThrow(seg, _state.multiplier, onEnd); });
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildBaseballBullRow(onEnd) {
        var row = document.createElement('div');
        row.id = 'bull-row';
        row.className = 'bull-row';

        var miss = document.createElement('button');
        miss.className = 'seg-btn bull-btn';
        miss.type = 'button';
        miss.textContent = 'MISS';
        miss.addEventListener('click', function() { _baseballThrow(0, 0, onEnd); });
        row.appendChild(miss);

        var outer = document.createElement('button');
        outer.className = 'seg-btn bull-btn';
        outer.type = 'button';
        outer.textContent = 'OUTER';
        outer.dataset.segment = 25;
        outer.addEventListener('click', function() { _baseballThrow(25, 1, onEnd); });
        row.appendChild(outer);

        var bull = document.createElement('button');
        bull.className = 'seg-btn bull-btn bull-btn-inner';
        bull.type = 'button';
        bull.textContent = 'BULL';
        bull.dataset.segment = 25;
        bull.addEventListener('click', function() { _baseballThrow(25, 2, onEnd); });
        row.appendChild(bull);

        return row;
    }

    // ── Throw history for undo ───────────────────────────────────────────────
    var _bbHistory = [];

    function _baseballThrow(segment, multiplier, onEnd) {
        if (_state.baseballInningComplete) return;

        var target  = _state.baseballTarget;
        var isHit   = (segment === target);   // any multiplier on the target number
        var runs    = isHit ? multiplier : 0; // single=1, double=2, treble=3
        var isOut   = !isHit;

        // Push undo snapshot
        _bbHistory.push({
            runs:          _state.baseballRuns,
            outs:          _state.baseballOuts,
            inningRuns:    _state.baseballInningRuns,
            darts:         _state.baseballDarts,
            inningComplete:_state.baseballInningComplete,
            dartsThrown:   _state.dartsThrown,
        });

        _state.baseballDarts++;
        _state.dartsThrown++;
        if (isHit) {
            _state.baseballRuns      += runs;
            _state.baseballInningRuns += runs;
        } else {
            _state.baseballOuts++;
        }

        // Enable undo
        var undoBtn = document.getElementById('bb-undo-btn');
        if (undoBtn) undoBtn.disabled = false;

        // Sound
        if (typeof SOUNDS !== 'undefined' && SOUNDS.isEnabled()) {
            isHit ? SOUNDS.dart() : (SOUNDS.bust && SOUNDS.bust());
        }

        // Speech
        if (SPEECH.isEnabled()) {
            var msg = isHit
                ? (runs === 1 ? 'Single. ' : runs === 2 ? 'Double. ' : 'Treble. ') + runs + (runs === 1 ? ' run.' : ' runs.')
                : 'Out.';
            setTimeout(function() {
                SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
            }, 200);
        }

        // Pill
        var pills = document.getElementById('practice-pills');
        if (pills) {
            var pill = document.createElement('div');
            var mulStr = multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : segment === 0 ? '' : 'S';
            var segStr = segment === 0 ? 'MISS' : segment === 25 ? (multiplier === 2 ? 'BULL' : 'OUTER') : mulStr + segment;
            pill.className = 'dart-pill' + (isHit ? (runs >= 3 ? ' pill-hot' : '') : ' pill-miss');
            pill.textContent = isHit ? (segStr + ' — ' + runs + (runs === 1 ? ' RUN' : ' RUNS')) : (segStr + ' — OUT');
            pills.appendChild(pill);
        }

        _baseballUpdateDisplay();

        // End of a set of 3 darts?
        var dartsInSet = _state.baseballDarts % 3;
        if (dartsInSet === 0) {
            // Completed a set — check if inning is over (3+ outs)
            if (_state.baseballOuts >= 3) {
                _state.baseballInningComplete = true;
                _baseballLockBoard(true);
                var nb = document.getElementById('bb-next-btn');
                if (nb) nb.disabled = false;
                _baseballAnnounceInningEnd(onEnd);
            } else {
                // Set of 3 done, inning continues — lock board, show NEXT
                // so player can undo any of the 3 darts before proceeding
                _baseballLockBoard(true);
                var nb2 = document.getElementById('bb-next-btn');
                if (nb2) nb2.disabled = false;
                // Announce outs remaining
                if (SPEECH.isEnabled()) {
                    var outsLeft = 3 - _state.baseballOuts;
                    setTimeout(function() {
                        SPEECH.speak(outsLeft + (outsLeft === 1 ? ' out' : ' outs') + ' remaining.', { rate: 1.0, pitch: 1.0 });
                    }, 700);
                }
            }
        }
    }

    function _baseballNext(onEnd) {
        // Common: clear pills, reset undo, disable buttons
        var pills = document.getElementById('practice-pills');
        if (pills) pills.innerHTML = '';
        var nb = document.getElementById('bb-next-btn');
        if (nb) nb.disabled = true;
        var ub = document.getElementById('bb-undo-btn');
        if (ub) ub.disabled = true;
        _bbHistory = [];
        _baseballLockBoard(false);
        _resetMultiplierTabs();

        if (_state.baseballInningComplete) {
            // Inning is over — check for game end or advance inning
            if (_state.baseballInning >= 9) {
                _baseballFinish(onEnd);
                return;
            }
            _state.baseballInning++;
            _state.baseballTarget     = _state.baseballStartNum + _state.baseballInning - 1;
            _state.baseballOuts       = 0;
            _state.baseballInningRuns = 0;
            _state.baseballDarts      = 0;
            _state.baseballInningComplete = false;

            _baseballUpdateDisplay();
            _baseballApplyHighlight();

            var statusEl = document.getElementById('bb-status');
            if (statusEl) {
                statusEl.textContent = 'INNING ' + _state.baseballInning + '  —  TARGET: ' + _state.baseballTarget;
                statusEl.className = 'bb-status';
            }
            _baseballAnnounceInning(false);
        } else {
            // Mid-inning set complete — just continue throwing, same inning
            var statusEl2 = document.getElementById('bb-status');
            if (statusEl2) {
                var outsLeft2 = 3 - _state.baseballOuts;
                statusEl2.textContent = 'INNING ' + _state.baseballInning +
                    '  —  ' + outsLeft2 + (outsLeft2 === 1 ? ' OUT' : ' OUTS') + ' REMAINING';
            }
        }
    }

    function _baseballUndo() {
        if (_bbHistory.length === 0) return;
        var snap = _bbHistory.pop();
        _state.baseballRuns       = snap.runs;
        _state.baseballOuts       = snap.outs;
        _state.baseballInningRuns = snap.inningRuns;
        _state.baseballDarts      = snap.darts;
        _state.dartsThrown        = snap.dartsThrown;
        _state.baseballInningComplete = snap.inningComplete;

        // After undo we're always back mid-set — unlock board, disable NEXT
        _baseballLockBoard(false);
        var nb = document.getElementById('bb-next-btn');
        if (nb) nb.disabled = true;

        // Remove last pill
        var pills = document.getElementById('practice-pills');
        if (pills && pills.lastChild) pills.removeChild(pills.lastChild);

        var undoBtn = document.getElementById('bb-undo-btn');
        if (undoBtn) undoBtn.disabled = (_bbHistory.length === 0);

        _baseballUpdateDisplay();
    }

    function _baseballLockBoard(locked) {
        var board = document.getElementById('practice-board');
        if (board) board.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
        var tabs = document.getElementById('multiplier-tabs');
        if (tabs) tabs.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.disabled = locked;
        });
    }

    function _baseballApplyHighlight() {
        document.querySelectorAll('.seg-btn').forEach(function(btn) {
            btn.classList.remove('target-highlight');
        });
        var t = _state.baseballTarget;
        var btn = document.querySelector('#segment-grid .seg-btn[data-segment="' + t + '"]');
        if (btn) btn.classList.add('target-highlight');
    }

    function _baseballUpdateDisplay() {
        var inningEl = document.getElementById('bb-inning');
        if (inningEl) inningEl.textContent = _state.baseballInning + ' / 9';
        var targetEl = document.getElementById('bb-target');
        if (targetEl) targetEl.textContent = _state.baseballTarget;
        var runsEl = document.getElementById('bb-runs');
        if (runsEl) runsEl.textContent = _state.baseballRuns;
        _baseballRenderOuts();
        var strip = document.getElementById('bb-inning-strip');
        if (strip) _baseballRenderInningStrip(strip);
    }

    function _baseballRenderOuts() {
        var outsRow = document.getElementById('bb-outs-row');
        if (!outsRow) return;
        outsRow.innerHTML = '';
        for (var i = 0; i < 3; i++) {
            var pip = document.createElement('span');
            pip.className = 'bb-out-pip' + (i < _state.baseballOuts ? ' bb-out-pip-on' : '');
            outsRow.appendChild(pip);
        }
    }

    // Inning-by-inning runs strip (shows run total per inning)
    var _bbInningScores = [];   // runs per inning, 0-indexed

    function _baseballRenderInningStrip(container) {
        // Sync _bbInningScores length with current inning
        while (_bbInningScores.length < _state.baseballInning) {
            _bbInningScores.push(0);
        }
        // Update the current inning slot
        _bbInningScores[_state.baseballInning - 1] = _state.baseballInningRuns;

        container.innerHTML = '';
        for (var i = 0; i < 9; i++) {
            var cell = document.createElement('div');
            cell.className = 'bb-inning-cell' + (i === _state.baseballInning - 1 ? ' bb-inning-cell-current' : '');
            var num = document.createElement('div');
            num.className = 'bb-inning-cell-num';
            num.textContent = _state.baseballStartNum + i;
            var score = document.createElement('div');
            score.className = 'bb-inning-cell-score';
            score.textContent = i < _state.baseballInning ? String(_bbInningScores[i]) :
                               (i === _state.baseballInning - 1 ? String(_state.baseballInningRuns) : '—');
            cell.appendChild(num);
            cell.appendChild(score);
            container.appendChild(cell);
        }
    }

    function _baseballAnnounceInning(isFirst) {
        if (!SPEECH.isEnabled()) return;
        var msg = isFirst
            ? _state.playerName + ', welcome to Baseball Darts. In this inning you are targeting number ' + _state.baseballTarget + '.'
            : 'New innings! The new target number is ' + _state.baseballTarget + '.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 400);
    }

    function _baseballAnnounceInningEnd(onEnd) {
        if (!SPEECH.isEnabled()) return;
        var runs = _state.baseballInningRuns;
        var msg = 'Inning ' + _state.baseballInning + ' over. ' +
                  runs + (runs === 1 ? ' run' : ' runs') + ' this inning. ' +
                  _state.baseballRuns + ' total runs.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 500);
    }

    function _baseballEnd(onEnd) {
        API.endPracticeSession(_state.matchId).catch(function() {});
        _showBaseballSummary(onEnd, false);
    }

    function _baseballFinish(onEnd) {
        var totalRuns = _state.baseballRuns;
        API.endPracticeSession(_state.matchId).catch(function() {});

        // Submit score to DB, then show summary
        API.submitBaseballScore(_state.playerId, totalRuns)
            .then(function(res) {
                var isNewHigh  = res && res.is_new_high;
                var highScore  = res ? res.high_score : Math.max(totalRuns, _state.baseballHighScore);
                _state.baseballHighScore = highScore;
                _baseballAnnounceGameEnd(totalRuns, isNewHigh, highScore);
                _showBaseballSummary(onEnd, true, isNewHigh, highScore);
            })
            .catch(function() {
                _showBaseballSummary(onEnd, true, false, _state.baseballHighScore);
            });
    }

    function _baseballAnnounceGameEnd(runs, isNewHigh, highScore) {
        if (!SPEECH.isEnabled()) return;
        var msg = 'Match over. You made ' + runs + (runs === 1 ? ' run' : ' runs') + ' in 9 innings. ';
        msg += isNewHigh
            ? 'You made a new high score of ' + runs + '!'
            : 'Your current high score is ' + highScore + '.';
        setTimeout(function() {
            SPEECH.speak(msg, { rate: 1.0, pitch: 1.0 });
        }, 600);
    }

    function _showBaseballSummary(onEnd, completed, isNewHigh, highScore) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        document.body.className = 'mode-setup';

        var inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        var titleText = completed ? (isNewHigh ? 'NEW HIGH SCORE!' : 'GAME OVER') : 'SESSION ENDED';
        inner.innerHTML =
            '<div id="setup-title">' +
            '<div class="setup-logo">' + titleText + '</div>' +
            '<div class="setup-subtitle">' + _state.playerName.toUpperCase() + '</div>' +
            '</div>';

        // Inning-by-inning scorecard
        if (completed || _state.baseballInning > 1) {
            var scorecard = document.createElement('div');
            scorecard.className = 'bb-summary-scorecard';
            var headerRow = document.createElement('div');
            headerRow.className = 'bb-summary-row bb-summary-header';
            headerRow.innerHTML = '<span>INN</span><span>TGT</span><span>RUNS</span>';
            scorecard.appendChild(headerRow);
            for (var i = 0; i < Math.min(_state.baseballInning, 9); i++) {
                var row = document.createElement('div');
                row.className = 'bb-summary-row';
                var r = _bbInningScores[i] !== undefined ? _bbInningScores[i] : 0;
                row.innerHTML = '<span>' + (i + 1) + '</span>' +
                                '<span>' + (_state.baseballStartNum + i) + '</span>' +
                                '<span>' + r + '</span>';
                scorecard.appendChild(row);
            }
            inner.appendChild(scorecard);
        }

        var summaryEl = document.createElement('div');
        summaryEl.className = 'practice-summary';
        var rows = [
            { label: 'INNINGS PLAYED', value: Math.min(_state.baseballInning, 9) },
            { label: 'TOTAL RUNS',     value: _state.baseballRuns },
        ];
        if (completed) {
            rows.push({ label: isNewHigh ? '🏆 NEW HIGH SCORE' : 'HIGH SCORE', value: highScore || _state.baseballHighScore });
        }
        rows.forEach(function(r) {
            var item = document.createElement('div');
            item.className = 'practice-summary-row';
            item.innerHTML = '<span class="practice-summary-label">' + r.label + '</span>' +
                             '<span class="practice-summary-value">' + r.value + '</span>';
            summaryEl.appendChild(item);
        });
        inner.appendChild(summaryEl);

        var doneBtn = document.createElement('button');
        doneBtn.className = 'start-btn';
        doneBtn.textContent = 'BACK TO SETUP';
        doneBtn.type = 'button';
        doneBtn.addEventListener('click', onEnd);
        inner.appendChild(doneBtn);
    }

    // ------------------------------------------------------------------
    // SVG Dartboard Heatmap
    // ------------------------------------------------------------------

    /**
     * Build an SVG dartboard heatmap from _state.segmentCounts.
     * Uses the same multi-colour gradient style as the Player Stats page.
     *
     * Note: practice segmentCounts uses '' prefix for singles (not 'S'),
     * so getHits bridges that difference before passing to the shared renderer.
     */
    function _buildHeatmap() {
        var counts = _state.segmentCounts;

        // Bridge practice key format ('T20', 'D20', '20') to stats format
        // ('T20', 'D20', 'S20', 'BULL', 'OUTER') expected by _buildStatsStyleHeatmap
        var normalised = {};
        Object.keys(counts).forEach(function(k) {
            if (k === 'D25') {
                normalised['BULL'] = counts[k];
            } else if (k === '25') {
                normalised['OUTER'] = counts[k];
            } else if (/^\d+$/.test(k)) {
                normalised['S' + k] = counts[k];
            } else {
                normalised[k] = counts[k];   // T## and D## pass through unchanged
            }
        });

        return _buildStatsStyleHeatmap(normalised);
    }

    /**
     * Shared multi-colour heatmap renderer.
     * Accepts counts in stats format: S##, T##, D##, BULL, OUTER.
     * Returns a div wrapping the SVG board + side legend (same as stats page).
     */
    function _buildStatsStyleHeatmap(counts) {
        var SEGMENTS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        var SIZE = 200, CX = SIZE/2, CY = SIZE/2;
        var R = SIZE/2 - 4;

        var rBull    = R * 0.06;
        var rOuter   = R * 0.13;
        var rInner1  = R * 0.47;
        var rTreble2 = R * 0.55;
        var rDouble1 = R * 0.84;
        var rDouble2 = R * 0.97;

        var SEG_ANGLE  = 360 / 20;
        var START_OFF  = -SEG_ANGLE / 2;

        var maxHits = 1;
        Object.values(counts).forEach(function(v) { if (v > maxHits) maxHits = v; });

        function getHits(seg, prefix) {
            if (seg === 25) return counts[prefix === 'D' ? 'BULL' : 'OUTER'] || 0;
            return counts[prefix + seg] || 0;
        }

        function heatColour(hits, isDouble, isTreble) {
            if (hits === 0) return null;
            var t = Math.pow(hits / maxHits, 0.6);
            var stops = [
                { t: 0.00, r: 13,  g: 13,  b: 13  },
                { t: 0.20, r: 74,  g: 16,  b: 96  },
                { t: 0.45, r: 192, g: 57,  b: 43  },
                { t: 0.70, r: 200, g: 160, b: 104 },
                { t: 1.00, r: 46,  g: 204, b: 113 },
            ];
            var lo = stops[0], hi = stops[stops.length - 1];
            for (var i = 0; i < stops.length - 1; i++) {
                if (t >= stops[i].t && t <= stops[i+1].t) { lo = stops[i]; hi = stops[i+1]; break; }
            }
            var span = hi.t - lo.t || 1;
            var f = (t - lo.t) / span;
            var r = Math.round(lo.r + f * (hi.r - lo.r));
            var g = Math.round(lo.g + f * (hi.g - lo.g));
            var b = Math.round(lo.b + f * (hi.b - lo.b));
            var alpha = isTreble ? 0.95 : isDouble ? 0.88 : 0.80;
            return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        }

        function polarToXY(angleDeg, radius) {
            var rad = (angleDeg - 90) * Math.PI / 180;
            return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
        }

        function arcPath(r1, r2, a1, a2) {
            var p1 = polarToXY(a1, r1), p2 = polarToXY(a2, r1);
            var p3 = polarToXY(a2, r2), p4 = polarToXY(a1, r2);
            var lg = (a2 - a1) > 180 ? 1 : 0;
            return 'M ' + p1.x + ' ' + p1.y + ' A ' + r1 + ' ' + r1 + ' 0 ' + lg + ' 1 ' + p2.x + ' ' + p2.y +
                   ' L ' + p3.x + ' ' + p3.y + ' A ' + r2 + ' ' + r2 + ' 0 ' + lg + ' 0 ' + p4.x + ' ' + p4.y + ' Z';
        }

        function svgEl(tag, attrs) {
            var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.keys(attrs).forEach(function(k) { e.setAttribute(k, attrs[k]); });
            return e;
        }

        function tip(e, text) {
            var t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = text;
            e.appendChild(t);
        }

        var svg = svgEl('svg', { viewBox: '0 0 ' + SIZE + ' ' + SIZE, width: '100%', style: 'width:100%;display:block;' });
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R, fill: '#0d0d0d', stroke: '#222', 'stroke-width': '1' }));

        SEGMENTS.forEach(function(seg, i) {
            var a1 = START_OFF + i * SEG_ANGLE, a2 = a1 + SEG_ANGLE;
            var sH = getHits(seg, 'S'), tH = getHits(seg, 'T'), dH = getHits(seg, 'D');
            var zones = [
                { r1: rOuter,   r2: rInner1,  hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rInner1,  r2: rTreble2, hits: tH, dbl: false, tbl: true,  lbl: 'T' },
                { r1: rTreble2, r2: rDouble1, hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rDouble1, r2: rDouble2, hits: dH, dbl: true,  tbl: false, lbl: 'D' },
            ];
            zones.forEach(function(zone) {
                var colour = heatColour(zone.hits, zone.dbl, zone.tbl);
                var path = svgEl('path', { d: arcPath(zone.r1, zone.r2, a1, a2),
                    fill: colour || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' });
                svg.appendChild(path);
                if (zone.hits > 0 && zone.lbl !== 'S') {
                    var mid = a1 + SEG_ANGLE / 2, mr = (zone.r1 + zone.r2) / 2;
                    var mp = polarToXY(mid, mr);
                    var txt = svgEl('text', { x: mp.x, y: mp.y, 'text-anchor': 'middle',
                        'dominant-baseline': 'central', fill: '#fff', 'font-size': '6.5',
                        'font-family': 'monospace', 'font-weight': 'bold', 'pointer-events': 'none' });
                    txt.textContent = zone.hits;
                    svg.appendChild(txt);
                }
                var hitPts = zone.hits * (zone.lbl === 'T' ? 3 : zone.lbl === 'D' ? 2 : 1) * seg;
                var tt = svgEl('path', { d: arcPath(zone.r1, zone.r2, a1, a2), fill: 'transparent', stroke: 'none', cursor: 'default' });
                tip(tt, zone.lbl + seg + ' — ' + zone.hits + ' hit' + (zone.hits !== 1 ? 's' : '') + ' — ' + hitPts + ' pts');
                svg.appendChild(tt);
            });
            var mid = a1 + SEG_ANGLE / 2, labelR = (rDouble2 + R) / 2;
            var lp = polarToXY(mid, labelR);
            var lbl = svgEl('text', { x: lp.x, y: lp.y, 'text-anchor': 'middle',
                'dominant-baseline': 'central', fill: '#555', 'font-size': '7.5',
                'font-family': 'monospace', transform: 'rotate(' + (mid+90) + ',' + lp.x + ',' + lp.y + ')',
                'pointer-events': 'none' });
            lbl.textContent = seg;
            svg.appendChild(lbl);
        });

        // Outer bull
        var obH = getHits(25, 'S');
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: heatColour(obH, false, false) || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (obH > 0) {
            var obTxt = svgEl('text', { x: CX, y: CY + rBull + (rOuter-rBull)/2 - 1, 'text-anchor': 'middle',
                'dominant-baseline': 'central', fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            obTxt.textContent = obH;
            svg.appendChild(obTxt);
        }
        var obTT = svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(obTT, 'Outer Bull — ' + obH + ' hit' + (obH !== 1 ? 's' : '') + ' — ' + (obH*25) + ' pts');
        svg.appendChild(obTT);

        // Inner bull
        var bH = getHits(25, 'D');
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: heatColour(bH, true, false) || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (bH > 0) {
            var bTxt = svgEl('text', { x: CX, y: CY, 'text-anchor': 'middle',
                'dominant-baseline': 'central', fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            bTxt.textContent = bH;
            svg.appendChild(bTxt);
        }
        var bTT = svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(bTT, 'Bull — ' + bH + ' hit' + (bH !== 1 ? 's' : '') + ' — ' + (bH*50) + ' pts');
        svg.appendChild(bTT);

        // Wrap: SVG left, legend right (same layout as stats page)
        var inner = document.createElement('div');
        inner.className = 'heatmap-inner';

        var svgWrap = document.createElement('div');
        svgWrap.className = 'heatmap-svg-wrap';
        svgWrap.appendChild(svg);
        inner.appendChild(svgWrap);

        var legend = document.createElement('div');
        legend.className = 'heatmap-legend';

        var lgTitle = document.createElement('div');
        lgTitle.className = 'heatmap-legend-title';
        lgTitle.textContent = 'COLOUR GUIDE';
        legend.appendChild(lgTitle);

        [
            { colour: '#2ecc71', label: 'Hottest',  desc: 'Most frequently hit zones' },
            { colour: '#c8a068', label: 'Hot',       desc: 'Above average frequency'   },
            { colour: '#c0392b', label: 'Moderate',  desc: 'Occasionally hit'           },
            { colour: '#4a1060', label: 'Cold',      desc: 'Rarely hit'                 },
            { colour: '#0d0d0d', label: 'Coldest',   desc: 'Never or almost never hit', border: '#444' },
        ].forEach(function(item) {
            var row = document.createElement('div');
            row.className = 'heatmap-legend-item';
            var swatch = document.createElement('div');
            swatch.className = 'heatmap-legend-swatch';
            swatch.style.background = item.colour;
            if (item.border) swatch.style.borderColor = item.border;
            row.appendChild(swatch);
            var txt = document.createElement('div');
            txt.className = 'heatmap-legend-text';
            txt.innerHTML = '<strong>' + item.label + '</strong>' + item.desc;
            row.appendChild(txt);
            legend.appendChild(row);
        });

        var barRow = document.createElement('div');
        barRow.className = 'heatmap-gradient-bar-row';
        barRow.innerHTML = '<span class="heatmap-gradient-lbl">COLD</span>' +
                           '<div class="heatmap-gradient-bar"></div>' +
                           '<span class="heatmap-gradient-lbl">HOT</span>';
        legend.appendChild(barRow);
        inner.appendChild(legend);

        var wrap = document.createElement('div');
        wrap.className = 'heatmap-wrap';
        wrap.appendChild(inner);
        return wrap;
    }

    // ------------------------------------------------------------------

    return {
        showSetup: showSetup,
        start:     start,
    };

}());