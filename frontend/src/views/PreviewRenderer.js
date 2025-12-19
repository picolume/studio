import { CONFIG, hslToRgb, hexToRgb, pseudoRandom, parseIdString } from '../utils.js';

// Field view constants
const FIELD_PROP_RADIUS = 16;        // Outer radius of the LED ring
const FIELD_LED_COUNT = 12;          // Number of LEDs in each ring
const FIELD_LED_RADIUS = 3;          // Radius of each individual LED dot
const FIELD_INNER_RADIUS = 7;        // Inner dark circle radius (for label)
const FIELD_GRID_COLS = 6;
const FIELD_GRID_SPACING = 70;
const FIELD_GRID_OFFSET = 50;
const FIELD_BACKGROUND = '#0a0a0a';

export class PreviewRenderer {
    constructor(deps) {
        this.deps = deps;
        this._dragState = null; // { propId, offsetX, offsetY }
    }

    get stateManager() { return this.deps.stateManager; }
    get elements() { return this.deps.elements; }

    render() {
        const canvas = this.elements.previewCanvas || document.getElementById('preview-canvas');
        if (!canvas) return;

        const mode = this.stateManager.get('ui.previewMode') || 'track';

        switch (mode) {
            case 'off':
                this._renderOff(canvas);
                break;
            case 'field':
                this._renderField(canvas);
                break;
            case 'track':
            default:
                this._renderTrack(canvas);
                break;
        }
    }

    _renderOff(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Preview disabled', canvas.width / 2, canvas.height / 2);
    }

