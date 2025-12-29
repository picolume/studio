/**
 * MenuController - Manages the hamburger menu dropdown
 */

export class MenuController {
    constructor() {
        // UI elements
        this.hamburgerButton = null;
        this.dropdown = null;

        // Action handlers (set via init)
        this._actionHandlers = {};

        // Bound methods for cleanup
        this._boundOnDocumentClick = null;
        this._boundOnEscape = null;
    }

    /**
     * Initialize with UI elements and action handlers
     * @param {Object} options
     * @param {HTMLElement} options.hamburgerButton - The hamburger menu button
     * @param {HTMLElement} options.dropdown - The dropdown menu element
     * @param {Object} options.actionHandlers - Map of action names to handler functions
     */
    init(options = {}) {
        this.hamburgerButton = options.hamburgerButton || document.getElementById('btn-hamburger');
        this.dropdown = options.dropdown || document.getElementById('hamburger-dropdown');
        this._actionHandlers = options.actionHandlers || {};

        this._setupEventListeners();
    }

    /**
     * Check if menu is open
     * @returns {boolean}
     */
    isOpen() {
        return this.hamburgerButton?.getAttribute('aria-expanded') === 'true';
    }

    /**
     * Open the menu
     */
    open() {
        if (!this.hamburgerButton || !this.dropdown) return;
        this.hamburgerButton.setAttribute('aria-expanded', 'true');
        this.dropdown.setAttribute('aria-hidden', 'false');
    }

    /**
     * Close the menu
     */
    close() {
        if (!this.hamburgerButton || !this.dropdown) return;
        this.hamburgerButton.setAttribute('aria-expanded', 'false');
        this.dropdown.setAttribute('aria-hidden', 'true');
    }

    /**
     * Toggle the menu open/closed
     */
    toggle() {
        if (this.isOpen()) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Register an action handler
     * @param {string} action - Action name
     * @param {Function} handler - Handler function
     */
    registerAction(action, handler) {
        this._actionHandlers[action] = handler;
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        // Hamburger button click
        this.hamburgerButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close when clicking outside
        this._boundOnDocumentClick = (e) => {
            if (!e.target.closest('#hamburger-menu')) {
                this.close();
            }
        };
        document.addEventListener('click', this._boundOnDocumentClick);

        // Close on Escape key
        this._boundOnEscape = (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.close();
            }
        };
        document.addEventListener('keydown', this._boundOnEscape);

        // Handle menu item clicks
        this.dropdown?.addEventListener('click', (e) => this._handleItemClick(e));

        // Position submenus on hover
        this._setupSubmenuPositioning();
    }

    /**
     * Set up submenu positioning for viewport constraints
     * @private
     */
    _setupSubmenuPositioning() {
        const submenus = this.dropdown?.querySelectorAll('.hamburger-submenu');
        if (!submenus) return;

        submenus.forEach(submenu => {
            const trigger = submenu.querySelector('.hamburger-submenu-trigger');
            const panel = submenu.querySelector('.hamburger-submenu-panel');
            if (!trigger || !panel) return;

            const positionPanel = () => {
                // Reset any previous positioning
                panel.style.top = '';
                panel.style.bottom = '';
                panel.style.maxHeight = '';

                // Wait for the panel to be visible to get accurate measurements
                requestAnimationFrame(() => {
                    const panelRect = panel.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    const padding = 16;

                    // Check if panel extends below viewport
                    if (panelRect.bottom > viewportHeight - padding) {
                        // Calculate how much we need to shift up
                        const overflow = panelRect.bottom - (viewportHeight - padding);
                        const newTop = panelRect.top - overflow;

                        if (newTop >= padding) {
                            // Shift the panel up
                            panel.style.top = `${-overflow}px`;
                        } else {
                            // Panel is too tall - constrain height and enable scrolling
                            panel.style.top = `${padding - panelRect.top}px`;
                            panel.style.maxHeight = `${viewportHeight - padding * 2}px`;
                            panel.style.overflowY = 'auto';
                        }
                    }
                });
            };

            // Position on hover/focus
            submenu.addEventListener('mouseenter', positionPanel);
            submenu.addEventListener('focusin', positionPanel);
        });
    }

    /**
     * Handle menu item clicks
     * @param {Event} e
     * @private
     */
    _handleItemClick(e) {
        const item = e.target.closest('.hamburger-item');
        if (!item) return;

        const action = item.dataset.action;

        // Check if item should keep menu open (e.g., theme submenu)
        if (item.dataset.keepOpen === 'true') {
            return;
        }

        // Close menu before executing action
        this.close();

        // Execute action handler if registered
        if (action && this._actionHandlers[action]) {
            // For theme action, pass the theme value
            if (action === 'theme') {
                this._actionHandlers[action](item.dataset.theme);
            } else {
                this._actionHandlers[action](e);
            }
        }
    }

    /**
     * Clean up event listeners
     */
    destroy() {
        if (this._boundOnDocumentClick) {
            document.removeEventListener('click', this._boundOnDocumentClick);
        }
        if (this._boundOnEscape) {
            document.removeEventListener('keydown', this._boundOnEscape);
        }
    }
}
