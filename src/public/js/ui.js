/**
 * ui.js
 */

const UI = (() => {

    // ------------------------------------------------------------------
    // Setup Screen
    // ------------------------------------------------------------------

    // ── Home screen: title + game type tiles + stats button ──
    /**
     * Attach a listener that fires on touchend (preventing the subsequent
     * synthetic click) on touch devices, and on click on non-touch devices.
     * This prevents iOS Safari from mis-firing a tap on a tab button as a
     * click on whatever element happens to be underneath after layout shift.
     */
    function _addTouchSafeListener(el, handler) {
        var touched = false;
        el.addEventListener('touchend', function(e) {
            e.preventDefault();   // suppress the 300ms synthetic click
            touched = true;
            handler();
            // Reset flag after the synthetic click window passes
            setTimeout(function() { touched = false; }, 600);
        }, { passive: false });
        el.addEventListener('click', function() {
            if (touched) return;  // already handled by touchend
            handler();
        });
    }

    function buildSetupScreen(existingPlayers, onStartGame, onViewStats, onPractice, onCricket, onShanghai, onBaseball, onKiller, onNineLives, onBermuda, onRace1000) {
        // Clear any lingering modal overlays from the previous game screen
        ['confirm-modal', 'rules-modal'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        if (!document.getElementById('toast'))   document.body.appendChild(_buildToast());
        if (!document.getElementById('loading')) document.body.appendChild(_buildLoading());

        const inner = document.createElement('div');
        inner.className = 'setup-screen-inner home-screen-inner';
        app.appendChild(inner);

        // Title
        const title = document.createElement('div');
        title.id = 'setup-title';
        title.innerHTML = '<div class="setup-logo">DARTS 501</div><div class="setup-subtitle">SELECT GAME TYPE</div>';
        inner.appendChild(title);

        // Game type tiles
        const tilesSection = document.createElement('div');
        tilesSection.className = 'home-tiles';
        inner.appendChild(tilesSection);

        const gameTypes = [
            { value: '501',      label: '501',      sub: 'Classic',        icon: '🎯' },
            { value: '201',      label: '201',      sub: 'Short game',     icon: '⚡' },
            { value: 'Cricket',  label: 'Cricket',  sub: 'Strategic',      icon: '🏏' },
            { value: 'Shanghai', label: 'Shanghai', sub: '7 or 20 rounds', icon: '🀄' },
            { value: 'Killer',   label: 'Killer',   sub: 'A game of doubles', icon: '☠️' },
            { value: 'Baseball', label: 'Baseball', sub: '9 innings',      icon: '⚾' },
            { value: 'NineLives',       label: 'Nine Lives',       sub: 'Last cat standing', icon: '🐱' },
            { value: 'RaceTo1000',      label: 'Race to 1000',     sub: 'First to 1000',  icon: '🏁' },
            { value: 'BermudaTriangle', label: 'Bermuda Triangle', sub: '13-round scorer', icon: '🔺' },
            { value: 'Practice',        label: 'Practice',         sub: 'Solo training',  icon: '🎪', centred: true },
        ];

        gameTypes.forEach(gt => {
            const tile = document.createElement('button');
            tile.className = 'home-tile' + (gt.comingSoon ? ' home-tile-soon' : '') + (gt.centred ? ' home-tile-centred' : '');
            tile.type = 'button';
            tile.innerHTML =
                `<span class="home-tile-icon">${gt.icon}</span>` +
                `<span class="home-tile-label">${gt.label}</span>` +
                `<span class="home-tile-sub">${gt.sub}</span>`;

            if (gt.comingSoon) {
                tile.disabled = true;
            } else if (gt.value === 'Shanghai') {
                tile.addEventListener('click', () => { if (onShanghai) onShanghai(); });
            } else if (gt.value === 'Practice') {
                tile.addEventListener('click', () => { if (onPractice) onPractice(); });
            } else if (gt.value === 'Cricket') {
                tile.addEventListener('click', () => { if (onCricket) onCricket(); });
            } else if (gt.value === 'Baseball') {
                tile.addEventListener('click', () => { if (onBaseball) onBaseball(); });
            } else if (gt.value === 'Killer') {
                tile.addEventListener('click', () => { if (onKiller) onKiller(); });
            } else if (gt.value === 'NineLives') {
                tile.addEventListener('click', () => { if (onNineLives) onNineLives(); });
            } else if (gt.value === 'BermudaTriangle') {
                tile.addEventListener('click', () => { if (onBermuda) onBermuda(); });
            } else if (gt.value === 'RaceTo1000') {
                tile.addEventListener('click', () => { if (onRace1000) onRace1000(); });
            } else {
                tile.addEventListener('click', () => {
                    _buildMatchSetupScreen(
                        gt.value, existingPlayers, onStartGame, onViewStats, onPractice, onCricket, onShanghai, onBaseball, onKiller, onNineLives, onBermuda, onRace1000
                    );
                });
            }
            tilesSection.appendChild(tile);
        });

        // Stats button
        if (onViewStats) {
            const statsBtn = document.createElement('button');
            statsBtn.className = 'stats-entry-btn home-stats-btn';
            statsBtn.type = 'button';
            statsBtn.innerHTML = '📊  PLAYER STATS';
            statsBtn.addEventListener('click', onViewStats);
            inner.appendChild(statsBtn);
        }
    }

    // ── Match setup screen: checkout / sets / legs / players / start ──
    function _buildMatchSetupScreen(gameType, existingPlayers, onStartGame, onViewStats, onPractice, onCricket, onShanghai, onBaseball, onKiller, onNineLives, onBermuda, onRace1000) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-setup';

        const inner = document.createElement('div');
        inner.className = 'setup-screen-inner';
        app.appendChild(inner);

        // Standard header: DARTS 501 logo + game name
        _appendSetupHeader(inner, gameType);

        var _appTarget = inner;

        // Fake gameTypeRow/gameTypeSel so start button validation still works
        // We create a hidden selected button representing the chosen game type
        const hiddenGameTypeRow = document.createElement('div');
        hiddenGameTypeRow.style.display = 'none';
        const hiddenBtn = document.createElement('button');
        hiddenBtn.dataset.value = gameType;
        hiddenBtn.classList.add('option-btn', 'selected');
        hiddenGameTypeRow.appendChild(hiddenBtn);
        _appTarget.appendChild(hiddenGameTypeRow);
        const gameTypeRow = hiddenGameTypeRow;

        // ---- Checkout Rule ----
        const checkoutSection = document.createElement('div');
        checkoutSection.className = 'setup-section';
        checkoutSection.innerHTML = '<div class="setup-label">CHECKOUT RULE</div>';
        const checkoutRow = document.createElement('div');
        checkoutRow.className = 'setup-option-row';
        [
            { value: 'double', label: 'DOUBLE OUT', hint: 'Standard' },
            { value: 'single', label: 'SINGLE OUT', hint: 'Casual' },
        ].forEach(co => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.dataset.value = co.value;
            btn.type = 'button';
            btn.innerHTML = `${co.label}<span class="option-hint">${co.hint}</span>`;
            btn.addEventListener('click', () => {
                checkoutRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            checkoutRow.appendChild(btn);
        });
        checkoutSection.appendChild(checkoutRow);
        _appTarget.appendChild(checkoutSection);

        // ---- Sets + Legs (combined row) ----
        const setsLegsSection = document.createElement('div');
        setsLegsSection.className = 'setup-section setup-section-paired';

        // Left column: Sets to Win
        const setsCol = document.createElement('div');
        setsCol.className = 'paired-col';
        const setsLabel = document.createElement('div');
        setsLabel.className = 'setup-label';
        setsLabel.textContent = 'SETS TO WIN';
        const setsRow = document.createElement('div');
        setsRow.className = 'setup-option-row setup-option-col';
        [1, 2, 3, 4, 5].forEach(function(n) {
            const btn = document.createElement('button');
            btn.className = 'option-btn option-btn-compact';
            btn.dataset.value = n;
            btn.type = 'button';
            btn.textContent = n;
            btn.addEventListener('click', function() {
                setsRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
            });
            setsRow.appendChild(btn);
        });
        setsCol.appendChild(setsLabel);
        setsCol.appendChild(setsRow);

        // Right column: Legs per Set
        const legsCol = document.createElement('div');
        legsCol.className = 'paired-col';
        const legsLabel = document.createElement('div');
        legsLabel.className = 'setup-label';
        legsLabel.textContent = 'LEGS PER SET';
        const legsRow = document.createElement('div');
        legsRow.className = 'setup-option-row setup-option-col';
        [1, 3, 5, 7].forEach(function(n) {
            const btn = document.createElement('button');
            btn.className = 'option-btn option-btn-compact';
            btn.dataset.value = n;
            btn.type = 'button';
            btn.innerHTML = n + '<span class="option-hint">' + (n === 1 ? 'Single' : 'First to ' + Math.ceil(n/2)) + '</span>';
            btn.addEventListener('click', function() {
                legsRow.querySelectorAll('.option-btn').forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
            });
            legsRow.appendChild(btn);
        });
        legsCol.appendChild(legsLabel);
        legsCol.appendChild(legsRow);

        setsLegsSection.appendChild(setsCol);
        setsLegsSection.appendChild(legsCol);
        _appTarget.appendChild(setsLegsSection);

        // ---- Player Count ----
        const countSection = document.createElement('div');
        countSection.className = 'setup-section';
        countSection.innerHTML = '<div class="setup-label">NUMBER OF PLAYERS</div>';
        const countRow = document.createElement('div');
        countRow.className = 'setup-option-row';
        const namesSection = document.createElement('div');
        namesSection.id = 'setup-names-section';

        const startBtn = document.createElement('button');
        startBtn.id = 'setup-start-btn';
        startBtn.className = 'start-btn';
        startBtn.textContent = 'START MATCH';
        startBtn.disabled = true;

        [1, 2, 3, 4].forEach(n => {
            const btn = document.createElement('button');
            btn.className = 'option-btn count-btn';
            btn.dataset.count = n;
            btn.type = 'button';
            btn.innerHTML = n === 1 ? `1<span class="option-hint">vs CPU</span>` : String(n);
            btn.addEventListener('click', () => {
                countRow.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                if (n === 1) {
                    // Show difficulty picker before rendering slots
                    _showDifficultyModal((difficulty) => {
                        _renderSinglePlayerSlots(existingPlayers, namesSection, difficulty);
                        startBtn.disabled = false;
                    });
                } else {
                    _renderPlayerSlots(n, existingPlayers, namesSection);
                    startBtn.disabled = false;
                }
            });
            countRow.appendChild(btn);
        });
        countSection.appendChild(countRow);
        _appTarget.appendChild(countSection);
        _appTarget.appendChild(namesSection);

        startBtn.addEventListener('click', () => {
            const gameTypeSel  = gameTypeRow.querySelector('.option-btn.selected');
            const checkoutSel  = checkoutRow.querySelector('.option-btn.selected');
            const setsSel      = setsRow.querySelector('.option-btn.selected');
            const legsSel      = legsRow.querySelector('.option-btn.selected');

            if (!gameTypeSel)  { showToast('SELECT A GAME TYPE', 'bust', 2000);      return; }
            if (!checkoutSel)  { showToast('SELECT A CHECKOUT RULE', 'bust', 2000);  return; }
            if (!setsSel)      { showToast('SELECT SETS TO WIN', 'bust', 2000);       return; }
            if (!legsSel)      { showToast('SELECT LEGS PER SET', 'bust', 2000);      return; }

            const players = _collectPlayerSelections(namesSection);
            if (!players) return;

            onStartGame({
                players,
                gameType:    gameTypeSel.dataset.value,
                doubleOut:   checkoutSel.dataset.value === 'double',
                setsToWin:   parseInt(setsSel.dataset.value, 10),
                legsPerSet:  parseInt(legsSel.dataset.value, 10),
            });
        });
        const rulesBtn501 = document.createElement('button');
        rulesBtn501.type = 'button';
        rulesBtn501.className = 'setup-rules-btn';
        rulesBtn501.textContent = '📖 VIEW RULES';
        rulesBtn501.addEventListener('click', () => showRulesModal(gameType || '501'));
        _appTarget.appendChild(rulesBtn501);
        _appTarget.appendChild(startBtn);

        // Defaults — no gameTypeRow click needed (it's already set via hidden btn)
        checkoutRow.querySelector('[data-value="double"]').click();
        setsRow.querySelector('[data-value="1"]').click();
        legsRow.querySelector('[data-value="1"]').click();
        countRow.querySelector('[data-count="2"]').click();

        // Back link at bottom
        const backLink = document.createElement('button');
        backLink.className = 'setup-back-link';
        backLink.type = 'button';
        backLink.textContent = '← BACK TO HOME';
        backLink.addEventListener('click', () => {
            API.getPlayers().then(p => {
                buildSetupScreen(p, onStartGame, onViewStats, onPractice, onCricket, onShanghai, onBaseball, onKiller, onNineLives, onBermuda, onRace1000);
            });
        });
        _appTarget.appendChild(backLink);
    }

    // ------------------------------------------------------------------
    // Player slots
    // ------------------------------------------------------------------

    function _renderPlayerSlots(count, existingPlayers, container) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (let i = 0; i < count; i++) {
            // In 1-player mode, slot 1 (index 1) is always the CPU
            const isCpuSlot = (count === 1 && i === 1);
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers, isCpuSlot));
        }
        container.appendChild(grid);
        setTimeout(function() { var fi = container.querySelector('.name-input'); if (fi) fi.focus(); }, 150);
    }

    function _renderSinglePlayerSlots(existingPlayers, container, difficulty) {
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = '1fr 1fr';

        // Human slot
        grid.appendChild(_buildPlayerSlot(0, 1, existingPlayers, false));

        // CPU slot — fixed, displays chosen difficulty
        const label = CPU.LABELS[difficulty] || difficulty;
        const cpuSlot = document.createElement('div');
        cpuSlot.className = 'name-slot cpu-slot';
        cpuSlot.dataset.mode       = 'cpu';
        cpuSlot.dataset.isCpu      = 'true';
        cpuSlot.dataset.difficulty = difficulty;
        cpuSlot.innerHTML = `
            <div class="name-label">OPPONENT</div>
            <div class="cpu-badge">🤖 CPU</div>
            <div class="cpu-difficulty">${_esc(label)}</div>
            <button class="cpu-change-btn" type="button">CHANGE</button>
        `;

        // Allow re-picking difficulty
        cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', () => {
            _showDifficultyModal((newDifficulty) => {
                _renderSinglePlayerSlots(existingPlayers, container, newDifficulty);
            });
        });

        grid.appendChild(cpuSlot);
        container.appendChild(grid);
        setTimeout(function() { var fi = container.querySelector('.name-input'); if (fi) fi.focus(); }, 150);
    }

    /**
     * Show the CPU difficulty picker modal.
     * Calls onSelect(difficulty) when the user picks a level.
     */
    function _showDifficultyModal(onSelect) {
        var _dm = document.getElementById('difficulty-modal'); if (_dm) _dm.remove();

        const overlay = document.createElement('div');
        overlay.id = 'difficulty-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box difficulty-box';

        box.innerHTML = `
            <div class="modal-title">SELECT CPU DIFFICULTY</div>
            <div class="modal-subtitle">HOW HARD DO YOU WANT IT?</div>
        `;

        const levels = [
            {
                key:   'easy',
                icon:  '🍺',
                label: CPU.LABELS.easy,
                desc:  'A gentle introduction. Will occasionally aim at the wrong bit of the board entirely.',
            },
            {
                key:   'medium',
                icon:  '🎯',
                label: CPU.LABELS.medium,
                desc:  'A steady club player. Knows the checkout routes, misses under pressure.',
            },
            {
                key:   'hard',
                icon:  '🏆',
                label: CPU.LABELS.hard,
                desc:  'Precise, methodical, merciless. Hits trebles, closes out doubles, rarely loses.',
            },
        ];

        const grid = document.createElement('div');
        grid.className = 'difficulty-grid';

        levels.forEach(lvl => {
            const card = document.createElement('button');
            card.className = 'difficulty-card';
            card.dataset.difficulty = lvl.key;
            card.type = 'button';
            card.innerHTML = `
                <span class="diff-icon">${lvl.icon}</span>
                <span class="diff-label">${_esc(lvl.label)}</span>
                <span class="diff-desc">${_esc(lvl.desc)}</span>
            `;
            card.addEventListener('click', () => {
                overlay.remove();
                onSelect(lvl.key);
            });
            grid.appendChild(card);
        });

        box.appendChild(grid);
        overlay.appendChild(box);

        // Tap outside to dismiss (re-shows modal since a difficulty must be picked)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    function _buildPlayerSlot(index, totalCount, existingPlayers) {
        const slot = document.createElement('div');
        slot.className = 'name-slot';
        slot.dataset.index = index;

        const label = document.createElement('div');
        label.className = 'name-label';
        label.textContent = totalCount === 1 ? 'YOUR NAME' : `PLAYER ${index + 1}`;
        slot.appendChild(label);

        const toggleRow = document.createElement('div');
        toggleRow.className = 'slot-toggle-row';
        const newBtn = document.createElement('button');
        newBtn.className = 'slot-toggle-btn active';
        newBtn.textContent = '+ NEW';
        newBtn.type = 'button';
        const existingBtn = document.createElement('button');
        existingBtn.className = 'slot-toggle-btn';
        existingBtn.textContent = 'EXISTING';
        existingBtn.type = 'button';
        if (existingPlayers.length === 0) { existingBtn.disabled = true; existingBtn.title = 'No existing players'; }
        toggleRow.appendChild(newBtn);
        toggleRow.appendChild(existingBtn);
        slot.appendChild(toggleRow);

        const newInput = document.createElement('input');
        newInput.type = 'text'; newInput.className = 'name-input';
        newInput.placeholder = `Player ${index + 1} name`; newInput.maxLength = 20;
        newInput.autocomplete = 'off'; newInput.autocorrect = 'off';
        newInput.autocapitalize = 'words'; newInput.spellcheck = false;
        newInput.addEventListener('input', () => newInput.classList.remove('error'));
        slot.appendChild(newInput);

        const existingSelect = document.createElement('select');
        existingSelect.className = 'name-select';
        existingSelect.style.display = 'none';
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— Select player —'; ph.disabled = true; ph.selected = true;
        existingSelect.appendChild(ph);
        existingPlayers.filter(function(p) { return p.name !== 'CPU'; }).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            existingSelect.appendChild(opt);
        });
        existingSelect.addEventListener('change', () => existingSelect.classList.remove('error'));
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
        newBtn.addEventListener('click', () => activateMode('new'));
        existingBtn.addEventListener('click', () => activateMode('existing'));
        slot.dataset.mode = 'new';
        return slot;
    }

    function _collectPlayerSelections(container) {
        const slots = container.querySelectorAll('.name-slot');
        const result = []; let valid = true; let firstErr = null;
        slots.forEach(slot => {
            const mode = slot.dataset.mode;

            // CPU slot — fixed, no validation needed
            if (mode === 'cpu') {
                result.push({ isCpu: true, name: 'CPU', difficulty: slot.dataset.difficulty || 'medium' });
                return;
            }

            if (mode === 'new') {
                const input = slot.querySelector('.name-input');
                const name = input.value.trim();
                if (!name) { input.classList.add('error'); if (!firstErr) firstErr = input; valid = false; }
                else result.push({ mode: 'new', name, isCpu: false });
            } else {
                const select = slot.querySelector('.name-select');
                if (!select.value) { select.classList.add('error'); if (!firstErr) firstErr = select; valid = false; }
                else result.push({ mode: 'existing', id: parseInt(select.value, 10), name: select.options[select.selectedIndex].textContent, isCpu: false });
            }
        });
        // Duplicate check — exclude CPU from dupe detection
        const names = result.filter(r => !r.isCpu).map(r => r.name.toLowerCase());
        if (names.some((n, i) => names.indexOf(n) !== i)) {
            showToast('EACH PLAYER MUST BE UNIQUE', 'bust', 3000); valid = false;
        }
        if (!valid && firstErr) firstErr.focus();
        return valid ? result : null;
    }

    // ------------------------------------------------------------------
    // Congratulations Modal
    // ------------------------------------------------------------------

    /**
     * Show the end-of-match congratulations modal.
     *
     * @param {string}   winnerName
     * @param {Array}    players        - [{ id, name }]
     * @param {object}   setsScore      - { playerId: setsWon }
     * @param {Function} onNewMatch     - called when user taps New Match
     */
    function showCongratsModal(winnerName, players, setsScore, onNewMatch) {
        // Remove any existing modal
        var _cm = document.getElementById('congrats-modal'); if (_cm) _cm.remove();

        const overlay = document.createElement('div');
        overlay.id = 'congrats-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        // Trophy + winner
        box.innerHTML = `
            <div class="modal-trophy">🎯</div>
            <div class="modal-title">CONGRATULATIONS</div>
            <div class="modal-winner">${_esc(winnerName)}</div>
            <div class="modal-subtitle">WINS THE MATCH</div>
        `;

        // Final sets score
        const scoreGrid = document.createElement('div');
        scoreGrid.className = 'modal-score-grid';
        players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'modal-score-row';
            row.innerHTML = `
                <span class="modal-score-name">${_esc(p.name)}</span>
                <span class="modal-score-sets">${setsScore[String(p.id)] != null ? setsScore[String(p.id)] : 0} SET${((setsScore[String(p.id)] != null ? setsScore[String(p.id)] : 0)) !== 1 ? 'S' : ''}</span>
            `;
            scoreGrid.appendChild(row);
        });
        box.appendChild(scoreGrid);

        const newMatchBtn = document.createElement('button');
        newMatchBtn.className = 'start-btn';
        newMatchBtn.textContent = 'NEW MATCH';
        newMatchBtn.addEventListener('click', () => {
            overlay.remove();
            onNewMatch();
        });
        box.appendChild(newMatchBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    /**
     * Show an end-of-leg interstitial — who won, current set/legs score,
     * with a button to start the next leg.
     *
     * @param {object}   info           - { legWinnerName, setComplete, setWinnerName, setsScore, legsScore, legsPerSet }
     * @param {Array}    players        - [{ id, name }]
     * @param {Function} onNextLeg      - called when user taps Continue
     */
    function showLegEndModal(info, players, onNextLeg) {
        var _lem = document.getElementById('leg-end-modal'); if (_lem) _lem.remove();

        const overlay = document.createElement('div');
        overlay.id = 'leg-end-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box';

        const legsToWinSet = Math.ceil(info.legsPerSet / 2);

        if (info.setComplete) {
            box.innerHTML = `
                <div class="modal-trophy">🏆</div>
                <div class="modal-title">SET WON</div>
                <div class="modal-winner">${_esc(info.setWinnerName)}</div>
                <div class="modal-subtitle">WINS THE SET</div>
            `;
        } else {
            box.innerHTML = `
                <div class="modal-trophy">🎯</div>
                <div class="modal-title">LEG WON</div>
                <div class="modal-winner">${_esc(info.legWinnerName)}</div>
                <div class="modal-subtitle">WINS THE LEG</div>
            `;
        }

        // Current set tally (sets score) and current leg tally within the set
        const scoreGrid = document.createElement('div');
        scoreGrid.className = 'modal-score-grid';
        players.forEach(p => {
            const pid   = String(p.id);
            var sets  = info.setsScore[pid] != null ? info.setsScore[pid] : 0;
            var legs  = info.legsScore[pid] != null ? info.legsScore[pid] : 0;
            const row   = document.createElement('div');
            row.className = 'modal-score-row';
            row.innerHTML = `
                <span class="modal-score-name">${_esc(p.name)}</span>
                <span class="modal-score-sets">${sets} SET${sets !== 1 ? 'S' : ''}</span>
                <span class="modal-score-legs">${legs}/${legsToWinSet} LEGS</span>
            `;
            scoreGrid.appendChild(row);
        });
        box.appendChild(scoreGrid);

        const continueBtn = document.createElement('button');
        continueBtn.className = 'start-btn';
        continueBtn.textContent = 'NEXT LEG ▶';
        continueBtn.addEventListener('click', () => {
            overlay.remove();
            onNextLeg();
        });
        box.appendChild(continueBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // Game Shell
    // ------------------------------------------------------------------

    function buildShell(players, callbacks, gameType) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-game';
        _currentGameType = gameType || '501';
        app.appendChild(_buildHeader());
        app.appendChild(_buildSidebar(players));
        app.appendChild(_buildBoard(callbacks));
        app.appendChild(_buildStatusBar(callbacks));
        if (!document.getElementById('toast'))   document.body.appendChild(_buildToast());
        if (!document.getElementById('loading')) document.body.appendChild(_buildLoading());
    }

    var _currentGameType = '501';

    function _buildHeader() {
        const el = document.createElement('header');
        el.id = 'header';

        // ── Left: game name + match info + rules ──
        const leftSlot = document.createElement('div');
        leftSlot.className = 'gh-left';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'gh-title-wrap';

        const title = document.createElement('div');
        title.className = 'gh-game-name';
        title.textContent = _currentGameType.toUpperCase();

        const matchInfo = document.createElement('div');
        matchInfo.id = 'match-info';
        matchInfo.className = 'gh-match-info';

        titleWrap.appendChild(title);
        titleWrap.appendChild(matchInfo);
        leftSlot.appendChild(titleWrap);

        const rulesBtn = document.createElement('button');
        rulesBtn.type = 'button';
        rulesBtn.className = 'rules-btn';
        rulesBtn.textContent = '📖 RULES';
        rulesBtn.addEventListener('click', function() { showRulesModal(_currentGameType); });
        leftSlot.appendChild(rulesBtn);

        // ── Centre: End + Restart ──
        const centreSlot = document.createElement('div');
        centreSlot.className = 'gh-centre';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'gh-btn gh-btn-red'; cancelBtn.id = 'btn-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕ END';

        const restartBtn = document.createElement('button');
        restartBtn.className = 'gh-btn gh-btn-red'; restartBtn.id = 'btn-restart';
        restartBtn.type = 'button';
        restartBtn.textContent = '↺ RESTART';

        centreSlot.appendChild(cancelBtn);
        centreSlot.appendChild(restartBtn);

        // ── Right: Undo + Next + Speech ──
        const rightSlot = document.createElement('div');
        rightSlot.className = 'gh-right';

        const speechBtn = document.createElement('button');
        speechBtn.id    = 'btn-speech';
        speechBtn.type  = 'button';
        speechBtn.title = 'Toggle caller voice';
        speechBtn.className = 'speech-toggle';
        speechBtn.setAttribute('aria-pressed', 'true');
        _updateSpeechBtn(speechBtn, true);
        speechBtn.addEventListener('click', function() {
            if (!SPEECH.isSupported()) return;
            var nowEnabled = !SPEECH.isEnabled();
            SPEECH.setEnabled(nowEnabled);
            _updateSpeechBtn(speechBtn, nowEnabled);
        });

        const undoBtn = document.createElement('button');
        undoBtn.className = 'gh-btn gh-btn-undo'; undoBtn.id = 'btn-undo';
        undoBtn.type = 'button';
        undoBtn.textContent = '⟵ UNDO';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'gh-btn gh-btn-next'; nextBtn.id = 'btn-next';
        nextBtn.type = 'button';
        nextBtn.textContent = 'NEXT ▶';
        nextBtn.disabled = true;

        rightSlot.appendChild(speechBtn);
        rightSlot.appendChild(undoBtn);
        rightSlot.appendChild(nextBtn);

        el.appendChild(leftSlot);
        el.appendChild(centreSlot);
        el.appendChild(rightSlot);

        // Store refs so _buildStatusBar callbacks can be wired later
        el._cancelBtn  = cancelBtn;
        el._restartBtn = restartBtn;
        el._undoBtn    = undoBtn;
        el._nextBtn    = nextBtn;

        return el;
    }

    function _updateSpeechBtn(btn, enabled) {
        btn.textContent = enabled ? '🔊 CALLER' : '🔇 CALLER';
        btn.className   = 'speech-toggle' + (enabled ? ' speech-on' : '');
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    function _buildSidebar(players) {
        const el = document.createElement('aside');
        el.id = 'sidebar';
        players.forEach(p => el.appendChild(_buildPlayerCard(p)));
        el.appendChild(_buildCheckoutPanel());
        return el;
    }

    // Ring geometry constants — shared by builder and updater
    var _RING_R  = 54;   // radius of the progress arc
    var _RING_CX = 64;   // SVG centre x
    var _RING_CY = 64;   // SVG centre y
    var _RING_CIRC = +(2 * Math.PI * _RING_R).toFixed(4);  // full circumference

    function _buildPlayerCard(player) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.id = `player-card-${player.id}`;

        const nameEl = document.createElement('div');
        nameEl.className = 'player-name';
        nameEl.textContent = player.name;
        card.appendChild(nameEl);

        // SVG progress ring wrapping the score
        const ns   = 'http://www.w3.org/2000/svg';
        const svg  = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 128 128');
        svg.setAttribute('class', 'score-ring-svg');
        svg.id = `ring-${player.id}`;
        svg.dataset.starting = player.score;   // 501 or 201

        // Track (background circle)
        const track = document.createElementNS(ns, 'circle');
        track.setAttribute('cx', _RING_CX);
        track.setAttribute('cy', _RING_CY);
        track.setAttribute('r',  _RING_R);
        track.setAttribute('class', 'score-ring-track');
        svg.appendChild(track);

        // Progress arc — starts full (dashoffset = 0)
        const arc = document.createElementNS(ns, 'circle');
        arc.setAttribute('cx', _RING_CX);
        arc.setAttribute('cy', _RING_CY);
        arc.setAttribute('r',  _RING_R);
        arc.setAttribute('class', 'score-ring-arc');
        arc.setAttribute('stroke-dasharray',  _RING_CIRC);
        arc.setAttribute('stroke-dashoffset', '0');
        arc.id = `ring-arc-${player.id}`;
        svg.appendChild(arc);

        // Dart icon — shown for the leg's first thrower
        const dartIcon = document.createElementNS(ns, 'text');
        dartIcon.setAttribute('x', _RING_CX);
        dartIcon.setAttribute('y', '38');
        dartIcon.setAttribute('dy', '0.35em');
        dartIcon.setAttribute('transform', 'rotate(90 ' + _RING_CX + ' ' + _RING_CY + ')');
        dartIcon.setAttribute('class', 'score-ring-dart');
        dartIcon.id = `ring-dart-${player.id}`;
        dartIcon.textContent = '🎯';
        dartIcon.style.display = 'none';
        svg.appendChild(dartIcon);

        // Score text inside the ring
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', _RING_CX);
        text.setAttribute('y', _RING_CY);
        text.setAttribute('dy', '0.32em');
        text.setAttribute('transform', 'rotate(90 ' + _RING_CX + ' ' + _RING_CY + ')');
        text.setAttribute('class', 'score-ring-text');
        text.id = `score-${player.id}`;
        text.textContent = player.score;
        svg.appendChild(text);

        card.appendChild(svg);

        const dartsEl = document.createElement('div');
        dartsEl.className = 'player-darts';
        dartsEl.id = `darts-${player.id}`;
        card.appendChild(dartsEl);

        const hintEl = document.createElement('div');
        hintEl.className = 'checkout-hint';
        hintEl.id = `hint-${player.id}`;
        card.appendChild(hintEl);

        return card;
    }

    function _buildBoard(callbacks) {
        const el = document.createElement('main');
        el.id = 'board';
        el.appendChild(_buildMultiplierTabs(callbacks.onMultiplier));
        el.appendChild(_buildSegmentGrid(callbacks.onSegment));
        el.appendChild(_buildBullRow(callbacks.onSegment));
        return el;
    }

    function _buildCheckoutPanel() {
        const panel = document.createElement('div');
        panel.id = 'checkout-panel';
        panel.className = 'checkout-panel hidden';

        const heading = document.createElement('div');
        heading.className = 'checkout-panel-heading';
        heading.textContent = 'CHECKOUT';
        panel.appendChild(heading);

        const routes = document.createElement('div');
        routes.id = 'checkout-routes';
        routes.className = 'checkout-routes';
        panel.appendChild(routes);

        return panel;
    }

    function _buildMultiplierTabs(onMultiplier) {
        const row = document.createElement('div');
        row.id = 'multiplier-tabs';
        [
            { label: 'Single', multiplier: 1, cls: 'active-single' },
            { label: 'Double', multiplier: 2, cls: 'active-double' },
            { label: 'Treble', multiplier: 3, cls: 'active-treble' },
        ].forEach(tab => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tab.label;
            btn.dataset.multiplier = tab.multiplier;
            btn.dataset.activeClass = tab.cls;
            _addTouchSafeListener(btn, () => onMultiplier(tab.multiplier, btn));
            row.appendChild(btn);
        });
        return row;
    }

    function _buildSegmentGrid(onSegment) {
        const grid = document.createElement('div');
        grid.id = 'segment-grid';
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].forEach(seg => {
            const btn = document.createElement('button');
            btn.className = 'seg-btn';
            btn.textContent = seg;
            btn.dataset.segment = seg;
            btn.addEventListener('click', () => onSegment(seg));
            grid.appendChild(btn);
        });
        return grid;
    }

    function _buildBullRow(onSegment) {
        const row = document.createElement('div');
        row.id = 'bull-row';
        const miss = document.createElement('button');
        miss.className = 'bull-btn miss-btn'; miss.textContent = 'MISS';
        miss.addEventListener('click', () => onSegment(0, 1));
        row.appendChild(miss);
        const outer = document.createElement('button');
        outer.className = 'bull-btn'; outer.innerHTML = 'OUTER<br><small>25</small>';
        outer.addEventListener('click', () => onSegment(25, 1));
        row.appendChild(outer);
        const bull = document.createElement('button');
        bull.className = 'bull-btn'; bull.innerHTML = 'BULL<br><small>50</small>';
        bull.addEventListener('click', () => onSegment(25, 2));
        row.appendChild(bull);
        row.appendChild(document.createElement('div'));
        return row;
    }

    function _buildStatusBar(callbacks) {
        // Wire up callbacks to buttons already created in _buildHeader
        const header = document.getElementById('header');
        if (header) {
            if (header._cancelBtn)  header._cancelBtn.addEventListener('click', callbacks.onCancel);
            if (header._restartBtn) header._restartBtn.addEventListener('click', callbacks.onRestart);
            if (header._undoBtn)    header._undoBtn.addEventListener('click', callbacks.onUndo);
            if (header._nextBtn)    header._nextBtn.addEventListener('click', callbacks.onNextPlayer);
        }

        // Status message bar (thin footer for contextual messages only)
        const el = document.createElement('footer');
        el.id = 'status-bar';

        const msg = document.createElement('span');
        msg.id = 'status-message';
        msg.textContent = 'SELECT MULTIPLIER THEN SEGMENT';
        el.appendChild(msg);

        return el;
    }

    function _buildToast() { const el = document.createElement('div'); el.id = 'toast'; return el; }
    function _buildLoading() { const el = document.createElement('div'); el.id = 'loading'; el.textContent = 'SYNCING...'; return el; }

    // ------------------------------------------------------------------
    // Update helpers
    // ------------------------------------------------------------------

    function setActivePlayer(playerId) {
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
        var _pc = document.getElementById('player-card-' + playerId); if (_pc) _pc.classList.add('active');
    }
    function setScore(playerId, score) {
        const el = document.getElementById(`score-${playerId}`);
        if (el) el.textContent = score;

        // Update progress ring if present
        const svg = document.getElementById(`ring-${playerId}`);
        const arc = document.getElementById(`ring-arc-${playerId}`);
        if (!svg || !arc) return;
        const starting = parseFloat(svg.dataset.starting) || 501;
        // fraction remaining: 1.0 = full ring, 0.0 = empty
        const fraction  = Math.max(0, Math.min(1, score / starting));
        const offset    = +(_RING_CIRC * (1 - fraction)).toFixed(4);
        arc.setAttribute('stroke-dashoffset', offset);
    }

    function setLegStarter(playerId) {
        // Show dart icon only on the leg starter's ring, hide on all others
        document.querySelectorAll('[id^="ring-dart-"]').forEach(function (el) {
            el.style.display = 'none';
        });
        var icon = document.getElementById('ring-dart-' + playerId);
        if (icon) icon.style.display = '';
    }

    function setStartingScore(playerId, starting) {
        // Call at the start of each new leg so the ring knows what 100% means
        const svg = document.getElementById(`ring-${playerId}`);
        if (svg) svg.dataset.starting = starting;
        setScore(playerId, starting);   // reset ring to full
    }
    function addDartPill(playerId, points, multiplier, segment) {
        const row = document.getElementById(`darts-${playerId}`);
        if (!row) return;
        const pill = document.createElement('span');
        pill.className = 'dart-pill';
        if (segment === 25) pill.classList.add('bull');
        else if (multiplier === 3) pill.classList.add('treble');
        else if (multiplier === 2) pill.classList.add('double');
        pill.textContent = points;
        row.appendChild(pill);
    }
    function clearDartPills(playerId) {
        const row = document.getElementById(`darts-${playerId}`);
        if (row) row.innerHTML = '';
    }
    function setCheckoutHint(playerId, suggestion) {
        const el = document.getElementById(`hint-${playerId}`);
        if (el) el.textContent = suggestion ? suggestion.join(' → ') : '';
    }

    /**
     * Update the checkout suggestion panel on the board.
     * @param {number|null} score     — current player's score (null to hide)
     * @param {boolean}     doubleOut — true = double-out game rules
     */
    function setCheckoutPanel(score, doubleOut) {
        const panel  = document.getElementById('checkout-panel');
        const routes = document.getElementById('checkout-routes');
        if (!panel || !routes) return;

        // Hide if score is out of range or CHECKOUT module not available
        if (score === null || score > 170 || score < 1 || typeof CHECKOUT === 'undefined') {
            panel.classList.add('hidden');
            return;
        }

        const suggestions = CHECKOUT.suggest(score, doubleOut);

        // In double-out mode only show double route; in single-out show both
        // Always show both so the player can compare, but label clearly
        const doubleRoute = suggestions.double;
        const singleRoute = suggestions.single;

        // If neither route exists, hide the panel
        if (!doubleRoute && !singleRoute) {
            panel.classList.add('hidden');
            return;
        }

        routes.innerHTML = '';

        function buildRouteRow(label, route, isActive) {
            const row = document.createElement('div');
            row.className = 'checkout-route-row' + (isActive ? ' route-active' : ' route-dim');

            const lbl = document.createElement('span');
            lbl.className = 'checkout-route-label';
            lbl.textContent = label;
            row.appendChild(lbl);

            const darts = document.createElement('span');
            darts.className = 'checkout-route-darts';

            if (route) {
                route.forEach(function(dart, i) {
                    const chip = document.createElement('span');
                    chip.className = 'checkout-dart-chip';
                    chip.textContent = CHECKOUT.formatDart(dart);
                    darts.appendChild(chip);
                    if (i < route.length - 1) {
                        const arrow = document.createElement('span');
                        arrow.className = 'checkout-arrow';
                        arrow.textContent = '→';
                        darts.appendChild(arrow);
                    }
                });
            } else {
                const na = document.createElement('span');
                na.className = 'checkout-na';
                na.textContent = 'NO ROUTE';
                darts.appendChild(na);
            }

            row.appendChild(darts);
            return row;
        }

        // Double-out route (active/required in double-out game)
        routes.appendChild(buildRouteRow('D-OUT', doubleRoute, doubleOut));

        // Single-out route (active/required in single-out game)
        routes.appendChild(buildRouteRow('S-OUT', singleRoute, !doubleOut));

        panel.classList.remove('hidden');
    }
    function flashCard(playerId, type) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        card.classList.add(type);
        setTimeout(() => card.classList.remove(type), 1200);
    }
    function setMultiplierTab(multiplier) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active-single', 'active-double', 'active-treble'));
        const tab = document.querySelector(`.tab-btn[data-multiplier="${multiplier}"]`);
        if (tab) tab.classList.add(tab.dataset.activeClass);
        document.body.dataset.multiplier = multiplier;
    }
    function setNextPlayerEnabled(enabled) {
        const btn = document.getElementById('btn-next');
        if (btn) btn.disabled = !enabled;
    }
    function setStatus(text, type = 'normal') {
        const el = document.getElementById('status-message');
        if (!el) return;
        el.textContent = text;
        el.className = type === 'normal' ? '' : type;
    }
    let _toastTimer = null;
    function showToast(text, type = 'info', duration = 2000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = text;
        toast.className = `visible ${type}`;
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { toast.className = ''; }, duration);
    }
    function setLoading(visible) { var _ld = document.getElementById('loading'); if (_ld) _ld.classList.toggle('visible', visible); }
    function setMatchInfo(text) { const el = document.getElementById('match-info'); if (el) el.textContent = text; }

    function setUndoEnabled(enabled) {
        const btn = document.getElementById('btn-undo');
        if (btn) btn.disabled = !enabled;
    }

    function updatePlayerSetLegs(playerId, sets, legs) {
        const card = document.getElementById(`player-card-${playerId}`);
        if (!card) return;
        let tally = card.querySelector('.player-tally');
        if (!tally) {
            tally = document.createElement('div');
            tally.className = 'player-tally';
            card.appendChild(tally);
        }
        tally.textContent = `${sets}S / ${legs}L`;
    }

    function _esc(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Show a confirmation modal with a title, message, and confirm/cancel buttons.
     *
     * @param {object}   opts
     * @param {string}   opts.title        - Short heading e.g. "CANCEL MATCH?"
     * @param {string}   opts.message      - Explanatory sentence
     * @param {string}   opts.confirmLabel - Text on the confirm button e.g. "YES, CANCEL"
     * @param {string}   opts.confirmClass - Extra CSS class for confirm button e.g. "btn-danger"
     * @param {Function} opts.onConfirm    - Called if user confirms
     */
    function showConfirmModal(opts) {
        var existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'confirm-modal';
        overlay.className = 'modal-overlay';

        var box = document.createElement('div');
        box.className = 'modal-box confirm-box';

        var titleEl = document.createElement('div');
        titleEl.className = 'modal-title confirm-title';
        titleEl.textContent = opts.title;

        var msgEl = document.createElement('div');
        msgEl.className = 'confirm-message';
        msgEl.textContent = opts.message;

        var btnRow = document.createElement('div');
        btnRow.className = 'confirm-btn-row';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'confirm-btn confirm-btn-cancel';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'NO, GO BACK';
        cancelBtn.addEventListener('click', function() { overlay.remove(); });

        var confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-btn ' + (opts.confirmClass || 'confirm-btn-ok');
        confirmBtn.type = 'button';
        confirmBtn.textContent = opts.confirmLabel || 'CONFIRM';
        confirmBtn.addEventListener('click', function() {
            overlay.remove();
            opts.onConfirm();
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        box.appendChild(titleEl);
        box.appendChild(msgEl);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ── Shared setup screen header ──
    function _appendSetupHeader(inner, gameTitle) {
        const logo = document.createElement('div');
        logo.className = 'setup-logo';
        logo.textContent = 'DARTS 501';
        inner.appendChild(logo);

        const sub = document.createElement('div');
        sub.className = 'setup-game-name';
        sub.textContent = gameTitle.toUpperCase();
        inner.appendChild(sub);
    }

    function renderShanghaiPlayerSlots(existingPlayers, count, container, difficulty) {
        container.innerHTML = '';
        var grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (var i = 0; i < count; i++) {
            var isCpu = (count === 1 && i === 1);
            var slot = _buildPlayerSlot(i, count, existingPlayers, isCpu);
            if (isCpu && difficulty) slot.dataset.difficulty = difficulty;
            grid.appendChild(slot);
        }
        // For 1-player mode, add a CPU slot
        if (count === 1) {
            var cpuSlot = _buildCpuSlot(difficulty || 'medium', existingPlayers, container);
            grid.appendChild(cpuSlot);
        }
        container.appendChild(grid);
        setTimeout(function() {
            var fi = container.querySelector('.name-input');
            if (fi) fi.focus();
        }, 150);
    }

    function _buildCpuSlot(difficulty, existingPlayers, container) {
        var label = (typeof CPU !== 'undefined' && CPU.LABELS) ? (CPU.LABELS[difficulty] || difficulty) : difficulty;
        var slot = document.createElement('div');
        slot.className = 'name-slot cpu-slot';
        slot.dataset.mode       = 'cpu';
        slot.dataset.isCpu      = 'true';
        slot.dataset.difficulty = difficulty;
        slot.innerHTML =
            '<div class="name-label">OPPONENT</div>' +
            '<div class="cpu-badge">🤖 CPU</div>' +
            '<div class="cpu-difficulty">' + _esc(label) + '</div>' +
            '<button class="cpu-change-btn" type="button">CHANGE</button>';
        slot.querySelector('.cpu-change-btn').addEventListener('click', function () {
            _showDifficultyModal(function (newDifficulty) {
                renderShanghaiPlayerSlots(existingPlayers, 1, container, newDifficulty);
            });
        });
        return slot;
    }

    function collectShanghaiPlayers(container) {
        var slots = container.querySelectorAll('.name-slot');
        if (!slots.length) { showToast('NO PLAYERS SET UP', 'bust', 2000); return null; }
        var players = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.dataset.isCpu === 'true' || slot.classList.contains('cpu-slot')) {
                players.push({
                    id:         null,
                    name:       'CPU',
                    isCpu:      true,
                    difficulty: slot.dataset.difficulty || 'medium',
                    mode:       'cpu',
                });
                continue;
            }
            // Check if using existing player select
            var sel  = slot.querySelector('.name-select');
            var inp  = slot.querySelector('.name-input');
            var mode = slot.dataset.mode || 'new';
            if (mode === 'existing' && sel && sel.value) {
                var opt = sel.options[sel.selectedIndex];
                players.push({ id: parseInt(sel.value, 10), name: opt.text, isCpu: false, mode: 'existing' });
            } else if (inp && inp.value.trim()) {
                players.push({ id: null, name: inp.value.trim(), isCpu: false, mode: 'new' });
            } else {
                showToast('ENTER ALL PLAYER NAMES', 'bust', 2000);
                return null;
            }
        }
        if (players.length < 2) { showToast('NEED AT LEAST 2 PLAYERS', 'bust', 2000); return null; }
        return players;
    }

    function renderBermudaPlayerSlots(existingPlayers, count, container, difficulty) {
        container.innerHTML = '';
        var grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (var i = 0; i < count; i++) {
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers, false));
        }
        if (count === 1) {
            var cpuSlot = document.createElement('div');
            cpuSlot.className = 'name-slot cpu-slot';
            cpuSlot.dataset.mode       = 'cpu';
            cpuSlot.dataset.isCpu      = 'true';
            cpuSlot.dataset.difficulty = difficulty || 'medium';
            var cpuLabel = (typeof CPU !== 'undefined' && CPU.LABELS)
                ? (CPU.LABELS[difficulty] || difficulty) : difficulty;
            cpuSlot.innerHTML =
                '<div class="name-label">OPPONENT</div>' +
                '<div class="cpu-badge">🤖 CPU</div>' +
                '<div class="cpu-difficulty">' + _esc(cpuLabel) + '</div>' +
                '<button class="cpu-change-btn" type="button">CHANGE</button>';
            cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', function () {
                _showDifficultyModal(function (newDifficulty) {
                    renderBermudaPlayerSlots(existingPlayers, 1, container, newDifficulty);
                });
            });
            grid.appendChild(cpuSlot);
        }
        container.appendChild(grid);
        setTimeout(function () {
            var fi = container.querySelector('.name-input');
            if (fi) fi.focus();
        }, 150);
    }

    function collectBermudaPlayers(container) {
        var slots = container.querySelectorAll('.name-slot');
        if (!slots.length) { showToast('NO PLAYERS SET UP', 'bust', 2000); return null; }
        var players = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.dataset.isCpu === 'true' || slot.classList.contains('cpu-slot')) {
                players.push({ id: null, name: 'CPU', isCpu: true,
                               difficulty: slot.dataset.difficulty || 'medium', mode: 'cpu' });
                continue;
            }
            var sel  = slot.querySelector('.name-select');
            var inp  = slot.querySelector('.name-input');
            var mode = slot.dataset.mode || 'new';
            if (mode === 'existing' && sel && sel.value) {
                players.push({ id: parseInt(sel.value, 10),
                               name: sel.options[sel.selectedIndex].textContent,
                               isCpu: false, mode: 'existing' });
            } else if (inp) {
                var name = inp.value.trim();
                if (!name) { showToast('PLEASE ENTER ALL PLAYER NAMES', 'bust', 2000); return null; }
                players.push({ mode: 'new', name: name, isCpu: false });
            }
        }
        var names = players.filter(function (p) { return !p.isCpu; }).map(function (p) { return p.name.toLowerCase(); });
        var unique = names.filter(function (n, i) { return names.indexOf(n) === i; });
        if (unique.length !== names.length) { showToast('PLAYER NAMES MUST BE UNIQUE', 'bust', 2000); return null; }
        return players;
    }

    function renderNineLivesPlayerSlots(existingPlayers, count, container, difficulty) {
        container.innerHTML = '';
        var grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (var i = 0; i < count; i++) {
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers, false));
        }
        if (count === 1) {
            var cpuSlot = document.createElement('div');
            cpuSlot.className = 'name-slot cpu-slot';
            cpuSlot.dataset.mode       = 'cpu';
            cpuSlot.dataset.isCpu      = 'true';
            cpuSlot.dataset.difficulty = difficulty || 'medium';
            var cpuLabel = (typeof CPU !== 'undefined' && CPU.LABELS)
                ? (CPU.LABELS[difficulty] || difficulty) : difficulty;
            cpuSlot.innerHTML =
                '<div class="name-label">OPPONENT</div>' +
                '<div class="cpu-badge">🤖 CPU</div>' +
                '<div class="cpu-difficulty">' + _esc(cpuLabel) + '</div>' +
                '<button class="cpu-change-btn" type="button">CHANGE</button>';
            cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', function () {
                _showDifficultyModal(function (newDifficulty) {
                    renderNineLivesPlayerSlots(existingPlayers, 1, container, newDifficulty);
                });
            });
            grid.appendChild(cpuSlot);
        }
        container.appendChild(grid);
        setTimeout(function () {
            var fi = container.querySelector('.name-input');
            if (fi) fi.focus();
        }, 150);
    }

    function collectNineLivesPlayers(container) {
        var slots = container.querySelectorAll('.name-slot');
        if (!slots.length) { showToast('NO PLAYERS SET UP', 'bust', 2000); return null; }
        var players = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.dataset.isCpu === 'true' || slot.classList.contains('cpu-slot')) {
                players.push({ id: null, name: 'CPU', isCpu: true,
                               difficulty: slot.dataset.difficulty || 'medium', mode: 'cpu' });
                continue;
            }
            var sel  = slot.querySelector('.name-select');
            var inp  = slot.querySelector('.name-input');
            var mode = slot.dataset.mode || 'new';
            if (mode === 'existing' && sel && sel.value) {
                players.push({ id: parseInt(sel.value, 10),
                               name: sel.options[sel.selectedIndex].textContent,
                               isCpu: false, mode: 'existing' });
            } else if (inp) {
                var name = inp.value.trim();
                if (!name) { showToast('PLEASE ENTER ALL PLAYER NAMES', 'bust', 2000); return null; }
                players.push({ mode: 'new', name: name, isCpu: false });
            }
        }
        var names = players.filter(function (p) { return !p.isCpu; }).map(function (p) { return p.name.toLowerCase(); });
        var unique = names.filter(function (n, i) { return names.indexOf(n) === i; });
        if (unique.length !== names.length) { showToast('PLAYER NAMES MUST BE UNIQUE', 'bust', 2000); return null; }
        return players;
    }

    function renderRace1000PlayerSlots(existingPlayers, count, container, difficulty) {
        container.innerHTML = '';
        var grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';
        for (var i = 0; i < count; i++) {
            var isCpu = (count === 1 && i === 1);
            var slot = _buildPlayerSlot(i, count, existingPlayers, isCpu);
            if (isCpu && difficulty) slot.dataset.difficulty = difficulty;
            grid.appendChild(slot);
        }
        if (count === 1) {
            var cpuSlot = document.createElement('div');
            cpuSlot.className = 'name-slot cpu-slot';
            cpuSlot.dataset.mode       = 'cpu';
            cpuSlot.dataset.isCpu      = 'true';
            cpuSlot.dataset.difficulty = difficulty || 'medium';
            var cpuLabel = (typeof CPU !== 'undefined' && CPU.LABELS)
                ? (CPU.LABELS[difficulty] || difficulty) : difficulty;
            cpuSlot.innerHTML =
                '<div class="name-label">OPPONENT</div>' +
                '<div class="cpu-badge">🤖 CPU</div>' +
                '<div class="cpu-difficulty">' + _esc(cpuLabel) + '</div>' +
                '<button class="cpu-change-btn" type="button">CHANGE</button>';
            cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', function () {
                _showDifficultyModal(function (newDifficulty) {
                    renderRace1000PlayerSlots(existingPlayers, 1, container, newDifficulty);
                });
            });
            grid.appendChild(cpuSlot);
        }
        container.appendChild(grid);
        setTimeout(function() {
            var fi = container.querySelector('.name-input');
            if (fi) fi.focus();
        }, 150);
    }

    function collectRace1000Players(container) {
        var slots = container.querySelectorAll('.name-slot');
        if (!slots.length) { showToast('NO PLAYERS SET UP', 'bust', 2000); return null; }
        var players = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.dataset.isCpu === 'true' || slot.classList.contains('cpu-slot')) {
                players.push({ id: null, name: 'CPU', isCpu: true,
                               difficulty: slot.dataset.difficulty || 'medium', mode: 'cpu' });
                continue;
            }
            var sel  = slot.querySelector('.name-select');
            var inp  = slot.querySelector('.name-input');
            var mode = slot.dataset.mode || 'new';
            if (mode === 'existing' && sel && sel.value) {
                players.push({ id: parseInt(sel.value, 10),
                               name: sel.options[sel.selectedIndex].textContent,
                               isCpu: false, mode: 'existing' });
            } else if (inp) {
                var name = inp.value.trim();
                if (!name) { showToast('PLEASE ENTER ALL PLAYER NAMES', 'bust', 2000); return null; }
                players.push({ mode: 'new', name: name, isCpu: false });
            }
        }
        var names = players.filter(function(p) { return !p.isCpu; }).map(function(p) { return p.name.toLowerCase(); });
        var unique = names.filter(function(n, i) { return names.indexOf(n) === i; });
        if (unique.length !== names.length) { showToast('PLAYER NAMES MUST BE UNIQUE', 'bust', 2000); return null; }
        return players;
    }

    function renderCricketPlayerSlots(existingPlayers, count, container, difficulty) {
        container.innerHTML = '';
        var grid = document.createElement('div');
        grid.id = 'setup-names-grid';
        grid.style.gridTemplateColumns = count <= 2 ? '1fr 1fr' : 'repeat(4, 1fr)';

        // Human slot(s)
        for (var i = 0; i < count; i++) {
            grid.appendChild(_buildPlayerSlot(i, count, existingPlayers, false));
        }

        // CPU slot when 1 vs CPU
        if (count === 1) {
            var cpuDiff  = difficulty || 'medium';
            var cpuLabel = (typeof CPU !== 'undefined' && CPU.LABELS)
                ? (CPU.LABELS[cpuDiff] || cpuDiff) : cpuDiff;
            var cpuSlot  = document.createElement('div');
            cpuSlot.className        = 'name-slot cpu-slot';
            cpuSlot.dataset.mode       = 'cpu';
            cpuSlot.dataset.isCpu      = 'true';
            cpuSlot.dataset.difficulty = cpuDiff;
            cpuSlot.innerHTML =
                '<div class="name-label">OPPONENT</div>' +
                '<div class="cpu-badge">\uD83E\uDD16 CPU</div>' +
                '<div class="cpu-difficulty">' + _esc(cpuLabel) + '</div>' +
                '<button class="cpu-change-btn" type="button">CHANGE</button>';
            cpuSlot.querySelector('.cpu-change-btn').addEventListener('click', function() {
                _showDifficultyModal(function(newDifficulty) {
                    renderCricketPlayerSlots(existingPlayers, 1, container, newDifficulty);
                });
            });
            grid.appendChild(cpuSlot);
        }

        container.appendChild(grid);
        setTimeout(function() {
            var fi = container.querySelector('.name-input');
            if (fi) fi.focus();
        }, 150);
    }

    function collectCricketPlayers(container) {
        var slots = container.querySelectorAll('.name-slot');
        if (!slots.length) { showToast('NO PLAYERS SET UP', 'bust', 2000); return null; }
        var players = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (slot.dataset.isCpu === 'true' || slot.classList.contains('cpu-slot')) {
                players.push({ id: null, name: 'CPU', isCpu: true,
                               difficulty: slot.dataset.difficulty || 'medium', mode: 'cpu' });
                continue;
            }
            var sel  = slot.querySelector('.name-select');
            var inp  = slot.querySelector('.name-input');
            var mode = slot.dataset.mode || 'new';
            if (mode === 'existing' && sel && sel.value) {
                players.push({ id: parseInt(sel.value, 10),
                               name: sel.options[sel.selectedIndex].textContent,
                               isCpu: false, mode: 'existing' });
            } else if (inp) {
                var name = inp.value.trim();
                if (!name) { showToast('PLEASE ENTER ALL PLAYER NAMES', 'bust', 2000); return null; }
                players.push({ mode: 'new', name: name, isCpu: false });
            }
        }
        var names  = players.filter(function(p) { return !p.isCpu; }).map(function(p) { return p.name.toLowerCase(); });
        var unique = names.filter(function(n, i) { return names.indexOf(n) === i; });
        if (unique.length !== names.length) { showToast('PLAYER NAMES MUST BE UNIQUE', 'bust', 2000); return null; }
        return players;
    }

    // ─────────────────────────────────────────────────────────────────
    // Rules modal
    // ─────────────────────────────────────────────────────────────────

    var RULES_CONTENT = {
        '501': {
            title: '501',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Start with 501 points and reduce your score to exactly zero. The final dart must land in a Double or the Bullseye (inner bull counts as a double).'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Each player throws 3 darts per turn. The total scored is deducted from the running total.'
                },
                {
                    heading: 'Doubles & Trebles',
                    body: 'The narrow outer ring scores double the segment value. The narrow inner ring scores triple the segment value. Outer bull = 25 pts. Inner bull (Bullseye) = 50 pts and counts as a double for checkout.'
                },
                {
                    heading: 'Bust',
                    body: 'If your score would drop below zero, to exactly 1, or you reach zero without a double finish, it is a BUST. Your score returns to what it was at the start of that turn and play passes to the next player.'
                },
                {
                    heading: 'Checkout',
                    body: 'To win a leg you must reach exactly zero with your final dart landing on a Double (or inner bull). Common finishes include D20 (40), D16 (32), and Bull (50). The highest possible checkout is T20-T20-Bull for 170.'
                },
                {
                    heading: 'Sets & Legs',
                    body: 'A match is decided by legs and sets. Win the required number of legs to take a set, and the required number of sets to win the match. Configuration is chosen at match setup.'
                },
                {
                    heading: 'CPU Opponent',
                    body: 'Three difficulty levels are available: Warm-Up Dummy (easy), Pub Regular (medium), and League Night (hard). Each level affects accuracy on trebles, doubles, and target selection.'
                },
            ]
        },
        '201': {
            title: '201',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Identical to 501 but starting from 201 points. A shorter, faster game — typically decided in a single leg.'
                },
                {
                    heading: 'Double Start (optional)',
                    body: 'If Double Start is selected at setup, you must hit a Double before any score counts. Until a double is hit, all darts are ignored.'
                },
                {
                    heading: 'Checkout',
                    body: 'Same as 501 — reach exactly zero, last dart must be a Double or inner Bull. The lower starting score means the game moves quickly and checkout opportunities arrive early.'
                },
                {
                    heading: 'Bust',
                    body: 'Same rules as 501 apply — going below zero, hitting 1, or failing to finish on a double are all busts.'
                },
            ]
        },
        'cricket': {
            title: 'Cricket',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Be the first player to close all 7 numbers (15, 16, 17, 18, 19, 20, and Bull) while having a score equal to or greater than all opponents.'
                },
                {
                    heading: 'Scoring Numbers',
                    body: 'Only the numbers 15 through 20 and the Bull are in play. Hitting any other number has no effect.'
                },
                {
                    heading: 'Closing a Number',
                    body: 'A number requires 3 marks to close. A single hit = 1 mark, a double = 2 marks, a treble = 3 marks (closes in one throw). Outer Bull = 1 mark, Inner Bull = 2 marks.'
                },
                {
                    heading: 'Scoring Points',
                    body: 'Once you have closed a number (3 marks), any additional hits on that number score points — but only while at least one opponent still has it open. Single = face value, double = 2×, treble = 3×.'
                },
                {
                    heading: 'Win Condition',
                    body: 'You win when all 7 numbers are closed AND your point total is greater than or equal to every opponent\'s score. You can\'t win while trailing on points, even if you\'ve closed everything.'
                },
                {
                    heading: 'Strategy',
                    body: 'Close numbers quickly to stop opponents scoring on them, and build points on numbers you\'ve closed that opponents haven\'t. The Bull is often the key battleground.'
                },
            ]
        },
        'race1000': {
            title: 'Race to 1000',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Be the first player to accumulate 1,000 points or more. Unlike 01 games, there is no double-out — the first to reach the target wins.'
                },
                {
                    heading: 'Gameplay',
                    body: 'Players take turns throwing 3 darts. Points are added to a running total each turn. All 3 darts must be thrown before the turn ends.'
                },
                {
                    heading: '20s Only Variant',
                    body: 'Only the 20 segment scores. Single 20 = 20 pts, Double 20 = 40 pts, Treble 20 = 60 pts. Any other segment scores 0.'
                },
                {
                    heading: 'All Numbers Variant',
                    body: 'Any segment on the board scores its face value (segment × multiplier). For example, Treble 19 = 57 pts, Double 7 = 14 pts.'
                },
                {
                    heading: 'Winning',
                    body: 'A player wins by reaching 1,000+ points after completing all 3 darts of their turn. If multiple players reach 1,000 in the same round, the player with the highest score wins.'
                },
            ]
        },
        'bermuda': {
            title: 'Bermuda Triangle',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Score the most points after 13 rounds. Each round targets a specific number, ring, or bull in this order: 12, 13, 14, Any Double, 15, 16, 17, Any Triple, 18, 19, 20, Single Bull, Double Bull.'
                },
                {
                    heading: 'Scoring — Number Rounds',
                    body: 'In rounds targeting a number (12 through 20), only hits on that exact number count. A single scores face value, a double scores double, a treble scores triple. For example, treble 14 in round 3 scores 42 points.'
                },
                {
                    heading: 'Scoring — Any Double Round',
                    body: 'Any double (except the bull) scores points. A double 19 scores 38 points, a double 5 scores 10 points. Singles and trebles score nothing this round.'
                },
                {
                    heading: 'Scoring — Any Triple Round',
                    body: 'Any treble scores points. A treble 20 scores 60 points, a treble 7 scores 21 points. Singles and doubles score nothing this round.'
                },
                {
                    heading: 'Scoring — Bull Rounds',
                    body: 'Round 12 targets the Outer Bull (25 points). Only the outer bull scores. Round 13 targets the Double Bull (50 points). Only the inner bull scores.'
                },
                {
                    heading: 'Halving',
                    body: 'If a player scores zero points with all three darts in a round, their current total is halved (rounded down). The minimum score is 0.'
                },
                {
                    heading: 'Winning',
                    body: 'All players must complete all 13 rounds. The player with the highest total score wins. Tied scores share the win.'
                },
            ]
        },
        'nine_lives': {
            title: 'Nine Lives',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Be the last player standing, or be the first to hit all numbers from 1 to 20 in order.'
                },
                {
                    heading: 'Setup',
                    body: 'Each player starts with 9 lives. Turn order is randomised. Each player independently tracks their own current target number, starting at 1.'
                },
                {
                    heading: 'Gameplay',
                    body: 'On your turn, throw 3 darts. Your goal is to hit your current target number — any multiplier counts (single, double, or treble). If you hit it, your target advances to the next number.'
                },
                {
                    heading: 'Losing a Life',
                    body: 'If you do not hit your target number with any of your 3 darts, you lose one life. Players are eliminated when they run out of lives, but finish the turn first.'
                },
                {
                    heading: 'Winning',
                    body: 'The game ends when all other players are eliminated, or when a player hits number 20 — completing the sequence. That player wins instantly.'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Throw 3 darts, then press NEXT to submit. Undo is available within the current turn. The board locks after the 3rd dart or on completing number 20.'
                },
            ]
        },
        'killer': {
            title: 'Killer Darts',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Be the last player standing. Eliminate all opponents by hitting the double (or treble in the Triples variant) of their assigned number.'
                },
                {
                    heading: 'Assigned Numbers',
                    body: 'Each player is randomly assigned a unique number between 1 and 20. Numbers are shown on the scoreboard next to each player\u2019s name. Turn order is also randomised at the start.'
                },
                {
                    heading: 'Becoming a Killer',
                    body: 'Your first goal is to score 3 hits on your own number\u2019s double (or treble). Single = 1 hit, Double = 2 hits (doubles variant), Treble = 3 hits. Once you reach 3 hits you become a Killer \u2014 marked with a K on the scoreboard.'
                },
                {
                    heading: 'Eliminating Opponents',
                    body: 'Once a Killer, aim for opponent doubles (or trebles). Each hit removes one life from that opponent. A player is eliminated when all 3 lives are gone and their number is hit again. You can eliminate multiple opponents in a single turn.'
                },
                {
                    heading: 'Self-Hits',
                    body: 'If a Killer hits their own double (or treble), they lose a life. This can eliminate themselves, so be careful!'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Each player throws 3 darts per turn. After the 3rd dart the board locks. Press NEXT to submit scores and pass to the next active player. Undo is available within the current turn.'
                },
                {
                    heading: 'Winning',
                    body: 'The last player with any lives remaining wins. If only one player survives, the game ends immediately — even mid-turn.'
                },
            ]
        },
        'warmup': {
            title: 'Warm Up Routine',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Train all four compass points of the board — North (20), East (11), South (3), West (6) — spending 5 minutes on each. Score as many points as possible and beat your personal high score.'
                },
                {
                    heading: 'Segment Order',
                    body: 'Segments are played in compass order: N→E→S→W (20→11→3→6). You cannot skip or reorder segments.'
                },
                {
                    heading: 'Scoring',
                    body: 'A dart landing in the target segment (single, double, or treble) scores 2 points. A dart landing in either neighbouring segment (either side of the target on the board) scores 1 point regardless of multiplier. Any other hit scores 0 points.'
                },
                {
                    heading: 'Neighbours',
                    body: 'North (20): neighbours are 1 and 5. East (11): neighbours are 14 and 8. South (3): neighbours are 17 and 19. West (6): neighbours are 13 and 10. Neighbour segments are highlighted on the board.'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Throw 3 darts per turn. After the 3rd dart the board locks and the caller announces the points scored that turn. Press NEXT to continue throwing. Undo is available within the current turn of 3 darts.'
                },
                {
                    heading: 'Timer',
                    body: 'Each segment has a 5-minute timer. A 30-second warning is called before the segment ends. When time expires the game automatically advances to the next segment.'
                },
                {
                    heading: 'High Score',
                    body: 'Your total score across all four segments is saved to the database. At the start the caller announces your current high score. At the end the caller announces your total and whether you set a new high score.'
                },
            ]
        },
        'baseball': {
            title: 'Baseball Darts',
            sections: [
                { heading: 'Objective',
                  body: 'Score as many runs as possible across 9 innings and beat your personal high score. Each inning has a target number — hit it to score runs, miss it to earn outs.' },
                { heading: 'Target Numbers',
                  body: 'The game starts on a random number between 1 and 11. Each subsequent inning increments by 1 (e.g. start 8 → 9 → 10 ... → 16). After 9 innings your final target will be at most 20.' },
                { heading: 'Scoring Runs',
                  body: 'Throw all 3 darts at the current target number. A Single scores 1 run, a Double scores 2 runs, and a Treble scores 3 runs. Any multiplier on the target number counts.' },
                { heading: 'Outs',
                  body: 'Any dart that does not hit the target number — including complete misses, Outer Bull, and Bull — counts as 1 out. Three outs end the inning regardless of how many runs were scored.' },
                { heading: 'Turn Structure',
                  body: 'You always throw all 3 darts in an inning. After the 3rd dart press NEXT to advance to the next inning. You can undo a mis-entered dart before pressing NEXT.' },
                { heading: 'High Score',
                  body: 'Your best score is saved to the database against your player profile. The caller announces whether you beat your high score at the end of each completed game.' },
            ]
        },
        'bobs27': {
            title: "Bob's 27",
            sections: [
                { heading: 'Objective',
                  body: 'A doubles ladder game. Start with 27 points and work your way from Double 1 up to Double Bull. Your score rises when you hit and falls when you miss.' },
                { heading: 'Scoring',
                  body: 'Each round you throw at the current target double. Hit it and you add the double\'s value to your score (e.g. D3 = +6). Miss and that same value is subtracted (D3 = -6). You must hit the double before moving on — misses keep you on the same double.' },
                { heading: 'Sequence',
                  body: 'D1 → D2 → D3 ... → D20 → D-Bull. Three darts per round. Any dart that hits the correct double advances you; the remaining darts in that round are not thrown.' },
                { heading: 'Game Over',
                  body: 'If your score reaches zero or goes negative, the game ends immediately. Your final double reached and score are shown on the summary screen.' },
                { heading: 'Winning',
                  body: 'Successfully hit all 21 doubles including D-Bull to complete the ladder. A perfect game finishes with a score well above 27.' },
            ]
        },
        'checkout121': {
            title: '121 Checkouts',
            sections: [
                { heading: 'Objective',
                  body: 'Practice high checkouts under pressure. Start at 121 and attempt to finish in a set number of darts using a double to check out, just like in 501.' },
                { heading: 'Turn Structure',
                  body: 'You have 9 (or 12) darts to finish each target. Darts are entered 3 at a time. After each set of 3, press NEXT to continue or wait for the board to auto-advance when darts are exhausted.' },
                { heading: 'Bust Rules',
                  body: 'Going below 2, hitting exactly 1, or finishing without a double is a bust. Your score resets to what it was at the start of that visit (set of 3 darts).' },
                { heading: 'Progression',
                  body: 'Check out successfully and the target increases by 1 (121 → 122 → 123 ...). Fail to finish in the allotted darts and the target drops by 1, with a minimum of 121.' },
                { heading: 'Session End',
                  body: 'The session ends when the timer runs out or you press END. The summary shows your highest checkout reached, total attempts, successes, and hit rate.' },
            ]
        },
        'practice': {
            title: 'Practice',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Sharpen your accuracy across a timed session. Choose Free Throw mode to aim at anything, or select a specific target to focus your training.'
                },
                {
                    heading: 'Free Throw Mode',
                    body: 'Throw at any segment you like. The session tracks your 3-dart average, best segment, and builds a heatmap of where your darts land.'
                },
                {
                    heading: 'Target Mode',
                    body: 'Choose a specific target — a single segment, doubles, trebles, checkout doubles, or Around the Clock. The session tracks how often you hit the target and your hit rate percentage.'
                },
                {
                    heading: 'Around the Clock',
                    body: 'Hit segments 1 through 20 in order. Any multiplier of the correct number advances the clock. The session records how many you complete in the time.'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Darts are entered in groups of 3. Press NEXT after each set of 3 to record the turn and move on. Use UNDO to correct the last dart entered.'
                },
                {
                    heading: 'Session End',
                    body: 'When the timer runs out (or you press END), a summary is shown with your stats and a heatmap of the session\'s throws.'
                },
            ]
        },
        'shanghai': {
            title: 'Shanghai',
            sections: [
                {
                    heading: 'Objective',
                    body: 'Score the most points over 7 or 20 rounds. In each round, only darts landing on that round\'s target number count.'
                },
                {
                    heading: 'Round Targets',
                    body: 'In the 20-round game, Round 1 targets 1, Round 2 targets 2, and so on up to 20. In the 7-round game, 7 target numbers are chosen at random from 1–20 at the start of each match — the sequence is unique every game. Darts hitting any number other than the current target score zero, but are not a penalty.'
                },
                {
                    heading: 'Scoring',
                    body: 'Single = 1× the target number. Double = 2×. Treble = 3×. For example, in Round 5: single scores 5, double scores 10, treble scores 15.'
                },
                {
                    heading: 'Shanghai — Instant Win',
                    body: 'If you hit a Single, Double, AND Treble of the target number all in the same round (in any order), that is a SHANGHAI — an instant win regardless of the current scores.'
                },
                {
                    heading: 'Turn Structure',
                    body: 'Each player throws up to 3 darts per round. All players complete each round before moving to the next. There is no bust — a zero-score round simply scores zero.'
                },
                {
                    heading: 'Winning',
                    body: 'After all rounds, the player with the highest total score wins. If scores are tied, a sudden-death Bull tiebreak is played — each tied player throws one dart at the bull. Highest score (inner bull 50 beats outer bull 25) wins. If still tied, repeat until broken.'
                },
                {
                    heading: 'CPU Opponent',
                    body: 'The CPU always aims for the treble of the current target number. Difficulty affects accuracy — easy misses frequently, medium is competitive, hard rarely misses.'
                },
            ]
        },
    };

    function showRulesModal(gameType) {
        var existing = document.getElementById('rules-modal');
        if (existing) existing.remove();

        var key = (gameType || '501').toLowerCase();
        var rules = RULES_CONTENT[key] || RULES_CONTENT['501'];

        var overlay = document.createElement('div');
        overlay.id = 'rules-modal';
        overlay.className = 'modal-overlay rules-overlay';
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.remove();
        });

        var box = document.createElement('div');
        box.className = 'modal-box rules-box';

        // Header
        var titleEl = document.createElement('div');
        titleEl.className = 'rules-title';
        titleEl.textContent = rules.title + ' — HOW TO PLAY';
        box.appendChild(titleEl);

        // Scrollable content
        var body = document.createElement('div');
        body.className = 'rules-body';

        rules.sections.forEach(function(sec) {
            var section = document.createElement('div');
            section.className = 'rules-section';

            var heading = document.createElement('div');
            heading.className = 'rules-heading';
            heading.textContent = sec.heading;
            section.appendChild(heading);

            var text = document.createElement('p');
            text.className = 'rules-text';
            text.textContent = sec.body;
            section.appendChild(text);

            body.appendChild(section);
        });
        box.appendChild(body);

        // Close button
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'rules-close-btn';
        closeBtn.textContent = 'CLOSE';
        closeBtn.addEventListener('click', function() { overlay.remove(); });
        box.appendChild(closeBtn);

        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    return {
        buildSetupScreen,
        buildShell,
        appendSetupHeader: _appendSetupHeader,
        showDifficultyModal: _showDifficultyModal,
        renderShanghaiPlayerSlots,
        collectShanghaiPlayers,
        renderBermudaPlayerSlots,
        collectBermudaPlayers,
        renderNineLivesPlayerSlots,
        collectNineLivesPlayers,
        renderRace1000PlayerSlots,
        collectRace1000Players,
        renderCricketPlayerSlots,
        collectCricketPlayers,
        showCongratsModal,
        showLegEndModal,
        showConfirmModal,
        setActivePlayer,
        setScore,
        setStartingScore,
        setLegStarter,
        addDartPill,
        clearDartPills,
        setCheckoutHint,
        setCheckoutPanel,
        flashCard,
        setMultiplierTab,
        addTouchSafeListener: _addTouchSafeListener,
        showRulesModal,
        setNextPlayerEnabled,
        setUndoEnabled,
        setStatus,
        showToast,
        setLoading,
        setMatchInfo,
        updatePlayerSetLegs,
    };

})();