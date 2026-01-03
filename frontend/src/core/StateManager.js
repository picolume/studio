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

/**
 * Hardware Profile Constants
 * These values map directly to firmware enums for PropConfig
 */
export const LED_TYPES = Object.freeze({
    WS2812B: 0,
    SK6812: 1,
    SK6812_RGBW: 2,
    WS2811: 3,
    WS2813: 4,
    WS2815: 5
});

export const LED_TYPE_LABELS = Object.freeze({
    [LED_TYPES.WS2812B]: 'WS2812B',
    [LED_TYPES.SK6812]: 'SK6812',
    [LED_TYPES.SK6812_RGBW]: 'SK6812 RGBW',
    [LED_TYPES.WS2811]: 'WS2811',
    [LED_TYPES.WS2813]: 'WS2813',
    [LED_TYPES.WS2815]: 'WS2815'
});

export const COLOR_ORDERS = Object.freeze({
    GRB: 0,  // WS2812B default
    RGB: 1,
    BRG: 2,
    RBG: 3,
    GBR: 4,
    BGR: 5
});

export const COLOR_ORDER_LABELS = Object.freeze({
    [COLOR_ORDERS.GRB]: 'GRB',
    [COLOR_ORDERS.RGB]: 'RGB',
    [COLOR_ORDERS.BRG]: 'BRG',
    [COLOR_ORDERS.RBG]: 'RBG',
    [COLOR_ORDERS.GBR]: 'GBR',
    [COLOR_ORDERS.BGR]: 'BGR'
});

/**
 * Built-in color palettes
 */
export const DEFAULT_PALETTES = Object.freeze([
    {
        id: 'pal_warm',
        name: 'Warm',
        builtin: true,
        colors: ['#FF0000', '#FF4500', '#FF8C00', '#FFA500', '#FFD700', '#FFFF00']
    },
    {
        id: 'pal_cool',
        name: 'Cool',
        builtin: true,
        colors: ['#00FFFF', '#00CED1', '#1E90FF', '#0000FF', '#4169E1', '#9400D3']
    },
    {
        id: 'pal_ocean',
        name: 'Ocean',
        builtin: true,
        colors: ['#001F3F', '#003366', '#0066CC', '#0099FF', '#00CCFF', '#66FFFF']
    },
    {
        id: 'pal_forest',
        name: 'Forest',
        builtin: true,
        colors: ['#006400', '#228B22', '#32CD32', '#7CFC00', '#ADFF2F', '#9ACD32']
    }
]);

/**
 * Create a new custom palette
 * @param {string} name - Palette name
 * @param {string[]} colors - Array of hex color strings
 */
let paletteIdCounter = 0;
export function createPalette(name, colors = ['#FFFFFF', '#000000']) {
    return {
        id: `pal_${Date.now()}_${(paletteIdCounter++).toString(36)}`,
        name,
        builtin: false,
        colors: [...colors]
    };
}

/**
 * Create a default hardware profile
 * @param {string} id - Unique profile ID
 * @param {string} name - Display name
 * @param {number} ledCount - Number of LEDs
 * @param {string} assignedIds - Prop ID range (e.g., '1-164')
 */
export function createDefaultProfile(id, name, ledCount, assignedIds) {
    return {
        // Identity
        id,
        name,
        assignedIds,

        // Firmware-critical fields (written to show.bin)
        ledCount,
        ledType: LED_TYPES.WS2812B,
        colorOrder: COLOR_ORDERS.RGB,
        brightnessCap: 255,

        // Informational fields (for documentation/UI only)
        voltage: 5,              // 5V or 12V or 24V
        physicalLength: null,    // Length in cm (null = not specified)
        pixelsPerMeter: 60,      // LED density
        notes: ''                // User notes
    };
}

/**
 * Migrate a legacy profile to the new format
 * Adds missing fields with sensible defaults
 * @param {Object} profile - Legacy profile object
 * @returns {Object} - Migrated profile with all fields
 */
export function migrateProfile(profile) {
    return {
        // Keep existing fields
        id: profile.id,
        name: profile.name,
        assignedIds: profile.assignedIds,
        ledCount: profile.ledCount,

        // Add firmware fields with defaults if missing
        ledType: profile.ledType ?? LED_TYPES.WS2812B,
        colorOrder: profile.colorOrder ?? COLOR_ORDERS.RGB,
        brightnessCap: profile.brightnessCap ?? 255,

        // Add informational fields with defaults if missing
        voltage: profile.voltage ?? 5,
        physicalLength: profile.physicalLength ?? null,
        pixelsPerMeter: profile.pixelsPerMeter ?? 60,
        notes: profile.notes ?? ''
    };
}

/**
 * Migrate all profiles in a project settings object
 * @param {Object} settings - Project settings
 * @returns {Object} - Settings with migrated profiles
 */
export function migrateProjectProfiles(settings) {
    if (!settings.profiles || !Array.isArray(settings.profiles)) {
        return settings;
    }

    return {
        ...settings,
        profiles: settings.profiles.map(migrateProfile)
    };
}

/**
 * Validate a hardware profile
 * @param {Object} profile - Profile to validate
 * @returns {{ valid: boolean, errors: string[] }} - Validation result
 */
