/**
 * Main Application Entry Point (Refactored Architecture)
 *
 * This version uses the new StateManager, Services, and Controllers
 */

import { app } from './core/Application.js';
import { CONFIG, getSnappedTime } from './utils.js';

// Import legacy timeline functions (to be refactored later)
import {
    initTimeline,
    buildTimeline,
    renderPreview,
    updatePlayheadUI,
    updateTimeDisplay,
    selectClip,
    updateGridBackground,
    updateSelectionUI
} from './timeline.js';

// Global references for legacy code compatibility
let stateManager, audioService, projectService, timelineController, undoController, errorHandler;

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    // Initialize application
    await app.init();

    // Get service references
    stateManager = app.stateManager;
    audioService = app.audioService;
    projectService = app.projectService;
    timelineController = app.timelineController;
    undoController = app.undoController;
    errorHandler = app.errorHandler;

    const els = app.elements;

    // Wire timeline module to the application state/services (no bridge/proxy).
    initTimeline({
        stateManager,
        timelineController,
        errorHandler,
        elements: els
    });

    // ==========================================
    // PROJECT OPERATIONS
    // ==========================================

    if (els.btnNew) {
        els.btnNew.onclick = async () => {
            const result = await projectService.createNew(true);
            if (result.success) {
                errorHandler.success(result.message);
                buildTimeline();
                updatePlayheadUI();
                updateGridBackground();
            }
        };
    }

    if (els.btnSave) {
        els.btnSave.onclick = async () => {
            const result = await projectService.save();
            if (result.success) {
                if (result.message) errorHandler.success(result.message);
            } else {
                errorHandler.handle(result.message);
            }
        };
    }

    if (els.btnSaveAs) {
        els.btnSaveAs.onclick = async () => {
            const result = await projectService.save(null, true);
            if (result.success) {
                errorHandler.success(result.message);
            } else {
                errorHandler.handle(result.message);
            }
        };
    }

    if (els.btnOpen) {
        els.btnOpen.onclick = async () => {
            const result = await projectService.load();
            if (result.success) {
                errorHandler.success(result.message);
                buildTimeline();
                updatePlayheadUI();
                updateGridBackground();
            } else if (result.message !== 'Load cancelled') {
                errorHandler.handle(result.message);
            }
        };
    }

    if (els.btnExportBin) {
        els.btnExportBin.onclick = async () => {
            const result = await projectService.exportBinary();
            if (result.success) {
                errorHandler.success(result.message);
            } else {
                errorHandler.handle(result.message);
            }
        };
    }

    if (els.btnUpload) {
        els.btnUpload.onclick = async () => {
            const result = await projectService.uploadToDevice();
            if (result.success) {
                errorHandler.success(result.message);
            } else {
                errorHandler.handle(result.message);
            }
        };
    }

    // ==========================================
    // UNDO / REDO
    // ==========================================

    if (els.btnUndo) {
        els.btnUndo.onclick = () => {
            undoController.undo();
            buildTimeline();
            updateSelectionUI();
        };
    }

    if (els.btnRedo) {
        els.btnRedo.onclick = () => {
            undoController.redo();
            buildTimeline();
            updateSelectionUI();
        };
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        // Ctrl+Z / Cmd+Z: Undo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoController.undo();
            buildTimeline();
            updateSelectionUI();
        }
        // Ctrl+Shift+Z / Cmd+Shift+Z: Redo
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            undoController.redo();
            buildTimeline();
            updateSelectionUI();
        }
        // Ctrl+S / Cmd+S: Save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            els.btnSave?.click();
        }
        // Delete: Delete selected
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                timelineController.deleteSelected();
                buildTimeline();
                updateSelectionUI();
            }
        }
        // Ctrl+C: Copy
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                timelineController.copySelected();
                updateClipboardUI();
            }
        }
        // Ctrl+V: Paste
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                timelineController.paste();
                buildTimeline();
            }
        }
        // Ctrl+D: Duplicate
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                timelineController.duplicateSelected();
                buildTimeline();
            }
        }
        // Space: Play/Pause
        if (e.key === ' ') {
            if (document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                els.btnPlay?.click();
            }
        }
    });

    // ==========================================
    // CLIPBOARD OPERATIONS
    // ==========================================

    if (els.btnCopy) {
        els.btnCopy.onclick = () => {
            timelineController.copySelected();
            updateClipboardUI();
        };
    }

    if (els.btnPaste) {
        els.btnPaste.onclick = () => {
            timelineController.paste();
            buildTimeline();
        };
    }

    if (els.btnDuplicate) {
        els.btnDuplicate.onclick = () => {
            timelineController.duplicateSelected();
            buildTimeline();
        };
    }

    function updateClipboardUI() {
        const selection = stateManager.get('selection');
        const clipboard = stateManager.get('clipboard');

        if (els.btnCopy) els.btnCopy.disabled = selection.length === 0;
        if (els.btnPaste) els.btnPaste.disabled = !clipboard || clipboard.length === 0;
        if (els.btnDuplicate) els.btnDuplicate.disabled = selection.length === 0;
    }

    // ==========================================
    // TIMELINE EVENT HANDLERS (Migrated from timeline.js)
    // ==========================================

    // Handler: Load audio file into track
    window.addEventListener('app:load-audio', async (e) => {
        const { file, trackId } = e.detail;

        try {
            const bufferId = `audio_${Date.now()}`;
            const buffer = await audioService.loadAudioFile(file, bufferId);

            const clip = {
                id: `c${Date.now()}`,
                type: 'audio',
                startTime: stateManager.get('playback.currentTime') || 0,
                duration: buffer.duration * 1000,
                bufferId,
                props: { name: file.name }
            };

            timelineController.addClip(trackId, clip);
            buildTimeline();
            errorHandler.success(`Loaded: ${file.name}`);
        } catch (error) {
            errorHandler.handle(error, { prefix: 'Audio Load Failed' });
        }
    });

    // Handler: Drop clip from palette to timeline
    window.addEventListener('app:drop-clip', (e) => {
        const { event, trackId } = e.detail;
        const type = event.dataTransfer.getData('type') || event.dataTransfer.getData('text/plain');

        if (!type) return;

        const scrollRect = els.timelineScroll?.getBoundingClientRect();
        const scrollLeft = els.timelineScroll?.scrollLeft || 0;
        const x = event.clientX - (scrollRect?.left || 0) + scrollLeft - CONFIG.headerWidth;
        const zoom = stateManager.get('ui.zoom');
        let startTime = (x / zoom) * 1000;

        const snapEnabled = stateManager.get('ui.snapEnabled');
        const gridSize = stateManager.get('ui.gridSize');
        startTime = getSnappedTime(startTime, { snapEnabled, gridSize });

        const clip = createDefaultClip(type, startTime);
        timelineController.addClip(trackId, clip);
        buildTimeline();
        selectClip(clip.id);
    });

    // --- SCRUBBER & DESELECT (timeline click to set playhead) ---
    const handleScrub = (e) => {
        if (e.target.closest('.clip') || e.target.closest('.clip-handle')) return;

        const clickedTimelineArea =
            e.target.closest('.track-header') ||
            e.target.classList.contains('track-lane') ||
            e.target === els.timelineContent ||
            e.target === els.timelineScroll ||
            e.target === els.tracksContainer;

        if (clickedTimelineArea) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }

            // Clear selection when clicking empty space
            stateManager.set('selection', [], { skipHistory: true });
            updateSelectionUI();
            updateClipboardUI();
        }

        const scrollRect = els.timelineScroll.getBoundingClientRect();
        const startX = e.clientX - scrollRect.left + els.timelineScroll.scrollLeft - CONFIG.headerWidth;
        const zoom = stateManager.get('ui.zoom');
        const duration = stateManager.get('project.duration');

        const updateTime = (xPos) => {
            const t = (xPos / zoom) * 1000;
            timelineController.setCurrentTime(Math.max(0, Math.min(duration, t)));
            updatePlayheadUI();
            renderPreview();
            updateTimeDisplay();
        };

        updateTime(startX);

        const move = (ev) => {
            updateTime(ev.clientX - scrollRect.left + els.timelineScroll.scrollLeft - CONFIG.headerWidth);
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    if (els.timelineScroll) {
        els.timelineScroll.addEventListener('mousedown', handleScrub);
    }

    // Handler: Clip mousedown for selection and drag/resize
    window.addEventListener('app:clip-mousedown', (e) => {
        const { event, clipId } = e.detail;
        const startX = event.clientX;

        const zoom = stateManager.get('ui.zoom');
        const pxPerMs = zoom / 1000;

        // --- 1) SELECTION LOGIC ---
        const selection = stateManager.get('selection') || [];
        let nextSelection = selection;

        if (event.ctrlKey || event.metaKey) {
            // Toggle
            nextSelection = selection.includes(clipId)
                ? selection.filter(id => id !== clipId)
                : [...selection, clipId];
        } else {
            // Select only if clicking an unselected item (keep multi until we know it's a click vs drag)
            if (!selection.includes(clipId)) {
                nextSelection = [clipId];
            }
        }

        stateManager.set('selection', nextSelection, { skipHistory: true });
        updateSelectionUI();
        updateClipboardUI();

        // --- 2) DRAG/RESIZE PREP ---
        const isResizeRight = event.target.classList.contains('right');
        const isResizeLeft = event.target.classList.contains('left');
        const isMove = !isResizeRight && !isResizeLeft;

        // Capture initial state (no object references; state is immutable)
        const initialStates = {};
        const state = stateManager.state;

        const captureClip = (id) => {
            for (const track of (state.project?.tracks || [])) {
                const clip = (track.clips || []).find(c => c.id === id);
                if (clip) {
                    initialStates[id] = { start: clip.startTime, dur: clip.duration };
                    return;
                }
            }
        };

        if (!isMove) {
            captureClip(clipId);
        } else {
            nextSelection.forEach(captureClip);
        }

        let hasMoved = false;
        let historyStarted = false;

        const startHistory = () => {
            if (historyStarted) return;
            historyStarted = true;
            // Push a single undo boundary for the entire drag.
            stateManager.update(() => {}, { skipNotify: true });
        };

        const moveHandler = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 3 && !hasMoved) {
                hasMoved = true;
                startHistory();
            }
            if (!hasMoved) return;

            stateManager.update(draft => {
                const snapEnabled = draft.ui.snapEnabled;
                const gridSize = draft.ui.gridSize;

                const findDraftClip = (id) => {
                    for (const t of draft.project.tracks) {
                        const c = t.clips.find(x => x.id === id);
                        if (c) return c;
                    }
                    return null;
                };

                if (isResizeRight) {
                    const init = initialStates[clipId];
                    if (!init) return;
                    let newDur = init.dur + (dx / pxPerMs);
                    if (newDur < CONFIG.minClipDuration) newDur = CONFIG.minClipDuration;
                    if (snapEnabled) newDur = getSnappedTime(init.start + newDur, { snapEnabled, gridSize }) - init.start;
                    const c = findDraftClip(clipId);
                    if (c) c.duration = Math.max(CONFIG.minClipDuration, newDur);
                } else if (isResizeLeft) {
                    const init = initialStates[clipId];
                    if (!init) return;
                    let newStart = init.start + (dx / pxPerMs);
                    if (snapEnabled) newStart = getSnappedTime(newStart, { snapEnabled, gridSize });
                    if (newStart < 0) newStart = 0;
                    let newDur = (init.start + init.dur) - newStart;
                    if (newDur < CONFIG.minClipDuration) {
                        newStart = (init.start + init.dur) - CONFIG.minClipDuration;
                        newDur = CONFIG.minClipDuration;
                    }
                    const c = findDraftClip(clipId);
                    if (c) { c.startTime = newStart; c.duration = newDur; }
                } else {
                    // MOVE (multi)
                    let dt = dx / pxPerMs;
                    const leadInit = initialStates[clipId];
                    if (!leadInit) return;

                    const rawNewStart = leadInit.start + dt;
                    if (snapEnabled) {
                        const snappedNewStart = getSnappedTime(rawNewStart, { snapEnabled, gridSize });
                        dt = snappedNewStart - leadInit.start;
                    }

                    Object.keys(initialStates).forEach(id => {
                        const init = initialStates[id];
                        let newStart = init.start + dt;
                        if (newStart < 0) newStart = 0;
                        const c = findDraftClip(id);
                        if (c) c.startTime = newStart;
                    });
                }

                draft.isDirty = true;
            }, { skipHistory: true, skipNotify: true });

            buildTimeline();
            updateSelectionUI();
            renderPreview();
        };

        const upHandler = () => {
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);

            // If it was a click (no drag) on an already-selected clip without Ctrl,
            // collapse multi-selection to just that clip.
            const finalSelection = stateManager.get('selection') || [];
            if (!hasMoved && !event.ctrlKey && !event.metaKey && finalSelection.length > 1) {
                if (finalSelection.includes(clipId)) {
                    stateManager.set('selection', [clipId], { skipHistory: true });
                    updateSelectionUI();
                    updateClipboardUI();
                }
            }
        };

        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
    });

    // Helper: Create default clip based on type
    function createDefaultClip(type, startTime) {
        const defaultProps = {
            solid: { color: '#ff0000' },
            flash: { color: '#ffffff' },
            strobe: { color: '#ff0000', rate: 10 },
            rainbow: { speed: 1, frequency: 1 },
            rainbowHold: { frequency: 1 },
            chase: { color: '#00ff00', speed: 1, width: 0.1 },
            wipe: { color: '#0000ff' },
            scanner: { color: '#ff00ff', speed: 1, width: 0.1 },
            meteor: { color: '#ffaa00', speed: 1, tailLen: 0.3 },
            fire: {},
            sparkle: { color: '#0000ff', density: 0.3 },
            glitch: { color: '#ff0000', color2: '#00ff00', amount: 0.2 },
            breathe: { color: '#00ffff', speed: 1 },
            heartbeat: { color: '#ff0000', speed: 1 },
            alternate: { colorA: '#ff0000', colorB: '#0000ff' },
            energy: { color: '#ff00ff', color2: '#00ffff', speed: 1 }
        };

        return {
            id: `c${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            startTime,
            duration: CONFIG.defaultDuration,
            props: defaultProps[type] || {}
        };
    }

    // ==========================================
    // PLAYBACK CONTROLS
    // ==========================================

    if (els.btnPlay) {
        els.btnPlay.onclick = () => {
            const isPlaying = stateManager.get('playback.isPlaying');

            if (isPlaying) {
                audioService.stopPlayback();
                els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
            } else {
                audioService.startPlayback();
                els.btnPlay.innerHTML = '<i class="fas fa-pause"></i>';
                startAnimationLoop();
            }
        };
    }

    if (els.btnStop) {
        els.btnStop.onclick = () => {
            audioService.stopPlayback();
            timelineController.setCurrentTime(0);
            updatePlayheadUI();
            renderPreview();
            updateTimeDisplay();
            if (els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
        };
    }

    if (els.btnToStart) {
        els.btnToStart.onclick = () => {
            timelineController.setCurrentTime(0);
            updatePlayheadUI();
            renderPreview();
            updateTimeDisplay();
        };
    }

    function startAnimationLoop() {
        function animate() {
            const isPlaying = stateManager.get('playback.isPlaying');
            if (!isPlaying) return;

            const audioCtx = audioService.ctx;
            const startTime = stateManager.get('playback.startTime');

            if (audioCtx && startTime !== undefined) {
                const currentTime = (audioCtx.currentTime - startTime) * 1000;
                timelineController.setCurrentTime(currentTime);
                updatePlayheadUI();
                renderPreview();
                updateTimeDisplay();

                const duration = stateManager.get('project.duration');
                if (currentTime >= duration) {
                    audioService.stopPlayback();
                    if (els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
                    return;
                }
            }

            requestAnimationFrame(animate);
        }
        animate();
    }

    // ==========================================
    // VOLUME CONTROL
    // ==========================================

    if (els.volSlider) {
        els.volSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            audioService.setVolume(volume);

            const icon = document.getElementById('vol-icon');
            if (icon) {
                if (volume === 0) {
                    icon.className = "fas fa-volume-mute text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
                } else if (volume < 0.5) {
                    icon.className = "fas fa-volume-down text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
                } else {
                    icon.className = "fas fa-volume-up text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
                }
            }
        });
    }

    // ==========================================
    // ZOOM & GRID CONTROLS
    // ==========================================

    if (els.zoomSlider) {
        els.zoomSlider.oninput = (e) => {
            const zoom = parseInt(e.target.value);
            timelineController.setZoom(zoom);
            buildTimeline();
            updatePlayheadUI();
            updateGridBackground();
        };
    }

    if (els.chkSnap) {
        els.chkSnap.onchange = (e) => {
            timelineController.setSnapEnabled(e.target.checked);
            updateGridBackground();
        };
    }

    if (els.selGrid) {
        els.selGrid.onchange = (e) => {
            timelineController.setGridSize(parseInt(e.target.value));
            updateGridBackground();
        };
    }

    // ==========================================
    // TRACK CONTROLS
    // ==========================================

    if (els.btnAddTrackLed) {
        els.btnAddTrackLed.onclick = () => {
            timelineController.addTrack('led');
            buildTimeline();
        };
    }

    if (els.btnAddTrackAudio) {
        els.btnAddTrackAudio.onclick = () => {
            timelineController.addTrack('audio');
            buildTimeline();
        };
    }

    // ==========================================
    // TIMELINE SCROLLING
    // ==========================================

    if (els.timelineScroll) {
        els.timelineScroll.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -10 : 10;
                const currentZoom = stateManager.get('ui.zoom');
                const newZoom = Math.max(10, Math.min(200, currentZoom + delta));
                if (newZoom !== currentZoom) {
                    timelineController.setZoom(newZoom);
                    buildTimeline();
                    updatePlayheadUI();
                    updateGridBackground();
                }
                return;
            }
            if (e.shiftKey) return;
            e.preventDefault();
            els.timelineScroll.scrollLeft += e.deltaY;
        }, { passive: false });

        els.timelineScroll.addEventListener('scroll', () => {
            if (els.trackHeaders) {
                els.trackHeaders.scrollTop = els.timelineScroll.scrollTop;
            }
        });
    }

    if (els.trackHeaders) {
        els.trackHeaders.addEventListener('wheel', e => {
            e.preventDefault();
            if (els.timelineScroll) {
                els.timelineScroll.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    // ==========================================
    // INITIAL RENDER
    // ==========================================

    buildTimeline();
    updatePlayheadUI();
    updateTimeDisplay();
    updateGridBackground();
    updateClipboardUI();

    console.log('✅ UI initialized and rendered');
});
