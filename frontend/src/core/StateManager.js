/**
 * StateManager - Centralized state management with observer pattern
 *
 * Features:
 * - Immutable state updates
 * - Change notifications via observers
 * - Undo/redo with structural sharing
 * - State validation
 */

const MAX_HISTORY = 50;

export class StateManager {
    constructor(initialState = {}) {
        this._state = this._deepFreeze(initialState);
        this._listeners = new Map(); // path -> Set of callbacks
        this._globalListeners = new Set();
        this._undoStack = [];
        this._redoStack = [];
    }

    /**
     * Get current state (read-only)
     */
    get state() {
        return this._state;
    }

    /**
     * Get a specific path from state
     * @param {string} path - Dot-separated path (e.g., 'project.tracks')
     */
    get(path) {
        return this._getByPath(this._state, path);
    }

    /**
     * Update state immutably
     * @param {Function} updater - Function that receives draft state and modifies it
     * @param {Object} options - { skipHistory: boolean, skipNotify: boolean }
     */
    update(updater, options = {}) {
        const { skipHistory = false, skipNotify = false } = options;

        // Save to history before update
        if (!skipHistory) {
            this._pushHistory(this._state);
        }

        // Create a deep clone for mutation
        const draft = this._deepClone(this._state);

        // Apply updates
        updater(draft);

        // Freeze and set new state
        const newState = this._deepFreeze(draft);
        const oldState = this._state;
        this._state = newState;

        // Clear redo stack on new action
        if (!skipHistory) {
            this._redoStack = [];
        }

        // Notify listeners
        if (!skipNotify) {
            this._notifyListeners(oldState, newState);
        }

        return newState;
    }

    /**
     * Set a specific path in state
     * @param {string} path - Dot-separated path
     * @param {*} value - New value
     */
    set(path, value, options = {}) {
        return this.update(draft => {
            this._setByPath(draft, path, value);
        }, options);
    }

