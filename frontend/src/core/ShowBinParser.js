/**
 * ShowBinParser - Binary show.bin file parser
 *
 * Parses V3 format show.bin files containing:
 * - 16-byte header
 * - 1792-byte PropConfig LUT (224 props × 8 bytes)
 * - 48-byte events
 */

// ===== CONSTANTS =====
export const MAGIC = 0x5049434f; // "PICO" little-endian
export const HEADER_SIZE = 16;
export const TOTAL_PROPS = 224;
export const PROPCFG_SIZE = 8;
export const EVENT_SIZE = 48;
export const LUT_SIZE = TOTAL_PROPS * PROPCFG_SIZE;

export const COLOR_ORDER = Object.freeze({
    0: "GRB", 1: "RGB", 2: "BRG", 3: "RBG", 4: "GBR", 5: "BGR"
});

export const LED_TYPE = Object.freeze({
    0: "WS2812B", 1: "SK6812", 2: "SK6812_RGBW", 3: "WS2811", 4: "WS2813", 5: "WS2815"
});

export const EFFECT = Object.freeze({
    0: { name: "OFF", icon: "fa-circle", color: "#333333", usesColor2: false },
    1: { name: "SOLID", icon: "fa-square", color: "#22c55e", usesColor2: false },
    2: { name: "FLASH", icon: "fa-bolt", color: "#eab308", usesColor2: false },
    3: { name: "STROBE", icon: "fa-burst", color: "#f97316", usesColor2: false },
    4: { name: "RAINBOW", icon: "fa-rainbow", color: "#ec4899", usesColor2: false },
    5: { name: "RAINBOW_HOLD", icon: "fa-rainbow", color: "#a855f7", usesColor2: false, note: "Full Spectrum" },
    6: { name: "CHASE", icon: "fa-person-running", color: "#3b82f6", usesColor2: false },
    9: { name: "WIPE", icon: "fa-paintbrush", color: "#06b6d4", usesColor2: false },
    10: { name: "SCANNER", icon: "fa-satellite-dish", color: "#14b8a6", usesColor2: false },
    11: { name: "METEOR", icon: "fa-meteor", color: "#8b5cf6", usesColor2: false },
    12: { name: "FIRE", icon: "fa-fire", color: "#ef4444", usesColor2: false },
    13: { name: "HEARTBEAT", icon: "fa-heart-pulse", color: "#ec4899", usesColor2: false },
    14: { name: "GLITCH", icon: "fa-bug", color: "#10b981", usesColor2: true },
    15: { name: "ENERGY", icon: "fa-bolt", color: "#6366f1", usesColor2: true },
    16: { name: "SPARKLE", icon: "fa-star", color: "#fbbf24", usesColor2: false },
    17: { name: "BREATHE", icon: "fa-wind", color: "#0ea5e9", usesColor2: false },
    18: { name: "ALTERNATE", icon: "fa-arrows-rotate", color: "#f43f5e", usesColor2: true },
});

// ===== UTILITY FUNCTIONS =====
function readU8(dv, off) { return dv.getUint8(off); }
function readU16LE(dv, off) { return dv.getUint16(off, true); }
function readU32LE(dv, off) { return dv.getUint32(off, true); }

