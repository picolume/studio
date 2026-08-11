import { CONFIG } from './utils.js';
import { APP_EVENTS, emitAppEvent, subscribeAppEvent } from './core/AppEventHub.js';
import { TimelineRenderer } from './views/TimelineRenderer.js';
import { PreviewRenderer } from './views/PreviewRenderer.js';
import { InspectorRenderer } from './views/InspectorRenderer.js';

export function createTimelineModule(injected = {}) {
    const deps = {
        stateManager: injected.stateManager ?? null,
        timelineController: injected.timelineController ?? null,
        cueController: injected.cueController ?? null,
        audioService: injected.audioService ?? null,
        errorHandler: injected.errorHandler ?? null,
        appEvents: injected.appEvents ?? null,
        elements: injected.elements ?? injected.els ?? {},
        timelineRenderer: null,
        previewRenderer: null,
        inspectorRenderer: null
    };

    if (!deps.stateManager) {
        console.warn('createTimelineModule: stateManager is required');
    }

    deps.timelineRenderer = new TimelineRenderer(deps);
    deps.previewRenderer = new PreviewRenderer(deps);
    deps.inspectorRenderer = new InspectorRenderer(deps);

    let lastPreviewRender = 0;
    const unsubscribers = [];

    const getProject = () => deps.stateManager?.get('project') ?? null;

    const api = {
        buildTimeline() {
            deps.timelineRenderer?.render(getProject());
        },

        updateGridBackground() {
            deps.timelineRenderer?.updateGridBackground();
        },

        updateTimeDisplay() {
            deps.timelineRenderer?.updateTimeDisplay();
        },

        updatePlayheadUI() {
            deps.timelineRenderer?.updatePlayheadUI();
        },

        updateSelectionUI() {
            deps.timelineRenderer?.updateSelectionUI();
            const selection = deps.stateManager?.get('selection') ?? [];
            api.populateInspector(selection.length === 1 ? selection[0] : null);
        },

        updateAudioClipWaveform(clipId, durationMs) {
            deps.timelineRenderer?.updateAudioClipWaveform(clipId, durationMs);
        },

        renderPreview() {
            const now = performance.now();
            if (deps.stateManager?.get('playback.isPlaying') && now - lastPreviewRender < CONFIG.previewThrottleMs) {
                return;
            }
            lastPreviewRender = now;
            deps.previewRenderer?.render();
        },

        populateInspector(clipId) {
            deps.inspectorRenderer?.render(clipId);
        },

        selectClip(id) {
            if (deps.timelineController?.selectClips) {
                deps.timelineController.selectClips([id], false, false);
                return;
            }

            deps.stateManager?.set('selection', id !== null ? [id] : [], { skipHistory: true });
            emitAppEvent(deps.appEvents, APP_EVENTS.SELECTION_CHANGED);
        },

        getPreviewRenderer() {
            return deps.previewRenderer;
        },

        getInspectorRenderer() {
            return deps.inspectorRenderer;
        },

        destroy() {
            for (const unsubscribe of unsubscribers.splice(0)) {
                try {
                    unsubscribe();
                } catch {
                    // Ignore teardown errors during app shutdown/tests.
                }
            }
        }
    };

    unsubscribers.push(
        subscribeAppEvent(deps.appEvents, APP_EVENTS.TIMELINE_CHANGED, () => {
            api.buildTimeline();
            api.renderPreview();
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.SELECTION_CHANGED, () => {
            api.updateSelectionUI();
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.TIME_CHANGED, () => {
            api.updatePlayheadUI();
            api.updateTimeDisplay();
            api.renderPreview();
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.ZOOM_CHANGED, () => {
            api.buildTimeline();
            api.updatePlayheadUI();
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.GRID_CHANGED, () => {
            api.updateGridBackground();
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.CUES_CHANGED, () => {
            deps.timelineRenderer?.updateCueMarkers();
            api.populateInspector(null);
        }),
        subscribeAppEvent(deps.appEvents, APP_EVENTS.CUE_SELECTED, () => {
            deps.timelineRenderer?.updateCueMarkers();
            api.populateInspector(null);
        })
    );

    return api;
}
