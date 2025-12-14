/**
 * Validation utilities for user inputs and project data
 */

/**
 * Validate hex color string
 * @param {string} hex - Hex color string
 * @returns {{valid: boolean, error?: string}}
 */
export function validateHexColor(hex) {
    if (typeof hex !== 'string') {
        return { valid: false, error: 'Color must be a string' };
    }

    const hexPattern = /^#?[0-9A-Fa-f]{6}$/;
    if (!hexPattern.test(hex)) {
        return { valid: false, error: 'Invalid hex color format (expected #RRGGBB)' };
    }

    return { valid: true };
}

/**
 * Validate time value (milliseconds)
 * @param {number} time - Time in milliseconds
 * @param {number} max - Maximum allowed time
 * @returns {{valid: boolean, error?: string}}
 */
export function validateTime(time, max = Infinity) {
    if (typeof time !== 'number' || isNaN(time)) {
        return { valid: false, error: 'Time must be a number' };
    }

    if (time < 0) {
        return { valid: false, error: 'Time cannot be negative' };
    }

    if (time > max) {
        return { valid: false, error: `Time cannot exceed ${max}ms` };
    }

    return { valid: true };
}

/**
 * Validate duration value
 * @param {number} duration - Duration in milliseconds
 * @param {number} min - Minimum duration
 * @param {number} max - Maximum duration
 * @returns {{valid: boolean, error?: string}}
 */
export function validateDuration(duration, min = 100, max = Infinity) {
    if (typeof duration !== 'number' || isNaN(duration)) {
        return { valid: false, error: 'Duration must be a number' };
    }

    if (duration < min) {
        return { valid: false, error: `Duration must be at least ${min}ms` };
    }

    if (duration > max) {
        return { valid: false, error: `Duration cannot exceed ${max}ms` };
    }

    return { valid: true };
}

/**
 * Validate LED count
 * @param {number} count - LED count
 * @returns {{valid: boolean, error?: string}}
 */
export function validateLedCount(count) {
    if (typeof count !== 'number' || isNaN(count)) {
        return { valid: false, error: 'LED count must be a number' };
    }

    if (!Number.isInteger(count)) {
        return { valid: false, error: 'LED count must be an integer' };
    }

    if (count < 1 || count > 1000) {
        return { valid: false, error: 'LED count must be between 1 and 1000' };
    }

    return { valid: true };
}

/**
 * Validate brightness value
 * @param {number} brightness - Brightness (0-255)
 * @returns {{valid: boolean, error?: string}}
 */
export function validateBrightness(brightness) {
    if (typeof brightness !== 'number' || isNaN(brightness)) {
        return { valid: false, error: 'Brightness must be a number' };
    }

    if (!Number.isInteger(brightness)) {
        return { valid: false, error: 'Brightness must be an integer' };
    }

    if (brightness < 0 || brightness > 255) {
        return { valid: false, error: 'Brightness must be between 0 and 255' };
    }

    return { valid: true };
}

/**
 * Validate ID string (e.g., "1-5, 8, 10-12")
 * @param {string} idString - ID string
 * @returns {{valid: boolean, error?: string}}
 */
export function validateIdString(idString) {
    if (typeof idString !== 'string') {
        return { valid: false, error: 'ID string must be a string' };
    }

    // Empty is valid
    if (idString.trim() === '') {
        return { valid: true };
    }

    const parts = idString.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === '') continue;

        if (trimmed.includes('-')) {
            const [start, end] = trimmed.split('-').map(s => parseInt(s.trim()));
            if (isNaN(start) || isNaN(end)) {
                return { valid: false, error: `Invalid range: ${trimmed}` };
            }
            if (start < 1 || end > 224) {
                return { valid: false, error: 'IDs must be between 1 and 224' };
            }
        } else {
            const num = parseInt(trimmed);
            if (isNaN(num)) {
                return { valid: false, error: `Invalid ID: ${trimmed}` };
            }
            if (num < 1 || num > 224) {
                return { valid: false, error: 'IDs must be between 1 and 224' };
            }
        }
    }

    return { valid: true };
}

/**
 * Validate project name
 * @param {string} name - Project name
 * @returns {{valid: boolean, error?: string}}
 */
