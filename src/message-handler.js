const EventEmitter = require('events');

class MessageHandler extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.messageFilters = new Map();
        this.autoReplies = new Map();
        this.messageHistory = new Map();
        this.maxHistorySize = 1000;
        
        // Bind methods
        this.handleIncomingMessage = this.handleIncomingMessage.bind(this);
        this.processMessage = this.processMessage.bind(this);
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Listen for incoming messages from the client
        this.client.on('message', this.handleIncomingMessage);
        this.client.on('mediaMessage', this.handleIncomingMessage);
    }
    
    /**
     * Handle incoming message
     * @param {Object} message - Message object
     */
    async handleIncomingMessage(message) {
        try {
            // Add to history
            this.addToHistory(message);
            
            // Emit message event
            this.emit('messageReceived', message);
            
            // Process message through filters
            const processedMessage = await this.processMessage(message);
            
            // Check for auto-replies
            await this.checkAutoReplies(processedMessage);
            
            // Emit processed message event
            this.emit('messageProcessed', processedMessage);
            
        } catch (error) {
            console.error('Error handling incoming message:', error.message);
            this.emit('messageError', { message, error });
        }
    }
    
    /**
     * Process message through filters
     * @param {Object} message - Message object
     * @returns {Object} - Processed message
     */
    async processMessage(message) {
        let processedMessage = { ...message };
        
        // Apply filters in order
        for (const [filterId, filter] of this.messageFilters) {
            try {
                if (filter.enabled && filter.condition(processedMessage)) {
                    processedMessage = await filter.processor(processedMessage);
                    
                    // Emit filter applied event
                    this.emit('filterApplied', { filterId, message: processedMessage });
                }
            } catch (error) {
                console.error(`Filter ${filterId} error:`, error.message);
                this.emit('filterError', { filterId, message, error });
            }
        }
        
        return processedMessage;
    }
    
    /**
     * Add message filter
     * @param {string} filterId - Unique filter ID
     * @param {Function} condition - Function that returns true if filter should be applied
     * @param {Function} processor - Function that processes the message
     * @param {Object} options - Filter options
     */
    addFilter(filterId, condition, processor, options = {}) {
        if (this.messageFilters.has(filterId)) {
            throw new Error(`Filter with ID ${filterId} already exists`);
        }
        
        const filter = {
            id: filterId,
            condition,
            processor,
            enabled: options.enabled !== false,
            priority: options.priority || 0,
            ...options
        };
        
        this.messageFilters.set(filterId, filter);
        
        // Sort filters by priority
        this.sortFilters();
        
        this.emit('filterAdded', { filterId, filter });
        return filterId;
    }
    
    /**
     * Remove message filter
     * @param {string} filterId - Filter ID to remove
     */
    removeFilter(filterId) {
        const removed = this.messageFilters.delete(filterId);
        if (removed) {
            this.emit('filterRemoved', { filterId });
        }
        return removed;
    }
    
    /**
     * Enable/disable filter
     * @param {string} filterId - Filter ID
     * @param {boolean} enabled - Whether to enable the filter
     */
    setFilterEnabled(filterId, enabled) {
        const filter = this.messageFilters.get(filterId);
        if (filter) {
            filter.enabled = enabled;
            this.emit('filterToggled', { filterId, enabled });
            return true;
        }
        return false;
    }
    
    /**
     * Sort filters by priority
     */
    sortFilters() {
        const sortedFilters = new Map();
        const filtersArray = Array.from(this.messageFilters.entries());
        
        filtersArray.sort((a, b) => a[1].priority - b[1].priority);
        
        filtersArray.forEach(([id, filter]) => {
            sortedFilters.set(id, filter);
        });
        
        this.messageFilters = sortedFilters;
    }
    
    /**
     * Add auto-reply rule
     * @param {string} ruleId - Unique rule ID
     * @param {Function|string} trigger - Trigger condition or text
     * @param {Function|string} reply - Reply function or text
     * @param {Object} options - Rule options
     */
    addAutoReply(ruleId, trigger, reply, options = {}) {
        if (this.autoReplies.has(ruleId)) {
            throw new Error(`Auto-reply rule with ID ${ruleId} already exists`);
        }
        
        const rule = {
            id: ruleId,
            trigger: typeof trigger === 'string' ? (msg) => msg.content.toLowerCase().includes(trigger.toLowerCase()) : trigger,
            reply: typeof reply === 'string' ? () => reply : reply,
            enabled: options.enabled !== false,
            cooldown: options.cooldown || 0,
            lastUsed: 0,
            ...options
        };
        
        this.autoReplies.set(ruleId, rule);
        this.emit('autoReplyAdded', { ruleId, rule });
        return ruleId;
    }
    
    /**
     * Remove auto-reply rule
     * @param {string} ruleId - Rule ID to remove
     */
    removeAutoReply(ruleId) {
        const removed = this.autoReplies.delete(ruleId);
        if (removed) {
            this.emit('autoReplyRemoved', { ruleId });
        }
        return removed;
    }
    
    /**
     * Check and execute auto-replies
     * @param {Object} message - Message object
     */
    async checkAutoReplies(message) {
        for (const [ruleId, rule] of this.autoReplies) {
            if (!rule.enabled) continue;
            
            // Check cooldown
            if (rule.cooldown > 0) {
                const timeSinceLastUse = Date.now() - rule.lastUsed;
                if (timeSinceLastUse < rule.cooldown) continue;
            }
            
            try {
                // Check if trigger condition is met
                if (rule.trigger(message)) {
                    // Generate reply
                    const reply = await rule.reply(message);
                    
                    if (reply) {
                        // Send reply
                        await this.client.sendMessage(message.jid, reply);
                        
                        // Update last used time
                        rule.lastUsed = Date.now();
                        
                        this.emit('autoReplySent', { ruleId, message, reply });
                    }
                }
            } catch (error) {
                console.error(`Auto-reply rule ${ruleId} error:`, error.message);
                this.emit('autoReplyError', { ruleId, message, error });
            }
        }
    }
    
    /**
     * Add message to history
     * @param {Object} message - Message object
     */
    addToHistory(message) {
        const threadId = message.jid || message.threadId;
        
        if (!this.messageHistory.has(threadId)) {
            this.messageHistory.set(threadId, []);
        }
        
        const threadHistory = this.messageHistory.get(threadId);
        threadHistory.push({
            ...message,
            timestamp: Date.now()
        });
        
        // Limit history size
        if (threadHistory.length > this.maxHistorySize) {
            threadHistory.shift();
        }
    }
    
    /**
     * Get message history for a thread
     * @param {string} threadId - Thread ID
     * @param {number} limit - Maximum number of messages to return
     * @returns {Array} - Message history
     */
    getHistory(threadId, limit = 50) {
        const history = this.messageHistory.get(threadId) || [];
        return history.slice(-limit);
    }
    
    /**
     * Clear message history for a thread
     * @param {string} threadId - Thread ID (optional, clears all if not specified)
     */
    clearHistory(threadId = null) {
        if (threadId) {
            this.messageHistory.delete(threadId);
        } else {
            this.messageHistory.clear();
        }
        
        this.emit('historyCleared', { threadId });
    }
    
    /**
     * Search messages in history
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Array} - Matching messages
     */
    searchHistory(query, options = {}) {
        const {
            threadId = null,
            caseSensitive = false,
            limit = 100
        } = options;
        
        const results = [];
        const searchQuery = caseSensitive ? query : query.toLowerCase();
        
        for (const [id, history] of this.messageHistory) {
            if (threadId && id !== threadId) continue;
            
            for (const message of history) {
                const content = caseSensitive ? message.content : message.content.toLowerCase();
                
                if (content.includes(searchQuery)) {
                    results.push({
                        ...message,
                        threadId: id
                    });
                    
                    if (results.length >= limit) break;
                }
            }
            
            if (results.length >= limit) break;
        }
        
        return results;
    }
    
    /**
     * Get message statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
        const totalMessages = Array.from(this.messageHistory.values())
            .reduce((sum, history) => sum + history.length, 0);
        
        const totalThreads = this.messageHistory.size;
        
        const filterStats = {
            total: this.messageFilters.size,
            enabled: Array.from(this.messageFilters.values()).filter(f => f.enabled).length
        };
        
        const autoReplyStats = {
            total: this.autoReplies.size,
            enabled: Array.from(this.autoReplies.values()).filter(r => r.enabled).length
        };
        
        return {
            totalMessages,
            totalThreads,
            filters: filterStats,
            autoReplies: autoReplyStats,
            maxHistorySize: this.maxHistorySize
        };
    }
    
    /**
     * Set maximum history size
     * @param {number} size - Maximum number of messages to keep per thread
     */
    setMaxHistorySize(size) {
        this.maxHistorySize = size;
        
        // Trim existing history if needed
        for (const [threadId, history] of this.messageHistory) {
            if (history.length > size) {
                this.messageHistory.set(threadId, history.slice(-size));
            }
        }
        
        this.emit('maxHistorySizeChanged', { size });
    }
    
    /**
     * Export message history
     * @param {string} threadId - Thread ID (optional, exports all if not specified)
     * @returns {Object} - Exported history data
     */
    exportHistory(threadId = null) {
        const exportData = {
            timestamp: Date.now(),
            maxHistorySize: this.maxHistorySize,
            threads: {}
        };
        
        if (threadId) {
            const history = this.messageHistory.get(threadId);
            if (history) {
                exportData.threads[threadId] = history;
            }
        } else {
            for (const [id, history] of this.messageHistory) {
                exportData.threads[id] = history;
            }
        }
        
        return exportData;
    }
    
    /**
     * Import message history
     * @param {Object} importData - History data to import
     */
    importHistory(importData) {
        if (!importData.threads || typeof importData.threads !== 'object') {
            throw new Error('Invalid history data format');
        }
        
        for (const [threadId, history] of Object.entries(importData.threads)) {
            if (Array.isArray(history)) {
                this.messageHistory.set(threadId, history);
            }
        }
        
        if (importData.maxHistorySize) {
            this.setMaxHistorySize(importData.maxHistorySize);
        }
        
        this.emit('historyImported', { importData });
    }
}

module.exports = MessageHandler;