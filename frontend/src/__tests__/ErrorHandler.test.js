import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ErrorHandler } from '../core/ErrorHandler.js';

describe('ErrorHandler', () => {
    let handler;
    let mockToastElement;

    beforeEach(() => {
        handler = new ErrorHandler();
        mockToastElement = {
            textContent: '',
            classList: {
                remove: vi.fn(),
                add: vi.fn()
            },
            offsetWidth: 100 // For reflow trigger
        };
        handler.init(mockToastElement);

        // Mock console.error
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Use fake timers
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('Initialization', () => {
        it('should initialize with toast element', () => {
            expect(handler.toastElement).toBe(mockToastElement);
        });

        it('should start with empty error log', () => {
            expect(handler.getErrorLog()).toEqual([]);
        });
    });

    describe('Error Handling', () => {
        it('should handle string errors', () => {
            const result = handler.handle('Something went wrong');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Error: Something went wrong');
        });

        it('should handle Error objects', () => {
            const error = new Error('Test error');
            const result = handler.handle(error);

            expect(result.message).toBe('Error: Test error');
        });

        it('should handle objects with message property', () => {
            const result = handler.handle({ message: 'Object error' });

            expect(result.message).toBe('Error: Object error');
        });

        it('should handle unknown error types', () => {
            const result = handler.handle(null);

            expect(result.message).toBe('Error: Unknown error occurred');
        });

        it('should use custom prefix', () => {
            const result = handler.handle('Failed', { prefix: 'Save' });

            expect(result.message).toBe('Save: Failed');
        });

        it('should log to console', () => {
            handler.handle('Test error');

            expect(console.error).toHaveBeenCalled();
        });

        it('should add to error log', () => {
            handler.handle('Error 1');
            handler.handle('Error 2');

            const log = handler.getErrorLog();
            expect(log.length).toBe(2);
            expect(log[0].message).toBe('Error: Error 1');
        });

        it('should limit error log to 50 entries', () => {
            for (let i = 0; i < 55; i++) {
                handler.handle(`Error ${i}`);
            }

            expect(handler.getErrorLog().length).toBe(50);
        });

        it('should skip logging when log option is false', () => {
            handler.handle('Silent error', { log: false });

            expect(handler.getErrorLog().length).toBe(0);
        });

        it('should skip toast when toast option is false', () => {
            handler.handle('No toast', { toast: false });

            expect(mockToastElement.textContent).toBe('');
        });
    });

    describe('Toast Notifications', () => {
        it('should show toast with message', () => {
            handler.showToast('Hello World');

            expect(mockToastElement.textContent).toBe('Hello World');
            expect(mockToastElement.classList.add).toHaveBeenCalledWith('show');
        });

        it('should remove show class before adding (animation reset)', () => {
            handler.showToast('Test');

            expect(mockToastElement.classList.remove).toHaveBeenCalledWith('show');
        });

        it('should auto-hide after duration', () => {
            handler.showToast('Test', 'info');

            vi.advanceTimersByTime(2000);

            expect(mockToastElement.classList.remove).toHaveBeenLastCalledWith('show');
        });

        it('should use longer duration for errors', () => {
            handler.showToast('Error', 'error');

            vi.advanceTimersByTime(2000);
            expect(mockToastElement.classList.remove).toHaveBeenCalledTimes(1); // Only initial reset

            vi.advanceTimersByTime(2000);
            expect(mockToastElement.classList.remove).toHaveBeenCalledTimes(2); // Now hidden
        });

        it('should warn if toast element not initialized', () => {
            const uninitHandler = new ErrorHandler();
            uninitHandler.showToast('Test');

            expect(console.warn).toHaveBeenCalledWith('Toast element not initialized');
        });
    });

    describe('Success/Info/Warning', () => {
        it('should show success notification', () => {
            const result = handler.success('Operation completed');

            expect(result.success).toBe(true);
            expect(result.message).toBe('Operation completed');
            expect(mockToastElement.textContent).toBe('Operation completed');
        });

        it('should show info notification', () => {
            handler.info('FYI');

            expect(mockToastElement.textContent).toBe('FYI');
        });

        it('should show warning notification', () => {
            handler.warning('Be careful');

            expect(mockToastElement.textContent).toBe('Be careful');
        });
    });

    describe('Validation Error Handling', () => {
        it('should pass through valid validation', () => {
            const result = handler.handleValidationError({ valid: true });

            expect(result.success).toBe(true);
        });

        it('should handle validation with error property', () => {
            const result = handler.handleValidationError({
                valid: false,
                error: 'Field is required'
            });

            expect(result.success).toBe(false);
            expect(result.message).toContain('Field is required');
        });

        it('should handle validation with errors array', () => {
            const result = handler.handleValidationError({
                valid: false,
                errors: ['Error 1', 'Error 2']
            }, 'Form');

            expect(result.message).toContain('Error 1, Error 2');
        });

        it('should handle validation with custom context', () => {
            const result = handler.handleValidationError({
                valid: false,
                error: 'Invalid'
            }, 'MyForm');

            expect(result.message).toContain('MyForm');
        });
    });

    describe('Error Log Management', () => {
        it('should return copy of error log', () => {
            handler.handle('Error 1');

            const log = handler.getErrorLog();
            log.push({ fake: true });

            expect(handler.getErrorLog().length).toBe(1); // Original unchanged
        });

        it('should clear error log', () => {
            handler.handle('Error 1');
            handler.handle('Error 2');

            handler.clearErrorLog();

            expect(handler.getErrorLog()).toEqual([]);
        });

        it('should include timestamp in log entries', () => {
            const before = Date.now();
            handler.handle('Error');
            const after = Date.now();

            const log = handler.getErrorLog();
            expect(log[0].timestamp).toBeGreaterThanOrEqual(before);
            expect(log[0].timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('Static Methods', () => {
        it('should create success response', () => {
            const response = ErrorHandler.createResponse(true, { id: 1 }, 'Created');

            expect(response.success).toBe(true);
            expect(response.data).toEqual({ id: 1 });
            expect(response.message).toBe('Created');
            expect(response.error).toBeNull();
        });

        it('should create failure response', () => {
            const response = ErrorHandler.createResponse(false, null, '', 'Failed');

            expect(response.success).toBe(false);
            expect(response.error).toBe('Failed');
        });
    });
});