export function validateProfile(profile) {
    const errors = [];

    // Required identity fields
    if (!profile.id || typeof profile.id !== 'string') {
        errors.push('Profile must have a valid ID');
    }
    if (!profile.name || typeof profile.name !== 'string') {
        errors.push('Profile must have a name');
    }

    // LED count validation
    if (typeof profile.ledCount !== 'number' || profile.ledCount < 1 || profile.ledCount > 1000) {
        errors.push('LED count must be between 1 and 1000');
    }

    // LED type validation
    const validLedTypes = Object.values(LED_TYPES);
    if (profile.ledType !== undefined && !validLedTypes.includes(profile.ledType)) {
        errors.push(`LED type must be one of: ${validLedTypes.join(', ')}`);
    }

    // Color order validation
    const validColorOrders = Object.values(COLOR_ORDERS);
    if (profile.colorOrder !== undefined && !validColorOrders.includes(profile.colorOrder)) {
        errors.push(`Color order must be one of: ${validColorOrders.join(', ')}`);
    }

    // Brightness cap validation
    if (profile.brightnessCap !== undefined) {
        if (typeof profile.brightnessCap !== 'number' || profile.brightnessCap < 0 || profile.brightnessCap > 255) {
            errors.push('Brightness cap must be between 0 and 255');
        }
    }

    // Voltage validation (optional field)
    if (profile.voltage !== undefined) {
        const validVoltages = [5, 12, 24];
        if (!validVoltages.includes(profile.voltage)) {
            errors.push('Voltage must be 5, 12, or 24');
        }
    }

    // Pixels per meter validation (optional field)
    if (profile.pixelsPerMeter !== undefined && profile.pixelsPerMeter !== null) {
        if (typeof profile.pixelsPerMeter !== 'number' || profile.pixelsPerMeter < 1 || profile.pixelsPerMeter > 300) {
            errors.push('Pixels per meter must be between 1 and 300');
        }
    }

    // Physical length validation (optional field)
    if (profile.physicalLength !== undefined && profile.physicalLength !== null) {
        if (typeof profile.physicalLength !== 'number' || profile.physicalLength < 1) {
            errors.push('Physical length must be a positive number');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate all profiles in project settings
 * @param {Object} settings - Project settings
 * @returns {{ valid: boolean, profileErrors: Map<string, string[]> }}
 */
export function validateAllProfiles(settings) {
    const profileErrors = new Map();
    let allValid = true;

    if (settings.profiles && Array.isArray(settings.profiles)) {
        for (const profile of settings.profiles) {
            const result = validateProfile(profile);
            if (!result.valid) {
                allValid = false;
                profileErrors.set(profile.id || 'unknown', result.errors);
            }
        }
    }

    return { valid: allValid, profileErrors };
}

/**
 * Clamp a value to valid profile field ranges
 * Used to sanitize input before saving
 * @param {string} field - Field name
 * @param {*} value - Value to clamp
 * @returns {*} - Clamped value
 */
export function clampProfileValue(field, value) {
    switch (field) {
        case 'ledCount':
            return Math.max(1, Math.min(1000, Math.round(value) || 164));
        case 'ledType':
            const validLedTypes = Object.values(LED_TYPES);
            return validLedTypes.includes(value) ? value : LED_TYPES.WS2812B;
        case 'colorOrder':
            const validColorOrders = Object.values(COLOR_ORDERS);
            return validColorOrders.includes(value) ? value : COLOR_ORDERS.GRB;
        case 'brightnessCap':
            return Math.max(0, Math.min(255, Math.round(value) || 255));
        case 'voltage':
            const validVoltages = [5, 12, 24];
            return validVoltages.includes(value) ? value : 5;
        case 'pixelsPerMeter':
            return Math.max(1, Math.min(300, Math.round(value) || 60));
        case 'physicalLength':
            return value ? Math.max(1, Math.round(value)) : null;
        default:
            return value;
    }
}

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
 * Default cue points structure
 */
export const DEFAULT_CUES = Object.freeze([
    { id: 'A', timeMs: null, enabled: false },
    { id: 'B', timeMs: null, enabled: false },
    { id: 'C', timeMs: null, enabled: false },
    { id: 'D', timeMs: null, enabled: false }
]);

/**
 * Create a fresh cues array
 */
export function createDefaultCues() {
    return DEFAULT_CUES.map(cue => ({ ...cue }));
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
                profiles: [
                    createDefaultProfile('p_default', 'Standard Prop', 164, '1-224')
                ],
                patch: {},
                fieldLayout: {}, // propId -> { x, y } positions for field preview
                palettes: [...DEFAULT_PALETTES] // Color palettes (built-in + custom)
            },
            propGroups: [
                { id: 'g_all', name: 'All Props', ids: '1-18' },
                { id: 'g_1', name: 'Prop 1', ids: '1' },
                { id: 'g_odd', name: 'Odd Props', ids: '1,3,5,7,9,11,13,15,17' }
            ],
            tracks: [
                { id: 't1', type: 'audio', label: 'Audio Track', clips: [], groupId: null },
                { id: 't2', type: 'led', label: 'Main Track', clips: [], groupId: 'g_all' }
            ],
            cues: createDefaultCues() // Cue points for live resync (A, B, C, D)
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
            selectedCue: null, // Currently selected cue ID ('A', 'B', 'C', 'D') for inspector
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
