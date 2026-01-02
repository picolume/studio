/**
 * Application - Main application bootstrap and coordination
 *
 * This file initializes all services and controllers and wires them together
 */

import { StateManager, createInitialState } from './StateManager.js';
import { AudioService } from '../services/AudioService.js';
import { ProjectService } from '../services/ProjectService.js';
import { UndoController } from '../controllers/UndoController.js';
import { TimelineController } from '../controllers/TimelineController.js';
import { ThemeManager } from '../controllers/ThemeManager.js';
import { KeyboardController } from '../controllers/KeyboardController.js';
import { SidebarModeManager } from '../controllers/SidebarModeManager.js';
import { MenuRenderer } from '../views/MenuRenderer.js';
import { ErrorHandler } from './ErrorHandler.js';

export class Application {
    constructor() {
        // Core
        this.stateManager = null;
        this.errorHandler = null;

        // Services
        this.audioService = null;
        this.projectService = null;

        // Controllers
        this.undoController = null;
        this.timelineController = null;
        this.themeManager = null;
        this.keyboardController = null;
        this.sidebarModeManager = null;
        this.menuRenderer = null;

        // UI Elements
        this.elements = {};

        // Auto-save
        this._autoSaveTimer = null;
        this._autoSaveInFlight = false;
        this._autoSaveLastErrorAt = 0;
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // 1. Initialize error handler first
            this.errorHandler = new ErrorHandler();

            // 2. Initialize state manager
            const initialState = createInitialState();
            this.stateManager = new StateManager(initialState);

            // 3. Initialize services
            this.audioService = new AudioService(this.stateManager);
            this.projectService = new ProjectService(this.stateManager, this.audioService);

            // 4. Initialize controllers
            this.undoController = new UndoController(this.stateManager, this.errorHandler);
            this.timelineController = new TimelineController(this.stateManager, this.errorHandler);
            this.themeManager = new ThemeManager();
            this.keyboardController = new KeyboardController(this.stateManager, this.errorHandler);
            this.sidebarModeManager = new SidebarModeManager();
            this.menuRenderer = new MenuRenderer();

            // 5. Cache DOM elements
            this._cacheElements();

            // 6. Initialize error handler with toast element
            this.errorHandler.init(this.elements.toast);

            // 7. Initialize controllers with UI elements
            this.undoController.init({
                undoButton: this.elements.btnUndo,
                redoButton: this.elements.btnRedo,
                statusElement: this.elements.statusHistory
            });

            // 8. Set up state change listeners
            this._setupStateListeners();

            // 9. Set up global event listeners
            this._setupEventListeners();

            // 9.5 Set up auto-save
            this._setupAutoSave();

            // 10. Initial render
            this._updateTitle();

            return { success: true };

        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            return { success: false, error };
        }
    }

    /**
     * Cache DOM elements
     * @private
     */
    _cacheElements() {
        const ids = [
            'timeline-scroll-area', 'timeline-content', 'tracks-container', 'track-headers',
            'ruler', 'playhead-handle', 'playhead-line', 'time-display', 'inspector-content',
            'preview-canvas', 'btn-play', 'btn-undo', 'btn-redo', 'btn-copy', 'btn-paste',
            'zoom-slider', 'zoom-display', 'vol-slider', 'toast',
            'status-history',
            'btn-add-track-led', 'btn-add-track-audio', 'btn-settings',
            'btn-export-bin', 'btn-upload', 'btn-save', 'btn-save-as', 'btn-export', 'btn-open', 'btn-new',
            'btn-stop', 'btn-to-start', 'chk-snap', 'sel-grid', 'btn-duplicate'
        ];

        const toCamelCase = (str) => str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                this.elements[id] = el;
                this.elements[toCamelCase(id)] = el;
            }
        });

        // Aliases
        this.elements.inspector = this.elements['inspector-content'];
        this.elements.timelineScroll = this.elements['timeline-scroll-area'];
    }

    /**
     * Set up state change listeners
     * @private
     */
    _setupStateListeners() {
        // Listen for project changes to update dirty flag and title
        this.stateManager.subscribeTo('project', () => {
            this._updateTitle();
        });

        this.stateManager.subscribeTo('isDirty', () => {
            this._updateTitle();
        });

        this.stateManager.subscribeTo('filePath', () => {
            this._updateTitle();
        });

        // Listen for UI state changes
        this.stateManager.subscribeTo('ui.zoom', (newZoom) => {
            if (this.elements.zoomSlider) {
                this.elements.zoomSlider.value = newZoom;
            }
            if (this.elements.zoomDisplay) {
                this.elements.zoomDisplay.textContent = `${newZoom}px/s`;
            }
        });
    }

    /**
     * Set up global event listeners
     * @private
     */
    _setupEventListeners() {
        // Custom app events
        window.addEventListener('app:toast', (e) => {
            this.errorHandler.showToast(e.detail);
        });

        window.addEventListener('app:state-changed', () => {
            // Notify timeline to rebuild
            window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        });
    }

    _setupAutoSave() {
        const AUTO_SAVE_DEBOUNCE_MS = 2000;
        const AUTO_SAVE_ERROR_COOLDOWN_MS = 15000;

        const clearTimer = () => {
            if (this._autoSaveTimer) {
                clearTimeout(this._autoSaveTimer);
                this._autoSaveTimer = null;
            }
        };

        const canAutoSaveNow = () => {
            if (!this.projectService?.backend?.capabilities?.fileIO) return false;
            if (this.stateManager.get('autoSaveEnabled') !== true) return false;
            if (this.stateManager.get('isDirty') !== true) return false;
            const filePath = this.stateManager.get('filePath');
            return Boolean(filePath);
        };

        const runAutoSave = async () => {
            this._autoSaveTimer = null;
            if (!canAutoSaveNow()) return;
            if (this._autoSaveInFlight) return;

            this._autoSaveInFlight = true;
            try {
                const filePath = this.stateManager.get('filePath');
                const result = await this.projectService.save(filePath, false, true, { allowPrompt: false });
                if (!result?.success) {
                    const now = Date.now();
                    if (now - this._autoSaveLastErrorAt > AUTO_SAVE_ERROR_COOLDOWN_MS) {
                        this._autoSaveLastErrorAt = now;
                        this.errorHandler?.showToast?.(result?.message || 'Auto-save failed');
                    }
                }
            } finally {
                this._autoSaveInFlight = false;
                if (this.stateManager.get('autoSaveEnabled') === true && this.stateManager.get('isDirty') === true) {
                    scheduleAutoSave();
                }
            }
        };

        const scheduleAutoSave = () => {
            if (!canAutoSaveNow()) {
                clearTimer();
                return;
            }
            clearTimer();
            this._autoSaveTimer = setTimeout(runAutoSave, AUTO_SAVE_DEBOUNCE_MS);
        };

        this.stateManager.subscribe((nextState) => {
            if (!nextState) return;
            if (nextState.autoSaveEnabled !== true || nextState.isDirty !== true) {
                clearTimer();
                return;
            }
            scheduleAutoSave();
        });
    }

    /**
     * Update window title
     * @private
     */
    _updateTitle() {
        const projectName = this.projectService.getProjectName();
        const isDirty = this.stateManager.get('isDirty');
        const dirty = isDirty ? '*' : '';
        document.title = `${projectName}${dirty} - PicoLume Studio`;
    }

    /**
     * Get service instance
     * @param {string} name - Service name
     */
    getService(name) {
        switch (name) {
            case 'audio': return this.audioService;
            case 'project': return this.projectService;
            default: return null;
        }
    }

    /**
     * Get controller instance
     * @param {string} name - Controller name
     */
    getController(name) {
        switch (name) {
            case 'undo': return this.undoController;
            case 'timeline': return this.timelineController;
            case 'theme': return this.themeManager;
            case 'keyboard': return this.keyboardController;
            default: return null;
        }
    }
}

// Create singleton instance
export const app = new Application();

// Expose globally for debugging
if (typeof window !== 'undefined') {
    window.app = app;
}
