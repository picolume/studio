/**
 * TimelineController - Manages timeline operations (clips, selection, etc.)
 */

import { CONFIG, getSnappedTime } from '../utils.js';
import { validateClip } from '../core/validators.js';

export class TimelineController {
    constructor(stateManager, errorHandler) {
        this.stateManager = stateManager;
        this.errorHandler = errorHandler;
    }

    _isClipCompatibleWithTrack(trackType, clipType) {
        if (!trackType || !clipType) return false;
        if (trackType === 'audio') return clipType === 'audio';
        if (trackType === 'led') return clipType !== 'audio';
        return false;
    }

    /**
     * Add a new track
     * @param {string} type - Track type ('led' or 'audio')
     */
    addTrack(type) {
        const newTrack = {
            id: `t${Date.now()}`,
            type,
            label: type === 'audio' ? 'Audio Track' : 'LED Track',
            clips: [],
            groupId: type === 'led' ? 'g_all' : null
        };

        this.stateManager.update(draft => {
            draft.project.tracks.push(newTrack);
            draft.isDirty = true;
        });

        this.errorHandler.success(`${type.toUpperCase()} track added`);
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
    }

    /**
     * Delete a track
     * @param {string} trackId - Track ID
     */
    deleteTrack(trackId) {
        this.stateManager.update(draft => {
            const index = draft.project.tracks.findIndex(t => t.id === trackId);
            if (index !== -1) {
                draft.project.tracks.splice(index, 1);
                draft.isDirty = true;
            }
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
    }

    /**
     * Add a clip to a track
     * @param {string} trackId - Track ID
     * @param {Object} clipData - Clip data
     */
    addClip(trackId, clipData) {
        // Validate clip
        const validation = validateClip(clipData);
        if (!validation.valid) {
            return this.errorHandler.handleValidationError(validation, 'Add Clip');
        }

        const track = this.stateManager.get('project.tracks')?.find(t => t.id === trackId);
        if (!track) {
            return this.errorHandler.handle('Track not found', { prefix: 'Add Clip' });
        }
        if (!this._isClipCompatibleWithTrack(track.type, clipData.type)) {
            return this.errorHandler.handle(
                track.type === 'audio'
                    ? 'LED clips can only be placed on LED tracks'
                    : 'Audio clips can only be placed on audio tracks',
                { prefix: 'Add Clip', log: false }
            );
        }

        this.stateManager.update(draft => {
            const draftTrack = draft.project.tracks.find(t => t.id === trackId);
            if (!draftTrack) return;
            draftTrack.clips.push(clipData);
            draft.isDirty = true;
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        return { success: true };
    }

    /**
     * Delete a clip
     * @param {string} clipId - Clip ID
     */
    deleteClip(clipId) {
        this.stateManager.update(draft => {
            draft.project.tracks.forEach(track => {
                const index = track.clips.findIndex(c => c.id === clipId);
                if (index !== -1) {
                    track.clips.splice(index, 1);
                    draft.isDirty = true;
                }
            });

            // Remove from selection
            draft.selection = draft.selection.filter(id => id !== clipId);
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
    }

    /**
     * Delete selected clips
     */
    deleteSelected() {
        const selection = this.stateManager.get('selection');
        if (selection.length === 0) return;

        this.stateManager.update(draft => {
            draft.project.tracks.forEach(track => {
                track.clips = track.clips.filter(c => !selection.includes(c.id));
            });
            draft.selection = [];
            draft.isDirty = true;
        });

        this.errorHandler.success(`Deleted ${selection.length} clip(s)`);
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
    }

    /**
     * Update clip properties
     * @param {string} clipId - Clip ID
     * @param {Object} updates - Properties to update
     */
    updateClip(clipId, updates) {
        this.stateManager.update(draft => {
            draft.project.tracks.forEach(track => {
                const clip = track.clips.find(c => c.id === clipId);
                if (clip) {
                    Object.assign(clip, updates);
                    draft.isDirty = true;
                }
            });
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
    }

    /**
     * Move clips to a different track
     * @param {string[]} clipIds - Array of clip IDs to move
     * @param {string} targetTrackId - Target track ID
     * @returns {{success: boolean, message?: string, movedCount?: number}}
     */
    moveClipsToTrack(clipIds, targetTrackId) {
        const tracks = this.stateManager.get('project.tracks');
        const targetTrack = tracks.find(t => t.id === targetTrackId);

        if (!targetTrack) {
            return { success: false, message: 'Target track not found' };
        }

        // Find clips and their source tracks
        const clipsToMove = [];
        let incompatibleCount = 0;
        for (const clipId of clipIds) {
            for (const track of tracks) {
                const clip = track.clips.find(c => c.id === clipId);
                if (clip) {
                    // Only allow moving between same track types
                    if (track.type !== targetTrack.type) {
                        incompatibleCount++;
                        break; // Found it, but incompatible
                    }
                    if (track.id !== targetTrackId) {
                        clipsToMove.push({ clip, sourceTrackId: track.id });
                    }
                    break;
                }
            }
        }

        if (clipsToMove.length === 0) {
            if (incompatibleCount > 0) {
                return { success: false, message: 'Clips can only be moved between tracks of the same type' };
            }
            return { success: false, message: 'No clips to move' };
        }

        this.stateManager.update(draft => {
            clipsToMove.forEach(({ clip, sourceTrackId }) => {
                // Remove from source track
                const sourceTrack = draft.project.tracks.find(t => t.id === sourceTrackId);
                if (sourceTrack) {
                    sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
                }

                // Add to target track
                const draftTargetTrack = draft.project.tracks.find(t => t.id === targetTrackId);
                if (draftTargetTrack) {
                    // Clone the clip to avoid reference issues
                    draftTargetTrack.clips.push(JSON.parse(JSON.stringify(clip)));
                }
            });
            draft.isDirty = true;
        });

        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        return { success: true, movedCount: clipsToMove.length };
    }

    /**
     * Select clip(s)
     * @param {string|string[]} clipIds - Clip ID or array of IDs
     * @param {boolean} toggle - Toggle selection
     * @param {boolean} add - Add to selection
     */
    selectClips(clipIds, toggle = false, add = false) {
        const ids = Array.isArray(clipIds) ? clipIds : [clipIds];

        this.stateManager.update(draft => {
            if (toggle) {
                // Toggle each ID
                ids.forEach(id => {
                    const index = draft.selection.indexOf(id);
                    if (index !== -1) {
                        draft.selection.splice(index, 1);
                    } else {
                        draft.selection.push(id);
                    }
                });
            } else if (add) {
                // Add to selection
                ids.forEach(id => {
                    if (!draft.selection.includes(id)) {
                        draft.selection.push(id);
                    }
                });
            } else {
                // Replace selection
                draft.selection = [...ids];
            }
        }, { skipHistory: true });

        window.dispatchEvent(new CustomEvent('app:selection-changed'));
    }

    /**
     * Clear selection
     */
    clearSelection() {
        this.stateManager.update(draft => {
            draft.selection = [];
        }, { skipHistory: true });

        window.dispatchEvent(new CustomEvent('app:selection-changed'));
    }

    /**
     * Get selected clips
     */
    getSelectedClips() {
        const selection = this.stateManager.get('selection');
        const clips = [];

        const tracks = this.stateManager.get('project.tracks');
        tracks.forEach(track => {
            track.clips.forEach(clip => {
                if (selection.includes(clip.id)) {
                    clips.push({ ...clip, trackId: track.id });
                }
            });
        });

        return clips;
    }

    /**
     * Copy selected clips to clipboard
     */
    copySelected() {
        const selectedClips = this.getSelectedClips();

        if (selectedClips.length === 0) {
            return { success: false, message: 'No clips selected' };
        }

        // Get track types for each clip
        const tracks = this.stateManager.get('project.tracks');

        // Sort by start time
        selectedClips.sort((a, b) => a.startTime - b.startTime);

        this.stateManager.update(draft => {
            draft.clipboard = selectedClips.map(c => {
                const track = tracks.find(t => t.id === c.trackId);
                const { trackId, ...clip } = c;
                return { ...clip, _trackType: track?.type || 'led' };
            });
        }, { skipHistory: true });

        this.errorHandler.success(`Copied ${selectedClips.length} clip(s)`);
        return { success: true };
    }

    /**
     * Paste clips from clipboard
     */
    paste() {
        const clipboard = this.stateManager.get('clipboard');

        if (!clipboard || clipboard.length === 0) {
            return { success: false, message: 'Nothing to paste' };
        }

        const tracks = this.stateManager.get('project.tracks');

        // Group clips by track type
        const ledClips = clipboard.filter(c => c._trackType !== 'audio');
        const audioClips = clipboard.filter(c => c._trackType === 'audio');

        // Find target tracks
        const ledTrack = tracks.find(t => t.type === 'led');
        const audioTrack = tracks.find(t => t.type === 'audio');

        if (ledClips.length > 0 && !ledTrack) {
            return this.errorHandler.handle('No LED track available for paste');
        }

        if (audioClips.length > 0 && !audioTrack) {
            return this.errorHandler.handle('No audio track available for paste');
        }

        const snapEnabled = this.stateManager.get('ui.snapEnabled');
        const gridSize = this.stateManager.get('ui.gridSize');

        // Helper to find paste offset for a track
        const getPasteOffset = (track) => {
            let offset = 0;
            if (track && track.clips.length > 0) {
                track.clips.forEach(c => {
                    const end = c.startTime + c.duration;
                    if (end > offset) offset = end;
                });
            }
            if (snapEnabled) {
                offset = Math.round(offset / gridSize) * gridSize;
            }
            return offset;
        };

        const ledOffset = ledTrack ? getPasteOffset(ledTrack) : 0;
        const audioOffset = audioTrack ? getPasteOffset(audioTrack) : 0;

        // Calculate relative positions
        const firstClipStart = clipboard[0].startTime;

        this.stateManager.update(draft => {
            // Paste LED clips
            if (ledClips.length > 0 && ledTrack) {
                const track = draft.project.tracks.find(t => t.id === ledTrack.id);
                if (track) {
                    ledClips.forEach(clip => {
                        const { _trackType, ...clipData } = clip;
                        const newClip = JSON.parse(JSON.stringify(clipData));
                        newClip.id = `c${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        newClip.startTime = ledOffset + (clip.startTime - firstClipStart);
                        track.clips.push(newClip);
                    });
                }
            }

            // Paste audio clips
            if (audioClips.length > 0 && audioTrack) {
                const track = draft.project.tracks.find(t => t.id === audioTrack.id);
                if (track) {
                    audioClips.forEach(clip => {
                        const { _trackType, ...clipData } = clip;
                        const newClip = JSON.parse(JSON.stringify(clipData));
                        newClip.id = `c${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        newClip.startTime = audioOffset + (clip.startTime - firstClipStart);
                        track.clips.push(newClip);
                    });
                }
            }

            draft.isDirty = true;
        });

        this.errorHandler.success(`Pasted ${clipboard.length} clip(s)`);
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        return { success: true };
    }

    /**
     * Duplicate selected clips
     */
    duplicateSelected() {
        const selectedClips = this.getSelectedClips();

        if (selectedClips.length === 0) {
            return { success: false, message: 'No clips selected' };
        }

        this.stateManager.update(draft => {
            selectedClips.forEach(({ trackId, ...clip }) => {
                const track = draft.project.tracks.find(t => t.id === trackId);
                if (track) {
                    const newClip = JSON.parse(JSON.stringify(clip));
                    newClip.id = `c${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    newClip.startTime += newClip.duration; // Place after original
                    track.clips.push(newClip);
                }
            });
            draft.isDirty = true;
        });

        this.errorHandler.success(`Duplicated ${selectedClips.length} clip(s)`);
        window.dispatchEvent(new CustomEvent('app:timeline-changed'));
        return { success: true };
    }

    /**
     * Set current playback time
     * @param {number} time - Time in milliseconds
     */
    setCurrentTime(time) {
        const duration = this.stateManager.get('project.duration');
        const clampedTime = Math.max(0, Math.min(duration, time));

        this.stateManager.update(draft => {
            draft.playback.currentTime = clampedTime;
        }, { skipHistory: true, skipNotify: true });

        window.dispatchEvent(new CustomEvent('app:time-changed'));
    }

    /**
     * Set zoom level
     * @param {number} zoom - Zoom level (10-200)
     */
    setZoom(zoom) {
        const clampedZoom = Math.max(10, Math.min(200, zoom));

        this.stateManager.update(draft => {
            draft.ui.zoom = clampedZoom;
        }, { skipHistory: true, skipNotify: true });

        window.dispatchEvent(new CustomEvent('app:zoom-changed'));
    }

    /**
     * Toggle snap to grid
     * @param {boolean} enabled - Whether snap is enabled
     */
    setSnapEnabled(enabled) {
        this.stateManager.update(draft => {
            draft.ui.snapEnabled = enabled;
        }, { skipHistory: true, skipNotify: true });
    }

    /**
     * Set grid size
     * @param {number} gridSize - Grid size in milliseconds
     */
    setGridSize(gridSize) {
        this.stateManager.update(draft => {
            draft.ui.gridSize = gridSize;
        }, { skipHistory: true, skipNotify: true });

        window.dispatchEvent(new CustomEvent('app:grid-changed'));
    }
}
