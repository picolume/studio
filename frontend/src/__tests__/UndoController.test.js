import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UndoController } from '../controllers/UndoController.js';
import { StateManager } from '../core/StateManager.js';

describe('UndoController', () => {
    let stateManager;
    let errorHandler;
    let controller;
    let mockElements;

    beforeEach(() => {
        stateManager = new StateManager({
            count: 0,
            items: []
        });

        errorHandler = {
            info: vi.fn()
        };

        mockElements = {
            undoButton: { disabled: false },
            redoButton: { disabled: false },
            statusElement: { textContent: '' }
        };

        vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {});

        controller = new UndoController(stateManager, errorHandler);
    });

    describe('Initialization', () => {
        it('should initialize with UI elements', () => {
            controller.init(mockElements);

            expect(controller.undoButton).toBe(mockElements.undoButton);
            expect(controller.redoButton).toBe(mockElements.redoButton);
            expect(controller.statusElement).toBe(mockElements.statusElement);
        });

        it('should update UI on init', () => {
            controller.init(mockElements);

            expect(mockElements.undoButton.disabled).toBe(true); // No history yet
            expect(mockElements.redoButton.disabled).toBe(true);
        });

        it('should subscribe to state changes', () => {
            controller.init(mockElements);

            // Make a change
            stateManager.update(draft => { draft.count = 1; });

            // UI should update automatically
            expect(mockElements.undoButton.disabled).toBe(false); // Can now undo
        });
    });

    describe('Undo Operation', () => {
        beforeEach(() => {
            controller.init(mockElements);
        });

        it('should perform undo', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.update(draft => { draft.count = 2; });

            const result = controller.undo();

            expect(result).toBe(true);
            expect(stateManager.get('count')).toBe(1);
        });

        it('should show info message on undo', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.undo();

            expect(errorHandler.info).toHaveBeenCalledWith('Undo');
        });

        it('should dispatch state-changed event on undo', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.undo();

            expect(window.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:state-changed' })
            );
        });

        it('should return false when nothing to undo', () => {
            const result = controller.undo();

            expect(result).toBe(false);
            expect(errorHandler.info).not.toHaveBeenCalled();
        });

        it('should update UI after undo', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.undo();

            expect(mockElements.undoButton.disabled).toBe(true);
            expect(mockElements.redoButton.disabled).toBe(false);
        });
    });

    describe('Redo Operation', () => {
        beforeEach(() => {
            controller.init(mockElements);
        });

        it('should perform redo', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.undo();

            const result = controller.redo();

            expect(result).toBe(true);
            expect(stateManager.get('count')).toBe(1);
        });

        it('should show info message on redo', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.undo();

            controller.redo();

            expect(errorHandler.info).toHaveBeenCalledWith('Redo');
        });

        it('should dispatch state-changed event on redo', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.undo();
            window.dispatchEvent.mockClear();

            controller.redo();

            expect(window.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:state-changed' })
            );
        });

        it('should return false when nothing to redo', () => {
            const result = controller.redo();

            expect(result).toBe(false);
            expect(errorHandler.info).not.toHaveBeenCalled();
        });
    });

    describe('History Info', () => {
        beforeEach(() => {
            controller.init(mockElements);
        });

        it('should return history info', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.update(draft => { draft.count = 2; });

            const info = controller.getHistoryInfo();

            expect(info.undoCount).toBe(2);
            expect(info.canUndo).toBe(true);
            expect(info.canRedo).toBe(false);
        });
    });

    describe('UI Updates', () => {
        beforeEach(() => {
            controller.init(mockElements);
        });

        it('should disable undo button when no history', () => {
            controller.updateUI();

            expect(mockElements.undoButton.disabled).toBe(true);
        });

        it('should enable undo button when history exists', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.updateUI();

            expect(mockElements.undoButton.disabled).toBe(false);
        });

        it('should disable redo button when no redo available', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.updateUI();

            expect(mockElements.redoButton.disabled).toBe(true);
        });

        it('should enable redo button after undo', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.undo();

            controller.updateUI();

            expect(mockElements.redoButton.disabled).toBe(false);
        });

        it('should update status text', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.update(draft => { draft.count = 2; });

            controller.updateUI();

            expect(mockElements.statusElement.textContent).toBe('History: 2');
        });

        it('should handle missing UI elements gracefully', () => {
            controller.undoButton = null;
            controller.redoButton = null;
            controller.statusElement = null;

            expect(() => controller.updateUI()).not.toThrow();
        });
    });

    describe('Clear History', () => {
        beforeEach(() => {
            controller.init(mockElements);
        });

        it('should clear history', () => {
            stateManager.update(draft => { draft.count = 1; });
            stateManager.update(draft => { draft.count = 2; });

            controller.clearHistory();

            expect(controller.getHistoryInfo().undoCount).toBe(0);
        });

        it('should update UI after clearing', () => {
            stateManager.update(draft => { draft.count = 1; });

            controller.clearHistory();

            expect(mockElements.undoButton.disabled).toBe(true);
        });
    });
});
