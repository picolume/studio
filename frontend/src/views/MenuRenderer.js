/**
 * MenuRenderer - Renders menu content in the sidebar
 */

/**
 * Menu page definitions
 * Each page has a title and array of items
 */
const MENU_PAGES = {
    root: {
        title: 'MENU',
        items: [
            { type: 'action', label: 'New Project', icon: 'fa-file', shortcut: 'Ctrl+N', action: 'new' },
            { type: 'action', label: 'Open Project', icon: 'fa-folder-open', shortcut: 'Ctrl+O', action: 'open' },
            { type: 'divider' },
            { type: 'action', label: 'Save', icon: 'fa-save', shortcut: 'Ctrl+S', action: 'save' },
            { type: 'action', label: 'Save As...', icon: 'fa-file-export', shortcut: 'Ctrl+Shift+S', action: 'save-as' },
            { type: 'divider' },
            { type: 'action', label: 'Export Binary', icon: 'fa-download', action: 'export' },
            { type: 'action', label: 'Upload to Device', icon: 'fa-microchip', action: 'upload' },
            { type: 'action', label: 'Inspect Binary', icon: 'fa-search', action: 'inspect' },
            { type: 'divider' },
            {
                type: 'accordion',
                label: 'Themes',
                icon: 'fa-palette',
                children: [
                    { type: 'theme', label: 'Standard', themeId: 'standard' },
                    { type: 'theme', label: 'Daylight', themeId: 'daylight' },
                    { type: 'theme', label: 'Lilac', themeId: 'lilac' },
                    { type: 'theme', label: 'Rose', themeId: 'rose' },
                    { type: 'theme', label: 'Latte', themeId: 'latte' },
                    { type: 'theme', label: 'Aurora', themeId: 'aurora' },
                    { type: 'theme', label: 'Nord', themeId: 'nord' },
                    { type: 'theme', label: 'Solarized', themeId: 'solarized' },
                    { type: 'theme', label: 'Gruvbox', themeId: 'gruvbox' },
                    { type: 'theme', label: 'High Contrast', themeId: 'hc-dark' },
                    { type: 'theme', label: 'Crimson', themeId: 'crimson' },
                    { type: 'theme', label: 'Graphite', themeId: 'graphite' },
                    { type: 'theme', label: 'Forest', themeId: 'forest' },
                ]
            },
            { type: 'divider' },
            { type: 'action', label: 'Project Settings', icon: 'fa-cog', action: 'settings' },
            { type: 'action', label: 'About', icon: 'fa-circle-info', action: 'about' },
            { type: 'action', label: 'User Manual', icon: 'fa-book', action: 'manual' },
        ]
    }
};

export class MenuRenderer {
    constructor() {
        /** @type {Object} Dependencies injected via init */
        this._deps = {
            sidebarModeManager: null,
            menuContent: null,
            sidebarTitle: null,
            sidebarBackBtn: null,
            themeManager: null,
        };

        /** @type {Object} Action handlers */
        this._actionHandlers = {};
    }

    /**
     * Initialize with dependencies
     * @param {Object} deps
     */
    init(deps) {
        this._deps = { ...this._deps, ...deps };
        this._actionHandlers = deps.actionHandlers || {};
        this._setupEventListeners();
    }

    /**
     * Register an action handler
     * @param {string} action
     * @param {Function} handler
     */
    registerAction(action, handler) {
        this._actionHandlers[action] = handler;
    }

    /**
     * Render the current menu page
     * @param {string} pageId - Page to render (defaults to current page from manager)
     */
    render(pageId) {
        const { menuContent, sidebarModeManager, sidebarTitle, sidebarBackBtn } = this._deps;
        if (!menuContent) return;

        const currentPage = pageId || sidebarModeManager?.currentMenuPage || 'root';
        const page = MENU_PAGES[currentPage];

        if (!page) {
            menuContent.innerHTML = '<div class="p-4 text-[var(--ui-text-subtle)]">Unknown menu page</div>';
            return;
        }

        // Update header title
        if (sidebarTitle) {
            sidebarTitle.textContent = page.title;
        }

        // Show/hide back button based on navigation depth
        if (sidebarBackBtn && sidebarModeManager) {
            sidebarBackBtn.classList.toggle('hidden', sidebarModeManager.isAtMenuRoot());
        }

        // Clear and render content
        menuContent.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'flex flex-col';

        for (const item of page.items) {
            const el = this._renderItem(item);
            if (el) list.appendChild(el);
        }

        menuContent.appendChild(list);
    }

