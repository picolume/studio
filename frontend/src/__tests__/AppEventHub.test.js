import { describe, expect, it, vi } from 'vitest';
import { AppEventHub, emitAppEvent, subscribeAppEvent } from '../core/AppEventHub.js';

describe('AppEventHub', () => {
    it('emits events to registered listeners with a stable envelope', () => {
        const hub = new AppEventHub();
        const listener = vi.fn();

        hub.on('app:test', listener);
        hub.emit('app:test', { ok: true });

        expect(listener).toHaveBeenCalledWith({
            type: 'app:test',
            detail: { ok: true }
        });
    });

    it('supports unsubscribe through subscribeAppEvent', () => {
        const hub = new AppEventHub();
        const listener = vi.fn();

        const unsubscribe = subscribeAppEvent(hub, 'app:test', listener);
        emitAppEvent(hub, 'app:test', 123);
        unsubscribe();
        emitAppEvent(hub, 'app:test', 456);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({
            type: 'app:test',
            detail: 123
        });
    });
});
