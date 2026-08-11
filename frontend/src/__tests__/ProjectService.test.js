import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../services/ProjectService.js';
import { StateManager, createInitialState } from '../core/StateManager.js';

function createStateManager() {
    const initial = createInitialState();
    initial.project.name = 'Demo';
    initial.project.settings.profiles = [];
    initial.project.tracks = [];
    initial.isDirty = true;
    return new StateManager(initial);
}

function createBackend(overrides = {}) {
    return {
        capabilities: {
            fileIO: true,
            exportBinary: true,
            upload: true
        },
        requestSavePath: vi.fn(),
        saveProjectToPath: vi.fn(),
        loadProject: vi.fn(),
        saveBinary: vi.fn(),
        uploadToPico: vi.fn(),
        ...overrides
    };
}

describe('ProjectService', () => {
    let stateManager;
    let audioService;
    let backend;
    let service;

    beforeEach(() => {
        stateManager = createStateManager();
        audioService = {
            getAudioDataURL: vi.fn(),
            loadAudioFromDataURL: vi.fn(),
            clearAll: vi.fn()
        };
        backend = createBackend();
        service = new ProjectService(stateManager, audioService, backend);
    });

    it('saves using structured backend results and clears dirty state', async () => {
        stateManager.update(draft => {
            draft.project.tracks = [
                {
                    type: 'audio',
                    clips: [
                        {
                            id: 'clip1',
                            bufferId: 'buffer1',
                            props: { sourceData: 'inline-audio' }
                        }
                    ]
                }
            ];
        }, { skipHistory: true });
        audioService.getAudioDataURL.mockReturnValue('data:audio/wav;base64,UklGRg==');
        backend.saveProjectToPath.mockResolvedValue({ status: 'ok', code: 'saved', message: 'Saved' });

        const result = await service.save('C:/shows/demo.lum');

        expect(result).toEqual({
            success: true,
            message: 'Project Saved',
            path: 'C:/shows/demo.lum'
        });
        expect(stateManager.get('filePath')).toBe('C:/shows/demo.lum');
        expect(stateManager.get('isDirty')).toBe(false);
        expect(backend.saveProjectToPath).toHaveBeenCalledWith(
            'C:/shows/demo.lum',
            expect.any(String),
            { buffer1: 'data:audio/wav;base64,UklGRg==' },
            { allowPrompt: true }
        );
    });

    it('returns the backend message when save fails', async () => {
        backend.saveProjectToPath.mockResolvedValue({
            status: 'error',
            code: 'invalid_path',
            message: 'Error: Invalid path - path must be absolute'
        });

        const result = await service.save('demo.lum');

        expect(result).toEqual({
            success: false,
            message: 'Error: Invalid path - path must be absolute'
        });
        expect(stateManager.get('isDirty')).toBe(true);
    });

    it('treats save warnings as success and surfaces the warning message', async () => {
        backend.saveProjectToPath.mockResolvedValue({
            status: 'warning',
            code: 'saved_with_audio_errors',
            message: 'Saved, but 1 audio file(s) could not be written: decode error for buffer9'
        });

        const result = await service.save('C:/shows/demo.lum');

        expect(result.success).toBe(true);
        expect(result.warning).toBe(true);
        expect(result.message).toContain('audio');
        expect(stateManager.get('isDirty')).toBe(false);
        expect(stateManager.get('filePath')).toBe('C:/shows/demo.lum');
    });

    it('loads using status-based responses and restores audio assets', async () => {
        const loadedProject = {
            ...createInitialState().project,
            name: 'Loaded Project'
        };
        backend.loadProject.mockResolvedValue({
            status: 'ok',
            code: 'loaded',
            message: 'Loaded',
            projectJson: JSON.stringify(loadedProject),
            filePath: 'loaded.lum',
            audioFiles: {
                buffer1: 'data:audio/wav;base64,UklGRg=='
            }
        });

        const result = await service.load();

        expect(result).toEqual({ success: true, message: 'Project Loaded' });
        expect(stateManager.get('project.name')).toBe('Loaded Project');
        expect(stateManager.get('filePath')).toBe('loaded.lum');
        expect(stateManager.get('isDirty')).toBe(false);
        expect(audioService.loadAudioFromDataURL).toHaveBeenCalledWith(
            'buffer1',
            'data:audio/wav;base64,UklGRg=='
        );
    });

    it('migrates legacy projects on load', async () => {
        const legacyProject = {
            name: 'Legacy',
            duration: 60000,
            settings: {
                profiles: [{ id: 'p1', name: 'Old', assignedIds: '1-10', ledCount: 60 }]
            },
            propGroups: [],
            tracks: []
        };
        backend.loadProject.mockResolvedValue({
            status: 'ok',
            code: 'loaded',
            message: 'Loaded',
            projectJson: JSON.stringify(legacyProject),
            filePath: 'legacy.lum',
            audioFiles: {}
        });

        const result = await service.load();

        expect(result).toEqual({ success: true, message: 'Project Loaded' });
        const project = stateManager.get('project');
        expect(project.version).toBe('1.0.0');
        expect(project.cues).toHaveLength(4);
        expect(project.settings.palettes.length).toBeGreaterThan(0);
        expect(project.settings.patch).toEqual({});
        expect(project.settings.fieldLayout).toEqual({});

        // Legacy profile gains firmware fields with defaults
        const profile = project.settings.profiles[0];
        expect(profile.ledType).toBe(0);
        expect(profile.brightnessCap).toBe(255);
        expect(profile.ledCount).toBe(60);
    });

    it('rejects structurally invalid project files', async () => {
        backend.loadProject.mockResolvedValue({
            status: 'ok',
            code: 'loaded',
            message: 'Loaded',
            projectJson: JSON.stringify({ name: 'Broken' }), // no tracks array
            filePath: 'broken.lum',
            audioFiles: {}
        });

        const result = await service.load();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid project file');
        expect(stateManager.get('project.name')).not.toBe('Broken');
        expect(audioService.loadAudioFromDataURL).not.toHaveBeenCalled();
    });

    it('treats cancelled loads as a non-success without parsing project data', async () => {
        backend.loadProject.mockResolvedValue({
            status: 'cancelled',
            code: 'cancelled',
            message: 'Load cancelled'
        });

        const result = await service.load();

        expect(result).toEqual({ success: false, message: 'Load cancelled' });
        expect(audioService.loadAudioFromDataURL).not.toHaveBeenCalled();
    });

    it('exports binary when the backend returns an ok status', async () => {
        backend.saveBinary.mockResolvedValue({ status: 'ok', code: 'saved', message: 'OK' });

        const result = await service.exportBinary();

        expect(result).toEqual({ success: true, message: 'Binary Exported' });
    });

    it('treats upload warnings as successful user-visible outcomes', async () => {
        backend.uploadToPico.mockResolvedValue({
            status: 'warning',
            code: 'manual_eject_required',
            message: 'Success! Uploaded 42 events to E:/. Manual eject required.'
        });

        const result = await service.uploadToDevice();

        expect(result).toEqual({
            success: true,
            message: 'Success! Uploaded 42 events to E:/. Manual eject required.'
        });
    });
});
