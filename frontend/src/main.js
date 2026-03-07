import { app } from './core/Application.js';
import { APP_EVENTS } from './core/AppEventHub.js';
import { showConfirm, formatPicoStatus } from './utils.js';
import { createTimelineModule } from './timeline.js';
import { setupProjectWorkflow } from './bootstrap/projectWorkflow.js';
import { setupTimelineInteractions } from './bootstrap/timelineInteractions.js';
import { initBinaryInspector } from './ui/BinaryInspector.js';

let stateManager, audioService, projectService, timelineController, undoController, errorHandler;

window.addEventListener('DOMContentLoaded', async () => {
    await app.init();

    stateManager = app.stateManager;
    audioService = app.audioService;
    projectService = app.projectService;
    timelineController = app.timelineController;
    undoController = app.undoController;
    errorHandler = app.errorHandler;

    const appEvents = app.appEvents;
    const cueController = app.cueController;
    const els = app.elements;
    const themeManager = app.themeManager;
    const keyboardController = app.keyboardController;
    const sidebarModeManager = app.sidebarModeManager;
    const menuRenderer = app.menuRenderer;

    const timeline = createTimelineModule({
        stateManager,
        timelineController,
        cueController,
        audioService,
        errorHandler,
        appEvents,
        elements: els
    });

    const {
        buildTimeline,
        renderPreview,
        updatePlayheadUI,
        updateTimeDisplay,
        updateGridBackground,
        populateInspector,
        getPreviewRenderer,
        getInspectorRenderer
    } = timeline;

    setupWindowChrome(els);

    const shell = setupLayoutShell({
        stateManager,
        timeline,
        themeManager,
        appEvents,
        els
    });

    const menuActionHandlers = {
        'new': () => els.btnNew?.click(),
        'open': () => els.btnOpen?.click(),
        'save': () => els.btnSave?.click(),
        'save-as': () => els.btnSaveAs?.click(),
        'export': () => els.btnExportBin?.click(),
        'upload': () => els.btnUpload?.click(),
        'settings': () => els.btnSettings?.click(),
        'about': () => shell.setAboutOpen(true),
        'inspect': () => shell.binaryInspector?.open(),
        'manual': () => shell.setManualOpen(true),
        'theme': (themeName) => themeManager.setTheme(themeName)
    };

    sidebarModeManager.init({
        inspectorRenderer: getInspectorRenderer(),
        menuRenderer,
        paneInspector: document.getElementById('pane-inspector'),
        sidebarHeader: document.getElementById('sidebar-header'),
        sidebarTitle: document.getElementById('sidebar-title'),
        sidebarIcon: document.getElementById('sidebar-icon'),
        sidebarBackBtn: document.getElementById('sidebar-back-btn'),
        sidebarCloseBtn: document.getElementById('sidebar-close-btn'),
        hamburgerButton: document.getElementById('btn-hamburger'),
    });

    menuRenderer.init({
        sidebarModeManager,
        menuContent: document.getElementById('menu-content'),
        sidebarTitle: document.getElementById('sidebar-title'),
        sidebarBackBtn: document.getElementById('sidebar-back-btn'),
        themeManager,
        actionHandlers: menuActionHandlers
    });

    document.querySelectorAll('.palette-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            const type = item.dataset.type;
            if (!type) return;
            e.dataTransfer.setData('type', type);
            e.dataTransfer.setData('text/plain', type);
            e.dataTransfer.effectAllowed = 'copy';
        });
    });

    const timelineUi = setupTimelineInteractions({
        appEvents,
        stateManager,
        audioService,
        timelineController,
        cueController,
        errorHandler,
        els,
        timeline
    });

    const { updateClipboardUI } = timelineUi;

    setupProjectWorkflow({
        appEvents,
        stateManager,
        projectService,
        cueController,
        errorHandler,
        els,
        timeline,
        showConfirm,
        formatPicoStatus,
        onSelectionChanged: updateClipboardUI
    });

    if (els.btnUndo) {
        els.btnUndo.onclick = () => {
            undoController.undo();
            buildTimeline();
            populateInspectorFromSelection();
        };
    }

    if (els.btnRedo) {
        els.btnRedo.onclick = () => {
            undoController.redo();
            buildTimeline();
            populateInspectorFromSelection();
        };
    }

    keyboardController.init({
        undoController,
        timelineController,
        cueController,
        themeManager,
        elements: els,
        modalChecks: [
            {
                isOpen: () => shell.aboutModal?.getAttribute('aria-hidden') === 'false',
                close: () => shell.setAboutOpen(false)
            },
            {
                isOpen: () => shell.manualModal?.getAttribute('aria-hidden') === 'false',
                close: () => shell.setManualOpen(false)
            }
        ],
        callbacks: {
            togglePane: shell.togglePane,
            onBuildTimeline: () => buildTimeline(),
            onUpdateSelectionUI: () => populateInspectorFromSelection(),
            onUpdateClipboardUI: () => updateClipboardUI()
        }
    });

    setupTransportControls({
        stateManager,
        audioService,
        timelineController,
        els,
        updateGridBackground
    });

    buildTimeline();
    updatePlayheadUI();
    updateTimeDisplay();
    updateGridBackground();
    updateClipboardUI();
    populateInspector(null);

    function populateInspectorFromSelection() {
        const selection = stateManager.get('selection') || [];
        populateInspector(selection.length === 1 ? selection[0] : null);
    }
});

