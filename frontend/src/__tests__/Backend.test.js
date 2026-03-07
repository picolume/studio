import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnlineBackend } from '../core/Backend.js';

describe('Backend', () => {
    afterEach(() => {
        delete window.showOpenFilePicker;
    });

    it('returns a structured error for online uploads', async () => {
        const backend = createOnlineBackend();

        const result = await backend.uploadToPico();

        expect(result).toEqual({
            status: 'error',
            code: 'not_available',
            message: 'Not available in online version'
        });
    });

    it('returns a structured cancelled response when online load is aborted', async () => {
        window.showOpenFilePicker = vi.fn(() => {
            throw new DOMException('cancelled', 'AbortError');
        });
        const backend = createOnlineBackend();

        const result = await backend.loadProject();

        expect(result).toEqual({
            status: 'cancelled',
            code: 'cancelled',
            message: 'Load cancelled'
        });
    });
});
