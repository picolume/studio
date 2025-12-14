import { STATE, els } from './stateBridge.js';
import { CONFIG, getSnappedTime, lerpColor, hslToRgb, hexToRgb, pseudoRandom, parseIdString } from './utils.js';

let saveStateForUndoRef = () => {}; 
let showToastRef = () => {};

export function setCallbacks(saveUndoFn, showToastFn) {
    saveStateForUndoRef = saveUndoFn;
    showToastRef = showToastFn;
}

function triggerToast(msg) {
    window.dispatchEvent(new CustomEvent('app:toast', { detail: msg }));
}

export function updateGridBackground() {
    const content = els.timelineContent || document.getElementById('timeline-content');
    if (!content) return;
    const pixelsPerGrid = (STATE.gridSize / 1000) * STATE.zoom;
    content.style.backgroundSize = `${pixelsPerGrid}px 100%`;
    content.classList.toggle('grid-hidden', !STATE.snapEnabled);
}

export function updateTimeDisplay() {
    if (!els.timeDisplay) return;
    const totalSec = Math.max(0, STATE.currentTime / 1000);
    const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const sec = Math.floor(totalSec % 60).toString().padStart(2, '0');
    const ms = Math.floor((totalSec % 1) * 100).toString().padStart(2, '0');
    els.timeDisplay.innerText = `${min}:${sec}.${ms}`;
}

export function updatePlayheadUI() {
    const x = (STATE.currentTime / 1000) * STATE.zoom;
    if (els.playheadLine) els.playheadLine.style.transform = `translateX(${x}px)`;
    if (els.playheadHandle) els.playheadHandle.style.transform = `translateX(${x}px)`;
    
    const scroll = els.timelineScroll || document.getElementById('timeline-scroll-area');
    if (STATE.isPlaying && scroll) {
        if (x > scroll.scrollLeft + scroll.clientWidth - 50) {
            scroll.scrollLeft = x - 50;
        }
    }
}