function setupWindowChrome(els) {
    const windowControls = document.getElementById('window-controls');
    const hasWailsWindowControls = typeof window.runtime?.WindowMinimise === 'function'
        && typeof window.runtime?.WindowToggleMaximise === 'function'
        && typeof window.runtime?.Quit === 'function';
    const windowFrame = document.getElementById('window-frame');
    const hasWailsWindowState = typeof window.runtime?.WindowIsMaximised === 'function';

    const updateWindowChrome = async () => {
        if (!hasWailsWindowState) return;
        let isMaximised = false;
        try {
            isMaximised = !!(await window.runtime.WindowIsMaximised());
        } catch {
            isMaximised = false;
        }
        document.body.classList.toggle('window--maximised', isMaximised);
        if (windowFrame) windowFrame.hidden = isMaximised;
    };

    if (!hasWailsWindowControls) {
        return;
    }

    if (windowControls) windowControls.hidden = false;
    const btnMin = els.btnWindowMinimize || document.getElementById('btn-window-minimize');
    const btnMax = els.btnWindowMaximize || document.getElementById('btn-window-maximize');
    const btnClose = els.btnWindowClose || document.getElementById('btn-window-close');

    btnMin?.addEventListener('click', () => window.runtime.WindowMinimise());
    btnMax?.addEventListener('click', () => {
        window.runtime.WindowToggleMaximise();
        setTimeout(() => void updateWindowChrome(), 50);
    });
    btnClose?.addEventListener('click', () => window.runtime.Quit());

    const titlebar = document.querySelector('header[role="banner"]');
    const isInteractiveTarget = (target) => {
        if (!(target instanceof Element)) return true;
        return Boolean(
            target.closest('#window-controls')
            || target.closest('button')
            || target.closest('a')
            || target.closest('input')
            || target.closest('select')
            || target.closest('textarea')
            || target.closest('[contenteditable="true"]')
        );
    };

    titlebar?.addEventListener('dblclick', async (e) => {
        if (e.button !== 0 || isInteractiveTarget(e.target)) return;

        let isMaximised = false;
        if (hasWailsWindowState) {
            try {
                isMaximised = !!(await window.runtime.WindowIsMaximised());
            } catch {
                isMaximised = false;
            }
        }
        if (!isMaximised) {
            window.runtime.WindowMaximise();
            setTimeout(() => void updateWindowChrome(), 50);
        }
    });

    if (windowFrame) windowFrame.hidden = false;
    void updateWindowChrome();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => void updateWindowChrome(), 100);
    });

    const resizeHandles = document.getElementById('resize-handles');
    if (resizeHandles && typeof window.runtime?.WindowStartResize === 'function') {
        resizeHandles.hidden = false;
        const edgeMap = { n: 1, ne: 2, e: 3, se: 4, s: 5, sw: 6, w: 7, nw: 8 };
        resizeHandles.querySelectorAll('.window-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const edge = handle.dataset.edge;
                if (edge && edgeMap[edge]) {
                    window.runtime.WindowStartResize(edgeMap[edge]);
                }
            });
        });
    }
}

