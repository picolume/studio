/**
 * WASM-based binary generator for PicoLume show.bin files.
 * Uses Go compiled to WebAssembly for consistent binary generation
 * across desktop (Wails) and web environments.
 */

let wasmReady = false;
let wasmInitPromise = null;

/**
 * Initialize the WASM module.
 * Call this once at app startup.
 * @returns {Promise<void>}
 */
export async function initWasm() {
    if (wasmReady) return;
    if (wasmInitPromise) return wasmInitPromise;

    wasmInitPromise = (async () => {
        // Load Go's WASM support script
        if (!window.Go) {
            await loadScript('/src/wasm/wasm_exec.js');
        }

        const go = new window.Go();

        // Determine WASM path based on environment
        const wasmPath = getWasmPath();

        let result;
        if (WebAssembly.instantiateStreaming) {
            result = await WebAssembly.instantiateStreaming(
                fetch(wasmPath),
                go.importObject
            );
        } else {
            // Fallback for browsers without streaming support
            const response = await fetch(wasmPath);
            const bytes = await response.arrayBuffer();
            result = await WebAssembly.instantiate(bytes, go.importObject);
        }

        // Run the Go WASM module (this sets up window.picolume)
        go.run(result.instance);

        // Wait for picolume namespace to be available
        await waitForPicolume();

        wasmReady = true;
        console.log('[BinaryGeneratorWasm] WASM module initialized');
    })();

    return wasmInitPromise;
}

/**
 * Get the path to the WASM file based on environment.
 */
function getWasmPath() {
    // WASM files are in /src/wasm/ directory
    // Wails serves static files from the frontend directory
    return '/src/wasm/bingen.wasm';
}

/**
 * Load an external script dynamically.
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Wait for the picolume namespace to be available.
 */
function waitForPicolume(timeout = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (window.picolume) {
                resolve();
            } else if (Date.now() - start > timeout) {
                reject(new Error('Timeout waiting for WASM module'));
            } else {
                setTimeout(check, 10);
            }
        };
        check();
    });
}

/**
 * Check if WASM is ready for use.
 * @returns {boolean}
 */
export function isWasmReady() {
    return wasmReady;
}

/**
 * Generate show.bin bytes from a project object using WASM.
 * Falls back to JavaScript implementation if WASM is not available.
 *
 * @param {Object} project - The project data
 * @returns {{ bytes: Uint8Array, eventCount: number }}
 */
export function generateBinaryBytes(project) {
    if (!wasmReady || !window.picolume) {
        // Fall back to JS implementation
        console.warn('[BinaryGeneratorWasm] WASM not ready, using JS fallback');
        return generateBinaryBytesJS(project);
    }

    const projectJson = JSON.stringify(project);
    const result = window.picolume.generateBinaryBytes(projectJson);

    if (result.error) {
        throw new Error(`WASM binary generation failed: ${result.error}`);
    }

    return {
        bytes: result.bytes,
        eventCount: result.eventCount
    };
}

/**
 * Generate show.bin bytes asynchronously, ensuring WASM is initialized.
 *
 * @param {Object} project - The project data
 * @returns {Promise<{ bytes: Uint8Array, eventCount: number }>}
 */
export async function generateBinaryBytesAsync(project) {
    await initWasm();
    return generateBinaryBytes(project);
}

// =============================================================================
// JavaScript fallback implementation (from BinaryGenerator.js)
// Used when WASM is not available or during initialization
// =============================================================================

const TOTAL_PROPS = 224;
const MASK_ARRAY_SIZE = 7;

const EFFECT_CODES = {
    solid: 1, flash: 2, strobe: 3, rainbow: 4, rainbowHold: 5, chase: 6,
    wipe: 9, scanner: 10, meteor: 11, fire: 12, heartbeat: 13,
    glitch: 14, energy: 15, sparkle: 16, breathe: 17, alternate: 18
};

