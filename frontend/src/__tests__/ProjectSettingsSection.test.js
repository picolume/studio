import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '../core/AppEventHub.js';
import { renderProjectSettings } from '../views/inspector/ProjectSettingsSection.js';
import { createInspectorSectionContext, createStateManager } from './inspectorTestUtils.js';

describe('ProjectSettingsSection', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('updates duration and auto-save state through the shared inspector helpers', () => {
        const state = {
            project: {
                name: 'Field Test',
                duration: 60000,
                settings: {
                    profiles: [{ id: 'p1' }],
                    patch: { '1': 'p1' },
                }
            },
            autoSaveEnabled: true,
            isDirty: false,
        };
        const stateManager = createStateManager(state);
        const emit = vi.fn();
        const renderHardwareProfiles = vi.fn();
        const renderColorPalettes = vi.fn();
        const renderPropGroups = vi.fn();
        const { context } = createInspectorSectionContext(stateManager, {
            emit,
            renderHardwareProfiles,
            renderColorPalettes,
            renderPropGroups,
        });
        const container = document.createElement('div');

        renderProjectSettings(container, state.project, context);

        const durationInput = container.querySelector('input[type="text"]');
        durationInput.value = '00:12.500';

        const setButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.trim() === 'Set');
        setButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(state.project.duration).toBe(12500);
        expect(state.isDirty).toBe(true);
        expect(emit).toHaveBeenCalledWith(APP_EVENTS.TOAST, 'Duration set to 00:12.50');

        const autoSaveCheckbox = container.querySelector('input[type="checkbox"]');
        autoSaveCheckbox.checked = false;
        autoSaveCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

        expect(state.autoSaveEnabled).toBe(false);
        expect(emit).toHaveBeenCalledWith(APP_EVENTS.TOAST, 'Auto Save: OFF');
        expect(renderHardwareProfiles).toHaveBeenCalledWith(container, state.project);
        expect(renderColorPalettes).toHaveBeenCalledWith(container, state.project);
        expect(renderPropGroups).toHaveBeenCalledWith(container, state.project);
    });

    it('requests default profile setup when project settings are incomplete', () => {
        const state = {
            project: {
                name: 'New Show',
                duration: 10000,
                settings: {}
            },
            autoSaveEnabled: true,
            isDirty: false,
        };
        const stateManager = createStateManager(state);
        const ensureDefaultProfiles = vi.fn();
        const { context } = createInspectorSectionContext(stateManager, { ensureDefaultProfiles });

        renderProjectSettings(document.createElement('div'), state.project, context);

        expect(ensureDefaultProfiles).toHaveBeenCalledTimes(1);
    });
});
