import { STATE, els } from './stateBridge.js';

export const initAudio = () => {
    if (!STATE.audioCtx) {
        try {
            STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            STATE.masterGain = STATE.audioCtx.createGain();
            STATE.masterGain.connect(STATE.audioCtx.destination);
            STATE.masterGain.gain.value = STATE.masterVolume;
        } catch (e) { console.error('Audio init failed:', e); }
    }
};

export function startPlayback() {
    STATE.isPlaying = true;
    if(els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-pause"></i>';
    
    if (!STATE.audioCtx) initAudio();
    if (STATE.audioCtx && STATE.audioCtx.state === 'suspended') STATE.audioCtx.resume();

    const playheadTime = STATE.currentTime / 1000;
    STATE.audioStartTime = STATE.audioCtx.currentTime - playheadTime;

    STATE.project.tracks.filter(t => t.type === 'audio').forEach(track => {
        track.clips.forEach(clip => {
            if (!clip.bufferId || !STATE.assets[clip.bufferId]) return;
            const clipStart = clip.startTime / 1000;
            const clipEnd = clipStart + (clip.duration / 1000);

            if (clipEnd > playheadTime) {
                try {
                    const source = STATE.audioCtx.createBufferSource();
                    source.buffer = STATE.assets[clip.bufferId];
                    source.connect(STATE.masterGain);
                    const durationSec = clip.duration / 1000;
                    if (playheadTime < clipStart) {
                        source.start(STATE.audioCtx.currentTime + (clipStart - playheadTime), 0, durationSec);
                    } else {
                        source.start(0, playheadTime - clipStart, durationSec - (playheadTime - clipStart));
                    }
                    STATE.activeAudioSources.push(source);
                } catch (e) {}
            }
        });
    });
}

export function stopPlayback() {
    STATE.isPlaying = false;
    if(els.btnPlay) els.btnPlay.innerHTML = '<i class="fas fa-play"></i>';
    STATE.activeAudioSources.forEach(src => { try { src.stop(); } catch (e) {} });
    STATE.activeAudioSources = [];
}

export function cleanupAudioBuffer(bufferId) {
    if (STATE.assets[bufferId]) delete STATE.assets[bufferId];
    if (STATE.audioLibrary[bufferId]) delete STATE.audioLibrary[bufferId];
}