function parseColor(hex) {
    if (!hex) return 0;
    hex = hex.replace(/^#/, '');
    const val = parseInt(hex, 16);
    return isNaN(val) ? 0 : val;
}

function getEffectCode(type) {
    return EFFECT_CODES[type] || 1;
}

function calculateMask(idStr) {
    const masks = new Uint32Array(MASK_ARRAY_SIZE);
    if (!idStr) return masks;

    const parts = idStr.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (trimmed.includes('-')) {
            const rangeParts = trimmed.split('-');
            if (rangeParts.length !== 2) continue;
            const start = parseInt(rangeParts[0].trim(), 10);
            const end = parseInt(rangeParts[1].trim(), 10);
            if (isNaN(start) || isNaN(end) || start > end) continue;
            for (let i = start; i <= end; i++) {
                if (i >= 1 && i <= TOTAL_PROPS) {
                    const idx = i - 1;
                    masks[Math.floor(idx / 32)] |= (1 << (idx % 32));
                }
            }
        } else {
            const id = parseInt(trimmed, 10);
            if (!isNaN(id) && id >= 1 && id <= TOTAL_PROPS) {
                const idx = id - 1;
                masks[Math.floor(idx / 32)] |= (1 << (idx % 32));
            }
        }
    }
    return masks;
}

function parseIdRange(idStr) {
    const ids = [];
    if (!idStr) return ids;

    const parts = idStr.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (trimmed.includes('-')) {
            const rangeParts = trimmed.split('-');
            if (rangeParts.length === 2) {
                const start = parseInt(rangeParts[0].trim(), 10);
                const end = parseInt(rangeParts[1].trim(), 10);
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let i = start; i <= end; i++) {
                        if (i >= 1 && i <= TOTAL_PROPS) ids.push(i);
                    }
                }
            }
        } else {
            const id = parseInt(trimmed, 10);
            if (!isNaN(id) && id >= 1 && id <= TOTAL_PROPS) ids.push(id);
        }
    }
    return ids;
}

function isMaskEmpty(mask) {
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== 0) return false;
    }
    return true;
}

