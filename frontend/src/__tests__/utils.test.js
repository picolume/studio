import { describe, it, expect } from 'vitest';
import {
    hexToRgb,
    rgbToHex,
    parseIdString,
    validateIdString,
    formatTime,
    parseTime,
    clamp,
    pseudoRandom,
    formatPicoStatus,
    findProfileOverlaps,
    formatProfileOverlaps
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

describe('Profile Overlap Detection', () => {
    describe('findProfileOverlaps', () => {
        it('should return empty array when no profiles', () => {
            expect(findProfileOverlaps(null)).toEqual([]);
            expect(findProfileOverlaps([])).toEqual([]);
            expect(findProfileOverlaps(undefined)).toEqual([]);
        });

        it('should return empty array when no overlaps', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1-10' },
                { id: 'p2', assignedIds: '11-20' }
            ];
            expect(findProfileOverlaps(profiles)).toEqual([]);
        });

        it('should detect single overlap', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1-10' },
                { id: 'p2', assignedIds: '10-20' }
            ];
            const conflicts = findProfileOverlaps(profiles);
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].propId).toBe(10);
            expect(conflicts[0].profiles).toContain('p1');
            expect(conflicts[0].profiles).toContain('p2');
        });

        it('should detect multiple overlaps', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1-15' },
                { id: 'p2', assignedIds: '10-20' }
            ];
            const conflicts = findProfileOverlaps(profiles);
            expect(conflicts).toHaveLength(6); // 10, 11, 12, 13, 14, 15
            const conflictIds = conflicts.map(c => c.propId).sort((a, b) => a - b);
            expect(conflictIds).toEqual([10, 11, 12, 13, 14, 15]);
        });

        it('should detect overlaps across three profiles', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1-10' },
                { id: 'p2', assignedIds: '5-15' },
                { id: 'p3', assignedIds: '8-12' }
            ];
            const conflicts = findProfileOverlaps(profiles);
            // IDs 5-10 conflict between p1 and p2
            // IDs 8-10 also conflict with p3
            // IDs 11-12 conflict between p2 and p3
            expect(conflicts.length).toBeGreaterThan(0);

            // Check that prop 8 has multiple profiles in conflict
            const conflict8 = conflicts.find(c => c.propId === 8);
            expect(conflict8).toBeDefined();
            expect(conflict8.profiles.length).toBeGreaterThanOrEqual(2);
        });

        it('should handle profiles with no assignedIds', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1-10' },
                { id: 'p2' }, // no assignedIds
                { id: 'p3', assignedIds: '5-8' }
            ];
            const conflicts = findProfileOverlaps(profiles);
            expect(conflicts).toHaveLength(4); // 5, 6, 7, 8
        });

        it('should handle comma-separated IDs with overlap', () => {
            const profiles = [
                { id: 'p1', assignedIds: '1,3,5,7' },
                { id: 'p2', assignedIds: '5,6,7,8' }
            ];
            const conflicts = findProfileOverlaps(profiles);
            expect(conflicts).toHaveLength(2); // 5 and 7
            const conflictIds = conflicts.map(c => c.propId).sort((a, b) => a - b);
            expect(conflictIds).toEqual([5, 7]);
        });
    });

    describe('formatProfileOverlaps', () => {
        it('should return empty string for no conflicts', () => {
            expect(formatProfileOverlaps([], [])).toBe('');
            expect(formatProfileOverlaps(null, [])).toBe('');
        });

        it('should format single conflict with profile names', () => {
            const conflicts = [{ propId: 5, profiles: ['p1', 'p2'] }];
            const profiles = [
                { id: 'p1', name: 'Profile A' },
                { id: 'p2', name: 'Profile B' }
            ];
            const result = formatProfileOverlaps(conflicts, profiles);
            expect(result).toContain('Props 5');
            expect(result).toContain('Profile A');
            expect(result).toContain('Profile B');
        });

        it('should format range of conflicts compactly', () => {
            const conflicts = [
                { propId: 1, profiles: ['p1', 'p2'] },
                { propId: 2, profiles: ['p1', 'p2'] },
                { propId: 3, profiles: ['p1', 'p2'] },
                { propId: 5, profiles: ['p1', 'p2'] }
            ];
            const profiles = [
                { id: 'p1', name: 'A' },
                { id: 'p2', name: 'B' }
            ];
            const result = formatProfileOverlaps(conflicts, profiles);
            expect(result).toContain('1-3');
            expect(result).toContain('5');
        });

        it('should fall back to profile ID when name missing', () => {
            const conflicts = [{ propId: 10, profiles: ['p1', 'p2'] }];
            const profiles = [
                { id: 'p1', name: 'Named Profile' },
                { id: 'p2' } // no name
            ];
            const result = formatProfileOverlaps(conflicts, profiles);
            expect(result).toContain('Named Profile');
            expect(result).toContain('p2');
        });

        it('should group conflicts by profile pairs', () => {
            const conflicts = [
                { propId: 1, profiles: ['p1', 'p2'] },
                { propId: 2, profiles: ['p1', 'p2'] },
                { propId: 10, profiles: ['p2', 'p3'] }
            ];
            const profiles = [
                { id: 'p1', name: 'A' },
                { id: 'p2', name: 'B' },
                { id: 'p3', name: 'C' }
            ];
            const result = formatProfileOverlaps(conflicts, profiles);
            // Should have two lines: one for A/B overlap, one for B/C overlap
            const lines = result.split('\n');
            expect(lines).toHaveLength(2);
        });
    });
});

describe('ID String Validation', () => {
    describe('validateIdString', () => {
        it('should accept empty input', () => {
            expect(validateIdString('')).toEqual({ valid: true, message: '' });
            expect(validateIdString(null)).toEqual({ valid: true, message: '' });
            expect(validateIdString('   ')).toEqual({ valid: true, message: '' });
        });

        it('should accept valid single IDs', () => {
            expect(validateIdString('1')).toEqual({ valid: true, message: '' });
            expect(validateIdString('224')).toEqual({ valid: true, message: '' });
            expect(validateIdString('100')).toEqual({ valid: true, message: '' });
        });

        it('should accept valid ranges', () => {
            expect(validateIdString('1-10')).toEqual({ valid: true, message: '' });
            expect(validateIdString('1-224')).toEqual({ valid: true, message: '' });
        });

        it('should accept valid comma-separated lists', () => {
            expect(validateIdString('1, 3, 5')).toEqual({ valid: true, message: '' });
            expect(validateIdString('1-10, 15, 20-25')).toEqual({ valid: true, message: '' });
        });

        it('should reject letters', () => {
            const result = validateIdString('abc');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('Invalid characters');
            expect(result.message).toContain('a');
        });

        it('should reject special characters', () => {
            const result = validateIdString('1@2#3');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('Invalid characters');
        });

        it('should reject mixed valid/invalid', () => {
            const result = validateIdString('1-10, hello, 15');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('Invalid characters');
        });

        it('should reject IDs below 1', () => {
            const result = validateIdString('0');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('1 or greater');
        });

        it('should reject IDs above 224', () => {
            const result = validateIdString('225');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('224 or less');
        });

        it('should reject ranges that exceed bounds', () => {
            const result = validateIdString('220-230');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('224 or less');
        });
    });
});
