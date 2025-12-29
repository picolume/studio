/**
 * ThemeManager - Manages application themes and light/dark mode toggling
 */

export class ThemeManager {
    constructor() {
        // Storage keys
        this.STORAGE_KEY = 'picolume:theme';
        this.LAST_DARK_KEY = 'picolume:last-dark-theme';
        this.LAST_LIGHT_KEY = 'picolume:last-light-theme';

        // Theme definitions
        this.DEFAULT_THEME = 'standard';
        this.DEFAULT_LIGHT_THEME = 'daylight';
        this.LIGHT_THEMES = new Set(['daylight', 'lilac', 'rose', 'latte']);
        this.THEMES = new Set([
            'standard', 'daylight', 'lilac', 'rose', 'latte',
            'aurora', 'nord', 'solarized', 'gruvbox',
            'hc-dark', 'crimson', 'graphite', 'forest'
        ]);

        // UI elements
        this.toggleButton = null;
        this.themeMenuItems = null;

        // Callbacks
        this._onThemeChange = null;
    }

    /**
     * Initialize with UI elements
     * @param {Object} options
     * @param {HTMLElement} options.toggleButton - The light/dark toggle button
     * @param {Function} options.onThemeChange - Callback when theme changes
     */
    init(options = {}) {
        this.toggleButton = options.toggleButton || document.getElementById('btn-theme-toggle');
        this._onThemeChange = options.onThemeChange || null;

        // Set up toggle button event
        this.toggleButton?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleLightDark();
        });

        // Load and apply saved theme
        this.setTheme(this._loadTheme());
    }

    /**
     * Get the current theme name
     * @returns {string}
     */
    getCurrentTheme() {
        return document.documentElement.dataset.theme || this.DEFAULT_THEME;
    }

    /**
     * Check if the current theme is a light theme
     * @returns {boolean}
     */
    isLightTheme() {
        return this.LIGHT_THEMES.has(this.getCurrentTheme());
    }

    /**
     * Set the application theme
     * @param {string} theme - Theme name
     */
    setTheme(theme) {
        const resolved = this.THEMES.has(theme) ? theme : this.DEFAULT_THEME;
        document.documentElement.dataset.theme = resolved;

        // Persist to localStorage
        this._saveTheme(resolved);

        // Track last used light/dark theme
        if (this.LIGHT_THEMES.has(resolved)) {
            this._saveLastLightTheme(resolved);
        } else {
            this._saveLastDarkTheme(resolved);
        }

        // Update menu items
        this._updateMenuItems(resolved);

        // Update toggle button
        this._syncToggleButton(resolved);

        // Notify listeners
        if (this._onThemeChange) {
            this._onThemeChange(resolved);
        }
    }

    /**
     * Toggle between light and dark themes
     */
    toggleLightDark() {
        const current = this.getCurrentTheme();

        if (this.LIGHT_THEMES.has(current)) {
            // Currently light, switch to last dark theme
            this.setTheme(this._loadLastDarkTheme());
        } else {
            // Currently dark, save it and switch to last light theme
            this._saveLastDarkTheme(current);
            this.setTheme(this._loadLastLightTheme());
        }
    }

    /**
     * Get all available themes
     * @returns {Array<{name: string, isLight: boolean}>}
     */
    getAvailableThemes() {
        return Array.from(this.THEMES).map(name => ({
            name,
            isLight: this.LIGHT_THEMES.has(name)
        }));
    }

    // Private methods

    _loadTheme() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw && this.THEMES.has(raw)) return raw;
        } catch { /* ignore */ }
        return this.DEFAULT_THEME;
    }

    _saveTheme(theme) {
        try {
            localStorage.setItem(this.STORAGE_KEY, theme);
        } catch { /* ignore */ }
    }

    _loadLastDarkTheme() {
        try {
            const raw = localStorage.getItem(this.LAST_DARK_KEY);
            if (raw && this.THEMES.has(raw) && !this.LIGHT_THEMES.has(raw)) return raw;
        } catch { /* ignore */ }
        return this.DEFAULT_THEME;
    }

    _saveLastDarkTheme(theme) {
        try {
            localStorage.setItem(this.LAST_DARK_KEY, theme);
        } catch { /* ignore */ }
    }

    _loadLastLightTheme() {
        try {
            const raw = localStorage.getItem(this.LAST_LIGHT_KEY);
            if (raw && this.LIGHT_THEMES.has(raw)) return raw;
        } catch { /* ignore */ }
        return this.DEFAULT_LIGHT_THEME;
    }

    _saveLastLightTheme(theme) {
        try {
            localStorage.setItem(this.LAST_LIGHT_KEY, theme);
        } catch { /* ignore */ }
    }

    _updateMenuItems(currentTheme) {
        document.querySelectorAll('.hamburger-theme-item[data-action="theme"]').forEach(btn => {
            const isActive = btn.dataset.theme === currentTheme;
            btn.setAttribute('aria-checked', String(isActive));
            btn.classList.toggle('is-active', isActive);
        });
    }

    _syncToggleButton(theme) {
        if (!this.toggleButton) return;

        const isLight = this.LIGHT_THEMES.has(theme);
        this.toggleButton.setAttribute('aria-pressed', String(isLight));
        this.toggleButton.title = isLight
            ? 'Switch to dark theme (Alt+T)'
            : 'Switch to light theme (Alt+T)';

        const icon = this.toggleButton.querySelector('i');
        if (icon) {
            icon.className = isLight ? 'fas fa-moon' : 'fas fa-circle-half-stroke';
            icon.setAttribute('aria-hidden', 'true');
        }
    }
}
