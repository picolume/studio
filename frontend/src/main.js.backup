import { STATE, els } from './state.js';
import { CONFIG, getSnappedTime, blobToDataURL } from './utils.js';
import { initAudio, startPlayback, stopPlayback } from './audio.js';
import { buildTimeline, renderPreview, updatePlayheadUI, updateTimeDisplay, setCallbacks, selectClip, populateInspector, updateGridBackground, updateSelectionUI } from './timeline.js';

// ==========================================
// UNDO / REDO
// ==========================================
function saveStateForUndo(actionName = 'Edit') {
    const snapshot = JSON.parse(JSON.stringify({
        project: STATE.project, selection: STATE.selection, currentTime: STATE.currentTime, actionName
    }));
    STATE.undoStack.push(snapshot);
    if (STATE.undoStack.length > CONFIG.maxUndoStack) STATE.undoStack.shift();
    STATE.redoStack = [];
    updateUndoRedoButtons();
    
    // Mark as dirty when state changes
    STATE.isDirty = true;
    updateTitle();
}

function undo() {
    if (STATE.undoStack.length === 0) return;
    STATE.redoStack.push(JSON.parse(JSON.stringify({
        project: STATE.project, selection: STATE.selection, currentTime: STATE.currentTime, actionName: 'Redo'
    })));
    const prev = STATE.undoStack.pop();
    STATE.project = prev.project; STATE.selection = prev.selection;
    
    // Mark as dirty on Undo
    STATE.isDirty = true;
    updateTitle();
    
    buildTimeline(); updateSelectionUI(); updateUndoRedoButtons(); showToast(`Undo: ${prev.actionName}`);
}

function redo() {
    if (STATE.redoStack.length === 0) return;
    STATE.undoStack.push(JSON.parse(JSON.stringify({
        project: STATE.project, selection: STATE.selection, currentTime: STATE.currentTime, actionName: 'Undo'
    })));
    const next = STATE.redoStack.pop();
    STATE.project = next.project; STATE.selection = next.selection;
    
    // Mark as dirty on Redo
    STATE.isDirty = true;
    updateTitle();

    buildTimeline(); updateSelectionUI(); updateUndoRedoButtons(); showToast(`Redo: ${next.actionName || 'Action'}`);
}

function updateUndoRedoButtons() {
    if(els.btnUndo) els.btnUndo.disabled = STATE.undoStack.length === 0;
    if(els.btnRedo) els.btnRedo.disabled = STATE.redoStack.length === 0;
    if(els.statusHistory) els.statusHistory.textContent = `History: ${STATE.undoStack.length}`;
}

function updateTitle() {
    const pName = STATE.project.name || "Untitled";
    const dirty = STATE.isDirty ? "*" : "";
    document.title = `${pName}${dirty} - PicoLume Studio`;
}

// ==========================================
// SAVE / LOAD LOGIC
// ==========================================
async function performSave(forceSaveAs = false, silent = false) {
    let targetPath = STATE.filePath;

    if (forceSaveAs || !targetPath) {
        targetPath = await window.go.main.App.RequestSavePath();
        if (!targetPath) return; // Cancelled
    }

    const p = JSON.parse(JSON.stringify(STATE.project)); 
    const a = {};
    p.tracks.forEach(t => { 
        if(t.type==='audio') t.clips.forEach(c => { 
            if(c.bufferId && STATE.audioLibrary[c.bufferId]) { 
                a[c.bufferId]=STATE.audioLibrary[c.bufferId]; 
                c.props.audioSrcPath=`audio/${c.bufferId}.bin`; 
                delete c.props.sourceData; 
            } 
        })
    });

    try {
        const result = await window.go.main.App.SaveProjectToPath(targetPath, JSON.stringify(p), a);
        if (result === "Saved") {
            STATE.filePath = targetPath;
            STATE.isDirty = false;
            STATE.lastSaveTime = Date.now();
            updateTitle();
            if (!silent) showToast("Project Saved");
        } else {
            showToast(result);
        }
    } catch(e) { 
        showToast("Save Error: "+e); 
    }
}

