/**
 * Binary generator for PicoLume show.bin files.
 * Implements V3 format matching the Go backend.
 */

const TOTAL_PROPS = 224;
const MASK_ARRAY_SIZE = 7;

// Effect type codes matching firmware
const EFFECT_CODES = {
    solid: 1, flash: 2, strobe: 3, rainbow: 4, rainbowHold: 5, chase: 6,
    wipe: 9, scanner: 10, meteor: 11, fire: 12, heartbeat: 13,
    glitch: 14, energy: 15, sparkle: 16, breathe: 17, alternate: 18
};

/**
 * Parse a hex color string to a 24-bit integer.
 * @param {string} hex - Color like "#FF0000" or "FF0000"
 * @returns {number} - 24-bit color value
 */
function parseColor(hex) {
    if (!hex) return 0;
    hex = hex.replace(/^#/, '');
    const val = parseInt(hex, 16);
    return isNaN(val) ? 0 : val;
}

/**
 * Get effect code for a clip type.
 * @param {string} type - Effect type name
 * @returns {number} - Effect code (0 = OFF)
 */
function getEffectCode(type) {
    return EFFECT_CODES[type] || 1;
}

/**
 * Parse ID string like "1-5, 8, 10-12" into a bitmask array.
 * @param {string} idStr - Prop ID specification
 * @returns {Uint32Array} - 7-element mask array
 */
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

/**
 * Parse ID range string into array of individual IDs.
 * @param {string} idStr - ID specification like "1-18" or "1,3,5"
 * @returns {number[]} - Array of prop IDs
 */
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
                        if (i >= 1 && i <= TOTAL_PROPS) {
                            ids.push(i);
                        }
                    }
                }
            }
        } else {
            const id = parseInt(trimmed, 10);
            if (!isNaN(id) && id >= 1 && id <= TOTAL_PROPS) {
                ids.push(id);
            }
        }
    }
    return ids;
}

/**
 * Check if a mask is empty (all zeros).
 * @param {Uint32Array} mask
 * @returns {boolean}
 */
function isMaskEmpty(mask) {
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== 0) return false;
    }
    return true;
}

/**
 * Generate show.bin bytes from a project object.
 * @param {Object} project - The project data
 * @returns {{ bytes: Uint8Array, eventCount: number }}
 */