export function validateProjectName(name) {
    if (typeof name !== 'string') {
        return { valid: false, error: 'Project name must be a string' };
    }

    if (name.trim() === '') {
        return { valid: false, error: 'Project name cannot be empty' };
    }

    if (name.length > 100) {
        return { valid: false, error: 'Project name is too long (max 100 characters)' };
    }

    // Check for invalid filename characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'Project name contains invalid characters' };
    }

    return { valid: true };
}

/**
 * Validate clip data
 * @param {Object} clip - Clip object
 * @returns {{valid: boolean, error?: string}}
 */
export function validateClip(clip) {
    if (!clip || typeof clip !== 'object') {
        return { valid: false, error: 'Clip must be an object' };
    }

    // Required fields
    if (!clip.id) {
        return { valid: false, error: 'Clip must have an id' };
    }

    if (!clip.type) {
        return { valid: false, error: 'Clip must have a type' };
    }

    // Validate startTime
    const timeValidation = validateTime(clip.startTime);
    if (!timeValidation.valid) {
        return { valid: false, error: `Invalid startTime: ${timeValidation.error}` };
    }

    // Validate duration
    const durationValidation = validateDuration(clip.duration);
    if (!durationValidation.valid) {
        return { valid: false, error: `Invalid duration: ${durationValidation.error}` };
    }

    // Validate color for LED clips
    if (clip.type !== 'audio' && clip.props) {
        if (clip.props.color) {
            const colorValidation = validateHexColor(clip.props.color);
            if (!colorValidation.valid) {
                return { valid: false, error: `Invalid color: ${colorValidation.error}` };
            }
        }
        if (clip.props.colorStart) {
            const colorStartValidation = validateHexColor(clip.props.colorStart);
            if (!colorStartValidation.valid) {
                return { valid: false, error: `Invalid colorStart: ${colorStartValidation.error}` };
            }
        }
    }

    return { valid: true };
}

/**
 * Validate track data
 * @param {Object} track - Track object
 * @returns {{valid: boolean, error?: string}}
 */
export function validateTrack(track) {
    if (!track || typeof track !== 'object') {
        return { valid: false, error: 'Track must be an object' };
    }

    if (!track.id) {
        return { valid: false, error: 'Track must have an id' };
    }

    if (!track.type || !['led', 'audio'].includes(track.type)) {
        return { valid: false, error: 'Track type must be "led" or "audio"' };
    }

    if (!Array.isArray(track.clips)) {
        return { valid: false, error: 'Track clips must be an array' };
    }

    // Validate each clip
    for (let i = 0; i < track.clips.length; i++) {
        const clipValidation = validateClip(track.clips[i]);
        if (!clipValidation.valid) {
            return { valid: false, error: `Clip ${i}: ${clipValidation.error}` };
        }
    }

    return { valid: true };
}

/**
 * Validate entire project structure
 * @param {Object} project - Project object
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProject(project) {
    const errors = [];

    if (!project || typeof project !== 'object') {
        return { valid: false, errors: ['Project must be an object'] };
    }

    // Validate project name
    if (project.name) {
        const nameValidation = validateProjectName(project.name);
        if (!nameValidation.valid) {
            errors.push(nameValidation.error);
        }
    }

    // Validate duration
    if (project.duration !== undefined) {
        const durationValidation = validateDuration(project.duration, 1000, 600000);
        if (!durationValidation.valid) {
            errors.push(`Project ${durationValidation.error}`);
        }
    }

    // Validate settings
    if (project.settings) {
        if (project.settings.ledCount !== undefined) {
            const ledValidation = validateLedCount(project.settings.ledCount);
            if (!ledValidation.valid) {
                errors.push(ledValidation.error);
            }
        }

        if (project.settings.brightness !== undefined) {
            const brightnessValidation = validateBrightness(project.settings.brightness);
            if (!brightnessValidation.valid) {
                errors.push(brightnessValidation.error);
            }
        }
    }

    // Validate tracks
    if (!Array.isArray(project.tracks)) {
        errors.push('Project must have a tracks array');
    } else {
        project.tracks.forEach((track, i) => {
            const trackValidation = validateTrack(track);
            if (!trackValidation.valid) {
                errors.push(`Track ${i}: ${trackValidation.error}`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
