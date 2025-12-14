import { CONFIG, getSnappedTime, lerpColor, hslToRgb, hexToRgb, pseudoRandom, parseIdString } from './utils.js';

const deps = {
    stateManager: null,
    timelineController: null,
    audioService: null,
    errorHandler: null,
    elements: {}
};

let lastPreviewRender = 0;

export function initTimeline(injected) {
    if (!injected?.stateManager) {
        console.warn('initTimeline: stateManager is required');
    }
    deps.stateManager = injected?.stateManager ?? null;
    deps.timelineController = injected?.timelineController ?? null;
    deps.audioService = injected?.audioService ?? null;
    deps.errorHandler = injected?.errorHandler ?? null;
    deps.elements = injected?.elements ?? injected?.els ?? {};
}

function assertInitialized() {
    if (!deps.stateManager) {
        throw new Error('Timeline module not initialized. Call initTimeline() first.');
    }
}

function getZoom() {
    return deps.stateManager?.get('ui.zoom') ?? 50;
}

function getGridSize() {
    return deps.stateManager?.get('ui.gridSize') ?? 1000;
}

function isSnapEnabled() {
    return deps.stateManager?.get('ui.snapEnabled') ?? true;
}

function isPlaying() {
    return deps.stateManager?.get('playback.isPlaying') ?? false;
}

function getCurrentTime() {
    return deps.stateManager?.get('playback.currentTime') ?? 0;
}

function getProject() {
    return deps.stateManager?.get('project') ?? null;
}

function getAssets() {
    return deps.stateManager?.get('assets') ?? {};
}

function getSelection() {
    return deps.stateManager?.get('selection') ?? [];
}

function setSelection(ids) {
    deps.stateManager?.set('selection', Array.isArray(ids) ? ids : [], { skipHistory: true });
}

function toast(msg) {
    if (deps.errorHandler?.showToast) return deps.errorHandler.showToast(msg);
    window.dispatchEvent(new CustomEvent('app:toast', { detail: msg }));
}

export function updateGridBackground() {
    const content = deps.elements.timelineContent || document.getElementById('timeline-content');
    if (!content) return;
    const pixelsPerGrid = (getGridSize() / 1000) * getZoom();
    content.style.backgroundSize = `${pixelsPerGrid}px 100%`;
    content.classList.toggle('grid-hidden', !isSnapEnabled());
}

export function updateTimeDisplay() {
    if (!deps.elements.timeDisplay) return;
    const totalSec = Math.max(0, getCurrentTime() / 1000);
    const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const sec = Math.floor(totalSec % 60).toString().padStart(2, '0');
    const ms = Math.floor((totalSec % 1) * 100).toString().padStart(2, '0');
    deps.elements.timeDisplay.innerText = `${min}:${sec}.${ms}`;
}

export function updatePlayheadUI() {
    const x = (getCurrentTime() / 1000) * getZoom();
    if (deps.elements.playheadLine) deps.elements.playheadLine.style.transform = `translateX(${x}px)`;
    if (deps.elements.playheadHandle) deps.elements.playheadHandle.style.transform = `translateX(${x}px)`;
    
    const scroll = deps.elements.timelineScroll || document.getElementById('timeline-scroll-area');
    if (isPlaying() && scroll) {
        if (x > scroll.scrollLeft + scroll.clientWidth - 50) {
            scroll.scrollLeft = x - 50;
        }
    }
}