function popcnt32(x) {
    x >>>= 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Format a number as hex string
 */
export function fmtHex(value, width = 8) {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

/**
 * Format a 32-bit RGB value as hex color string
 */
export function fmtRgb(rgbU32) {
    const rrggbb = (rgbU32 >>> 0) & 0xffffff;
    return `#${rrggbb.toString(16).toUpperCase().padStart(6, "0")}`;
}

/**
 * Format milliseconds as MM:SS.cc
 */
export function fmtTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    const centis = Math.floor((ms % 1000) / 10);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

/**
 * Format milliseconds as MM:SS
 */
export function fmtDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format bytes as human-readable string
 */
export function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Check if an event targets a specific prop
 */
export function eventTargetsProp(event, propId) {
    const wordIdx = Math.floor((propId - 1) / 32);
    const bitIdx = (propId - 1) % 32;
    return (event.propMask[wordIdx] & (1 << bitIdx)) !== 0;
}

/**
 * Get list of prop IDs targeted by an event
 */
export function getTargetedProps(event) {
    const props = [];
    for (let p = 1; p <= TOTAL_PROPS; p++) {
        if (eventTargetsProp(event, p)) {
            props.push(p);
        }
    }
    return props;
}

/**
 * Parse a show.bin file
 * @param {Uint8Array} bytes - The raw file bytes
 * @returns {Object} Parsed data or error
 */
export function parseShowBin(bytes) {
    if (!bytes || bytes.length < HEADER_SIZE) {
        return { error: `File too small (need at least ${HEADER_SIZE} bytes)` };
    }

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Parse header
    const magic = readU32LE(dv, 0);
    const version = readU16LE(dv, 4);
    const eventCount = readU16LE(dv, 6);

    if (magic !== MAGIC) {
        return { error: `Bad magic. Expected ${fmtHex(MAGIC)}, got ${fmtHex(magic)}.` };
    }

    const header = { magic, version, eventCount };

    // Parse PropConfigs for V3
    const propConfigs = [];
    if (version === 3) {
        for (let i = 0; i < TOTAL_PROPS; i++) {
            const offset = HEADER_SIZE + i * PROPCFG_SIZE;
            if (offset + PROPCFG_SIZE > dv.byteLength) break;
            const ledCount = readU16LE(dv, offset);
            const ledType = readU8(dv, offset + 2);
            const colorOrder = readU8(dv, offset + 3);
            const brightnessCap = readU8(dv, offset + 4);
            propConfigs.push({ propId: i + 1, ledCount, ledType, colorOrder, brightnessCap });
        }
    }

    // Parse Events
    const events = [];
    const eventsOffset = HEADER_SIZE + (version === 3 ? LUT_SIZE : 0);
    for (let i = 0; i < eventCount; i++) {
        const base = eventsOffset + i * EVENT_SIZE;
        if (base + EVENT_SIZE > dv.byteLength) break;

        const start = readU32LE(dv, base);
        const dur = readU32LE(dv, base + 4);
        const effectCode = readU8(dv, base + 8);
        const speed = readU8(dv, base + 9);
        const width = readU8(dv, base + 10);
        const color1 = readU32LE(dv, base + 12);
        const color2 = readU32LE(dv, base + 16);

        // Read prop mask (7 x 32-bit words = 28 bytes starting at offset 20)
        const propMask = [];
        for (let w = 0; w < 7; w++) {
            const word = readU32LE(dv, base + 20 + w * 4);
            propMask.push(word);
        }

        // Count props targeted
        let propCount = 0;
        for (const word of propMask) propCount += popcnt32(word);

        events.push({
            index: i + 1,
            start,
            dur,
            effectCode,
            speed,
            width,
            color1,
            color2,
            propMask,
            propCount,
        });
    }

    // Calculate stats
    let maxEnd = 0;
    for (const e of events) {
        const end = e.start + e.dur;
        if (end > maxEnd) maxEnd = end;
    }

    const configuredProps = propConfigs.filter(c => c.ledCount > 0).length;

    return {
        header,
        propConfigs,
        events,
        eventsOffset,
        stats: {
            totalEvents: events.length,
            duration: maxEnd,
            configuredProps,
            fileSize: bytes.length,
        }
    };
}

/**
 * Validate a parsed show.bin and return any warnings
 */
export function validateShowBin(parsed) {
    const warnings = [];

    if (!parsed || parsed.error) {
        return [{ type: 'error', message: parsed?.error || 'No data to validate' }];
    }

    const { header, propConfigs, events } = parsed;

    // Check version
    if (header.version !== 3) {
        warnings.push({ type: 'info', message: `File uses version ${header.version}. V3 features not available.` });
    }

    // Check for overlapping events that target at least one of the same props.
    // Multiple tracks/groups can legitimately overlap in time as long as their prop masks do not intersect.
    const masksIntersect = (a, b) => {
        for (let i = 0; i < 7; i++) {
            const aw = (a?.[i] ?? 0) >>> 0;
            const bw = (b?.[i] ?? 0) >>> 0;
            if ((aw & bw) !== 0) return true;
        }
        return false;
    };

    const intersectCount = (a, b) => {
        let count = 0;
        for (let i = 0; i < 7; i++) {
            const aw = (a?.[i] ?? 0) >>> 0;
            const bw = (b?.[i] ?? 0) >>> 0;
            count += popcnt32(aw & bw);
        }
        return count;
    };

    const sortedEvents = [...events].sort((a, b) => (a.start - b.start) || (a.index - b.index));
    const active = [];
    for (const next of sortedEvents) {
        const nextStart = next.start ?? 0;
        const nextEnd = (next.start ?? 0) + (next.dur ?? 0);

        for (let i = active.length - 1; i >= 0; i--) {
            if (active[i].end <= nextStart) {
                active.splice(i, 1);
            }
        }

        for (const curr of active) {
            const currHasMask = curr.event?.propMask && (curr.event.propMask.length > 0);
            const nextHasMask = next?.propMask && (next.propMask.length > 0);

            if (currHasMask && nextHasMask && !masksIntersect(curr.event.propMask, next.propMask)) {
                continue;
            }

            const shared = (currHasMask && nextHasMask) ? intersectCount(curr.event.propMask, next.propMask) : null;
            const sharedText = shared === null ? '' : ` and share ${shared} prop${shared === 1 ? '' : 's'}`;

            warnings.push({
                type: 'warn',
                message: `Events ${curr.event.index} and ${next.index} overlap (${curr.end}ms > ${nextStart}ms)${sharedText}`
            });
        }

        active.push({ event: next, end: nextEnd });
    }

    // Check for events with 0 duration or no props
    for (const e of events) {
        if (e.dur === 0) {
            warnings.push({ type: 'warn', message: `Event ${e.index} has 0 duration` });
        }
        if (e.propCount === 0) {
            warnings.push({ type: 'warn', message: `Event ${e.index} targets no props` });
        }
    }

    // Check for unconfigured props that are targeted
    const usedProps = new Set();
    for (const e of events) {
        for (let p = 1; p <= TOTAL_PROPS; p++) {
            if (eventTargetsProp(e, p)) usedProps.add(p);
        }
    }
    for (const propId of usedProps) {
        const cfg = propConfigs.find(c => c.propId === propId);
        if (!cfg || cfg.ledCount === 0) {
            warnings.push({ type: 'warn', message: `Prop ${propId} is targeted but has 0 LEDs configured` });
        }
    }

    return warnings;
}

/**
 * Export parsed data as JSON
 */
export function exportAsJSON(parsed) {
    if (!parsed || parsed.error) return null;

    return {
        header: parsed.header,
        propConfigs: parsed.propConfigs.filter(c => c.ledCount > 0),
        events: parsed.events.map(e => ({
            index: e.index,
            start: e.start,
            duration: e.dur,
            effect: EFFECT[e.effectCode]?.name || `UNKNOWN(${e.effectCode})`,
            effectCode: e.effectCode,
            color1: fmtRgb(e.color1),
            color2: fmtRgb(e.color2),
            speed: e.speed,
            width: e.width,
            propCount: e.propCount,
        })),
    };
}

/**
 * Export parsed data as CSV
 */
export function exportAsCSV(parsed) {
    if (!parsed || parsed.error) return null;

    const headers = ['Index', 'Start (ms)', 'Duration (ms)', 'Effect', 'Color 1', 'Color 2', 'Speed', 'Width', 'Prop Count'];
    const rows = parsed.events.map(e => [
        e.index,
        e.start,
        e.dur,
        EFFECT[e.effectCode]?.name || `UNKNOWN(${e.effectCode})`,
        fmtRgb(e.color1),
        fmtRgb(e.color2),
        e.speed,
        e.width,
        e.propCount,
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
