/**
 * State Bridge - Provides backward compatibility for timeline.js
 *
 * This creates a Proxy that allows timeline.js to read from StateManager
 * while we gradually refactor it
 */

// This will be set by main-new.js after initialization
let stateManagerInstance = null;

export function setStateManager(manager) {
    stateManagerInstance = manager;
}

// Create a proxy that reads from StateManager
export const STATE = new Proxy({}, {
    get(target, prop) {
        if (!stateManagerInstance) {
            // Fallback to empty values during initialization
            return undefined;
        }

        // Map old state structure to new structure
        const state = stateManagerInstance.state;

        switch (prop) {
            case 'zoom':
                return state.ui?.zoom;
            case 'snapEnabled':
                return state.ui?.snapEnabled;
            case 'gridSize':
                return state.ui?.gridSize;
            case 'currentTime':
                return state.playback?.currentTime;
            case 'isPlaying':
                return state.playback?.isPlaying;
            case 'audioCtx':
                return state.audio?.ctx;
            case 'masterGain':
                return state.audio?.masterGain;
            case 'masterVolume':
                return state.audio?.masterVolume;
            default:
                // Direct property access
                return state[prop];
        }
    },

    set(target, prop, value) {
        if (!stateManagerInstance) {
            return false;
        }

        // Map old state writes to new structure
        stateManagerInstance.update(draft => {
            switch (prop) {
                case 'zoom':
                    draft.ui.zoom = value;
                    break;
                case 'snapEnabled':
                    draft.ui.snapEnabled = value;
                    break;
                case 'gridSize':
                    draft.ui.gridSize = value;
                    break;
                case 'currentTime':
                    draft.playback.currentTime = value;
                    break;
                case 'isPlaying':
                    draft.playback.isPlaying = value;
                    break;
                case 'audioCtx':
                    draft.audio.ctx = value;
                    break;
                case 'masterGain':
                    draft.audio.masterGain = value;
                    break;
                case 'masterVolume':
                    draft.audio.masterVolume = value;
                    break;
                default:
                    draft[prop] = value;
            }
        }, { skipHistory: true, skipNotify: true });

        return true;
    }
});

// Export empty els object (will be populated by Application.js)
export const els = {};