function setupLayoutShell({ stateManager, timeline, themeManager, appEvents, els }) {
    const UI_LAYOUT_KEY = 'picolume:ui';
    const panePalette = document.getElementById('pane-palette');
    const panePreview = document.getElementById('pane-preview');
    const paneInspector = document.getElementById('pane-inspector');
    const btnTogglePalette = document.getElementById('btn-toggle-palette');
    const btnTogglePreview = document.getElementById('btn-toggle-preview');
    const btnToggleInspector = document.getElementById('btn-toggle-inspector');
    const manualModal = document.getElementById('manual-modal');
    const manualFrame = document.getElementById('manual-frame');
    const aboutModal = document.getElementById('about-modal');
    const aboutVersion = document.getElementById('about-version');
    const aboutWailsVersion = document.getElementById('about-wails-version');

    const readCssPx = (name, fallback) => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const UI_DEFAULTS = {
        paletteWidth: readCssPx('--palette-width', 256),
        inspectorWidth: readCssPx('--inspector-width', 320),
        previewHeight: readCssPx('--preview-height', 256),
    };

    let UI_LAYOUT = {
        paletteOpen: true,
        previewOpen: true,
        inspectorOpen: true,
        previewHeight: null,
    };

    const loadUILayout = () => {
        try {
            const raw = localStorage.getItem(UI_LAYOUT_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved && typeof saved === 'object') {
                UI_LAYOUT = { ...UI_LAYOUT, ...saved };
            }
        } catch { }
    };

    const saveUILayout = () => {
        try {
            localStorage.setItem(UI_LAYOUT_KEY, JSON.stringify(UI_LAYOUT));
        } catch { }
    };

    const setPressed = (btn, pressed) => btn?.setAttribute('aria-pressed', String(pressed));
    const setPaneOpen = (pane, open) => {
        if (!pane) return;
        pane.classList.toggle('pane-collapsed', !open);
        pane.setAttribute('aria-hidden', String(!open));
    };

    const applyLayout = () => {
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--palette-width', UI_LAYOUT.paletteOpen ? `${UI_DEFAULTS.paletteWidth}px` : '0px');
        rootStyle.setProperty('--inspector-width', UI_LAYOUT.inspectorOpen ? `${UI_DEFAULTS.inspectorWidth}px` : '0px');
        const previewHeight = UI_LAYOUT.previewHeight ?? UI_DEFAULTS.previewHeight;
        rootStyle.setProperty('--preview-height', UI_LAYOUT.previewOpen ? `${previewHeight}px` : '0px');

        setPressed(btnTogglePalette, UI_LAYOUT.paletteOpen);
        setPressed(btnTogglePreview, UI_LAYOUT.previewOpen);
        setPressed(btnToggleInspector, UI_LAYOUT.inspectorOpen);
        setPaneOpen(panePalette, UI_LAYOUT.paletteOpen);
        setPaneOpen(panePreview, UI_LAYOUT.previewOpen);
        setPaneOpen(paneInspector, UI_LAYOUT.inspectorOpen);

        timeline.updatePlayheadUI();
        timeline.updateGridBackground();
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

    const setAboutOpen = (open) => {
        if (!aboutModal) return;
        aboutModal.setAttribute('aria-hidden', String(!open));
        if (open && aboutVersion) {
            const meta = document.querySelector('meta[name="picolume-version"]');
            aboutVersion.textContent = meta?.getAttribute('content') || 'dev';
        }
        if (open && aboutWailsVersion) {
            const meta = document.querySelector('meta[name="wails-version"]');
            aboutWailsVersion.textContent = meta?.getAttribute('content') || 'dev';
        }
    };

    document.getElementById('btn-manual-close')?.addEventListener('click', () => setManualOpen(false));
    manualModal?.addEventListener('mousedown', (e) => {
        if (e.target === manualModal) setManualOpen(false);
    });
    document.getElementById('btn-about-close')?.addEventListener('click', () => setAboutOpen(false));
    aboutModal?.addEventListener('mousedown', (e) => {
        if (e.target === aboutModal) setAboutOpen(false);
    });

    const binaryInspector = initBinaryInspector();

    loadUILayout();
    applyLayout();

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
        const mode = btn?.dataset.mode;
        if (!mode) return;

        stateManager.update(draft => {
            draft.ui.previewMode = mode;
        }, { skipHistory: true });
        updatePreviewModeUI();
        timeline.renderPreview();
    });
    updatePreviewModeUI();

    const resizeCanvas = () => {
        if (!previewCanvas || !panePreview) return;
        const rect = panePreview.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);
        if (previewCanvas.width !== newWidth || previewCanvas.height !== newHeight) {
            previewCanvas.width = newWidth;
            previewCanvas.height = newHeight;
            timeline.renderPreview();
        }
    };

    if (typeof ResizeObserver !== 'undefined' && panePreview) {
        new ResizeObserver(() => resizeCanvas()).observe(panePreview);
    }
    resizeCanvas();

    let fieldDragState = null;
    const getCanvasCoords = (e) => {
        if (!previewCanvas) return { x: 0, y: 0 };
        const rect = previewCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (previewCanvas.width / rect.width),
            y: (e.clientY - rect.top) * (previewCanvas.height / rect.height)
        };
    };

    previewCanvas?.addEventListener('mousedown', (e) => {
        if (stateManager.get('ui.previewMode') !== 'field') return;
        const coords = getCanvasCoords(e);
        const previewRenderer = timeline.getPreviewRenderer();
        const propId = previewRenderer?.hitTestProp(coords.x, coords.y);
        if (!propId) return;

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
    });

    window.addEventListener('mousemove', (e) => {
        if (!fieldDragState || !previewCanvas) return;
        const coords = getCanvasCoords(e);
        const dx = coords.x - fieldDragState.startX;
        const dy = coords.y - fieldDragState.startY;
        const newX = Math.max(20, Math.min(previewCanvas.width - 20, fieldDragState.origX + dx));
        const newY = Math.max(20, Math.min(previewCanvas.height - 20, fieldDragState.origY + dy));

        stateManager.update(draft => {
            draft.project.settings.fieldLayout = draft.project.settings.fieldLayout || {};
            draft.project.settings.fieldLayout[fieldDragState.propId] = { x: newX, y: newY };
        }, { skipHistory: true });

        timeline.renderPreview();
    });

    window.addEventListener('mouseup', () => {
        if (!fieldDragState) return;
        stateManager.update(draft => {
            draft.isDirty = true;
        }, { skipHistory: true });
        fieldDragState = null;
        if (previewCanvas) previewCanvas.style.cursor = '';
    });

    const previewResizeHandle = document.getElementById('preview-resize-handle');
    const MIN_PREVIEW_HEIGHT = 80;
    const MAX_PREVIEW_HEIGHT = 600;
    let previewResizeState = null;

    previewResizeHandle?.addEventListener('mousedown', (e) => {
        if (!panePreview || !UI_LAYOUT.previewOpen) return;
        const currentHeight = UI_LAYOUT.previewHeight ?? UI_DEFAULTS.previewHeight;
        previewResizeState = { startY: e.clientY, startHeight: currentHeight };
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
        if (!previewResizeState) return;
        previewResizeHandle?.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        previewResizeState = null;
        saveUILayout();
    });

    themeManager.init({
        toggleButton: document.getElementById('btn-theme-toggle'),
        onThemeChange: () => appEvents.emit(APP_EVENTS.TIMELINE_CHANGED)
    });

    return {
        aboutModal,
        manualModal,
        binaryInspector,
        togglePane,
        setAboutOpen,
        setManualOpen
    };
}

