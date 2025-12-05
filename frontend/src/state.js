export const STATE = {
    project: {
        name: "My Show",
        duration: 60000,
        settings: { 
            ledCount: 164, // Fallback/Default
            brightness: 255,
            // --- NEW: Hardware Configuration ---
            profiles: [
                { id: 'p_default', name: 'Standard Prop', ledCount: 164, assignedIds: '1-164' }
            ],
            patch: {} // Will be auto-generated from profiles
        },
        propGroups: [
            { id: 'g_all', name: 'All Props', ids: '1-18' },
            { id: 'g_1', name: 'Prop 1', ids: '1' },
            { id: 'g_odd', name: 'Odd Props', ids: '1,3,5,7,9,11,13,15,17' }
        ],
        tracks: [
            { id: 't1', type: 'audio', label: 'Audio Track', clips: [], groupId: null },
            { id: 't2', type: 'led', label: 'Main Track', clips: [], groupId: 'g_all' }
        ]
    },
    assets: {},           
    audioLibrary: {},     
    activeAudioSources: [],
    selection: [],
    filePath: null,
    isDirty: false,
    autoSaveEnabled: true,
    isPlaying: false,
    currentTime: 0,
    zoom: 50,
    startTime: 0,
    audioCtx: null,
    masterGain: null,
    masterVolume: 1.0,
    snapEnabled: true,
    gridSize: 1000,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    lastPreviewRender: 0
};

export const els = {};