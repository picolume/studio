import { describe, it, expect } from 'vitest';
import {
    hexToRgb,
    rgbToHex,
    parseIdString,
    formatTime,
    clamp,
    pseudoRandom
} from '../utils.js';

describe('Color Utilities', () => {
    describe('hexToRgb', () => {
        it('should convert hex color to RGB object', () => {
            expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
            expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
            expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
        });

        it('should handle hex without # prefix', () => {
            expect(hexToRgb('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
        });

        it('should handle lowercase hex', () => {
            expect(hexToRgb('#ff00aa')).toEqual({ r: 255, g: 0, b: 170 });
        });

        it('should handle mixed case', () => {
            expect(hexToRgb('#Ff00aA')).toEqual({ r: 255, g: 0, b: 170 });
        });
    });

    describe('rgbToHex', () => {
        it('should convert RGB to hex string', () => {
            expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
            expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
            expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
        });

        it('should pad with zeros', () => {
            expect(rgbToHex(1, 2, 3)).toBe('#010203');
        });

        it('should handle black and white', () => {
            expect(rgbToHex(0, 0, 0)).toBe('#000000');
            expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
        });
    });
});

describe('ID String Parsing', () => {
    describe('parseIdString', () => {
        it('should parse single ID', () => {
            expect(parseIdString('5')).toEqual([5]);
        });

        it('should parse comma-separated IDs', () => {
            expect(parseIdString('1,3,5')).toEqual([1, 3, 5]);
        });

        it('should parse range', () => {
            expect(parseIdString('1-5')).toEqual([1, 2, 3, 4, 5]);
        });

        it('should parse mixed ranges and individual IDs', () => {
            expect(parseIdString('1,3-5,7')).toEqual([1, 3, 4, 5, 7]);
        });

        it('should handle spaces', () => {
            expect(parseIdString(' 1 , 3 - 5 , 7 ')).toEqual([1, 3, 4, 5, 7]);
        });

        it('should sort and deduplicate', () => {
            expect(parseIdString('5,3,1,3,5')).toEqual([1, 3, 5]);
        });

        it('should handle overlapping ranges', () => {
            expect(parseIdString('1-5,3-7')).toEqual([1, 2, 3, 4, 5, 6, 7]);
        });

        it('should return empty array for empty string', () => {
            expect(parseIdString('')).toEqual([]);
        });

        it('should handle maximum ID 224', () => {
            expect(parseIdString('222-225')).toEqual([222, 223, 224]);
        });

        it('should ignore IDs below 1', () => {
            expect(parseIdString('-1,0,1,2')).toEqual([1, 2]);
        });
    });
});

describe('Time Formatting', () => {
    describe('formatTime', () => {
        it('should format zero correctly', () => {
            expect(formatTime(0)).toBe('00:00.00');
        });

        it('should format seconds', () => {
            expect(formatTime(5000)).toBe('00:05.00');
        });

        it('should format minutes and seconds', () => {
            expect(formatTime(65000)).toBe('01:05.00');
        });

        it('should format with centiseconds', () => {
            expect(formatTime(1250)).toBe('00:01.25');
        });

        it('should handle exact minute boundaries', () => {
            expect(formatTime(60000)).toBe('01:00.00');
            expect(formatTime(120000)).toBe('02:00.00');
        });

        it('should pad single digits', () => {
            expect(formatTime(1500)).toBe('00:01.50');
        });

        it('should handle large values', () => {
            expect(formatTime(599990)).toBe('09:59.99');
        });
    });
});

describe('Math Utilities', () => {
    describe('clamp', () => {
        it('should clamp value within range', () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });

        it('should clamp to minimum', () => {
            expect(clamp(-5, 0, 10)).toBe(0);
        });

        it('should clamp to maximum', () => {
            expect(clamp(15, 0, 10)).toBe(10);
        });

        it('should handle equal min/max', () => {
            expect(clamp(5, 7, 7)).toBe(7);
        });

        it('should handle negative ranges', () => {
            expect(clamp(-10, -5, 5)).toBe(-5);
            expect(clamp(10, -5, 5)).toBe(5);
        });
    });

    describe('pseudoRandom', () => {
        it('should return value between 0 and 1', () => {
            const value = pseudoRandom(42);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        });

        it('should be deterministic with same seed', () => {
            const val1 = pseudoRandom(100);
            const val2 = pseudoRandom(100);
            expect(val1).toBe(val2);
        });

        it('should produce different values for different seeds', () => {
            const val1 = pseudoRandom(1);
            const val2 = pseudoRandom(2);
            expect(val1).not.toBe(val2);
        });

        it('should handle large seeds', () => {
            const value = pseudoRandom(999999);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        });

        it('should handle zero seed', () => {
            const value = pseudoRandom(0);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        });
    });
});
