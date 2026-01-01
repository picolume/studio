/**
 * MenuController - Legacy compatibility wrapper
 *
 * Menu functionality has been moved to:
 * - SidebarModeManager: handles mode switching, close triggers
 * - MenuRenderer: renders menu content and handles actions
 *
 * This class is kept for backward compatibility and provides
 * action handlers to MenuRenderer.
 */

export class MenuController {
    constructor() {
        // Action handlers (passed through to MenuRenderer)
        this._actionHandlers = {};
    }

    /**
     * Initialize with action handlers
     * @param {Object} options
     * @param {Object} options.actionHandlers - Map of action names to handler functions
     */
    init(options = {}) {
        this._actionHandlers = options.actionHandlers || {};
    }

    /**
     * Get all registered action handlers
     * @returns {Object}
     */
    getActionHandlers() {
        return this._actionHandlers;
    }

    /**
     * Register an action handler
     * @param {string} action - Action name
     * @param {Function} handler - Handler function
     */
    registerAction(action, handler) {
        this._actionHandlers[action] = handler;
    }

    /**
     * Clean up (no-op, kept for API compatibility)
     */
    destroy() {
        // No-op - cleanup handled by SidebarModeManager
    }
}