export function renderPreview() {
    const now = performance.now();
    if (STATE.isPlaying && now - STATE.lastPreviewRender < CONFIG.previewThrottleMs) return;
    STATE.lastPreviewRender = now;

    const canvas = els.previewCanvas || document.getElementById('preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    if (!STATE.project || !STATE.project.tracks) return;
    const ledTracks = STATE.project.tracks.filter(t => t.type === 'led');

    if (ledTracks.length === 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }

    const trackHeight = h / ledTracks.length;
    const ledSpacing = w / CONFIG.ledsPerTrack;
    const ledRadius = Math.min(ledSpacing / 2.5, trackHeight / 3);

    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

    ledTracks.forEach((track, tIndex) => {
        const activeClips = track.clips.filter(c => STATE.currentTime >= c.startTime && STATE.currentTime < (c.startTime + c.duration))
            .sort((a, b) => a.startTime - b.startTime);

        for (let i = 0; i < CONFIG.ledsPerTrack; i++) {
            let color = 'rgb(30,30,30)';
            let glow = false;

            if (activeClips.length > 0) {
                const clip = activeClips[activeClips.length - 1];
                const localTime = STATE.currentTime - clip.startTime;
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
    const content = els.timelineContent || document.getElementById('timeline-content');
    const headers = els.trackHeaders || document.getElementById('track-headers');
    const container = els.tracksContainer || document.getElementById('tracks-container');
    const ruler = els.ruler || document.getElementById('ruler');

    if (!content || !headers || !container) return;
    
    const dur = STATE.project.duration || 60000;
    const zoom = STATE.zoom || 50;
    const newWidth = (dur/1000) * zoom + 500;
    
    content.style.width = `${newWidth}px`;
    content.style.minWidth = `${newWidth}px`;
    if(ruler) { ruler.style.width = `${newWidth}px`; ruler.style.minWidth = `${newWidth}px`; }
    if(container) { container.style.width = `${newWidth}px`; container.style.minWidth = `${newWidth}px`; }

    headers.innerHTML = ''; 
    container.innerHTML = '';

    if (!STATE.project.tracks) STATE.project.tracks = [];

    STATE.project.tracks.forEach((track, index) => {
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
                saveStateForUndoRef('Reorder Tracks');
                const moved = STATE.project.tracks.splice(fromIndex, 1)[0];
                STATE.project.tracks.splice(index, 0, moved);
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
            const save = () => { if(inp.value.trim()) { saveStateForUndoRef('Rename'); track.label=inp.value.trim(); buildTimeline(); } };
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
        delBtn.onclick = (e) => { e.stopPropagation(); if(confirm('Delete?')) { saveStateForUndoRef('Del Track'); STATE.project.tracks=STATE.project.tracks.filter(t=>t.id!==track.id); buildTimeline(); }};
        row1.appendChild(delBtn); 
        h.appendChild(row1); 

        if (track.type === 'led') {
             const row2 = document.createElement('div'); row2.className = "w-full mt-1";
             const sel = document.createElement('select'); sel.className = "w-full bg-neutral-800 text-[10px] text-gray-300 border border-gray-700 rounded px-1 py-0.5";
             if (!STATE.project.propGroups) STATE.project.propGroups = [];
             STATE.project.propGroups.forEach(grp => {
                 const opt = document.createElement('option'); opt.value = grp.id; opt.innerText = grp.name;
                 if (track.groupId === grp.id) opt.selected = true;
                 sel.appendChild(opt);
             });
             sel.onchange = (e) => { saveStateForUndoRef('Grp Change'); track.groupId = e.target.value; };
             row2.appendChild(sel); h.appendChild(row2);
        }
        els.trackHeaders.appendChild(h);

        const lane = document.createElement('div');
        lane.className = 'track-lane ' + (track.type==='audio'?'audio-lane':'');
        lane.dataset.trackId = track.id;
        track.clips.forEach(clip => lane.appendChild(createClipElement(clip)));
        
        lane.ondragover = e => e.preventDefault();
        lane.ondrop = e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('app:drop-clip', { detail: { event: e, trackId: track.id } })); };
        container.appendChild(lane);
    });
    drawRuler(); updateGridBackground();
}

function createClipElement(clip) {
    const el = document.createElement('div');
    el.id = `clip-${clip.id}`;
    el.style.left = `${(clip.startTime/1000)*STATE.zoom}px`;
    el.style.width = `${(clip.duration/1000)*STATE.zoom}px`;
    el.dataset.clipId = clip.id;
    const isSelected = STATE.selection.includes(clip.id);
    el.className = `clip ${clip.type==='audio'?'audio-clip bg-orange-900':'bg-'+clip.type} ${isSelected?'selected':''}`;
    el.innerHTML = `<div class="clip-handle left"></div><div class="clip-handle right"></div>`;
    
    if (clip.type==='audio') {
        const lbl = document.createElement('div'); lbl.className="clip-label"; lbl.innerHTML=`<i class="fas fa-music"></i> ${clip.props.name}`;
        el.appendChild(lbl);
        const cvs = document.createElement('canvas'); 
        cvs.className="clip-waveform absolute top-0 left-0 w-full h-full opacity-50 pointer-events-none";
        cvs.width = Math.max(10, (clip.duration / 1000) * STATE.zoom);
        cvs.height = 80; 
        el.appendChild(cvs);
        if (clip.bufferId && STATE.assets[clip.bufferId]) {
            drawClipWaveform(cvs, STATE.assets[clip.bufferId], '#d97706', clip.duration);
        }
    } else {
        el.appendChild(document.createTextNode(clip.type.toUpperCase()));
    }
    el.onmousedown = (e) => { 
        e.stopPropagation(); 
        window.dispatchEvent(new CustomEvent('app:clip-mousedown', { detail: { event: e, clip: clip } })); 
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
    const ruler = els.ruler || document.getElementById('ruler');
    const handle = els.playheadHandle || document.getElementById('playhead-handle');
    if(!ruler) return;
    
    ruler.innerHTML = ''; 
    if(handle) ruler.appendChild(handle);
    
    const dur = STATE.project.duration || 60000;
    const durSecs = Math.ceil(dur/1000);
    const zoom = STATE.zoom || 50;
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
        STATE.selection = [];
    } else {
        STATE.selection = [id];
    }
    updateSelectionUI();
}

export function updateSelectionUI() {
    document.querySelectorAll('.clip').forEach(el => {
        const isSel = STATE.selection.includes(el.dataset.clipId);
        el.classList.toggle('selected', isSel);
    });
    if (STATE.selection.length === 1) populateInspector(STATE.selection[0]);
    else populateInspector(null);
}

// --- NEW: Sync Patch Map Logic ---
const rebuildPatch = () => {
    STATE.project.settings.patch = {};
    if (!STATE.project.settings.profiles) return;
    
    STATE.project.settings.profiles.forEach(p => {
        if(!p.assignedIds) return;
        const ids = parseIdString(p.assignedIds);
        ids.forEach(id => {
            // "Patch" the ID to this profile
            STATE.project.settings.patch[String(id)] = p.id;
        });
    });
};

export function populateInspector(clipId) {
    const container = els.inspector || document.getElementById('inspector-content');
    if (!container) return;
    container.innerHTML = '';

    // --- CASE 1: MULTIPLE SELECTION ---
    if (STATE.selection.length > 1) {
        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-gray-700 pb-2">MULTIPLE CLIPS</div>`;
        container.insertAdjacentHTML('beforeend', `<div class="text-xs text-gray-500 italic mb-4">${STATE.selection.length} clips selected</div>`);
        const del = document.createElement('button'); del.innerText="Delete Selected"; del.className="w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs";
        del.onclick = () => { 
            saveStateForUndoRef('Del Clips'); 
            STATE.project.tracks.forEach(t => t.clips = t.clips.filter(c => !STATE.selection.includes(c.id)));
            STATE.selection = [];
            buildTimeline(); updateSelectionUI();
        };
        container.appendChild(del);
        return;
    }

    // --- CASE 2: NO SELECTION (GLOBAL SETTINGS) ---
    if (!clipId) {
        // --- SAFEGUARD ---
        if (!STATE.project.settings.profiles) {
            STATE.project.settings.profiles = [{ id: 'p_def', name: 'Standard Prop', ledCount: 164, assignedIds: '1-164' }];
        }
        if (!STATE.project.settings.patch) STATE.project.settings.patch = {};

        container.innerHTML = `<div class="font-bold text-white mb-2 border-b border-gray-700 pb-2">PROJECT SETTINGS</div>`;
        
        // --- Project Info ---
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Project Info</div>`);
        const infoDiv = document.createElement('div'); 
        infoDiv.className = "bg-neutral-800 p-2 rounded mb-4 border border-gray-700";
        
        const nameLbl = document.createElement('label'); nameLbl.className="block text-xs text-gray-500 mb-1"; nameLbl.innerText="Project Name"; infoDiv.appendChild(nameLbl);
        const nameInp = document.createElement('input'); nameInp.className = "w-full bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1 outline-none mb-3";
        const pName = STATE.project.name || "My Show"; nameInp.setAttribute('value', pName); nameInp.value = pName;
        nameInp.oninput = (e) => { STATE.project.name = e.target.value; };
        infoDiv.appendChild(nameInp); 

        const durLbl = document.createElement('label'); durLbl.className="block text-xs text-gray-500 mb-1"; durLbl.innerText="Duration (Seconds)"; infoDiv.appendChild(durLbl);
        const durRow = document.createElement('div'); durRow.className = "flex gap-2";
        const durInp = document.createElement('input'); durInp.type = "number"; durInp.min = "1";
        durInp.className = "flex-1 bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1 outline-none";
        const secs = Math.ceil((STATE.project.duration || 60000) / 1000);
        durInp.setAttribute('value', secs); durInp.value = secs;
        const updateBtn = document.createElement('button');
        updateBtn.className = "px-3 py-1 bg-neutral-800 border border-gray-600 rounded text-xs text-gray-300 hover:bg-neutral-700 cursor-pointer";
        updateBtn.innerText = "Set";
        updateBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            let val = parseInt(durInp.value);
            if (isNaN(val) || val < 1) val = 60;
            saveStateForUndoRef('Edit Duration');
            STATE.project.duration = val * 1000;
            buildTimeline(); triggerToast(`Duration set to ${val}s`);
        });
        durRow.appendChild(durInp); durRow.appendChild(updateBtn); infoDiv.appendChild(durRow);

        const autoSaveDiv = document.createElement('div');
        autoSaveDiv.className = "flex items-center gap-2 mt-3 pt-2 border-t border-gray-700";
        const asCheck = document.createElement('input'); 
        asCheck.type = "checkbox"; 
        asCheck.className = "accent-cyan-500 cursor-pointer";
        asCheck.checked = (STATE.autoSaveEnabled !== undefined) ? STATE.autoSaveEnabled : true;
        asCheck.onchange = (e) => { 
            STATE.autoSaveEnabled = e.target.checked; 
            triggerToast(`Auto Save: ${STATE.autoSaveEnabled ? 'ON' : 'OFF'}`);
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
        
        STATE.project.settings.profiles.forEach((profile, idx) => {
            const card = document.createElement('div'); 
            card.className = "bg-neutral-800 p-2 rounded mb-2 border border-gray-700 relative group";

            // Row 1: Name (Editable) + Delete
            const row1 = document.createElement('div'); 
            row1.className = "flex justify-between items-center mb-1";
            
            const pName = document.createElement('input'); 
            pName.className = "bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            pName.setAttribute('value', profile.name || "Profile"); 
            pName.value = profile.name || "Profile";
            pName.oninput = (e) => { profile.name = e.target.value; };
            
            row1.appendChild(pName);

            if (STATE.project.settings.profiles.length > 1) {
                const del = document.createElement('button'); 
                del.innerHTML = "<i class='fas fa-times'></i>"; 
                del.className = "text-gray-500 hover:text-red-500";
                del.onclick = () => {
                    saveStateForUndoRef('Del Profile');
                    STATE.project.settings.profiles.splice(idx, 1);
                    rebuildPatch();
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
            cInp.onchange = (e) => { profile.ledCount = parseInt(e.target.value) || 10; };
            
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
                profile.assignedIds = e.target.value;
                rebuildPatch(); 
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
            saveStateForUndoRef('Add Profile');
            STATE.project.settings.profiles.push({
                id: 'p_' + Date.now(),
                name: 'New Hardware',
                ledCount: 164,
                assignedIds: ''
            });
            populateInspector(null);
        };
        container.appendChild(addBtn);

        // Global Brightness (still global)
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Global Settings</div>`);
        const bDiv = document.createElement('div'); bDiv.className = "bg-neutral-800 p-2 rounded mb-4 border border-gray-700";
        bDiv.innerHTML = `<label class="block text-xs text-gray-500 mb-1">Master Brightness (0-255)</label>`;
        const bInp = document.createElement('input'); bInp.type="number"; bInp.className="w-full bg-neutral-900 text-sm text-gray-300 border border-gray-700 rounded px-1 py-1";
        bInp.value = STATE.project.settings.brightness;
        bInp.oninput = (e) => { STATE.project.settings.brightness = parseInt(e.target.value) || 0; };
        bDiv.appendChild(bInp);
        container.appendChild(bDiv);

        // Groups
        container.insertAdjacentHTML('beforeend', `<div class="text-xs font-bold text-cyan-400 mb-2 uppercase">Prop Groups</div>`);
        if(!STATE.project.propGroups) STATE.project.propGroups = [];
        STATE.project.propGroups.forEach((grp, idx) => {
            const card = document.createElement('div'); card.className = "bg-neutral-800 p-2 rounded mb-2 border border-gray-700";
            const row1 = document.createElement('div'); row1.className="flex justify-between mb-1";
            const gName = document.createElement('input'); gName.className="bg-transparent text-sm font-bold text-white outline-none w-2/3 border-b border-transparent focus:border-cyan-500";
            gName.setAttribute('value', grp.name || ""); gName.value = grp.name || "";
            gName.oninput = e => { grp.name=e.target.value; buildTimeline(); };
            const del = document.createElement('button'); del.innerHTML="<i class='fas fa-times'></i>"; del.className="text-gray-500 hover:text-red-500";
            del.onclick = () => { saveStateForUndoRef('Del Grp'); STATE.project.propGroups.splice(idx,1); populateInspector(null); buildTimeline(); };
            row1.appendChild(gName); row1.appendChild(del); card.appendChild(row1);
            const row2 = document.createElement('div'); row2.innerHTML=`<span class="text-xs text-gray-500 mr-2">IDs:</span>`;
            const ids = document.createElement('input'); ids.className="bg-neutral-900 text-xs text-gray-300 rounded px-1 py-0.5 flex-1 outline-none border border-gray-700";
            ids.setAttribute('value', grp.ids || ""); ids.value = grp.ids || "";
            ids.oninput = e => { grp.ids=e.target.value; };
            row2.appendChild(ids); card.appendChild(row2);
            container.appendChild(card);
        });
        const addGrpBtn = document.createElement('button'); addGrpBtn.innerText="+ Add Group"; addGrpBtn.className="w-full py-1.5 mt-2 bg-neutral-800 border border-gray-600 rounded text-xs text-gray-300 hover:bg-neutral-700";
        addGrpBtn.onclick = () => { saveStateForUndoRef('Add Grp'); STATE.project.propGroups.push({id:'g_'+Date.now(), name:'New Group', ids:''}); populateInspector(null); };
        container.appendChild(addGrpBtn);
        return;
    }

    // --- CASE 3: SINGLE CLIP (EDIT PROPS) ---
    let clip = null;
    STATE.project.tracks.forEach(t => { const c = t.clips.find(x => x.id === clipId); if(c) clip = c; });
    if (!clip) return;

    container.innerHTML = `<div class="font-bold text-white mb-4 border-b border-gray-700 pb-2">${clip.type.toUpperCase()} CLIP</div>`;
    
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
    addInp("Start Time", clip.startTime, e => { saveStateForUndoRef('Time'); clip.startTime=parseFloat(e.target.value); buildTimeline(); });
    addInp("Duration", clip.duration, e => { saveStateForUndoRef('Dur'); clip.duration=parseFloat(e.target.value); buildTimeline(); });

    if (clip.type === 'rainbowHold') {
        addInp("Frequency", clip.props.frequency || 1, e => { saveStateForUndoRef('Prop'); clip.props.frequency=parseFloat(e.target.value); renderPreview(); });
    }

    Object.keys(clip.props).forEach(key => { 
        if(key!=='audioSrcPath' && key!=='name' && key!=='frequency') { 
            addInp(key, clip.props[key], e => { 
                saveStateForUndoRef('Prop'); 
                clip.props[key] = (e.target.type === 'number') ? parseFloat(e.target.value) : e.target.value; 
                renderPreview(); 
            }); 
        }
    });
    const del = document.createElement('button'); del.innerText="Delete Clip"; del.className="w-full bg-red-900 hover:bg-red-800 text-red-100 py-1 rounded text-xs mt-4";
    del.onclick = () => { 
        saveStateForUndoRef('Del Clip'); 
        STATE.project.tracks.forEach(t => t.clips=t.clips.filter(c=>c.id!==clip.id)); 
        STATE.selection = []; 
        updateSelectionUI();
        buildTimeline(); 
    };
    container.appendChild(del);
}