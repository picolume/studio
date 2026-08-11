/**
 * UndoController - Manages undo/redo operations
 */

import { APP_EVENTS, emitAppEvent } from '../core/AppEventHub.js';

export class UndoController {
    constructor(stateManager, errorHandler, appEvents = null) {
        this.stateManager = stateManager;
        this.errorHandler = errorHandler;
        this.appEvents = appEvents;
        this.undoButton = null;
        this.redoButton = null;
        this.statusElement = null;
    }

    /**
     * Initialize with UI elements
     */
    init(elements) {
        this.undoButton = elements.undoButton;
        this.redoButton = elements.redoButton;
        this.statusElement = elements.statusElement;

        // Subscribe to state changes to update UI
        this.stateManager.subscribe(() => {
            this.updateUI();
        });

        this.updateUI();
    }

    /**
     * Perform undo
     */
    undo() {
        const success = this.stateManager.undo();

        if (success) {
            this.errorHandler.info('Undo');
            emitAppEvent(this.appEvents, APP_EVENTS.STATE_CHANGED);
        }

        this.updateUI();
        return success;
    }

    /**
     * Perform redo
     */
    redo() {
        const success = this.stateManager.redo();

        if (success) {
            this.errorHandler.info('Redo');
            emitAppEvent(this.appEvents, APP_EVENTS.STATE_CHANGED);
        }

        this.updateUI();
        return success;
    }

    /**
     * Get history information
     */
    getHistoryInfo() {
        return this.stateManager.getHistoryInfo();
    }

    /**
     * Update UI buttons
     */
    updateUI() {
        const info = this.stateManager.getHistoryInfo();

        if (this.undoButton) {
            this.undoButton.disabled = !info.canUndo;
        }

        if (this.redoButton) {
            this.redoButton.disabled = !info.canRedo;
        }

        if (this.statusElement) {
            this.statusElement.textContent = `History: ${info.undoCount}`;
        }
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.stateManager.clearHistory();
        this.updateUI();
    }
}
