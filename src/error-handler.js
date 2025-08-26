const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ErrorHandler extends EventEmitter {
    constructor(client, options = {}) {
        super();
        this.client = client;
        this.options = {
            logErrors: options.logErrors !== false,
            logFile: options.logFile || 'messenger-errors.log',
            maxLogSize: options.maxLogSize || 10 * 1024 * 1024, // 10MB
            maxLogFiles: options.maxLogFiles || 5,
            logLevel: options.logLevel || 'error', // error, warn, info, debug
            autoRecover: options.autoRecover !== false,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 5000,
            ...options
        };
        
        this.errorHistory = [];
        this.maxHistorySize = 1000;
        this.errorCounts = new Map();
        this.recoveryStrategies = new Map();
        
        // Bind methods
        this.handleError = this.handleError.bind(this);
        this.logError = this.logError.bind(this);
        
        // Setup default recovery strategies
        this.setupDefaultRecoveryStrategies();
        
        // Setup error event listeners
        this.setupErrorListeners();
    }
    
    setupDefaultRecoveryStrategies() {
        // Network errors - retry with exponential backoff
        this.addRecoveryStrategy('NetworkError', async (error, context) => {
            if (context.retryCount < this.options.maxRetries) {
                const delay = this.options.retryDelay * Math.pow(2, context.retryCount);
                await this.sleep(delay);
                return { action: 'retry', delay };
            }
            return { action: 'fail' };
        });
        
        // Authentication errors - try to re-authenticate
        this.addRecoveryStrategy('AuthenticationError', async (error, context) => {
            if (this.client.credentials) {
                try {
                    await this.client.login(this.client.credentials);
                    return { action: 'retry' };
                } catch (loginError) {
                    return { action: 'fail', reason: 'Re-authentication failed' };
                }
            }
            return { action: 'fail', reason: 'No credentials available' };
        });
        
        // Rate limiting errors - wait and retry
        this.addRecoveryStrategy('RateLimitError', async (error, context) => {
            const delay = Math.min(30000, this.options.retryDelay * Math.pow(2, context.retryCount));
            await this.sleep(delay);
            return { action: 'retry', delay };
        });
        
        // Session expired errors - try to restore session
        this.addRecoveryStrategy('SessionExpiredError', async (error, context) => {
            if (this.client.sessionManager) {
                try {
                    const restored = await this.client.sessionManager.loadSession();
                    if (restored) {
                        return { action: 'retry' };
                    }
                } catch (sessionError) {
                    // Continue to fallback
                }
            }
            
            // Fallback: try to re-authenticate
            if (this.client.credentials) {
                try {
                    await this.client.login(this.client.credentials);
                    return { action: 'retry' };
                } catch (loginError) {
                    return { action: 'fail', reason: 'Session restoration and re-authentication failed' };
                }
            }
            
            return { action: 'fail', reason: 'No recovery options available' };
        });
    }
    
    setupErrorListeners() {
        // Listen for client errors
        this.client.on('error', this.handleError);
        this.client.on('messageError', this.handleError);
        this.client.on('mediaError', this.handleError);
        this.client.on('loginError', this.handleError);
        
        // Listen for other error events
        const errorEvents = [
            'filterError', 'autoReplyError', 'loopError', 'handlerError',
            'filterError', 'mediaError', 'groupError', 'contactError'
        ];
        
        errorEvents.forEach(eventName => {
            this.client.on(eventName, (data) => {
                if (data.error) {
                    this.handleError(data.error, { event: eventName, data });
                }
            });
        });
    }
    
    /**
     * Handle errors from various sources
     * @param {Error} error - Error object
     * @param {Object} context - Error context
     */
    async handleError(error, context = {}) {
        try {
            // Create error record
            const errorRecord = this.createErrorRecord(error, context);
            
            // Add to history
            this.addToHistory(errorRecord);
            
            // Update error counts
            this.updateErrorCounts(errorRecord);
            
            // Log error
            if (this.options.logErrors) {
                await this.logError(errorRecord);
            }
            
            // Emit error event
            this.emit('error', errorRecord);
            
            // Try to recover if auto-recovery is enabled
            if (this.options.autoRecover) {
                await this.attemptRecovery(errorRecord);
            }
            
        } catch (handlerError) {
            console.error('Error in error handler:', handlerError.message);
        }
    }
    
    /**
     * Create error record
     * @param {Error} error - Error object
     * @param {Object} context - Error context
     * @returns {Object} - Error record
     */
    createErrorRecord(error, context) {
        return {
            id: this.generateErrorId(),
            message: error.message,
            name: error.name,
            stack: error.stack,
            timestamp: Date.now(),
            context: {
                ...context,
                clientState: {
                    isAuthenticated: this.client.isAuthenticated,
                    isConnected: this.client.isConnected,
                    userId: this.client.userId
                }
            },
            severity: this.calculateSeverity(error, context),
            handled: false,
            recovered: false
        };
    }
    
    /**
     * Calculate error severity
     * @param {Error} error - Error object
     * @param {Object} context - Error context
     * @returns {string} - Severity level
     */
    calculateSeverity(error, context) {
        // Critical errors
        if (error.name === 'AuthenticationError' || error.name === 'SessionExpiredError') {
            return 'critical';
        }
        
        // High severity errors
        if (error.name === 'NetworkError' || error.name === 'RateLimitError') {
            return 'high';
        }
        
        // Medium severity errors
        if (error.name === 'ValidationError' || error.name === 'ParseError') {
            return 'medium';
        }
        
        // Low severity errors
        return 'low';
    }
    
    /**
     * Add error to history
     * @param {Object} errorRecord - Error record
     */
    addToHistory(errorRecord) {
        this.errorHistory.push(errorRecord);
        
        // Limit history size
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }
    
    /**
     * Update error counts
     * @param {Object} errorRecord - Error record
     */
    updateErrorCounts(errorRecord) {
        const errorType = errorRecord.name;
        const currentCount = this.errorCounts.get(errorType) || 0;
        this.errorCounts.set(errorType, currentCount + 1);
    }
    
    /**
     * Log error to file
     * @param {Object} errorRecord - Error record
     */
    async logError(errorRecord) {
        try {
            const logEntry = this.formatLogEntry(errorRecord);
            await this.appendToLogFile(logEntry);
            
            // Rotate log files if needed
            await this.rotateLogFiles();
            
        } catch (logError) {
            console.error('Failed to log error:', logError.message);
        }
    }
    
    /**
     * Format log entry
     * @param {Object} errorRecord - Error record
     * @returns {string} - Formatted log entry
     */
    formatLogEntry(errorRecord) {
        const timestamp = new Date(errorRecord.timestamp).toISOString();
        const severity = errorRecord.severity.toUpperCase();
        const context = JSON.stringify(errorRecord.context);
        
        return `[${timestamp}] ${severity} ${errorRecord.name}: ${errorRecord.message}\nContext: ${context}\nStack: ${errorRecord.stack}\n---\n`;
    }
    
    /**
     * Append to log file
     * @param {string} logEntry - Log entry to append
     */
    async appendToLogFile(logEntry) {
        try {
            await fs.appendFile(this.options.logFile, logEntry);
        } catch (error) {
            // If file doesn't exist, create it
            if (error.code === 'ENOENT') {
                await fs.writeFile(this.options.logFile, logEntry);
            } else {
                throw error;
            }
        }
    }
    
    /**
     * Rotate log files if they exceed max size
     */
    async rotateLogFiles() {
        try {
            const stats = await fs.stat(this.options.logFile);
            
            if (stats.size > this.options.maxLogSize) {
                // Create backup file
                const backupFile = `${this.options.logFile}.${Date.now()}`;
                await fs.rename(this.options.logFile, backupFile);
                
                // Remove old backup files
                await this.cleanupOldLogFiles();
            }
        } catch (error) {
            // Ignore errors during rotation
        }
    }
    
    /**
     * Clean up old log files
     */
    async cleanupOldLogFiles() {
        try {
            const logDir = path.dirname(this.options.logFile);
            const logBase = path.basename(this.options.logFile);
            const files = await fs.readdir(logDir);
            
            const logFiles = files
                .filter(file => file.startsWith(logBase) && file !== logBase)
                .map(file => ({ name: file, path: path.join(logDir, file) }))
                .sort((a, b) => b.name.localeCompare(a.name));
            
            // Keep only the most recent files
            for (let i = this.options.maxLogFiles; i < logFiles.length; i++) {
                await fs.unlink(logFiles[i].path);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }
    
    /**
     * Attempt to recover from error
     * @param {Object} errorRecord - Error record
     */
    async attemptRecovery(errorRecord) {
        try {
            const strategy = this.recoveryStrategies.get(errorRecord.name);
            
            if (strategy) {
                const result = await strategy(errorRecord.error, {
                    retryCount: errorRecord.context.retryCount || 0,
                    maxRetries: this.options.maxRetries
                });
                
                if (result.action === 'retry') {
                    errorRecord.recovered = true;
                    this.emit('errorRecovered', { errorRecord, result });
                } else {
                    this.emit('errorRecoveryFailed', { errorRecord, result });
                }
            } else {
                // No recovery strategy available
                this.emit('noRecoveryStrategy', { errorRecord });
            }
            
        } catch (recoveryError) {
            console.error('Recovery attempt failed:', recoveryError.message);
            this.emit('recoveryError', { errorRecord, recoveryError });
        }
    }
    
    /**
     * Add custom recovery strategy
     * @param {string} errorType - Error type to handle
     * @param {Function} strategy - Recovery strategy function
     */
    addRecoveryStrategy(errorType, strategy) {
        this.recoveryStrategies.set(errorType, strategy);
        this.emit('recoveryStrategyAdded', { errorType, strategy });
    }
    
    /**
     * Remove recovery strategy
     * @param {string} errorType - Error type
     */
    removeRecoveryStrategy(errorType) {
        const removed = this.recoveryStrategies.delete(errorType);
        if (removed) {
            this.emit('recoveryStrategyRemoved', { errorType });
        }
        return removed;
    }
    
    /**
     * Get error statistics
     * @returns {Object} - Error statistics
     */
    getErrorStats() {
        const totalErrors = this.errorHistory.length;
        const criticalErrors = this.errorHistory.filter(e => e.severity === 'critical').length;
        const highErrors = this.errorHistory.filter(e => e.severity === 'high').length;
        const mediumErrors = this.errorHistory.filter(e => e.severity === 'medium').length;
        const lowErrors = this.errorHistory.filter(e => e.severity === 'low').length;
        
        const recoveredErrors = this.errorHistory.filter(e => e.recovered).length;
        const recoveryRate = totalErrors > 0 ? (recoveredErrors / totalErrors) * 100 : 0;
        
        return {
            totalErrors,
            criticalErrors,
            highErrors,
            mediumErrors,
            lowErrors,
            recoveredErrors,
            recoveryRate,
            errorCounts: Object.fromEntries(this.errorCounts),
            totalRecoveryStrategies: this.recoveryStrategies.size
        };
    }
    
    /**
     * Get error history
     * @param {Object} options - Filter options
     * @returns {Array} - Filtered error history
     */
    getErrorHistory(options = {}) {
        const {
            severity = null,
            errorType = null,
            startTime = null,
            endTime = null,
            limit = 100,
            recovered = null
        } = options;
        
        let filteredHistory = this.errorHistory;
        
        // Filter by severity
        if (severity) {
            filteredHistory = filteredHistory.filter(e => e.severity === severity);
        }
        
        // Filter by error type
        if (errorType) {
            filteredHistory = filteredHistory.filter(e => e.name === errorType);
        }
        
        // Filter by time range
        if (startTime) {
            filteredHistory = filteredHistory.filter(e => e.timestamp >= startTime);
        }
        if (endTime) {
            filteredHistory = filteredHistory.filter(e => e.timestamp <= endTime);
        }
        
        // Filter by recovery status
        if (recovered !== null) {
            filteredHistory = filteredHistory.filter(e => e.recovered === recovered);
        }
        
        // Apply limit and sort by timestamp (newest first)
        return filteredHistory
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }
    
    /**
     * Clear error history
     * @param {Object} options - Clear options
     */
    clearErrorHistory(options = {}) {
        const {
            severity = null,
            errorType = null,
            olderThan = null
        } = options;
        
        if (severity) {
            this.errorHistory = this.errorHistory.filter(e => e.severity !== severity);
        } else if (errorType) {
            this.errorHistory = this.errorHistory.filter(e => e.name !== errorType);
        } else if (olderThan) {
            const cutoffTime = Date.now() - olderThan;
            this.errorHistory = this.errorHistory.filter(e => e.timestamp >= cutoffTime);
        } else {
            this.errorHistory = [];
        }
        
        this.emit('errorHistoryCleared', options);
    }
    
    /**
     * Export error data
     * @param {Object} options - Export options
     * @returns {Object} - Exported data
     */
    exportErrorData(options = {}) {
        const {
            includeHistory = true,
            includeStats = true,
            includeStrategies = false
        } = options;
        
        const exportData = {
            timestamp: Date.now(),
            maxHistorySize: this.maxHistorySize,
            options: this.options
        };
        
        if (includeHistory) {
            exportData.errorHistory = this.errorHistory;
        }
        
        if (includeStats) {
            exportData.errorStats = this.getErrorStats();
        }
        
        if (includeStrategies) {
            exportData.recoveryStrategies = Array.from(this.recoveryStrategies.keys());
        }
        
        return exportData;
    }
    
    /**
     * Import error data
     * @param {Object} importData - Error data to import
     */
    importErrorData(importData) {
        if (importData.maxHistorySize) {
            this.maxHistorySize = importData.maxHistorySize;
        }
        
        if (importData.errorHistory) {
            this.errorHistory = importData.errorHistory;
        }
        
        this.emit('errorDataImported', { importData });
    }
    
    /**
     * Generate unique error ID
     * @returns {string} - Error ID
     */
    generateErrorId() {
        return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Utility function to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ErrorHandler;