import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineController } from '../controllers/TimelineController.js';
import { StateManager } from '../core/StateManager.js';

describe('TimelineController', () => {
    let stateManager;
    let errorHandler;
    let controller;

    beforeEach(() => {
        // Create a fresh state manager with test state
        stateManager = new StateManager({
            project: {
                duration: 60000,
                tracks: [
                    { id: 't1', type: 'audio', label: 'Audio', clips: [] },
                    {
                        id: 't2',
                        type: 'led',
                        label: 'LED',
                        clips: [
                            { id: 'c1', type: 'solid', startTime: 0, duration: 1000, props: { color: '#ff0000' } },
                            { id: 'c2', type: 'rainbow', startTime: 2000, duration: 2000, props: { speed: 1 } }
                        ]
                    }
                ]
            },
            selection: [],
            clipboard: null,
            isDirty: false,
            ui: {
                zoom: 50,
                snapEnabled: true,
                gridSize: 1000
            },
            playback: {
                currentTime: 0
            }
        });

        // Mock error handler
        errorHandler = {
            success: vi.fn((msg) => ({ success: true, message: msg })),
            handle: vi.fn((msg) => ({ success: false, message: msg })),
            handleValidationError: vi.fn((v) => ({ success: false, message: v.error }))
        };

        // Mock window.dispatchEvent
        vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {});

        controller = new TimelineController(stateManager, errorHandler);
    });

    describe('Track Management', () => {
        it('should add a new LED track', () => {
            const initialCount = stateManager.get('project.tracks').length;

            controller.addTrack('led');

            const tracks = stateManager.get('project.tracks');
            expect(tracks.length).toBe(initialCount + 1);
            expect(tracks[tracks.length - 1].type).toBe('led');
            expect(tracks[tracks.length - 1].label).toBe('LED Track');
            expect(stateManager.get('isDirty')).toBe(true);
            expect(errorHandler.success).toHaveBeenCalledWith('LED track added');
        });

        it('should add a new audio track', () => {
            controller.addTrack('audio');

            const tracks = stateManager.get('project.tracks');
            expect(tracks[tracks.length - 1].type).toBe('audio');
            expect(tracks[tracks.length - 1].label).toBe('Audio Track');
        });

        it('should delete a track', () => {
            controller.deleteTrack('t1');

            const tracks = stateManager.get('project.tracks');
            expect(tracks.find(t => t.id === 't1')).toBeUndefined();
        });

        it('should dispatch event when track is added', () => {
            controller.addTrack('led');

            expect(window.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:timeline-changed' })
            );
        });
    });

    describe('Clip Management', () => {
        it('should add a clip to a track', () => {
            const newClip = {
                id: 'c_new',
                type: 'solid',
                startTime: 5000,
                duration: 1000,
                props: { color: '#00ff00' }
            };

            controller.addClip('t2', newClip);

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.length).toBe(3);
            expect(track.clips.find(c => c.id === 'c_new')).toBeDefined();
        });

        it('should delete a clip', () => {
            controller.deleteClip('c1');

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.find(c => c.id === 'c1')).toBeUndefined();
            expect(track.clips.length).toBe(1);
        });

        it('should remove deleted clip from selection', () => {
            stateManager.set('selection', ['c1', 'c2']);

            controller.deleteClip('c1');

            expect(stateManager.get('selection')).toEqual(['c2']);
        });

        it('should update clip properties', () => {
            controller.updateClip('c1', { startTime: 500, duration: 2000 });

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            const clip = track.clips.find(c => c.id === 'c1');
            expect(clip.startTime).toBe(500);
            expect(clip.duration).toBe(2000);
        });
    });

    describe('Selection', () => {
        it('should select a single clip', () => {
            controller.selectClips('c1');

            expect(stateManager.get('selection')).toEqual(['c1']);
        });

        it('should select multiple clips', () => {
            controller.selectClips(['c1', 'c2']);

            expect(stateManager.get('selection')).toEqual(['c1', 'c2']);
        });

        it('should toggle selection', () => {
            stateManager.set('selection', ['c1']);

            controller.selectClips('c1', true); // Toggle off
            expect(stateManager.get('selection')).toEqual([]);

            controller.selectClips('c1', true); // Toggle on
            expect(stateManager.get('selection')).toEqual(['c1']);
        });

        it('should add to selection', () => {
            stateManager.set('selection', ['c1']);

            controller.selectClips('c2', false, true); // Add

            expect(stateManager.get('selection')).toEqual(['c1', 'c2']);
        });

        it('should clear selection', () => {
            stateManager.set('selection', ['c1', 'c2']);

            controller.clearSelection();

            expect(stateManager.get('selection')).toEqual([]);
        });

        it('should get selected clips with track info', () => {
            stateManager.set('selection', ['c1', 'c2']);

            const selected = controller.getSelectedClips();

            expect(selected.length).toBe(2);
            expect(selected[0].trackId).toBe('t2');
            expect(selected[0].id).toBe('c1');
        });
    });

    describe('Delete Selected', () => {
        it('should delete all selected clips', () => {
            stateManager.set('selection', ['c1', 'c2']);

            controller.deleteSelected();

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.length).toBe(0);
            expect(stateManager.get('selection')).toEqual([]);
        });

        it('should show success message', () => {
            stateManager.set('selection', ['c1']);

            controller.deleteSelected();

            expect(errorHandler.success).toHaveBeenCalledWith('Deleted 1 clip(s)');
        });

        it('should do nothing if no selection', () => {
            controller.deleteSelected();

            expect(errorHandler.success).not.toHaveBeenCalled();
        });
    });

    describe('Copy/Paste', () => {
        it('should copy selected clips to clipboard', () => {
            stateManager.set('selection', ['c1']);

            const result = controller.copySelected();

            expect(result.success).toBe(true);
            expect(stateManager.get('clipboard')).toHaveLength(1);
            expect(stateManager.get('clipboard')[0].type).toBe('solid');
        });

        it('should fail to copy if nothing selected', () => {
            const result = controller.copySelected();

            expect(result.success).toBe(false);
            expect(result.message).toBe('No clips selected');
        });

        it('should copy audio clips with track type metadata', () => {
            // Add an audio clip
            stateManager.update(draft => {
                draft.project.tracks[0].clips.push({
                    id: 'audio1',
                    type: 'audio',
                    startTime: 0,
                    duration: 5000,
                    props: { name: 'test.mp3' }
                });
            });
            stateManager.set('selection', ['audio1']);

            const result = controller.copySelected();

            expect(result.success).toBe(true);
            expect(stateManager.get('clipboard')).toHaveLength(1);
            expect(stateManager.get('clipboard')[0]._trackType).toBe('audio');
        });

        it('should paste audio clips to audio track', () => {
            // Add an audio clip and copy it
            stateManager.update(draft => {
                draft.project.tracks[0].clips.push({
                    id: 'audio1',
                    type: 'audio',
                    startTime: 0,
                    duration: 5000,
                    props: { name: 'test.mp3' }
                });
            });
            stateManager.set('selection', ['audio1']);
            controller.copySelected();

            controller.paste();

            const audioTrack = stateManager.get('project.tracks').find(t => t.type === 'audio');
            expect(audioTrack.clips.length).toBe(2); // Original + pasted
        });

        it('should paste clips at end of track', () => {
            stateManager.set('selection', ['c1']);
            controller.copySelected();

            controller.paste();

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.length).toBe(3); // Original 2 + pasted 1
        });

        it('should fail to paste if clipboard empty', () => {
            const result = controller.paste();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Nothing to paste');
        });
    });

    describe('Duplicate', () => {
        it('should duplicate selected clips', () => {
            stateManager.set('selection', ['c1']);

            const result = controller.duplicateSelected();

            expect(result.success).toBe(true);
            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.length).toBe(3);
        });

        it('should place duplicates after originals', () => {
            stateManager.set('selection', ['c1']);

            controller.duplicateSelected();

            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            const originalClip = track.clips.find(c => c.id === 'c1');
            const duplicatedClip = track.clips[track.clips.length - 1];

            expect(duplicatedClip.startTime).toBe(originalClip.startTime + originalClip.duration);
        });

        it('should fail if nothing selected', () => {
            const result = controller.duplicateSelected();

            expect(result.success).toBe(false);
        });
    });

    describe('Move Clips Between Tracks', () => {
        it('should move LED clip to another LED track', () => {
            // Add another LED track
            stateManager.update(draft => {
                draft.project.tracks.push({
                    id: 't3',
                    type: 'led',
                    label: 'LED 2',
                    clips: []
                });
            });

            const result = controller.moveClipsToTrack(['c1'], 't3');

            expect(result.success).toBe(true);
            expect(result.movedCount).toBe(1);

            // Clip should be in new track
            const newTrack = stateManager.get('project.tracks').find(t => t.id === 't3');
            expect(newTrack.clips.find(c => c.id === 'c1')).toBeDefined();

            // Clip should be removed from old track
            const oldTrack = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(oldTrack.clips.find(c => c.id === 'c1')).toBeUndefined();
        });

        it('should move audio clip to another audio track', () => {
            // Add audio clip and another audio track
            stateManager.update(draft => {
                draft.project.tracks[0].clips.push({
                    id: 'audio1',
                    type: 'audio',
                    startTime: 0,
                    duration: 5000,
                    props: { name: 'test.mp3' }
                });
                draft.project.tracks.push({
                    id: 't3',
                    type: 'audio',
                    label: 'Audio 2',
                    clips: []
                });
            });

            const result = controller.moveClipsToTrack(['audio1'], 't3');

            expect(result.success).toBe(true);
            const newTrack = stateManager.get('project.tracks').find(t => t.id === 't3');
            expect(newTrack.clips.find(c => c.id === 'audio1')).toBeDefined();
        });

        it('should not move clip to incompatible track type', () => {
            // Try to move LED clip to audio track
            const result = controller.moveClipsToTrack(['c1'], 't1');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Clips can only be moved between tracks of the same type');

            // Clip should still be in original track
            const track = stateManager.get('project.tracks').find(t => t.id === 't2');
            expect(track.clips.find(c => c.id === 'c1')).toBeDefined();
        });

        it('should not move clip to same track', () => {
            const result = controller.moveClipsToTrack(['c1'], 't2');

            expect(result.success).toBe(false);
        });

        it('should move multiple clips at once', () => {
            stateManager.update(draft => {
                draft.project.tracks.push({
                    id: 't3',
                    type: 'led',
                    label: 'LED 2',
                    clips: []
                });
            });

            const result = controller.moveClipsToTrack(['c1', 'c2'], 't3');

            expect(result.success).toBe(true);
            expect(result.movedCount).toBe(2);

            const newTrack = stateManager.get('project.tracks').find(t => t.id === 't3');
            expect(newTrack.clips.length).toBe(2);
        });

        it('should fail if target track not found', () => {
            const result = controller.moveClipsToTrack(['c1'], 'nonexistent');

            expect(result.success).toBe(false);
            expect(result.message).toBe('Target track not found');
        });
    });

    describe('Playback Controls', () => {
        it('should set current time', () => {
            controller.setCurrentTime(5000);

            expect(stateManager.get('playback.currentTime')).toBe(5000);
        });

        it('should clamp time to valid range', () => {
            controller.setCurrentTime(-1000);
            expect(stateManager.get('playback.currentTime')).toBe(0);

            controller.setCurrentTime(100000); // Beyond duration
            expect(stateManager.get('playback.currentTime')).toBe(60000);
        });
    });

    describe('UI Controls', () => {
        it('should set zoom level', () => {
            controller.setZoom(100);

            expect(stateManager.get('ui.zoom')).toBe(100);
        });

        it('should clamp zoom to valid range', () => {
            controller.setZoom(5);
            expect(stateManager.get('ui.zoom')).toBe(10);

            controller.setZoom(300);
            expect(stateManager.get('ui.zoom')).toBe(200);
        });

        it('should toggle snap', () => {
            controller.setSnapEnabled(false);
            expect(stateManager.get('ui.snapEnabled')).toBe(false);

            controller.setSnapEnabled(true);
            expect(stateManager.get('ui.snapEnabled')).toBe(true);
        });

        it('should set grid size', () => {
            controller.setGridSize(500);

            expect(stateManager.get('ui.gridSize')).toBe(500);
        });
    });
});
