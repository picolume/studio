/**
 * BinaryInspector - UI controller for the show.bin inspector modal
 */

import {
    parseShowBin,
    validateShowBin,
    exportAsJSON,
    exportAsCSV,
    fmtHex,
    fmtRgb,
    fmtTime,
    fmtDuration,
    fmtBytes,
    eventTargetsProp,
    EFFECT,
    LED_TYPE,
    COLOR_ORDER,
    TOTAL_PROPS,
} from '../core/ShowBinParser.js';

/**
 * Initialize the binary inspector modal
 */
export function initBinaryInspector() {
    const els = {
        modal: document.getElementById('inspector-modal'),
        closeBtn: document.getElementById('btn-inspector-close'),
        dropZone: document.getElementById('inspector-drop-zone'),
        fileInput: document.getElementById('inspector-file'),
        status: document.getElementById('inspector-status'),
        statusText: document.getElementById('inspector-status-text'),
        error: document.getElementById('inspector-error'),
        stats: document.getElementById('inspector-stats'),
        statEvents: document.getElementById('inspector-stat-events'),
        statDuration: document.getElementById('inspector-stat-duration'),
        statProps: document.getElementById('inspector-stat-props'),
        statSize: document.getElementById('inspector-stat-size'),
        details: document.getElementById('inspector-details'),
        header: document.getElementById('inspector-header'),
        propconfig: document.getElementById('inspector-propconfig'),
        propSelect: document.getElementById('inspector-prop-select'),
        validation: document.getElementById('inspector-validation'),
        validationCount: document.getElementById('inspector-validation-count'),
        warnings: document.getElementById('inspector-warnings'),
        eventsPanel: document.getElementById('inspector-events-panel'),
        eventsTbody: document.getElementById('inspector-events-tbody'),
        filterProp: document.getElementById('inspector-filter-prop'),
        exportJsonBtn: document.getElementById('btn-inspector-export-json'),
        exportCsvBtn: document.getElementById('btn-inspector-export-csv'),
    };

    let state = {
        bytes: null,
        parsed: null,
        filename: null,
        selectedProp: 1,
    };

    // ===== STATUS HELPERS =====
    function setStatus(kind, text) {
        els.statusText.textContent = text;
        els.status.classList.remove('ok', 'error');
        if (kind) els.status.classList.add(kind);
    }

    function showError(msg) {
        els.error.textContent = msg;
        els.error.style.display = 'block';
        setStatus('error', 'Parse error');
    }

    function clearError() {
        els.error.style.display = 'none';
        els.error.textContent = '';
    }

    // ===== RENDERING =====
    function renderStats() {
        if (!state.parsed || state.parsed.error) {
            els.stats.style.display = 'none';
            return;
        }

        els.stats.style.display = 'grid';
        const { stats } = state.parsed;
        els.statEvents.textContent = stats.totalEvents;
        els.statDuration.textContent = fmtDuration(stats.duration);
        els.statProps.textContent = stats.configuredProps;
        els.statSize.textContent = fmtBytes(stats.fileSize);
    }

    function renderHeader() {
        if (!state.parsed || state.parsed.error) {
            els.details.style.display = 'none';
            return;
        }

        els.details.style.display = 'grid';
        const { header } = state.parsed;

        els.header.innerHTML = `
            <div class="inspector-kv">
                <span class="inspector-kv-key">Magic</span>
                <span class="inspector-kv-value">${fmtHex(header.magic)} (OK)</span>
                <span class="inspector-kv-key">Version</span>
                <span class="inspector-kv-value">${header.version}</span>
                <span class="inspector-kv-key">Event Count</span>
                <span class="inspector-kv-value">${header.eventCount}</span>
                <span class="inspector-kv-key">Reserved</span>
                <span class="inspector-kv-value">8 bytes (offset 8-15)</span>
            </div>
        `;
    }

    function renderPropConfig() {
        if (!state.parsed || state.parsed.error) return;

        const propId = state.selectedProp;
        const cfg = state.parsed.propConfigs.find(c => c.propId === propId);

        if (!cfg) {
            els.propconfig.innerHTML = '<div class="inspector-kv-value muted">PropConfig not available</div>';
            return;
        }

        const ledTypeName = LED_TYPE[cfg.ledType] ?? `UNKNOWN(${cfg.ledType})`;
        const orderName = COLOR_ORDER[cfg.colorOrder] ?? `UNKNOWN(${cfg.colorOrder})`;
        const freq = cfg.ledType === 3 ? '400kHz' : '800kHz';
        const rgbw = cfg.ledType === 2 ? 'true' : 'false';

        els.propconfig.innerHTML = `
            <div class="inspector-kv">
                <span class="inspector-kv-key">LED Count</span>
                <span class="inspector-kv-value">${cfg.ledCount}</span>
                <span class="inspector-kv-key">LED Type</span>
                <span class="inspector-kv-value">${cfg.ledType} (${ledTypeName})</span>
                <span class="inspector-kv-key">Color Order</span>
                <span class="inspector-kv-value">${cfg.colorOrder} (${orderName})</span>
                <span class="inspector-kv-key">Brightness Cap</span>
                <span class="inspector-kv-value">${cfg.brightnessCap} (${Math.round((cfg.brightnessCap / 255) * 100)}%)</span>
                <span class="inspector-kv-key">Derived</span>
                <span class="inspector-kv-value">rgbw=${rgbw} · freq=${freq}</span>
            </div>
        `;
    }

    function renderPropSelect() {
        if (!state.parsed || state.parsed.error) return;

        const configured = state.parsed.propConfigs.filter(c => c.ledCount > 0);

        // Build options
        let html = '';
        for (const cfg of configured) {
            const selected = cfg.propId === state.selectedProp ? 'selected' : '';
            html += `<option value="${cfg.propId}" ${selected}>Prop ${cfg.propId} (${cfg.ledCount} LEDs)</option>`;
        }

        // If no configured props, show all
        if (configured.length === 0) {
            for (let i = 1; i <= Math.min(10, TOTAL_PROPS); i++) {
                const selected = i === state.selectedProp ? 'selected' : '';
                html += `<option value="${i}" ${selected}>Prop ${i}</option>`;
            }
        }

        els.propSelect.innerHTML = html;
    }

    function renderValidation() {
        if (!state.parsed || state.parsed.error) {
            els.validation.style.display = 'none';
            return;
        }

        const warnings = validateShowBin(state.parsed);

        if (warnings.length === 0) {
            els.validation.style.display = 'none';
            return;
        }

        els.validation.style.display = 'block';
        els.validationCount.textContent = warnings.length;

        const icons = { error: 'fa-circle-xmark', warn: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        els.warnings.innerHTML = warnings.slice(0, 20).map(w => `
            <li class="inspector-warning ${w.type}">
                <i class="fas ${icons[w.type]}"></i>
                <span>${w.message}</span>
            </li>
        `).join('');

        if (warnings.length > 20) {
            els.warnings.innerHTML += `<li class="inspector-warning info">... and ${warnings.length - 20} more</li>`;
        }
    }

    function renderEvents() {
        if (!state.parsed || state.parsed.error) {
            els.eventsPanel.style.display = 'none';
            return;
        }

        els.eventsPanel.style.display = 'block';
        const propId = state.selectedProp;
        const filterByProp = els.filterProp?.checked;

        let events = state.parsed.events;
        if (filterByProp) {
            events = events.filter(e => eventTargetsProp(e, propId));
        }

        if (events.length === 0) {
            els.eventsTbody.innerHTML = '<tr><td colspan="9" class="inspector-empty">No events match filter</td></tr>';
            return;
        }

        // Limit display to 100 events
        const displayEvents = events.slice(0, 100);

        els.eventsTbody.innerHTML = displayEvents.map(e => {
            const effect = EFFECT[e.effectCode] || { name: `UNKNOWN(${e.effectCode})`, icon: 'fa-question', color: '#666', usesColor2: true };
            const speedVal = (e.speed / 50).toFixed(1) + 'x';
            const widthVal = Math.round(e.width / 255 * 100) + '%';
            const color2Class = effect.usesColor2 ? '' : 'muted';

            return `
                <tr>
                    <td>${e.index}</td>
                    <td>${fmtTime(e.start)}</td>
                    <td>${fmtTime(e.dur)}</td>
                    <td>
                        <span class="inspector-effect">
                            <span class="inspector-effect-icon" style="background: ${effect.color};">
                                <i class="fas ${effect.icon}" style="color: #000;"></i>
                            </span>
                            ${effect.name}
                        </span>
                    </td>
                    <td><span class="inspector-swatch" style="background: ${fmtRgb(e.color1)};"></span>${fmtRgb(e.color1)}</td>
                    <td class="${color2Class}"><span class="inspector-swatch" style="background: ${fmtRgb(e.color2)};"></span>${fmtRgb(e.color2)}</td>
                    <td>${speedVal}</td>
                    <td>${widthVal}</td>
                    <td>${e.propCount}</td>
                </tr>
            `;
        }).join('');

        if (events.length > displayEvents.length) {
            els.eventsTbody.innerHTML += `<tr><td colspan="9" class="inspector-empty">Showing ${displayEvents.length}/${events.length} events</td></tr>`;
        }
    }

    function renderAll() {
        renderStats();
        renderHeader();
        renderPropSelect();
        renderPropConfig();
        renderValidation();
        renderEvents();
    }

    // ===== FILE HANDLING =====
    async function loadFile(file) {
        clearError();
        state.bytes = null;
        state.parsed = null;
        state.filename = file?.name || null;

        if (!file) {
            setStatus(null, 'Select or drop a file...');
            hideAllPanels();
            return;
        }

        setStatus(null, 'Reading file...');

        try {
            const ab = await file.arrayBuffer();
            state.bytes = new Uint8Array(ab);
            state.parsed = parseShowBin(state.bytes);

            if (state.parsed.error) {
                showError(state.parsed.error);
                hideAllPanels();
                return;
            }

            setStatus('ok', `Parsed V${state.parsed.header.version} (${state.parsed.events.length} events)`);
            renderAll();
        } catch (err) {
            showError(String(err?.message || err));
            hideAllPanels();
        }
    }

    function hideAllPanels() {
        els.stats.style.display = 'none';
        els.details.style.display = 'none';
        els.validation.style.display = 'none';
        els.eventsPanel.style.display = 'none';
    }

    function reset() {
        state.bytes = null;
        state.parsed = null;
        state.filename = null;
        state.selectedProp = 1;
        clearError();
        setStatus(null, 'Select or drop a file...');
        hideAllPanels();
        if (els.fileInput) els.fileInput.value = '';
        if (els.filterProp) els.filterProp.checked = false;
    }

    // ===== EXPORT =====
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function handleExportJSON() {
        if (!state.parsed || state.parsed.error) return;
        const data = exportAsJSON(state.parsed);
        if (!data) return;
        const filename = `${state.filename || 'show'}_export.json`;
        downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
    }

    function handleExportCSV() {
        if (!state.parsed || state.parsed.error) return;
        const csv = exportAsCSV(state.parsed);
        if (!csv) return;
        const filename = `${state.filename || 'show'}_export.csv`;
        downloadFile(csv, filename, 'text/csv');
    }

    // ===== MODAL CONTROL =====
    function openModal() {
        els.modal.classList.add('active');
        els.modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        els.modal.classList.remove('active');
        els.modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        reset();
    }

    // ===== EVENT LISTENERS =====

    // Close button
    els.closeBtn?.addEventListener('click', closeModal);

    // Click outside to close
    els.modal?.addEventListener('click', (e) => {
        if (e.target === els.modal) closeModal();
    });

    // Escape key to close
    els.modal?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // File input
    els.fileInput?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) loadFile(file);
    });

    // Drop zone click
    els.dropZone?.addEventListener('click', () => {
        els.fileInput?.click();
    });

    // Drag & drop
    els.dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropZone.classList.add('drag-over');
    });

    els.dropZone?.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropZone.classList.remove('drag-over');
    });

    els.dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file) {
            els.fileInput.value = '';
            loadFile(file);
        }
    });

    // Prop selector
    els.propSelect?.addEventListener('change', (e) => {
        state.selectedProp = parseInt(e.target.value) || 1;
        renderPropConfig();
        renderEvents();
    });

    // Filter checkbox
    els.filterProp?.addEventListener('change', () => {
        renderEvents();
    });

    // Export buttons
    els.exportJsonBtn?.addEventListener('click', handleExportJSON);
    els.exportCsvBtn?.addEventListener('click', handleExportCSV);

    // Return the open function for external use
    return {
        open: openModal,
        close: closeModal,
        loadBytes: (bytes, filename = 'show.bin') => {
            state.bytes = bytes;
            state.filename = filename;
            state.parsed = parseShowBin(bytes);

            if (state.parsed.error) {
                showError(state.parsed.error);
                hideAllPanels();
                return;
            }

            setStatus('ok', `Parsed V${state.parsed.header.version} (${state.parsed.events.length} events)`);
            renderAll();
        },
    };
}
