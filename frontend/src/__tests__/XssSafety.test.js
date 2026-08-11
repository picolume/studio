import { describe, it, expect, vi } from 'vitest';
import { TimelineRenderer } from '../views/TimelineRenderer.js';
import { InspectorRenderer } from '../views/InspectorRenderer.js';

describe('XSS safety (renderers)', () => {
    it('TimelineRenderer renders audio clip name as text', () => {
        const stateManager = {
            get: (path) => {
                if (path === 'ui.zoom') return 50;
                if (path === 'selection') return [];
                if (path === 'assets') return {};
                return undefined;
            }
        };

        const renderer = new TimelineRenderer({ stateManager, elements: {} });

        const clipEl = renderer._createClipElement({
            id: 'c1',
            type: 'audio',
            startTime: 0,
            duration: 1000,
            props: { name: '<img src=x onerror=alert(1)>' }
        });

        expect(clipEl.querySelector('img')).toBeNull();
        expect(clipEl.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('InspectorRenderer renders conflict details as text', () => {
        const stateManager = {
            get: () => null,
            update: vi.fn(),
        };

        const renderer = new InspectorRenderer({ stateManager, elements: {}, ui: {} });
        const container = document.createElement('div');

        renderer._renderHardwareProfiles(container, {
            settings: {
                profiles: [
                    { id: 'p1', name: '<img src=x onerror=alert(1)>', assignedIds: '1', ledCount: 10, brightnessCap: 255, ledType: 0, colorOrder: 0 },
                    { id: 'p2', name: 'Other', assignedIds: '1', ledCount: 10, brightnessCap: 255, ledType: 0, colorOrder: 0 },
                ],
                patch: {}
            }
        });

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('Conflict:');
    });

    it('InspectorRenderer renders audio filename as text', () => {
        const stateManager = {
            get: () => null,
            update: vi.fn(),
        };

        const renderer = new InspectorRenderer({ stateManager, elements: {}, ui: {} });
        const container = document.createElement('div');

        renderer._renderAudioClipProps(container, {
            type: 'audio',
            duration: 1234,
            props: { name: '<svg onload=alert(1)>', volume: 0.5 }
        });

        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).toContain('<svg onload=alert(1)>');
    });
});