    /**
     * Render a single menu item
     * @param {Object} item
     * @returns {HTMLElement|null}
     * @private
     */
    _renderItem(item) {
        switch (item.type) {
            case 'action':
                return this._renderActionItem(item);
            case 'nav':
                return this._renderNavItem(item);
            case 'accordion':
                return this._renderAccordionItem(item);
            case 'theme':
                return this._renderThemeItem(item);
            case 'divider':
                return this._renderDivider();
            default:
                return null;
        }
    }

    /**
     * Render an action item (executes action and closes menu)
     * @param {Object} item
     * @returns {HTMLElement}
     * @private
     */
    _renderActionItem(item) {
        const btn = document.createElement('button');
        btn.className = 'sidebar-menu-item flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] transition-colors';
        btn.setAttribute('role', 'menuitem');

        // Icon
        if (item.icon) {
            const icon = document.createElement('i');
            icon.className = `fas ${item.icon} w-4 text-center text-[var(--ui-text-subtle)]`;
            icon.setAttribute('aria-hidden', 'true');
            btn.appendChild(icon);
        }

        // Label
        const label = document.createElement('span');
        label.className = 'flex-1';
        label.textContent = item.label;
        btn.appendChild(label);

        // Keyboard shortcut hint
        if (item.shortcut) {
            const kbd = document.createElement('kbd');
            kbd.className = 'text-xs text-[var(--ui-text-subtle)] bg-[var(--ui-panel-bg)] px-1.5 py-0.5 rounded border border-[var(--ui-border)]';
            kbd.textContent = item.shortcut;
            btn.appendChild(kbd);
        }

        // Click handler
        btn.addEventListener('click', () => {
            this._executeAction(item.action);
        });

        return btn;
    }

