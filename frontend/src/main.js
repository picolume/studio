/**
 * Main Application Entry Point (Refactored Architecture)
 *
 * This version uses the new StateManager, Services, and Controllers
 */

import { app } from './core/Application.js';
import { CONFIG, getSnappedTime } from './utils.js';
import { getBackend } from './core/Backend.js';

// Import legacy timeline functions (to be refactored later)
import {
    initTimeline,
    buildTimeline,
    renderPreview,
    updatePlayheadUI,
    updateTimeDisplay,
    selectClip,
    updateGridBackground,
    updateSelectionUI,
    populateInspector,
    updateAudioClipWaveform,
    getPreviewRenderer
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

    // ==========================================
    // DEMO BADGE (web demo only)
    // ==========================================

    try {
        const backend = getBackend();
        if (backend?.kind === 'demo') {
            const titleEl = document.getElementById('app-title');
            if (titleEl && !document.getElementById('app-demo-badge')) {
                const badge = document.createElement('span');
                badge.id = 'app-demo-badge';
                badge.textContent = 'DEMO';
                badge.className = 'ml-2 text-xs font-semibold tracking-widest text-cyan-400 bg-[var(--ui-toolbar-bg)] border border-[var(--ui-border)] rounded px-2 py-0.5 align-middle';
                titleEl.appendChild(badge);
            }
        }
    } catch { }

    // ==========================================
    // THEME (Standard / Aurora)
    // ==========================================

    const UI_THEME_KEY = 'picolume:theme';
    const DEFAULT_THEME = 'standard';
    const THEMES = new Set(['standard', 'aurora', 'nord', 'solarized', 'gruvbox', 'hc-dark', 'crimson', 'graphite', 'forest']);

    const setTheme = (theme) => {
        const resolved = THEMES.has(theme) ? theme : DEFAULT_THEME;
        document.documentElement.dataset.theme = resolved;

        try {
            localStorage.setItem(UI_THEME_KEY, resolved);
        } catch { }

        document.querySelectorAll('.hamburger-theme-item[data-action="theme"]').forEach(btn => {
            const isActive = btn.dataset.theme === resolved;
            btn.setAttribute('aria-checked', String(isActive));
            btn.classList.toggle('is-active', isActive);
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        try { renderPreview(); } catch { }
    };

    const loadTheme = () => {
        try {
            const raw = localStorage.getItem(UI_THEME_KEY);
            if (raw) return raw;
        } catch { }
        return DEFAULT_THEME;
    };

    setTheme(loadTheme());

    // ==========================================
    // LAYOUT TOGGLES (Palette / Preview / Inspector)
    // ==========================================

    const UI_LAYOUT_KEY = 'picolume:ui';
    const panePalette = document.getElementById('pane-palette');
    const panePreview = document.getElementById('pane-preview');
    const paneInspector = document.getElementById('pane-inspector');
    const btnTogglePalette = document.getElementById('btn-toggle-palette');
    const btnTogglePreview = document.getElementById('btn-toggle-preview');
    const btnToggleInspector = document.getElementById('btn-toggle-inspector');
    const btnManual = document.getElementById('btn-manual');
    const manualModal = document.getElementById('manual-modal');
    const manualFrame = document.getElementById('manual-frame');
    const btnManualClose = document.getElementById('btn-manual-close');

    const readCssPx = (name, fallback) => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const UI_DEFAULTS = {
        paletteWidth: readCssPx('--palette-width', 256),
        inspectorWidth: readCssPx('--inspector-width', 288),
        previewHeight: readCssPx('--preview-height', 256),
    };

    let UI_LAYOUT = {
        paletteOpen: true,
        previewOpen: true,
        inspectorOpen: true,
        previewHeight: null, // null = use default, otherwise custom height in px
    };

    const isTypingTarget = (el) => {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    };

    const loadUILayout = () => {
        try {
            const raw = localStorage.getItem(UI_LAYOUT_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== 'object') return;
            UI_LAYOUT = { ...UI_LAYOUT, ...saved };
        } catch { }
    };

    const saveUILayout = () => {
        try {
            localStorage.setItem(UI_LAYOUT_KEY, JSON.stringify(UI_LAYOUT));
        } catch { }
    };

    const setPressed = (btn, pressed) => {
        if (!btn) return;
        btn.setAttribute('aria-pressed', String(pressed));
    };

    const setPaneOpen = (pane, open) => {
        if (!pane) return;
        pane.classList.toggle('pane-collapsed', !open);
        pane.setAttribute('aria-hidden', String(!open));
    };

    const applyLayout = () => {
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--palette-width', UI_LAYOUT.paletteOpen ? `${UI_DEFAULTS.paletteWidth}px` : '0px');
        rootStyle.setProperty('--inspector-width', UI_LAYOUT.inspectorOpen ? `${UI_DEFAULTS.inspectorWidth}px` : '0px');

        // Use custom preview height if set, otherwise use default
        const previewHeight = UI_LAYOUT.previewHeight ?? UI_DEFAULTS.previewHeight;
        rootStyle.setProperty('--preview-height', UI_LAYOUT.previewOpen ? `${previewHeight}px` : '0px');

        setPressed(btnTogglePalette, UI_LAYOUT.paletteOpen);
        setPressed(btnTogglePreview, UI_LAYOUT.previewOpen);
        setPressed(btnToggleInspector, UI_LAYOUT.inspectorOpen);

        setPaneOpen(panePalette, UI_LAYOUT.paletteOpen);
        setPaneOpen(panePreview, UI_LAYOUT.previewOpen);
        setPaneOpen(paneInspector, UI_LAYOUT.inspectorOpen);

        updatePlayheadUI();
        updateGridBackground();
    };

    const togglePane = (which) => {
        if (which === 'palette') UI_LAYOUT.paletteOpen = !UI_LAYOUT.paletteOpen;
        if (which === 'preview') UI_LAYOUT.previewOpen = !UI_LAYOUT.previewOpen;
        if (which === 'inspector') UI_LAYOUT.inspectorOpen = !UI_LAYOUT.inspectorOpen;
        applyLayout();
        saveUILayout();
    };

    btnTogglePalette?.addEventListener('click', () => togglePane('palette'));
    btnTogglePreview?.addEventListener('click', () => togglePane('preview'));
    btnToggleInspector?.addEventListener('click', () => togglePane('inspector'));

    const setManualOpen = (open) => {
        if (!manualModal) return;
        manualModal.setAttribute('aria-hidden', String(!open));
        if (open && manualFrame && !manualFrame.getAttribute('src')) {
            manualFrame.setAttribute('src', 'manual.html');
        }
    };

    btnManual?.addEventListener('click', (e) => {
        e.preventDefault();
        setManualOpen(true);
    });
    btnManualClose?.addEventListener('click', () => setManualOpen(false));
    manualModal?.addEventListener('mousedown', (e) => {
        if (e.target === manualModal) setManualOpen(false);
    });

    loadUILayout();
    applyLayout();

    // ==========================================
    // PREVIEW MODE SELECTOR
    // ==========================================

    const previewModeSelector = document.getElementById('preview-mode-selector');
    const previewCanvas = document.getElementById('preview-canvas');

    const updatePreviewModeUI = () => {
        const currentMode = stateManager.get('ui.previewMode') || 'track';
        previewModeSelector?.querySelectorAll('.preview-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === currentMode);
        });
    };

    previewModeSelector?.addEventListener('click', (e) => {
        const btn = e.target.closest('.preview-mode-btn');
        if (!btn) return;
        const mode = btn.dataset.mode;
        if (mode) {
            stateManager.update(draft => {
                draft.ui.previewMode = mode;
            }, { skipHistory: true });
            updatePreviewModeUI();
            renderPreview();
        }
    });

    // Initialize mode UI
    updatePreviewModeUI();

    // ==========================================
    // CANVAS RESIZE OBSERVER
    // ==========================================

    const resizeCanvas = () => {
        if (!previewCanvas || !panePreview) return;

        const rect = panePreview.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);

        // Only resize if dimensions actually changed
        if (previewCanvas.width !== newWidth || previewCanvas.height !== newHeight) {
            previewCanvas.width = newWidth;
            previewCanvas.height = newHeight;
            renderPreview();
        }
    };

    // Use ResizeObserver to watch for container size changes
    if (typeof ResizeObserver !== 'undefined' && panePreview) {
        const previewResizeObserver = new ResizeObserver(() => {
            resizeCanvas();
        });
        previewResizeObserver.observe(panePreview);
    }

    // Initial canvas sizing
    resizeCanvas();

    // ==========================================
    // FIELD VIEW DRAG INTERACTION
    // ==========================================

    let fieldDragState = null; // { propId, startX, startY, origX, origY }

    const getCanvasCoords = (e) => {
        if (!previewCanvas) return { x: 0, y: 0 };
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = previewCanvas.width / rect.width;
        const scaleY = previewCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    previewCanvas?.addEventListener('mousedown', (e) => {
        if (stateManager.get('ui.previewMode') !== 'field') return;

        const coords = getCanvasCoords(e);
        const previewRenderer = getPreviewRenderer();
        if (!previewRenderer) return;

        const propId = previewRenderer.hitTestProp(coords.x, coords.y);
        if (propId) {
            const fieldLayout = stateManager.get('project.settings.fieldLayout') || {};
            const usedProps = previewRenderer._getUsedProps(stateManager.get('project'));
            const index = usedProps.indexOf(propId);
            const pos = previewRenderer._getPropPosition(propId, index, fieldLayout, previewCanvas.width, previewCanvas.height, usedProps.length);

            fieldDragState = {
                propId,
                startX: coords.x,
                startY: coords.y,
                origX: pos.x,
                origY: pos.y
            };
            previewCanvas.style.cursor = 'grabbing';
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!fieldDragState || !previewCanvas) return;

        const coords = getCanvasCoords(e);
        const dx = coords.x - fieldDragState.startX;
        const dy = coords.y - fieldDragState.startY;

        const newX = Math.max(20, Math.min(previewCanvas.width - 20, fieldDragState.origX + dx));
        const newY = Math.max(20, Math.min(previewCanvas.height - 20, fieldDragState.origY + dy));

        // Update position in state (without adding to undo history during drag)
        stateManager.update(draft => {
            if (!draft.project.settings.fieldLayout) {
                draft.project.settings.fieldLayout = {};
            }
            draft.project.settings.fieldLayout[fieldDragState.propId] = { x: newX, y: newY };
        }, { skipHistory: true });

        renderPreview();
    });

    window.addEventListener('mouseup', () => {
        if (fieldDragState) {
            // Mark project as dirty since we moved a prop
            stateManager.update(draft => {
                draft.isDirty = true;
            }, { skipHistory: true });
            fieldDragState = null;
            if (previewCanvas) previewCanvas.style.cursor = '';
        }
    });

    // ==========================================
    // PREVIEW RESIZE HANDLE
    // ==========================================

    const previewResizeHandle = document.getElementById('preview-resize-handle');
    let previewResizeState = null; // { startY, startHeight }

    const MIN_PREVIEW_HEIGHT = 80;
    const MAX_PREVIEW_HEIGHT = 600;

    previewResizeHandle?.addEventListener('mousedown', (e) => {
        if (!panePreview || !UI_LAYOUT.previewOpen) return;

        const currentHeight = UI_LAYOUT.previewHeight ?? UI_DEFAULTS.previewHeight;
        previewResizeState = {
            startY: e.clientY,
            startHeight: currentHeight
        };
        previewResizeHandle.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!previewResizeState) return;

        const deltaY = e.clientY - previewResizeState.startY;
        const newHeight = Math.max(MIN_PREVIEW_HEIGHT, Math.min(MAX_PREVIEW_HEIGHT, previewResizeState.startHeight + deltaY));

        UI_LAYOUT.previewHeight = newHeight;
        document.documentElement.style.setProperty('--preview-height', `${newHeight}px`);
    });

    window.addEventListener('mouseup', () => {
        if (previewResizeState) {
            previewResizeHandle?.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            previewResizeState = null;
            saveUILayout();
        }
    });

    // ==========================================
    // HAMBURGER MENU
    // ==========================================

    const btnHamburger = document.getElementById('btn-hamburger');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');

    const setHamburgerOpen = (open) => {
        if (!btnHamburger || !hamburgerDropdown) return;
        btnHamburger.setAttribute('aria-expanded', String(open));
        hamburgerDropdown.setAttribute('aria-hidden', String(!open));
    };

    const toggleHamburger = () => {
        const isOpen = btnHamburger?.getAttribute('aria-expanded') === 'true';
        setHamburgerOpen(!isOpen);
    };

    btnHamburger?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHamburger();
    });

    // Close hamburger menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#hamburger-menu')) {
            setHamburgerOpen(false);
        }
    });

    // Close hamburger menu on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && btnHamburger?.getAttribute('aria-expanded') === 'true') {
            setHamburgerOpen(false);
        }
    });

    // Handle hamburger menu item clicks
    hamburgerDropdown?.addEventListener('click', (e) => {
        const item = e.target.closest('.hamburger-item');
        if (!item) return;

        const action = item.dataset.action;

        if (item.dataset.keepOpen === 'true') {
            return;
        }

        setHamburgerOpen(false);

        switch (action) {
            case 'new':
                els.btnNew?.click();
                break;
            case 'open':
                els.btnOpen?.click();
                break;
            case 'save':
                els.btnSave?.click();
                break;
            case 'save-as':
                els.btnSaveAs?.click();
                break;
            case 'export':
                els.btnExportBin?.click();
                break;
            case 'upload':
                els.btnUpload?.click();
                break;
            case 'settings':
                els.btnSettings?.click();
                break;
            case 'manual':
                e.preventDefault();
                setManualOpen(true);
                break;
            case 'theme':
                setTheme(item.dataset.theme);
                break;
        }
    });

    // Wire timeline module to the application state/services (no bridge/proxy).
    initTimeline({
        stateManager,
        timelineController,
        audioService,
        errorHandler,
        elements: els
    });

    // ==========================================
    // PALETTE DRAG INITIALIZATION
    // ==========================================
    document.querySelectorAll('.palette-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            const type = item.dataset.type;
            if (type) {
                e.dataTransfer.setData('type', type);
                e.dataTransfer.setData('text/plain', type);
                e.dataTransfer.effectAllowed = 'copy';
            }
        });
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

    if (els.btnSettings) {
        els.btnSettings.onclick = () => {
            // Clear selection and show project settings in inspector
            stateManager.set('selection', [], { skipHistory: true });
            updateSelectionUI();
            populateInspector(null);
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
        // Esc: Close manual
        if (e.key === 'Escape' && manualModal?.getAttribute('aria-hidden') === 'false') {
            e.preventDefault();
            setManualOpen(false);
            return;
        }
        // Alt+1/2/3: Toggle panes
        if (!isTypingTarget(document.activeElement) && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            if (e.key === '1') { e.preventDefault(); togglePane('palette'); return; }
            if (e.key === '2') { e.preventDefault(); togglePane('preview'); return; }
            if (e.key === '3') { e.preventDefault(); togglePane('inspector'); return; }
        }
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
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.shiftKey) {
            e.preventDefault();
            els.btnSave?.click();
            return;
        }
        // Ctrl+Shift+S / Cmd+Shift+S: Save As
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && e.shiftKey) {
            e.preventDefault();
            els.btnSaveAs?.click();
            return;
        }
        // Ctrl+N / Cmd+N: New Project
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            els.btnNew?.click();
            return;
        }
        // Ctrl+O / Cmd+O: Open Project
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            els.btnOpen?.click();
            return;
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
    // KEYBOARD NAVIGATION FOR TIMELINE (Accessibility)
    // ==========================================

    // Helper: Get all clip elements in DOM order
    const getAllClipElements = () => {
        return Array.from(document.querySelectorAll('.clip[data-clip-id]'));
    };

    // Helper: Get clip data by ID
    const getClipById = (clipId) => {
        const tracks = stateManager.get('project.tracks') || [];
        for (const track of tracks) {
            const clip = (track.clips || []).find(c => c.id === clipId);
            if (clip) return { clip, track };
        }
        return null;
    };

    // Helper: Find adjacent clip for navigation
    const findAdjacentClip = (currentClipId, direction) => {
        const clips = getAllClipElements();
        const currentIndex = clips.findIndex(el => el.dataset.clipId === currentClipId);
        if (currentIndex === -1) return null;

        if (direction === 'next' && currentIndex < clips.length - 1) {
            return clips[currentIndex + 1].dataset.clipId;
        }
        if (direction === 'prev' && currentIndex > 0) {
            return clips[currentIndex - 1].dataset.clipId;
        }
        return null;
    };

    // Helper: Find clip in adjacent track (up/down navigation)
    const findClipInAdjacentTrack = (currentClipId, direction) => {
        const tracks = stateManager.get('project.tracks') || [];
        let currentTrackIndex = -1;
        let currentClip = null;

        for (let i = 0; i < tracks.length; i++) {
            const clip = tracks[i].clips.find(c => c.id === currentClipId);
            if (clip) {
                currentTrackIndex = i;
                currentClip = clip;
                break;
            }
        }

        if (currentTrackIndex === -1 || !currentClip) return null;

        const targetTrackIndex = direction === 'up' ? currentTrackIndex - 1 : currentTrackIndex + 1;
        if (targetTrackIndex < 0 || targetTrackIndex >= tracks.length) return null;

        const targetTrack = tracks[targetTrackIndex];
        if (!targetTrack.clips || targetTrack.clips.length === 0) return null;

        // Find clip closest to current clip's start time
        let closest = targetTrack.clips[0];
        let closestDist = Math.abs(closest.startTime - currentClip.startTime);

        for (const clip of targetTrack.clips) {
            const dist = Math.abs(clip.startTime - currentClip.startTime);
            if (dist < closestDist) {
                closest = clip;
                closestDist = dist;
            }
        }

        return closest.id;
    };

    // Helper: Nudge selected clips by time amount
    // Returns the clipId that should be refocused (for keyboard navigation)
    const nudgeSelectedClips = (deltaMs, focusClipId = null) => {
        const selection = stateManager.get('selection') || [];
        if (selection.length === 0) return;

        const gridSize = stateManager.get('ui.gridSize') || 1000;
        const snapEnabled = stateManager.get('ui.snapEnabled');
        // Preserve direction (sign) when using grid size
        const nudgeAmount = snapEnabled ? Math.sign(deltaMs) * gridSize : deltaMs;

        stateManager.update(draft => {
            const tracks = draft.project.tracks || [];
            for (const track of tracks) {
                for (const clip of track.clips || []) {
                    if (selection.includes(clip.id)) {
                        const newTime = Math.max(0, clip.startTime + nudgeAmount);
                        clip.startTime = newTime;
                    }
                }
            }
            draft.isDirty = true;
        });

        buildTimeline();
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));

        // Restore focus to the clip after DOM rebuild
        if (focusClipId) {
            requestAnimationFrame(() => {
                const el = document.getElementById(`clip-${focusClipId}`);
                if (el) el.focus();
            });
        }
    };

    // Helper: Resize selected clips
    const resizeSelectedClips = (deltaMs, focusClipId = null) => {
        const selection = stateManager.get('selection') || [];
        if (selection.length === 0) return;

        const gridSize = stateManager.get('ui.gridSize') || 1000;
        const snapEnabled = stateManager.get('ui.snapEnabled');
        // Preserve direction (sign) when using grid size
        const resizeAmount = snapEnabled ? Math.sign(deltaMs) * gridSize : deltaMs;
        const minDuration = 100; // Minimum clip duration

        stateManager.update(draft => {
            const tracks = draft.project.tracks || [];
            for (const track of tracks) {
                for (const clip of track.clips || []) {
                    if (selection.includes(clip.id)) {
                        const newDuration = Math.max(minDuration, clip.duration + resizeAmount);
                        clip.duration = newDuration;
                    }
                }
            }
            draft.isDirty = true;
        });

        buildTimeline();
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));

        // Restore focus to the clip after DOM rebuild
        if (focusClipId) {
            requestAnimationFrame(() => {
                const el = document.getElementById(`clip-${focusClipId}`);
                if (el) el.focus();
            });
        }
    };

    // Handle keyboard events on focused clips
    window.addEventListener('app:clip-keydown', (e) => {
        const { event, clipId } = e.detail;
        const key = event.key;

        // Enter or Space: Toggle selection
        if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            const selection = stateManager.get('selection') || [];
            if (event.ctrlKey || event.metaKey) {
                // Toggle in multi-select
                timelineController.selectClips(clipId, true);
            } else {
                // Replace selection
                timelineController.selectClips(clipId);
            }
            updateSelectionUI();
            updateClipboardUI();
            return;
        }

        // Tab: Navigate to next clip
        if (key === 'Tab') {
            event.preventDefault();
            const nextClipId = findAdjacentClip(clipId, event.shiftKey ? 'prev' : 'next');
            if (nextClipId) {
                const nextEl = document.getElementById(`clip-${nextClipId}`);
                if (nextEl) {
                    nextEl.focus();
                    // Select on navigation
                    timelineController.selectClips(nextClipId);
                    updateSelectionUI();
                }
            }
            return;
        }

        // Arrow keys
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
            event.preventDefault();

            // Shift+Arrow: Resize selected clips
            if (event.shiftKey) {
                if (key === 'ArrowLeft') {
                    resizeSelectedClips(-250, clipId); // Shrink, maintain focus
                } else if (key === 'ArrowRight') {
                    resizeSelectedClips(250, clipId); // Grow, maintain focus
                }
                return;
            }

            // Alt+Arrow or plain Arrow: Nudge selected clips (move in time)
            if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
                const selection = stateManager.get('selection') || [];

                // Left/Right: Nudge in time
                if (key === 'ArrowLeft') {
                    if (selection.includes(clipId)) {
                        nudgeSelectedClips(-250, clipId); // Maintain focus
                    }
                    return;
                }
                if (key === 'ArrowRight') {
                    if (selection.includes(clipId)) {
                        nudgeSelectedClips(250, clipId); // Maintain focus
                    }
                    return;
                }

                // Up/Down: Navigate to clip in adjacent track
                if (key === 'ArrowUp' || key === 'ArrowDown') {
                    const targetClipId = findClipInAdjacentTrack(clipId, key === 'ArrowUp' ? 'up' : 'down');
                    if (targetClipId) {
                        const targetEl = document.getElementById(`clip-${targetClipId}`);
                        if (targetEl) {
                            targetEl.focus();
                            timelineController.selectClips(targetClipId);
                            updateSelectionUI();
                        }
                    }
                    return;
                }
            }
        }

        // Delete/Backspace: Delete selected clips
        if (key === 'Delete' || key === 'Backspace') {
            event.preventDefault();
            timelineController.deleteSelected();
            buildTimeline();
            updateSelectionUI();
            // Focus first remaining clip
            const clips = getAllClipElements();
            if (clips.length > 0) {
                clips[0].focus();
            }
            return;
        }

        // Escape: Clear selection and blur
        if (key === 'Escape') {
            event.preventDefault();
            timelineController.clearSelection();
            updateSelectionUI();
            document.activeElement.blur();
            return;
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

            const result = timelineController.addClip(trackId, clip);
            if (!result?.success) return;
            buildTimeline();
            errorHandler.success(`Loaded: ${file.name}`);
        } catch (error) {
            errorHandler.handle(error, { prefix: 'Audio Load Failed' });
        }
    });

    // Handler: Drop clip from palette to timeline (or audio file from filesystem)
    window.addEventListener('app:drop-clip', (e) => {
        const { event, trackId } = e.detail;

        // Check for external audio file drop
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            const track = stateManager.get('project.tracks')?.find(t => t.id === trackId);

            if (file.type.startsWith('audio/')) {
                if (track?.type === 'audio') {
                    window.dispatchEvent(new CustomEvent('app:load-audio', {
                        detail: { file, trackId }
                    }));
                } else {
                    errorHandler.warn('Audio files can only be dropped on audio tracks');
                }
                return;
            }
        }

        const type = event.dataTransfer.getData('type') || event.dataTransfer.getData('text/plain');

        if (!type) return;

        const scrollRect = els.timelineScroll?.getBoundingClientRect();
        const scrollLeft = els.timelineScroll?.scrollLeft || 0;
        // Calculate position relative to scroll area (no need to subtract headerWidth since
        // scrollRect.left is already positioned after the headers due to flex layout)
        const x = event.clientX - (scrollRect?.left || 0) + scrollLeft;
        const zoom = stateManager.get('ui.zoom');
        let startTime = Math.max(0, (x / zoom) * 1000); // Ensure non-negative

        const snapEnabled = stateManager.get('ui.snapEnabled');
        const gridSize = stateManager.get('ui.gridSize');
        startTime = getSnappedTime(startTime, { snapEnabled, gridSize });

        // Get existing clips on the target track to avoid overlaps
        const track = stateManager.get('project.tracks')?.find(t => t.id === trackId);
        const newClipDuration = CONFIG.defaultDuration;

        if (track && track.clips.length > 0) {
            // Sort clips by start time for proper overlap detection
            const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime);

            // Keep checking until we find a non-overlapping position
            let foundOverlap = true;
            let iterations = 0;
            const maxIterations = sortedClips.length + 1; // Safety limit

            while (foundOverlap && iterations < maxIterations) {
                foundOverlap = false;
                iterations++;
                const newClipEnd = startTime + newClipDuration;

                for (const existingClip of sortedClips) {
                    const existingStart = existingClip.startTime;
                    const existingEnd = existingStart + existingClip.duration;

                    // Check for overlap
                    const overlaps = (startTime < existingEnd && newClipEnd > existingStart);

                    if (overlaps) {
                        // Snap to the end of the overlapped clip
                        startTime = existingEnd;
                        if (snapEnabled) {
                            startTime = getSnappedTime(startTime, { snapEnabled, gridSize });
                        }
                        foundOverlap = true;
                        break; // Re-check from the start with new position
                    }
                }
            }
        }

        const clip = createDefaultClip(type, startTime);
        const result = timelineController.addClip(trackId, clip);
        if (!result?.success) return;
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

        // Only allow scrubbing from the ruler area
        const clickedRuler = e.target.closest('.ruler');
        if (!clickedRuler) return;

        const scrollRect = els.timelineScroll.getBoundingClientRect();
        // No need to subtract headerWidth - scrollRect.left is already after the headers
        const startX = e.clientX - scrollRect.left + els.timelineScroll.scrollLeft;
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
            updateTime(ev.clientX - scrollRect.left + els.timelineScroll.scrollLeft);
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
    // Uses direct DOM manipulation during drag for smooth visual feedback
    window.addEventListener('app:clip-mousedown', (e) => {
        const { event, clipId } = e.detail;
        const startX = event.clientX;

        const zoom = stateManager.get('ui.zoom');
        const pxPerMs = zoom / 1000;
        const snapEnabled = stateManager.get('ui.snapEnabled');
        const gridSize = stateManager.get('ui.gridSize');

        // --- 1) SELECTION LOGIC ---
        const selection = stateManager.get('selection') || [];
        let nextSelection = selection;

        if (event.ctrlKey || event.metaKey) {
            nextSelection = selection.includes(clipId)
                ? selection.filter(id => id !== clipId)
                : [...selection, clipId];
        } else {
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

        // Find clip data and DOM elements for all selected clips
        const clipInfos = {};
        const state = stateManager.state;
        const clipsToManipulate = isMove ? nextSelection : [clipId];

        for (const id of clipsToManipulate) {
            const el = document.getElementById(`clip-${id}`);
            if (!el) continue;

            for (const track of (state.project?.tracks || [])) {
                const clip = (track.clips || []).find(c => c.id === id);
                    if (clip) {
                        clipInfos[id] = {
                            el,
                            trackId: track.id,
                            trackType: track.type,
                            clipType: clip.type,
                            origLeft: parseFloat(el.style.left),
                            origWidth: parseFloat(el.style.width),
                            origStart: clip.startTime,
                            origDur: clip.duration
                        };
                        break;
                    }
            }
        }

        // Track current computed values during drag
        const currentValues = {};
        for (const id in clipInfos) {
            currentValues[id] = {
                startTime: clipInfos[id].origStart,
                duration: clipInfos[id].origDur
            };
        }

        let hasMoved = false;
        let targetTrackId = null;
        let sourceTrackId = clipInfos[clipId]?.trackId || null;
        let sourceTrackType = clipInfos[clipId]?.trackType || null;

        // Set cursor style
        document.body.style.cursor = isResizeLeft || isResizeRight ? 'col-resize' : 'grabbing';

        const moveHandler = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 3 && !hasMoved) {
                hasMoved = true;
            }
            if (!hasMoved) return;

            if (isResizeRight) {
                // Resize from right edge
                const info = clipInfos[clipId];
                if (!info) return;

                let newWidth = info.origWidth + dx;
                const minWidth = (CONFIG.minClipDuration / 1000) * zoom;
                if (newWidth < minWidth) newWidth = minWidth;

                let newDur = (newWidth / zoom) * 1000;
                if (snapEnabled) {
                    const endTime = info.origStart + newDur;
                    const snappedEnd = getSnappedTime(endTime, { snapEnabled, gridSize });
                    newDur = snappedEnd - info.origStart;
                    newWidth = (newDur / 1000) * zoom;
                }

                info.el.style.width = `${newWidth}px`;
                currentValues[clipId].duration = newDur;
                if (info.clipType === 'audio') {
                    updateAudioClipWaveform(clipId, newDur);
                }

            } else if (isResizeLeft) {
                // Resize from left edge
                const info = clipInfos[clipId];
                if (!info) return;

                let newLeft = info.origLeft + dx;
                let newWidth = info.origWidth - dx;
                const minWidth = (CONFIG.minClipDuration / 1000) * zoom;

                if (newWidth < minWidth) {
                    newLeft = info.origLeft + info.origWidth - minWidth;
                    newWidth = minWidth;
                }
                if (newLeft < 0) {
                    newWidth += newLeft;
                    newLeft = 0;
                }

                let newStart = (newLeft / zoom) * 1000;
                let newDur = (newWidth / zoom) * 1000;

                if (snapEnabled) {
                    const snappedStart = getSnappedTime(newStart, { snapEnabled, gridSize });
                    const delta = newStart - snappedStart;
                    newStart = snappedStart;
                    newDur += delta;
                    newLeft = (newStart / 1000) * zoom;
                    newWidth = (newDur / 1000) * zoom;
                }

                info.el.style.left = `${newLeft}px`;
                info.el.style.width = `${newWidth}px`;
                currentValues[clipId].startTime = newStart;
                currentValues[clipId].duration = newDur;
                if (info.clipType === 'audio') {
                    updateAudioClipWaveform(clipId, newDur);
                }

            } else {
                // Move clips
                // Calculate delta time based on lead clip
                const leadInfo = clipInfos[clipId];
                if (!leadInfo) return;

                let newLeadLeft = leadInfo.origLeft + dx;
                if (newLeadLeft < 0) newLeadLeft = 0;

                let newLeadStart = (newLeadLeft / zoom) * 1000;
                if (snapEnabled) {
                    newLeadStart = getSnappedTime(newLeadStart, { snapEnabled, gridSize });
                    newLeadLeft = (newLeadStart / 1000) * zoom;
                }

                const dt = newLeadStart - leadInfo.origStart;

                // Move all selected clips by the same delta
                for (const id in clipInfos) {
                    const info = clipInfos[id];
                    let newStart = info.origStart + dt;
                    if (newStart < 0) newStart = 0;
                    const newLeft = (newStart / 1000) * zoom;

                    info.el.style.left = `${newLeft}px`;
                    currentValues[id].startTime = newStart;
                }

                // Cross-track detection: find lane under cursor and move clip element there
                const lanes = document.querySelectorAll('.track-lane');
                lanes.forEach(lane => lane.classList.remove('drag-over'));

                for (const lane of lanes) {
                    const rect = lane.getBoundingClientRect();
                    if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
                        const laneTrackId = lane.dataset.trackId;
                        const laneTrack = state.project.tracks.find(t => t.id === laneTrackId);
                        // Only allow if same track type
                        if (laneTrack && laneTrack.type === sourceTrackType) {
                            lane.classList.add('drag-over');
                            targetTrackId = laneTrackId;

                            // Move clip elements to target lane visually (during drag)
                            for (const id in clipInfos) {
                                const info = clipInfos[id];
                                if (info.el.parentElement !== lane) {
                                    lane.appendChild(info.el);
                                }
                            }
                        }
                        break;
                    }
                }
            }

            renderPreview();
        };

        const upHandler = () => {
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);
            document.body.style.cursor = '';

            // Clear drag-over highlights
            document.querySelectorAll('.track-lane').forEach(lane => lane.classList.remove('drag-over'));

            if (hasMoved) {
                // Commit changes to state
                stateManager.update(draft => {
                    // Update clip positions/durations
                    for (const id in currentValues) {
                        for (const track of draft.project.tracks) {
                            const clip = track.clips.find(c => c.id === id);
                            if (clip) {
                                clip.startTime = currentValues[id].startTime;
                                clip.duration = currentValues[id].duration;
                                break;
                            }
                        }
                    }

                    // Handle cross-track move
                    if (isMove && targetTrackId && targetTrackId !== sourceTrackId) {
                        const targetTrack = draft.project.tracks.find(t => t.id === targetTrackId);
                        const sourceTrack = draft.project.tracks.find(t => t.id === sourceTrackId);

                        if (targetTrack && sourceTrack && targetTrack.type === sourceTrack.type) {
                            for (const id in clipInfos) {
                                const clipIndex = sourceTrack.clips.findIndex(c => c.id === id);
                                if (clipIndex !== -1) {
                                    const [movedClip] = sourceTrack.clips.splice(clipIndex, 1);
                                    targetTrack.clips.push(movedClip);
                                }
                            }
                        }
                    }

                    draft.isDirty = true;
                });

                buildTimeline();
                updateSelectionUI();
            } else {
                // Click without drag - collapse multi-selection if needed
                const finalSelection = stateManager.get('selection') || [];
                if (!event.ctrlKey && !event.metaKey && finalSelection.length > 1) {
                    if (finalSelection.includes(clipId)) {
                        stateManager.set('selection', [clipId], { skipHistory: true });
                        updateSelectionUI();
                        updateClipboardUI();
                    }
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
        els.btnPlay.onclick = async () => {
            const isPlaying = stateManager.get('playback.isPlaying');

            if (isPlaying) {
                audioService.stopPlayback();
                els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
            } else {
                await audioService.startPlayback();
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
                    icon.className = "fas fa-volume-mute text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center";
                } else if (volume < 0.5) {
                    icon.className = "fas fa-volume-down text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center";
                } else {
                    icon.className = "fas fa-volume-up text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center";
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
    // Show project settings by default when nothing is selected.
    populateInspector(null);
});
