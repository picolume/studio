import { getSnappedTime, formatTime, showConfirm } from '../utils.js';

// Cue marker colors
const CUE_COLORS = {
    A: '#ef4444', // red
    B: '#22c55e', // green
    C: '#3b82f6', // blue
    D: '#f97316'  // orange
};

export class TimelineRenderer {
    constructor(deps) {
        this.deps = deps;
        this._cueContextMenu = null;
        this._dragState = null;
    }

    get stateManager() { return this.deps.stateManager; }
    get timelineController() { return this.deps.timelineController; }
    get cueController() { return this.deps.cueController; }
    get elements() { return this.deps.elements; }
    get audioService() { return this.deps.audioService; }

    getZoom() {
        return this.stateManager?.get('ui.zoom') ?? 50;
    }

    render(project) {
        const content = this.elements.timelineContent || document.getElementById('timeline-content');
        const headers = this.elements.trackHeaders || document.getElementById('track-headers');
        const container = this.elements.tracksContainer || document.getElementById('tracks-container');
        const ruler = this.elements.ruler || document.getElementById('ruler');

        if (!content || !headers || !container) return;
        if (!project) return;

        const dur = project.duration || 60000;
        const zoom = this.getZoom();
        const newWidth = (dur / 1000) * zoom + 500;

        content.style.width = `${newWidth}px`;
        content.style.minWidth = `${newWidth}px`;
        if (ruler) { ruler.style.width = `${newWidth}px`; ruler.style.minWidth = `${newWidth}px`; }
        if (container) { container.style.width = `${newWidth}px`; container.style.minWidth = `${newWidth}px`; }

        headers.innerHTML = '';
        const headerSpacer = document.createElement('div');
        headerSpacer.className = 'track-headers-spacer';
        headers.appendChild(headerSpacer);
        container.innerHTML = '';

        const tracks = project.tracks || [];

        tracks.forEach((track, index) => {
            this._renderTrackHeader(headers, track, index);
            this._renderTrackLane(container, track);
        });

        this.drawRuler(project);
        this.updateGridBackground();
    }

