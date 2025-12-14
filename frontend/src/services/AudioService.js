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
     */
    ensureInit() {
        if (!this.ctx) {
            this.init();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * Load audio from file
     * @param {File} file - Audio file
     * @param {string} bufferId - Unique buffer ID
     * @returns {Promise<AudioBuffer>}
     */
    async loadAudioFile(file, bufferId) {
        this.ensureInit();

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            // Store buffer
            this.stateManager.update(draft => {
                draft.assets[bufferId] = audioBuffer;
            }, { skipHistory: true });

            // Convert to data URL for saving
            const blob = new Blob([arrayBuffer], { type: file.type });
            const dataURL = await this._blobToDataURL(blob);

            this.stateManager.update(draft => {
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
        this.ensureInit();

        try {
            const response = await fetch(dataURL);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

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
    startPlayback() {
        this.ensureInit();

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
                        source.connect(this.masterGain);

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
                            source.start(0, offset, durationSec - offset);
                        }

                        this.activeSources.push(source);
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
        this.activeSources.forEach(source => {
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
     * Convert Blob to Data URL
     * @private
     */
    _blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}
