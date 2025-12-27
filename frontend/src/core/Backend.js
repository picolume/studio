/**
 * Backend adapter for PicoLume Studio.
 *
 * Studio runs under Wails (window.go.main.App.*). The website demo runs in a
 * plain browser and must not hard-depend on Wails being present.
 */

function hasWailsBackend() {
    return typeof window !== 'undefined'
        && window.go
        && window.go.main
        && window.go.main.App;
}

function createWailsBackend(app) {
    return {
        kind: 'wails',
        capabilities: {
            fileIO: true,
            exportBinary: true,
            upload: true,
            picoStatus: true
        },
        async requestSavePath() {
            return await app.RequestSavePath();
        },
        async saveProjectToPath(targetPath, projectJson, audioFiles) {
            return await app.SaveProjectToPath(targetPath, projectJson, audioFiles);
        },
        async loadProject() {
            return await app.LoadProject();
        },
        async saveBinary(projectJson) {
            // Use JS binary generator, then save via Go's native file dialog
            try {
                const { generateBinaryBytes } = await import('./BinaryGenerator.js');
                const project = JSON.parse(projectJson);
                const { bytes } = generateBinaryBytes(project);

                // Convert to base64 for transfer to Go
                const base64 = btoa(String.fromCharCode(...bytes));
                return await app.SaveBinaryData(base64);
            } catch (err) {
                return `Error: ${err?.message || err}`;
            }
        },
        async uploadToPico(projectJson) {
            return await app.UploadToPico(projectJson);
        },
        async getPicoConnectionStatus() {
            return await app.GetPicoConnectionStatus();
        }
    };
}

function createDemoBackend() {
    const saveHandleByName = new Map();

    async function pickSaveHandle(suggestedName = 'myshow.lum') {
        if (typeof window === 'undefined') return null;
        if (typeof window.showSaveFilePicker !== 'function') return null;

        try {
            return await window.showSaveFilePicker({
                suggestedName,
                types: [
                    {
                        description: 'PicoLume Project',
                        accept: { 'application/zip': ['.lum'] }
                    }
                ]
            });
        } catch {
            return null;
        }
    }

    async function pickOpenFile() {
        if (typeof window === 'undefined') return null;

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [
                        {
                            description: 'PicoLume Project',
                            accept: { 'application/zip': ['.lum'] }
                        }
                    ]
                });
                if (!handle) return null;
                const file = await handle.getFile();
                return file || null;
            } catch {
                return null;
            }
        }

        // Fallback for browsers without File System Access API.
        return await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.lum,application/zip';
            input.style.position = 'fixed';
            input.style.left = '-9999px';
            input.onchange = () => {
                const file = input.files && input.files[0] ? input.files[0] : null;
                input.remove();
                resolve(file);
            };
            document.body.appendChild(input);
            input.click();
        });
    }

    return {
        kind: 'demo',
        capabilities: {
            fileIO: true,
            exportBinary: true,
            upload: false,
            picoStatus: false
        },
        async requestSavePath() {
            const handle = await pickSaveHandle('myshow.lum');
            if (!handle) {
                // Fallback path used by the anchor-download save flow.
                return 'myshow.lum';
            }
            saveHandleByName.set(handle.name, handle);
            return handle.name;
        },
        async saveProjectToPath() {
            // Lazy import to avoid pulling browser-only zip logic into environments that don't need it.
            const { createLumBytes } = await import('./LumFile.js');

            const targetPath = arguments[0];
            const projectJson = arguments[1];
            const audioFiles = arguments[2];

            let handle = targetPath ? saveHandleByName.get(targetPath) : null;
            if (!handle && typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
                handle = await pickSaveHandle(targetPath || 'myshow.lum');
                if (handle) saveHandleByName.set(handle.name, handle);
            }

            const zipBytes = await createLumBytes(projectJson, audioFiles, { compress: false });
            const blob = new Blob([zipBytes], { type: 'application/zip' });

            if (handle) {
                try {
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    return 'Saved';
                } catch (err) {
                    return `Error: ${err?.message || err}`;
                }
            }

            // Fallback: download via anchor.
            try {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = targetPath && targetPath.endsWith('.lum') ? targetPath : 'myshow.lum';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                return 'Saved';
            } catch (err) {
                return `Error: ${err?.message || err}`;
            }
        },
        async loadProject() {
            const file = await pickOpenFile();
            if (!file) return { error: 'Cancelled' };

            try {
                const { parseLumBytes } = await import('./LumFile.js');
                const ab = await file.arrayBuffer();
                const { projectJson, audioFiles } = await parseLumBytes(new Uint8Array(ab));
                return {
                    projectJson,
                    audioFiles,
                    filePath: file.name,
                    error: ''
                };
            } catch (err) {
                return { error: `Failed to load .lum: ${err?.message || err}` };
            }
        },
        async saveBinary(projectJson) {
            try {
                const { generateBinaryBytes } = await import('./BinaryGenerator.js');
                const project = JSON.parse(projectJson);
                const { bytes, eventCount } = generateBinaryBytes(project);

                const blob = new Blob([bytes], { type: 'application/octet-stream' });

                // Try File System Access API first
                if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
                    try {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: 'show.bin',
                            types: [
                                {
                                    description: 'PicoLume Binary',
                                    accept: { 'application/octet-stream': ['.bin'] }
                                }
                            ]
                        });
                        const writable = await handle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        return 'OK';
                    } catch (err) {
                        // User cancelled or API not available, fall through to download
                        if (err?.name === 'AbortError') {
                            return 'Cancelled';
                        }
                    }
                }

                // Fallback: download via anchor
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'show.bin';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                return 'OK';
            } catch (err) {
                return `Error: ${err?.message || err}`;
            }
        },
        async uploadToPico() {
            return 'Not available in web demo';
        }
    };
}

export function getBackend() {
    if (hasWailsBackend()) {
        return createWailsBackend(window.go.main.App);
    }
    return createDemoBackend();
}
