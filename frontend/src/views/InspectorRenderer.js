import { formatTime, parseTime, parseIdString, validateIdString, findProfileOverlaps, formatProfileOverlaps } from '../utils.js';
import {
    LED_TYPES,
    LED_TYPE_LABELS,
    COLOR_ORDERS,
    COLOR_ORDER_LABELS,
    createDefaultProfile,
    migrateProfile,
    clampProfileValue
} from '../core/StateManager.js';

export class InspectorRenderer {
    constructor(deps) {
        this.deps = deps;
    }

    get stateManager() { return this.deps.stateManager; }
    get timelineController() { return this.deps.timelineController; }
    get elements() { return this.deps.elements; }
    get ui() { return this.deps.ui; } // For toast methods

    render(clipId) {
        const container = this.elements.inspector || document.getElementById('inspector-content');
        if (!container) return;
        container.innerHTML = '';

        const project = this.stateManager.get('project');
        if (!project) return;

        const selection = this.stateManager.get('selection') || [];

        // --- WINNER: MULTIPLE SELECTION ---
        if (selection.length > 1) {
            this._renderMultiSelection(container, selection);
            return;
        }

        // --- WINNER: NO SELECTION (GLOBAL SETTINGS) ---
        if (!clipId && selection.length === 0) {
            this._renderProjectSettings(container, project);
            return;
        }

        // --- WINNER: SINGLE CLIP ---
        // If we have a clipId passed in, OR a single selection
        const targetId = clipId || selection[0];
        if (targetId) {
            this._renderClipProperties(container, targetId, project);
        }
    }

    _renderMultiSelection(container, selection) {
        container.innerHTML = `<div class="font-bold text-[var(--ui-text-strong)] mb-2 border-b border-[var(--ui-border)] pb-2">MULTIPLE CLIPS</div>`;
        container.insertAdjacentHTML('beforeend', `<div class="text-xs text-[var(--ui-text-subtle)] italic mb-4">${selection.length} clips selected</div>`);
        const del = document.createElement('button');
        del.innerText = "Delete Selected";
        del.className = "w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs";
        del.onclick = () => {
            if (this.timelineController?.deleteSelected) {
                this.timelineController.deleteSelected();
                // Note: The controller will dispatch events to trigger timeline rebuild
            }
        };
        container.appendChild(del);
    }

