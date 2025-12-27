export const CONFIG = {
    defaultDuration: 3000,
    minClipDuration: 100,
    magnetThreshold: 200,
    headerWidth: 240,
    maxUndoStack: 50,
    previewThrottleMs: 16, // ~60fps
    ledsPerTrack: 55
};

export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

export function lerpColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
}

export function hslToRgb(h, s, l) {
    let r, g, b;
    if (s == 0) { r = g = b = l; } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
    }
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function getSnappedTime(time, snapOpts = null, gridSizeLegacy = undefined) {
    let snapEnabled = false;
    let gridSize;

    if (snapOpts !== null && typeof snapOpts === 'object') {
        snapEnabled = Boolean(snapOpts.snapEnabled);
        gridSize = snapOpts.gridSize;
    } else if (snapOpts !== null) {
        // Legacy positional: getSnappedTime(time, snapEnabled, gridSize)
        snapEnabled = Boolean(snapOpts);
        gridSize = gridSizeLegacy;
    }

    if (!snapEnabled) return time;
    const size = (typeof gridSize === 'number' && !Number.isNaN(gridSize) && gridSize > 0) ? gridSize : 1000;
    return Math.round(time / size) * size;
}

export function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function pseudoRandom(seed) {
    var t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

// --- NEW: Helper to parse "1-5, 8, 10-12" into an array of IDs ---
export function parseIdString(str) {
    const ids = new Set();
    if (!str) return [];
    str.split(',').forEach(part => {
        part = part.trim();
        if (part === "") return;
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                const low = Math.min(start, end);
                const high = Math.max(start, end);
                for (let i = low; i <= high; i++) {
                    if (i >= 1 && i <= 224) ids.add(i); // Limit to valid range
                }
            }
        } else {
            const num = parseInt(part);
            if (!isNaN(num) && num >= 1 && num <= 224) ids.add(num);
        }
    });
    return Array.from(ids).sort((a, b) => a - b);
}

export function formatTime(ms) {
    const totalSecs = ms / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    const centisecs = Math.floor((totalSecs % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centisecs.toString().padStart(2, '0')}`;
}

export function parseTime(input) {
    if (typeof input === 'number') return input;

    const str = String(input ?? '').trim();
    if (!str) return NaN;

    if (str.includes(':')) {
        const parts = str.split(':');
        const minutes = parseFloat(parts[0]) || 0;
        const seconds = parseFloat(parts.slice(1).join(':')) || 0;
        return (minutes * 60 + seconds) * 1000;
    }

    const seconds = parseFloat(str);
    return Number.isFinite(seconds) ? seconds * 1000 : NaN;
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function getCssVar(name, fallback = '') {
    if (typeof document === 'undefined') return fallback;

    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const value = raw.trim();
    return value || fallback;
}

/**
 * Formats Pico connection status for display in the status bar.
 * @param {Object} status - The connection status from backend
 * @returns {{ text: string, title: string }} - Formatted text and tooltip
 */
export function formatPicoStatus(status) {
    if (!status?.connected) {
        return {
            text: 'Pico: Not detected',
            title: 'No PicoLume device detected'
        };
    }

    const usbDrive = status.usbDrive || '';
    const serialPort = status.serialPort || '';
    const mode = String(status.mode || '').toUpperCase();
    const portLocked = status.serialPortLocked === true;

    // Warning suffix for locked port
    const lockWarning = portLocked ? ' [PORT BUSY]' : '';
    const lockTooltip = portLocked
        ? '\n\nWarning: Serial port is in use by another application (Arduino IDE, PuTTY, etc.). Auto-reset after upload will fail.'
        : '';

    if (mode === 'BOOTLOADER') {
        return {
            text: usbDrive ? `Pico: Bootloader (${usbDrive})` : 'Pico: Bootloader',
            title: 'Pico is in UF2 bootloader mode'
        };
    }

    if (mode === 'USB' || mode === 'USB+SERIAL') {
        const details = [];
        if (usbDrive) details.push(usbDrive);
        if (serialPort) details.push(serialPort);
        const suffix = details.length ? ` (${details.join(', ')})` : '';
        return {
            text: `Pico: USB${suffix}${lockWarning}`,
            title: 'PicoLume USB upload volume detected' + lockTooltip
        };
    }

    if (mode === 'SERIAL') {
        const suffix = serialPort ? ` (${serialPort})` : '';
        return {
            text: `Pico: Connected${suffix}${lockWarning}`,
            title: 'PicoLume serial connection detected' + lockTooltip
        };
    }

    return {
        text: 'Pico: Connected' + lockWarning,
        title: 'PicoLume device detected' + lockTooltip
    };
}

/**
 * Shows a custom confirmation dialog instead of the native confirm().
 * @param {string} message - The message to display
 * @param {string} [title] - Optional custom title (defaults to "PicoLume Studio")
 * @returns {Promise<boolean>} - Resolves to true if OK clicked, false if cancelled
 */
export function showConfirm(message, title = 'PicoLume Studio') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        if (!modal || !messageEl || !okBtn || !cancelBtn) {
            // Fallback to native confirm if modal elements not found
            resolve(window.confirm(message));
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.setAttribute('aria-hidden', 'false');

        const cleanup = () => {
            modal.setAttribute('aria-hidden', 'true');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onKeydown = (e) => {
            if (e.key === 'Escape') { onCancel(); }
            else if (e.key === 'Enter') { onOk(); }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);

        okBtn.focus();
    });
}