function setupTransportControls({ stateManager, audioService, timelineController, els, updateGridBackground }) {
    if (els.btnPlay) {
        els.btnPlay.onclick = async () => {
            if (stateManager.get('playback.isPlaying')) {
                audioService.stopPlayback();
                els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
                return;
            }
            await audioService.startPlayback();
            els.btnPlay.innerHTML = '<i class="fas fa-pause"></i>';
            startAnimationLoop();
        };
    }

    if (els.btnStop) {
        els.btnStop.onclick = () => {
            audioService.stopPlayback();
            timelineController.setCurrentTime(0);
            if (els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
        };
    }

    if (els.btnToStart) {
        els.btnToStart.onclick = () => {
            timelineController.setCurrentTime(0);
        };
    }

    if (els.volSlider) {
        els.volSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            audioService.setVolume(volume);
            const icon = document.getElementById('vol-icon');
            if (!icon) return;
            if (volume === 0) {
                icon.className = 'fas fa-volume-mute text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center';
            } else if (volume < 0.5) {
                icon.className = 'fas fa-volume-down text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center';
            } else {
                icon.className = 'fas fa-volume-up text-[var(--ui-text-subtle)] text-xs group-hover:text-[var(--ui-text)] w-5 text-center';
            }
        });
    }

    if (els.zoomSlider) {
        els.zoomSlider.oninput = (e) => {
            timelineController.setZoom(parseInt(e.target.value, 10));
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
            timelineController.setGridSize(parseInt(e.target.value, 10));
        };
    }

    if (els.btnAddTrackLed) {
        els.btnAddTrackLed.onclick = () => timelineController.addTrack('led');
    }

    if (els.btnAddTrackAudio) {
        els.btnAddTrackAudio.onclick = () => timelineController.addTrack('audio');
    }

    if (els.timelineScroll) {
        els.timelineScroll.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -10 : 10;
                const currentZoom = stateManager.get('ui.zoom');
                const newZoom = Math.max(10, Math.min(200, currentZoom + delta));
                if (newZoom !== currentZoom) {
                    timelineController.setZoom(newZoom);
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
        els.trackHeaders.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (els.timelineScroll) {
                els.timelineScroll.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    function startAnimationLoop() {
        const animate = () => {
            if (!stateManager.get('playback.isPlaying')) return;

            const audioCtx = audioService.ctx;
            const startTime = stateManager.get('playback.startTime');
            if (audioCtx && startTime !== undefined) {
                const currentTime = (audioCtx.currentTime - startTime) * 1000;
                timelineController.setCurrentTime(currentTime);

                if (currentTime >= stateManager.get('project.duration')) {
                    audioService.stopPlayback();
                    if (els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
                    return;
                }
            }

            requestAnimationFrame(animate);
        };

        animate();
    }
}
