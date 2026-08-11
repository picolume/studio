import { APP_EVENTS, subscribeAppEvent } from '../core/AppEventHub.js';

export function setupProjectWorkflow(options = {}) {
    const {
        appEvents,
        stateManager,
        projectService,
        cueController,
        errorHandler,
        els,
        timeline,
        showConfirm,
        formatPicoStatus,
        onSelectionChanged = null
    } = options;

    const statusEls = {
        project: document.getElementById('status-project'),
        dirty: document.getElementById('status-dirty'),
        pico: document.getElementById('status-pico'),
        selection: document.getElementById('status-selection'),
        snap: document.getElementById('status-snap'),
        grid: document.getElementById('status-grid'),
    };

    const uploadModal = document.getElementById('upload-modal');
    const uploadMessage = document.getElementById('upload-message');
    const uploadButtonIcon = els.btnUpload?.querySelector('i') || null;
    const uploadButtonLabel = els.btnUpload?.querySelector('span') || null;
    const uploadButtonDefaultIconClass = uploadButtonIcon?.className || 'fas fa-microchip';
    const uploadButtonDefaultLabel = uploadButtonLabel?.textContent || 'Upload';

    let uploadInProgress = false;
    let picoStatusText = 'Pico: Not detected';
    let picoStatusTitle = 'No PicoLume device detected';

    const setUploadStatus = (message) => {
        if (!uploadMessage) return;
        const text = String(message || '').trim();
        if (text) uploadMessage.textContent = text;
    };

    const setUploadUiBusy = (busy) => {
        uploadInProgress = busy;

        uploadModal?.setAttribute('aria-hidden', String(!busy));

        if (busy) {
            document.body?.setAttribute('aria-busy', 'true');
            setUploadStatus('Preparing upload...');
        } else {
            document.body?.removeAttribute('aria-busy');
        }

        if (els.btnUpload) {
            els.btnUpload.disabled = busy;
        }

        if (uploadButtonIcon) {
            uploadButtonIcon.className = busy ? 'fas fa-spinner fa-spin' : uploadButtonDefaultIconClass;
        }

        if (uploadButtonLabel) {
            uploadButtonLabel.textContent = busy ? 'Uploading...' : uploadButtonDefaultLabel;
        }
    };

    try {
        if (window.runtime?.EventsOn) {
            window.runtime.EventsOn('upload:status', (message) => {
                if (!uploadInProgress) return;
                setUploadStatus(message);
            });
            window.runtime.EventsOn('upload:manual-eject', async (payload) => {
                if (!uploadInProgress) return;
                const drive = payload?.drive ? String(payload.drive) : '';
                const reason = payload?.reason ? String(payload.reason) : '';

                let title = 'Manual Eject Required';
                let explanation = '';

                if (reason.startsWith('PORT_LOCKED:')) {
                    const port = reason.split(':')[1] || 'serial port';
                    title = 'Serial Port In Use';
                    explanation = `Another application is using ${port}.\n\nClose any other application that utilizes the serial port (i.e. Arduino IDE, PuTTY, Serial Monitor...) then try uploading again.`;
                } else if (reason === 'RESET_FAILED') {
                    explanation = 'The device did not respond to the reset command.';
                } else if (reason) {
                    explanation = reason;
                }

                const driveText = drive ? ` (${drive})` : '';
                const message = [
                    `Upload complete${driveText}, but auto-reset failed.`,
                    ' ',
                    explanation,
                    ' ',
                    'Alternatively, you can Safely eject the Pico drive. This will flush and load the show.bin file',
                ].filter(Boolean).join('\n');

                await showConfirm(message, title);
            });
        }
    } catch { }

    const formatGridSize = (ms) => {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n % 1000 === 0) return `${n / 1000}s`;
        return `${n}ms`;
    };

    const findClipInProject = (project, clipId) => {
        if (!project?.tracks || !clipId) return null;
        for (const track of project.tracks) {
            const clip = (track?.clips || []).find(c => c.id === clipId);
            if (clip) return clip;
        }
        return null;
    };

    const updateStatusBar = () => {
        if (statusEls.project) {
            statusEls.project.textContent = projectService.getProjectName() || 'Untitled';
        }

        const isDirty = Boolean(stateManager.get('isDirty'));
        if (statusEls.dirty) {
            statusEls.dirty.classList.toggle('hidden', !isDirty);
        }

        const selection = stateManager.get('selection') || [];
        if (statusEls.selection) {
            if (selection.length === 0) {
                statusEls.selection.textContent = 'Selection: none';
            } else if (selection.length === 1) {
                const project = stateManager.get('project');
                const clip = findClipInProject(project, selection[0]);
                const typeLabel = clip?.type ? String(clip.type) : 'clip';
                statusEls.selection.textContent = `Selection: ${typeLabel}`;
            } else {
                statusEls.selection.textContent = `Selection: ${selection.length} clips`;
            }
        }

        const snapEnabled = Boolean(stateManager.get('ui.snapEnabled'));
        const gridSize = stateManager.get('ui.gridSize') || 1000;

        if (statusEls.snap) statusEls.snap.textContent = `Snap: ${snapEnabled ? 'On' : 'Off'}`;
        if (statusEls.grid) statusEls.grid.textContent = `Grid: ${formatGridSize(gridSize)}`;
    };

    const renderPicoStatus = () => {
        if (!statusEls.pico) return;
        if (!projectService?.backend?.capabilities?.picoStatus) {
            statusEls.pico.style.display = 'none';
            const picoSep = document.getElementById('status-pico-sep');
            if (picoSep) picoSep.style.display = 'none';
            return;
        }
        statusEls.pico.textContent = picoStatusText;
        statusEls.pico.title = picoStatusTitle;
    };

    const startPicoStatusPolling = () => {
        if (!projectService?.backend?.capabilities?.picoStatus) return;
        if (typeof projectService.backend.getPicoConnectionStatus !== 'function') return;
        if (!statusEls.pico) return;

        let inflight = false;
        const tick = async () => {
            if (inflight) return;
            inflight = true;
            try {
                const status = await projectService.backend.getPicoConnectionStatus();
                const formatted = formatPicoStatus(status);
                picoStatusText = formatted.text;
                picoStatusTitle = formatted.title;
                renderPicoStatus();
            } catch {
                // Ignore transient errors (e.g., enumerator failures)
            } finally {
                inflight = false;
            }
        };

        tick();
        window.setInterval(tick, 1500);
    };

    const refreshUIForProject = () => {
        stateManager?.set('selection', [], { skipHistory: true });
        timeline.populateInspector(null);
        timeline.buildTimeline();
        timeline.updatePlayheadUI();
        timeline.updateGridBackground();
        try { timeline.renderPreview(); } catch { }
        updateStatusBar();
        onSelectionChanged?.();
    };

    if (els.btnNew) {
        els.btnNew.onclick = async () => {
            const result = await projectService.createNew(true);
            if (result.success) {
                errorHandler.success(result.message);
                refreshUIForProject();
            }
        };
    }

    const notifySaveResult = (result) => {
        if (result.success) {
            if (result.warning) {
                errorHandler.warning(result.message);
            } else if (result.message) {
                errorHandler.success(result.message);
            }
            updateStatusBar();
        } else {
            errorHandler.handle(result.message);
        }
    };

    if (els.btnSave) {
        els.btnSave.onclick = async () => {
            notifySaveResult(await projectService.save());
        };
    }

    if (els.btnSaveAs) {
        els.btnSaveAs.onclick = async () => {
            notifySaveResult(await projectService.save(null, true));
        };
    }

    if (els.btnOpen) {
        els.btnOpen.onclick = async () => {
            const result = await projectService.load();
            if (result.success) {
                errorHandler.success(result.message);
                refreshUIForProject();
            } else if (result.message !== 'Load cancelled') {
                errorHandler.handle(result.message);
            }
        };
    }

    if (els.btnExportBin) {
        els.btnExportBin.onclick = async () => {
            const result = await projectService.exportBinary();
            if (result.success) {
                errorHandler.success(result.message);
            } else {
                errorHandler.handle(result.message);
            }
        };
    }

    const appTitle = document.getElementById('app-title');
    if (appTitle && projectService?.backend?.kind === 'online') {
        appTitle.style.cursor = 'pointer';
        appTitle.title = 'Visit picolume.com';
        appTitle.addEventListener('click', () => {
            window.open('https://picolume.com', '_blank', 'noopener,noreferrer');
        });
    }

    if (els.btnUpload) {
        if (!projectService?.backend?.capabilities?.upload) {
            els.btnUpload.disabled = true;
            els.btnUpload.title = 'Upload requires the desktop app';
            els.btnUpload.classList.add('opacity-50', 'cursor-not-allowed');
        }

        els.btnUpload.onclick = async () => {
            if (uploadInProgress) return;
            if (!projectService?.backend?.capabilities?.upload) return;

            setUploadUiBusy(true);
            await new Promise((resolve) => (
                window.requestAnimationFrame ? window.requestAnimationFrame(resolve) : setTimeout(resolve, 0)
            ));

            try {
                const result = await projectService.uploadToDevice();
                if (result.success) {
                    errorHandler.success(result.message);
                } else {
                    errorHandler.handle(result.message);
                }
            } finally {
                setUploadUiBusy(false);
            }
        };
    }

    if (els.btnSettings) {
        els.btnSettings.onclick = () => {
            stateManager.set('selection', [], { skipHistory: true });
            timeline.updateSelectionUI();
            onSelectionChanged?.();
            if (cueController.getSelectedCue()) {
                cueController.selectCue(null);
            }
            timeline.populateInspector(null);
            updateStatusBar();
        };
    }

    subscribeAppEvent(appEvents, APP_EVENTS.TIMELINE_CHANGED, updateStatusBar);
    subscribeAppEvent(appEvents, APP_EVENTS.SELECTION_CHANGED, updateStatusBar);
    subscribeAppEvent(appEvents, APP_EVENTS.GRID_CHANGED, updateStatusBar);

    updateStatusBar();
    renderPicoStatus();
    startPicoStatusPolling();

    return {
        refreshUIForProject,
        updateStatusBar
    };
}
