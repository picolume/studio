import { formatTime, parseTime, parseIdString } from '../utils.js';

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
        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-[var(--ui-border)] pb-2">MULTIPLE CLIPS</div>`;
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

        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-[var(--ui-border)] pb-2">PROJECT SETTINGS</div>`;

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

        // Global Brightness
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Global Settings</div>`);
        const bDiv = document.createElement('div'); bDiv.className = "bg-[var(--ui-toolbar-bg)] p-2 rounded mb-4 border border-[var(--ui-border)]";
        bDiv.innerHTML = `<label class="block text-xs text-[var(--ui-text-subtle)] mb-1">Master Brightness (0-255)</label>`;
        const bInp = document.createElement('input'); bInp.type = "number"; bInp.className = "w-full bg-[var(--ui-select-bg)] text-sm text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-1 py-1";
        bInp.value = project.settings?.brightness ?? 255;
        bInp.oninput = (e) => {
            const next = parseInt(e.target.value) || 0;
            this.stateManager?.update(draft => {
                draft.project.settings.brightness = next;
                draft.isDirty = true;
            }, { skipHistory: true });
        };
        bDiv.appendChild(bInp);
        container.appendChild(bDiv);

        // Hardware Profiles
        this._renderHardwareProfiles(container, project);

        // Groups
        this._renderPropGroups(container, project);
    }

    _renderHardwareProfiles(container, project) {
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Hardware Profiles</div>`);
        const profiles = (project?.settings?.profiles || []);

        profiles.forEach((profile) => {
            const card = document.createElement('div');
            card.className = "bg-[var(--ui-toolbar-bg)] p-2 rounded mb-2 border border-[var(--ui-border)] relative group";

            const row1 = document.createElement('div'); row1.className = "flex justify-between items-center mb-1";
            const pName = document.createElement('input');
            pName.className = "bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            pName.value = profile.name || "Profile";
            pName.oninput = (e) => {
                this.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profile.id);
                    if (p) { p.name = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
            };
            row1.appendChild(pName);

            if (profiles.length > 1) {
                const del = document.createElement('button'); del.innerHTML = "<i class='fas fa-times'></i>"; del.className = "text-[var(--ui-text-subtle)] hover:text-red-500";
                del.onclick = () => {
                    this.stateManager?.update(draft => {
                        draft.project.settings.profiles = draft.project.settings.profiles.filter(p => p.id !== profile.id);
                        draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                        draft.isDirty = true;
                    });
                    this.render(null);
                };
                row1.appendChild(del);
            }
            card.appendChild(row1);

            const row2 = document.createElement('div'); row2.className = "flex items-center mb-1";
            row2.innerHTML = `<span class="text-xs text-[var(--ui-text-subtle)] mr-2 w-16">LED Count:</span>`;
            const cInp = document.createElement('input'); cInp.type = "number";
            cInp.className = "bg-[var(--ui-select-bg)] text-xs text-[var(--ui-text)] rounded px-1 py-0.5 flex-1 outline-none border border-[var(--ui-border)]";
            cInp.value = profile.ledCount;
            cInp.onchange = (e) => {
                const next = parseInt(e.target.value) || 10;
                this.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profile.id);
                    if (p) { p.ledCount = next; draft.isDirty = true; }
                }, { skipHistory: true });
            };
            row2.appendChild(cInp); card.appendChild(row2);

            const row3 = document.createElement('div'); row3.className = "flex items-center";
            row3.innerHTML = `<span class="text-xs text-[var(--ui-text-subtle)] mr-2 w-16">IDs:</span>`;
            const idInp = document.createElement('input');
            idInp.className = "bg-[var(--ui-select-bg)] text-xs text-[var(--ui-text)] rounded px-1 py-0.5 flex-1 outline-none border border-[var(--ui-border)] font-mono";
            idInp.value = profile.assignedIds || "";
            idInp.placeholder = "1-10, 15";
            idInp.oninput = (e) => {
                this.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profile.id);
                    if (p) {
                        p.assignedIds = e.target.value;
                        draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
            };
            row3.appendChild(idInp); card.appendChild(row3);
            container.appendChild(card);
        });

        const addBtn = document.createElement('button');
        addBtn.className = "w-full py-1.5 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded text-xs text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] mb-4";
        addBtn.innerHTML = "<i class='fas fa-plus mr-1 text-[10px] relative -top-px'></i> Add Profile";
        addBtn.onclick = () => {
            this.stateManager?.update(draft => {
                if (!draft.project.settings.profiles) draft.project.settings.profiles = [];
                draft.project.settings.profiles.push({
                    id: 'p_' + Date.now(), name: 'New Hardware', ledCount: 164, assignedIds: ''
                });
                draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
                draft.isDirty = true;
            });
            this.render(null);
        };
        container.appendChild(addBtn);
    }

    _renderPropGroups(container, project) {
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Prop Groups</div>`);
        const propGroups = (project.propGroups || []);
        propGroups.forEach((grp) => {
            const card = document.createElement('div'); card.className = "bg-[var(--ui-toolbar-bg)] p-2 rounded mb-2 border border-[var(--ui-border)]";
            const row1 = document.createElement('div'); row1.className = "flex justify-between mb-1";
            const gName = document.createElement('input'); gName.className = "bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            gName.scope = grp.id; gName.value = grp.name || "";
            gName.oninput = e => {
                this.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === grp.id);
                    if (g) { g.name = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
                // Trigger timeline update safely? Actually names of prop groups only affect dropdowns on timeline, so yes.
                window.dispatchEvent(new CustomEvent('app:timeline-changed'));
            };
            const del = document.createElement('button'); del.innerHTML = "<i class='fas fa-times'></i>"; del.className = "text-[var(--ui-text-subtle)] hover:text-red-500";
            del.onclick = () => {
                this.stateManager?.update(draft => {
                    draft.project.propGroups = (draft.project.propGroups || []).filter(g => g.id !== grp.id);
                    draft.isDirty = true;
                });
                this.render(null);
            };
            row1.appendChild(gName); row1.appendChild(del); card.appendChild(row1);

            const row2 = document.createElement('div'); row2.innerHTML = `<span class="text-xs text-[var(--ui-text-subtle)] mr-2">IDs:</span>`;
            const ids = document.createElement('input'); ids.className = "bg-[var(--ui-select-bg)] text-xs text-[var(--ui-text)] rounded px-1 py-0.5 flex-1 outline-none border border-[var(--ui-border)]";
            ids.value = grp.ids || "";
            ids.oninput = e => {
                this.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === grp.id);
                    if (g) { g.ids = e.target.value; draft.isDirty = true; }
                }, { skipHistory: true });
            };
            row2.appendChild(ids); card.appendChild(row2);
            container.appendChild(card);
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

        container.innerHTML = `<div class="font-bold text-white mb-4 border-b border-[var(--ui-border)] pb-2">${clip.type.toUpperCase()} CLIP</div>`;

        if (clip.type === 'audio') {
            this._renderAudioClipProps(container, clip);
        }

        const updateClip = (updates) => {
            this.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clipId);
                    if (c) Object.assign(c, updates);
                });
                draft.isDirty = true;
            });
            // We need to notify timeline to redraw if start/duration changed
            window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        };

        this._addInput(container, "Start (MM:SS.ss)", formatTime(clip.startTime), e => {
            updateClip({ startTime: parseTime(e.target.value) });
        });

        this._addInput(container, "Duration (MM:SS.ss)", formatTime(clip.duration), e => {
            updateClip({ duration: parseTime(e.target.value) });
        });

        if (clip.type === 'rainbowHold') {
            this._addInput(container, "Frequency", clip.props.frequency || 1, e => {
                const prevProps = { ...clip.props };
                prevProps.frequency = parseFloat(e.target.value);
                updateClip({ props: prevProps });
            }, 'number');
        }

        // Generic props
        Object.keys(clip.props).forEach(key => {
            if (['audioSrcPath', 'name', 'volume'].includes(key)) return;
            if (key === 'frequency' && clip.type === 'rainbowHold') return;

            this._addInput(container, key, clip.props[key], e => {
                const next = (e.target.type === 'number') ? parseFloat(e.target.value) : e.target.value;
                const prevProps = { ...clip.props };
                prevProps[key] = next;
                updateClip({ props: prevProps });
            }, typeof clip.props[key] === 'number' ? 'number' : undefined);
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
                <span class="text-sm text-white font-medium">${fileName}</span>
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
            inp.className = "w-full bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded px-2 py-1 text-sm text-white";
        } else {
            inp.type = 'text';
            inp.className = "w-full bg-[var(--ui-select-bg)] border border-[var(--ui-border)] rounded px-2 py-1 text-sm text-white";
        }

        const safeVal = (val !== undefined) ? val : "";
        inp.setAttribute('value', safeVal); inp.value = safeVal;
        inp.oninput = cb;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
        d.appendChild(inp); parent.appendChild(d);
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
                draft.project.settings.profiles = [{ id: 'p_def', name: 'Standard Prop', ledCount: 164, assignedIds: '1-164' }];
            }
            if (!draft.project.settings.patch) {
                draft.project.settings.patch = this._computePatch(draft.project.settings.profiles);
            }
        }, { skipHistory: true });
    }
}
