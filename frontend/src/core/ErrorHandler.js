/**
 * ErrorHandler - Centralized error handling and user notifications
 */

export class ErrorHandler {
    constructor() {
        this.toastElement = null;
        this.errorLog = [];
    }

    /**
     * Initialize with toast element
     * @param {HTMLElement} toastElement - Toast notification element
     */
    init(toastElement) {
        this.toastElement = toastElement;
    }

    /**
     * Handle error and show user notification
     * @param {Error|string} error - Error object or message
     * @param {Object} options - Options for error handling
     */
    handle(error, options = {}) {
        const {
            toast = true,
            log = true,
            prefix = 'Error'
        } = options;

        const message = this._extractMessage(error);
        const fullMessage = prefix ? `${prefix}: ${message}` : message;

        // Log to console
        if (log) {
            console.error(fullMessage, error);
            this.errorLog.push({
                timestamp: Date.now(),
                message: fullMessage,
                error
            });

            // Keep only last 50 errors
            if (this.errorLog.length > 50) {
                this.errorLog.shift();
            }
        }

        // Show toast notification
        if (toast) {
            this.showToast(fullMessage, 'error');
        }

        return {
            success: false,
            message: fullMessage
        };
    }

    /**
     * Show success notification
     * @param {string} message - Success message
     */
    success(message) {
        this.showToast(message, 'success');
        return {
            success: true,
            message
        };
    }

    /**
     * Show info notification
     * @param {string} message - Info message
     */
    info(message) {
        this.showToast(message, 'info');
    }

    /**
     * Show warning notification
     * @param {string} message - Warning message
     */
    warning(message) {
        this.showToast(message, 'warning');
    }

    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type of message (error, success, info, warning)
     */
    showToast(message, type = 'info') {
        if (!this.toastElement) {
            console.warn('Toast element not initialized');
            return;
        }

        this.toastElement.textContent = message;
        this.toastElement.classList.remove('show');

        // Force reflow
        void this.toastElement.offsetWidth;

        this.toastElement.classList.add('show');

        // Auto-hide after duration based on type
        const duration = type === 'error' ? 4000 : 2000;
        setTimeout(() => {
            this.toastElement.classList.remove('show');
        }, duration);
    }

    /**
     * Get error log
     * @returns {Array}
     */
    getErrorLog() {
        return [...this.errorLog];
    }

    /**
     * Clear error log
     */
    clearErrorLog() {
        this.errorLog = [];
    }

    /**
     * Handle validation errors
     * @param {Object} validation - Validation result
     * @param {string} context - Context for error message
     */
    handleValidationError(validation, context = 'Validation') {
        if (validation.valid) return { success: true };

        const message = validation.error || validation.errors?.join(', ') || 'Validation failed';
        return this.handle(message, { prefix: context });
    }

    /**
     * Extract message from error
     * @private
     */
    _extractMessage(error) {
        if (typeof error === 'string') {
            return error;
        }

        if (error instanceof Error) {
            return error.message;
        }

        if (error && error.message) {
            return error.message;
        }

        return 'Unknown error occurred';
    }

    /**
     * Create a standardized API response
     * @param {boolean} success - Whether operation succeeded
     * @param {*} data - Response data
     * @param {string} message - Response message
     * @param {string} error - Error message if failed
     */
    static createResponse(success, data = null, message = '', error = null) {
        return {
            success,
            data,
            message,
            error
        };
    }
}

// Singleton instance
export const errorHandler = new ErrorHandler();
