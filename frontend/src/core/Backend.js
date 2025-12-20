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
            upload: true
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
            return await app.SaveBinary(projectJson);
        },
        async uploadToPico(projectJson) {
            return await app.UploadToPico(projectJson);
        }
    };
}

function createDemoBackend() {
    return {
        kind: 'demo',
        capabilities: {
            fileIO: false,
            exportBinary: false,
            upload: false
        },
        async requestSavePath() {
            return null;
        },
        async saveProjectToPath() {
            return 'Not available in web demo';
        },
        async loadProject() {
            return { error: 'Not available in web demo' };
        },
        async saveBinary() {
            return 'Not available in web demo';
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

