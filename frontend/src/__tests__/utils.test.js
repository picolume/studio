import { describe, it, expect } from 'vitest';
import {
    hexToRgb,
    rgbToHex,
    parseIdString,
    formatTime,
    parseTime,
    clamp,
    pseudoRandom,
    formatPicoStatus
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

        describe('parseTime', () => {
            it('should parse MM:SS.ss', () => {
                expect(parseTime('01:05.25')).toBe(65250);
            });

            it('should parse MM:SS', () => {
                expect(parseTime('02:00')).toBe(120000);
            });

            it('should parse seconds', () => {
                expect(parseTime('1.5')).toBe(1500);
            });

            it('should return NaN for empty input', () => {
                expect(Number.isNaN(parseTime(''))).toBe(true);
            });
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

describe('formatPicoStatus', () => {
    describe('disconnected states', () => {
        it('should return not detected for null status', () => {
            const result = formatPicoStatus(null);
            expect(result.text).toBe('Pico: Not detected');
            expect(result.title).toBe('No PicoLume device detected');
        });

        it('should return not detected for undefined status', () => {
            const result = formatPicoStatus(undefined);
            expect(result.text).toBe('Pico: Not detected');
            expect(result.title).toBe('No PicoLume device detected');
        });

        it('should return not detected when connected is false', () => {
            const result = formatPicoStatus({ connected: false });
            expect(result.text).toBe('Pico: Not detected');
            expect(result.title).toBe('No PicoLume device detected');
        });
    });

    describe('bootloader mode', () => {
        it('should show bootloader without drive', () => {
            const result = formatPicoStatus({ connected: true, mode: 'BOOTLOADER' });
            expect(result.text).toBe('Pico: Bootloader');
            expect(result.title).toBe('Pico is in UF2 bootloader mode');
        });

        it('should show bootloader with drive', () => {
            const result = formatPicoStatus({ connected: true, mode: 'BOOTLOADER', usbDrive: 'E:/' });
            expect(result.text).toBe('Pico: Bootloader (E:/)');
            expect(result.title).toBe('Pico is in UF2 bootloader mode');
        });
    });

    describe('USB mode', () => {
        it('should show USB with drive only', () => {
            const result = formatPicoStatus({ connected: true, mode: 'USB', usbDrive: 'E:/' });
            expect(result.text).toBe('Pico: USB (E:/)');
            expect(result.title).toBe('PicoLume USB upload volume detected');
        });

        it('should show USB+SERIAL with both', () => {
            const result = formatPicoStatus({
                connected: true,
                mode: 'USB+SERIAL',
                usbDrive: 'E:/',
                serialPort: 'COM5'
            });
            expect(result.text).toBe('Pico: USB (E:/, COM5)');
            expect(result.title).toBe('PicoLume USB upload volume detected');
        });
    });

    describe('serial mode', () => {
        it('should show connected with port', () => {
            const result = formatPicoStatus({ connected: true, mode: 'SERIAL', serialPort: 'COM5' });
            expect(result.text).toBe('Pico: Connected (COM5)');
            expect(result.title).toBe('PicoLume serial connection detected');
        });

        it('should show connected without port', () => {
            const result = formatPicoStatus({ connected: true, mode: 'SERIAL' });
            expect(result.text).toBe('Pico: Connected');
            expect(result.title).toBe('PicoLume serial connection detected');
        });
    });

    describe('port locked warning', () => {
        it('should show PORT BUSY warning in USB mode when locked', () => {
            const result = formatPicoStatus({
                connected: true,
                mode: 'USB',
                usbDrive: 'E:/',
                serialPort: 'COM5',
                serialPortLocked: true
            });
            expect(result.text).toBe('Pico: USB (E:/, COM5) [PORT BUSY]');
            expect(result.title).toContain('Warning: Serial port is in use');
            expect(result.title).toContain('Arduino IDE');
        });

        it('should show PORT BUSY warning in SERIAL mode when locked', () => {
            const result = formatPicoStatus({
                connected: true,
                mode: 'SERIAL',
                serialPort: 'COM5',
                serialPortLocked: true
            });
            expect(result.text).toBe('Pico: Connected (COM5) [PORT BUSY]');
            expect(result.title).toContain('Warning: Serial port is in use');
        });

        it('should not show warning when serialPortLocked is false', () => {
            const result = formatPicoStatus({
                connected: true,
                mode: 'USB',
                usbDrive: 'E:/',
                serialPortLocked: false
            });
            expect(result.text).not.toContain('[PORT BUSY]');
            expect(result.title).not.toContain('Warning');
        });

        it('should not show warning when serialPortLocked is undefined', () => {
            const result = formatPicoStatus({
                connected: true,
                mode: 'USB',
                usbDrive: 'E:/'
            });
            expect(result.text).not.toContain('[PORT BUSY]');
            expect(result.title).not.toContain('Warning');
        });
    });

    describe('edge cases', () => {
        it('should handle lowercase mode', () => {
            const result = formatPicoStatus({ connected: true, mode: 'usb', usbDrive: 'E:/' });
            expect(result.text).toBe('Pico: USB (E:/)');
        });

        it('should handle unknown mode', () => {
            const result = formatPicoStatus({ connected: true, mode: 'UNKNOWN' });
            expect(result.text).toBe('Pico: Connected');
            expect(result.title).toBe('PicoLume device detected');
        });

        it('should handle empty mode', () => {
            const result = formatPicoStatus({ connected: true, mode: '' });
            expect(result.text).toBe('Pico: Connected');
        });
    });
});
