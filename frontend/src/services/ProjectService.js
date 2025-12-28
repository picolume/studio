/**
 * ProjectService - Handles project save/load/new operations
 *
 * Responsibilities:
 * - Save projects to disk
 * - Load projects from disk
 * - Create new projects
 * - Export binary files
 * - Upload to devices
 */

import { createInitialState } from '../core/StateManager.js';
import { getBackend } from '../core/Backend.js';
import { showConfirm, findProfileOverlaps, formatProfileOverlaps } from '../utils.js';

export class ProjectService {
    constructor(stateManager, audioService, backend = getBackend()) {
        this.stateManager = stateManager;
        this.audioService = audioService;
        this.backend = backend;
    }

    /**
     * Save project to specified path
     * @param {string} path - File path (optional, will prompt if not provided)
     * @param {boolean} forceSaveAs - Force "Save As" dialog
     * @param {boolean} silent - Suppress success notification
     * @returns {Promise<{success: boolean, message: string, path?: string}>}
     */
    async save(path = null, forceSaveAs = false, silent = false) {
        try {
            if (!this.backend?.capabilities?.fileIO) {
                return { success: false, message: 'Save is not available in the web demo' };
            }

            let targetPath = path || this.stateManager.get('filePath');

            // Request path if needed
            if (forceSaveAs || !targetPath) {
                targetPath = await this.backend.requestSavePath();
                if (!targetPath) {
                    return { success: false, message: 'Save cancelled' };
                }
            }

            // Prepare project data
            const projectData = this._prepareProjectForSave();

            // Call backend to save
            const result = await this.backend.saveProjectToPath(
                targetPath,
                JSON.stringify(projectData.project),
                projectData.audio
            );

            if (result === "Saved") {
                // Update state
                this.stateManager.update(draft => {
                    draft.filePath = targetPath;
                    draft.isDirty = false;
                }, { skipHistory: true });

                return {
                    success: true,
                    message: silent ? '' : 'Project Saved',
                    path: targetPath
                };
            } else {
                return { success: false, message: result };
            }
        } catch (error) {
            return {
                success: false,
                message: `Save Error: ${error.message || error}`
            };
        }
    }

