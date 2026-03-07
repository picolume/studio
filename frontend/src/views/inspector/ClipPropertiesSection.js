import { formatTime, parseTime } from '../../utils.js';
import { APP_EVENTS } from '../../core/AppEventHub.js';

export function renderClipProperties(container, clipId, project, context) {
    let clip = null;
    (project?.tracks || []).forEach(track => {
        const candidate = track.clips.find(item => item.id === clipId);
        if (candidate) clip = candidate;
    });
    if (!clip) return;

    const {
        stateManager,
        timelineController,
        addInput,
        addSlider,
        addToggle,
        formatPropLabel,
        emit
    } = context;

    const header = document.createElement('div');
    header.className = 'font-bold text-[var(--ui-text-strong)] mb-4 border-b border-[var(--ui-border)] pb-2';
    header.textContent = `${String(clip.type || '').toUpperCase()} CLIP`;
    container.innerHTML = '';
    container.appendChild(header);

    if (clip.type === 'audio') {
        renderAudioClipProps(container, clip, context);
    }

    const updateClip = (updates, options) => {
        stateManager?.update(draft => {
            draft.project.tracks.forEach(track => {
                const target = track.clips.find(item => item.id === clipId);
                if (target) Object.assign(target, updates);
            });
            draft.isDirty = true;
        }, options);
        emit?.(APP_EVENTS.TIMELINE_CHANGED);
    };

    const timingSection = document.createElement('div');
    timingSection.className = 'bg-[var(--ui-toolbar-bg)] p-3 rounded border border-[var(--ui-border)] mb-4';
    timingSection.innerHTML = '<div class="text-xs font-bold text-cyan-400 uppercase mb-3">Timing</div>';

    addInput(timingSection, 'Start (MM:SS.ss)', formatTime(clip.startTime), e => {
        updateClip({ startTime: parseTime(e.target.value) });
    });

    addInput(timingSection, 'Duration (MM:SS.ss)', formatTime(clip.duration), e => {
        updateClip({ duration: parseTime(e.target.value) });
    });

    container.appendChild(timingSection);

    const sliderSpecByKey = {
        rate: { min: 1, max: 30, step: 1, valueLabel: v => `${Math.round(v)} /s` },
        speed: { min: 0.1, max: 5, step: 0.1, valueLabel: v => `${Number(v).toFixed(1)}×` },
        frequency: { min: 0.1, max: 5, step: 0.1, valueLabel: v => `${Number(v).toFixed(1)}` },
        width: { min: 0.01, max: 0.5, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
        tailLen: { min: 0.05, max: 1, step: 0.05, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
        density: { min: 0, max: 1, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
        amount: { min: 0, max: 1, step: 0.01, valueLabel: v => `${Math.round(Number(v) * 100)}%` },
    };

    const propKeys = Object.keys(clip.props).filter(key =>
        !['audioSrcPath', 'name', 'volume'].includes(key) && !key.endsWith('PaletteIdx')
    );

    if (propKeys.length > 0) {
        const propsSection = document.createElement('div');
        propsSection.className = 'bg-[var(--ui-toolbar-bg)] p-3 rounded border border-[var(--ui-border)] mb-4';
        propsSection.innerHTML = '<div class="text-xs font-bold text-cyan-400 uppercase mb-3">Effect Properties</div>';

        propKeys.forEach(key => {
            const value = clip.props[key];
            const sliderSpec = typeof value === 'number' ? sliderSpecByKey[key] : null;
            const label = formatPropLabel(key);

            if (typeof value === 'boolean') {
                addToggle(propsSection, label, value, (nextVal) => {
                    updateClip({ props: { ...clip.props, [key]: nextVal } }, { skipHistory: true });
                });
                return;
            }

            if (sliderSpec) {
                addSlider(propsSection, label, value, sliderSpec, (nextVal) => {
                    updateClip({ props: { ...clip.props, [key]: nextVal } }, { skipHistory: true });
                });
                return;
            }

            const isColor = typeof value === 'string' && value.startsWith('#');
            const paletteOpts = isColor ? {
                paletteIdx: clip.props[`${key}PaletteIdx`] ?? 0,
                onPaletteChange: (newIdx) => {
                    const nextProps = { ...clip.props };
                    nextProps[`${key}PaletteIdx`] = newIdx;
                    updateClip({ props: nextProps }, { skipHistory: true });
                }
            } : undefined;

            addInput(propsSection, label, value, e => {
                const next = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                const nextProps = { ...clip.props };
                nextProps[key] = next;
                updateClip({ props: nextProps });
            }, typeof value === 'number' ? 'number' : undefined, paletteOpts);
        });

        container.appendChild(propsSection);
    }

    const del = document.createElement('button');
    del.innerHTML = "<i class='fas fa-trash-alt mr-2'></i>Delete Clip";
    del.className = 'w-full py-1.5 bg-red-900/80 hover:bg-red-700 border border-red-700/50 text-red-100 rounded text-xs font-medium transition-colors';
    del.onclick = () => {
        timelineController?.deleteClip?.(clipId);
    };
    container.appendChild(del);
}

export function renderAudioClipProps(container, clip, context) {
    const { stateManager, audioService } = context;
    const audioInfo = document.createElement('div');
    audioInfo.className = 'bg-[var(--ui-toolbar-bg)] p-3 rounded mb-4 border border-orange-900';
    const fileName = clip?.props?.name != null ? String(clip.props.name) : 'Unknown audio';
    const rawVolume = Number(clip?.props?.volume);
    const volume = Number.isFinite(rawVolume) ? rawVolume : 1;

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2 mb-2';

    const icon = document.createElement('i');
    icon.className = 'fas fa-music text-orange-400';
    titleRow.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'text-sm text-[var(--ui-text-strong)] font-medium';
    title.textContent = fileName;
    titleRow.appendChild(title);

    const durationRow = document.createElement('div');
    durationRow.className = 'text-xs text-[var(--ui-text-muted)] mb-3';
    durationRow.textContent = `Duration: ${(Number(clip?.duration ?? 0) / 1000).toFixed(2)}s`;

    const volumeLabel = document.createElement('label');
    volumeLabel.className = 'block text-xs text-[var(--ui-text-muted)] mb-1';
    volumeLabel.textContent = 'Volume';

    const volumeRow = document.createElement('div');
    volumeRow.className = 'flex items-center gap-2';

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '1';
    volumeSlider.step = '0.01';
    volumeSlider.value = String(volume);
    volumeSlider.className = 'flex-1 h-1 bg-[var(--ui-border)] rounded-lg appearance-none cursor-pointer accent-orange-500';
    volumeSlider.id = 'audio-volume-slider';

    const volumeDisplay = document.createElement('span');
    volumeDisplay.className = 'text-xs text-[var(--ui-text-muted)] w-10 text-right';
    volumeDisplay.id = 'audio-volume-display';
    volumeDisplay.textContent = `${Math.round(volume * 100)}%`;

    volumeRow.appendChild(volumeSlider);
    volumeRow.appendChild(volumeDisplay);

    audioInfo.appendChild(titleRow);
    audioInfo.appendChild(durationRow);
    audioInfo.appendChild(volumeLabel);
    audioInfo.appendChild(volumeRow);
    container.appendChild(audioInfo);

    volumeSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        volumeDisplay.textContent = `${Math.round(val * 100)}%`;
        stateManager?.update(draft => {
            draft.project.tracks.forEach(track => {
                const target = track.clips.find(item => item.id === clip.id);
                if (target) {
                    if (!target.props) target.props = {};
                    target.props.volume = val;
                }
            });
            draft.isDirty = true;
        }, { skipHistory: true });
        audioService?.setClipVolume?.(clip.id, val);
    };
}
