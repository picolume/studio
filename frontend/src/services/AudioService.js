/**
 * AudioService - Manages audio context, buffers, and playback
 *
 * Responsibilities:
 * - Initialize audio context
 * - Load and decode audio files
 * - Manage audio buffers
 * - Control playback
 * - Handle volume
 */

// ==================== Async Utilities ====================

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [errorMessage] - Custom error message
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${errorMessage} (after ${timeoutMs}ms)`));
        }, timeoutMs);

        promise
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * Retry an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.baseDelayMs=100] - Base delay between retries
 * @param {number} [options.maxDelayMs=2000] - Maximum delay between retries
 * @param {Function} [options.shouldRetry] - Function to determine if error is retryable
 * @returns {Promise}
 */
async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 100,
        maxDelayMs = 2000,
        shouldRetry = () => true
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }

            // Exponential backoff with jitter
            const delay = Math.min(
                baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
                maxDelayMs
            );
            console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

// Export utilities for testing
export { withTimeout, withRetry };

// Timeout constants (in milliseconds)
const TIMEOUT = {
    CONTEXT_RESUME: 5000,      // Audio context resume
    FILE_READ: 30000,          // Reading file to array buffer
    AUDIO_DECODE: 60000,       // Decoding audio data
    FETCH: 30000,              // Fetch operations
    BLOB_READ: 30000           // Blob to data URL conversion
};

export class AudioService {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.ctx = null;
        this.masterGain = null;
        this.activeSources = [];
    }

    /**
     * Initialize audio context
     */
    init() {
        if (this.ctx) return;

        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);

            const volume = this.stateManager.get('audio.masterVolume') || 1.0;
            this.masterGain.gain.value = volume;

            // Update state
            this.stateManager.update(draft => {
                draft.audio.ctx = this.ctx;
                draft.audio.masterGain = this.masterGain;
            }, { skipHistory: true, skipNotify: true });

        } catch (error) {
            console.error('Audio init failed:', error);
            throw new Error(`Failed to initialize audio: ${error.message}`);
        }
    }

    /**
     * Ensure audio context is initialized
     * @param {Object} [options]
     * @param {boolean} [options.resume=true] - Whether to attempt to resume a suspended AudioContext
     */
    async ensureInit(options = {}) {
        const { resume = true } = options;
        if (!this.ctx) {
            this.init();
        }
        if (resume && this.ctx.state === 'suspended') {
            try {
                await withTimeout(
                    this.ctx.resume(),
                    TIMEOUT.CONTEXT_RESUME,
                    'Audio context resume timed out'
                );
            } catch (error) {
                // In browsers, AudioContext resume may be blocked unless called from a user gesture.
                // Decoding audio does not require a resumed context, so only warn here.
                console.warn('Audio context resume failed (will remain suspended):', error);
            }
        }
    }

    /**
     * Load audio from file
     * @param {File} file - Audio file
     * @param {string} bufferId - Unique buffer ID
     * @returns {Promise<AudioBuffer>}
     */
    async loadAudioFile(file, bufferId) {
        // Decoding is allowed even while the AudioContext is suspended; don't force resume here.
        await this.ensureInit({ resume: false });

        try {
            // Read file with timeout
            const arrayBuffer = await withTimeout(
                file.arrayBuffer(),
                TIMEOUT.FILE_READ,
                `Reading file "${file.name}" timed out`
            );

            // IMPORTANT: Create the blob/dataURL BEFORE decodeAudioData, because
            // decodeAudioData can "detach" the ArrayBuffer making it unusable
            const blob = new Blob([arrayBuffer], { type: file.type });
            const dataURL = await this._blobToDataURL(blob);

            // Decode audio with retry (some formats may need multiple attempts)
            const audioBuffer = await withRetry(
                () => withTimeout(
                    this.ctx.decodeAudioData(arrayBuffer.slice(0)), // slice() creates a copy since original may be detached
                    TIMEOUT.AUDIO_DECODE,
                    `Decoding audio "${file.name}" timed out`
                ),
                {
                    maxRetries: 2,
                    baseDelayMs: 200,
                    shouldRetry: (error) => {
                        // Don't retry on format errors, only on transient failures
                        return !error.message.includes('Unable to decode') &&
                               !error.message.includes('invalid');
                    }
                }
            );

            // Store both the buffer and data URL in a single update
            this.stateManager.update(draft => {
                draft.assets[bufferId] = audioBuffer;
                draft.audioLibrary[bufferId] = dataURL;
            }, { skipHistory: true });

            return audioBuffer;
        } catch (error) {
            console.error('Audio decode failed:', error);
            throw new Error(`Failed to load audio: ${error.message}`);
        }
    }

    /**
     * Load audio from data URL (for project loading)
     * @param {string} bufferId - Buffer ID
     * @param {string} dataURL - Data URL string
     * @returns {Promise<AudioBuffer>}
     */
    async loadAudioFromDataURL(bufferId, dataURL) {
        // Decoding is allowed even while the AudioContext is suspended; don't force resume here.
        await this.ensureInit({ resume: false });

        try {
            // Fetch with timeout and retry for transient network issues
            const response = await withRetry(
                () => withTimeout(
                    fetch(dataURL),
                    TIMEOUT.FETCH,
                    'Fetching audio data timed out'
                ),
                {
                    maxRetries: 3,
                    baseDelayMs: 100,
                    shouldRetry: (error) => {
                        // Retry on network errors, not on invalid data URLs
                        return error.message.includes('timed out') ||
                               error.message.includes('network') ||
                               error.message.includes('Network');
                    }
                }
            );

            // Read response body with timeout
            const arrayBuffer = await withTimeout(
                response.arrayBuffer(),
                TIMEOUT.FILE_READ,
                'Reading audio data timed out'
            );

            // Decode with retry
            const audioBuffer = await withRetry(
                () => withTimeout(
                    this.ctx.decodeAudioData(arrayBuffer.slice(0)), // slice() creates copy
                    TIMEOUT.AUDIO_DECODE,
                    'Decoding audio timed out'
                ),
                {
                    maxRetries: 2,
                    baseDelayMs: 200,
                    shouldRetry: (error) => {
                        return !error.message.includes('Unable to decode') &&
                               !error.message.includes('invalid');
                    }
                }
            );

            // Store both buffer and data URL
            this.stateManager.update(draft => {
                draft.assets[bufferId] = audioBuffer;
                draft.audioLibrary[bufferId] = dataURL;
            }, { skipHistory: true });

            return audioBuffer;
        } catch (error) {
            console.error('Audio decode from data URL failed:', error);
            throw new Error(`Failed to load audio from data: ${error.message}`);
        }
    }

    /**
     * Get audio data URL for saving
     * @param {string} bufferId - Buffer ID
     * @returns {string|null}
     */
    getAudioDataURL(bufferId) {
        return this.stateManager.get(`audioLibrary.${bufferId}`);
    }

    /**
     * Get audio buffer
     * @param {string} bufferId - Buffer ID
     * @returns {AudioBuffer|null}
     */
    getBuffer(bufferId) {
        return this.stateManager.get(`assets.${bufferId}`);
    }

    /**
     * Remove audio buffer
     * @param {string} bufferId - Buffer ID
     */
    removeBuffer(bufferId) {
        this.stateManager.update(draft => {
            delete draft.assets[bufferId];
            delete draft.audioLibrary[bufferId];
        }, { skipHistory: true });
    }

    /**
     * Clear all audio buffers
     */
    clearAll() {
        this.stopAll();
        this.stateManager.update(draft => {
            draft.assets = {};
            draft.audioLibrary = {};
        }, { skipHistory: true });
    }

    /**
     * Start playback from current time
     */
    async startPlayback() {
        await this.ensureInit();
        // Prevent stacking sources if startPlayback is called repeatedly.
        this.stopAll();

        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        const playheadTime = currentTime / 1000;
        const audioStartTime = this.ctx.currentTime - playheadTime;

        // Update state
        this.stateManager.update(draft => {
            draft.playback.isPlaying = true;
        }, { skipHistory: true, skipNotify: true });

        // Get all audio tracks
        const tracks = this.stateManager.get('project.tracks') || [];
        const audioTracks = tracks.filter(t => t.type === 'audio');

        // Start playing clips
        audioTracks.forEach(track => {
            track.clips.forEach(clip => {
                if (!clip.bufferId) return;

                const buffer = this.getBuffer(clip.bufferId);
                if (!buffer) return;

                const clipStart = clip.startTime / 1000;
                const clipEnd = clipStart + (clip.duration / 1000);

                // Only play clips that haven't finished
                if (clipEnd > playheadTime) {
                    try {
                        const source = this.ctx.createBufferSource();
                        source.buffer = buffer;
                        const gain = this.ctx.createGain();
                        const clipVolume = clip.props?.volume ?? 1.0;
                        gain.gain.value = Math.max(0, Math.min(1, clipVolume));
                        source.connect(gain);
                        gain.connect(this.masterGain);

                        const durationSec = clip.duration / 1000;

                        if (playheadTime < clipStart) {
                            // Clip starts in the future
                            source.start(
                                this.ctx.currentTime + (clipStart - playheadTime),
                                0,
                                durationSec
                            );
                        } else {
                            // Clip already started, resume from current position
                            const offset = playheadTime - clipStart;
                            source.start(this.ctx.currentTime, offset, durationSec - offset);
                        }

                        const entry = { clipId: clip.id, source, gain };
                        source.onended = () => {
                            this.activeSources = this.activeSources.filter(x => x.source !== source);
                        };
                        this.activeSources.push(entry);
                    } catch (error) {
                        console.error('Failed to start audio source:', error);
                    }
                }
            });
        });

        // Store audio start time
        this.stateManager.update(draft => {
            draft.playback.startTime = audioStartTime;
        }, { skipHistory: true, skipNotify: true });
    }

    /**
     * Stop all playback
     */
    stopPlayback() {
        this.stopAll();

        this.stateManager.update(draft => {
            draft.playback.isPlaying = false;
        }, { skipHistory: true, skipNotify: true });
    }

    /**
     * Stop all active audio sources
     */
    stopAll() {
        this.activeSources.forEach(({ source }) => {
            try {
                source.stop();
            } catch (error) {
                // Source may already be stopped
            }
        });
        this.activeSources = [];

        this.stateManager.update(draft => {
            draft.activeAudioSources = [];
        }, { skipHistory: true, skipNotify: true });
    }

    /**
     * Set volume for a specific audio clip (affects currently playing sources).
     * @param {string} clipId - Clip ID
     * @param {number} volume - Volume level (0.0 to 1.0)
     */
    setClipVolume(clipId, volume) {
        if (!clipId) return;
        if (!this.ctx) return;
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.activeSources
            .filter(x => x.clipId === clipId)
            .forEach(({ gain }) => {
                try {
                    gain.gain.setValueAtTime(clampedVolume, this.ctx.currentTime);
                } catch (e) {
                    // Ignore if node is disconnected/stopped
                }
            });
    }

    /**
     * Set master volume
     * @param {number} volume - Volume level (0.0 to 1.0)
     */
    setVolume(volume) {
        const clampedVolume = Math.max(0, Math.min(1, volume));

        if (this.masterGain) {
            this.masterGain.gain.value = clampedVolume;
        }

        this.stateManager.update(draft => {
            draft.audio.masterVolume = clampedVolume;
        }, { skipHistory: true, skipNotify: true });
    }

    /**
     * Get master volume
     * @returns {number}
     */
    getVolume() {
        return this.stateManager.get('audio.masterVolume') || 1.0;
    }

    /**
     * Check if audio is currently playing
     * @returns {boolean}
     */
    isPlaying() {
        return this.stateManager.get('playback.isPlaying') || false;
    }

    // ==================== Private Methods ====================

    /**
     * Convert Blob to Data URL with timeout
     * @private
     */
    _blobToDataURL(blob) {
        const readPromise = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read blob'));
            reader.onabort = () => reject(new Error('Blob read was aborted'));
            reader.readAsDataURL(blob);
        });

        return withTimeout(
            readPromise,
            TIMEOUT.BLOB_READ,
            'Converting audio to data URL timed out'
        );
    }
}
