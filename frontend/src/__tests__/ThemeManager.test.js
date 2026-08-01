import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager } from '../controllers/ThemeManager.js';

describe('ThemeManager', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-theme');
        document.body.innerHTML = '<button id="btn-theme-toggle"><i></i></button>';
        localStorage.clear();
    });

    it('registers Frost as a dark theme', () => {
        const manager = new ThemeManager();
        const frost = manager.getAvailableThemes().find(theme => theme.name === 'frost');

        expect(frost).toEqual({ name: 'frost', isLight: false });
    });

    it('applies and persists Frost', () => {
        const manager = new ThemeManager();
        const onThemeChange = vi.fn();
        manager.init({ onThemeChange });

        manager.setTheme('frost');

        expect(document.documentElement.dataset.theme).toBe('frost');
        expect(localStorage.getItem('picolume:theme')).toBe('frost');
        expect(localStorage.getItem('picolume:last-dark-theme')).toBe('frost');
        expect(onThemeChange).toHaveBeenLastCalledWith('frost');
    });
});