    _renderTrack(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d');

        const project = this.stateManager.get('project');
        if (!project?.tracks) return;

        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        const ledTracks = project.tracks.filter(t => t.type === 'led');

        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

        if (ledTracks.length === 0) return;

        // Use 2/3 of width for the LED strip, centered
        const stripWidth = w * 0.67;
        const stripStartX = (w - stripWidth) / 2;

        // Use a maximum track height so tracks stay compact
        const maxTrackHeight = 50;
        const trackHeight = Math.min(maxTrackHeight, h / ledTracks.length);

        // Calculate total height of all tracks and center vertically
        const totalTracksHeight = trackHeight * ledTracks.length;
        const startY = (h - totalTracksHeight) / 2;

        const ledSpacing = stripWidth / CONFIG.ledsPerTrack;
        const ledRadius = Math.min(ledSpacing / 2.5, trackHeight / 3);

        ledTracks.forEach((track, tIndex) => {
            const activeClips = track.clips.filter(c => currentTime >= c.startTime && currentTime < (c.startTime + c.duration))
                .sort((a, b) => a.startTime - b.startTime);

            for (let i = 0; i < CONFIG.ledsPerTrack; i++) {
                let color = 'rgb(30,30,30)';
                let glow = false;

                if (activeClips.length > 0) {
                    const clip = activeClips[activeClips.length - 1];
                    const localTime = currentTime - clip.startTime;
                    const result = this._getActiveColor(clip, localTime, i);
                    if (result) {
                        color = result.color;
                        glow = result.glow;
                    }
                }
                const x = stripStartX + i * ledSpacing + (ledSpacing / 2);
                const y = startY + tIndex * trackHeight + (trackHeight / 2);
                ctx.shadowBlur = glow ? 10 : 0; ctx.shadowColor = color;
                ctx.beginPath(); ctx.arc(x, y, ledRadius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            }
        });
    }

    _renderField(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = FIELD_BACKGROUND;
        ctx.fillRect(0, 0, w, h);

        const project = this.stateManager.get('project');
        if (!project?.tracks) return;

        const usedProps = this._getUsedProps(project);
        const currentTime = this.stateManager.get('playback.currentTime') || 0;
        const fieldLayout = project.settings?.fieldLayout || {};

        if (usedProps.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Add tracks with prop groups to see props', w / 2, h / 2);
            return;
        }

        // Draw each prop as an LED ring
        const totalProps = usedProps.length;
        usedProps.forEach((propId, index) => {
            const pos = this._getPropPosition(propId, index, fieldLayout, w, h, totalProps);
            const ledColors = this._getPropLedColors(propId, project, currentTime);

            // Draw outer ring background (subtle)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, FIELD_PROP_RADIUS + 2, 0, Math.PI * 2);
            ctx.fillStyle = '#1a1a1a';
            ctx.fill();

            // Draw each LED in the ring
            for (let i = 0; i < FIELD_LED_COUNT; i++) {
                const angle = (i / FIELD_LED_COUNT) * Math.PI * 2 - Math.PI / 2; // Start from top
                const ledX = pos.x + Math.cos(angle) * FIELD_PROP_RADIUS;
                const ledY = pos.y + Math.sin(angle) * FIELD_PROP_RADIUS;
                const ledColor = ledColors[i];

                // LED glow
                ctx.shadowBlur = ledColor.glow ? 8 : 0;
                ctx.shadowColor = ledColor.color;

                // Draw LED dot
                ctx.beginPath();
                ctx.arc(ledX, ledY, FIELD_LED_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = ledColor.color;
                ctx.fill();
            }

            // Reset shadow
            ctx.shadowBlur = 0;

            // Draw inner dark circle (center)
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, FIELD_INNER_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#111';
            ctx.fill();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Draw prop ID label in center
            ctx.fillStyle = '#888';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(propId), pos.x, pos.y);
        });
    }

    // Get colors for all LEDs in a prop's ring
    _getPropLedColors(propId, project, currentTime) {
        const colors = [];
        const ledTracks = project.tracks.filter(t => t.type === 'led');

        // Find the clip affecting this prop
        let activeClip = null;
        let localTime = 0;

        for (const track of ledTracks) {
            if (!track.groupId) continue;

            const group = project.propGroups.find(g => g.id === track.groupId);
            if (!group) continue;

            const propIds = parseIdString(group.ids);
            if (!propIds.includes(propId)) continue;

            const activeClips = track.clips.filter(c =>
                currentTime >= c.startTime && currentTime < (c.startTime + c.duration)
            ).sort((a, b) => a.startTime - b.startTime);

            if (activeClips.length > 0) {
                activeClip = activeClips[activeClips.length - 1];
                localTime = currentTime - activeClip.startTime;
                break; // Use first matching track
            }
        }

        // Generate color for each LED in the ring
        for (let i = 0; i < FIELD_LED_COUNT; i++) {
            if (activeClip) {
                // Map ring LED index to strip LED index (scale to full strip)
                const stripIndex = Math.floor((i / FIELD_LED_COUNT) * CONFIG.ledsPerTrack);
                const result = this._getActiveColor(activeClip, localTime, stripIndex);
                colors.push(result);
            } else {
                colors.push({ color: 'rgb(25,25,25)', glow: false });
            }
        }

        return colors;
    }

    _getUsedProps(project) {
        const usedProps = new Set();
        const ledTracks = project.tracks.filter(t => t.type === 'led');

        ledTracks.forEach(track => {
            if (!track.groupId) return;

            const group = project.propGroups.find(g => g.id === track.groupId);
            if (!group) return;

            const propIds = parseIdString(group.ids);
            propIds.forEach(id => usedProps.add(id));
        });

        return Array.from(usedProps).sort((a, b) => a - b);
    }

    _getPropPosition(propId, index, fieldLayout, canvasWidth, canvasHeight, totalProps) {
        // Check if we have a saved position
        if (fieldLayout[propId]) {
            return fieldLayout[propId];
        }

        // Auto-fit: calculate grid dimensions to fit all props
        const padding = FIELD_PROP_RADIUS + 10; // Margin from edges
        const availableWidth = canvasWidth - padding * 2;
        const availableHeight = canvasHeight - padding * 2;

        // Calculate optimal columns to fit the canvas aspect ratio
        const aspectRatio = availableWidth / availableHeight;
        let cols = Math.ceil(Math.sqrt(totalProps * aspectRatio));
        let rows = Math.ceil(totalProps / cols);

        // Ensure we have at least 1 column and row
        cols = Math.max(1, cols);
        rows = Math.max(1, rows);

        // Calculate spacing (minimum spacing to prevent overlap)
        const minSpacing = FIELD_PROP_RADIUS * 2 + 8;
        const spacingX = Math.max(minSpacing, availableWidth / Math.max(1, cols));
        const spacingY = Math.max(minSpacing, availableHeight / Math.max(1, rows));

        // Calculate position
        const col = index % cols;
        const row = Math.floor(index / cols);

        // Center the grid
        const gridWidth = (cols - 1) * spacingX;
        const gridHeight = (rows - 1) * spacingY;
        const startX = (canvasWidth - gridWidth) / 2;
        const startY = (canvasHeight - gridHeight) / 2;

        return {
            x: startX + col * spacingX,
            y: startY + row * spacingY
        };
    }

    _getPropColorAtTime(propId, project, currentTime) {
        const ledTracks = project.tracks.filter(t => t.type === 'led');
        let resultColor = 'rgb(30,30,30)';
        let resultGlow = false;

        // Find tracks that affect this prop
        for (const track of ledTracks) {
            if (!track.groupId) continue;

            const group = project.propGroups.find(g => g.id === track.groupId);
            if (!group) continue;

            const propIds = parseIdString(group.ids);
            if (!propIds.includes(propId)) continue;

            // Find active clips on this track
            const activeClips = track.clips.filter(c =>
                currentTime >= c.startTime && currentTime < (c.startTime + c.duration)
            ).sort((a, b) => a.startTime - b.startTime);

            if (activeClips.length > 0) {
                const clip = activeClips[activeClips.length - 1];
                const localTime = currentTime - clip.startTime;
                // Use center LED position for color calculation
                const result = this._getActiveColor(clip, localTime, Math.floor(CONFIG.ledsPerTrack / 2));
                if (result) {
                    resultColor = result.color;
                    resultGlow = result.glow;
                }
            }
        }

        return { color: resultColor, glow: resultGlow };
    }

    // Hit test for field mode - returns propId if clicked on a prop, null otherwise
    hitTestProp(x, y) {
        const project = this.stateManager.get('project');
        if (!project?.tracks) return null;

        const usedProps = this._getUsedProps(project);
        const fieldLayout = project.settings?.fieldLayout || {};
        const canvas = this.elements.previewCanvas || document.getElementById('preview-canvas');
        if (!canvas) return null;

        const totalProps = usedProps.length;
        for (let i = usedProps.length - 1; i >= 0; i--) {
            const propId = usedProps[i];
            const pos = this._getPropPosition(propId, i, fieldLayout, canvas.width, canvas.height, totalProps);
            const dx = x - pos.x;
            const dy = y - pos.y;
            if (dx * dx + dy * dy <= FIELD_PROP_RADIUS * FIELD_PROP_RADIUS) {
                return propId;
            }
        }

        return null;
    }

    _getActiveColor(clip, localTime, ledIndex) {
        const progress = localTime / clip.duration;
        const pixelPct = ledIndex / CONFIG.ledsPerTrack;
        let color = '#000000';
        let glow = false;

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
                const fTimeBlock = Math.floor(localTime / 80); const fRand = pseudoRandom(fTimeBlock * 1000 + ledIndex);
                if (fRand > 0.8) color = '#ffff00'; else if (fRand > 0.5) color = '#ff5500'; else color = '#ff0000'; glow = true; break;
            case 'sparkle':
                const sTimeBlock = Math.floor(localTime / 50); const sRand = pseudoRandom(sTimeBlock * 999 + ledIndex);
                const density = clip.props.density || 0.3; if (sRand > (1.0 - density)) { color = '#ffffff'; glow = true; } else { const spBase = hexToRgb(clip.props.color); color = `rgb(${spBase.r * 0.2}, ${spBase.g * 0.2}, ${spBase.b * 0.2})`; } break;
            case 'glitch':
                const gTimeBlock = Math.floor(localTime / 50); const gRand = pseudoRandom(gTimeBlock); const amount = clip.props.amount || 0.2;
                if (gRand > (1.0 - amount)) { color = (pseudoRandom(gTimeBlock + 1) > 0.5) ? clip.props.color2 : '#000000'; } else { color = clip.props.color; } glow = true; break;
            case 'breathe':
                const bVal = (Math.sin(localTime / 1000 * clip.props.speed * Math.PI * 2) + 1) / 2; const bBase = hexToRgb(clip.props.color); color = `rgb(${bBase.r * bVal}, ${bBase.g * bVal}, ${bBase.b * bVal})`; glow = true; break;
            case 'heartbeat':
                const hT = (localTime / 1000 * clip.props.speed) % 1; let hInt = 0;
                if (hT < 0.15) hInt = Math.sin(hT * Math.PI / 0.15); else if (hT > 0.25 && hT < 0.45) hInt = Math.sin((hT - 0.25) * Math.PI / 0.2) * 0.6; if (hInt < 0) hInt = 0;
                const hBase = hexToRgb(clip.props.color); color = `rgb(${hBase.r * hInt}, ${hBase.g * hInt}, ${hBase.b * hInt})`; glow = hInt > 0.1; break;
            case 'alternate': color = (ledIndex % 2 === 0) ? clip.props.colorA : clip.props.colorB; glow = true; break;
            case 'energy':
                const eT = localTime / 1000 * clip.props.speed; const w1 = Math.sin(ledIndex * 0.2 + eT); const w2 = Math.sin(ledIndex * 0.3 - eT * 1.5); const eVal = (w1 + w2 + 2) / 4;
                const c1 = hexToRgb(clip.props.color); const c2 = hexToRgb(clip.props.color2); const eR = c1.r + (c2.r - c1.r) * eVal; const eG = c1.g + (c2.g - c1.g) * eVal; const eB = c1.b + (c2.b - c1.b) * eVal;
                color = `rgb(${Math.floor(eR)},${Math.floor(eG)},${Math.floor(eB)})`; glow = true; break;
            default: if (clip.props.color) { color = clip.props.color; glow = true; } break;
        }

        return { color, glow };
    }
}
