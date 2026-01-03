/**
 * CueController - Manages cue point operations for live resync
 */

export class CueController {
    constructor(stateManager, errorHandler) {
        this.stateManager = stateManager;
        this.errorHandler = errorHandler;
    }

    /**
     * Get all cues from state
     * @returns {Array} Array of cue objects
     */
    getCues() {
        return this.stateManager.get('project.cues') || [];
    }

    /**
     * Get a specific cue by ID
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @returns {Object|null} Cue object or null
     */
    getCue(cueId) {
        const cues = this.getCues();
        return cues.find(c => c.id === cueId) || null;
    }

    /**
     * Set a cue to a specific time
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @param {number} timeMs - Time in milliseconds
     * @returns {boolean} Success
     */
    setCue(cueId, timeMs) {
        const duration = this.stateManager.get('project.duration') || 60000;

        // Validate cue ID
        if (!['A', 'B', 'C', 'D'].includes(cueId)) {
            this.errorHandler.handle(`Invalid cue ID: ${cueId}`, { prefix: 'Set Cue' });
            return false;
        }

        // Prevent setting cue beyond duration
        if (timeMs > duration) {
            this.errorHandler.handle(`Cue time cannot exceed show duration (${this._formatTime(duration)})`, { prefix: 'Set Cue', log: false });
            return false;
        }

        // Ensure time is non-negative
        if (timeMs < 0) {
            timeMs = 0;
        }

        this.stateManager.update(draft => {
            if (!draft.project.cues) {
                draft.project.cues = [
                    { id: 'A', timeMs: null, enabled: false },
                    { id: 'B', timeMs: null, enabled: false },
                    { id: 'C', timeMs: null, enabled: false },
                    { id: 'D', timeMs: null, enabled: false }
                ];
            }

            const cue = draft.project.cues.find(c => c.id === cueId);
            if (cue) {
                cue.timeMs = Math.round(timeMs);
                cue.enabled = true;
            }
            draft.isDirty = true;
        });

        window.dispatchEvent(new CustomEvent('app:cues-changed'));
        this.errorHandler.success(`Cue ${cueId} set at ${this._formatTime(timeMs)}`);
        return true;
    }

    /**
     * Set a cue at the current playhead position
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @returns {boolean} Success
     */
    setCueAtPlayhead(cueId) {
        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        return this.setCue(cueId, currentTime);
    }

    /**
     * Clear a cue (disable and remove time)
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @returns {boolean} Success
     */
    clearCue(cueId) {
        if (!['A', 'B', 'C', 'D'].includes(cueId)) {
            return false;
        }

        this.stateManager.update(draft => {
            if (!draft.project.cues) return;

            const cue = draft.project.cues.find(c => c.id === cueId);
            if (cue) {
                cue.timeMs = null;
                cue.enabled = false;
            }
            draft.isDirty = true;
        });

        // Deselect if this cue was selected
        if (this.stateManager.get('ui.selectedCue') === cueId) {
            this.selectCue(null);
        }

        window.dispatchEvent(new CustomEvent('app:cues-changed'));
        this.errorHandler.success(`Cue ${cueId} cleared`);
        return true;
    }

    /**
     * Toggle cue enabled state
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @returns {boolean} Success
     */
    toggleCue(cueId) {
        const cue = this.getCue(cueId);
        if (!cue) return false;

        // Can only toggle if cue has a time set
        if (cue.timeMs === null) {
            this.errorHandler.handle(`Cue ${cueId} has no time set`, { prefix: 'Toggle Cue', log: false });
            return false;
        }

        this.stateManager.update(draft => {
            const draftCue = draft.project.cues.find(c => c.id === cueId);
            if (draftCue) {
                draftCue.enabled = !draftCue.enabled;
            }
            draft.isDirty = true;
        });

        window.dispatchEvent(new CustomEvent('app:cues-changed'));
        return true;
    }

    /**
     * Select a cue for inspector editing
     * @param {string|null} cueId - Cue ID or null to deselect
     */
    selectCue(cueId) {
        // Clear clip selection when selecting a cue
        if (cueId !== null) {
            this.stateManager.set('selection', [], { skipHistory: true });
        }

        this.stateManager.set('ui.selectedCue', cueId, { skipHistory: true });
        window.dispatchEvent(new CustomEvent('app:cue-selected', { detail: { cueId } }));
    }

    /**
     * Get the currently selected cue ID
     * @returns {string|null} Selected cue ID or null
     */
    getSelectedCue() {
        return this.stateManager.get('ui.selectedCue');
    }

    /**
     * Jump playhead to a cue
     * @param {string} cueId - Cue ID ('A', 'B', 'C', 'D')
     * @returns {boolean} Success
     */
    jumpToCue(cueId) {
        const cue = this.getCue(cueId);
        if (!cue || cue.timeMs === null || !cue.enabled) {
            return false;
        }

        this.stateManager.set('playback.currentTime', cue.timeMs, { skipHistory: true });
        window.dispatchEvent(new CustomEvent('app:time-changed'));
        return true;
    }

    /**
     * Update cue time (for dragging)
     * @param {string} cueId - Cue ID
     * @param {number} newTimeMs - New time in milliseconds
     * @returns {boolean} Success
     */
    updateCueTime(cueId, newTimeMs) {
        const duration = this.stateManager.get('project.duration') || 60000;

        // Clamp to valid range
        newTimeMs = Math.max(0, Math.min(newTimeMs, duration));

        this.stateManager.update(draft => {
            const cue = draft.project.cues?.find(c => c.id === cueId);
            if (cue && cue.enabled) {
                cue.timeMs = Math.round(newTimeMs);
            }
            draft.isDirty = true;
        });

        window.dispatchEvent(new CustomEvent('app:cues-changed'));
        return true;
    }

    /**
     * Format time in MM:SS.mmm format
     * @private
     */
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const millis = ms % 1000;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }
}
