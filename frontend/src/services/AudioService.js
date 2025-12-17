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
    async ensureInit() {
        if (!this.ctx) {
            this.init();
        }
        if (this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch (error) {
                console.error('Failed to resume audio context:', error);
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
        await this.ensureInit();

        try {
            const arrayBuffer = await file.arrayBuffer();

            // IMPORTANT: Create the blob/dataURL BEFORE decodeAudioData, because
            // decodeAudioData can "detach" the ArrayBuffer making it unusable
            const blob = new Blob([arrayBuffer], { type: file.type });
            const dataURL = await this._blobToDataURL(blob);

            // Now decode the audio (this may detach the original arrayBuffer)
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

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
        await this.ensureInit();

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
