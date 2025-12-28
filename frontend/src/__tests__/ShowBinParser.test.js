import { describe, it, expect } from 'vitest';
import { validateShowBin } from '../core/ShowBinParser.js';

function maskWithProps(...props) {
    const mask = new Array(7).fill(0);
    for (const propId of props) {
        const idx = Math.floor((propId - 1) / 32);
        const bit = (propId - 1) % 32;
        mask[idx] |= (1 << bit) >>> 0;
    }
    return mask;
}

describe('ShowBinParser.validateShowBin', () => {
    it('does not warn for time-overlap when prop masks do not intersect', () => {
        const parsed = {
            header: { version: 3 },
            propConfigs: [
                { propId: 1, ledCount: 10 },
                { propId: 2, ledCount: 10 },
            ],
            events: [
                { index: 1, start: 0, dur: 1000, propMask: maskWithProps(1), propCount: 1 },
                { index: 2, start: 500, dur: 1000, propMask: maskWithProps(2), propCount: 1 },
            ],
        };

        const warnings = validateShowBin(parsed);
        expect(warnings.some(w => String(w.message).includes('overlap'))).toBe(false);
    });

    it('warns for time-overlap when prop masks intersect', () => {
        const parsed = {
            header: { version: 3 },
            propConfigs: [
                { propId: 1, ledCount: 10 },
            ],
            events: [
                { index: 1, start: 0, dur: 1000, propMask: maskWithProps(1), propCount: 1 },
                { index: 2, start: 500, dur: 1000, propMask: maskWithProps(1), propCount: 1 },
            ],
        };

        const warnings = validateShowBin(parsed);
        expect(warnings.some(w => String(w.message).includes('overlap'))).toBe(true);
    });
});