    _renderProjectSettings(container, project) {
        // --- SAFEGUARD --- (from original code)
        if (!project.settings?.profiles || !project.settings?.patch) {
            // This should technically be in a controller, but it's initialization logic
            this._ensureDefaultProfiles();
        }

        container.innerHTML = `<div class="font-bold text-[var(--ui-text-strong)] mb-2 border-b border-[var(--ui-border)] pb-2">PROJECT SETTINGS</div>`;

        // --- Project Info ---
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Project Info</div>`);
        const infoDiv = document.createElement('div');
        infoDiv.className = "bg-[var(--ui-toolbar-bg)] p-2 rounded mb-4 border border-[var(--ui-border)]";

        this._addTextInput(infoDiv, "Project Name", project.name || "My Show", (val) => {
            this.stateManager?.update(draft => {
                draft.project.name = val;
                draft.isDirty = true;
            }, { skipHistory: true });
        });

        const durLbl = document.createElement('label'); durLbl.className = "block text-xs text-[var(--ui-text-subtle)] mb-1"; durLbl.innerText = "Duration (MM:SS.ss)"; infoDiv.appendChild(durLbl);
        const durRow = document.createElement('div'); durRow.className = "flex gap-2";
        const durInp = document.createElement('input'); durInp.type = "text";
        durInp.className = "flex-1 bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-1 py-1 outline-none";
        const durFormatted = formatTime(project.duration || 60000);
        durInp.setAttribute('value', durFormatted); durInp.value = durFormatted;

        const applyDuration = () => {
            let val = parseTime(durInp.value);
            if (isNaN(val) || val < 1000) val = 60000;
            this.stateManager?.update(draft => {
                draft.project.duration = val;
                draft.isDirty = true;
            });
            window.dispatchEvent(new CustomEvent('app:toast', { detail: `Duration set to ${formatTime(val)}` }));
            // app:state-changed will trigger timeline rebuild
        };

        durInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyDuration(); } });
        const updateBtn = document.createElement('button');
        updateBtn.className = "px-3 py-1 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded text-xs text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] cursor-pointer";
        updateBtn.innerText = "Set";
        updateBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); applyDuration(); };
        durRow.appendChild(durInp); durRow.appendChild(updateBtn); infoDiv.appendChild(durRow);

        // Auto Save
        const autoSaveDiv = document.createElement('div');
        autoSaveDiv.className = "flex items-center gap-2 mt-3 pt-2 border-t border-[var(--ui-border)]";
        const asCheck = document.createElement('input');
        asCheck.type = "checkbox";
        asCheck.className = "accent-cyan-500 cursor-pointer";
        const autoSaveEnabled = this.stateManager?.get('autoSaveEnabled');
        asCheck.checked = (autoSaveEnabled !== undefined) ? autoSaveEnabled : true;
        asCheck.onchange = (e) => {
            const enabled = e.target.checked;
            this.stateManager?.update(draft => {
                draft.autoSaveEnabled = enabled;
            }, { skipHistory: true });
            window.dispatchEvent(new CustomEvent('app:toast', { detail: `Auto Save: ${enabled ? 'ON' : 'OFF'}` }));
        };
        const asLabel = document.createElement('label'); asLabel.innerText = "Enable Auto-Save"; asLabel.className = "text-xs text-[var(--ui-text)]";
        autoSaveDiv.appendChild(asCheck); autoSaveDiv.appendChild(asLabel); infoDiv.appendChild(autoSaveDiv);
        container.appendChild(infoDiv);

        // Hardware Profiles
        this._renderHardwareProfiles(container, project);

        // Groups
        this._renderPropGroups(container, project);
    }

    _renderHardwareProfiles(container, project) {
        const profiles = (project?.settings?.profiles || []);

        // Check for profile conflicts
        const conflicts = findProfileOverlaps(profiles);
        const hasConflicts = conflicts.length > 0;

        // Header with optional warning indicator
        const header = document.createElement('div');
        header.className = "text-xs font-bold text-cyan-400 mb-2 uppercase flex items-center gap-2";
        header.innerHTML = 'Hardware Profiles';
        if (hasConflicts) {
            const warning = document.createElement('span');
            warning.className = "text-red-500 cursor-help";
            warning.innerHTML = '⚠';
            warning.title = `Prop ID conflicts detected:\n${formatProfileOverlaps(conflicts, profiles)}\n\nExport/Upload will be blocked until resolved.`;
            header.appendChild(warning);
        }
        container.appendChild(header);

        // Show conflict details if present
        if (hasConflicts) {
            const conflictBox = document.createElement('div');
            conflictBox.className = "bg-red-900/30 border border-red-500/50 rounded p-2 mb-2 text-xs text-red-300";
            conflictBox.innerHTML = `<strong>Conflict:</strong> ${formatProfileOverlaps(conflicts, profiles).replace(/\n/g, '<br>')}`;
            container.appendChild(conflictBox);
        }

        const list = document.createElement('div');
        list.className = "space-y-2 mb-2 relative";
        container.appendChild(list);

        let draggingProfileId = null;
        const interactiveSelector = 'input, textarea, select, button, a, [contenteditable="true"]';
        const isInteractiveDragTarget = (target) => {
            if (!target || !(target instanceof Element)) return false;
            return Boolean(target.closest(interactiveSelector));
        };
        const isDragFromInteractiveArea = (evt, cardEl) => {
            const path = typeof evt.composedPath === 'function' ? evt.composedPath() : [];
            for (const node of path) {
                if (!(node instanceof Element)) continue;
                if (node === cardEl) break;
                if (node.matches(interactiveSelector)) return true;
            }
            return false;
        };

        let dropTargetEl = null;
        const clearDropIndicators = () => {
            dropTargetEl?.classList.remove('dnd-drop-target');
            dropTargetEl = null;
            list.classList.remove('dnd-drop-end');
        };

        const getDragAfterElement = (y) => {
            const items = [...list.querySelectorAll('[data-profile-id]')];
            const INSERT_BEFORE_FRACTION = 0.75;
            let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
            for (const child of items) {
                if (child.dataset.profileId === draggingProfileId) continue;
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height * INSERT_BEFORE_FRACTION;
                if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
            }
            return closest.element;
        };

        list.addEventListener('dragover', (e) => {
            if (!draggingProfileId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const afterEl = getDragAfterElement(e.clientY);
            if (!afterEl) {
                if (!list.classList.contains('dnd-drop-end')) {
                    clearDropIndicators();
                    list.classList.add('dnd-drop-end');
                }
                return;
            }
            if (list.classList.contains('dnd-drop-end') || afterEl !== dropTargetEl) {
                clearDropIndicators();
                dropTargetEl = afterEl;
                dropTargetEl?.classList.add('dnd-drop-target');
            }
        });

        list.addEventListener('drop', (e) => {
            if (!draggingProfileId) return;
            e.preventDefault();

            const afterEl = getDragAfterElement(e.clientY);
            const insertBeforeId = afterEl?.dataset?.profileId || null;
            const draggedId = draggingProfileId;

            this.stateManager?.update(draft => {
                const arr = (draft.project.settings.profiles || []).slice();
                const fromIndex = arr.findIndex(p => p?.id === draggedId);
                if (fromIndex < 0) return;

                const toIndexRaw = insertBeforeId
                    ? arr.findIndex(p => p?.id === insertBeforeId)
                    : arr.length;
                if (toIndexRaw < 0) return;

                const [item] = arr.splice(fromIndex, 1);
                const toIndex = fromIndex < toIndexRaw ? (toIndexRaw - 1) : toIndexRaw;
                arr.splice(toIndex, 0, item);

                draft.project.settings.profiles = arr;
                draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                draft.isDirty = true;
            });

            draggingProfileId = null;
            clearDropIndicators();
            this.render(null);
        });

        profiles.forEach((profile) => {
            // Ensure profile has all fields (migration for older projects)
            const p = migrateProfile(profile);

            const card = document.createElement('div');
            card.className = "bg-[var(--ui-toolbar-bg)] p-3 rounded border border-[var(--ui-border)] relative group overflow-hidden cursor-grab active:cursor-grabbing";
            card.dataset.profileId = p.id;
            card.title = "Drag to reorder";
            card.draggable = false;
            card.addEventListener('pointerdown', (e) => {
                card.draggable = !isInteractiveDragTarget(e.target);
            }, { capture: true });
            card.addEventListener('pointerup', () => {
                card.draggable = false;
            }, { capture: true });
            card.addEventListener('pointercancel', () => {
                card.draggable = false;
            }, { capture: true });
            card.addEventListener('dragstart', (e) => {
                if (!card.draggable || isDragFromInteractiveArea(e, card)) {
                    e.preventDefault();
                    card.draggable = false;
                    return;
                }
                draggingProfileId = p.id;
                card.classList.add('dnd-dragging');
                clearDropIndicators();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', p.id);
            });
            card.addEventListener('dragend', () => {
                draggingProfileId = null;
                card.classList.remove('dnd-dragging');
                clearDropIndicators();
                card.draggable = false;
            });

            // Header row: name + action buttons
            const header = document.createElement('div');
            header.className = "flex items-center gap-2 mb-2 min-w-0";

            const pName = document.createElement('input');
            pName.className = "bg-transparent text-sm font-bold text-[var(--ui-text-strong)] outline-none flex-1 min-w-0 border-b border-transparent focus:border-[var(--accent)]";
            pName.value = p.name || "Profile";
            pName.oninput = (e) => {
                this.stateManager?.update(draft => {
                    const prof = (draft.project.settings.profiles || []).find(x => x.id === p.id);
                    if (prof) { prof.name = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
            };
            pName.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); pName.blur(); } };
            header.appendChild(pName);

            const actions = document.createElement('div');
            actions.className = "flex items-center gap-2 shrink-0";

            // Gear icon for detailed settings
            const gearBtn = document.createElement('button');
            gearBtn.innerHTML = "<i class='fas fa-cog'></i>";
            gearBtn.className = "text-[var(--ui-text-subtle)] hover:text-cyan-400 transition-colors";
            gearBtn.title = "Edit hardware details";
            gearBtn.onclick = () => this._openProfileModal(p.id);
            actions.appendChild(gearBtn);

            // Delete button (only if more than one profile)
            if (profiles.length > 1) {
                const del = document.createElement('button');
                del.innerHTML = "<i class='fas fa-times'></i>";
                del.className = "text-[var(--ui-text-subtle)] hover:text-red-500 transition-colors";
                del.title = "Delete profile";
                del.onclick = () => {
                    this.stateManager?.update(draft => {
                        draft.project.settings.profiles = draft.project.settings.profiles.filter(x => x.id !== p.id);
                        draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                        draft.isDirty = true;
                    });
                    this.render(null);
                };
                actions.appendChild(del);
            }
            header.appendChild(actions);
            card.appendChild(header);

            // Summary info row: LED spec with labeled values
            const ledTypeName = this._getLedTypeName(p.ledType);
            const brightnessPercent = Math.round((p.brightnessCap / 255) * 100);
            const specRow = document.createElement('div');
            specRow.className = "text-xs text-[var(--ui-text-subtle)]";
            specRow.innerHTML = `LED: <span class="text-[var(--ui-text)]">${p.ledCount}</span> <span class="mx-1 text-[var(--ui-text-faint)]">&bull;</span> Type: <span class="text-[var(--ui-text)]">${ledTypeName}</span> <span class="mx-1 text-[var(--ui-text-faint)]">&bull;</span> Max: <span class="text-[var(--ui-text)]">${brightnessPercent}%</span>`;
            card.appendChild(specRow);

            // Summary info row 2: Assigned IDs
            const idsContainer = document.createElement('div');
            idsContainer.className = "mt-2";

            const idsRow = document.createElement('div');
            idsRow.className = "flex items-center gap-2";
            idsRow.innerHTML = `<span class="text-xs text-[var(--ui-text-subtle)]">Props:</span>`;

            const idInp = document.createElement('input');
            idInp.className = "bg-[var(--ui-select-bg)] text-xs text-[var(--ui-text)] rounded px-2 py-1 flex-1 outline-none border border-[var(--ui-border)] font-mono";
            idInp.value = p.assignedIds || "";
            idInp.placeholder = "1-10, 15";

            const idError = document.createElement('div');
            idError.className = "text-xs text-red-400 mt-1 hidden";

            const updateValidation = (value) => {
                const validation = validateIdString(value);
                if (!validation.valid) {
                    idInp.classList.add('border-red-500');
                    idError.textContent = validation.message;
                    idError.classList.remove('hidden');
                } else {
                    idInp.classList.remove('border-red-500');
                    idError.classList.add('hidden');
                }
            };

            idInp.oninput = (e) => {
                updateValidation(e.target.value);
                this.stateManager?.update(draft => {
                    const prof = (draft.project.settings.profiles || []).find(x => x.id === p.id);
                    if (prof) {
                        prof.assignedIds = e.target.value;
                        draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
            };
            idInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); idInp.blur(); } };
            idInp.onblur = () => { this.render(null); }; // Re-render to update conflict display

            idsRow.appendChild(idInp);
            idsContainer.appendChild(idsRow);
            idsContainer.appendChild(idError);
            card.appendChild(idsContainer);

            list.appendChild(card);
        });

        const addBtn = document.createElement('button');
        addBtn.className = "w-full py-1.5 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded text-xs text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] mb-4";
        addBtn.innerHTML = "<i class='fas fa-plus mr-1 text-[10px] relative -top-px'></i> Add Profile";
        addBtn.onclick = () => {
            this.stateManager?.update(draft => {
                if (!draft.project.settings.profiles) draft.project.settings.profiles = [];
                const newProfile = createDefaultProfile('p_' + Date.now(), 'New Hardware', 164, '');
                draft.project.settings.profiles.push(newProfile);
                draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                draft.isDirty = true;
            });
            this.render(null);
        };
        container.appendChild(addBtn);
    }

    /**
     * Get short LED type name for display
     */
    _getLedTypeName(ledType) {
        switch (ledType) {
            case LED_TYPES.WS2812B: return 'WS2812B';
            case LED_TYPES.SK6812: return 'SK6812';
            case LED_TYPES.SK6812_RGBW: return 'SK6812 RGBW';
            case LED_TYPES.WS2811: return 'WS2811';
            case LED_TYPES.WS2813: return 'WS2813';
            case LED_TYPES.WS2815: return 'WS2815';
            default: return 'WS2812B';
        }
    }

    /**
     * Open profile edit modal with all hardware details
     */
    _openProfileModal(profileId) {
        const current = (this.stateManager?.get('project.settings.profiles') || []).find(p => p?.id === profileId);
        if (!current) return;
        const profile = migrateProfile(current);

        // Create modal overlay
        const overlay = document.createElement('div');
        // Don't use the app's `.modal-overlay`/`.modal-panel` classes here: they default to `display:none`
        // unless `aria-hidden="false"` is set and they enforce a large iframe-oriented layout.
        overlay.className = "fixed inset-0 bg-[var(--overlay-bg)] flex items-center justify-center z-[2100] p-6";
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Hardware Profile Settings');

        const close = () => {
            overlay.remove();
            this.render(null);
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };

        const panel = document.createElement('div');
        panel.className = "bg-[var(--ui-panel-bg)] border border-[var(--ui-border)] rounded-lg shadow-2xl w-full max-w-md";

        // Header
        const header = document.createElement('div');
        header.className = "flex items-center justify-between p-4 border-b border-[var(--ui-border)]";
        header.innerHTML = `
            <h2 class="text-sm font-bold text-[var(--ui-text-strong)]">Hardware Profile Settings</h2>
        `;
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = "<i class='fas fa-times'></i>";
        closeBtn.className = "text-[var(--ui-text-subtle)] hover:text-[var(--ui-text)] transition-colors";
        closeBtn.onclick = close;
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = "p-4 space-y-4";

        // Profile name
        this._addModalField(body, "Profile Name", "text", profile.name, (val) => {
            this._updateProfile(profile.id, { name: val });
        });

        // LED Count
        this._addModalField(body, "LED Count", "number", profile.ledCount, (val) => {
            this._updateProfile(profile.id, { ledCount: parseInt(val) || 164 });
        });

        // LED Type dropdown
        this._addModalSelect(body, "LED Type", LED_TYPE_LABELS, profile.ledType, (val) => {
            this._updateProfile(profile.id, { ledType: parseInt(val) });
        });

        // Color Order dropdown
        this._addModalSelect(body, "Color Order", COLOR_ORDER_LABELS, profile.colorOrder, (val) => {
            this._updateProfile(profile.id, { colorOrder: parseInt(val) });
        });

        // Max brightness slider
        this._addModalSlider(body, "Max Brightness", 0, 255, profile.brightnessCap, (val) => {
            this._updateProfile(profile.id, { brightnessCap: parseInt(val) });
        }, (v) => `${Math.round((v / 255) * 100)}%`);

        // Separator for info fields
        body.insertAdjacentHTML('beforeend', `
            <div class="border-t border-[var(--ui-border)] pt-4 mt-4">
                <div class="text-xs text-[var(--ui-text-subtle)] uppercase mb-3">Documentation (Optional)</div>
            </div>
        `);

        // Voltage
        this._addModalSelect(body, "Voltage", {
            5: '5V',
            12: '12V',
            24: '24V'
        }, profile.voltage || 5, (val) => {
            this._updateProfile(profile.id, { voltage: parseInt(val) });
        });

        // Physical Length
        // Notes
        this._addModalTextarea(body, "Notes", profile.notes || '', (val) => {
            this._updateProfile(profile.id, { notes: val });
        }, "Any additional notes about this hardware...", { rows: 6 });

        panel.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = "flex justify-end gap-2 p-4 border-t border-[var(--ui-border)]";
        const doneBtn = document.createElement('button');
        doneBtn.textContent = "Done";
        doneBtn.className = "px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm transition-colors";
        doneBtn.onclick = close;
        footer.appendChild(doneBtn);
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    /**
     * Update a profile in state with validation
     */
    _updateProfile(profileId, updates) {
        // Clamp values to valid ranges before saving
        const clampedUpdates = {};
        for (const [field, value] of Object.entries(updates)) {
            clampedUpdates[field] = clampProfileValue(field, value);
        }

        this.stateManager?.update(draft => {
            const prof = (draft.project.settings.profiles || []).find(x => x.id === profileId);
            if (prof) {
                Object.assign(prof, clampedUpdates);
                draft.isDirty = true;
            }
        }, { skipHistory: true });
    }

    /**
     * Add a text/number input field to modal
     */
    _addModalField(container, label, type, value, onChange, placeholder = '') {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<label class="block text-xs text-[var(--ui-text-subtle)] mb-1">${label}</label>`;
        const input = document.createElement('input');
        input.type = type;
        input.value = value ?? '';
        input.placeholder = placeholder;
        input.className = "w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-2 py-1.5 outline-none focus:border-cyan-500";
        input.oninput = (e) => onChange(e.target.value);
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } };
        wrapper.appendChild(input);
        container.appendChild(wrapper);
    }

    /**
     * Add a select dropdown to modal
     */
    _addModalSelect(container, label, options, currentValue, onChange) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<label class="block text-xs text-[var(--ui-text-subtle)] mb-1">${label}</label>`;
        const select = document.createElement('select');
        select.className = "w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-2 py-1.5 outline-none focus:border-cyan-500 cursor-pointer";

        for (const [value, label] of Object.entries(options)) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            opt.selected = String(value) === String(currentValue);
            select.appendChild(opt);
        }

        select.onchange = (e) => onChange(e.target.value);
        wrapper.appendChild(select);
        container.appendChild(wrapper);
    }

    /**
     * Add a slider to modal
     */
    _addModalSlider(container, label, min, max, value, onChange, formatValue) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <label class="text-xs text-[var(--ui-text-subtle)]">${label}</label>
                <span class="text-xs text-[var(--ui-text)] font-mono" data-value></span>
            </div>
        `;
        const valueEl = wrapper.querySelector('[data-value]');
        valueEl.textContent = formatValue ? formatValue(value) : value;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.value = value;
        slider.className = "w-full h-1.5 bg-[var(--ui-border)] rounded-lg appearance-none cursor-pointer accent-cyan-500";
        slider.oninput = (e) => {
            const val = parseInt(e.target.value);
            valueEl.textContent = formatValue ? formatValue(val) : val;
            onChange(val);
        };
        wrapper.appendChild(slider);
        container.appendChild(wrapper);
    }

    /**
     * Add a textarea to modal
     */
    _addModalTextarea(container, label, value, onChange, placeholder = '', opts = {}) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<label class="block text-xs text-[var(--ui-text-subtle)] mb-1">${label}</label>`;
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.placeholder = placeholder;
        textarea.rows = Number.isFinite(opts.rows) ? opts.rows : 2;
        textarea.className = "w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-2 py-1.5 outline-none focus:border-cyan-500 resize-y";
        textarea.oninput = (e) => onChange(e.target.value);
        wrapper.appendChild(textarea);
        container.appendChild(wrapper);
    }

    _renderPropGroups(container, project) {
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Prop Groups</div>`);
        const propGroups = (project.propGroups || []);

        const list = document.createElement('div');
        list.className = "space-y-2 mb-2 relative";
        container.appendChild(list);

        let draggingGroupId = null;
        const interactiveSelector = 'input, textarea, select, button, a, [contenteditable="true"]';
        const isInteractiveDragTarget = (target) => {
            if (!target || !(target instanceof Element)) return false;
            return Boolean(target.closest(interactiveSelector));
        };
        const isDragFromInteractiveArea = (evt, cardEl) => {
            const path = typeof evt.composedPath === 'function' ? evt.composedPath() : [];
            for (const node of path) {
                if (!(node instanceof Element)) continue;
                if (node === cardEl) break;
                if (node.matches(interactiveSelector)) return true;
            }
            return false;
        };

        let dropTargetEl = null;
        const clearDropIndicators = () => {
            dropTargetEl?.classList.remove('dnd-drop-target');
            dropTargetEl = null;
            list.classList.remove('dnd-drop-end');
        };

        const getDragAfterElement = (y) => {
            const items = [...list.querySelectorAll('[data-group-id]')];
            const INSERT_BEFORE_FRACTION = 0.75;
            let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
            for (const child of items) {
                if (child.dataset.groupId === draggingGroupId) continue;
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height * INSERT_BEFORE_FRACTION;
                if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
            }
            return closest.element;
        };

        list.addEventListener('dragover', (e) => {
            if (!draggingGroupId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const afterEl = getDragAfterElement(e.clientY);
            if (!afterEl) {
                if (!list.classList.contains('dnd-drop-end')) {
                    clearDropIndicators();
                    list.classList.add('dnd-drop-end');
                }
                return;
            }
            if (list.classList.contains('dnd-drop-end') || afterEl !== dropTargetEl) {
                clearDropIndicators();
                dropTargetEl = afterEl;
                dropTargetEl?.classList.add('dnd-drop-target');
            }
        });

        list.addEventListener('drop', (e) => {
            if (!draggingGroupId) return;
            e.preventDefault();

            const afterEl = getDragAfterElement(e.clientY);
            const insertBeforeId = afterEl?.dataset?.groupId || null;
            const draggedId = draggingGroupId;

            this.stateManager?.update(draft => {
                const arr = (draft.project.propGroups || []).slice();
                const fromIndex = arr.findIndex(g => g?.id === draggedId);
                if (fromIndex < 0) return;

                const toIndexRaw = insertBeforeId
                    ? arr.findIndex(g => g?.id === insertBeforeId)
                    : arr.length;
                if (toIndexRaw < 0) return;

                const [item] = arr.splice(fromIndex, 1);
                const toIndex = fromIndex < toIndexRaw ? (toIndexRaw - 1) : toIndexRaw;
                arr.splice(toIndex, 0, item);

                draft.project.propGroups = arr;
                draft.isDirty = true;
            });

            draggingGroupId = null;
            clearDropIndicators();
            this.render(null);
        });
        propGroups.forEach((grp) => {
            const card = document.createElement('div');
            card.className = "bg-[var(--ui-toolbar-bg)] p-2 rounded border border-[var(--ui-border)] overflow-hidden cursor-grab active:cursor-grabbing";
            card.dataset.groupId = grp.id;
            card.title = "Drag to reorder";
            card.draggable = false;
            card.addEventListener('pointerdown', (e) => {
                card.draggable = !isInteractiveDragTarget(e.target);
            }, { capture: true });
            card.addEventListener('pointerup', () => {
                card.draggable = false;
            }, { capture: true });
            card.addEventListener('pointercancel', () => {
                card.draggable = false;
            }, { capture: true });
            card.addEventListener('dragstart', (e) => {
                if (!card.draggable || isDragFromInteractiveArea(e, card)) {
                    e.preventDefault();
                    card.draggable = false;
                    return;
                }
                draggingGroupId = grp.id;
                card.classList.add('dnd-dragging');
                clearDropIndicators();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', grp.id);
            });
            card.addEventListener('dragend', () => {
                draggingGroupId = null;
                card.classList.remove('dnd-dragging');
                clearDropIndicators();
                card.draggable = false;
            });

            const row1 = document.createElement('div');
            row1.className = "flex items-center gap-2 mb-1 min-w-0";

            const gName = document.createElement('input');
            gName.className = "bg-transparent text-sm font-bold text-[var(--ui-text-strong)] outline-none flex-1 min-w-0 border-b border-transparent focus:border-[var(--accent)]";
            gName.scope = grp.id; gName.value = grp.name || "";
            gName.oninput = e => {
                this.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === grp.id);
                    if (g) { g.name = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
                // Trigger timeline update safely? Actually names of prop groups only affect dropdowns on timeline, so yes.
                window.dispatchEvent(new CustomEvent('app:timeline-changed'));
            };
            gName.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); gName.blur(); } };
            const del = document.createElement('button');
            del.innerHTML = "<i class='fas fa-times'></i>";
            del.className = "text-[var(--ui-text-subtle)] hover:text-red-500 shrink-0";
            del.onclick = () => {
                this.stateManager?.update(draft => {
                    draft.project.propGroups = (draft.project.propGroups || []).filter(g => g.id !== grp.id);
                    draft.isDirty = true;
                });
                this.render(null);
            };
            row1.appendChild(gName); row1.appendChild(del); card.appendChild(row1);

            const idsContainer = document.createElement('div');
            const row2 = document.createElement('div');
            row2.className = "flex items-center";
            row2.innerHTML = `<span class="text-xs text-[var(--ui-text-subtle)] mr-2">IDs:</span>`;
            const ids = document.createElement('input');
            ids.className = "bg-[var(--ui-select-bg)] text-xs text-[var(--ui-text)] rounded px-1 py-0.5 flex-1 outline-none border border-[var(--ui-border)]";
            ids.value = grp.ids || "";

            const idsError = document.createElement('div');
            idsError.className = "text-xs text-red-400 mt-1 hidden";

            ids.oninput = e => {
                const validation = validateIdString(e.target.value);
                if (!validation.valid) {
                    ids.classList.add('border-red-500');
                    idsError.textContent = validation.message;
                    idsError.classList.remove('hidden');
                } else {
                    ids.classList.remove('border-red-500');
                    idsError.classList.add('hidden');
                }
                this.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === grp.id);
                    if (g) { g.ids = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
            };
            ids.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ids.blur(); } };
            row2.appendChild(ids);
            idsContainer.appendChild(row2);
            idsContainer.appendChild(idsError);
            card.appendChild(idsContainer);
            list.appendChild(card);
        });

        const addGrpBtn = document.createElement('button');
        addGrpBtn.className = "w-full py-1.5 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded text-xs text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] mb-4";
        addGrpBtn.innerHTML = "<i class='fas fa-plus mr-1 text-[10px] relative -top-px'></i> Add Group";
        addGrpBtn.onclick = () => {
            this.stateManager?.update(draft => {
                if (!draft.project.propGroups) draft.project.propGroups = [];
                draft.project.propGroups.push({ id: 'g_' + Date.now(), name: 'New Group', ids: '' });
                draft.isDirty = true;
            });
            this.render(null);
        };
        container.appendChild(addGrpBtn);
    }

    _renderClipProperties(container, clipId, project) {
        let clip = null;
        project.tracks.forEach(t => { const c = t.clips.find(x => x.id === clipId); if (c) clip = c; });
        if (!clip) return;

        container.innerHTML = `<div class="font-bold text-[var(--ui-text-strong)] mb-4 border-b border-[var(--ui-border)] pb-2">${clip.type.toUpperCase()} CLIP</div>`;

        if (clip.type === 'audio') {
            this._renderAudioClipProps(container, clip);
        }

        const updateClip = (updates, options) => {
            this.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clipId);
                    if (c) Object.assign(c, updates);
                });
                draft.isDirty = true;
            }, options);
            // We need to notify timeline to redraw if start/duration changed
            window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        };

        this._addInput(container, "Start (MM:SS.ss)", formatTime(clip.startTime), e => {
            updateClip({ startTime: parseTime(e.target.value) });
        });

        this._addInput(container, "Duration (MM:SS.ss)", formatTime(clip.duration), e => {
            updateClip({ duration: parseTime(e.target.value) });
        });

        const sliderSpecByKey = {
            rate: { min: 1, max: 30, step: 1, valueLabel: v => `${Math.round(v)} /s` },
            speed: { min: 0.1, max: 5, step: 0.1, valueLabel: v => `${Number(v).toFixed(1)}×` },
            frequency: { min: 0.1, max: 5, step: 0.1, valueLabel: v => `${Number(v).toFixed(1)}` },
            width: { min: 0.01, max: 0.5, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
            tailLen: { min: 0.05, max: 1, step: 0.05, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
            density: { min: 0, max: 1, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
            amount: { min: 0, max: 1, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
        };

        // Generic props
        Object.keys(clip.props).forEach(key => {
            if (['audioSrcPath', 'name', 'volume'].includes(key)) return;

            const value = clip.props[key];
            const sliderSpec = (typeof value === 'number') ? sliderSpecByKey[key] : null;

            if (sliderSpec) {
                this._addSlider(container, key, value, sliderSpec, (nextVal) => {
                    const prevProps = { ...clip.props, [key]: nextVal };
                    updateClip({ props: prevProps }, { skipHistory: true });
                });
                return;
            }

            this._addInput(container, key, value, e => {
                const next = (e.target.type === 'number') ? parseFloat(e.target.value) : e.target.value;
                const prevProps = { ...clip.props };
                prevProps[key] = next;
                updateClip({ props: prevProps });
            }, typeof value === 'number' ? 'number' : undefined);
        });

        const del = document.createElement('button'); del.innerText = "Delete Clip"; del.className = "w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs mt-4";
        del.onclick = () => {
            if (this.timelineController?.deleteClip) {
                this.timelineController.deleteClip(clipId);
            }
        };
        container.appendChild(del);
    }

    _renderAudioClipProps(container, clip) {
        const audioInfo = document.createElement('div');
        audioInfo.className = 'bg-[var(--ui-toolbar-bg)] p-3 rounded mb-4 border border-orange-900';
        const fileName = clip.props?.name || 'Unknown audio';
        const volume = clip.props?.volume ?? 1;

        audioInfo.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-music text-orange-400"></i>
                <span class="text-sm text-[var(--ui-text-strong)] font-medium">${fileName}</span>
            </div>
            <div class="text-xs text-[var(--ui-text-muted)] mb-3">
                Duration: ${(clip.duration / 1000).toFixed(2)}s
            </div>
            <label class="block text-xs text-[var(--ui-text-muted)] mb-1">Volume</label>
            <div class="flex items-center gap-2">
                <input type="range" min="0" max="1" step="0.01" value="${volume}"
                    class="flex-1 h-1 bg-[var(--ui-border)] rounded-lg appearance-none cursor-pointer accent-orange-500"
                    id="audio-volume-slider">
                <span class="text-xs text-[var(--ui-text-muted)] w-10 text-right" id="audio-volume-display">${Math.round(volume * 100)}%</span>
            </div>
        `;
        container.appendChild(audioInfo);

        const slider = audioInfo.querySelector('#audio-volume-slider');
        const display = audioInfo.querySelector('#audio-volume-display');
        slider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            display.textContent = `${Math.round(val * 100)}%`;
            this.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clip.id);
                    if (c) {
                        if (!c.props) c.props = {};
                        c.props.volume = val;
                    }
                });
                draft.isDirty = true;
            }, { skipHistory: true });
            this.deps.audioService?.setClipVolume?.(clip.id, val);
        };
    }

    _addTextInput(parent, lbl, val, cb) {
        const d = document.createElement('div'); d.className = "mb-2";
        d.innerHTML = `<label class="block text-xs text-[var(--ui-text-muted)] mb-1">${lbl}</label>`;
        const inp = document.createElement('input');
        inp.className = "w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-1 py-1 outline-none mb-3";
        inp.value = val;
        inp.oninput = (e) => cb(e.target.value);
        d.appendChild(inp); parent.appendChild(d);
    }

    _addInput(parent, lbl, val, cb, type) {
        const d = document.createElement('div'); d.className = "mb-2"; d.innerHTML = `<label class="block text-xs text-[var(--ui-text-muted)] mb-1">${lbl}</label>`;
        const inp = document.createElement('input');

        if ((typeof val === 'string' && val.startsWith('#')) || type === 'color') {
            inp.type = 'color';
            inp.className = "w-full h-8 bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded cursor-pointer p-0";
        } else if (typeof val === 'number' || type === 'number') {
            inp.type = 'number';
            inp.step = '0.1';
            inp.className = "w-full bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded px-2 py-1 text-sm text-[var(--ui-text)]";
        } else {
            inp.type = 'text';
            inp.className = "w-full bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded px-2 py-1 text-sm text-[var(--ui-text)]";
        }

        const safeVal = (val !== undefined) ? val : "";
        inp.setAttribute('value', safeVal); inp.value = safeVal;
        inp.oninput = cb;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
        d.appendChild(inp); parent.appendChild(d);
    }

    _addSlider(parent, lbl, val, spec, onValue) {
        const d = document.createElement('div');
        d.className = "mb-3";
        d.innerHTML = `
            <div class="flex items-baseline justify-between mb-1">
                <label class="block text-xs text-[var(--ui-text-muted)]">${lbl}</label>
                <span class="text-xs text-[var(--ui-text-subtle)] font-mono" data-role="value"></span>
            </div>
        `;

        const row = document.createElement('div');
        row.className = "flex items-center gap-2";

        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = String(spec.min);
        inp.max = String(spec.max);
        inp.step = String(spec.step ?? 0.1);
        inp.value = String(val ?? spec.min);
        inp.className = "flex-1 h-1 bg-[var(--ui-border)] rounded-lg appearance-none cursor-pointer accent-cyan-500";

        const valueEl = d.querySelector('[data-role=\"value\"]');
        const formatValue = (n) => {
            if (!Number.isFinite(n)) return '';
            return typeof spec.valueLabel === 'function' ? spec.valueLabel(n) : String(n);
        };
        const sync = () => {
            const next = parseFloat(inp.value);
            if (valueEl) valueEl.textContent = formatValue(next);
        };

        inp.addEventListener('input', (e) => {
            const next = parseFloat(e.target.value);
            if (valueEl) valueEl.textContent = formatValue(next);
            onValue(next);
        });

        sync();
        row.appendChild(inp);
        d.appendChild(row);
        parent.appendChild(d);
    }

    _computePatch(profiles) {
        const patch = {};
        if (!profiles) return patch;
        profiles.forEach(p => {
            if (!p?.assignedIds) return;
            const ids = parseIdString(p.assignedIds);
            ids.forEach(id => { patch[String(id)] = p.id; });
        });
        return patch;
    }

    _ensureDefaultProfiles() {
        this.stateManager?.update(draft => {
            if (!draft.project.settings.profiles) {
                draft.project.settings.profiles = [createDefaultProfile('p_def', 'Standard Prop', 164, '1-164')];
            }
            if (!draft.project.settings.patch) {
                draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
            }
        }, { skipHistory: true });
    }
}
