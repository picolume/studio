import { formatTime, parseTime } from '../../utils.js';
import { APP_EVENTS } from '../../core/AppEventHub.js';
import { renderCueSection } from './CueSections.js';

export function renderProjectSettings(container, project, context) {
    const {
        stateManager,
        createCollapsibleSection,
        addTextInput,
        ensureDefaultProfiles,
        renderHardwareProfiles,
        renderColorPalettes,
        renderPropGroups,
        emit
    } = context;

    if (!project.settings?.profiles || !project.settings?.patch) {
        ensureDefaultProfiles?.();
    }

    container.innerHTML = '<div class="font-bold text-[var(--ui-text-strong)] mb-2 border-b border-[var(--ui-border)] pb-2">PROJECT SETTINGS</div>';

    const { content: infoContent } = createCollapsibleSection(container, 'projectInfo', 'Project Info');
    const infoDiv = document.createElement('div');
    infoDiv.className = 'bg-[var(--ui-toolbar-bg)] p-2 rounded border border-[var(--ui-border)]';

    addTextInput(infoDiv, 'Project Name', project.name || 'My Show', (val) => {
        stateManager?.update(draft => {
            draft.project.name = val;
            draft.isDirty = true;
        }, { skipHistory: true });
    });

    const durLbl = document.createElement('label');
    durLbl.className = 'block text-xs text-[var(--ui-text-subtle)] mb-1';
    durLbl.innerText = 'Duration (MM:SS.ss)';
    infoDiv.appendChild(durLbl);

    const durRow = document.createElement('div');
    durRow.className = 'flex gap-2';

    const durInp = document.createElement('input');
    durInp.type = 'text';
    durInp.className = 'flex-1 bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-1 py-1 outline-none';
    const durFormatted = formatTime(project.duration || 60000);
    durInp.setAttribute('value', durFormatted);
    durInp.value = durFormatted;

    const applyDuration = () => {
        let val = parseTime(durInp.value);
        if (isNaN(val) || val < 1000) val = 60000;
        stateManager?.update(draft => {
            draft.project.duration = val;
            draft.isDirty = true;
        });
        emit?.(APP_EVENTS.TOAST, `Duration set to ${formatTime(val)}`);
    };

    durInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyDuration();
        }
    });

    const updateBtn = document.createElement('button');
    updateBtn.className = 'px-3 py-1 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded text-xs text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] cursor-pointer';
    updateBtn.innerText = 'Set';
    updateBtn.onmousedown = (e) => {
        e.stopPropagation();
        e.preventDefault();
        applyDuration();
    };
    durRow.appendChild(durInp);
    durRow.appendChild(updateBtn);
    infoDiv.appendChild(durRow);

    const autoSaveDiv = document.createElement('div');
    autoSaveDiv.className = 'flex items-center gap-2 mt-3 pt-2 border-t border-[var(--ui-border)]';

    const asCheck = document.createElement('input');
    asCheck.type = 'checkbox';
    asCheck.className = 'accent-cyan-500 cursor-pointer';
    const autoSaveEnabled = stateManager?.get('autoSaveEnabled');
    asCheck.checked = autoSaveEnabled !== undefined ? autoSaveEnabled : true;
    asCheck.onchange = (e) => {
        const enabled = e.target.checked;
        stateManager?.update(draft => {
            draft.autoSaveEnabled = enabled;
        }, { skipHistory: true });
        emit?.(APP_EVENTS.TOAST, `Auto Save: ${enabled ? 'ON' : 'OFF'}`);
    };

    const asLabel = document.createElement('label');
    asLabel.innerText = 'Enable Auto-Save';
    asLabel.className = 'text-xs text-[var(--ui-text)]';
    autoSaveDiv.appendChild(asCheck);
    autoSaveDiv.appendChild(asLabel);
    infoDiv.appendChild(autoSaveDiv);
    infoContent.appendChild(infoDiv);

    renderHardwareProfiles?.(container, project);
    renderColorPalettes?.(container, project);
    renderPropGroups?.(container, project);
    renderCueSection(container, project, context);
}
