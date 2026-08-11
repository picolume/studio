import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCueProperties, renderCueSection } from '../views/inspector/CueSections.js';
import { createInspectorSectionContext, createStateManager } from './inspectorTestUtils.js';

describe('CueSections', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('wires cue list controls to the cue controller', () => {
        const state = {
            project: {
                cues: [{ id: 'A', timeMs: 1500, enabled: true }]
            },
            ui: {
                selectedCue: 'A'
            }
        };
        const stateManager = createStateManager(state);
        const cueController = {
            selectCue: vi.fn(),
            toggleCue: vi.fn(),
            setCueAtPlayhead: vi.fn(),
            clearCue: vi.fn(),
        };
        const { context } = createInspectorSectionContext(stateManager, { cueController });
        const container = document.createElement('div');

        renderCueSection(container, state.project, context);

        const checkbox = container.querySelector('input[type="checkbox"]');
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        expect(cueController.toggleCue).toHaveBeenCalledWith('A');

        const cueRow = checkbox.parentElement;
        cueRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(cueController.selectCue).toHaveBeenCalledWith('A');

        const setButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.trim() === 'Set');
        setButton.click();
        expect(cueController.setCueAtPlayhead).toHaveBeenCalledWith('A');

        const clearButton = [...container.querySelectorAll('button')]
            .find(button => button.title === 'Clear cue');
        clearButton.click();
        expect(cueController.clearCue).toHaveBeenCalledWith('A');
    });

    it('wires cue property actions to the cue controller', () => {
        const state = {
            project: {
                cues: [{ id: 'A', timeMs: 1500, enabled: true }]
            },
            ui: {
                selectedCue: 'A'
            }
        };
        const stateManager = createStateManager(state);
        const cueController = {
            selectCue: vi.fn(),
            toggleCue: vi.fn(),
            setCue: vi.fn(),
            setCueAtPlayhead: vi.fn(),
            jumpToCue: vi.fn(),
            clearCue: vi.fn(),
        };
        const { context } = createInspectorSectionContext(stateManager, { cueController });
        const container = document.createElement('div');

        renderCueProperties(container, 'A', state.project, context);

        const timeInput = container.querySelector('input[type="text"]');
        timeInput.value = '00:02.500';
        timeInput.dispatchEvent(new Event('change', { bubbles: true }));
        expect(cueController.setCue).toHaveBeenCalledWith('A', 2500);

        const setAtPlayheadButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Set at Playhead'));
        setAtPlayheadButton.click();
        expect(cueController.setCueAtPlayhead).toHaveBeenCalledWith('A');

        const jumpButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Jump to Cue'));
        jumpButton.click();
        expect(cueController.jumpToCue).toHaveBeenCalledWith('A');

        const clearButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Clear Cue'));
        clearButton.click();
        expect(cueController.clearCue).toHaveBeenCalledWith('A');

        const backButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.includes('Back to Project Settings'));
        backButton.click();
        expect(cueController.selectCue).toHaveBeenCalledWith(null);
    });
});