function generateBinaryBytesJS(project) {
    const settings = project.settings || {};
    const propGroups = project.propGroups || [];
    const tracks = project.tracks || [];

    // Build profile map
    const profileMap = new Map();
    if (settings.profiles) {
        for (const prof of settings.profiles) {
            profileMap.set(prof.id, prof);
        }
    }

    // Build prop-to-profile assignment
    const propAssignment = new Map();
    if (settings.profiles) {
        for (const prof of settings.profiles) {
            if (prof.assignedIds) {
                for (const propId of parseIdRange(prof.assignedIds)) {
                    propAssignment.set(propId, prof);
                }
            }
        }
    }
    if (settings.patch) {
        for (const [propIdStr, profileId] of Object.entries(settings.patch)) {
            const propId = parseInt(propIdStr, 10);
            if (!isNaN(propId) && propId >= 1 && propId <= TOTAL_PROPS) {
                const prof = profileMap.get(profileId);
                if (prof) propAssignment.set(propId, prof);
            }
        }
    }

    // Generate PropConfig LUT
    const DEFAULT_LED_COUNT = 164;
    const DEFAULT_BRIGHTNESS = 255;
    const lutBytes = new Uint8Array(TOTAL_PROPS * 8);
    const lutView = new DataView(lutBytes.buffer);

    for (let i = 1; i <= TOTAL_PROPS; i++) {
        const offset = (i - 1) * 8;
        const prof = propAssignment.get(i);
        const ledCount = prof?.ledCount ?? DEFAULT_LED_COUNT;
        const ledType = prof?.ledType ?? 0;
        const colorOrder = prof?.colorOrder ?? 0;
        const brightnessCap = prof?.brightnessCap ?? DEFAULT_BRIGHTNESS;

        lutView.setUint16(offset, ledCount, true);
        lutView.setUint8(offset + 2, ledType);
        lutView.setUint8(offset + 3, colorOrder);
        lutView.setUint8(offset + 4, brightnessCap);
    }

    // Generate events
    const events = [];
    const showDuration = settings.showDuration > 0 ? settings.showDuration : 60000;

    for (const track of tracks) {
        if (track.type !== 'led') continue;

        let groupIds = '';
        for (const g of propGroups) {
            if (g.id === track.groupId) {
                groupIds = g.ids;
                break;
            }
        }

        const mask = calculateMask(groupIds);
        if (isMaskEmpty(mask)) continue;

        const clips = [...(track.clips || [])].sort((a, b) => a.startTime - b.startTime);
        let lastEndTime = 0;

        for (const clip of clips) {
            if (clip.startTime > lastEndTime) {
                const gapDuration = clip.startTime - lastEndTime;
                if (gapDuration > 0) {
                    events.push({
                        startTime: lastEndTime, duration: gapDuration,
                        effectType: 0, speed: 0, width: 0, color: 0, color2: 0, mask
                    });
                }
            }

            let colorHex = clip.props?.color || clip.props?.colorStart || '#FFFFFF';
            let color2Hex = clip.props?.color2 || '';
            if (!color2Hex && clip.type === 'alternate') {
                color2Hex = clip.props?.colorB || '';
                if (clip.props?.colorA) colorHex = clip.props.colorA;
            }
            if (!color2Hex) color2Hex = '#000000';

            let speedVal = clip.props?.speed || 1.0;
            if (speedVal <= 0) speedVal = 1.0;
            const speedByte = Math.min(255, Math.floor(speedVal * 50));
            const widthByte = Math.floor((clip.props?.width || 0) * 255);

            events.push({
                startTime: clip.startTime, duration: clip.duration,
                effectType: getEffectCode(clip.type),
                speed: speedByte, width: widthByte,
                color: parseColor(colorHex), color2: parseColor(color2Hex), mask
            });

            const clipEnd = clip.startTime + clip.duration;
            if (clipEnd > lastEndTime) lastEndTime = clipEnd;
        }

        if (lastEndTime < showDuration) {
            const finalGap = showDuration - lastEndTime;
            if (finalGap > 0) {
                events.push({
                    startTime: lastEndTime, duration: finalGap,
                    effectType: 0, speed: 0, width: 0, color: 0, color2: 0, mask
                });
            }
        }
    }

    // Calculate sizes
    const headerSize = 16;
    const lutSize = 1792;
    const eventSize = 48;
    const totalSize = headerSize + lutSize + (events.length * eventSize);

    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);

    // Write header
    view.setUint32(0, 0x5049434F, true);
    view.setUint16(4, 3, true);
    view.setUint16(6, events.length, true);

    // Write LUT
    output.set(lutBytes, headerSize);

    // Write events
    let eventOffset = headerSize + lutSize;
    for (const evt of events) {
        view.setUint32(eventOffset, evt.startTime, true);
        view.setUint32(eventOffset + 4, evt.duration, true);
        view.setUint8(eventOffset + 8, evt.effectType);
        view.setUint8(eventOffset + 9, evt.speed);
        view.setUint8(eventOffset + 10, evt.width);
        view.setUint8(eventOffset + 11, 0);
        view.setUint32(eventOffset + 12, evt.color, true);
        view.setUint32(eventOffset + 16, evt.color2, true);

        for (let i = 0; i < MASK_ARRAY_SIZE; i++) {
            view.setUint32(eventOffset + 20 + (i * 4), evt.mask[i], true);
        }
        eventOffset += eventSize;
    }

    // Append CUE block if cues exist
    const cues = project.cues || [];
    const hasCues = cues.some(c => c.enabled && c.timeMs !== null);

    if (hasCues) {
        const cueBlockSize = 32;
        const finalOutput = new Uint8Array(totalSize + cueBlockSize);
        finalOutput.set(output, 0);

        const cueView = new DataView(finalOutput.buffer, totalSize, cueBlockSize);
        cueView.setUint8(0, 0x43);
        cueView.setUint8(1, 0x55);
        cueView.setUint8(2, 0x45);
        cueView.setUint8(3, 0x31);
        cueView.setUint16(4, 1, true);
        cueView.setUint16(6, 4, true);

        const cueIds = ['A', 'B', 'C', 'D'];
        for (let i = 0; i < 4; i++) {
            const cue = cues.find(c => c.id === cueIds[i]);
            const timeValue = (cue && cue.enabled && cue.timeMs !== null)
                ? cue.timeMs : 0xFFFFFFFF;
            cueView.setUint32(8 + (i * 4), timeValue, true);
        }

        return { bytes: finalOutput, eventCount: events.length };
    }

    return { bytes: output, eventCount: events.length };
}
