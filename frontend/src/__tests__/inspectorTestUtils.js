import { vi } from 'vitest';
import { InspectorRenderer } from '../views/InspectorRenderer.js';

export function createStateManager(state) {
    return {
        state,
        get(path) {
            if (!path) return state;
            return String(path)
                .split('.')
                .reduce((current, key) => current?.[key], state);
        },
        update(mutator) {
            mutator(state);
        }
    };
}

export function createInspectorSectionContext(stateManager, overrides = {}) {
    const renderer = new InspectorRenderer({
        stateManager,
        cueController: overrides.cueController,
        timelineController: overrides.timelineController,
        audioService: overrides.audioService,
        elements: {},
        ui: {},
    });

    return {
        renderer,
        context: {
            stateManager,
            cueController: overrides.cueController,
            timelineController: overrides.timelineController,
            audioService: overrides.audioService,
            createCollapsibleSection: renderer._createCollapsibleSection.bind(renderer),
            addTextInput: renderer._addTextInput.bind(renderer),
            addInput: renderer._addInput.bind(renderer),
            addSlider: renderer._addSlider.bind(renderer),
            addToggle: renderer._addToggle.bind(renderer),
            formatPropLabel: renderer._formatPropLabel.bind(renderer),
            ensureDefaultProfiles: overrides.ensureDefaultProfiles ?? vi.fn(),
            renderHardwareProfiles: overrides.renderHardwareProfiles ?? vi.fn(),
            renderColorPalettes: overrides.renderColorPalettes ?? vi.fn(),
            renderPropGroups: overrides.renderPropGroups ?? vi.fn(),
            emit: overrides.emit ?? vi.fn(),
        }
    };
}
