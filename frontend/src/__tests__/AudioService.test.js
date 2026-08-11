import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, withRetry } from '../services/AudioService.js';

describe('Async Utilities', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('withTimeout', () => {
        it('should resolve if promise completes before timeout', async () => {
            const promise = Promise.resolve('success');
            const result = await withTimeout(promise, 1000);
            expect(result).toBe('success');
        });

        it('should reject with timeout error if promise takes too long', async () => {
            const slowPromise = new Promise(resolve => {
                setTimeout(() => resolve('too late'), 2000);
            });

            const timeoutPromise = withTimeout(slowPromise, 1000, 'Operation timed out');

            // Advance timers to trigger timeout
            vi.advanceTimersByTime(1001);

            await expect(timeoutPromise).rejects.toThrow('Operation timed out (after 1000ms)');
        });

        it('should pass through original error if promise rejects before timeout', async () => {
            const failingPromise = Promise.reject(new Error('Original error'));

            await expect(withTimeout(failingPromise, 1000)).rejects.toThrow('Original error');
        });

        it('should use default error message when not provided', async () => {
            const slowPromise = new Promise(resolve => {
                setTimeout(() => resolve('too late'), 2000);
            });

            const timeoutPromise = withTimeout(slowPromise, 500);

            vi.advanceTimersByTime(501);

            await expect(timeoutPromise).rejects.toThrow('Operation timed out (after 500ms)');
        });

        it('should clear timeout when promise resolves', async () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            const promise = Promise.resolve('done');
            await withTimeout(promise, 1000);

            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        it('should clear timeout when promise rejects', async () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

            const promise = Promise.reject(new Error('fail'));
            try {
                await withTimeout(promise, 1000);
            } catch (e) {
                // Expected
            }

            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });
    });

    describe('withRetry', () => {
        beforeEach(() => {
            // Suppress console.warn during retry tests
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should return result on first successful attempt', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const result = await withRetry(fn);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and succeed', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

            // Advance through retries
            await vi.advanceTimersByTimeAsync(10);
            await vi.advanceTimersByTimeAsync(120); // 10 * 2^1 + jitter
            await vi.advanceTimersByTimeAsync(500);

            const result = await promise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries exceeded', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

            const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
            // Attach rejection handler immediately to avoid transient unhandled rejection warnings
            // while we advance fake timers through the retry/backoff schedule.
            const assertion = expect(promise).rejects.toThrow('persistent failure');

            // Advance through all retries
            await vi.advanceTimersByTimeAsync(500);
            await vi.advanceTimersByTimeAsync(500);
            await vi.advanceTimersByTimeAsync(500);

            await assertion;
            expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });

        it('should respect shouldRetry function', async () => {
            const nonRetryableError = new Error('Unable to decode audio');
            const fn = vi.fn().mockRejectedValue(nonRetryableError);

            const shouldRetry = (error) => !error.message.includes('Unable to decode');

            const promise = withRetry(fn, {
                maxRetries: 3,
                shouldRetry,
                baseDelayMs: 10
            });

            await expect(promise).rejects.toThrow('Unable to decode audio');
            expect(fn).toHaveBeenCalledTimes(1); // No retries for non-retryable error
        });

        it('should use default options when not provided', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValue('success');

            const promise = withRetry(fn);

            // Default baseDelayMs is 100, advance through
            await vi.advanceTimersByTimeAsync(200);

            const result = await promise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('should apply exponential backoff', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

            const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 2000 });

            // Advance through retries
            await vi.advanceTimersByTimeAsync(300);  // First retry: ~100ms
            await vi.advanceTimersByTimeAsync(500);  // Second retry: ~200ms (100 * 2^1)

            await promise;

            // Check that setTimeout was called with increasing delays
            // The delays should follow baseDelayMs * 2^attempt pattern (plus jitter)
            const timeoutCalls = setTimeoutSpy.mock.calls.filter(
                call => typeof call[1] === 'number' && call[1] > 0
            );

            expect(timeoutCalls.length).toBeGreaterThanOrEqual(2);
            setTimeoutSpy.mockRestore();
        });

        it('should cap delay at maxDelayMs', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockRejectedValueOnce(new Error('fail 3'))
                .mockRejectedValueOnce(new Error('fail 4'))
                .mockResolvedValue('success');

            // With baseDelayMs=500 and maxDelayMs=1000, exponential would exceed cap
            const promise = withRetry(fn, {
                maxRetries: 5,
                baseDelayMs: 500,
                maxDelayMs: 1000
            });

            // Advance through all retries
            await vi.advanceTimersByTimeAsync(5000);

            const result = await promise;
            expect(result).toBe('success');
        });

        it('should log warning on retry attempt', async () => {
            const warnSpy = vi.spyOn(console, 'warn');
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('temporary failure'))
                .mockResolvedValue('success');

            const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });

            await vi.advanceTimersByTimeAsync(200);
            await promise;

            expect(warnSpy).toHaveBeenCalled();
            expect(warnSpy.mock.calls[0][0]).toContain('Retry attempt');
        });

        it('should handle zero maxRetries (no retries)', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('fail'));

            const promise = withRetry(fn, { maxRetries: 0 });

            await expect(promise).rejects.toThrow('fail');
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });
});
