/**
 * UndoController - Manages undo/redo operations
 */

export class UndoController {
    constructor(stateManager, errorHandler) {
        this.stateManager = stateManager;
        this.errorHandler = errorHandler;
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
            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('app:state-changed'));
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
            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('app:state-changed'));
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