    /**
     * Render a navigation item (navigates to sub-page)
     * @param {Object} item
     * @returns {HTMLElement}
     * @private
     */
    _renderNavItem(item) {
        const btn = document.createElement('button');
        btn.className = 'sidebar-menu-item flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] transition-colors';
        btn.setAttribute('role', 'menuitem');

        // Icon
        if (item.icon) {
            const icon = document.createElement('i');
            icon.className = `fas ${item.icon} w-4 text-center text-[var(--ui-text-subtle)]`;
            icon.setAttribute('aria-hidden', 'true');
            btn.appendChild(icon);
        }

        // Label
        const label = document.createElement('span');
        label.className = 'flex-1';
        label.textContent = item.label;
        btn.appendChild(label);

        // Chevron
        const chevron = document.createElement('i');
        chevron.className = 'fas fa-chevron-right text-xs text-[var(--ui-text-subtle)]';
        chevron.setAttribute('aria-hidden', 'true');
        btn.appendChild(chevron);

        // Click handler - capture destination in closure
        const destination = item.destination;
        const sidebarModeManager = this._deps.sidebarModeManager;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (sidebarModeManager) {
                sidebarModeManager.navigateTo(destination);
            }
        });

        return btn;
    }

    /**
     * Render a theme selection item
     * Theme selection does NOT close the menu - allows user to preview themes
     * @param {Object} item
     * @returns {HTMLElement}
     * @private
     */
    _renderThemeItem(item) {
        const { themeManager } = this._deps;
        const currentTheme = themeManager?.getCurrentTheme?.() || 'standard';
        const isActive = currentTheme === item.themeId;

        const btn = document.createElement('button');
        btn.className = 'sidebar-menu-item flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] transition-colors';
        btn.setAttribute('role', 'menuitemradio');
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');

        // Checkmark or spacer
        const check = document.createElement('i');
        check.className = `fas fa-check w-4 text-center ${isActive ? 'text-[var(--accent)]' : 'invisible'}`;
        check.setAttribute('aria-hidden', 'true');
        btn.appendChild(check);

        // Label
        const label = document.createElement('span');
        label.className = 'flex-1';
        label.textContent = item.label;
        btn.appendChild(label);

        // Click handler - apply theme WITHOUT closing menu (allows preview)
        const themeId = item.themeId;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Apply theme
            const handler = this._actionHandlers['theme'];
            if (handler) {
                handler(themeId);
            }

            // Update all theme item checkmarks in the accordion
            const accordion = btn.closest('.sidebar-menu-accordion');
            if (accordion) {
                accordion.querySelectorAll('[role="menuitemradio"]').forEach(item => {
                    const itemCheck = item.querySelector('.fa-check');
                    const isThis = item === btn;
                    item.setAttribute('aria-checked', isThis ? 'true' : 'false');
                    if (itemCheck) {
                        itemCheck.classList.toggle('invisible', !isThis);
                        itemCheck.classList.toggle('text-[var(--accent)]', isThis);
                    }
                });
            }
        });

        return btn;
    }

    /**
     * Render an accordion item (expandable section with children)
     * @param {Object} item
     * @returns {HTMLElement}
     * @private
     */
    _renderAccordionItem(item) {
        const container = document.createElement('div');
        container.className = 'sidebar-menu-accordion';

        // Header button (toggle)
        const header = document.createElement('button');
        header.className = 'sidebar-menu-item flex items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--ui-text)] hover:bg-[var(--ui-toolbar-hover-bg)] transition-colors w-full';
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', 'false');

        // Icon
        if (item.icon) {
            const icon = document.createElement('i');
            icon.className = `fas ${item.icon} w-4 text-center text-[var(--ui-text-subtle)]`;
            icon.setAttribute('aria-hidden', 'true');
            header.appendChild(icon);
        }

        // Label
        const label = document.createElement('span');
        label.className = 'flex-1';
        label.textContent = item.label;
        header.appendChild(label);

        // Chevron (rotates when expanded)
        const chevron = document.createElement('i');
        chevron.className = 'fas fa-chevron-down text-xs text-[var(--ui-text-subtle)] transition-transform duration-200';
        chevron.setAttribute('aria-hidden', 'true');
        header.appendChild(chevron);

        container.appendChild(header);

        // Content panel (children)
        const content = document.createElement('div');
        content.className = 'overflow-hidden transition-all duration-200 ease-out';
        content.style.maxHeight = '0';
        content.style.opacity = '0';

        // Render children with indentation
        const childList = document.createElement('div');
        childList.className = 'pl-4 border-l border-[var(--ui-border)] ml-6 mb-2';

        for (const child of (item.children || [])) {
            const el = this._renderItem(child);
            if (el) childList.appendChild(el);
        }

        content.appendChild(childList);
        container.appendChild(content);

        // Toggle handler
        let isExpanded = false;
        header.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            isExpanded = !isExpanded;
            header.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

            // Rotate chevron
            chevron.style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0deg)';

            // Expand/collapse content
            if (isExpanded) {
                content.style.maxHeight = content.scrollHeight + 'px';
                content.style.opacity = '1';
            } else {
                content.style.maxHeight = '0';
                content.style.opacity = '0';
            }
        });

        return container;
    }

    /**
     * Render a divider
     * @returns {HTMLElement}
     * @private
     */
    _renderDivider() {
        const div = document.createElement('div');
        div.className = 'my-1 border-t border-[var(--ui-border)]';
        div.setAttribute('role', 'separator');
        return div;
    }

    /**
     * Execute an action and close the menu
     * @param {string} action
     * @param {*} data - Optional data to pass to handler
     * @private
     */
    _executeAction(action, data) {
        const { sidebarModeManager } = this._deps;

        // Close menu instantly (no transition) when executing actions
        sidebarModeManager?.exitMenu({ instant: true });

        // Execute handler
        const handler = this._actionHandlers[action];
        if (handler) {
            if (data !== undefined) {
                handler(data);
            } else {
                handler();
            }
        }
    }

    /**
     * Set up event listeners
     * @private
     */
    _setupEventListeners() {
        // Re-render when navigation changes
        window.addEventListener('sidebar-menu-nav-changed', (e) => {
            this.render(e.detail.pageId);
        });

        // Render when entering menu mode
        window.addEventListener('sidebar-mode-changed', (e) => {
            if (e.detail.mode === 'menu') {
                this.render();
            }
        });
    }
}