export function generateBinaryBytes(project) {
    const settings = project.settings || {};
    const propGroups = project.propGroups || [];
    const tracks = project.tracks || [];

    // --- 1. Build profile map ---
    const profileMap = new Map();
    if (settings.profiles) {
        for (const prof of settings.profiles) {
            profileMap.set(prof.id, prof);
        }
    }

    // --- 2. Build prop-to-profile assignment ---
    const propAssignment = new Map();

    // Apply profile's assignedIds
    if (settings.profiles) {
        for (const prof of settings.profiles) {
            if (prof.assignedIds) {
                for (const propId of parseIdRange(prof.assignedIds)) {
                    propAssignment.set(propId, prof);
                }
            }
        }
    }

    // Apply patch overrides
    if (settings.patch) {
        for (const [propIdStr, profileId] of Object.entries(settings.patch)) {
            const propId = parseInt(propIdStr, 10);
            if (!isNaN(propId) && propId >= 1 && propId <= TOTAL_PROPS) {
                const prof = profileMap.get(profileId);
                if (prof) {
                    propAssignment.set(propId, prof);
                }
            }
        }
    }

    // --- 3. Generate PropConfig LUT (1792 bytes) ---
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

        lutView.setUint16(offset, ledCount, true);      // little-endian
        lutView.setUint8(offset + 2, ledType);
        lutView.setUint8(offset + 3, colorOrder);
        lutView.setUint8(offset + 4, brightnessCap);
        // Reserved bytes are already 0
    }

    // --- 4. Generate events ---
    const events = [];
    const showDuration = settings.showDuration > 0 ? settings.showDuration : 60000;

    for (const track of tracks) {
        if (track.type !== 'led') continue;

        // Find group IDs
        let groupIds = '';
        for (const g of propGroups) {
            if (g.id === track.groupId) {
                groupIds = g.ids;
                break;
            }
        }

        const mask = calculateMask(groupIds);
        if (isMaskEmpty(mask)) continue;

        // Sort clips by start time
        const clips = [...(track.clips || [])].sort((a, b) => a.startTime - b.startTime);

        let lastEndTime = 0;

        for (const clip of clips) {
            // Gap detection: insert OFF event if there's a gap
            if (clip.startTime > lastEndTime) {
                const gapDuration = clip.startTime - lastEndTime;
                if (gapDuration > 0) {
                    events.push({
                        startTime: lastEndTime,
                        duration: gapDuration,
                        effectType: 0, // OFF
                        speed: 0,
                        width: 0,
                        color: 0,
                        color2: 0,
                        mask
                    });
                }
            }

            // Determine colors
            let colorHex = clip.props?.color || clip.props?.colorStart || '#FFFFFF';
            let color2Hex = clip.props?.color2 || '';

            if (!color2Hex && clip.type === 'alternate') {
                color2Hex = clip.props?.colorB || '';
                if (clip.props?.colorA) {
                    colorHex = clip.props.colorA;
                }
            }
            if (!color2Hex) color2Hex = '#000000';

            // Calculate speed byte (0.1-5.0 -> 0-255)
            let speedVal = clip.props?.speed || 1.0;
            if (speedVal <= 0) speedVal = 1.0;
            const speedByte = Math.min(255, Math.floor(speedVal * 50));

            // Calculate width byte (0.0-1.0 -> 0-255)
            const widthByte = Math.floor((clip.props?.width || 0) * 255);

            events.push({
                startTime: clip.startTime,
                duration: clip.duration,
                effectType: getEffectCode(clip.type),
                speed: speedByte,
                width: widthByte,
                color: parseColor(colorHex),
                color2: parseColor(color2Hex),
                mask
            });

            // Update lastEndTime
            const clipEnd = clip.startTime + clip.duration;
            if (clipEnd > lastEndTime) {
                lastEndTime = clipEnd;
            }
        }

        // Final OFF event from last clip to show duration
        if (lastEndTime < showDuration) {
            const finalGap = showDuration - lastEndTime;
            if (finalGap > 0) {
                events.push({
                    startTime: lastEndTime,
                    duration: finalGap,
                    effectType: 0, // OFF
                    speed: 0,
                    width: 0,
                    color: 0,
                    color2: 0,
                    mask
                });
            }
        }
    }

    // --- 5. Calculate total size and build output ---
    // Header: 16 bytes
    // LUT: 1792 bytes (224 × 8)
    // Events: 48 bytes each (4+4+1+1+1+1+4+4+28)
    const headerSize = 16;
    const lutSize = 1792;
    const eventSize = 48;
    const totalSize = headerSize + lutSize + (events.length * eventSize);

    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);

    // --- 6. Write header ---
    view.setUint32(0, 0x5049434F, true);  // Magic "PICO" (little-endian)
    view.setUint16(4, 3, true);            // Version 3
    view.setUint16(6, events.length, true); // Event count
    // Bytes 8-15 are reserved (already 0)

    // --- 7. Write LUT ---
    output.set(lutBytes, headerSize);

    // --- 8. Write events ---
    let eventOffset = headerSize + lutSize;
    for (const evt of events) {
        view.setUint32(eventOffset, evt.startTime, true);
        view.setUint32(eventOffset + 4, evt.duration, true);
        view.setUint8(eventOffset + 8, evt.effectType);
        view.setUint8(eventOffset + 9, evt.speed);
        view.setUint8(eventOffset + 10, evt.width);
        view.setUint8(eventOffset + 11, 0); // Reserved
        view.setUint32(eventOffset + 12, evt.color, true);
        view.setUint32(eventOffset + 16, evt.color2, true);

        // Write mask (7 × uint32 = 28 bytes)
        for (let i = 0; i < MASK_ARRAY_SIZE; i++) {
            view.setUint32(eventOffset + 20 + (i * 4), evt.mask[i], true);
        }

        eventOffset += eventSize;
    }

    return { bytes: output, eventCount: events.length };
}
