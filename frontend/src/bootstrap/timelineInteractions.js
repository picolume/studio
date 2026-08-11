import { CONFIG, getSnappedTime } from '../utils.js';
import { APP_EVENTS, emitAppEvent, subscribeAppEvent } from '../core/AppEventHub.js';

export function setupTimelineInteractions(options = {}) {
    const {
        appEvents,
        stateManager,
        audioService,
        timelineController,
        cueController,
        errorHandler,
        els,
        timeline
    } = options;

    const getAllClipElements = () => {
        return Array.from(document.querySelectorAll('.clip[data-clip-id]'));
    };

    const findAdjacentClip = (currentClipId, direction) => {
        const clips = getAllClipElements();
        const currentIndex = clips.findIndex(el => el.dataset.clipId === currentClipId);
        if (currentIndex === -1) return null;

        if (direction === 'next' && currentIndex < clips.length - 1) {
            return clips[currentIndex + 1].dataset.clipId;
        }
        if (direction === 'prev' && currentIndex > 0) {
            return clips[currentIndex - 1].dataset.clipId;
        }
        return null;
    };

    const findClipInAdjacentTrack = (currentClipId, direction) => {
        const tracks = stateManager.get('project.tracks') || [];
        let currentTrackIndex = -1;
        let currentClip = null;

        for (let i = 0; i < tracks.length; i++) {
            const clip = tracks[i].clips.find(c => c.id === currentClipId);
            if (clip) {
                currentTrackIndex = i;
                currentClip = clip;
                break;
            }
        }

        if (currentTrackIndex === -1 || !currentClip) return null;

        const targetTrackIndex = direction === 'up' ? currentTrackIndex - 1 : currentTrackIndex + 1;
        if (targetTrackIndex < 0 || targetTrackIndex >= tracks.length) return null;

        const targetTrack = tracks[targetTrackIndex];
        if (!targetTrack.clips || targetTrack.clips.length === 0) return null;

        let closest = targetTrack.clips[0];
        let closestDist = Math.abs(closest.startTime - currentClip.startTime);

        for (const clip of targetTrack.clips) {
            const dist = Math.abs(clip.startTime - currentClip.startTime);
            if (dist < closestDist) {
                closest = clip;
                closestDist = dist;
            }
        }

        return closest.id;
    };

    const updateClipboardUI = () => {
        const selection = stateManager.get('selection');
        const clipboard = stateManager.get('clipboard');

        if (els.btnCopy) els.btnCopy.disabled = selection.length === 0;
        if (els.btnPaste) els.btnPaste.disabled = !clipboard || clipboard.length === 0;
        if (els.btnDuplicate) els.btnDuplicate.disabled = selection.length === 0;
    };

    const nudgeSelectedClips = (deltaMs, focusClipId = null) => {
        const selection = stateManager.get('selection') || [];
        if (selection.length === 0) return;

        const gridSize = stateManager.get('ui.gridSize') || 1000;
        const snapEnabled = stateManager.get('ui.snapEnabled');
        const nudgeAmount = snapEnabled ? Math.sign(deltaMs) * gridSize : deltaMs;

        stateManager.update(draft => {
            const tracks = draft.project.tracks || [];
            for (const track of tracks) {
                for (const clip of track.clips || []) {
                    if (selection.includes(clip.id)) {
                        clip.startTime = Math.max(0, clip.startTime + nudgeAmount);
                    }
                }
            }
            draft.isDirty = true;
        });

        emitAppEvent(appEvents, APP_EVENTS.TIMELINE_CHANGED);

        if (focusClipId) {
            requestAnimationFrame(() => {
                const el = document.getElementById(`clip-${focusClipId}`);
                if (el) el.focus();
            });
        }
    };

    const resizeSelectedClips = (deltaMs, focusClipId = null) => {
        const selection = stateManager.get('selection') || [];
        if (selection.length === 0) return;

        const gridSize = stateManager.get('ui.gridSize') || 1000;
        const snapEnabled = stateManager.get('ui.snapEnabled');
        const resizeAmount = snapEnabled ? Math.sign(deltaMs) * gridSize : deltaMs;
        const minDuration = 100;

        stateManager.update(draft => {
            const tracks = draft.project.tracks || [];
            for (const track of tracks) {
                for (const clip of track.clips || []) {
                    if (selection.includes(clip.id)) {
                        clip.duration = Math.max(minDuration, clip.duration + resizeAmount);
                    }
                }
            }
            draft.isDirty = true;
        });

        emitAppEvent(appEvents, APP_EVENTS.TIMELINE_CHANGED);

        if (focusClipId) {
            requestAnimationFrame(() => {
                const el = document.getElementById(`clip-${focusClipId}`);
                if (el) el.focus();
            });
        }
    };

    subscribeAppEvent(appEvents, APP_EVENTS.CLIP_KEYDOWN, (e) => {
        const { event, clipId } = e.detail;
        const key = event.key;

        if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (event.ctrlKey || event.metaKey) {
                timelineController.selectClips(clipId, true);
            } else {
                timelineController.selectClips(clipId);
            }
            return;
        }

        if (key === 'Tab') {
            event.preventDefault();
            const nextClipId = findAdjacentClip(clipId, event.shiftKey ? 'prev' : 'next');
            if (nextClipId) {
                const nextEl = document.getElementById(`clip-${nextClipId}`);
                if (nextEl) {
                    nextEl.focus();
                    timelineController.selectClips(nextClipId);
                }
            }
            return;
        }

        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
            event.preventDefault();

            if (event.shiftKey) {
                if (key === 'ArrowLeft') {
                    resizeSelectedClips(-250, clipId);
                } else if (key === 'ArrowRight') {
                    resizeSelectedClips(250, clipId);
                }
                return;
            }

            if (event.altKey || (!event.ctrlKey && !event.metaKey)) {
                const selection = stateManager.get('selection') || [];

                if (key === 'ArrowLeft') {
                    if (selection.includes(clipId)) {
                        nudgeSelectedClips(-250, clipId);
                    }
                    return;
                }
                if (key === 'ArrowRight') {
                    if (selection.includes(clipId)) {
                        nudgeSelectedClips(250, clipId);
                    }
                    return;
                }

                if (key === 'ArrowUp' || key === 'ArrowDown') {
                    const targetClipId = findClipInAdjacentTrack(clipId, key === 'ArrowUp' ? 'up' : 'down');
                    if (targetClipId) {
                        const targetEl = document.getElementById(`clip-${targetClipId}`);
                        if (targetEl) {
                            targetEl.focus();
                            timelineController.selectClips(targetClipId);
                        }
                    }
                    return;
                }
            }
        }

        if (key === 'Delete' || key === 'Backspace') {
            event.preventDefault();
            timelineController.deleteSelected();
            const clips = getAllClipElements();
            if (clips.length > 0) {
                clips[0].focus();
            }
            return;
        }

        if (key === 'Escape') {
            event.preventDefault();
            timelineController.clearSelection();
            if (cueController.getSelectedCue()) {
                cueController.selectCue(null);
            }
            document.activeElement.blur();
        }
    });

    if (els.btnCopy) {
        els.btnCopy.onclick = () => {
            timelineController.copySelected();
            updateClipboardUI();
        };
    }

    if (els.btnPaste) {
        els.btnPaste.onclick = () => {
            timelineController.paste();
            timeline.buildTimeline();
        };
    }

    if (els.btnDuplicate) {
        els.btnDuplicate.onclick = () => {
            timelineController.duplicateSelected();
            timeline.buildTimeline();
        };
    }

    subscribeAppEvent(appEvents, APP_EVENTS.SELECTION_CHANGED, updateClipboardUI);

    subscribeAppEvent(appEvents, APP_EVENTS.LOAD_AUDIO, async (e) => {
        const { file, trackId } = e.detail;

        try {
            const bufferId = `audio_${Date.now()}`;
            const buffer = await audioService.loadAudioFile(file, bufferId);

            const clip = {
                id: `c${Date.now()}`,
                type: 'audio',
                startTime: stateManager.get('playback.currentTime') || 0,
                duration: buffer.duration * 1000,
                bufferId,
                props: { name: file.name }
            };

            const result = timelineController.addClip(trackId, clip);
            if (!result?.success) return;
            errorHandler.success(`Loaded: ${file.name}`);
        } catch (error) {
            errorHandler.handle(error, { prefix: 'Audio Load Failed' });
        }
    });

    subscribeAppEvent(appEvents, APP_EVENTS.DROP_CLIP, (e) => {
        const { event, trackId } = e.detail;

        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            const track = stateManager.get('project.tracks')?.find(t => t.id === trackId);

            if (file.type.startsWith('audio/')) {
                if (track?.type === 'audio') {
                    emitAppEvent(appEvents, APP_EVENTS.LOAD_AUDIO, { file, trackId });
                } else {
                    errorHandler.warning('Audio files can only be dropped on audio tracks');
                }
                return;
            }
        }

        const type = event.dataTransfer.getData('type') || event.dataTransfer.getData('text/plain');
        if (!type) return;

        const scrollRect = els.timelineScroll?.getBoundingClientRect();
        const scrollLeft = els.timelineScroll?.scrollLeft || 0;
        const x = event.clientX - (scrollRect?.left || 0) + scrollLeft;
        const zoom = stateManager.get('ui.zoom');
        let startTime = Math.max(0, (x / zoom) * 1000);

        const snapEnabled = stateManager.get('ui.snapEnabled');
        const gridSize = stateManager.get('ui.gridSize');
        startTime = getSnappedTime(startTime, { snapEnabled, gridSize });

        const track = stateManager.get('project.tracks')?.find(t => t.id === trackId);
        const newClipDuration = CONFIG.defaultDuration;

        if (track && track.clips.length > 0) {
            const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime);

            let foundOverlap = true;
            let iterations = 0;
            const maxIterations = sortedClips.length + 1;

            while (foundOverlap && iterations < maxIterations) {
                foundOverlap = false;
                iterations++;
                const newClipEnd = startTime + newClipDuration;

                for (const existingClip of sortedClips) {
                    const existingStart = existingClip.startTime;
                    const existingEnd = existingStart + existingClip.duration;
                    const overlaps = (startTime < existingEnd && newClipEnd > existingStart);

                    if (overlaps) {
                        startTime = existingEnd;
                        if (snapEnabled) {
                            startTime = getSnappedTime(startTime, { snapEnabled, gridSize });
                        }
                        foundOverlap = true;
                        break;
                    }
                }
            }
        }

        const clip = createDefaultClip(type, startTime);
        const result = timelineController.addClip(trackId, clip);
        if (!result?.success) return;

        timeline.selectClip(clip.id);
    });

    const handleScrub = (e) => {
        if (e.target.closest('.clip') || e.target.closest('.clip-handle')) return;

        const clickedTimelineArea =
            e.target.closest('.track-header') ||
            e.target.classList.contains('track-lane') ||
            e.target === els.timelineContent ||
            e.target === els.timelineScroll ||
            e.target === els.tracksContainer;

        if (clickedTimelineArea) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }

            stateManager.set('selection', [], { skipHistory: true });
            emitAppEvent(appEvents, APP_EVENTS.SELECTION_CHANGED);

            if (cueController.getSelectedCue()) {
                cueController.selectCue(null);
            }
        }

        const clickedRuler = e.target.closest('.ruler');
        if (!clickedRuler) return;

        const scrollRect = els.timelineScroll.getBoundingClientRect();
        const startX = e.clientX - scrollRect.left + els.timelineScroll.scrollLeft;
        const zoom = stateManager.get('ui.zoom');
        const duration = stateManager.get('project.duration');

        const updateTime = (xPos) => {
            const t = (xPos / zoom) * 1000;
            timelineController.setCurrentTime(Math.max(0, Math.min(duration, t)));
        };

        updateTime(startX);

        const move = (ev) => {
            updateTime(ev.clientX - scrollRect.left + els.timelineScroll.scrollLeft);
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    if (els.timelineScroll) {
        els.timelineScroll.addEventListener('mousedown', handleScrub);
    }

    subscribeAppEvent(appEvents, APP_EVENTS.CLIP_MOUSEDOWN, (e) => {
        const { event, clipId } = e.detail;
        const startX = event.clientX;
        const zoom = stateManager.get('ui.zoom');
        const snapEnabled = stateManager.get('ui.snapEnabled');
        const gridSize = stateManager.get('ui.gridSize');

        const selection = stateManager.get('selection') || [];
        let nextSelection = selection;

        if (event.ctrlKey || event.metaKey) {
            nextSelection = selection.includes(clipId)
                ? selection.filter(id => id !== clipId)
                : [...selection, clipId];
        } else if (!selection.includes(clipId)) {
            nextSelection = [clipId];
        }

        stateManager.set('selection', nextSelection, { skipHistory: true });
        emitAppEvent(appEvents, APP_EVENTS.SELECTION_CHANGED);

        const isResizeRight = event.target.classList.contains('right');
        const isResizeLeft = event.target.classList.contains('left');
        const isMove = !isResizeRight && !isResizeLeft;

        const clipInfos = {};
        const state = stateManager.state;
        const clipsToManipulate = isMove ? nextSelection : [clipId];

        for (const id of clipsToManipulate) {
            const el = document.getElementById(`clip-${id}`);
            if (!el) continue;

            for (const track of (state.project?.tracks || [])) {
                const clip = (track.clips || []).find(c => c.id === id);
                if (clip) {
                    clipInfos[id] = {
                        el,
                        trackId: track.id,
                        trackType: track.type,
                        clipType: clip.type,
                        origLeft: parseFloat(el.style.left),
                        origWidth: parseFloat(el.style.width),
                        origStart: clip.startTime,
                        origDur: clip.duration
                    };
                    break;
                }
            }
        }

        const currentValues = {};
        for (const id in clipInfos) {
            currentValues[id] = {
                startTime: clipInfos[id].origStart,
                duration: clipInfos[id].origDur
            };
        }

        let hasMoved = false;
        let targetTrackId = null;
        const sourceTrackId = clipInfos[clipId]?.trackId || null;
        const sourceTrackType = clipInfos[clipId]?.trackType || null;

        document.body.style.cursor = isResizeLeft || isResizeRight ? 'col-resize' : 'grabbing';

        const moveHandler = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 3 && !hasMoved) {
                hasMoved = true;
            }
            if (!hasMoved) return;

            if (isResizeRight) {
                const info = clipInfos[clipId];
                if (!info) return;

                let newWidth = info.origWidth + dx;
                const minWidth = (CONFIG.minClipDuration / 1000) * zoom;
                if (newWidth < minWidth) newWidth = minWidth;

                let newDur = (newWidth / zoom) * 1000;
                if (snapEnabled) {
                    const endTime = info.origStart + newDur;
                    const snappedEnd = getSnappedTime(endTime, { snapEnabled, gridSize });
                    newDur = snappedEnd - info.origStart;
                    newWidth = (newDur / 1000) * zoom;
                }

                info.el.style.width = `${newWidth}px`;
                currentValues[clipId].duration = newDur;
                if (info.clipType === 'audio') {
                    timeline.updateAudioClipWaveform(clipId, newDur);
                }
            } else if (isResizeLeft) {
                const info = clipInfos[clipId];
                if (!info) return;

                let newLeft = info.origLeft + dx;
                let newWidth = info.origWidth - dx;
                const minWidth = (CONFIG.minClipDuration / 1000) * zoom;

                if (newWidth < minWidth) {
                    newLeft = info.origLeft + info.origWidth - minWidth;
                    newWidth = minWidth;
                }
                if (newLeft < 0) {
                    newWidth += newLeft;
                    newLeft = 0;
                }

                let newStart = (newLeft / zoom) * 1000;
                let newDur = (newWidth / zoom) * 1000;

                if (snapEnabled) {
                    const snappedStart = getSnappedTime(newStart, { snapEnabled, gridSize });
                    const delta = newStart - snappedStart;
                    newStart = snappedStart;
                    newDur += delta;
                    newLeft = (newStart / 1000) * zoom;
                    newWidth = (newDur / 1000) * zoom;
                }

                info.el.style.left = `${newLeft}px`;
                info.el.style.width = `${newWidth}px`;
                currentValues[clipId].startTime = newStart;
                currentValues[clipId].duration = newDur;
                if (info.clipType === 'audio') {
                    timeline.updateAudioClipWaveform(clipId, newDur);
                }
            } else {
                const leadInfo = clipInfos[clipId];
                if (!leadInfo) return;

                let newLeadLeft = leadInfo.origLeft + dx;
                if (newLeadLeft < 0) newLeadLeft = 0;

                let newLeadStart = (newLeadLeft / zoom) * 1000;
                if (snapEnabled) {
                    newLeadStart = getSnappedTime(newLeadStart, { snapEnabled, gridSize });
                    newLeadLeft = (newLeadStart / 1000) * zoom;
                }

                const dt = newLeadStart - leadInfo.origStart;

                for (const id in clipInfos) {
                    const info = clipInfos[id];
                    let newStart = info.origStart + dt;
                    if (newStart < 0) newStart = 0;
                    const newLeft = (newStart / 1000) * zoom;

                    info.el.style.left = `${newLeft}px`;
                    currentValues[id].startTime = newStart;
                }

                const lanes = document.querySelectorAll('.track-lane');
                lanes.forEach(lane => lane.classList.remove('drag-over'));

                for (const lane of lanes) {
                    const rect = lane.getBoundingClientRect();
                    if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
                        const laneTrackId = lane.dataset.trackId;
                        const laneTrack = state.project.tracks.find(t => t.id === laneTrackId);
                        if (laneTrack && laneTrack.type === sourceTrackType) {
                            lane.classList.add('drag-over');
                            targetTrackId = laneTrackId;

                            for (const id in clipInfos) {
                                const info = clipInfos[id];
                                if (info.el.parentElement !== lane) {
                                    lane.appendChild(info.el);
                                }
                            }
                        }
                        break;
                    }
                }
            }

            timeline.renderPreview();
        };

        const upHandler = () => {
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);
            document.body.style.cursor = '';

            document.querySelectorAll('.track-lane').forEach(lane => lane.classList.remove('drag-over'));

            if (hasMoved) {
                stateManager.update(draft => {
                    for (const id in currentValues) {
                        for (const track of draft.project.tracks) {
                            const clip = track.clips.find(c => c.id === id);
                            if (clip) {
                                clip.startTime = currentValues[id].startTime;
                                clip.duration = currentValues[id].duration;
                                break;
                            }
                        }
                    }

                    if (isMove && targetTrackId && targetTrackId !== sourceTrackId) {
                        const targetTrack = draft.project.tracks.find(t => t.id === targetTrackId);
                        const sourceTrack = draft.project.tracks.find(t => t.id === sourceTrackId);

                        if (targetTrack && sourceTrack && targetTrack.type === sourceTrack.type) {
                            for (const id in clipInfos) {
                                const clipIndex = sourceTrack.clips.findIndex(c => c.id === id);
                                if (clipIndex !== -1) {
                                    const [movedClip] = sourceTrack.clips.splice(clipIndex, 1);
                                    targetTrack.clips.push(movedClip);
                                }
                            }
                        }
                    }

                    draft.isDirty = true;
                });

                emitAppEvent(appEvents, APP_EVENTS.TIMELINE_CHANGED);
            } else {
                const finalSelection = stateManager.get('selection') || [];
                if (!event.ctrlKey && !event.metaKey && finalSelection.length > 1 && finalSelection.includes(clipId)) {
                    stateManager.set('selection', [clipId], { skipHistory: true });
                    emitAppEvent(appEvents, APP_EVENTS.SELECTION_CHANGED);
                }
            }
        };

        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
    });

    function createDefaultClip(type, startTime) {
        const defaultProps = {
            solid: { color: '#ff0000' },
            flash: { color: '#ffffff' },
            strobe: { color: '#ff0000', rate: 10 },
            rainbow: { speed: 1, frequency: 1 },
            rainbowHold: { frequency: 1 },
            chase: { color: '#00ff00', speed: 1, width: 0.1, reverse: false },
            wipe: { color: '#0000ff', reverse: false },
            scanner: { color: '#ff00ff', speed: 1, width: 0.1 },
            meteor: { color: '#ffaa00', speed: 1, tailLen: 0.3, reverse: false },
            fire: {},
            sparkle: { color: '#0000ff', density: 0.3 },
            glitch: { color: '#ff0000', color2: '#00ff00', amount: 0.2 },
            breathe: { color: '#00ffff', speed: 1 },
            heartbeat: { color: '#ff0000', speed: 1 },
            alternate: { colorA: '#ff0000', colorB: '#0000ff' },
            energy: { color: '#ff00ff', color2: '#00ffff', speed: 1 }
        };

        return {
            id: `c${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            startTime,
            duration: CONFIG.defaultDuration,
            props: defaultProps[type] || {}
        };
    }

    updateClipboardUI();

    return {
        updateClipboardUI
    };
}
