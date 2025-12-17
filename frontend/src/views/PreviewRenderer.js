import { CONFIG, hslToRgb, hexToRgb, pseudoRandom } from '../utils.js';

export class PreviewRenderer {
    constructor(deps) {
        this.deps = deps;
    }

    get stateManager() { return this.deps.stateManager; }
    get elements() { return this.deps.elements; }

    render() {
        const canvas = this.elements.previewCanvas || document.getElementById('preview-canvas');
        if (!canvas) return;

        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d');

        const project = this.stateManager.get('project');
        if (!project?.tracks) return;

        const currentTime = this.stateManager.get('playback.currentTime') || 0;
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
                    const result = this._getActiveColor(clip, localTime, i);
                    if (result) {
                        color = result.color;
                        glow = result.glow;
                    }
                }
                const x = i * ledSpacing + (ledSpacing / 2);
                const y = tIndex * trackHeight + (trackHeight / 2);
                ctx.shadowBlur = glow ? 10 : 0; ctx.shadowColor = color;
                ctx.beginPath(); ctx.arc(x, y, ledRadius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            }
        });
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
