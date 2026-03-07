import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '../core/AppEventHub.js';
import { Application } from '../core/Application.js';

const DOM_IDS = [
    'timeline-scroll-area', 'timeline-content', 'tracks-container', 'track-headers',
    'ruler', 'playhead-handle', 'playhead-line', 'time-display', 'inspector-content',
    'preview-canvas', 'btn-play', 'btn-undo', 'btn-redo', 'btn-copy', 'btn-paste',
    'zoom-slider', 'zoom-display', 'vol-slider', 'toast', 'status-history',
    'btn-add-track-led', 'btn-add-track-audio', 'btn-settings', 'btn-export-bin',
    'btn-upload', 'btn-save', 'btn-save-as', 'btn-export', 'btn-open', 'btn-new',
    'btn-window-minimize', 'btn-window-maximize', 'btn-window-close', 'btn-stop',
    'btn-to-start', 'chk-snap', 'sel-grid', 'btn-duplicate'
];

describe('Application', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.title = '';
        localStorage.clear();

        for (const id of DOM_IDS) {
            let tagName = 'div';
            if (id.startsWith('btn-')) tagName = 'button';
            if (id === 'zoom-slider' || id === 'vol-slider' || id === 'chk-snap') tagName = 'input';
            if (id === 'sel-grid') tagName = 'select';
            if (id === 'preview-canvas') tagName = 'canvas';

            const element = document.createElement(tagName);
            element.id = id;
            if (id === 'zoom-slider' || id === 'vol-slider') {
                element.type = 'range';
            }
            if (id === 'chk-snap') {
                element.type = 'checkbox';
            }
            document.body.appendChild(element);
        }
    });

    it('initializes services, caches elements, and routes app events', async () => {
        const application = new Application();

        const result = await application.init();

        expect(result).toEqual({ success: true });
        expect(application.getService('project')).toBe(application.projectService);
        expect(application.getController('timeline')).toBe(application.timelineController);
        expect(application.elements.inspector.id).toBe('inspector-content');
        expect(application.elements.timelineScroll.id).toBe('timeline-scroll-area');
        expect(document.title).toBe('My Show - PicoLume Studio');

        const toastSpy = vi.spyOn(application.errorHandler, 'showToast');
        application.appEvents.emit(APP_EVENTS.TOAST, 'Saved');
        expect(toastSpy).toHaveBeenCalledWith('Saved');

        application.stateManager.set('ui.zoom', 75, { skipHistory: true });
        expect(application.elements.zoomSlider.value).toBe('75');
        expect(application.elements.zoomDisplay.textContent).toBe('75px/s');

        application.stateManager.set('isDirty', true, { skipHistory: true });
        expect(document.title).toBe('My Show* - PicoLume Studio');
    });
});
