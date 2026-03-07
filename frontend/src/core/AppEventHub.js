export const APP_EVENTS = Object.freeze({
    TIMELINE_CHANGED: 'app:timeline-changed',
    SELECTION_CHANGED: 'app:selection-changed',
    TIME_CHANGED: 'app:time-changed',
    ZOOM_CHANGED: 'app:zoom-changed',
    GRID_CHANGED: 'app:grid-changed',
    CUES_CHANGED: 'app:cues-changed',
    CUE_SELECTED: 'app:cue-selected',
    TOAST: 'app:toast',
    STATE_CHANGED: 'app:state-changed',
    LOAD_AUDIO: 'app:load-audio',
    DROP_CLIP: 'app:drop-clip',
    CLIP_MOUSEDOWN: 'app:clip-mousedown',
    CLIP_KEYDOWN: 'app:clip-keydown'
});

function createEventEnvelope(type, detail) {
    return { type, detail };
}

export class AppEventHub {
    constructor() {
        this._listeners = new Map();
    }

    on(type, handler) {
        if (!type || typeof handler !== 'function') {
            return () => {};
        }

        let listeners = this._listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this._listeners.set(type, listeners);
        }
        listeners.add(handler);

        return () => {
            listeners.delete(handler);
            if (listeners.size === 0) {
                this._listeners.delete(type);
            }
        };
    }

    emit(type, detail) {
        const listeners = this._listeners.get(type);
        if (!listeners || listeners.size === 0) {
            return;
        }

        const event = createEventEnvelope(type, detail);
        for (const listener of [...listeners]) {
            try {
                listener(event);
            } catch (error) {
                console.error(`Error in app event listener for ${type}:`, error);
            }
        }
    }
}

function emitWindowEvent(type, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }
    window.dispatchEvent(new CustomEvent(type, { detail }));
}

export function emitAppEvent(appEvents, type, detail) {
    if (appEvents?.emit) {
        appEvents.emit(type, detail);
        return;
    }
    emitWindowEvent(type, detail);
}

export function subscribeAppEvent(appEvents, type, handler) {
    if (appEvents?.on) {
        return appEvents.on(type, handler);
    }
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => {};
    }
    window.addEventListener(type, handler);
    return () => window.removeEventListener(type, handler);
}