export function renderPreview() {
    const now = performance.now();
    if (isPlaying() && now - lastPreviewRender < CONFIG.previewThrottleMs) return;
    lastPreviewRender = now;

    const canvas = deps.elements.previewCanvas || document.getElementById('preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    const project = getProject();
    if (!project?.tracks) return;

    const currentTime = getCurrentTime();
    const ledTracks = project.tracks.filter(t => t.type === 'led');

    if (ledTracks.length === 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }

    const trackHeight = h / ledTracks.length;
    const ledSpacing = w / CONFIG.ledsPerTrack;
    const ledRadius = Math.min(ledSpacing / 2.5, trackHeight / 3);

    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

    ledTracks.forEach((track, tIndex) => {
        const activeClips = track.clips.filter(c => currentTime >= c.startTime && currentTime < (c.startTime + c.duration))
            .sort((a, b) => a.startTime - b.startTime);

        for (let i = 0; i < CONFIG.ledsPerTrack; i++) {
            let color = 'rgb(30,30,30)';
            let glow = false;

            if (activeClips.length > 0) {
                const clip = activeClips[activeClips.length - 1];
                const localTime = currentTime - clip.startTime;
                const progress = localTime / clip.duration;
                const pixelPct = i / CONFIG.ledsPerTrack;

                switch (clip.type) {
                    case 'solid': color = clip.props.color; glow = true; break;
                    case 'flash': 
                        const fTime = localTime % 500;
                        if (fTime < 50) { color = clip.props.color || '#ffffff'; glow = true; } else { color = '#000000'; glow = false; } break;
                    case 'strobe':
                        const rate = clip.props.rate || 10;
                        const period = 1000 / rate;
                        const sFrame = Math.floor(localTime / (period / 2));
                        if (sFrame % 2 === 0) { color = clip.props.color; glow = true; } else { color = '#000000'; glow = false; } break;
                    case 'rainbow': 
                        const hue = ((localTime / 1000 * clip.props.speed) + (pixelPct * clip.props.frequency)) % 1;
                        color = hslToRgb(hue, 1, 0.5); glow = true; break;
                    case 'rainbowHold': 
                        const hueHold = (pixelPct * (clip.props.frequency || 1)) % 1;
                        color = hslToRgb(hueHold, 1, 0.5); glow = true; break;
                    case 'chase': 
                        const chasePos = (progress * clip.props.speed * 10) % 1;
                        const width = clip.props.width || 0.1;
                        let dist = Math.abs(pixelPct - chasePos);
                        if (dist > 0.5) dist = 1.0 - dist; 
                        if (dist < width) { color = clip.props.color; glow = true; } break;
                    case 'wipe': if (pixelPct <= progress) { color = clip.props.color; glow = true; } break;
                    case 'scanner':
                        const sPos = (Math.sin(localTime / 1000 * clip.props.speed * Math.PI * 2) + 1) / 2;
                        const sWidth = clip.props.width || 0.1;
                        if (Math.abs(pixelPct - sPos) < sWidth) { color = clip.props.color; glow = true; } break;
                    case 'meteor':
                        const mSpeed = clip.props.speed || 1; const mTail = clip.props.tailLen || 0.3;
                        const mPos = (localTime / 1000 * mSpeed) % 2; let mDist = mPos - pixelPct;
                        if (mDist >= 0 && mDist < mTail) { const decay = 1 - (mDist / mTail); const mRgb = hexToRgb(clip.props.color); color = `rgb(${mRgb.r * decay}, ${mRgb.g * decay}, ${mRgb.b * decay})`; glow = true; } break;
                    case 'fire':
                        const fTimeBlock = Math.floor(localTime / 80); const fRand = pseudoRandom(fTimeBlock * 1000 + i); 
                        if (fRand > 0.8) color = '#ffff00'; else if (fRand > 0.5) color = '#ff5500'; else color = '#ff0000'; glow = true; break;
                    case 'sparkle':
                        const sTimeBlock = Math.floor(localTime / 50); const sRand = pseudoRandom(sTimeBlock * 999 + i);
                        const density = clip.props.density || 0.3; if (sRand > (1.0 - density)) { color = '#ffffff'; glow = true; } else { const spBase = hexToRgb(clip.props.color); color = `rgb(${spBase.r * 0.2}, ${spBase.g * 0.2}, ${spBase.b * 0.2})`; } break;
                    case 'glitch':
                        const gTimeBlock = Math.floor(localTime / 50); const gRand = pseudoRandom(gTimeBlock); const amount = clip.props.amount || 0.2;
                        if (gRand > (1.0 - amount)) { color = (pseudoRandom(gTimeBlock + 1) > 0.5) ? clip.props.color2 : '#000000'; } else { color = clip.props.color; } glow = true; break;
                    case 'breathe':
                        const bVal = (Math.sin(localTime / 1000 * clip.props.speed * Math.PI * 2) + 1) / 2; const bBase = hexToRgb(clip.props.color); color = `rgb(${bBase.r * bVal}, ${bBase.g * bVal}, ${bBase.b * bVal})`; glow = true; break;
                    case 'heartbeat':
                        const hT = (localTime / 1000 * clip.props.speed) % 1; let hInt = 0;
                        if (hT < 0.15) hInt = Math.sin(hT * Math.PI / 0.15); else if (hT > 0.25 && hT < 0.45) hInt = Math.sin((hT - 0.25) * Math.PI / 0.2) * 0.6; if(hInt < 0) hInt = 0;
                        const hBase = hexToRgb(clip.props.color); color = `rgb(${hBase.r * hInt}, ${hBase.g * hInt}, ${hBase.b * hInt})`; glow = hInt > 0.1; break;
                    case 'alternate': color = (i % 2 === 0) ? clip.props.colorA : clip.props.colorB; glow = true; break;
                    case 'energy':
                        const eT = localTime / 1000 * clip.props.speed; const w1 = Math.sin(i * 0.2 + eT); const w2 = Math.sin(i * 0.3 - eT * 1.5); const eVal = (w1 + w2 + 2) / 4; 
                        const c1 = hexToRgb(clip.props.color); const c2 = hexToRgb(clip.props.color2); const eR = c1.r + (c2.r - c1.r) * eVal; const eG = c1.g + (c2.g - c1.g) * eVal; const eB = c1.b + (c2.b - c1.b) * eVal;
                        color = `rgb(${Math.floor(eR)},${Math.floor(eG)},${Math.floor(eB)})`; glow = true; break;
                    default: if (clip.props.color) { color = clip.props.color; glow = true; } break;
                }
            }
            const x = i * ledSpacing + (ledSpacing / 2);
            const y = tIndex * trackHeight + (trackHeight / 2);
            ctx.shadowBlur = glow ? 10 : 0; ctx.shadowColor = color;
            ctx.beginPath(); ctx.arc(x, y, ledRadius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        }
    });
}

export function buildTimeline() {
    const content = deps.elements.timelineContent || document.getElementById('timeline-content');
    const headers = deps.elements.trackHeaders || document.getElementById('track-headers');
    const container = deps.elements.tracksContainer || document.getElementById('tracks-container');
    const ruler = deps.elements.ruler || document.getElementById('ruler');

    if (!content || !headers || !container) return;

    const project = getProject();
    if (!project) return;
    
    const dur = project.duration || 60000;
    const zoom = getZoom();
    const newWidth = (dur/1000) * zoom + 500;
    
    content.style.width = `${newWidth}px`;
    content.style.minWidth = `${newWidth}px`;
    if(ruler) { ruler.style.width = `${newWidth}px`; ruler.style.minWidth = `${newWidth}px`; }
    if(container) { container.style.width = `${newWidth}px`; container.style.minWidth = `${newWidth}px`; }

    headers.innerHTML = '';
    const headerSpacer = document.createElement('div');
    headerSpacer.className = 'track-headers-spacer';
    headers.appendChild(headerSpacer);
    container.innerHTML = '';

    const tracks = project.tracks || [];

    tracks.forEach((track, index) => {
        const h = document.createElement('div');
        h.className = 'track-header group cursor-move relative';
        h.draggable = true;
        h.dataset.index = index;
        if (track.type === 'audio') h.style.background = '#151515';

        h.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            e.dataTransfer.effectAllowed = 'move';
            h.style.opacity = '0.5';
        });
        h.addEventListener('dragend', () => {
            h.style.opacity = '1';
            document.querySelectorAll('.track-header').forEach(el => el.style.borderTop = '');
        });
        h.addEventListener('dragover', (e) => { e.preventDefault(); h.style.borderTop = '2px solid #00bcd4'; });
        h.addEventListener('dragleave', () => { h.style.borderTop = ''; });
        h.addEventListener('drop', (e) => {
            e.preventDefault();
            h.style.borderTop = '';
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (fromIndex !== index && !isNaN(fromIndex)) {
                deps.stateManager?.update(draft => {
                    const moved = draft.project.tracks.splice(fromIndex, 1)[0];
                    draft.project.tracks.splice(index, 0, moved);
                    draft.isDirty = true;
                });
                buildTimeline(); renderPreview();
            }
        });

        const row1 = document.createElement('div');
        row1.className = "flex items-center w-full mb-1";
        row1.innerHTML = `<i class="${track.type === 'audio' ? 'fas fa-music text-orange-500' : 'fas fa-lightbulb text-cyan-500'} mr-2"></i>`;
        
        const label = document.createElement('span');
        label.className = "cursor-text truncate text-xs font-bold flex-1";
        label.innerText = track.label;
        label.ondblclick = (e) => {
            e.stopPropagation();
            const inp = document.createElement('input'); inp.value = track.label;
            inp.className = "bg-neutral-800 text-white px-1 py-0.5 rounded text-xs w-full";
            const trackId = track.id;
            const save = () => {
                const next = inp.value.trim();
                if (!next) return;
                deps.stateManager?.update(draft => {
                    const t = draft.project.tracks.find(x => x.id === trackId);
                    if (t) {
                        t.label = next;
                        draft.isDirty = true;
                    }
                });
                buildTimeline();
            };
            inp.onblur = save; inp.onkeydown = (ev) => { if(ev.key==='Enter') save(); };
            row1.replaceChild(inp, label); inp.focus();
        };
        row1.appendChild(label);

        if (track.type === 'audio') {
            const upBtn = document.createElement('button');
            upBtn.innerHTML = '<i class="fas fa-file-upload"></i>';
            upBtn.className = "text-gray-400 hover:text-orange-400 p-1 mr-1 text-[10px]";
            upBtn.onclick = (e) => {
                e.stopPropagation();
                const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*';
                inp.onchange = (ev) => {
                    if (ev.target.files.length > 0) {
                        window.dispatchEvent(new CustomEvent('app:load-audio', { detail: { file: ev.target.files[0], trackId: track.id } }));
                    }
                };
                inp.click();
            };
            row1.appendChild(upBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.className = "text-gray-600 hover:text-red-500 p-1 text-[10px]";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (!confirm('Delete?')) return;
            const trackId = track.id;
            deps.stateManager?.update(draft => {
                draft.project.tracks = draft.project.tracks.filter(t => t.id !== trackId);
                draft.isDirty = true;
            });
            buildTimeline();
        };
        row1.appendChild(delBtn); 
        h.appendChild(row1); 

        if (track.type === 'led') {
             const row2 = document.createElement('div'); row2.className = "w-full mt-1";
             const sel = document.createElement('select'); sel.className = "w-full bg-neutral-800 text-[10px] text-gray-300 border border-gray-700 rounded px-1 py-0.5";
             const propGroups = project.propGroups || [];
             propGroups.forEach(grp => {
                 const opt = document.createElement('option'); opt.value = grp.id; opt.innerText = grp.name;
                 if (track.groupId === grp.id) opt.selected = true;
                 sel.appendChild(opt);
             });
             const trackId = track.id;
             sel.onchange = (e) => {
                 const groupId = e.target.value;
                 deps.stateManager?.update(draft => {
                     const t = draft.project.tracks.find(x => x.id === trackId);
                     if (t) {
                         t.groupId = groupId;
                         draft.isDirty = true;
                     }
                 });
             };
             row2.appendChild(sel); h.appendChild(row2);
        }
        deps.elements.trackHeaders.appendChild(h);

        const lane = document.createElement('div');
        lane.className = 'track-lane ' + (track.type==='audio'?'audio-lane':'');
        lane.dataset.trackId = track.id;
        track.clips.forEach(clip => lane.appendChild(createClipElement(clip)));
        
        lane.ondragover = e => e.preventDefault();
        lane.ondragenter = () => lane.classList.add('drag-over');
        lane.ondragleave = (e) => {
            // Only remove if leaving the lane itself, not entering a child
            if (!lane.contains(e.relatedTarget)) lane.classList.remove('drag-over');
        };
        lane.ondrop = e => {
            e.preventDefault();
            lane.classList.remove('drag-over');
            window.dispatchEvent(new CustomEvent('app:drop-clip', { detail: { event: e, trackId: track.id } }));
        };
        container.appendChild(lane);
    });
    drawRuler(); updateGridBackground();
}

function createClipElement(clip) {
    const el = document.createElement('div');
    el.id = `clip-${clip.id}`;
    const zoom = getZoom();
    el.style.left = `${(clip.startTime/1000)*zoom}px`;
    el.style.width = `${(clip.duration/1000)*zoom}px`;
    el.dataset.clipId = clip.id;
    const isSelected = getSelection().includes(clip.id);
    el.className = `clip ${clip.type==='audio'?'audio-clip bg-orange-900':'bg-'+clip.type} ${isSelected?'selected':''}`;
    el.innerHTML = `<div class="clip-handle left"></div><div class="clip-handle right"></div>`;
    
    if (clip.type==='audio') {
        const lbl = document.createElement('div'); lbl.className="clip-label"; lbl.innerHTML=`<i class="fas fa-music"></i> ${clip.props.name}`;
        el.appendChild(lbl);
        const cvs = document.createElement('canvas'); 
        cvs.className="clip-waveform absolute top-0 left-0 w-full h-full opacity-50 pointer-events-none";
        cvs.width = Math.max(10, (clip.duration / 1000) * zoom);
        cvs.height = 80; 
        el.appendChild(cvs);
        const assets = getAssets();
        if (clip.bufferId && assets[clip.bufferId]) {
            drawClipWaveform(cvs, assets[clip.bufferId], '#d97706', clip.duration);
        }
    } else {
        el.appendChild(document.createTextNode(clip.type.toUpperCase()));
    }
    el.onmousedown = (e) => { 
        e.stopPropagation(); 
        window.dispatchEvent(new CustomEvent('app:clip-mousedown', { detail: { event: e, clipId: clip.id } })); 
    };
    return el;
}

function drawClipWaveform(canvas, buffer, color, durationMs) {
    const ctx = canvas.getContext('2d');
    const data = buffer.getChannelData(0);
    const totalSeconds = durationMs / 1000;
    const endSample = Math.min(Math.floor(totalSeconds * buffer.sampleRate), data.length);
    const step = Math.ceil(endSample / canvas.width);
    const amp = canvas.height / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0; let max = -1.0;
        const startIdx = i * step;
        for (let j = 0; j < step; j++) {
            const idx = startIdx + j;
            if (idx < endSample) {
                const datum = data[idx];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
        }
        ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
}

function drawRuler() {
    const ruler = deps.elements.ruler || document.getElementById('ruler');
    const handle = deps.elements.playheadHandle || document.getElementById('playhead-handle');
    if(!ruler) return;
    
    ruler.innerHTML = ''; 
    if(handle) ruler.appendChild(handle);
    
    const dur = getProject()?.duration || 60000;
    const durSecs = Math.ceil(dur/1000);
    const zoom = getZoom();
    const rulerWidth = (dur / 1000) * zoom + 500;
    ruler.style.width = `${rulerWidth}px`;
    ruler.style.minWidth = `${rulerWidth}px`;

    for (let i = 0; i <= durSecs; i++) {
        const tick = document.createElement('div');
        tick.style.cssText = `position:absolute;left:${i*zoom}px;bottom:0;height:${i%5===0?'15px':'8px'};border-left:1px solid #777;`;
        if (i%5===0) { tick.innerText = `${i}s`; tick.style.fontSize='10px'; tick.style.color='#777'; tick.style.paddingLeft='3px'; }
        ruler.appendChild(tick);
    }
}

export function selectClip(id) {
    if (id === null) {
        setSelection([]);
    } else {
        setSelection([id]);
    }
    updateSelectionUI();
}

export function updateSelectionUI() {
    const selection = getSelection();
    document.querySelectorAll('.clip').forEach(el => {
        const isSel = selection.includes(el.dataset.clipId);
        el.classList.toggle('selected', isSel);
    });
    if (selection.length === 1) populateInspector(selection[0]);
    else populateInspector(null);
}

// --- Sync Patch Map Logic ---
function computePatchFromProfiles(profiles) {
    const patch = {};
    if (!profiles) return patch;
    profiles.forEach(p => {
        if (!p?.assignedIds) return;
        const ids = parseIdString(p.assignedIds);
        ids.forEach(id => { patch[String(id)] = p.id; });
    });
    return patch;
}

const rebuildPatch = () => {
    deps.stateManager?.update(draft => {
        const profiles = draft.project?.settings?.profiles || [];
        draft.project.settings.patch = computePatchFromProfiles(profiles);
        draft.isDirty = true;
    }, { skipHistory: true });
};

export function populateInspector(clipId) {
    const container = deps.elements.inspector || document.getElementById('inspector-content');
    if (!container) return;
    container.innerHTML = '';

    const project = getProject();
    if (!project) return;

    // --- CASE 1: MULTIPLE SELECTION ---
    const selection = getSelection();
    if (selection.length > 1) {
        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-gray-700 pb-2">MULTIPLE CLIPS</div>`;
        container.insertAdjacentHTML('beforeend', `<div class="text-xs text-gray-500 italic mb-4">${selection.length} clips selected</div>`);
        const del = document.createElement('button'); del.innerText="Delete Selected"; del.className="w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs";
        del.onclick = () => { 
            if (deps.timelineController?.deleteSelected) {
                deps.timelineController.deleteSelected();
            } else {
                deps.stateManager?.update(draft => {
                    draft.project.tracks.forEach(t => t.clips = t.clips.filter(c => !selection.includes(c.id)));
                    draft.selection = [];
                    draft.isDirty = true;
                });
            }
            buildTimeline();
            updateSelectionUI();
        };
        container.appendChild(del);
        return;
    }

    // --- CASE 2: NO SELECTION (GLOBAL SETTINGS) ---
    if (!clipId) {
        // --- SAFEGUARD ---
        if (!project.settings?.profiles || !project.settings?.patch) {
            deps.stateManager?.update(draft => {
                if (!draft.project.settings.profiles) {
                    draft.project.settings.profiles = [{ id: 'p_def', name: 'Standard Prop', ledCount: 164, assignedIds: '1-164' }];
                }
                if (!draft.project.settings.patch) {
                    draft.project.settings.patch = computePatchFromProfiles(draft.project.settings.profiles);
                }
            }, { skipHistory: true });
        }

        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-gray-700 pb-2">PROJECT SETTINGS</div>`;
        
        // --- Project Info ---
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Project Info</div>`);
        const infoDiv = document.createElement('div'); 
        infoDiv.className = "bg-neutral-800 p-2 rounded mb-4 border border-gray-700";
        
        const nameLbl = document.createElement('label'); nameLbl.className="block text-xs text-gray-500 mb-1"; nameLbl.innerText="Project Name"; infoDiv.appendChild(nameLbl);
        const nameInp = document.createElement('input'); nameInp.className = "w-full bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1 outline-none mb-3";
        const pName = project.name || "My Show"; nameInp.setAttribute('value', pName); nameInp.value = pName;
        nameInp.oninput = (e) => {
            const next = e.target.value;
            deps.stateManager?.update(draft => {
                draft.project.name = next;
                draft.isDirty = true;
            }, { skipHistory: true });
        };
        infoDiv.appendChild(nameInp); 

        const durLbl = document.createElement('label'); durLbl.className="block text-xs text-gray-500 mb-1"; durLbl.innerText="Duration (Seconds)"; infoDiv.appendChild(durLbl);
        const durRow = document.createElement('div'); durRow.className = "flex gap-2";
        const durInp = document.createElement('input'); durInp.type = "number"; durInp.min = "1";
        durInp.className = "flex-1 bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1 outline-none";
        const secs = Math.ceil((project.duration || 60000) / 1000);
        durInp.setAttribute('value', secs); durInp.value = secs;
        const updateBtn = document.createElement('button');
        updateBtn.className = "px-3 py-1 bg-neutral-800 border border-gray-600 rounded text-xs text-gray-300 hover:bg-neutral-700 cursor-pointer";
        updateBtn.innerText = "Set";
        updateBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            let val = parseInt(durInp.value);
            if (isNaN(val) || val < 1) val = 60;
            deps.stateManager?.update(draft => {
                draft.project.duration = val * 1000;
                draft.isDirty = true;
            });
            buildTimeline();
            toast(`Duration set to ${val}s`);
        });
        durRow.appendChild(durInp); durRow.appendChild(updateBtn); infoDiv.appendChild(durRow);

        const autoSaveDiv = document.createElement('div');
        autoSaveDiv.className = "flex items-center gap-2 mt-3 pt-2 border-t border-gray-700";
        const asCheck = document.createElement('input'); 
        asCheck.type = "checkbox"; 
        asCheck.className = "accent-cyan-500 cursor-pointer";
        const autoSaveEnabled = deps.stateManager?.get('autoSaveEnabled');
        asCheck.checked = (autoSaveEnabled !== undefined) ? autoSaveEnabled : true;
        asCheck.onchange = (e) => { 
            const enabled = e.target.checked;
            deps.stateManager?.update(draft => {
                draft.autoSaveEnabled = enabled;
            }, { skipHistory: true });
            toast(`Auto Save: ${enabled ? 'ON' : 'OFF'}`);
        };
        const asLabel = document.createElement('label');
        asLabel.innerText = "Enable Auto-Save";
        asLabel.className = "text-xs text-gray-300";
        autoSaveDiv.appendChild(asCheck);
        autoSaveDiv.appendChild(asLabel);
        infoDiv.appendChild(autoSaveDiv);
        container.appendChild(infoDiv);

        // --- Hardware Profiles (Styled like Groups) ---
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Hardware Profiles</div>`);
        
        const profiles = (deps.stateManager?.get('project.settings.profiles') || []);
        profiles.forEach((profile, idx) => {
            const card = document.createElement('div'); 
            card.className = "bg-neutral-800 p-2 rounded mb-2 border border-gray-700 relative group";

            // Row 1: Name (Editable) + Delete
            const row1 = document.createElement('div'); 
            row1.className = "flex justify-between items-center mb-1";
            
            const pName = document.createElement('input'); 
            pName.className = "bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            pName.setAttribute('value', profile.name || "Profile"); 
            pName.value = profile.name || "Profile";
            const profileId = profile.id;
            pName.oninput = (e) => {
                const next = e.target.value;
                deps.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profileId);
                    if (p) {
                        p.name = next;
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
            };
            
            row1.appendChild(pName);

            if (profiles.length > 1) {
                const del = document.createElement('button'); 
                del.innerHTML = "<i class='fas fa-times'></i>"; 
                del.className = "text-gray-500 hover:text-red-500";
                del.onclick = () => {
                    deps.stateManager?.update(draft => {
                        draft.project.settings.profiles = (draft.project.settings.profiles || []).filter(p => p.id !== profileId);
                        draft.project.settings.patch = computePatchFromProfiles(draft.project.settings.profiles);
                        draft.isDirty = true;
                    });
                    populateInspector(null);
                };
                row1.appendChild(del);
            }
            card.appendChild(row1);

            // Row 2: LED Count
            const row2 = document.createElement('div'); 
            row2.className = "flex items-center mb-1";
            row2.innerHTML = `<span class="text-xs text-gray-500 mr-2 w-16">LED Count:</span>`;
            
            const cInp = document.createElement('input'); 
            cInp.type = "number"; 
            cInp.className = "bg-neutral-900 text-xs text-cyan-300 rounded px-1 py-0.5 flex-1 outline-none border border-gray-700";
            cInp.value = profile.ledCount;
            cInp.onchange = (e) => {
                const next = parseInt(e.target.value) || 10;
                deps.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profileId);
                    if (p) {
                        p.ledCount = next;
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
            };
            
            row2.appendChild(cInp);
            card.appendChild(row2);

            // Row 3: Assigned IDs (Patch)
            const row3 = document.createElement('div'); 
            row3.className = "flex items-center";
            row3.innerHTML = `<span class="text-xs text-gray-500 mr-2 w-16">IDs:</span>`;
            
            const idInp = document.createElement('input'); 
            idInp.className = "bg-neutral-900 text-xs text-gray-300 rounded px-1 py-0.5 flex-1 outline-none border border-gray-700 font-mono";
            idInp.value = profile.assignedIds || "";
            idInp.placeholder = "1-10, 15";
            idInp.oninput = (e) => { 
                const next = e.target.value;
                deps.stateManager?.update(draft => {
                    const p = (draft.project.settings.profiles || []).find(x => x.id === profileId);
                    if (!p) return;
                    p.assignedIds = next;
                    draft.project.settings.patch = computePatchFromProfiles(draft.project.settings.profiles);
                    draft.isDirty = true;
                }, { skipHistory: true });
            };
            
            row3.appendChild(idInp);
            card.appendChild(row3);

            container.appendChild(card);
        });

        // Add Profile Button
        const addBtn = document.createElement('button'); 
        addBtn.className = "w-full py-1.5 bg-neutral-800 border border-gray-600 rounded text-xs text-gray-300 hover:bg-neutral-700 mb-4";
        addBtn.innerHTML = "<i class='fas fa-plus mr-1'></i> Add Profile";
        addBtn.onclick = () => {
            deps.stateManager?.update(draft => {
                if (!draft.project.settings.profiles) draft.project.settings.profiles = [];
                draft.project.settings.profiles.push({
                    id: 'p_' + Date.now(),
                    name: 'New Hardware',
                    ledCount: 164,
                    assignedIds: ''
                });
                draft.project.settings.patch = computePatchFromProfiles(draft.project.settings.profiles);
                draft.isDirty = true;
            });
            populateInspector(null);
        };
        container.appendChild(addBtn);

        // Global Brightness (still global)
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Global Settings</div>`);
        const bDiv = document.createElement('div'); bDiv.className = "bg-neutral-800 p-2 rounded mb-4 border border-gray-700";
        bDiv.innerHTML = `<label class="block text-xs text-gray-500 mb-1">Master Brightness (0-255)</label>`;
        const bInp = document.createElement('input'); bInp.type="number"; bInp.className="w-full bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1";
        bInp.value = project.settings?.brightness ?? 255;
        bInp.oninput = (e) => {
            const next = parseInt(e.target.value) || 0;
            deps.stateManager?.update(draft => {
                draft.project.settings.brightness = next;
                draft.isDirty = true;
            }, { skipHistory: true });
        };
        bDiv.appendChild(bInp);
        container.appendChild(bDiv);

        // Groups
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Prop Groups</div>`);
        const propGroups = (project.propGroups || []);
        propGroups.forEach((grp, idx) => {
            const card = document.createElement('div'); card.className = "bg-neutral-800 p-2 rounded mb-2 border border-gray-700";
            const row1 = document.createElement('div'); row1.className="flex justify-between mb-1";
            const gName = document.createElement('input'); gName.className="bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            gName.setAttribute('value', grp.name || ""); gName.value = grp.name || "";
            const groupId = grp.id;
            gName.oninput = e => {
                const next = e.target.value;
                deps.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === groupId);
                    if (g) {
                        g.name = next;
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
                buildTimeline();
            };
            const del = document.createElement('button'); del.innerHTML="<i class='fas fa-times'></i>"; del.className="text-gray-500 hover:text-red-500";
            del.onclick = () => {
                deps.stateManager?.update(draft => {
                    draft.project.propGroups = (draft.project.propGroups || []).filter(g => g.id !== groupId);
                    draft.isDirty = true;
                });
                populateInspector(null);
                buildTimeline();
            };
            row1.appendChild(gName); row1.appendChild(del); card.appendChild(row1);
            const row2 = document.createElement('div'); row2.innerHTML=`<span class="text-xs text-gray-500 mr-2">IDs:</span>`;
            const ids = document.createElement('input'); ids.className="bg-neutral-900 text-xs text-gray-300 rounded px-1 py-0.5 flex-1 outline-none border border-gray-700";
            ids.setAttribute('value', grp.ids || ""); ids.value = grp.ids || "";
            ids.oninput = e => {
                const next = e.target.value;
                deps.stateManager?.update(draft => {
                    const g = (draft.project.propGroups || []).find(x => x.id === groupId);
                    if (g) {
                        g.ids = next;
                        draft.isDirty = true;
                    }
                }, { skipHistory: true });
            };
            row2.appendChild(ids); card.appendChild(row2);
            container.appendChild(card);
        });
        const addGrpBtn = document.createElement('button'); addGrpBtn.innerText="+ Add Group"; addGrpBtn.className="w-full py-1.5 mt-2 bg-neutral-800 border border-gray-600 rounded text-xs text-gray-300 hover:bg-neutral-700";
        addGrpBtn.onclick = () => {
            deps.stateManager?.update(draft => {
                if (!draft.project.propGroups) draft.project.propGroups = [];
                draft.project.propGroups.push({id:'g_'+Date.now(), name:'New Group', ids:''});
                draft.isDirty = true;
            });
            populateInspector(null);
        };
        container.appendChild(addGrpBtn);
        return;
    }

    // --- CASE 3: SINGLE CLIP (EDIT PROPS) ---
    let clip = null;
    project.tracks.forEach(t => { const c = t.clips.find(x => x.id === clipId); if(c) clip = c; });
    if (!clip) return;

    container.innerHTML = `<div class="font-bold text-white mb-4 border-b border-gray-700 pb-2">${clip.type.toUpperCase()} CLIP</div>`;

    // Special handling for audio clips
    if (clip.type === 'audio') {
        const audioInfo = document.createElement('div');
        audioInfo.className = 'bg-neutral-800 p-3 rounded mb-4 border border-orange-900';

        const fileName = clip.props?.name || 'Unknown audio';
        const volume = clip.props?.volume ?? 1;

        audioInfo.innerHTML = `
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-music text-orange-400"></i>
                <span class="text-sm text-white font-medium">${fileName}</span>
            </div>
            <div class="text-xs text-gray-400 mb-3">
                Duration: ${(clip.duration / 1000).toFixed(2)}s
            </div>
            <label class="block text-xs text-gray-400 mb-1">Volume</label>
            <div class="flex items-center gap-2">
                <input type="range" min="0" max="1" step="0.01" value="${volume}"
                    class="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    id="audio-volume-slider">
                <span class="text-xs text-gray-400 w-10 text-right" id="audio-volume-display">${Math.round(volume * 100)}%</span>
            </div>
        `;
        container.appendChild(audioInfo);

        // Wire up volume slider
        const slider = audioInfo.querySelector('#audio-volume-slider');
        const display = audioInfo.querySelector('#audio-volume-display');
        slider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            display.textContent = `${Math.round(val * 100)}%`;
            deps.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clipId);
                    if (c) {
                        if (!c.props) c.props = {};
                        c.props.volume = val;
                    }
                });
                draft.isDirty = true;
            }, { skipHistory: true });
            deps.audioService?.setClipVolume?.(clipId, val);
        };
    }

    const addInp = (lbl, val, cb) => {
        const d = document.createElement('div'); d.className="mb-2"; d.innerHTML=`<label class="block text-xs text-gray-400 mb-1">${lbl}</label>`;
        const inp = document.createElement('input'); 
        
        if (typeof val === 'string' && val.startsWith('#')) {
            inp.type = 'color';
            inp.className = "w-full h-8 bg-neutral-900 border border-gray-700 rounded cursor-pointer p-0";
        } else if (typeof val === 'number') {
            inp.type = 'number';
            inp.step = '0.1';
            inp.className = "w-full bg-neutral-900 border border-gray-700 rounded px-2 py-1 text-sm text-white";
        } else {
            inp.type = 'text';
            inp.className = "w-full bg-neutral-900 border border-gray-700 rounded px-2 py-1 text-sm text-white";
        }

        const safeVal = (val !== undefined) ? val : "";
        inp.setAttribute('value', safeVal); inp.value = safeVal;
        inp.oninput = cb; d.appendChild(inp); container.appendChild(d);
    }
    addInp("Start Time", clip.startTime, e => {
        const next = parseFloat(e.target.value);
        deps.stateManager?.update(draft => {
            draft.project.tracks.forEach(t => {
                const c = t.clips.find(x => x.id === clipId);
                if (c) c.startTime = next;
            });
            draft.isDirty = true;
        });
        buildTimeline();
    });
    addInp("Duration", clip.duration, e => {
        const next = parseFloat(e.target.value);
        deps.stateManager?.update(draft => {
            draft.project.tracks.forEach(t => {
                const c = t.clips.find(x => x.id === clipId);
                if (c) c.duration = next;
            });
            draft.isDirty = true;
        });
        buildTimeline();
    });

    if (clip.type === 'rainbowHold') {
        addInp("Frequency", clip.props.frequency || 1, e => {
            const next = parseFloat(e.target.value);
            deps.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clipId);
                    if (c) c.props.frequency = next;
                });
                draft.isDirty = true;
            });
            renderPreview();
        });
    }

    Object.keys(clip.props).forEach(key => {
        // Skip props that have special handling above
        if (key === 'audioSrcPath' || key === 'name') return;
        if (key === 'frequency' && clip.type === 'rainbowHold') return;
        if (key === 'volume' && clip.type === 'audio') return;
        addInp(key, clip.props[key], e => {
            const next = (e.target.type === 'number') ? parseFloat(e.target.value) : e.target.value;
            deps.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => {
                    const c = t.clips.find(x => x.id === clipId);
                    if (c) c.props[key] = next;
                });
                draft.isDirty = true;
            });
            renderPreview();
        });
    });
    const del = document.createElement('button'); del.innerText="Delete Clip"; del.className="w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs mt-4";
    del.onclick = () => { 
        if (deps.timelineController?.deleteClip) {
            deps.timelineController.deleteClip(clipId);
        } else {
            deps.stateManager?.update(draft => {
                draft.project.tracks.forEach(t => t.clips = t.clips.filter(c => c.id !== clipId));
                draft.selection = [];
                draft.isDirty = true;
            });
        }
        updateSelectionUI();
        buildTimeline();
    };
    container.appendChild(del);
}
