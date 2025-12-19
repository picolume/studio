import { CONFIG, getSnappedTime } from './utils.js';
import { TimelineRenderer } from './views/TimelineRenderer.js';
import { PreviewRenderer } from './views/PreviewRenderer.js';
import { InspectorRenderer } from './views/InspectorRenderer.js';

const deps = {
    stateManager: null,
    timelineController: null,
    audioService: null,
    errorHandler: null,
    elements: {},
    // Renderers
    timelineRenderer: null,
    previewRenderer: null,
    inspectorRenderer: null
};

let lastPreviewRender = 0;

export function initTimeline(injected) {
    if (!injected?.stateManager) {
        console.warn('initTimeline: stateManager is required');
    }
    deps.stateManager = injected?.stateManager ?? null;
    deps.timelineController = injected?.timelineController ?? null;
    deps.audioService = injected?.audioService ?? null;
    deps.errorHandler = injected?.errorHandler ?? null;
    deps.elements = injected?.elements ?? injected?.els ?? {};

    // Initialize Renderers
    deps.timelineRenderer = new TimelineRenderer(deps);
    deps.previewRenderer = new PreviewRenderer(deps);
    deps.inspectorRenderer = new InspectorRenderer(deps);

    attachGlobalListeners();
}

function getProject() {
    return deps.stateManager?.get('project') ?? null;
}

// ==========================================
// RENDERER DELEGATES
// ==========================================

export function buildTimeline() {
    deps.timelineRenderer?.render(getProject());
}

export function updateGridBackground() {
    deps.timelineRenderer?.updateGridBackground();
}

export function updateTimeDisplay() {
    deps.timelineRenderer?.updateTimeDisplay();
}

export function updatePlayheadUI() {
    deps.timelineRenderer?.updatePlayheadUI();
}

export function updateSelectionUI() {
    deps.timelineRenderer?.updateSelectionUI();
    // Also update inspector when selection changes
    const selection = deps.stateManager?.get('selection') ?? [];
    populateInspector(selection.length === 1 ? selection[0] : null);
}

export function updateAudioClipWaveform(clipId, durationMs) {
    deps.timelineRenderer?.updateAudioClipWaveform(clipId, durationMs);
}

export function renderPreview() {
    const now = performance.now();
    if (deps.stateManager?.get('playback.isPlaying') && now - lastPreviewRender < CONFIG.previewThrottleMs) return;
    lastPreviewRender = now;
    deps.previewRenderer?.render();
}

export function populateInspector(clipId) {
    deps.inspectorRenderer?.render(clipId);
}

export function getPreviewRenderer() {
    return deps.previewRenderer;
}

// ==========================================
// UTILITIES
// ==========================================

export function selectClip(id) {
    if (deps.timelineController?.selectClips) {
        deps.timelineController.selectClips([id], false, false);
    } else {
        // Fallback if controller not available (shouldn't happen)
        deps.stateManager?.set('selection', id !== null ? [id] : [], { skipHistory: true });
        window.dispatchEvent(new CustomEvent('app:selection-changed'));
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

function attachGlobalListeners() {
    // --- APP EVENTS (Inter-module communication) ---

    window.addEventListener('app:timeline-changed', () => {
        buildTimeline();
        renderPreview();
    });

    window.addEventListener('app:selection-changed', () => {
        updateSelectionUI();
    });

    window.addEventListener('app:time-changed', () => {
        updatePlayheadUI();
        updateTimeDisplay();
        renderPreview();
    });

    window.addEventListener('app:zoom-changed', () => {
        buildTimeline();
        updatePlayheadUI();
    });

    window.addEventListener('app:grid-changed', () => {
        updateGridBackground();
    });

    // --- DOM EVENT HANDLERS (Delegated mostly) ---
    // Note: Most drag/drop logic is now inside TimelineRenderer or directly in main.js
    // We only keep the direct timeline interaction logic here if it's not handled by renderers
}