    /**
     * Subscribe to all state changes
     * @param {Function} callback - Called with (newState, oldState)
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this._globalListeners.add(callback);
        return () => this._globalListeners.delete(callback);
    }

    /**
     * Subscribe to changes on a specific path
     * @param {string} path - Dot-separated path
     * @param {Function} callback - Called with (newValue, oldValue)
     * @returns {Function} Unsubscribe function
     */
    subscribeTo(path, callback) {
        if (!this._listeners.has(path)) {
            this._listeners.set(path, new Set());
        }
        this._listeners.get(path).add(callback);

        return () => {
            const listeners = this._listeners.get(path);
            if (listeners) {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    this._listeners.delete(path);
                }
            }
        };
    }

    /**
     * Undo last action
     * @returns {boolean} Whether undo was successful
     */
    undo() {
        if (this._undoStack.length === 0) return false;

        const previousState = this._undoStack.pop();
        this._redoStack.push(this._state);

        const oldState = this._state;
        this._state = previousState;

        this._notifyListeners(oldState, this._state);
        return true;
    }

    /**
     * Redo last undone action
     * @returns {boolean} Whether redo was successful
     */
    redo() {
        if (this._redoStack.length === 0) return false;

        const nextState = this._redoStack.pop();
        this._undoStack.push(this._state);

        const oldState = this._state;
        this._state = nextState;

        this._notifyListeners(oldState, this._state);
        return true;
    }

    /**
     * Get undo/redo stack sizes
     */
    getHistoryInfo() {
        return {
            undoCount: this._undoStack.length,
            redoCount: this._redoStack.length,
            canUndo: this._undoStack.length > 0,
            canRedo: this._redoStack.length > 0
        };
    }

    /**
     * Clear history stacks
     */
    clearHistory() {
        this._undoStack = [];
        this._redoStack = [];
    }

    /**
     * Replace entire state (useful for loading projects)
     * @param {Object} newState - New state object
     * @param {boolean} clearHistory - Whether to clear undo/redo history
     */
    replaceState(newState, clearHistory = true) {
        const oldState = this._state;
        this._state = this._deepFreeze(newState);

        if (clearHistory) {
            this.clearHistory();
        }

        this._notifyListeners(oldState, this._state);
    }

    // ==================== Private Methods ====================

    _pushHistory(state) {
        this._undoStack.push(state);

        // Limit history size
        if (this._undoStack.length > MAX_HISTORY) {
            this._undoStack.shift();
        }
    }

    _notifyListeners(oldState, newState) {
        // Notify global listeners
        this._globalListeners.forEach(callback => {
            try {
                callback(newState, oldState);
            } catch (error) {
                console.error('Error in state listener:', error);
            }
        });

        // Notify path-specific listeners
        this._listeners.forEach((callbacks, path) => {
            const oldValue = this._getByPath(oldState, path);
            const newValue = this._getByPath(newState, path);

            if (oldValue !== newValue) {
                callbacks.forEach(callback => {
                    try {
                        callback(newValue, oldValue);
                    } catch (error) {
                        console.error(`Error in listener for path '${path}':`, error);
                    }
                });
            }
        });
    }

    _getByPath(obj, path) {
        if (!path) return obj;

        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }

        return current;
    }

    _setByPath(obj, path, value) {
        const parts = path.split('.');
        const lastPart = parts.pop();
        let current = obj;

        for (const part of parts) {
            if (!(part in current)) {
                current[part] = {};
            }
            current = current[part];
        }

        current[lastPart] = value;
    }

    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (obj instanceof Date) {
            return new Date(obj);
        }

        if (obj instanceof Array) {
            return obj.map(item => this._deepClone(item));
        }

        // Don't clone binary data, audio buffers, or audio context objects
        if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
            return obj;
        }

        // Don't clone Web Audio API objects (AudioBuffer, AudioContext, GainNode, etc.)
        if (typeof AudioBuffer !== 'undefined' && obj instanceof AudioBuffer) {
            return obj;
        }
        if (typeof AudioContext !== 'undefined' && obj instanceof AudioContext) {
            return obj;
        }
        if (typeof GainNode !== 'undefined' && obj instanceof GainNode) {
            return obj;
        }

        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this._deepClone(obj[key]);
            }
        }

        return cloned;
    }

    _deepFreeze(obj) {
        // Don't freeze primitive types
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        // Don't freeze binary data (audio buffers, typed arrays)
        if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
            return obj;
        }

        // Don't freeze Web Audio API objects (AudioBuffer, AudioContext, GainNode, etc.)
        if (typeof AudioBuffer !== 'undefined' && obj instanceof AudioBuffer) {
            return obj;
        }
        if (typeof AudioContext !== 'undefined' && obj instanceof AudioContext) {
            return obj;
        }
        if (typeof GainNode !== 'undefined' && obj instanceof GainNode) {
            return obj;
        }

        // Freeze the object
        Object.freeze(obj);

        // Recursively freeze properties
        Object.getOwnPropertyNames(obj).forEach(prop => {
            if (obj[prop] !== null && typeof obj[prop] === 'object' && !Object.isFrozen(obj[prop])) {
                this._deepFreeze(obj[prop]);
            }
        });

        return obj;
    }
}

/**
 * Create initial state structure
 */
export function createInitialState() {
    return {
        project: {
            version: '1.0.0', // NEW: Project format version
            name: "My Show",
            duration: 60000,
            settings: {
                ledCount: 164,
                brightness: 255,
                profiles: [
                    { id: 'p_default', name: 'Standard Prop', ledCount: 164, assignedIds: '1-164' }
                ],
                patch: {},
                fieldLayout: {} // propId -> { x, y } positions for field preview
            },
            propGroups: [
                { id: 'g_all', name: 'All Props', ids: '1-18' },
                { id: 'g_1', name: 'Prop 1', ids: '1' },
                { id: 'g_odd', name: 'Odd Props', ids: '1,3,5,7,9,11,13,15,17' }
            ],
            tracks: [
                { id: 't1', type: 'audio', label: 'Audio Track', clips: [], groupId: null },
                { id: 't2', type: 'led', label: 'Main Track', clips: [], groupId: 'g_all' }
            ]
        },
        assets: {},
        audioLibrary: {},
        activeAudioSources: [],
        selection: [],
        filePath: null,
        isDirty: false,
        autoSaveEnabled: true,
        playback: {
            isPlaying: false,
            currentTime: 0,
            startTime: 0,
        },
        ui: {
            zoom: 50,
            snapEnabled: true,
            gridSize: 1000,
            previewMode: 'track', // 'track' | 'field' | 'off'
        },
        audio: {
            ctx: null,
            masterGain: null,
            masterVolume: 1.0,
        },
        clipboard: null,
        lastPreviewRender: 0
    };
}
