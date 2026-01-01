/**
 * SidebarModeManager - Manages sidebar mode switching between Inspector and Menu
 */

export class SidebarModeManager {
    constructor() {
        /** @type {'inspector' | 'menu'} */
        this._mode = 'inspector';

        /** @type {string[]} Menu navigation stack (page IDs) */
        this._menuNavStack = ['root'];

        /** @type {Object|null} Captured inspector state for restoration */
        this._inspectorSnapshot = null;

        /** @type {Object} Dependencies injected via init */
        this._deps = {
            inspectorRenderer: null,
            menuRenderer: null,
            paneInspector: null,
            sidebarHeader: null,
            sidebarTitle: null,
            sidebarIcon: null,
            sidebarBackBtn: null,
            sidebarCloseBtn: null,
            hamburgerButton: null,
        };

        // Bound methods for cleanup
        this._boundOnClickAway = null;
        this._boundOnEscape = null;
    }

    /**
     * Initialize with dependencies
     * @param {Object} deps
     */
    init(deps) {
        this._deps = { ...this._deps, ...deps };
        this._setupEventListeners();
        this._updateUI();
    }

    /**
     * Get current mode
     * @returns {'inspector' | 'menu'}
     */
    get mode() {
        return this._mode;
    }

    /**
     * Get current menu page ID (top of navigation stack)
     * @returns {string}
     */
    get currentMenuPage() {
        return this._menuNavStack[this._menuNavStack.length - 1] || 'root';
    }

    /**
     * Check if we're at the menu root
     * @returns {boolean}
     */
    isAtMenuRoot() {
        return this._menuNavStack.length <= 1;
    }

    /**
     * Enter menu mode
     */
    enterMenu() {
        if (this._mode === 'menu') return;

        // Capture inspector state before switching
        this._captureInspectorSnapshot();

        this._mode = 'menu';
        this._menuNavStack = ['root'];
        this._updateUI();
        this._dispatchModeChange();
    }

    /**
     * Exit menu mode and return to inspector
     * @param {Object} options
     * @param {boolean} options.instant - Skip transition animation
     */
    exitMenu(options = {}) {
        if (this._mode === 'inspector') return;

        const { paneInspector } = this._deps;

        // Add no-transition class for instant mode switch
        if (options.instant && paneInspector) {
            paneInspector.classList.add('no-transition');
        }

        this._mode = 'inspector';
        this._menuNavStack = ['root'];
        this._updateUI();
        this._dispatchModeChange();

        // Restore inspector state
        if (options.instant) {
            // Immediate restore for instant mode
            this._restoreInspectorSnapshot();
            // Remove no-transition class after a frame
            requestAnimationFrame(() => {
                paneInspector?.classList.remove('no-transition');
            });
        } else {
            // Restore after transition completes
            requestAnimationFrame(() => {
                this._restoreInspectorSnapshot();
            });
        }
    }

    /**
     * Toggle between inspector and menu modes
     */
    toggle() {
        if (this._mode === 'inspector') {
            this.enterMenu();
        } else {
            this.exitMenu();
        }
    }

    /**
     * Navigate to a menu page (push onto stack)
     * @param {string} pageId
     */
    navigateTo(pageId) {
        if (this._mode !== 'menu') return;

        this._menuNavStack.push(pageId);
        this._updateUI();
        this._dispatchNavChange();
    }

    /**
     * Go back in menu navigation
     */
    goBack() {
        if (this._mode !== 'menu') return;

        if (this._menuNavStack.length > 1) {
            this._menuNavStack.pop();
            this._updateUI();
            this._dispatchNavChange();
        } else {
            // At root, go back exits menu
            this.exitMenu();
        }
    }

    /**
     * Capture inspector UI state for later restoration
     * @private
     */
    _captureInspectorSnapshot() {
        const { inspectorRenderer } = this._deps;
        if (inspectorRenderer?.captureSnapshot) {
            this._inspectorSnapshot = inspectorRenderer.captureSnapshot();
        }
    }

