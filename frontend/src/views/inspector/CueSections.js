import { formatTime, parseTime } from '../../utils.js';

export const CUE_COLORS = {
    A: '#ef4444',
    B: '#22c55e',
    C: '#3b82f6',
    D: '#f97316'
};

export function renderCueSection(container, project, context) {
    const cues = project?.cues || [];
    const { stateManager, cueController, createCollapsibleSection } = context;

    const { content: sectionContent } = createCollapsibleSection(
        container, 'cuePoints', 'Cue Points'
    );

    const list = document.createElement('div');
    list.className = 'space-y-2 mb-2';
    sectionContent.appendChild(list);

    ['A', 'B', 'C', 'D'].forEach(cueId => {
        const cue = cues.find(c => c.id === cueId) || { id: cueId, timeMs: null, enabled: false };
        const hasTime = cue.timeMs !== null;
        const selectedCue = stateManager?.get('ui.selectedCue');
        const isSelected = selectedCue === cueId;

        const row = document.createElement('div');
        row.className = `flex items-center gap-2 p-2 rounded border transition-colors cursor-pointer ${isSelected ? 'border-cyan-500 bg-cyan-500/10' : 'border-[var(--ui-border)] bg-[var(--ui-toolbar-bg)] hover:border-[var(--ui-border-hover)]'}`;

        row.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            cueController?.selectCue?.(cueId);
        });

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = cue.enabled;
        checkbox.disabled = !hasTime;
        checkbox.className = 'accent-cyan-500 cursor-pointer';
        checkbox.title = hasTime ? (cue.enabled ? 'Disable cue' : 'Enable cue') : 'Set cue time first';
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            cueController?.toggleCue?.(cueId);
        });
        row.appendChild(checkbox);

        const labelContainer = document.createElement('div');
        labelContainer.className = 'flex items-center gap-1.5 min-w-[40px]';

        const colorDot = document.createElement('span');
        colorDot.className = 'w-2.5 h-2.5 rounded-full';
        colorDot.style.backgroundColor = CUE_COLORS[cueId];
        labelContainer.appendChild(colorDot);

        const label = document.createElement('span');
        label.className = 'text-sm font-bold text-[var(--ui-text-strong)]';
        label.textContent = cueId;
        labelContainer.appendChild(label);

        row.appendChild(labelContainer);

        const timeDisplay = document.createElement('span');
        timeDisplay.className = `flex-1 text-xs font-mono ${hasTime ? 'text-[var(--ui-text)]' : 'text-[var(--ui-text-faint)]'}`;
        timeDisplay.textContent = hasTime ? formatTime(cue.timeMs) : '--:--.---';
        row.appendChild(timeDisplay);

        const setBtn = document.createElement('button');
        setBtn.className = 'px-2 py-0.5 text-xs bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded hover:border-cyan-500 hover:text-cyan-400 transition-colors';
        setBtn.textContent = 'Set';
        setBtn.title = 'Set cue at current playhead position';
        setBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cueController?.setCueAtPlayhead?.(cueId);
        });
        row.appendChild(setBtn);

        if (hasTime) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'px-2 py-0.5 text-xs text-[var(--ui-text-subtle)] hover:text-red-500 transition-colors';
            clearBtn.innerHTML = '<i class="fas fa-times"></i>';
            clearBtn.title = 'Clear cue';
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                cueController?.clearCue?.(cueId);
            });
            row.appendChild(clearBtn);
        }

        list.appendChild(row);
    });

    const helpText = document.createElement('div');
    helpText.className = 'text-xs text-[var(--ui-text-faint)] italic mt-2';
    helpText.textContent = 'Cue points allow live resync during performance. Right-click timeline ruler to set cues.';
    sectionContent.appendChild(helpText);
}

