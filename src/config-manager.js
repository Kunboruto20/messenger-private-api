const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
    constructor(options = {}) {
        this.options = {
            configFile: options.configFile || 'messenger-config.json',
            autoSave: options.autoSave !== false,
            autoLoad: options.autoLoad !== false,
            encryptionKey: options.encryptionKey || null,
            ...options
        };
        
        this.config = new Map();
        this.defaults = new Map();
        this.watchers = new Map();
        this.isLoaded = false;
        
        // Setup default configurations
        this.setupDefaults();
        
        // Auto-load config if enabled
        if (this.options.autoLoad) {
            this.loadConfig().catch(console.error);
        }
    }
    
    setupDefaults() {
        // Client defaults
        this.setDefault('client', {
            autoReconnect: true,
            reconnectDelay: 5000,
            maxReconnectAttempts: 10,
            timeout: 30000,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        // Session defaults
        this.setDefault('session', {
            autoSave: true,
            autoLoad: true,
            sessionFile: 'messenger-session.json',
            encryptionKey: 'default-key-change-me',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        // Message defaults
        this.setDefault('message', {
            maxRetries: 3,
            retryDelay: 5000,
            typingDuration: 2000,
            maxMessageLength: 8000
        });
        
        // Media defaults
        this.setDefault('media', {
            maxFileSize: {
                image: 10 * 1024 * 1024,    // 10MB
                video: 100 * 1024 * 1024,   // 100MB
                audio: 25 * 1024 * 1024,    // 25MB
                document: 50 * 1024 * 1024  // 50MB
            },
            supportedTypes: {
                image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
                video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
                audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac'],
                document: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt']
            },
            autoCompress: false,
            compressionQuality: 80
        });
        
        // Automation defaults
        this.setDefault('automation', {
            defaultDelay: 1000,
            maxLoops: 100,
            maxScheduledTasks: 50,
            queueMaxSize: 1000
        });
        
        // Logging defaults
        this.setDefault('logging', {
            level: 'info',
            file: 'messenger.log',
            maxSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            console: true
        });
        
        // Error handling defaults
        this.setDefault('errorHandling', {
            logErrors: true,
            autoRecover: true,
            maxRetries: 3,
            retryDelay: 5000
        });
    }
    
    /**
     * Set default value for a configuration section
     * @param {string} section - Configuration section
     * @param {Object} defaults - Default values
     */
    setDefault(section, defaults) {
        this.defaults.set(section, defaults);
        
        // Initialize config section if not exists
        if (!this.config.has(section)) {
            this.config.set(section, { ...defaults });
        }
    }
    
    /**
     * Get configuration value
     * @param {string} key - Configuration key (e.g., 'client.autoReconnect')
     * @param {*} defaultValue - Default value if not found
     * @returns {*} - Configuration value
     */
    get(key, defaultValue = undefined) {
        const keys = key.split('.');
        let current = this.config;
        
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return defaultValue;
            }
        }
        
        return current;
    }
    
    /**
     * Set configuration value
     * @param {string} key - Configuration key (e.g., 'client.autoReconnect')
     * @param {*} value - Value to set
     */
    set(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        let current = this.config;
        
        // Navigate to the parent object
        for (const k of keys) {
            if (!current[k] || typeof current[k] !== 'object') {
                current[k] = {};
            }
            current = current[k];
        }
        
        // Set the value
        current[lastKey] = value;
        
        // Auto-save if enabled
        if (this.options.autoSave) {
            this.saveConfig().catch(console.error);
        }
    }
    
    /**
     * Get entire configuration section
     * @param {string} section - Section name
     * @returns {Object} - Section configuration
     */
    getSection(section) {
        return this.config.get(section) || {};
    }
    
    /**
     * Set entire configuration section
     * @param {string} section - Section name
     * @param {Object} config - Section configuration
     */
    setSection(section, config) {
        this.config.set(section, { ...config });
        
        // Auto-save if enabled
        if (this.options.autoSave) {
            this.saveConfig().catch(console.error);
        }
    }
    
    /**
     * Check if configuration key exists
     * @param {string} key - Configuration key
     * @returns {boolean} - Whether key exists
     */
    has(key) {
        const keys = key.split('.');
        let current = this.config;
        
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Delete configuration key
     * @param {string} key - Configuration key to delete
     */
    delete(key) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        let current = this.config;
        
        // Navigate to the parent object
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                return;
            }
        }
        
        // Delete the key
        if (current && typeof current === 'object') {
            delete current[lastKey];
        }
        
        // Auto-save if enabled
        if (this.options.autoSave) {
            this.saveConfig().catch(console.error);
        }
    }
    
    /**
     * Reset configuration to defaults
     * @param {string} section - Section to reset (optional, resets all if not specified)
     */
    reset(section = null) {
        if (section) {
            const defaults = this.defaults.get(section);
            if (defaults) {
                this.config.set(section, { ...defaults });
            }
        } else {
            // Reset all sections
            this.config.clear();
            this.setupDefaults();
        }
        
        // Auto-save if enabled
        if (this.options.autoSave) {
            this.saveConfig().catch(console.error);
        }
    }
    
    /**
     * Load configuration from file
     * @returns {Promise<boolean>} - Success status
     */
    async loadConfig() {
        try {
            const filePath = path.resolve(this.options.configFile);
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            
            if (!fileExists) {
                console.log('No configuration file found, using defaults');
                return false;
            }
            
            const fileContent = await fs.readFile(filePath, 'utf8');
            const loadedConfig = JSON.parse(fileContent);
            
            // Merge loaded config with defaults
            this.mergeConfig(loadedConfig);
            
            this.isLoaded = true;
            console.log('Configuration loaded successfully');
            return true;
            
        } catch (error) {
            console.error('Failed to load configuration:', error.message);
            return false;
        }
    }
    
    /**
     * Save configuration to file
     * @returns {Promise<boolean>} - Success status
     */
    async saveConfig() {
        try {
            const configData = this.serializeConfig();
            const filePath = path.resolve(this.options.configFile);
            
            // Ensure directory exists
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            
            await fs.writeFile(filePath, JSON.stringify(configData, null, 2));
            console.log('Configuration saved successfully');
            return true;
            
        } catch (error) {
            console.error('Failed to save configuration:', error.message);
            return false;
        }
    }
    
    /**
     * Merge loaded configuration with defaults
     * @param {Object} loadedConfig - Loaded configuration
     */
    mergeConfig(loadedConfig) {
        for (const [section, config] of Object.entries(loadedConfig)) {
            if (this.defaults.has(section)) {
                const defaults = this.defaults.get(section);
                this.config.set(section, { ...defaults, ...config });
            } else {
                this.config.set(section, config);
            }
        }
    }
    
    /**
     * Serialize configuration for saving
     * @returns {Object} - Serialized configuration
     */
    serializeConfig() {
        const serialized = {};
        
        for (const [section, config] of this.config) {
            serialized[section] = config;
        }
        
        return serialized;
    }
    
    /**
     * Watch configuration file for changes
     * @param {Function} callback - Callback function when config changes
     * @returns {string} - Watcher ID
     */
    watchConfig(callback) {
        const watcherId = this.generateWatcherId();
        
        this.watchers.set(watcherId, {
            id: watcherId,
            callback,
            active: true
        });
        
        return watcherId;
    }
    
    /**
     * Stop watching configuration
     * @param {string} watcherId - Watcher ID to stop
     */
    stopWatching(watcherId) {
        this.watchers.delete(watcherId);
    }
    
    /**
     * Get all watchers
     * @returns {Array} - Array of active watchers
     */
    getWatchers() {
        return Array.from(this.watchers.values());
    }
    
    /**
     * Validate configuration
     * @returns {Object} - Validation result
     */
    validateConfig() {
        const errors = [];
        const warnings = [];
        
        // Validate client configuration
        const clientConfig = this.getSection('client');
        if (clientConfig.timeout && clientConfig.timeout < 1000) {
            errors.push('Client timeout must be at least 1000ms');
        }
        
        if (clientConfig.reconnectDelay && clientConfig.reconnectDelay < 1000) {
            errors.push('Reconnect delay must be at least 1000ms');
        }
        
        // Validate media configuration
        const mediaConfig = this.getSection('media');
        for (const [type, maxSize] of Object.entries(mediaConfig.maxFileSize || {})) {
            if (maxSize <= 0) {
                errors.push(`Invalid max file size for ${type}: ${maxSize}`);
            }
        }
        
        // Validate automation configuration
        const automationConfig = this.getSection('automation');
        if (automationConfig.defaultDelay && automationConfig.defaultDelay < 100) {
            warnings.push('Default delay is very low, may cause rate limiting');
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    
    /**
     * Export configuration
     * @param {Object} options - Export options
     * @returns {Object} - Exported configuration
     */
    exportConfig(options = {}) {
        const {
            includeDefaults = false,
            includeMetadata = true
        } = options;
        
        const exportData = {
            config: this.serializeConfig()
        };
        
        if (includeDefaults) {
            exportData.defaults = Object.fromEntries(this.defaults);
        }
        
        if (includeMetadata) {
            exportData.metadata = {
                timestamp: Date.now(),
                version: '1.0.0',
                autoSave: this.options.autoSave,
                autoLoad: this.options.autoLoad
            };
        }
        
        return exportData;
    }
    
    /**
     * Import configuration
     * @param {Object} importData - Configuration data to import
     * @param {Object} options - Import options
     */
    importConfig(importData, options = {}) {
        const {
            merge = true,
            overwrite = false
        } = options;
        
        if (importData.config) {
            if (overwrite) {
                // Completely replace current config
                this.config.clear();
                this.mergeConfig(importData.config);
            } else if (merge) {
                // Merge with current config
                this.mergeConfig(importData.config);
            }
        }
        
        // Auto-save if enabled
        if (this.options.autoSave) {
            this.saveConfig().catch(console.error);
        }
    }
    
    /**
     * Get configuration statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
        const totalSections = this.config.size;
        const totalDefaults = this.defaults.size;
        const totalWatchers = this.watchers.size;
        
        const sectionStats = {};
        for (const [section, config] of this.config) {
            sectionStats[section] = Object.keys(config).length;
        }
        
        return {
            totalSections,
            totalDefaults,
            totalWatchers,
            isLoaded: this.isLoaded,
            autoSave: this.options.autoSave,
            autoLoad: this.options.autoLoad,
            sectionStats
        };
    }
    
    /**
     * Generate unique watcher ID
     * @returns {string} - Watcher ID
     */
    generateWatcherId() {
        return `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = ConfigManager;