    /**
     * Restore inspector UI state from snapshot
     * @private
     */
    _restoreInspectorSnapshot() {
        const { inspectorRenderer } = this._deps;
        if (inspectorRenderer?.restoreSnapshot && this._inspectorSnapshot) {
            inspectorRenderer.restoreSnapshot(this._inspectorSnapshot);
        }
        this._inspectorSnapshot = null;
    }

    /**
     * Update UI elements to reflect current mode
     * @private
     */
    _updateUI() {
        const {
            paneInspector,
            sidebarHeader,
            sidebarTitle,
            sidebarIcon,
            sidebarBackBtn,
            sidebarCloseBtn,
            hamburgerButton,
        } = this._deps;

        // Update data attribute for CSS transitions
        if (paneInspector) {
            paneInspector.dataset.sidebarMode = this._mode;
        }

        // Update hamburger button state
        if (hamburgerButton) {
            hamburgerButton.setAttribute('aria-expanded', this._mode === 'menu' ? 'true' : 'false');
            hamburgerButton.classList.toggle('btn--active', this._mode === 'menu');
        }

        if (this._mode === 'menu') {
            // Menu mode UI
            if (sidebarTitle) sidebarTitle.textContent = 'Menu';
            if (sidebarIcon) {
                sidebarIcon.className = 'fas fa-bars text-[var(--ui-text-subtle)] text-xs';
            }
            if (sidebarCloseBtn) sidebarCloseBtn.classList.remove('hidden');

            // Show back button only if not at root
            if (sidebarBackBtn) {
                sidebarBackBtn.classList.toggle('hidden', this.isAtMenuRoot());
            }
        } else {
            // Inspector mode UI
            if (sidebarTitle) sidebarTitle.textContent = 'Inspector';
            if (sidebarIcon) {
                sidebarIcon.className = 'fas fa-sliders-h text-[var(--ui-text-subtle)] text-xs';
            }
            if (sidebarBackBtn) sidebarBackBtn.classList.add('hidden');
            if (sidebarCloseBtn) sidebarCloseBtn.classList.add('hidden');
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        const { sidebarBackBtn, sidebarCloseBtn, hamburgerButton, paneInspector } = this._deps;

        // Back button
        sidebarBackBtn?.addEventListener('click', () => this.goBack());

        // Close button
        sidebarCloseBtn?.addEventListener('click', () => this.exitMenu());

        // Hamburger toggle
        hamburgerButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Click-away to close menu
        this._boundOnClickAway = (e) => {
            if (this._mode !== 'menu') return;

            // Don't close if clicking inside the sidebar
            if (paneInspector?.contains(e.target)) return;

            // Don't close if clicking the hamburger button (handled separately)
            if (hamburgerButton?.contains(e.target)) return;

            // Close menu but allow the click to proceed (don't prevent default)
            this.exitMenu();
        };
        document.addEventListener('click', this._boundOnClickAway);

        // Escape key to close menu
        this._boundOnEscape = (e) => {
            if (e.key === 'Escape' && this._mode === 'menu') {
                this.exitMenu();
            }
        };
        document.addEventListener('keydown', this._boundOnEscape);
    }

    /**
     * Dispatch mode change event
     * @private
     */
    _dispatchModeChange() {
        window.dispatchEvent(new CustomEvent('sidebar-mode-changed', {
            detail: { mode: this._mode }
        }));
    }

    /**
     * Dispatch navigation change event (for menu renderer to update)
     * @private
     */
    _dispatchNavChange() {
        window.dispatchEvent(new CustomEvent('sidebar-menu-nav-changed', {
            detail: { pageId: this.currentMenuPage, stack: [...this._menuNavStack] }
        }));
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        if (this._boundOnClickAway) {
            document.removeEventListener('click', this._boundOnClickAway);
        }
        if (this._boundOnEscape) {
            document.removeEventListener('keydown', this._boundOnEscape);
        }
    }
}