export function renderCueProperties(container, cueId, project, context) {
    const cues = project?.cues || [];
    const cue = cues.find(c => c.id === cueId);
    if (!cue) return;

    const { cueController } = context;
    const hasTime = cue.timeMs !== null;

    const header = document.createElement('div');
    header.className = 'flex items-center gap-2 font-bold text-[var(--ui-text-strong)] mb-4 border-b border-[var(--ui-border)] pb-2';

    const colorDot = document.createElement('span');
    colorDot.className = 'w-3 h-3 rounded-full';
    colorDot.style.backgroundColor = CUE_COLORS[cueId];
    header.appendChild(colorDot);

    const title = document.createElement('span');
    title.textContent = `CUE ${cueId}`;
    header.appendChild(title);

    container.appendChild(header);

    const backBtn = document.createElement('button');
    backBtn.className = 'flex items-center gap-1 text-xs text-[var(--ui-text-subtle)] hover:text-cyan-400 mb-4';
    backBtn.innerHTML = '<i class="fas fa-arrow-left"></i> Back to Project Settings';
    backBtn.addEventListener('click', () => {
        cueController?.selectCue?.(null);
    });
    container.appendChild(backBtn);

    const propsSection = document.createElement('div');
    propsSection.className = 'bg-[var(--ui-toolbar-bg)] p-3 rounded border border-[var(--ui-border)] mb-4';

    const statusRow = document.createElement('div');
    statusRow.className = 'flex items-center gap-2 mb-3';

    const statusLabel = document.createElement('span');
    statusLabel.className = 'text-xs text-[var(--ui-text-subtle)]';
    statusLabel.textContent = 'Status:';
    statusRow.appendChild(statusLabel);

    const statusBadge = document.createElement('span');
    if (!hasTime) {
        statusBadge.className = 'text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400';
        statusBadge.textContent = 'Not Set';
    } else if (cue.enabled) {
        statusBadge.className = 'text-xs px-2 py-0.5 rounded bg-green-900 text-green-400';
        statusBadge.textContent = 'Active';
    } else {
        statusBadge.className = 'text-xs px-2 py-0.5 rounded bg-yellow-900 text-yellow-400';
        statusBadge.textContent = 'Disabled';
    }
    statusRow.appendChild(statusBadge);
    propsSection.appendChild(statusRow);

    const timeRow = document.createElement('div');
    timeRow.className = 'mb-3';

    const timeLabel = document.createElement('label');
    timeLabel.className = 'block text-xs text-[var(--ui-text-subtle)] mb-1';
    timeLabel.textContent = 'Time (MM:SS.sss)';
    timeRow.appendChild(timeLabel);

    if (hasTime) {
        const timeInput = document.createElement('input');
        timeInput.type = 'text';
        timeInput.value = formatTime(cue.timeMs);
        timeInput.className = 'w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-2 py-1 outline-none font-mono';
        timeInput.addEventListener('change', (e) => {
            const newTime = parseTime(e.target.value);
            if (!isNaN(newTime)) {
                cueController?.setCue?.(cueId, newTime);
            }
        });
        timeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                timeInput.blur();
            }
        });
        timeRow.appendChild(timeInput);
    } else {
        const notSetMsg = document.createElement('div');
        notSetMsg.className = 'text-sm text-[var(--ui-text-faint)] italic';
        notSetMsg.textContent = 'Not set';
        timeRow.appendChild(notSetMsg);
    }

    propsSection.appendChild(timeRow);

    if (hasTime) {
        const enableRow = document.createElement('div');
        enableRow.className = 'flex items-center gap-2';

        const enableCheck = document.createElement('input');
        enableCheck.type = 'checkbox';
        enableCheck.checked = cue.enabled;
        enableCheck.className = 'accent-cyan-500 cursor-pointer';
        enableCheck.addEventListener('change', () => {
            cueController?.toggleCue?.(cueId);
        });
        enableRow.appendChild(enableCheck);

        const enableLabel = document.createElement('span');
        enableLabel.className = 'text-xs text-[var(--ui-text)]';
        enableLabel.textContent = 'Enabled';
        enableRow.appendChild(enableLabel);

        propsSection.appendChild(enableRow);
    }

    container.appendChild(propsSection);

    const actionsSection = document.createElement('div');
    actionsSection.className = 'space-y-2';

    const setBtn = document.createElement('button');
    setBtn.className = 'w-full py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition-colors';
    setBtn.innerHTML = '<i class="fas fa-crosshairs mr-1"></i> Set at Playhead';
    setBtn.addEventListener('click', () => {
        cueController?.setCueAtPlayhead?.(cueId);
    });
    actionsSection.appendChild(setBtn);

    if (hasTime && cue.enabled) {
        const jumpBtn = document.createElement('button');
        jumpBtn.className = 'w-full py-1.5 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] hover:border-cyan-500 text-[var(--ui-text)] rounded text-xs font-medium transition-colors';
        jumpBtn.innerHTML = '<i class="fas fa-play mr-1"></i> Jump to Cue';
        jumpBtn.addEventListener('click', () => {
            cueController?.jumpToCue?.(cueId);
        });
        actionsSection.appendChild(jumpBtn);
    }

    if (hasTime) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'w-full py-1.5 bg-red-900/80 hover:bg-red-700 border border-red-700/50 text-red-100 rounded text-xs font-medium transition-colors';
        clearBtn.innerHTML = '<i class="fas fa-trash-alt mr-1"></i> Clear Cue';
        clearBtn.addEventListener('click', () => {
            cueController?.clearCue?.(cueId);
        });
        actionsSection.appendChild(clearBtn);
    }

    container.appendChild(actionsSection);
}
