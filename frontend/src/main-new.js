/**
 * Main Application Entry Point (Refactored Architecture)
 *
 * This version uses the new StateManager, Services, and Controllers
 */

import { app } from './core/Application.js';
import { CONFIG } from './utils.js';
import { setStateManager, els as bridgeEls } from './stateBridge.js';

// Import legacy timeline functions (to be refactored later)
import {
    buildTimeline,
    renderPreview,
    updatePlayheadUI,
    updateTimeDisplay,
    setCallbacks,
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

    // Connect state bridge for legacy code compatibility
    setStateManager(stateManager);
    Object.assign(bridgeEls, els);

    // Set up legacy timeline callbacks
    setCallbacks(
        (actionName) => stateManager.update(() => {}, {}), // Save for undo (now handled by StateManager)
        (msg) => errorHandler.showToast(msg)
    );

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
        const type = event.dataTransfer.getData('text/plain');

        if (!type) return;

        const rect = event.target.getBoundingClientRect();
        const scrollLeft = els.timelineScroll?.scrollLeft || 0;
        const x = event.clientX - rect.left + scrollLeft;
        const zoom = stateManager.get('ui.zoom');
        let startTime = (x / zoom) * 1000;

        const snapEnabled = stateManager.get('ui.snapEnabled');
        if (snapEnabled) {
            const gridSize = stateManager.get('ui.gridSize');
            startTime = Math.round(startTime / gridSize) * gridSize;
        }

        const clip = createDefaultClip(type, startTime);
        timelineController.addClip(trackId, clip);
        buildTimeline();
        selectClip(clip.id);
    });

    // Handler: Clip mousedown for selection and dragging
    window.addEventListener('app:clip-mousedown', (e) => {
        const { event, clip } = e.detail;

        if (event.ctrlKey || event.metaKey) {
            // Toggle selection
            const selection = stateManager.get('selection');
            const isSelected = selection.includes(clip.id);
            timelineController.selectClips(clip.id, true); // toggle
        } else {
            // Replace selection (unless clicking already selected item)
            const selection = stateManager.get('selection');
            if (!selection.includes(clip.id)) {
                timelineController.selectClips([clip.id]);
            }
        }

        selectClip(clip.id);
        updateSelectionUI();
        updateClipboardUI();
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