// ==========================================
// CLIPBOARD (Updated for Multi-Select)
// ==========================================
function copySelectedClip() {
    if (STATE.selection.length === 0) return;
    
    // Find all clips currently selected
    const copiedClips = [];
    STATE.project.tracks.forEach(t => {
        t.clips.forEach(c => {
            if (STATE.selection.includes(c.id)) {
                if(c.type !== 'audio') { // Audio copy not fully supported yet
                    copiedClips.push(JSON.parse(JSON.stringify(c)));
                }
            }
        });
    });

    if (copiedClips.length === 0) return;
    
    // Sort by startTime so they paste in relative order
    copiedClips.sort((a,b) => a.startTime - b.startTime);
    
    // Store as clipboard object
    STATE.clipboard = copiedClips;
    updateClipboardUI();
    showToast(`Copied ${copiedClips.length} clips`);
}

function pasteClip() {
    if (!STATE.clipboard || STATE.clipboard.length === 0) return;
    
    // Paste target: first LED track
    let track = STATE.project.tracks.find(t => t.type === 'led');
    if (!track) { showToast("No valid track for paste"); return; }

    saveStateForUndo('Paste');
    
    // Find paste start time (end of track)
    let pasteOffset = 0;
    if (track.clips.length > 0) {
        track.clips.forEach(c => {
            const end = c.startTime + c.duration;
            if (end > pasteOffset) pasteOffset = end;
        });
    }
    if (STATE.snapEnabled) pasteOffset = getSnappedTime(pasteOffset);

    // Calculate the start time of the FIRST clip in clipboard to maintain relative offsets
    const baseTime = STATE.clipboard[0].startTime;
    
    const newSelection = [];

    STATE.clipboard.forEach(clipData => {
        const relativeStart = clipData.startTime - baseTime;
        const newClip = JSON.parse(JSON.stringify(clipData));
        newClip.id = 'c_' + Date.now() + Math.random().toString(16).slice(2);
        newClip.startTime = pasteOffset + relativeStart;
        track.clips.push(newClip);
        newSelection.push(newClip.id);
    });

    STATE.selection = newSelection;
    buildTimeline();
    updateSelectionUI();
    showToast(`Pasted ${newSelection.length} clips`);
}

function duplicateSelectedClip() {
    if (STATE.selection.length === 0) return;
    saveStateForUndo('Duplicate');

    const newSelection = [];
    const processed = new Set(); // Avoid potential dup issues if iterating live array

    // Find and duplicate
    STATE.project.tracks.forEach(t => {
        // Iterate copy of array so we don't loop over newly added items
        [...t.clips].forEach(c => {
            if (STATE.selection.includes(c.id) && !processed.has(c.id)) {
                processed.add(c.id);
                const newClip = JSON.parse(JSON.stringify(c));
                newClip.id = 'c_' + Date.now() + Math.random().toString(16).slice(2);
                newClip.startTime += c.duration; // Place immediately after
                t.clips.push(newClip);
                newSelection.push(newClip.id);
            }
        });
    });

    STATE.selection = newSelection;
    buildTimeline();
    updateSelectionUI();
    showToast("Duplicated");
}

function updateClipboardUI() {
    if(els['btn-copy']) els['btn-copy'].disabled = STATE.selection.length === 0;
    if(els['btn-paste']) els['btn-paste'].disabled = (!STATE.clipboard || STATE.clipboard.length === 0);
    if(els['btn-duplicate']) els['btn-duplicate'].disabled = STATE.selection.length === 0;
}

