/**
 * analysis.js
 * -----------
 * AI-powered player analysis screen.
 *
 * Public API:
 *   ANALYSIS.showAnalysisScreen(player, onBack)
 *     Full-screen analysis view for the given player.
 *     Fetches metrics from the backend, displays them in a summary panel,
 *     and lets the user stream a Full Analysis or Quick Tips response
 *     from the local Ollama/Llama3 instance.
 */

var ANALYSIS = (function() {

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    function showAnalysisScreen(player, onBack) {
        var app = document.getElementById('app');
        app.innerHTML = '';
        app.style.cssText = '';
        document.body.className = 'mode-stats';   // reuse stats screen layout

        // ---- Header ----
        var header = document.createElement('div');
        header.className = 'stats-header';

        var backBtn = document.createElement('button');
        backBtn.className = 'stats-back-btn';
        backBtn.type = 'button';
        backBtn.innerHTML = '&#8249; BACK';
        backBtn.addEventListener('click', onBack);

        var title = document.createElement('div');
        title.className = 'stats-header-title';
        title.textContent = player.name.toUpperCase() + ' — AI ANALYSIS';

        header.appendChild(backBtn);
        header.appendChild(title);
        app.appendChild(header);

        // ---- Main content area ----
        var content = document.createElement('div');
        content.className = 'analysis-content';
        app.appendChild(content);

        // Show loading state while fetching metrics
        content.innerHTML = '<div class="analysis-loading">LOADING METRICS...</div>';

        _fetchMetrics(player.id, function(err, metrics) {
            if (err) {
                content.innerHTML = '<div class="analysis-error">FAILED TO LOAD METRICS<br><small>' + _esc(err) + '</small></div>';
                return;
            }
            _buildAnalysisUI(content, player, metrics);
        });
    }

    // ------------------------------------------------------------------
    // Fetch metrics from backend
    // ------------------------------------------------------------------

    function _fetchMetrics(playerId, cb) {
        fetch((typeof APP_ROOT !== 'undefined' ? APP_ROOT : '') + '/api/players/' + playerId + '/analysis/metrics')
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function(data) { cb(null, data); })
            .catch(function(e)   { cb(e.message, null); });
    }

    // ------------------------------------------------------------------
    // Build the full UI once metrics are loaded
    // ------------------------------------------------------------------

    function _buildAnalysisUI(container, player, metrics) {
        container.innerHTML = '';

        // Two-column layout: metrics panel + AI panel
        var grid = document.createElement('div');
        grid.className = 'analysis-grid';

        // ---- Left: metrics summary ----
        var metricsPanel = document.createElement('div');
        metricsPanel.className = 'analysis-panel metrics-panel';

        var mTitle = document.createElement('div');
        mTitle.className = 'analysis-panel-title';
        mTitle.textContent = 'PERFORMANCE METRICS';
        metricsPanel.appendChild(mTitle);

        metricsPanel.appendChild(_buildMetricsContent(metrics));

        // ---- Right: AI panel ----
        var aiPanel = document.createElement('div');
        aiPanel.className = 'analysis-panel ai-panel';

        var aiTitle = document.createElement('div');
        aiTitle.className = 'analysis-panel-title';
        aiTitle.textContent = 'LLAMA 3 COACHING';
        aiPanel.appendChild(aiTitle);

        // Style selector
        var styleRow = document.createElement('div');
        styleRow.className = 'analysis-style-row';

        var fullBtn = document.createElement('button');
        fullBtn.className = 'analysis-style-btn active';
        fullBtn.type = 'button';
        fullBtn.textContent = 'FULL ANALYSIS';
        fullBtn.dataset.style = 'full';

        var tipsBtn = document.createElement('button');
        tipsBtn.className = 'analysis-style-btn';
        tipsBtn.type = 'button';
        tipsBtn.textContent = 'QUICK TIPS';
        tipsBtn.dataset.style = 'tips';

        var selectedStyle = 'full';

        function selectStyle(btn) {
            fullBtn.classList.remove('active');
            tipsBtn.classList.remove('active');
            btn.classList.add('active');
            selectedStyle = btn.dataset.style;
        }
        fullBtn.addEventListener('click', function() { selectStyle(fullBtn); });
        tipsBtn.addEventListener('click', function() { selectStyle(tipsBtn); });

        styleRow.appendChild(fullBtn);
        styleRow.appendChild(tipsBtn);
        aiPanel.appendChild(styleRow);

        // Skill level selector
        var skillRow = document.createElement('div');
        skillRow.className = 'analysis-skill-row';

        var skillLabel = document.createElement('span');
        skillLabel.className = 'analysis-skill-label';
        skillLabel.textContent = 'SKILL LEVEL';
        skillRow.appendChild(skillLabel);

        var skillBtns = document.createElement('div');
        skillBtns.className = 'analysis-skill-btns';

        var selectedSkill = 'beginner';
        var skillLevels = [
            { key: 'beginner',     label: 'BEGINNER' },
            { key: 'intermediate', label: 'INTERMEDIATE' },
            { key: 'advanced',     label: 'ADVANCED' },
        ];

        skillLevels.forEach(function(lvl) {
            var btn = document.createElement('button');
            btn.className = 'analysis-skill-btn' + (lvl.key === 'beginner' ? ' active' : '');
            btn.type = 'button';
            btn.textContent = lvl.label;
            btn.dataset.skill = lvl.key;
            btn.addEventListener('click', function() {
                skillBtns.querySelectorAll('.analysis-skill-btn').forEach(function(b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                selectedSkill = lvl.key;
            });
            skillBtns.appendChild(btn);
        });

        skillRow.appendChild(skillBtns);
        aiPanel.appendChild(skillRow);

        // Generate button
        var genBtn = document.createElement('button');
        genBtn.className = 'analysis-generate-btn';
        genBtn.type = 'button';
        genBtn.textContent = '⚡ GENERATE ANALYSIS';

        // Response display area
        var responseArea = document.createElement('div');
        responseArea.className = 'analysis-response';
        responseArea.textContent = 'Press Generate to get coaching feedback from Llama 3.';

        genBtn.addEventListener('click', function() {
            _streamAnalysis(player.id, selectedStyle, selectedSkill, metrics, genBtn, responseArea);
        });

        aiPanel.appendChild(genBtn);
        aiPanel.appendChild(responseArea);

        grid.appendChild(metricsPanel);
        grid.appendChild(aiPanel);
        container.appendChild(grid);
    }

    // ------------------------------------------------------------------
    // Build metrics summary content
    // ------------------------------------------------------------------

    function _buildMetricsContent(m) {
        var wrap = document.createElement('div');
        wrap.className = 'metrics-content';

        var scoring   = m.scoring   || {};
        var segments  = m.segments  || {};
        var doubles   = m.doubles   || {};
        var checkout  = m.checkout  || {};
        var busts     = m.busts     || {};
        var sample    = m.sample_size || {};
        var pos       = scoring.dart_position_avgs || {};
        var key       = segments.key_hit_pcts || {};
        var miss      = segments.miss_tendency || {};
        var ms        = scoring.milestones || {};

        function section(title, rows) {
            var card = document.createElement('div');
            card.className = 'metrics-card';
            var h = document.createElement('div');
            h.className = 'metrics-card-title';
            h.textContent = title;
            card.appendChild(h);
            rows.forEach(function(row) {
                var r = document.createElement('div');
                r.className = 'metrics-row';
                r.innerHTML = '<span class="metrics-label">' + _esc(row[0]) + '</span>'
                            + '<span class="metrics-value">' + _esc(String(row[1])) + '</span>';
                card.appendChild(r);
            });
            return card;
        }

        var sampleNote = document.createElement('div');
        sampleNote.className = 'metrics-sample-note';
        sampleNote.textContent = sample.total_throws + ' darts · ' + sample.legs_played + ' legs';
        wrap.appendChild(sampleNote);

        wrap.appendChild(section('SCORING', [
            ['3-dart average',      scoring.three_dart_avg || 0],
            ['Avg per dart',        scoring.avg_per_dart   || 0],
            ['Turn consistency σ',  scoring.turn_stddev    || 0],
            ['180s / 140+ / 100+',  (ms['180s']||0) + ' / ' + (ms['140plus']||0) + ' / ' + (ms['100plus']||0)],
        ]));

        wrap.appendChild(section('DART DROP-OFF', [
            ['Dart 1 avg',  pos[1] !== undefined ? pos[1] : 'N/A'],
            ['Dart 2 avg',  pos[2] !== undefined ? pos[2] : 'N/A'],
            ['Dart 3 avg',  pos[3] !== undefined ? pos[3] : 'N/A'],
            ['Drop-off 1→3', scoring.dart1_to_dart3_dropoff || 0],
        ]));

        wrap.appendChild(section('OPENING vs MID-LEG', [
            ['First turn avg',      scoring.first_turn_avg       || 0],
            ['Subsequent turn avg', scoring.subsequent_turn_avg  || 0],
            ['Difference',          scoring.first_vs_subsequent_diff || 0],
        ]));

        wrap.appendChild(section('SEGMENT ACCURACY', [
            ['Treble 20 %',  (key.treble_20 || 0) + '%'],
            ['Treble 19 %',  (key.treble_19 || 0) + '%'],
            ['20-bed %',     (key['20']     || 0) + '%'],
            ['Miss ratio (20)', (miss.aiming_20_miss_ratio || 0).toFixed(2)],
            ['Miss ratio (19)', (miss.aiming_19_miss_ratio || 0).toFixed(2)],
        ]));

        wrap.appendChild(section('DOUBLES & CHECKOUT', [
            ['Double hit %',     (doubles.hit_pct      || 0) + '%'],
            ['Checkout %',       (checkout.checkout_pct || 0) + '%'],
            ['Avg darts to win', checkout.avg_darts_to_win || 0],
            ['Range 41-170 %',   (((checkout.by_range||{})['41_to_170']||{}).pct || 0) + '%'],
            ['Range 2-40 %',     (((checkout.by_range||{})['2_to_40']  ||{}).pct || 0) + '%'],
        ]));

        wrap.appendChild(section('BUSTS', [
            ['Total busts',    busts.total         || 0],
            ['Bust rate',      (busts.bust_rate_pct || 0) + '%'],
            ['Avg score pre-bust', busts.avg_score_pre_bust || 0],
        ]));

        return wrap;
    }

    // ------------------------------------------------------------------
    // Stream analysis from Ollama
    // ------------------------------------------------------------------

    function _streamAnalysis(playerId, style, skillLevel, metrics, genBtn, responseArea) {
        genBtn.disabled = true;
        genBtn.textContent = '⏳ GENERATING...';
        responseArea.textContent = '';
        responseArea.className = 'analysis-response streaming';

        var accumulatedText = '';

        fetch((typeof APP_ROOT !== 'undefined' ? APP_ROOT : '') + '/api/players/' + playerId + '/analysis/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ style: style, skill_level: skillLevel, metrics: metrics }),
        })
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            function readChunk() {
                reader.read().then(function(result) {
                    if (result.done) {
                        _finaliseResponse(responseArea, accumulatedText);
                        genBtn.disabled = false;
                        genBtn.textContent = '⚡ REGENERATE';
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });

                    // Parse SSE lines
                    var lines = buffer.split('\n');
                    buffer = lines.pop(); // keep incomplete line

                    lines.forEach(function(line) {
                        if (line.indexOf('data: ') !== 0) return;
                        var payload = line.slice(6);
                        if (payload === '[DONE]') return;
                        if (payload.indexOf('[ERROR]') === 0) {
                            responseArea.textContent = payload.slice(8);
                            responseArea.className = 'analysis-response error';
                            return;
                        }
                        // Unescape newlines encoded for SSE transport
                        var token = payload.replace(/\\n/g, '\n');
                        accumulatedText += token;
                        // Render markdown live during streaming
                        responseArea.innerHTML = _renderMarkdown(accumulatedText);
                        // Auto-scroll to bottom as text streams in
                        responseArea.scrollTop = responseArea.scrollHeight;
                    });

                    readChunk();
                });
            }

            readChunk();
        })
        .catch(function(e) {
            responseArea.textContent = 'ERROR: ' + e.message + '\n\nMake sure Ollama is running: ollama serve';
            responseArea.className = 'analysis-response error';
            genBtn.disabled = false;
            genBtn.textContent = '⚡ RETRY';
        });
    }

    // ------------------------------------------------------------------
    // Markdown renderer
    // Converts the subset of markdown Llama3 commonly produces into HTML.
    // Runs both during streaming (live) and on final output.
    // ------------------------------------------------------------------

    function _renderMarkdown(text) {
        // 1. Escape raw HTML first so model output can't inject tags
        var s = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 2. Convert block-level elements line by line
        var lines  = s.split('\n');
        var output = [];
        var i      = 0;

        while (i < lines.length) {
            var line = lines[i];

            // Heading: ### ## #
            var hMatch = line.match(/^(#{1,3})\s+(.+)$/);
            if (hMatch) {
                var level = Math.min(hMatch[1].length + 2, 5); // h3-h5 (keep visual hierarchy subtle)
                output.push('<h' + level + ' class="ai-heading">' + _inlineMarkdown(hMatch[2]) + '</h' + level + '>');
                i++; continue;
            }

            // Horizontal rule: --- or ***
            if (/^(---+|\*\*\*+)$/.test(line.trim())) {
                output.push('<hr class="ai-hr">');
                i++; continue;
            }

            // Unordered list block: collect consecutive bullet lines
            if (/^[-*+]\s+/.test(line)) {
                output.push('<ul class="ai-list">');
                while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
                    output.push('<li>' + _inlineMarkdown(lines[i].replace(/^[-*+]\s+/, '')) + '</li>');
                    i++;
                }
                output.push('</ul>');
                continue;
            }

            // Ordered list block: collect consecutive numbered lines
            if (/^\d+\.\s+/.test(line)) {
                output.push('<ol class="ai-list">');
                while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
                    output.push('<li>' + _inlineMarkdown(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
                    i++;
                }
                output.push('</ol>');
                continue;
            }

            // Blank line — paragraph break
            if (line.trim() === '') {
                output.push('<div class="ai-spacer"></div>');
                i++; continue;
            }

            // Normal paragraph line
            output.push('<p class="ai-para">' + _inlineMarkdown(line) + '</p>');
            i++;
        }

        return output.join('');
    }

    // Inline markdown: bold, italic, inline code
    function _inlineMarkdown(s) {
        return s
            // Bold+italic: ***text***
            .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
            // Bold: **text** or __text__
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/__([^_]+)__/g, '<strong>$1</strong>')
            // Italic: *text* or _text_
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/_([^_]+)_/g, '<em>$1</em>')
            // Inline code: `code`
            .replace(/`([^`]+)`/g, '<code class="ai-code">$1</code>');
    }

    function _finaliseResponse(area, text) {
        area.className = 'analysis-response done';
        area.innerHTML = _renderMarkdown(text);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { showAnalysisScreen: showAnalysisScreen };

}());