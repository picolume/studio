/**
 * KeyboardController - Manages global keyboard shortcuts
 */

export class KeyboardController {
    constructor(stateManager, errorHandler) {
        this.stateManager = stateManager;
        this.errorHandler = errorHandler;

        // Controller/service references (set via init)
        this.undoController = null;
        this.timelineController = null;
        this.cueController = null;
        this.themeManager = null;

        // UI element references
        this.elements = {};

        // Callbacks for actions that need UI context
        this._callbacks = {
            onUndo: null,
            onRedo: null,
            onBuildTimeline: null,
            onUpdateSelectionUI: null,
            togglePane: null,
            closeModal: null
        };

        // Track active modals
        this._modalChecks = [];
    }

    /**
     * Initialize with dependencies
     * @param {Object} options
     */
    init(options = {}) {
        this.undoController = options.undoController;
        this.timelineController = options.timelineController;
        this.cueController = options.cueController;
        this.themeManager = options.themeManager;
        this.elements = options.elements || {};
        this._callbacks = { ...this._callbacks, ...options.callbacks };
        this._modalChecks = options.modalChecks || [];

        // Set up global keydown listener
        window.addEventListener('keydown', (e) => this._handleKeyDown(e));
    }

    /**
     * Check if the active element is a text input
     * @param {HTMLElement} el
     * @returns {boolean}
     */
    _isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }

    /**
     * Handle global keydown events
     * @param {KeyboardEvent} e
     */
    _handleKeyDown(e) {
        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;

        // Check for modal dismissal (Escape)
        if (key === 'Escape') {
            for (const check of this._modalChecks) {
                if (check.isOpen()) {
                    e.preventDefault();
                    check.close();
                    return;
                }
            }
        }

        // Alt+key shortcuts (when not typing)
        if (alt && !shift && !ctrl && !this._isTypingTarget(document.activeElement)) {
            switch (key) {
                case '1':
                    e.preventDefault();
                    this._callbacks.togglePane?.('palette');
                    return;
                case '2':
                    e.preventDefault();
                    this._callbacks.togglePane?.('preview');
                    return;
                case '3':
                    e.preventDefault();
                    this._callbacks.togglePane?.('inspector');
                    return;
                case 't':
                case 'T':
                    e.preventDefault();
                    this.themeManager?.toggleLightDark();
                    return;
            }
        }

        // Ctrl/Cmd shortcuts
        if (ctrl) {
            switch (key.toLowerCase()) {
                // Ctrl+Z: Undo
                case 'z':
                    if (!shift) {
                        e.preventDefault();
                        this._performUndo();
                    } else {
                        // Ctrl+Shift+Z: Redo
                        e.preventDefault();
                        this._performRedo();
                    }
                    return;

                // Ctrl+S: Save
                case 's':
                    e.preventDefault();
                    if (shift) {
                        this.elements.btnSaveAs?.click();
                    } else {
                        this.elements.btnSave?.click();
                    }
                    return;

                // Ctrl+N: New
                case 'n':
                    e.preventDefault();
                    this.elements.btnNew?.click();
                    return;

                // Ctrl+O: Open
                case 'o':
                    e.preventDefault();
                    this.elements.btnOpen?.click();
                    return;

                // Ctrl+C: Copy (when not typing)
                case 'c':
                    if (!this._isTypingTarget(document.activeElement)) {
                        e.preventDefault();
                        this.timelineController?.copySelected();
                        this._callbacks.onUpdateClipboardUI?.();
                    }
                    return;

                // Ctrl+V: Paste (when not typing)
                case 'v':
                    if (!this._isTypingTarget(document.activeElement)) {
                        e.preventDefault();
                        this.timelineController?.paste();
                        this._callbacks.onBuildTimeline?.();
                    }
                    return;

                // Ctrl+D: Duplicate (when not typing)
                case 'd':
                    if (!this._isTypingTarget(document.activeElement)) {
                        e.preventDefault();
                        this.timelineController?.duplicateSelected();
                        this._callbacks.onBuildTimeline?.();
                    }
                    return;
            }
        }

        // Non-modifier shortcuts (when not typing)
        if (!this._isTypingTarget(document.activeElement)) {
            switch (key) {
                // Delete/Backspace: Delete selected
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    this.timelineController?.deleteSelected();
                    this._callbacks.onBuildTimeline?.();
                    this._callbacks.onUpdateSelectionUI?.();
                    return;

                // Space: Play/Pause
                case ' ':
                    e.preventDefault();
                    this.elements.btnPlay?.click();
                    return;

                // 1-4: Jump to cue A-D (or Shift+1-4 to set cue)
                case '1':
                case '!': // Shift+1
                    e.preventDefault();
                    if (shift) {
                        this.cueController?.setCueAtPlayhead('A');
                    } else {
                        this.cueController?.jumpToCue('A');
                    }
                    return;
                case '2':
                case '@': // Shift+2
                    e.preventDefault();
                    if (shift) {
                        this.cueController?.setCueAtPlayhead('B');
                    } else {
                        this.cueController?.jumpToCue('B');
                    }
                    return;
                case '3':
                case '#': // Shift+3
                    e.preventDefault();
                    if (shift) {
                        this.cueController?.setCueAtPlayhead('C');
                    } else {
                        this.cueController?.jumpToCue('C');
                    }
                    return;
                case '4':
                case '$': // Shift+4
                    e.preventDefault();
                    if (shift) {
                        this.cueController?.setCueAtPlayhead('D');
                    } else {
                        this.cueController?.jumpToCue('D');
                    }
                    return;
            }
        }
    }

    /**
     * Perform undo and update UI
     */
    _performUndo() {
        this.undoController?.undo();
        this._callbacks.onBuildTimeline?.();
        this._callbacks.onUpdateSelectionUI?.();
    }

    /**
     * Perform redo and update UI
     */
    _performRedo() {
        this.undoController?.redo();
        this._callbacks.onBuildTimeline?.();
        this._callbacks.onUpdateSelectionUI?.();
    }
}