function showToast(msg) {
    if(!els.toast) return;
    els.toast.textContent = msg; els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    const ids = [
        'timeline-scroll-area', 'timeline-content', 'tracks-container', 'track-headers',
        'ruler', 'playhead-handle', 'playhead-line', 'time-display', 'inspector-content',
        'preview-canvas', 'btn-play', 'btn-undo', 'btn-redo', 'btn-copy', 'btn-paste',
        'zoom-slider', 'zoom-display', 'vol-slider', 'toast', 
        'status-history',
        'btn-add-track-led', 'btn-add-track-audio', 'btn-settings',
        'btn-export-bin', 'btn-upload', 'btn-save', 'btn-save-as', 'btn-export', 'btn-open', 'btn-new',
        'btn-stop', 'btn-to-start', 'chk-snap', 'sel-grid', 'btn-duplicate'
    ];
    const toCamelCase = (str) => str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) { els[id] = el; els[toCamelCase(id)] = el; }
    });
    els.inspector = els['inspector-content']; els.timelineScroll = els['timeline-scroll-area'];

    setCallbacks(saveStateForUndo, showToast);
    updateTitle();

    window.addEventListener('app:toast', (e) => { showToast(e.detail); });

    // --- SCROLL & ZOOM ---
    els.timelineScroll.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -10 : 10;
            const newZoom = Math.max(10, Math.min(200, STATE.zoom + delta));
            if (newZoom !== STATE.zoom) {
                STATE.zoom = newZoom;
                if (els['zoom-slider']) els['zoom-slider'].value = newZoom;
                if (els['zoom-display']) els['zoom-display'].innerText = `${newZoom}px/s`;
                buildTimeline(); updatePlayheadUI(); updateGridBackground();
            }
            return;
        }
        if (e.shiftKey) return;
        e.preventDefault();
        els.timelineScroll.scrollLeft += e.deltaY;
    }, { passive: false });

    els.timelineScroll.addEventListener('scroll', () => {
        if(els.trackHeaders) els.trackHeaders.scrollTop = els.timelineScroll.scrollTop;
    });
    if(els.trackHeaders) els.trackHeaders.addEventListener('wheel', e => {
        e.preventDefault(); els.timelineScroll.scrollTop += e.deltaY;
    }, { passive: false });

    // --- TOOLBAR ---
    if (els['zoom-slider']) els['zoom-slider'].oninput = (e) => {
        STATE.zoom = parseInt(e.target.value);
        if (els['zoom-display']) els['zoom-display'].innerText = `${STATE.zoom}px/s`;
        buildTimeline(); updatePlayheadUI(); updateGridBackground();
    };
    if (els['chk-snap']) els['chk-snap'].onchange = (e) => { STATE.snapEnabled = e.target.checked; updateGridBackground(); };
    if (els['sel-grid']) els['sel-grid'].onchange = (e) => { STATE.gridSize = parseInt(e.target.value); updateGridBackground(); };

    // --- VOLUME CONTROL ---
    if (els['vol-slider']) {
        els['vol-slider'].addEventListener('input', (e) => {
            STATE.masterVolume = parseFloat(e.target.value);
            if (STATE.masterGain) STATE.masterGain.gain.value = STATE.masterVolume;
            const icon = document.getElementById('vol-icon');
            if (icon) {
                if (STATE.masterVolume === 0) icon.className = "fas fa-volume-mute text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
                else if (STATE.masterVolume < 0.5) icon.className = "fas fa-volume-down text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
                else icon.className = "fas fa-volume-up text-gray-500 text-xs group-hover:text-gray-300 w-5 text-center";
            }
        });
    }

    // --- SCRUBBER & DESELECT ---
    const handleScrub = (e) => {
        if (e.target.closest('.clip') || e.target.closest('.clip-handle')) return;
        if (e.target.closest('.track-header') || e.target.classList.contains('track-lane') || e.target === els.timelineContent || e.target === els.timelineScroll || e.target === els.tracksContainer) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); 
            // Clicked empty space: Clear Selection
            STATE.selection = [];
            updateSelectionUI();
            updateClipboardUI();
        }
        const scrollRect = els.timelineScroll.getBoundingClientRect();
        const startX = e.clientX - scrollRect.left + els.timelineScroll.scrollLeft;
        const updateTime = (xPos) => {
            const t = (xPos / STATE.zoom) * 1000;
            STATE.currentTime = Math.max(0, Math.min(STATE.project.duration, t));
            updatePlayheadUI(); renderPreview(); updateTimeDisplay();
        };
        updateTime(startX);
        const move = (ev) => { updateTime(ev.clientX - scrollRect.left + els.timelineScroll.scrollLeft); };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    els.timelineScroll.addEventListener('mousedown', handleScrub);

    // --- CRITICAL: MULTI-CLIP SELECTION & DRAG ---
    window.addEventListener('app:clip-mousedown', e => {
        const { event, clip } = e.detail;
        const startX = event.clientX;
        const pxPerMs = STATE.zoom / 1000;
        
        // --- 1. SELECTION LOGIC ---
        // Ctrl+Click: Toggle
        if (event.ctrlKey || event.metaKey) {
            if (STATE.selection.includes(clip.id)) {
                STATE.selection = STATE.selection.filter(id => id !== clip.id);
            } else {
                STATE.selection.push(clip.id);
            }
        } 
        // Normal Click:
        else {
            // If clicking an unselected item, select only it (unless dragging)
            if (!STATE.selection.includes(clip.id)) {
                STATE.selection = [clip.id];
            }
            // If clicking an ALREADY selected item, DO NOT clear others yet.
            // We wait to see if it's a click or a drag.
        }
        updateSelectionUI();
        updateClipboardUI();

        // --- 2. PREPARE DRAG DATA ---
        // Identify resize handles
        const isResizeRight = event.target.classList.contains('right');
        const isResizeLeft = event.target.classList.contains('left');
        const isMove = !isResizeRight && !isResizeLeft;

        // Store initial state for ALL selected clips (for multi-move)
        // or just the target clip (for resize - we only resize one at a time for safety)
        const initialStates = {};
        
        // If Resizing, only track the single clip
        if (!isMove) {
            initialStates[clip.id] = { start: clip.startTime, dur: clip.duration };
        } 
        // If Moving, track ALL selected clips
        else {
            STATE.selection.forEach(selId => {
                // Find clip object
                let selClip = null;
                STATE.project.tracks.forEach(t => { 
                    const found = t.clips.find(c => c.id === selId);
                    if(found) selClip = found;
                });
                if(selClip) {
                    initialStates[selId] = { start: selClip.startTime, dur: selClip.duration, clipObj: selClip };
                }
            });
        }

        let hasMoved = false;

        const moveHandler = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 3 && !hasMoved) { 
                hasMoved = true; 
                saveStateForUndo(isMove ? 'Move Clips' : 'Resize Clip'); 
            }

            if (!hasMoved) return;

            // --- RESIZE LOGIC (Single Clip) ---
            if (isResizeRight) {
                const init = initialStates[clip.id];
                let newDur = init.dur + (dx / pxPerMs);
                if (newDur < CONFIG.minClipDuration) newDur = CONFIG.minClipDuration;
                if (STATE.snapEnabled) newDur = getSnappedTime(init.start + newDur) - init.start;
                clip.duration = Math.max(CONFIG.minClipDuration, newDur);
            } else if (isResizeLeft) {
                const init = initialStates[clip.id];
                let newStart = init.start + (dx / pxPerMs);
                if (STATE.snapEnabled) newStart = getSnappedTime(newStart);
                if (newStart < 0) newStart = 0;
                let newDur = (init.start + init.dur) - newStart;
                if (newDur < CONFIG.minClipDuration) { 
                    newStart = (init.start + init.dur) - CONFIG.minClipDuration; 
                    newDur = CONFIG.minClipDuration; 
                }
                clip.startTime = newStart; clip.duration = newDur;
            } 
            
            // --- MOVE LOGIC (Multi Clip) ---
            else {
                // Calculate raw time delta
                let dt = dx / pxPerMs;

                // MAGNETISM / SNAP (Based on the LEAD clip - the one clicked)
                const leadInit = initialStates[clip.id];
                let rawNewStart = leadInit.start + dt;
                
                if (STATE.snapEnabled) {
                    const snappedNewStart = getSnappedTime(rawNewStart);
                    dt = snappedNewStart - leadInit.start; // Recalculate delta to fit snap
                }

                // Apply delta to ALL selected clips
                Object.keys(initialStates).forEach(id => {
                    const state = initialStates[id];
                    let newStart = state.start + dt;
                    if (newStart < 0) newStart = 0; // Prevent negative time
                    state.clipObj.startTime = newStart;
                });
            }
            
            buildTimeline(); renderPreview(); 
            // Only populate inspector if single selection, to avoid lag re-rendering multi-view
            if(STATE.selection.length === 1) populateInspector(clip.id);
        };

        const upHandler = () => {
            window.removeEventListener('mousemove', moveHandler);
            window.removeEventListener('mouseup', upHandler);
            
            // If we clicked (no move) on an already selected item without Ctrl,
            // that means we wanted to select ONLY that item (deselect others).
            if (!hasMoved && !event.ctrlKey && !event.metaKey && STATE.selection.length > 1) {
                if(STATE.selection.includes(clip.id)) {
                    STATE.selection = [clip.id];
                    updateSelectionUI();
                }
            }
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
    });

    if(els['btn-play']) els['btn-play'].onclick = () => { if (STATE.isPlaying) stopPlayback(); else startPlayback(); };
    if(els['btn-stop']) els['btn-stop'].onclick = () => { stopPlayback(); STATE.currentTime = 0; updatePlayheadUI(); renderPreview(); };
    if(els['btn-to-start']) els['btn-to-start'].onclick = () => { STATE.currentTime = 0; updatePlayheadUI(); renderPreview(); els.timelineScroll.scrollLeft = 0; };

    if(els['btn-undo']) els['btn-undo'].onclick = undo;
    if(els['btn-redo']) els['btn-redo'].onclick = redo;
    if(els['btn-copy']) els['btn-copy'].onclick = copySelectedClip;
    if(els['btn-paste']) els['btn-paste'].onclick = pasteClip;
    if(els['btn-duplicate']) els['btn-duplicate'].onclick = duplicateSelectedClip;

    const addTrack = (type) => {
        let i = 1; while (STATE.project.tracks.find(t => t.id === 't' + i)) { i++; }
        saveStateForUndo('Add Track');
        STATE.project.tracks.push({
            id: 't' + i, type: type, label: type==='audio'?'Audio Track':'Track '+i,
            groupId: type==='led' && STATE.project.propGroups.length>0 ? STATE.project.propGroups[0].id : null, clips: []
        });
        buildTimeline();
    };
    if(els['btn-add-track-led']) els['btn-add-track-led'].onclick = () => addTrack('led');
    if(els['btn-add-track-audio']) els['btn-add-track-audio'].onclick = () => addTrack('audio');
    if(els['btn-settings']) els['btn-settings'].onclick = () => { selectClip(null); updateClipboardUI(); };

    if(els['btn-new']) els['btn-new'].onclick = () => {
        if(confirm("Create new project? Unsaved changes will be lost.")) {
            stopPlayback();
            STATE.project = {
                name: "My Show", duration: 60000,
                settings: { ledCount: 164, brightness: 255 },
                propGroups: [{ id: 'g_all', name: 'All Props', ids: '1-18' }, { id: 'g_1', name: 'Prop 1', ids: '1' }],
                tracks: [{ id: 't1', type: 'audio', label: 'Audio Track', clips: [], groupId: null }, { id: 't2', type: 'led', label: 'Main Track', clips: [], groupId: 'g_all' }]
            };
            STATE.assets = {}; STATE.audioLibrary = {}; 
            STATE.selection = []; // Clear array
            STATE.currentTime = 0; STATE.undoStack = []; STATE.redoStack = [];
            STATE.filePath = null; STATE.isDirty = false;
            initAudio(); buildTimeline(); updateSelectionUI(); renderPreview(); updatePlayheadUI(); updateTimeDisplay(); updateUndoRedoButtons(); updateTitle();
            showToast("New Project Created");
        }
    };
    if(els['btn-export-bin']) els['btn-export-bin'].onclick = async () => {
        try { showToast(await window.go.main.App.SaveBinary(JSON.stringify(STATE.project))); } catch(e) { showToast("Error: "+e); }
    };
    if(els['btn-upload']) els['btn-upload'].onclick = async () => {
        showToast("Scanning for Pico...");
        try { showToast(await window.go.main.App.UploadToPico(JSON.stringify(STATE.project))); } catch(e) { showToast("Error: "+e); }
    };
    
    // --- SAVE HANDLERS ---
    if(els['btn-save']) els['btn-save'].onclick = () => performSave(false, false); 
    else if(els['btn-export']) els['btn-export'].onclick = () => performSave(false, false);
    
    if(els['btn-save-as']) els['btn-save-as'].onclick = () => performSave(true, false); 
    
    // --- AUTO SAVE TIMER ---
    setInterval(() => {
        if (STATE.autoSaveEnabled && STATE.filePath && STATE.isDirty) {
            console.log("Auto-saving...");
            performSave(false, true); 
        }
    }, 60000); 

    if(els['btn-open']) els['btn-open'].onclick = async () => {
        try {
            const resp = await window.go.main.App.LoadProject();
            if (resp.error) { if (resp.error !== "Cancelled") showToast(resp.error); return; }
            STATE.project = JSON.parse(resp.projectJson); 
            if (!STATE.project.settings) STATE.project.settings = { ledCount: 164, brightness: 255 };
            if (!STATE.project.propGroups) STATE.project.propGroups = [];
            STATE.audioLibrary = resp.audioFiles;
            STATE.currentTime = 0; 
            STATE.selection = []; // Clear Array
            STATE.assets = {}; STATE.undoStack = []; STATE.redoStack = []; 
            
            STATE.filePath = resp.filePath;
            STATE.isDirty = false;
            updateTitle();
            
            updateUndoRedoButtons(); initAudio();
            const promises = Object.keys(STATE.audioLibrary).map(id => fetch(STATE.audioLibrary[id]).then(r=>r.arrayBuffer()).then(b=>STATE.audioCtx.decodeAudioData(b)).then(d=>STATE.assets[id]=d));
            await Promise.all(promises);
            buildTimeline(); updateSelectionUI(); renderPreview(); showToast("Loaded!");
        } catch(e) { showToast("Load Failed"); }
    };

    // 6. Drag & Drop (Palette)
    document.querySelectorAll('.palette-item').forEach(item => {
        item.addEventListener('dragstart', e => e.dataTransfer.setData('type', item.dataset.type));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const ledTrack = STATE.project.tracks.find(t => t.type === 'led');
                if (ledTrack) {
                    const type = item.dataset.type;
                    saveStateForUndo(`Add ${type} Clip`);
                    const newClip = {
                        id: 'c_' + Date.now(), type: type, startTime: getSnappedTime(STATE.currentTime), duration: CONFIG.defaultDuration,
                        props: getDefaultProps(type)
                    };
                    ledTrack.clips.push(newClip); 
                    STATE.selection = [newClip.id]; // Select new
                    buildTimeline(); updateSelectionUI(); updateClipboardUI();
                }
            }
        });
    });

    window.addEventListener('app:drop-clip', e => {
        const { event, trackId } = e.detail;
        const type = event.dataTransfer.getData('type'); if (!type) return;
        const x = event.clientX - els.timelineScroll.getBoundingClientRect().left + els.timelineScroll.scrollLeft - 240; 
        let startTime = Math.max(0, (x / STATE.zoom) * 1000);
        if (STATE.snapEnabled) startTime = getSnappedTime(startTime);
        
        saveStateForUndo('Add Clip');
        const track = STATE.project.tracks.find(t => t.id === trackId);
        const newClip = { 
            id: 'c_'+Date.now(), 
            type, 
            startTime, 
            duration: CONFIG.defaultDuration, 
            props: getDefaultProps(type)
        };
        
        track.clips.push(newClip); 
        STATE.selection = [newClip.id]; // Select new
        buildTimeline(); updateSelectionUI(); updateClipboardUI();
    });

    window.addEventListener('app:load-audio', e => {
        const { file, trackId } = e.detail;
        if (!file) return;
        initAudio();
        const reader = new FileReader();
        reader.onload = (ev) => {
            const rawDataUrl = ev.target.result;
            fetch(rawDataUrl).then(r=>r.arrayBuffer()).then(arr=>STATE.audioCtx.decodeAudioData(arr)).then(buffer => {
                const assetId = 'asset_' + Date.now();
                STATE.assets[assetId] = buffer;
                STATE.audioLibrary[assetId] = rawDataUrl;
                saveStateForUndo('Add Audio');
                const track = STATE.project.tracks.find(t => t.id === trackId);
                const newClip = {
                    id: 'c_' + Date.now(), type: 'audio',
                    startTime: getSnappedTime(STATE.currentTime),
                    duration: buffer.duration * 1000,
                    bufferId: assetId,
                    props: { name: file.name }
                };
                track.clips.push(newClip);
                if (newClip.startTime + newClip.duration > STATE.project.duration) STATE.project.duration = newClip.startTime + newClip.duration + 5000;
                buildTimeline(); showToast(`Added: ${file.name}`);
            }).catch(e=>showToast("Audio Decode Failed"));
        };
        reader.readAsDataURL(file);
    });

    function getDefaultProps(type) {
        const defaults = {
            solid: { color: '#00ccff' },
            rainbow: { speed: 1, frequency: 2 },
            rainbowHold: { frequency: 1 },
            chase: { color: '#ffffff', speed: 1, width: 0.1 },
            strobe: { color: '#ffffff', rate: 10 },
            flash: { color: '#ffffff' }, 
            sparkle: { color: '#ffffff', density: 0.3 },
            breathe: { color: '#2196f3', speed: 2 },
            alternate: { colorA: '#ff5722', colorB: '#00bcd4' },
            wipe: { color: '#e91e63' },
            scanner: { color: '#f44336', speed: 3, width: 0.1 },
            meteor: { color: '#ffffff', speed: 2, tailLen: 0.3 },
            fire: {}, 
            heartbeat: { color: '#d50000', speed: 2 },
            glitch: { color: '#4caf50', color2: '#000000', amount: 0.2 },
            energy: { color: '#00e5ff', color2: '#3d00bd', speed: 2 }
        };
        return JSON.parse(JSON.stringify(defaults[type] || { color: '#ffffff' }));
    }

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') { e.preventDefault(); if (STATE.isPlaying) stopPlayback(); else startPlayback(); }
        if (e.code === 'Delete' || e.code === 'Backspace') {
            if (STATE.selection.length > 0) {
                saveStateForUndo('Delete Clip');
                // Remove all clips in Selection array from all tracks
                STATE.project.tracks.forEach(t => t.clips = t.clips.filter(c => !STATE.selection.includes(c.id)));
                STATE.selection = []; // Clear selection
                buildTimeline(); updateSelectionUI(); updateClipboardUI();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); redo(); }
        
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); copySelectedClip(); }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); pasteClip(); }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); duplicateSelectedClip(); }
    });

    const loop = () => {
        if (STATE.isPlaying) {
            STATE.currentTime = (STATE.audioCtx.currentTime - STATE.audioStartTime) * 1000;
            if (STATE.currentTime >= STATE.project.duration) { stopPlayback(); STATE.currentTime = STATE.project.duration; }
            updatePlayheadUI(); renderPreview(); updateTimeDisplay();
        } else { renderPreview(); }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    setTimeout(() => {
        try {
            buildTimeline(); updateSelectionUI(); updateUndoRedoButtons(); updateClipboardUI();
        } catch (e) {
            console.error("Render Failed:", e); showToast("Initialization Error");
        }
    }, 100);
});