    _renderTrackHeader(container, track, index) {
        const h = document.createElement('div');
        h.className = 'track-header group cursor-move relative';
        h.draggable = true;
        h.dataset.index = index;
        if (track.type === 'audio') h.style.background = 'var(--ui-audio-track-bg)';

        h.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            e.dataTransfer.effectAllowed = 'move';
            h.style.opacity = '0.5';
        });
        h.addEventListener('dragend', () => {
            h.style.opacity = '1';
            document.querySelectorAll('.track-header').forEach(el => el.style.borderTop = '');
        });
        h.addEventListener('dragover', (e) => { e.preventDefault(); h.style.borderTop = '2px solid var(--accent)'; });
        h.addEventListener('dragleave', () => { h.style.borderTop = ''; });
        h.addEventListener('drop', (e) => {
            e.preventDefault();
            h.style.borderTop = '';
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (fromIndex !== index && !isNaN(fromIndex)) {
                this.stateManager?.update(draft => {
                    const moved = draft.project.tracks.splice(fromIndex, 1)[0];
                    draft.project.tracks.splice(index, 0, moved);
                    draft.isDirty = true;
                });
                window.dispatchEvent(new CustomEvent('app:timeline-changed'));
            }
        });

        const row1 = document.createElement('div');
        row1.className = "flex items-center w-full mb-1";
        row1.innerHTML = `<i class="${track.type === 'audio' ? 'fas fa-music text-orange-500' : 'fas fa-lightbulb text-cyan-500'} mr-2"></i>`;

        const label = document.createElement('span');
        label.className = "cursor-text truncate text-xs font-bold flex-1";
        label.innerText = track.label;
        label.ondblclick = (e) => {
            e.stopPropagation();
            const inp = document.createElement('input'); inp.value = track.label;
            inp.className = "bg-[var(--ui-toolbar-bg)] text-[var(--ui-text)] px-1 py-0.5 rounded text-xs w-full";
            const trackId = track.id;
            const save = () => {
                const next = inp.value.trim();
                if (!next) return;
                this.stateManager?.update(draft => {
                    const t = draft.project.tracks.find(x => x.id === trackId);
                    if (t) {
                        t.label = next;
                        draft.isDirty = true;
                    }
                });
                window.dispatchEvent(new CustomEvent('app:timeline-changed'));
            };
            inp.onblur = save; inp.onkeydown = (ev) => { if (ev.key === 'Enter') save(); };
            row1.replaceChild(inp, label); inp.focus();
        };
        row1.appendChild(label);

        if (track.type === 'audio') {
            const upBtn = document.createElement('button');
            upBtn.innerHTML = '<i class="fas fa-file-upload"></i>';
            upBtn.className = "text-[var(--ui-text-muted)] hover:text-orange-400 p-1 mr-1 text-[10px]";
            upBtn.onclick = (e) => {
                e.stopPropagation();
                const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*';
                inp.onchange = (ev) => {
                    if (ev.target.files.length > 0) {
                        window.dispatchEvent(new CustomEvent('app:load-audio', { detail: { file: ev.target.files[0], trackId: track.id } }));
                    }
                };
                inp.click();
            };
            row1.appendChild(upBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.className = "text-[var(--ui-text-faint)] hover:text-red-500 p-1 text-[10px]";
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            const confirmed = await showConfirm('Delete this track?');
            if (!confirmed) return;
            if (this.timelineController?.deleteTrack) {
                this.timelineController.deleteTrack(track.id);
            }
        };
        row1.appendChild(delBtn);
        h.appendChild(row1);

        if (track.type === 'led') {
            const row2 = document.createElement('div'); row2.className = "w-full mt-1";
            const sel = document.createElement('select'); sel.className = "w-full bg-[var(--ui-toolbar-bg)] text-[10px] text-[var(--ui-text)] border border-[var(--ui-border)] rounded px-1 py-0.5";
            const propGroups = this.stateManager.get('project.propGroups') || [];
            propGroups.forEach(grp => {
                const opt = document.createElement('option'); opt.value = grp.id; opt.innerText = grp.name;
                if (track.groupId === grp.id) opt.selected = true;
                sel.appendChild(opt);
            });
            const trackId = track.id;
            sel.onchange = (e) => {
                const groupId = e.target.value;
                this.stateManager?.update(draft => {
                    const t = draft.project.tracks.find(x => x.id === trackId);
                    if (t) {
                        t.groupId = groupId;
                        draft.isDirty = true;
                    }
                });
            };
            row2.appendChild(sel); h.appendChild(row2);
        }
        container.appendChild(h);
    }

    _renderTrackLane(container, track) {
        const lane = document.createElement('div');
        lane.className = 'track-lane ' + (track.type === 'audio' ? 'audio-lane' : '');
        lane.dataset.trackId = track.id;
        track.clips.forEach(clip => lane.appendChild(this._createClipElement(clip)));

        lane.ondragover = e => e.preventDefault();
        lane.ondragenter = () => lane.classList.add('drag-over');
        lane.ondragleave = (e) => {
            if (!lane.contains(e.relatedTarget)) lane.classList.remove('drag-over');
        };
        lane.ondrop = e => {
            e.preventDefault();
            lane.classList.remove('drag-over');
            window.dispatchEvent(new CustomEvent('app:drop-clip', { detail: { event: e, trackId: track.id } }));
        };
        container.appendChild(lane);
    }

    _createClipElement(clip) {
        const el = document.createElement('div');
        el.id = `clip-${clip.id}`;
        const zoom = this.getZoom();
        el.style.left = `${(clip.startTime / 1000) * zoom}px`;
        el.style.width = `${(clip.duration / 1000) * zoom}px`;
        el.dataset.clipId = clip.id;
        const selection = this.stateManager.get('selection') || [];
        const isSelected = selection.includes(clip.id);
        el.className = `clip ${clip.type === 'audio' ? 'audio-clip bg-orange-900' : 'bg-' + clip.type} ${isSelected ? 'selected' : ''}`;
        el.innerHTML = `<div class="clip-handle left"></div><div class="clip-handle right"></div>`;

        // Accessibility: Make clip focusable and add ARIA attributes
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${clip.type} clip at ${Math.floor(clip.startTime / 1000)} seconds, duration ${Math.floor(clip.duration / 1000)} seconds${isSelected ? ', selected' : ''}`);
        el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

        if (clip.type === 'audio') {
            const lbl = document.createElement('div');
            lbl.className = "clip-label";
            const icon = document.createElement('i');
            icon.className = 'fas fa-music';
            const name = (clip?.props?.name != null) ? String(clip.props.name) : 'Audio';
            lbl.appendChild(icon);
            lbl.appendChild(document.createTextNode(' ' + name));
            el.appendChild(lbl);
            const cvs = document.createElement('canvas');
            cvs.className = "clip-waveform absolute top-0 left-0 w-full h-full opacity-50 pointer-events-none";
            cvs.width = Math.max(10, (clip.duration / 1000) * zoom);
            cvs.height = 80;
            el.appendChild(cvs);
            const assets = this.stateManager.get('assets');
            if (clip.bufferId && assets[clip.bufferId]) {
                this.drawClipWaveform(cvs, assets[clip.bufferId], '#d97706', clip.duration);
            }
        } else {
            el.appendChild(document.createTextNode(clip.type.toUpperCase()));
        }
        el.onmousedown = (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('app:clip-mousedown', { detail: { event: e, clipId: clip.id } }));
        };

        // Keyboard handler for clip-level actions
        el.onkeydown = (e) => {
            // Dispatch keyboard event for centralized handling in main.js
            window.dispatchEvent(new CustomEvent('app:clip-keydown', {
                detail: { event: e, clipId: clip.id }
            }));
        };

        return el;
    }

    drawRuler(project) {
        const ruler = this.elements.ruler || document.getElementById('ruler');
        const handle = this.elements.playheadHandle || document.getElementById('playhead-handle');
        if (!ruler) return;

        ruler.innerHTML = '';
        if (handle) ruler.appendChild(handle);

        const dur = project?.duration || 60000;
        const durSecs = Math.ceil(dur / 1000);
        const zoom = this.getZoom();
        const rulerWidth = (dur / 1000) * zoom + 500;
        ruler.style.width = `${rulerWidth}px`;
        ruler.style.minWidth = `${rulerWidth}px`;

        for (let i = 0; i <= durSecs; i++) {
            const tick = document.createElement('div');
            tick.style.cssText = `position:absolute;left:${i * zoom}px;bottom:0;height:${i % 5 === 0 ? '15px' : '8px'};`;
            tick.style.borderLeft = '1px solid var(--ui-tick)';
            if (i % 5 === 0) { tick.innerText = `${i}s`; tick.style.fontSize = '10px'; tick.style.color = 'var(--ui-tick)'; tick.style.paddingLeft = '3px'; }
            ruler.appendChild(tick);
        }

        // Render cue markers
        this._renderCueMarkers(ruler, project);

        // Add context menu for setting cues
        this._setupRulerContextMenu(ruler);
    }

    _renderCueMarkers(ruler, project) {
        const cues = project?.cues || [];
        const zoom = this.getZoom();
        const selectedCue = this.stateManager?.get('ui.selectedCue');

        // Remove existing cue markers
        ruler.querySelectorAll('.cue-marker').forEach(el => el.remove());

        cues.forEach(cue => {
            if (cue.timeMs === null) return;

            const marker = document.createElement('div');
            marker.className = `cue-marker ${cue.enabled ? '' : 'cue-disabled'}`;
            marker.dataset.cueId = cue.id;

            const x = (cue.timeMs / 1000) * zoom;
            marker.style.left = `${x}px`;
            marker.style.setProperty('--cue-color', CUE_COLORS[cue.id] || '#888');

            if (selectedCue === cue.id) {
                marker.classList.add('cue-selected');
            }

            // Label
            const label = document.createElement('span');
            label.className = 'cue-label';
            label.textContent = cue.id;
            marker.appendChild(label);

            // Click to select
            marker.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.cueController) {
                    this.cueController.selectCue(cue.id);
                }
            });

            // Drag to move
            marker.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // Left click only
                e.stopPropagation();
                this._startCueDrag(cue.id, e);
            });

            ruler.appendChild(marker);
        });
    }

    _startCueDrag(cueId, startEvent) {
        const ruler = this.elements.ruler || document.getElementById('ruler');
        if (!ruler) return;

        const zoom = this.getZoom();
        const rulerRect = ruler.getBoundingClientRect();
        const duration = this.stateManager?.get('project.duration') || 60000;
        const snapEnabled = this.stateManager?.get('ui.snapEnabled');
        const gridSize = this.stateManager?.get('ui.gridSize') || 1000;

        const onMouseMove = (e) => {
            const relX = e.clientX - rulerRect.left + ruler.scrollLeft;
            let newTimeMs = (relX / zoom) * 1000;

            // Clamp to valid range
            newTimeMs = Math.max(0, Math.min(newTimeMs, duration));

            // Snap if enabled
            if (snapEnabled) {
                newTimeMs = getSnappedTime(newTimeMs, gridSize);
            }

            // Update marker position visually during drag
            const marker = ruler.querySelector(`.cue-marker[data-cue-id="${cueId}"]`);
            if (marker) {
                marker.style.left = `${(newTimeMs / 1000) * zoom}px`;
            }

            this._dragState = { cueId, timeMs: newTimeMs };
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (this._dragState && this.cueController) {
                this.cueController.updateCueTime(this._dragState.cueId, this._dragState.timeMs);
            }
            this._dragState = null;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    _setupRulerContextMenu(ruler) {
        // Remove existing listener if any
        ruler.removeEventListener('contextmenu', this._rulerContextHandler);

        this._rulerContextHandler = (e) => {
            e.preventDefault();

            const zoom = this.getZoom();
            const rulerRect = ruler.getBoundingClientRect();
            const relX = e.clientX - rulerRect.left;
            const timeMs = (relX / zoom) * 1000;
            const duration = this.stateManager?.get('project.duration') || 60000;

            // Don't allow setting cue past duration
            if (timeMs > duration) return;

            this._showCueContextMenu(e.clientX, e.clientY, timeMs);
        };

        ruler.addEventListener('contextmenu', this._rulerContextHandler);
    }

    _showCueContextMenu(x, y, timeMs) {
        // Remove existing menu
        this._hideCueContextMenu();

        const menu = document.createElement('div');
        menu.className = 'cue-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const cues = this.stateManager?.get('project.cues') || [];

        ['A', 'B', 'C', 'D'].forEach(cueId => {
            const cue = cues.find(c => c.id === cueId);
            const hasTime = cue && cue.timeMs !== null;

            const item = document.createElement('div');
            item.className = 'cue-context-item';
            item.innerHTML = `<span class="cue-context-color" style="background:${CUE_COLORS[cueId]}"></span> ${hasTime ? 'Move' : 'Set'} Cue ${cueId} here`;

            item.addEventListener('click', () => {
                if (this.cueController) {
                    this.cueController.setCue(cueId, timeMs);
                }
                this._hideCueContextMenu();
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this._cueContextMenu = menu;

        // Close on click outside
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                this._hideCueContextMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    _hideCueContextMenu() {
        if (this._cueContextMenu) {
            this._cueContextMenu.remove();
            this._cueContextMenu = null;
        }
    }

    updateCueMarkers() {
        const project = this.stateManager?.get('project');
        const ruler = this.elements.ruler || document.getElementById('ruler');
        if (ruler && project) {
            this._renderCueMarkers(ruler, project);
        }
    }

    updateGridBackground() {
        const content = this.elements.timelineContent || document.getElementById('timeline-content');
        if (!content) return;
        const snapEnabled = this.stateManager.get('ui.snapEnabled');
        const gridSize = this.stateManager.get('ui.gridSize');
        const pixelsPerGrid = (gridSize / 1000) * this.getZoom();

        content.style.backgroundSize = `${pixelsPerGrid}px 100%`;
        content.classList.toggle('grid-hidden', !snapEnabled);
    }

    updateTimeDisplay() {
        if (!this.elements.timeDisplay) return;
        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        const totalSec = Math.max(0, currentTime / 1000);
        const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const sec = Math.floor(totalSec % 60).toString().padStart(2, '0');
        const ms = Math.floor((totalSec % 1) * 100).toString().padStart(2, '0');
        this.elements.timeDisplay.innerText = `${min}:${sec}.${ms}`;
    }

    updatePlayheadUI() {
        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        const x = (currentTime / 1000) * this.getZoom();

        if (this.elements.playheadLine) this.elements.playheadLine.style.transform = `translateX(${x}px)`;
        if (this.elements.playheadHandle) this.elements.playheadHandle.style.transform = `translateX(${x}px)`;

        const scroll = this.elements.timelineScroll || document.getElementById('timeline-scroll-area');
        const isPlaying = this.stateManager.get('playback.isPlaying');

        if (isPlaying && scroll) {
            if (x > scroll.scrollLeft + scroll.clientWidth - 50) {
                scroll.scrollLeft = x - 50;
            }
        }
    }

    updateSelectionUI() {
        const selection = this.stateManager.get('selection') || [];
        document.querySelectorAll('.clip').forEach(el => {
            const isSel = selection.includes(el.dataset.clipId);
            el.classList.toggle('selected', isSel);
        });
    }

    drawClipWaveform(canvas, buffer, color, durationMs) {
        const ctx = canvas.getContext('2d');
        const data = buffer.getChannelData(0);
        const totalSeconds = durationMs / 1000;
        const endSample = Math.min(Math.floor(totalSeconds * buffer.sampleRate), data.length);
        const step = Math.ceil(endSample / canvas.width);
        const amp = canvas.height / 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < canvas.width; i++) {
            let min = 1.0; let max = -1.0;
            const startIdx = i * step;
            for (let j = 0; j < step; j++) {
                const idx = startIdx + j;
                if (idx < endSample) {
                    const datum = data[idx];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }
            }
            ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
        }
    }

    updateAudioClipWaveform(clipId, durationMs) {
        const el = document.getElementById(`clip-${clipId}`);
        if (!el) return;
        const canvas = el.querySelector('canvas.clip-waveform');
        if (!canvas) return;

        const project = this.stateManager.get('project');
        if (!project?.tracks) return;

        let clip = null;
        for (const track of project.tracks) {
            const found = (track.clips || []).find(c => c.id === clipId);
            if (found) { clip = found; break; }
        }
        if (!clip || clip.type !== 'audio') return;

        const zoom = this.getZoom();
        const width = Math.max(10, (durationMs / 1000) * zoom);
        const height = Math.max(20, el.clientHeight || 80);

        canvas.width = Math.max(10, Math.floor(width));
        canvas.height = Math.floor(height);

        const assets = this.stateManager.get('assets');
        if (clip.bufferId && assets[clip.bufferId]) {
            this.drawClipWaveform(canvas, assets[clip.bufferId], '#d97706', durationMs);
        }
    }
}