    /**
     * Load project from disk
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async load() {
        try {
            if (!this.backend?.capabilities?.fileIO) {
                return { success: false, message: 'Load is not available in the web demo' };
            }

            const result = await this.backend.loadProject();

            // Check for cancellation or error
            if (!result || result.error === "Cancelled") {
                return { success: false, message: 'Load cancelled' };
            }

            if (result.error) {
                return { success: false, message: result.error };
            }

            // Parse the project JSON string from the response
            const project = JSON.parse(result.projectJson);

            // Validate project data
            if (!project) {
                return { success: false, message: 'Invalid project file' };
            }

            // Ensure project has version field (migration)
            if (!project.version) {
                project.version = '1.0.0';
            }

            // Replace state with loaded project FIRST
            const newState = createInitialState();
            newState.project = project;
            newState.filePath = result.filePath;
            newState.isDirty = false;

            this.stateManager.replaceState(newState, true);

            // Load audio assets AFTER state is replaced (so they don't get wiped)
            if (result.audioFiles) {
                for (const bufferId of Object.keys(result.audioFiles)) {
                    try {
                        await this.audioService.loadAudioFromDataURL(
                            bufferId,
                            result.audioFiles[bufferId]
                        );
                    } catch (err) {
                        console.error(`Failed to load audio buffer ${bufferId}:`, err);
                    }
                }
            }

            return { success: true, message: 'Project Loaded' };
        } catch (error) {
            return {
                success: false,
                message: `Load Error: ${error.message || error}`
            };
        }
    }

    /**
     * Create new project
     * @param {boolean} confirm - Whether to confirm if there are unsaved changes
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async createNew(confirm = true) {
        // Check for unsaved changes
        if (confirm && this.stateManager.get('isDirty')) {
            const shouldContinue = await showConfirm(
                'You have unsaved changes. Create new project anyway?'
            );
            if (!shouldContinue) {
                return { success: false, message: 'New project cancelled' };
            }
        }

        // Stop playback if playing
        const isPlaying = this.stateManager.get('playback.isPlaying');
        if (isPlaying) {
            window.dispatchEvent(new CustomEvent('app:stop-playback'));
        }

        // Clear audio assets
        this.audioService.clearAll();

        // Reset to initial state
        const newState = createInitialState();
        this.stateManager.replaceState(newState, true);

        return { success: true, message: 'New Project Created' };
    }

    /**
     * Export project as binary
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async exportBinary() {
        try {
            if (!this.backend?.capabilities?.exportBinary) {
                return { success: false, message: 'Export is not available in the web demo' };
            }

            const project = this.stateManager.get('project');

            // Check for profile overlaps before export
            const profiles = project?.settings?.profiles || [];
            const conflicts = findProfileOverlaps(profiles);
            if (conflicts.length > 0) {
                const message = formatProfileOverlaps(conflicts, profiles);
                return {
                    success: false,
                    message: `Cannot export: Hardware profile conflicts detected.\n\n${message}\n\nPlease fix overlapping prop assignments in Settings before exporting.`
                };
            }

            const result = await this.backend.saveBinary(
                JSON.stringify(project)
            );

            if (result === "OK") {
                return { success: true, message: 'Binary Exported' };
            } else {
                return { success: false, message: result };
            }
        } catch (error) {
            return {
                success: false,
                message: `Export Error: ${error.message || error}`
            };
        }
    }

    /**
     * Upload project to PicoLume device
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async uploadToDevice() {
        try {
            if (!this.backend?.capabilities?.upload) {
                return { success: false, message: 'Upload is not available in the web demo' };
            }

            const project = this.stateManager.get('project');

            // Check for profile overlaps before upload
            const profiles = project?.settings?.profiles || [];
            const conflicts = findProfileOverlaps(profiles);
            if (conflicts.length > 0) {
                const message = formatProfileOverlaps(conflicts, profiles);
                return {
                    success: false,
                    message: `Cannot upload: Hardware profile conflicts detected.\n\n${message}\n\nPlease fix overlapping prop assignments in Settings before uploading.`
                };
            }

            const result = await this.backend.uploadToPico(
                JSON.stringify(project)
            );

            if (result.startsWith("Success")) {
                return { success: true, message: result };
            } else {
                return { success: false, message: result };
            }
        } catch (error) {
            return {
                success: false,
                message: `Upload Error: ${error.message || error}`
            };
        }
    }

    /**
     * Check if there are unsaved changes
     * @returns {boolean}
     */
    hasUnsavedChanges() {
        return this.stateManager.get('isDirty') === true;
    }

    /**
     * Get current project name
     * @returns {string}
     */
    getProjectName() {
        return this.stateManager.get('project.name') || 'Untitled';
    }

    /**
     * Get current file path
     * @returns {string|null}
     */
    getFilePath() {
        return this.stateManager.get('filePath');
    }

    // ==================== Private Methods ====================

    /**
     * Prepare project data for saving
     * @private
     */
    _prepareProjectForSave() {
        const project = JSON.parse(
            JSON.stringify(this.stateManager.get('project'))
        );
        const audio = {};

        // Extract audio library references
        project.tracks.forEach(track => {
            if (track.type === 'audio') {
                track.clips.forEach(clip => {
                    if (clip.bufferId) {
                        const audioData = this.audioService.getAudioDataURL(clip.bufferId);
                        if (audioData) {
                            audio[clip.bufferId] = audioData;
                            clip.props.audioSrcPath = `audio/${clip.bufferId}.bin`;
                            delete clip.props.sourceData;
                        }
                    }
                });
            }
        });

        return { project, audio };
    }
}
