import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '../core/AppEventHub.js';
import { renderClipProperties } from '../views/inspector/ClipPropertiesSection.js';
import { createInspectorSectionContext, createStateManager } from './inspectorTestUtils.js';

describe('ClipPropertiesSection', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('updates clip timing, toggles effect props, and syncs audio volume', () => {
        const clip = {
            id: 'clip1',
            type: 'audio',
            startTime: 0,
            duration: 1000,
            props: {
                name: 'song.wav',
                volume: 0.5,
                reverse: false,
                speed: 1.5,
                accent: '#ff0000',
                accentPaletteIdx: 0,
            }
        };
        const state = {
            project: {
                settings: {
                    palettes: [{ id: 'p1', name: 'Warm', colors: ['#ff0000', '#ffaa00'] }]
                },
                tracks: [{ clips: [clip] }]
            },
            isDirty: false,
        };
        const stateManager = createStateManager(state);
        const emit = vi.fn();
        const timelineController = { deleteClip: vi.fn() };
        const audioService = { setClipVolume: vi.fn() };
        const { context } = createInspectorSectionContext(stateManager, {
            emit,
            timelineController,
            audioService,
        });
        const container = document.createElement('div');

        renderClipProperties(container, 'clip1', state.project, context);

        const timingInputs = [...container.querySelectorAll('input[type="text"]')];
        timingInputs[0].value = '00:01.500';
        timingInputs[0].dispatchEvent(new Event('input', { bubbles: true }));

        expect(state.project.tracks[0].clips[0].startTime).toBe(1500);
        expect(emit).toHaveBeenCalledWith(APP_EVENTS.TIMELINE_CHANGED);

        emit.mockClear();

        const reverseToggle = container.querySelector('input[type="checkbox"]');
        reverseToggle.checked = true;
        reverseToggle.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.project.tracks[0].clips[0].props.reverse).toBe(true);
        expect(emit).toHaveBeenCalledWith(APP_EVENTS.TIMELINE_CHANGED);

        const volumeSlider = container.querySelector('#audio-volume-slider');
        volumeSlider.value = '0.8';
        volumeSlider.dispatchEvent(new Event('input', { bubbles: true }));

        expect(state.project.tracks[0].clips[0].props.volume).toBeCloseTo(0.8);
        expect(audioService.setClipVolume).toHaveBeenCalledWith('clip1', 0.8);

        const deleteButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Delete Clip'));
        deleteButton.click();

        expect(timelineController.deleteClip).toHaveBeenCalledWith('clip1');
    });
});
