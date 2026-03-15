/**
 * stats.js
 * --------
 * Player statistics screen.
 *
 * Provides two public functions:
 *
 *   STATS.showPlayerPicker(players, onSelect)
 *     Renders a modal listing all non-CPU players to pick from.
 *
 *   STATS.showStatsScreen(player, onBack)
 *     Replaces the #app content with a full stats screen for that player,
 *     with scope filter tabs (All / 501 / 201 × Double / Single out).
 *     Calls onBack() when the user taps the back button.
 */

const STATS = (() => {

    // ------------------------------------------------------------------
    // Player picker modal
    // ------------------------------------------------------------------

    function showPlayerPicker(players, onSelect) {
        var _spm = document.getElementById('stats-picker-modal'); if (_spm) _spm.remove();

        const humanPlayers = players.filter(p => p.name !== 'CPU');
        if (humanPlayers.length === 0) {
            _toast('NO PLAYERS YET'); return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'stats-picker-modal';
        overlay.className = 'modal-overlay';

        const box = document.createElement('div');
        box.className = 'modal-box stats-picker-box';
        box.innerHTML = `
            <div class="modal-title">VIEW STATS</div>
            <div class="modal-subtitle">SELECT A PLAYER</div>
        `;

        const list = document.createElement('div');
        list.className = 'stats-picker-list';

        humanPlayers.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'stats-picker-btn';
            btn.type = 'button';
            btn.textContent = p.name;
            btn.addEventListener('click', () => {
                overlay.remove();
                onSelect(p);
            });
            list.appendChild(btn);
        });

        box.appendChild(list);

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'stats-cancel-btn';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕  CANCEL';
        cancelBtn.addEventListener('click', () => overlay.remove());
        box.appendChild(cancelBtn);

        overlay.appendChild(box);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    // ------------------------------------------------------------------
    // Stats screen
    // ------------------------------------------------------------------

    /**
     * Replace #app content with the stats screen for the given player.
     *
     * @param {{ id: number, name: string }} player
     * @param {Function} onBack  — called when user taps Back
     */
    function showStatsScreen(player, onBack) {
        const app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-stats';

        // ---- Header bar ----
        const header = document.createElement('div');
        header.className = 'stats-header';

        const backBtn = document.createElement('button');
        backBtn.className = 'stats-back-btn';
        backBtn.type = 'button';
        backBtn.innerHTML = '‹ BACK';
        backBtn.addEventListener('click', onBack);

        const title = document.createElement('div');
        title.className = 'stats-header-title';
        title.textContent = player.name.toUpperCase();

        const aiBtn = document.createElement('button');
        aiBtn.className = 'stats-ai-btn';
        aiBtn.type = 'button';
        aiBtn.textContent = '🤖 AI ANALYSIS';
        aiBtn.addEventListener('click', function() {
            if (typeof ANALYSIS !== 'undefined') {
                ANALYSIS.showAnalysisScreen(player, function() {
                    STATS.showStatsScreen(player, onBack);
                });
            }
        });

        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(aiBtn);
        app.appendChild(header);

        // ---- Scope filters ----
        // ---- Content area ----
        const contentArea = document.createElement('div');
        contentArea.className = 'stats-content';
        app.appendChild(contentArea);

        // Initial load
        _reload(player.id, contentArea);
    }

    // ------------------------------------------------------------------
    // Data load + render
    // ------------------------------------------------------------------

    async function _reload(playerId, contentArea) {
        contentArea.innerHTML = '<div class="stats-loading">LOADING...</div>';

        try {
            const [data, heatmap, trend] = await Promise.all([
                API.getPlayerStats(playerId, {}),
                API.getPlayerHeatmap(playerId, {}),
                API.getPlayerDailyTrend(playerId),
            ]);
            _render(data, heatmap, trend, contentArea);
        } catch (err) {
            contentArea.innerHTML = `<div class="stats-error">FAILED TO LOAD STATS<br><small>${err.message}</small></div>`;
        }
    }

    function _render(data, heatmap, trend, container) {
        container.innerHTML = '';

        const { records, scoring, checkout } = data;

        // ── Full-width stats banner (4 columns) ──
        container.appendChild(_buildStatsBanner(records, scoring, checkout));

        // ── Two-column section: history (left) + heatmap/graph (right) ──
        const cols = document.createElement('div');
        cols.className = 'stats-two-col';
        container.appendChild(cols);

        // LEFT: session history
        const leftCol = document.createElement('div');
        leftCol.className = 'stats-col stats-col-left';
        cols.appendChild(leftCol);
        _renderHistory(data.player.id, leftCol);

        // RIGHT: heatmap + trend graph
        const rightCol = document.createElement('div');
        rightCol.className = 'stats-col stats-col-right';
        cols.appendChild(rightCol);

        if (heatmap && heatmap.counts) {
            const hmCard = document.createElement('div');
            hmCard.className = 'stat-card heatmap-card';
            const hmTitle = document.createElement('div');
            hmTitle.className = 'stat-card-title';
            hmTitle.textContent = 'DART HEATMAP';
            hmCard.appendChild(hmTitle);
            hmCard.appendChild(_buildStatsHeatmap(heatmap.counts));
            rightCol.appendChild(hmCard);
        }

        if (trend && trend.days && trend.days.length > 0) {
            rightCol.appendChild(_buildDailyTrendChart(trend.days));
        }
    }

    function _buildStatsBanner(records, scoring, checkout) {
        const banner = document.createElement('div');
        banner.className = 'stats-banner';

        const favDbl = checkout.favourite_double
            ? checkout.favourite_double.notation + ' (×' + checkout.favourite_double.times + ')'
            : '—';

        // 4 columns: Record | Scoring A | Scoring B | Checkout
        const columns = [
            {
                title: 'RECORD',
                rows: [
                    ['Matches played',  records.matches_played],
                    ['Matches won',     records.matches_won + ' (' + records.match_win_rate + '%)'],
                    ['Legs played (x01)', records.legs_played],
                    ['Legs won (x01)',  records.legs_won + ' (' + records.leg_win_rate + '%)'],
                    ['Sets won (x01)',  records.sets_won],
                ],
            },
            {
                title: 'SCORING',
                rows: [
                    ['3-dart avg',      records.three_dart_avg !== undefined ? records.three_dart_avg : scoring.three_dart_avg],
                    ['First 9 avg',     scoring.first9_avg],
                    ['Best turn',       scoring.highest_turn],
                    ['Worst turn',      scoring.lowest_turn],
                    ['Best dart',       scoring.highest_dart],
                ],
            },
            {
                title: 'SCORING Ⅱ',
                rows: [
                    ['Total darts',     scoring.total_darts],
                    ['180s',            scoring.one_eighties],
                    ['140+',            scoring.ton_forties],
                    ['100+',            scoring.tons],
                    ['Busts',           scoring.busts],
                ],
            },
            {
                title: 'CHECKOUT',
                rows: [
                    ['Best checkout',   checkout.best_checkout        || '—'],
                    ['Best D/O',        checkout.best_double_checkout || '—'],
                    ['Best S/O',        checkout.best_single_checkout || '—'],
                    ['Avg darts',       checkout.avg_darts_to_checkout || '—'],
                    ['Fav double',      favDbl],
                ],
            },
        ];

        columns.forEach(function(col) {
            const card = document.createElement('div');
            card.className = 'stats-banner-col stat-card';

            const hdr = document.createElement('div');
            hdr.className = 'stat-card-title';
            hdr.textContent = col.title;
            card.appendChild(hdr);

            col.rows.forEach(function(pair) {
                const row = document.createElement('div');
                row.className = 'stat-row';
                row.innerHTML =
                    '<span class="stat-label">' + _esc(pair[0]) + '</span>' +
                    '<span class="stat-value">' + _esc(String(pair[1])) + '</span>';
                card.appendChild(row);
            });

            banner.appendChild(card);
        });

        return banner;
    }

    function _buildCondensedStats(records, scoring, checkout) {
        const card = document.createElement('div');
        card.className = 'stat-card condensed-stats-card';

        // Scrollable inner wrapper — keeps card at fixed height
        const scroll = document.createElement('div');
        scroll.className = 'condensed-stats-scroll';
        card.appendChild(scroll);

        function group(title, rows) {
            const hdr = document.createElement('div');
            hdr.className = 'condensed-group-title';
            hdr.textContent = title;
            scroll.appendChild(hdr);

            rows.forEach(([label, value, sub, highlight]) => {
                const row = document.createElement('div');
                row.className = 'stat-row' + (highlight ? ' stat-row-highlight' : '');
                row.innerHTML =
                    `<span class="stat-label">${_esc(label)}</span>` +
                    `<span class="stat-value">${_esc(String(value))}` +
                    (sub ? `<span class="stat-sub"> ${_esc(sub)}</span>` : '') +
                    `</span>`;
                scroll.appendChild(row);
            });
        }

        const favDbl = checkout.favourite_double
            ? `${checkout.favourite_double.notation} (×${checkout.favourite_double.times})`
            : '—';

        group('RECORD', [
            ['Played',       records.matches_played],
            ['Won',          records.matches_won,         `(${records.match_win_rate}%)`,  true],
            ['Legs won (x01)', records.legs_won,          `of ${records.legs_played}`],
        ]);

        group('SCORING', [
            ['3-dart avg',   scoring.three_dart_avg,       null,                            true],
            ['First 9 avg',  scoring.first9_avg],
            ['Best turn',    scoring.highest_turn],
            ['Worst turn',   scoring.lowest_turn],
            ['Best dart',    scoring.highest_dart],
            ['Total darts',  scoring.total_darts],
            ['180s',         scoring.one_eighties,         null,                            scoring.one_eighties > 0],
            ['140+',         scoring.ton_forties],
            ['100+',         scoring.tons],
            ['Busts',        scoring.busts],
        ]);

        group('CHECKOUT', [
            ['Best',         checkout.best_checkout        || '—',  null,                   true],
            ['Best D/O',     checkout.best_double_checkout || '—'],
            ['Best S/O',     checkout.best_single_checkout || '—'],
            ['Avg darts',    checkout.avg_darts_to_checkout || '—'],
            ['Fav double',   favDbl],
        ]);

        return card;
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Stats heatmap (full multi-colour gradient)
    // ------------------------------------------------------------------

    function _buildStatsHeatmap(counts) {
        const SEGMENTS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        const SIZE = 200, CX = SIZE/2, CY = SIZE/2;
        const R = SIZE/2 - 4;

        const rBull    = R * 0.06;
        const rOuter   = R * 0.13;
        const rInner1  = R * 0.47;
        const rTreble2 = R * 0.55;
        const rDouble1 = R * 0.84;
        const rDouble2 = R * 0.97;

        const SEG_ANGLE   = 360 / 20;
        const START_OFF   = -SEG_ANGLE / 2;

        // Find max hits for scaling
        let maxHits = 1;
        Object.values(counts).forEach(v => { if (v > maxHits) maxHits = v; });

        function getHits(seg, prefix) {
            if (seg === 25) return counts[prefix === 'D' ? 'BULL' : 'OUTER'] || 0;
            return counts[prefix + seg] || 0;
        }

        // Multi-colour gradient: cold (black) → purple → red → tan/orange → green (hot)
        // Using site palette colours: var colours at 0%, 25%, 50%, 75%, 100%
        function heatColour(hits, isDouble, isTreble) {
            if (hits === 0) return null;
            const t = Math.pow(hits / maxHits, 0.6); // power <1 spreads low values

            // Colour stops matching site palette
            // 0.00: #0d0d0d  (near black — cold)
            // 0.20: #4a1060  (deep purple)
            // 0.45: #c0392b  (site red / bust colour)
            // 0.70: #c8a068  (site tan / warm)
            // 1.00: #2ecc71  (site green / checkout colour)
            const stops = [
                { t: 0.00, r: 13,  g: 13,  b: 13  },
                { t: 0.20, r: 74,  g: 16,  b: 96  },
                { t: 0.45, r: 192, g: 57,  b: 43  },
                { t: 0.70, r: 200, g: 160, b: 104 },
                { t: 1.00, r: 46,  g: 204, b: 113 },
            ];

            // Find the two stops t falls between
            let lo = stops[0], hi = stops[stops.length - 1];
            for (let i = 0; i < stops.length - 1; i++) {
                if (t >= stops[i].t && t <= stops[i+1].t) {
                    lo = stops[i]; hi = stops[i+1]; break;
                }
            }
            const span = hi.t - lo.t || 1;
            const f    = (t - lo.t) / span;
            const r = Math.round(lo.r + f * (hi.r - lo.r));
            const g = Math.round(lo.g + f * (hi.g - lo.g));
            const b = Math.round(lo.b + f * (hi.b - lo.b));

            // Trebles/doubles get slightly higher opacity for ring distinction
            const alpha = isTreble ? 0.95 : isDouble ? 0.88 : 0.80;
            return `rgba(${r},${g},${b},${alpha})`;
        }

        function polarToXY(angleDeg, radius) {
            const rad = (angleDeg - 90) * Math.PI / 180;
            return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
        }

        function arcPath(r1, r2, a1, a2) {
            const p1 = polarToXY(a1, r1), p2 = polarToXY(a2, r1);
            const p3 = polarToXY(a2, r2), p4 = polarToXY(a1, r2);
            const lg = (a2 - a1) > 180 ? 1 : 0;
            return `M ${p1.x} ${p1.y} A ${r1} ${r1} 0 ${lg} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${r2} ${r2} 0 ${lg} 0 ${p4.x} ${p4.y} Z`;
        }

        function svgEl(tag, attrs) {
            const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.entries(attrs).forEach(([k,v]) => e.setAttribute(k, v));
            return e;
        }

        function tip(el, text) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = text;
            el.appendChild(t);
        }

        const svg = svgEl('svg', {
            viewBox: `0 0 ${SIZE} ${SIZE}`,
            width: '100%',
            style: 'width:100%;display:block;',
        });

        // Dark board background
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: R, fill: '#0d0d0d', stroke: '#222', 'stroke-width': '1' }));

        SEGMENTS.forEach((seg, i) => {
            const a1 = START_OFF + i * SEG_ANGLE;
            const a2 = a1 + SEG_ANGLE;

            const sH = getHits(seg, 'S');
            const tH = getHits(seg, 'T');
            const dH = getHits(seg, 'D');

            const zones = [
                { r1: rOuter,   r2: rInner1,  hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rInner1,  r2: rTreble2, hits: tH, dbl: false, tbl: true,  lbl: 'T' },
                { r1: rTreble2, r2: rDouble1, hits: sH, dbl: false, tbl: false, lbl: 'S' },
                { r1: rDouble1, r2: rDouble2, hits: dH, dbl: true,  tbl: false, lbl: 'D' },
            ];

            zones.forEach(zone => {
                const colour = heatColour(zone.hits, zone.dbl, zone.tbl);
                const fill   = colour || '#141414';
                const path   = svgEl('path', {
                    d: arcPath(zone.r1, zone.r2, a1, a2),
                    fill,
                    stroke: '#1e1e1e',
                    'stroke-width': '0.5',
                });
                svg.appendChild(path);

                // Hit count on treble/double rings if >0
                if (zone.hits > 0 && zone.lbl !== 'S') {
                    const mid = a1 + SEG_ANGLE / 2;
                    const mr  = (zone.r1 + zone.r2) / 2;
                    const mp  = polarToXY(mid, mr);
                    const txt = svgEl('text', {
                        x: mp.x, y: mp.y,
                        'text-anchor': 'middle', 'dominant-baseline': 'central',
                        fill: '#fff', 'font-size': '6.5', 'font-family': 'monospace',
                        'font-weight': 'bold', 'pointer-events': 'none',
                    });
                    txt.textContent = zone.hits;
                    svg.appendChild(txt);
                }

                // Tooltip target
                const hitPts = zone.hits * (zone.lbl === 'T' ? 3 : zone.lbl === 'D' ? 2 : 1) * seg;
                const ttEl = svgEl('path', { d: arcPath(zone.r1, zone.r2, a1, a2), fill: 'transparent', stroke: 'none', cursor: 'default' });
                tip(ttEl, `${zone.lbl}${seg} — ${zone.hits} hit${zone.hits !== 1 ? 's' : ''} — ${hitPts} pts`);
                svg.appendChild(ttEl);
            });

            // Number label in wire ring
            const mid   = a1 + SEG_ANGLE / 2;
            const labelR = (rDouble2 + R) / 2;
            const lp    = polarToXY(mid, labelR);
            const rot   = mid + 90;
            const lbl   = svgEl('text', {
                x: lp.x, y: lp.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#555', 'font-size': '7.5', 'font-family': 'monospace',
                transform: `rotate(${rot},${lp.x},${lp.y})`, 'pointer-events': 'none',
            });
            lbl.textContent = seg;
            svg.appendChild(lbl);
        });

        // Outer bull
        const obH  = getHits(25, 'S');
        const obC  = heatColour(obH, false, false);
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: obC || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (obH > 0) {
            const obTxt = svgEl('text', { x: CX, y: CY + rBull + (rOuter - rBull)/2 - 1,
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            obTxt.textContent = obH;
            svg.appendChild(obTxt);
        }
        const obTT = svgEl('circle', { cx: CX, cy: CY, r: rOuter, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(obTT, `Outer Bull — ${obH} hit${obH !== 1 ? 's' : ''} — ${obH * 25} pts`);
        svg.appendChild(obTT);

        // Inner bull
        const bH  = getHits(25, 'D');
        const bC  = heatColour(bH, true, false);
        svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: bC || '#141414', stroke: '#1e1e1e', 'stroke-width': '0.5' }));
        if (bH > 0) {
            const bTxt = svgEl('text', { x: CX, y: CY,
                'text-anchor': 'middle', 'dominant-baseline': 'central',
                fill: '#fff', 'font-size': '6', 'font-family': 'monospace', 'pointer-events': 'none' });
            bTxt.textContent = bH;
            svg.appendChild(bTxt);
        }
        const bTT = svgEl('circle', { cx: CX, cy: CY, r: rBull, fill: 'transparent', stroke: 'none', cursor: 'default' });
        tip(bTT, `Bull — ${bH} hit${bH !== 1 ? 's' : ''} — ${bH * 50} pts`);
        svg.appendChild(bTT);

        // Gradient legend
        // ── Side-by-side layout: SVG board + contextual legend ──
        const inner = document.createElement('div');
        inner.className = 'heatmap-inner';

        // Left: SVG board
        const svgWrap = document.createElement('div');
        svgWrap.className = 'heatmap-svg-wrap';
        svgWrap.appendChild(svg);
        // Left: legend (appended before SVG so it appears on the left)
        const legend = document.createElement('div');
        legend.className = 'heatmap-legend';

        const lgTitle = document.createElement('div');
        lgTitle.className = 'heatmap-legend-title';
        lgTitle.textContent = 'COLOUR GUIDE';
        legend.appendChild(lgTitle);

        const legendItems = [
            { colour: '#2ecc71', label: 'Hottest',    desc: 'Most frequently hit zones' },
            { colour: '#c8a068', label: 'Hot',         desc: 'Above average frequency'   },
            { colour: '#c0392b', label: 'Moderate',    desc: 'Occasionally hit'           },
            { colour: '#4a1060', label: 'Cold',        desc: 'Rarely hit'                 },
            { colour: '#0d0d0d', label: 'Coldest',     desc: 'Never or almost never hit', border: '#444' },
        ];

        legendItems.forEach(function(item) {
            const row = document.createElement('div');
            row.className = 'heatmap-legend-item';

            const swatch = document.createElement('div');
            swatch.className = 'heatmap-legend-swatch';
            swatch.style.background = item.colour;
            if (item.border) swatch.style.borderColor = item.border;
            row.appendChild(swatch);

            const txt = document.createElement('div');
            txt.className = 'heatmap-legend-text';
            txt.innerHTML = '<strong>' + item.label + '</strong>' + item.desc;
            row.appendChild(txt);

            legend.appendChild(row);
        });

        // Gradient bar at bottom of legend
        const barRow = document.createElement('div');
        barRow.className = 'heatmap-gradient-bar-row';
        barRow.innerHTML =
            '<span class="heatmap-gradient-lbl">COLD</span>' +
            '<div class="heatmap-gradient-bar"></div>' +
            '<span class="heatmap-gradient-lbl">HOT</span>';
        legend.appendChild(barRow);

        inner.appendChild(legend);
        inner.appendChild(svgWrap);

        const wrap = document.createElement('div');
        wrap.className = 'heatmap-wrap';
        wrap.appendChild(inner);
        return wrap;
    }

    // ------------------------------------------------------------------
    // 30-day daily average trend chart
    // ------------------------------------------------------------------

    function _buildDailyTrendChart(days) {
        const card = document.createElement('div');
        card.className = 'stat-card daily-trend-card';

        const title = document.createElement('div');
        title.className = 'stat-card-title';
        title.textContent = '30-DAY AVERAGE TREND';
        card.appendChild(title);

        const W = 560, H = 140;
        const PAD = { top: 16, right: 20, bottom: 30, left: 44 };
        const innerW = W - PAD.left - PAD.right;
        const innerH = H - PAD.top  - PAD.bottom;

        const avgs = days.map(d => d.avg);
        const rawMin = Math.min(...avgs);
        const rawMax = Math.max(...avgs);
        // Auto-scale: pad 10% of range above and below, snap to nearest 5
        const rangePad = Math.max((rawMax - rawMin) * 0.15, 5);
        const minV = Math.max(0,   Math.floor((rawMin - rangePad) / 5) * 5);
        const maxV =               Math.ceil ((rawMax + rangePad) / 5) * 5;
        const range = maxV - minV || 10;

        // Build full 30-day calendar with carry-forward for gap days.
        // Line starts from the first day that has actual data.
        const today    = new Date();
        const calendar = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const key   = d.toISOString().slice(0, 10);
            const match = days.find(x => x.date === key);
            calendar.push({ date: key, data: match || null });
        }

        // Resolve display avg for each day: actual data or carry-forward from last real day.
        // Days before the first real data point get null (no line yet).
        let lastAvg = null;
        const resolved = calendar.map(entry => {
            if (entry.data) {
                lastAvg = entry.data.avg;
                return { date: entry.date, avg: entry.data.avg, real: true };
            } else if (lastAvg !== null) {
                return { date: entry.date, avg: lastAvg, real: false };
            } else {
                return { date: entry.date, avg: null, real: false };
            }
        });

        function xPos(i) {
            return PAD.left + (i / 29) * innerW;
        }
        function yPos(v) {
            return PAD.top + innerH - ((v - minV) / range) * innerH;
        }

        function svgEl(tag, attrs) {
            const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
            Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
            return e;
        }

        const svg = svgEl('svg', {
            viewBox: `0 0 ${W} ${H}`,
            width: '100%',
            style: 'display:block;',
            class: 'daily-trend-svg',
        });

        // Background
        svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#1a1a1a', rx: 6 }));

        // Y grid lines + labels
        const yTicks = 4;
        for (let i = 0; i <= yTicks; i++) {
            const v = minV + (range / yTicks) * i;
            const y = yPos(v);
            svg.appendChild(svgEl('line', {
                x1: PAD.left, x2: W - PAD.right, y1: y, y2: y,
                stroke: '#2a2a2a', 'stroke-width': 1,
            }));
            const lbl = svgEl('text', {
                x: PAD.left - 6, y: y,
                'text-anchor': 'end', 'dominant-baseline': 'central',
                fill: '#555', 'font-size': 9, 'font-family': 'monospace',
            });
            lbl.textContent = v.toFixed(0);
            svg.appendChild(lbl);
        }

        // X axis date labels — show every 5th index + first and last
        resolved.forEach((entry, i) => {
            if (i === 0 || i === 29 || i % 5 === 0) {
                const parts = entry.date.split('-');
                const lbl = svgEl('text', {
                    x: xPos(i), y: H - PAD.bottom + 11,
                    'text-anchor': 'middle',
                    fill: '#444', 'font-size': 8, 'font-family': 'monospace',
                });
                lbl.textContent = parts[2] + '/' + parts[1];   // DD/MM
                svg.appendChild(lbl);
            }
        });

        // Overall average reference line (real data days only)
        const overallAvg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        const avgY = yPos(overallAvg);
        svg.appendChild(svgEl('line', {
            x1: PAD.left, x2: W - PAD.right, y1: avgY, y2: avgY,
            stroke: '#a87200', 'stroke-width': 1, 'stroke-dasharray': '4 3',
        }));
        const avgLbl = svgEl('text', {
            x: W - PAD.right + 3, y: avgY,
            'dominant-baseline': 'central',
            fill: '#a87200', 'font-size': 8, 'font-family': 'monospace',
        });
        avgLbl.textContent = overallAvg.toFixed(1);
        svg.appendChild(avgLbl);

        // Single continuous line path — only from first real data point onward.
        // Carry-forward days produce horizontal segments; real days may step up/down.
        const linePoints = resolved.filter(e => e.avg !== null);
        if (linePoints.length >= 2) {
            // Filled area under the line
            const firstIdx = resolved.findIndex(e => e.avg !== null);
            const lastIdx  = resolved.length - 1 - [...resolved].reverse().findIndex(e => e.avg !== null);
            const areaCoords = linePoints.map((e, j) => {
                const idx = resolved.indexOf(e);
                return `${xPos(idx)},${yPos(e.avg)}`;
            }).join(' ');
            const firstX = xPos(firstIdx), lastX = xPos(lastIdx);
            const baseY  = PAD.top + innerH;
            svg.appendChild(svgEl('polygon', {
                points: `${firstX},${baseY} ${areaCoords} ${lastX},${baseY}`,
                fill: 'rgba(240,165,0,0.07)',
            }));

            // The line itself
            const pathD = linePoints.map((e, j) => {
                const idx = resolved.indexOf(e);
                return `${j === 0 ? 'M' : 'L'}${xPos(idx)},${yPos(e.avg)}`;
            }).join(' ');
            svg.appendChild(svgEl('path', {
                d: pathD, fill: 'none', stroke: '#f0a500',
                'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            }));
        }

        // Dots only on real data days
        resolved.forEach((entry, i) => {
            if (!entry.real) return;
            const cx = xPos(i), cy = yPos(entry.avg);
            const isMax = entry.avg === Math.max(...avgs);
            const isMin = entry.avg === Math.min(...avgs);
            const dot = svgEl('circle', {
                cx, cy,
                r: isMax || isMin ? 5 : 3,
                fill: isMax ? '#f0a500' : isMin ? '#e05555' : '#c87800',
                stroke: '#0d0d0d', 'stroke-width': 1,
            });
            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            const cal = calendar[i];
            tip.textContent = `${entry.date.split('-').reverse().join('/')}  ·  avg: ${entry.avg}  ·  ${cal.data.darts} darts  ·  ${cal.data.sessions} session${cal.data.sessions !== 1 ? 's' : ''}`;
            dot.appendChild(tip);
            svg.appendChild(dot);
        });

        const wrap = document.createElement('div');
        wrap.className = 'daily-trend-wrap';
        wrap.appendChild(svg);
        card.appendChild(wrap);
        return card;
    }

        // ------------------------------------------------------------------
    // Session history section
    // ------------------------------------------------------------------

    async function _renderHistory(playerId, container) {
        const section = document.createElement('div');
        section.className = 'stat-card history-card';

        const hdr = document.createElement('div');
        hdr.className = 'stat-card-title history-card-title';
        hdr.innerHTML = 'SESSION HISTORY <span class="history-loading-inline">…</span>';
        section.appendChild(hdr);

        const list = document.createElement('div');
        list.className = 'history-list';
        section.appendChild(list);

        const moreBtn = document.createElement('button');
        moreBtn.className = 'history-more-btn';
        moreBtn.type = 'button';
        moreBtn.textContent = 'LOAD MORE';
        moreBtn.style.display = 'none';
        section.appendChild(moreBtn);

        container.appendChild(section);

        let offset = 0;
        const PAGE = 20;

        async function loadPage() {
            moreBtn.style.display = 'none';
            try {
                const data = await API.getPlayerHistory(playerId, offset, PAGE);
                // Use local refs instead of getElementById (avoids duplicate ID issues on reload)
                const spinner = hdr.querySelector('.history-loading-inline');
                if (spinner) spinner.remove();

                if (data.sessions.length === 0 && offset === 0) {
                    list.innerHTML = '<div class="history-empty">No sessions yet</div>';
                    return;
                }

                data.sessions.forEach(session => {
                    const row = document.createElement('button');
                    row.className = 'history-row';
                    row.type = 'button';

                    const resultCls = session.result === 'WIN'      ? 'result-win'
                                    : session.result === 'LOSS'     ? 'result-loss'
                                    : session.result === 'PRACTICE' ? 'result-practice'
                                    : 'result-neutral';

                    const oppText = session.is_practice
                        ? session.game_type
                        : (() => {
                            let opp = session.opponent || '—';
                            if (session.cpu_difficulty && opp.includes('CPU')) {
                                const label = session.cpu_difficulty.charAt(0).toUpperCase()
                                            + session.cpu_difficulty.slice(1);
                                opp = opp.replace('CPU', 'CPU (' + label + ')');
                            }
                            return opp;
                        })();

                    const gameLabel = (session.game_type || '').toUpperCase();

                    // For non-01 games show a game-specific score label instead of avg
                    const SCORE_LABELS = {
                        race1000:  'pts', bermuda: 'pts', baseball: 'runs',
                        nine_lives: 'lives', killer: 'lives',
                        shanghai: 'pts', cricket: 'pts',
                    };
                    const gt = (session.game_type || '').toLowerCase();
                    let avgDisplay, dartsDisplay;
                    if (session.score !== null && session.score !== undefined && SCORE_LABELS[gt]) {
                        avgDisplay   = `${session.score} ${SCORE_LABELS[gt]}`;
                        dartsDisplay = `${session.darts}d`;
                    } else {
                        avgDisplay   = session.avg;
                        dartsDisplay = `${session.darts}d`;
                    }

                    row.innerHTML =
                        `<span class="history-date">${_esc(session.date)}</span>` +
                        `<span class="history-type ${resultCls}">${_esc(session.result)}</span>` +
                        `<span class="history-game">${_esc(gameLabel)}</span>` +
                        `<span class="history-opp">${_esc(oppText)}</span>` +
                        `<span class="history-avg">${_esc(String(avgDisplay))}</span>` +
                        `<span class="history-darts">${_esc(dartsDisplay)}</span>` +
                        `<span class="history-chevron">›</span>`;

                    const NON01_GAMES = ['race1000','nine_lives','killer','bermuda','baseball','shanghai','cricket'];
                    row.addEventListener('click', () => {
                        if (session.is_practice) {
                            _showPracticeSummaryModal(session);
                        } else if (gt === 'shanghai') {
                            _showShanghaiScorecardModal(session.match_id, playerId);
                        } else if (gt === 'cricket') {
                            _showCricketScorecardModal(session.match_id, playerId);
                        } else if (NON01_GAMES.includes(gt)) {
                            _showGenericScorecardModal(session.match_id, playerId);
                        } else {
                            _showScorecardModal(session.match_id, playerId);
                        }
                    });
                    list.appendChild(row);
                });

                offset += data.sessions.length;
                if (data.sessions.length === PAGE) {
                    moreBtn.style.display = '';
                }
            } catch(e) {
                console.error('[history] load failed:', e);
                const spinner = hdr.querySelector('.history-loading-inline');
                if (spinner) spinner.textContent = '!';
            }
        }

        moreBtn.addEventListener('click', loadPage);
        loadPage();
        return section;
    }

    function _showPracticeSummaryModal(session) {
        const overlay = _modalOverlay('practice-summary-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box practice-summary-modal-box';

        box.innerHTML =
            `<div class="modal-title">PRACTICE SESSION</div>` +
            `<div class="modal-subtitle">${_esc(session.date)}</div>` +
            `<div class="scorecard-practice-stats">` +
                `<div class="sc-pstat"><span class="sc-pval">${session.darts}</span><span class="sc-plbl">DARTS</span></div>` +
                `<div class="sc-pstat"><span class="sc-pval">${session.avg}</span><span class="sc-plbl">3-DART AVG</span></div>` +
            `</div>` +
            `<div class="practice-heatmap-loading">Loading heatmap…</div>`;

        const closeBtn = _closeButton(() => overlay.remove());
        box.appendChild(closeBtn);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Fetch and render heatmap scoped to this match
        API.getPlayerHeatmap(session.player_id, { matchId: session.match_id })
            .then(function(data) {
                const loadingEl = box.querySelector('.practice-heatmap-loading');
                if (loadingEl) loadingEl.remove();
                if (data && data.counts && Object.keys(data.counts).length > 0) {
                    const hmWrap = _buildStatsHeatmap(data.counts);
                    hmWrap.classList.add('practice-heatmap-wrap');
                    // Insert before close button
                    box.insertBefore(hmWrap, closeBtn);
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'practice-heatmap-loading';
                    empty.textContent = 'No throw data recorded.';
                    box.insertBefore(empty, closeBtn);
                }
            })
            .catch(function() {
                const loadingEl = box.querySelector('.practice-heatmap-loading');
                if (loadingEl) loadingEl.textContent = 'Could not load heatmap.';
            });
    }

    async function _showScorecardModal(matchId, focusPlayerId) {
        const overlay = _modalOverlay('scorecard-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';
        box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">LOADING…</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        try {
            const data = await API.getMatchScorecard(matchId);
            box.innerHTML = '';
            _renderScorecard(data, focusPlayerId, box, () => overlay.remove());
        } catch(e) {
            box.innerHTML = `<div class="modal-title">SCORECARD</div><div class="sc-loading">FAILED TO LOAD</div>`;
            box.appendChild(_closeButton(() => overlay.remove()));
        }
    }

    function _renderScorecard(data, focusPlayerId, box, onClose) {
        const { match, players, legs } = data;

        // Header
        const winner = players.find(p => p.id === match.winner_id);
        const titleEl = document.createElement('div');
        titleEl.className = 'modal-title';
        titleEl.textContent = match.game_type.toUpperCase();
        box.appendChild(titleEl);

        const metaEl = document.createElement('div');
        metaEl.className = 'sc-meta';
        metaEl.textContent = match.ended_at +
            (winner ? '  ·  ' + winner.name.toUpperCase() + ' WINS' : '');
        box.appendChild(metaEl);

        // One section per leg
        legs.forEach((leg, li) => {
            const legHdr = document.createElement('div');
            legHdr.className = 'sc-leg-header';
            const legWinner = players.find(p => p.id === leg.winner_id);
            legHdr.textContent = 'LEG ' + leg.leg_number +
                (legWinner ? '  ·  ' + legWinner.name.toUpperCase() : '');
            box.appendChild(legHdr);

            // Column headers
            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            // Build columns dynamically per player
            let hdrHTML = '<span class="sc-turn-num">#</span>';
            players.forEach(p => {
                hdrHTML +=
                    `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            // Group turns by turn_number
            const turnMap = {};
            leg.turns.forEach(t => {
                if (!turnMap[t.turn_number]) turnMap[t.turn_number] = {};
                turnMap[t.turn_number][t.player_id] = t;
            });

            const turnNums = Object.keys(turnMap).map(Number).sort((a,b)=>a-b);
            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';

                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                players.forEach(p => {
                    const turn = turnMap[tn][p.id];
                    if (!turn) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }

                    const dartStr = turn.throws.map(th => {
                        let cls = th.is_checkout ? 'dart-checkout' : '';
                        return `<span class="sc-dart ${cls}">${_esc(th.notation)}</span>`;
                    }).join('');

                    const turnCls = turn.is_bust ? 'sc-bust'
                                  : turn.is_checkout ? 'sc-checkout' : '';

                    const remaining = turn.is_bust ? 'BUST'
                                    : (turn.score_after !== null ? turn.score_after : '—');

                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                            `<span class="sc-darts">${dartStr}</span>` +
                            `<span class="sc-turn-score ${turnCls}">${turn.is_bust ? 0 : turn.turn_score}</span>` +
                            `<span class="sc-remaining ${turnCls}">${remaining}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        });

        box.appendChild(_closeButton(onClose));
    }

    // ------------------------------------------------------------------
    // Modal helpers
    // ------------------------------------------------------------------

    // ── Generic (non-01) scorecard modal ─────────────────────────────────────

    async function _showGenericScorecardModal(matchId, focusPlayerId) {
        const overlay = _modalOverlay('scorecard-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';
        box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">LOADING…</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        try {
            const data = await API.getGenericScorecard(matchId);
            box.innerHTML = '';
            _renderGenericScorecard(data, focusPlayerId, box, () => overlay.remove());
        } catch(e) {
            box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">FAILED TO LOAD</div>';
            box.appendChild(_closeButton(() => overlay.remove()));
        }
    }

    function _renderGenericScorecard(data, focusPlayerId, box, onClose) {
        const gt = data.game_type;
        if      (gt === 'race1000')  _renderRace1000Scorecard(data, focusPlayerId, box, onClose);
        else if (gt === 'nine_lives') _renderNineLivesScorecard(data, focusPlayerId, box, onClose);
        else if (gt === 'killer')    _renderKillerScorecard(data, focusPlayerId, box, onClose);
        else if (gt === 'bermuda')   _renderBermudaScorecard(data, focusPlayerId, box, onClose);
        else if (gt === 'baseball')  _renderBaseballScorecard(data, focusPlayerId, box, onClose);
        else {
            box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">UNSUPPORTED GAME TYPE</div>';
            box.appendChild(_closeButton(onClose));
        }
    }

    // ── Dart notation helper ──────────────────────────────────────────────────
    function _dartNotation(seg, mul) {
        if (seg === 0) return 'MISS';
        if (seg === 25) return mul === 2 ? 'BULL' : 'OUTER';
        const prefix = mul === 3 ? 'T' : mul === 2 ? 'D' : '';
        return prefix + seg;
    }

    function _scHeader(box, title, subtitle) {
        const t = document.createElement('div');
        t.className = 'modal-title';
        t.textContent = title;
        box.appendChild(t);
        if (subtitle) {
            const s = document.createElement('div');
            s.className = 'sc-meta';
            s.textContent = subtitle;
            box.appendChild(s);
        }
    }

    // ── Race to 1000 ─────────────────────────────────────────────────────────
    function _renderRace1000Scorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'RACE TO 1000', winner ? winner.name.toUpperCase() + ' WINS' : '');

        // Final scores table
        const scoresEl = document.createElement('div');
        scoresEl.className = 'sc-summary-table';
        data.players.forEach(p => {
            const score = data.final_scores[String(p.id)] || 0;
            const isFocus = p.id === focusPlayerId;
            scoresEl.innerHTML +=
                `<div class="sc-summary-row${isFocus ? ' sc-focus' : ''}">` +
                `<span class="sc-summary-name">${_esc(p.name)}</span>` +
                `<span class="sc-summary-score">${score} pts</span></div>`;
        });
        box.appendChild(scoresEl);

        // Turn-by-turn breakdown
        const turnNums = Object.keys(data.turns).map(Number).sort((a,b) => a-b);
        if (turnNums.length) {
            const hdr = document.createElement('div');
            hdr.className = 'sc-leg-header';
            hdr.textContent = 'TURN BY TURN';
            box.appendChild(hdr);

            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            let hdrHTML = '<span class="sc-turn-num">#</span>';
            data.players.forEach(p => {
                hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                data.players.forEach(p => {
                    const darts = (data.turns[String(tn)] || {})[String(p.id)];
                    if (!darts || !darts.length) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const turnPts = darts.reduce((s, d) => s + d.pts, 0);
                    const dartStr = darts.map(d =>
                        `<span class="sc-dart">${_esc(_dartNotation(d.seg, d.mul))}</span>`
                    ).join('');
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `<span class="sc-turn-score">${turnPts}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        }
        box.appendChild(_closeButton(onClose));
    }

    // ── Nine Lives ───────────────────────────────────────────────────────────
    function _renderNineLivesScorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'NINE LIVES', winner ? winner.name.toUpperCase() + ' WINS' : '');

        // Final state per player
        const summaryEl = document.createElement('div');
        summaryEl.className = 'sc-summary-table';
        data.players.forEach(p => {
            const st = data.final_states[String(p.id)] || {};
            const isFocus = p.id === focusPlayerId;
            const status = st.eliminated ? 'ELIMINATED' : st.completed ? 'COMPLETED' : `Target: ${st.target}`;
            summaryEl.innerHTML +=
                `<div class="sc-summary-row${isFocus ? ' sc-focus' : ''}">` +
                `<span class="sc-summary-name">${_esc(p.name)}</span>` +
                `<span class="sc-summary-score">${st.lives !== undefined ? st.lives + ' lives' : '—'}</span>` +
                `<span class="sc-summary-extra">${status}</span></div>`;
        });
        box.appendChild(summaryEl);

        // Turn-by-turn
        const turnNums = Object.keys(data.turns).map(Number).sort((a,b) => a-b);
        if (turnNums.length) {
            const hdr = document.createElement('div');
            hdr.className = 'sc-leg-header';
            hdr.textContent = 'TURN BY TURN';
            box.appendChild(hdr);

            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            let hdrHTML = '<span class="sc-turn-num">#</span>';
            data.players.forEach(p => {
                hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                data.players.forEach(p => {
                    const darts = (data.turns[String(tn)] || {})[String(p.id)];
                    if (!darts || !darts.length) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const hits = darts.filter(d => d.is_hit).length;
                    const dartStr = darts.map(d =>
                        `<span class="sc-dart${d.is_hit ? ' dart-checkout' : ''}">${_esc(_dartNotation(d.seg, d.mul))}</span>`
                    ).join('');
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `<span class="sc-turn-score">${hits} hit</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        }
        box.appendChild(_closeButton(onClose));
    }

    // ── Killer ───────────────────────────────────────────────────────────────
    function _renderKillerScorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'KILLER', winner ? winner.name.toUpperCase() + ' WINS' : '');

        const summaryEl = document.createElement('div');
        summaryEl.className = 'sc-summary-table';
        data.players.forEach(p => {
            const st = data.final_states[String(p.id)] || {};
            const isFocus = p.id === focusPlayerId;
            const status = st.eliminated ? 'ELIMINATED' : (st.is_killer ? 'KILLER' : `${st.hits}/3 hits`);
            summaryEl.innerHTML +=
                `<div class="sc-summary-row${isFocus ? ' sc-focus' : ''}">` +
                `<span class="sc-summary-name">${_esc(p.name)}</span>` +
                `<span class="sc-summary-score">No. ${st.assigned_number || '?'}</span>` +
                `<span class="sc-summary-extra">${st.lives !== undefined ? st.lives + ' lives' : '—'} · ${status}</span></div>`;
        });
        box.appendChild(summaryEl);

        const turnNums = Object.keys(data.turns).map(Number).sort((a,b) => a-b);
        if (turnNums.length) {
            const hdr = document.createElement('div');
            hdr.className = 'sc-leg-header';
            hdr.textContent = 'TURN BY TURN';
            box.appendChild(hdr);

            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            let hdrHTML = '<span class="sc-turn-num">#</span>';
            data.players.forEach(p => {
                hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                data.players.forEach(p => {
                    const darts = (data.turns[String(tn)] || {})[String(p.id)];
                    if (!darts || !darts.length) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const dartStr = darts.map(d =>
                        `<span class="sc-dart${d.hits_scored > 0 ? ' dart-checkout' : ''}">${_esc(_dartNotation(d.seg, d.mul))}</span>`
                    ).join('');
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        }
        box.appendChild(_closeButton(onClose));
    }

    // ── Bermuda Triangle ─────────────────────────────────────────────────────
    const _BERMUDA_ROUND_LABELS = [
        null,'12','13','14','Any Double','15','16','17','Any Triple','18','19','20','Single Bull','Double Bull'
    ];

    function _renderBermudaScorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'BERMUDA TRIANGLE', winner ? winner.name.toUpperCase() + ' WINS' : '');

        const summaryEl = document.createElement('div');
        summaryEl.className = 'sc-summary-table';
        data.players.forEach(p => {
            const score = data.final_scores[String(p.id)] || 0;
            const isFocus = p.id === focusPlayerId;
            summaryEl.innerHTML +=
                `<div class="sc-summary-row${isFocus ? ' sc-focus' : ''}">` +
                `<span class="sc-summary-name">${_esc(p.name)}</span>` +
                `<span class="sc-summary-score">${score} pts</span></div>`;
        });
        box.appendChild(summaryEl);

        // Round-by-round layout
        const roundNums = Object.keys(data.round_summary).map(Number).sort((a,b) => a-b);
        if (roundNums.length) {
            const hdr = document.createElement('div');
            hdr.className = 'sc-leg-header';
            hdr.textContent = 'ROUND BY ROUND';
            box.appendChild(hdr);

            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            let hdrHTML = '<span class="sc-turn-num">RND</span>';
            data.players.forEach(p => {
                hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            roundNums.forEach(rn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                const rlabel = _BERMUDA_ROUND_LABELS[rn] || String(rn);
                let rowHTML = `<span class="sc-turn-num" title="Round ${rn}">${_esc(rlabel)}</span>`;
                data.players.forEach(p => {
                    const summary = (data.round_summary[String(rn)] || {})[String(p.id)];
                    const darts   = ((data.throws_by_round || {})[String(rn)] || {})[String(p.id)];
                    if (!summary) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const dartStr = darts ? darts.map(d =>
                        `<span class="sc-dart${d.pts > 0 ? ' dart-checkout' : ''}">${_esc(_dartNotation(d.seg, d.mul))}</span>`
                    ).join('') : '';
                    const halvedCls = summary.halved ? ' sc-bust' : '';
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `<span class="sc-turn-score${halvedCls}">${summary.halved ? 'HALVED' : summary.pts}</span>` +
                        `<span class="sc-remaining">${summary.score_after}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        }
        box.appendChild(_closeButton(onClose));
    }

    // ── Baseball ─────────────────────────────────────────────────────────────
    function _renderBaseballScorecard(data, focusPlayerId, box, onClose) {
        const winnerIds = (data.winner_ids || '').split(',').map(s => parseInt(s, 10));
        const winnerNames = data.players
            .filter(p => winnerIds.includes(p.id))
            .map(p => p.name.toUpperCase())
            .join(' & ');
        _scHeader(box, 'BASEBALL', winnerNames ? winnerNames + ' WIN' : '');

        const inningNums = [];
        data.players.forEach(p => {
            Object.keys(data.innings[String(p.id)] || {}).forEach(i => {
                if (!inningNums.includes(Number(i))) inningNums.push(Number(i));
            });
        });
        inningNums.sort((a,b) => a-b);

        // Column header: player names
        const colHdr = document.createElement('div');
        colHdr.className = 'sc-col-header';
        let hdrHTML = '<span class="sc-turn-num">INN</span>';
        data.players.forEach(p => {
            hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
        });
        colHdr.innerHTML = hdrHTML;
        box.appendChild(colHdr);

        inningNums.forEach(inn => {
            const start = data.start_number || 1;
            const target = start + inn - 1;
            const rowEl = document.createElement('div');
            rowEl.className = 'sc-turn-row';
            let rowHTML = `<span class="sc-turn-num" title="Target: ${target}">${inn}<span style="font-size:9px;opacity:0.6"> (${target})</span></span>`;
            data.players.forEach(p => {
                const idata = (data.innings[String(p.id)] || {})[String(inn)];
                if (!idata) {
                    rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                    return;
                }
                rowHTML +=
                    `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                    `<span class="sc-turn-score">${idata.runs}r</span>` +
                    `<span class="sc-remaining">${idata.outs} out${idata.outs !== 1 ? 's' : ''}</span>` +
                    `</span>`;
            });
            rowEl.innerHTML = rowHTML;
            box.appendChild(rowEl);
        });

        // Totals row
        const totalsRow = document.createElement('div');
        totalsRow.className = 'sc-turn-row sc-totals-row';
        let totHTML = '<span class="sc-turn-num">TOT</span>';
        data.players.forEach(p => {
            const total = data.totals[String(p.id)] || 0;
            const isWinner = winnerIds.includes(p.id);
            totHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}"><span class="sc-turn-score${isWinner ? ' dart-checkout' : ''}">${total} runs</span></span>`;
        });
        totalsRow.innerHTML = totHTML;
        box.appendChild(totalsRow);

        box.appendChild(_closeButton(onClose));
    }

        // ── Shanghai scorecard ───────────────────────────────────────────────────

    async function _showShanghaiScorecardModal(matchId, focusPlayerId) {
        const overlay = _modalOverlay('scorecard-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';
        box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">LOADING…</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        try {
            const data = await API.getShanghaiScorecard(matchId);
            box.innerHTML = '';
            _renderShanghaiScorecard(data, focusPlayerId, box, () => overlay.remove());
        } catch(e) {
            box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">FAILED TO LOAD</div>';
            box.appendChild(_closeButton(() => overlay.remove()));
        }
    }

    function _renderShanghaiScorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'SHANGHAI', winner ? winner.name.toUpperCase() + ' WINS' : '');

        // Final scores summary
        const summaryEl = document.createElement('div');
        summaryEl.className = 'sc-summary-table';
        data.players.forEach(p => {
            const total = data.totals[String(p.id)] || 0;
            const isFocus = p.id === focusPlayerId;
            summaryEl.innerHTML +=
                `<div class="sc-summary-row${isFocus ? ' sc-focus' : ''}">` +
                `<span class="sc-summary-name">${_esc(p.name)}</span>` +
                `<span class="sc-summary-score">${total} pts</span></div>`;
        });
        box.appendChild(summaryEl);

        // Round-by-round breakdown
        const roundNums = Object.keys(data.rounds).map(Number).sort((a,b) => a-b);
        if (roundNums.length) {
            const hdr = document.createElement('div');
            hdr.className = 'sc-leg-header';
            hdr.textContent = 'ROUND BY ROUND';
            box.appendChild(hdr);

            const colHdr = document.createElement('div');
            colHdr.className = 'sc-col-header';
            let hdrHTML = '<span class="sc-turn-num">TGT</span>';
            data.players.forEach(p => {
                hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            colHdr.innerHTML = hdrHTML;
            box.appendChild(colHdr);

            roundNums.forEach(rn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                // Get target from first player's data for this round
                const anyPlayer = Object.values(data.rounds[String(rn)] || {})[0];
                const target = anyPlayer ? anyPlayer.target : rn;
                let rowHTML = `<span class="sc-turn-num">${target}</span>`;
                data.players.forEach(p => {
                    const rd    = (data.rounds[String(rn)] || {})[String(p.id)];
                    const darts = (data.throws[String(rn)]  || {})[String(p.id)];
                    if (!rd) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const dartStr = darts ? darts.map(d => {
                        const hit = d.pts > 0;
                        return `<span class="sc-dart${d.pts > 0 ? ' dart-checkout' : ''}">${_esc(_dartNotation(d.seg, d.mul))}</span>`;
                    }).join('') : '';
                    const shanghaiBadge = rd.shanghai ? ' <span class="sc-shanghai-badge">SHANGHAI!</span>' : '';
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `<span class="sc-turn-score">${rd.score}${shanghaiBadge}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });

            // Totals row
            const totalsRow = document.createElement('div');
            totalsRow.className = 'sc-turn-row sc-totals-row';
            let totHTML = '<span class="sc-turn-num">TOT</span>';
            data.players.forEach(p => {
                const total = data.totals[String(p.id)] || 0;
                const isWinner = p.id === data.winner_id;
                totHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}"><span class="sc-turn-score${isWinner ? ' dart-checkout' : ''}">${total}</span></span>`;
            });
            totalsRow.innerHTML = totHTML;
            box.appendChild(totalsRow);
        }
        box.appendChild(_closeButton(onClose));
    }

    // ── Cricket scorecard ────────────────────────────────────────────────────

    async function _showCricketScorecardModal(matchId, focusPlayerId) {
        const overlay = _modalOverlay('scorecard-modal');
        const box = document.createElement('div');
        box.className = 'modal-box scorecard-box';
        box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">LOADING…</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        try {
            const data = await API.getCricketScorecard(matchId);
            box.innerHTML = '';
            _renderCricketScorecard(data, focusPlayerId, box, () => overlay.remove());
        } catch(e) {
            box.innerHTML = '<div class="modal-title">SCORECARD</div><div class="sc-loading">FAILED TO LOAD</div>';
            box.appendChild(_closeButton(() => overlay.remove()));
        }
    }

    const _CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

    function _renderCricketScorecard(data, focusPlayerId, box, onClose) {
        const winner = data.players.find(p => p.id === data.winner_id);
        _scHeader(box, 'CRICKET', winner ? winner.name.toUpperCase() + ' WINS' : '');

        // Marks/scores summary table — one row per scoring number
        const hdr = document.createElement('div');
        hdr.className = 'sc-leg-header';
        hdr.textContent = 'FINAL MARKS & SCORES';
        box.appendChild(hdr);

        // Column header
        const colHdr = document.createElement('div');
        colHdr.className = 'sc-col-header';
        let hdrHTML = '<span class="sc-turn-num">NUM</span>';
        data.players.forEach(p => {
            hdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
        });
        colHdr.innerHTML = hdrHTML;
        box.appendChild(colHdr);

        _CRICKET_NUMBERS.forEach(num => {
            const rowEl = document.createElement('div');
            rowEl.className = 'sc-turn-row';
            const label = num === 25 ? 'BULL' : String(num);
            let rowHTML = `<span class="sc-turn-num">${label}</span>`;
            data.players.forEach(p => {
                const marks = ((data.final_marks[String(p.id)] || {})[String(num)]) || 0;
                const closed = marks >= 3;
                const marksStr = marks === 0 ? '·' : marks === 1 ? '/' : marks === 2 ? 'X' : '✓';
                rowHTML +=
                    `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                    `<span class="sc-turn-score${closed ? ' dart-checkout' : ''}">${marksStr}</span>` +
                    `</span>`;
            });
            rowEl.innerHTML = rowHTML;
            box.appendChild(rowEl);
        });

        // Points row
        const ptsRow = document.createElement('div');
        ptsRow.className = 'sc-turn-row sc-totals-row';
        let ptsHTML = '<span class="sc-turn-num">PTS</span>';
        data.players.forEach(p => {
            const pts = data.final_scores[String(p.id)] || 0;
            const isWinner = p.id === data.winner_id;
            ptsHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}"><span class="sc-turn-score${isWinner ? ' dart-checkout' : ''}">${pts}</span></span>`;
        });
        ptsRow.innerHTML = ptsHTML;
        box.appendChild(ptsRow);

        // Turn-by-turn throws
        const turnNums = Object.keys(data.turns).map(Number).sort((a,b) => a-b);
        if (turnNums.length) {
            const turnHdr = document.createElement('div');
            turnHdr.className = 'sc-leg-header';
            turnHdr.textContent = 'TURN BY TURN';
            box.appendChild(turnHdr);

            const turnColHdr = document.createElement('div');
            turnColHdr.className = 'sc-col-header';
            let turnHdrHTML = '<span class="sc-turn-num">#</span>';
            data.players.forEach(p => {
                turnHdrHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">${_esc(p.name.toUpperCase())}</span>`;
            });
            turnColHdr.innerHTML = turnHdrHTML;
            box.appendChild(turnColHdr);

            turnNums.forEach(tn => {
                const rowEl = document.createElement('div');
                rowEl.className = 'sc-turn-row';
                let rowHTML = `<span class="sc-turn-num">${tn}</span>`;
                data.players.forEach(p => {
                    const darts = (data.turns[String(tn)] || {})[String(p.id)];
                    if (!darts || !darts.length) {
                        rowHTML += `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">—</span>`;
                        return;
                    }
                    const turnPts = darts.reduce((s,d) => s + d.pts, 0);
                    const dartStr = darts.map(d => {
                        const hit = d.marks > 0 || d.pts > 0;
                        return `<span class="sc-dart${hit ? ' dart-checkout' : ''}">${_esc(_dartNotation(d.seg, d.mul))}</span>`;
                    }).join('');
                    rowHTML +=
                        `<span class="sc-player-col${p.id === focusPlayerId ? ' sc-focus' : ''}">` +
                        `<span class="sc-darts">${dartStr}</span>` +
                        `<span class="sc-turn-score">${turnPts > 0 ? '+' + turnPts : ''}</span>` +
                        `</span>`;
                });
                rowEl.innerHTML = rowHTML;
                box.appendChild(rowEl);
            });
        }
        box.appendChild(_closeButton(onClose));
    }

        function _modalOverlay(id) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'modal-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        return overlay;
    }

    function _closeButton(onClick) {
        const btn = document.createElement('button');
        btn.className = 'stats-cancel-btn';
        btn.type = 'button';
        btn.textContent = '✕  CLOSE';
        btn.addEventListener('click', onClick);
        return btn;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'visible info';
        setTimeout(() => { t.className = ''; }, 2500);
    }

    return { showPlayerPicker, showStatsScreen };

})();