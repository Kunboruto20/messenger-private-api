const EventEmitter = require('events');

class EventManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.eventHandlers = new Map();
        this.eventQueue = [];
        this.isProcessing = false;
        this.eventHistory = [];
        this.maxHistorySize = 1000;
        
        // Bind methods
        this.processEventQueue = this.processEventQueue.bind(this);
        this.handleClientEvent = this.handleClientEvent.bind(this);
        
        // Setup event listeners for client events
        this.setupClientEventListeners();
    }
    
    setupClientEventListeners() {
        // Listen for all client events and route them through the event manager
        const clientEvents = [
            'login', 'loginError', 'logout', 'messageSent', 'messageError',
            'mediaSent', 'mediaError', 'typingIndicator', 'messageRead',
            'sessionRestored', 'reconnected', 'maxReconnectAttemptsReached'
        ];
        
        clientEvents.forEach(eventName => {
            this.client.on(eventName, (data) => {
                this.handleClientEvent(eventName, data);
            });
        });
    }
    
    /**
     * Handle client events and route them through the event manager
     * @param {string} eventName - Event name
     * @param {Object} data - Event data
     */
    handleClientEvent(eventName, data) {
        // Add to event history
        this.addToHistory(eventName, data);
        
        // Emit the event
        this.emit(eventName, data);
        
        // Add to processing queue
        this.addToQueue(eventName, data);
        
        // Start processing if not already running
        if (!this.isProcessing) {
            this.processEventQueue();
        }
    }
    
    /**
     * Add event to history
     * @param {string} eventName - Event name
     * @param {Object} data - Event data
     */
    addToHistory(eventName, data) {
        const eventRecord = {
            id: this.generateEventId(),
            eventName,
            data,
            timestamp: Date.now(),
            processed: false
        };
        
        this.eventHistory.push(eventRecord);
        
        // Limit history size
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }
    
    /**
     * Add event to processing queue
     * @param {string} eventName - Event name
     * @param {Object} data - Event data
     */
    addToQueue(eventName, data) {
        const queueItem = {
            id: this.generateEventId(),
            eventName,
            data,
            timestamp: Date.now(),
            priority: this.getEventPriority(eventName),
            retryCount: 0,
            maxRetries: 3
        };
        
        // Insert based on priority
        const insertIndex = this.eventQueue.findIndex(item => item.priority > queueItem.priority);
        if (insertIndex === -1) {
            this.eventQueue.push(queueItem);
        } else {
            this.eventQueue.splice(insertIndex, 0, queueItem);
        }
    }
    
    /**
     * Get event priority (lower = higher priority)
     * @param {string} eventName - Event name
     * @returns {number} - Priority value
     */
    getEventPriority(eventName) {
        const priorityMap = {
            // High priority events
            'login': 1,
            'loginError': 1,
            'logout': 1,
            'sessionRestored': 1,
            'reconnected': 1,
            'maxReconnectAttemptsReached': 1,
            
            // Medium priority events
            'messageSent': 5,
            'messageError': 5,
            'mediaSent': 5,
            'mediaError': 5,
            'typingIndicator': 5,
            'messageRead': 5,
            
            // Low priority events
            'default': 10
        };
        
        return priorityMap[eventName] || priorityMap.default;
    }
    
    /**
     * Process the event queue
     */
    async processEventQueue() {
        if (this.isProcessing || this.eventQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        while (this.eventQueue.length > 0) {
            const item = this.eventQueue.shift();
            
            try {
                // Emit processing event
                this.emit('eventProcessing', item);
                
                // Process the event through registered handlers
                await this.processEvent(item);
                
                // Mark as processed in history
                const historyItem = this.eventHistory.find(h => h.id === item.id);
                if (historyItem) {
                    historyItem.processed = true;
                }
                
                // Emit processed event
                this.emit('eventProcessed', item);
                
            } catch (error) {
                console.error(`Failed to process event ${item.eventName}:`, error.message);
                
                // Handle retries
                if (item.retryCount < item.maxRetries) {
                    item.retryCount++;
                    item.priority = Math.min(item.priority + 1, 15); // Lower priority
                    this.eventQueue.push(item);
                    
                    this.emit('eventRetry', { item, retryCount: item.retryCount });
                } else {
                    this.emit('eventFailed', { item, error: error.message });
                }
            }
            
            // Small delay between events to avoid overwhelming
            await this.sleep(10);
        }
        
        this.isProcessing = false;
        this.emit('eventQueueEmpty');
    }
    
    /**
     * Process individual event
     * @param {Object} item - Event queue item
     */
    async processEvent(item) {
        const handlers = this.eventHandlers.get(item.eventName) || [];
        
        // Execute handlers in order
        for (const handler of handlers) {
            try {
                if (handler.enabled) {
                    await handler.callback(item.data, item);
                }
            } catch (error) {
                console.error(`Event handler error for ${item.eventName}:`, error.message);
                this.emit('handlerError', { eventName: item.eventName, handler, error });
            }
        }
    }
    
    /**
     * Register event handler
     * @param {string} eventName - Event name to handle
     * @param {Function} callback - Handler function
     * @param {Object} options - Handler options
     * @returns {string} - Handler ID
     */
    registerHandler(eventName, callback, options = {}) {
        const handlerId = this.generateHandlerId();
        
        const handler = {
            id: handlerId,
            eventName,
            callback,
            enabled: options.enabled !== false,
            priority: options.priority || 0,
            ...options
        };
        
        if (!this.eventHandlers.has(eventName)) {
            this.eventHandlers.set(eventName, []);
        }
        
        const handlers = this.eventHandlers.get(eventName);
        handlers.push(handler);
        
        // Sort handlers by priority
        handlers.sort((a, b) => a.priority - b.priority);
        
        this.emit('handlerRegistered', { handlerId, eventName, handler });
        return handlerId;
    }
    
    /**
     * Unregister event handler
     * @param {string} handlerId - Handler ID to remove
     * @returns {boolean} - Success status
     */
    unregisterHandler(handlerId) {
        for (const [eventName, handlers] of this.eventHandlers) {
            const index = handlers.findIndex(h => h.id === handlerId);
            if (index > -1) {
                handlers.splice(index, 1);
                this.emit('handlerUnregistered', { handlerId, eventName });
                return true;
            }
        }
        return false;
    }
    
    /**
     * Enable/disable event handler
     * @param {string} handlerId - Handler ID
     * @param {boolean} enabled - Whether to enable the handler
     * @returns {boolean} - Success status
     */
    setHandlerEnabled(handlerId, enabled) {
        for (const [eventName, handlers] of this.eventHandlers) {
            const handler = handlers.find(h => h.id === handlerId);
            if (handler) {
                handler.enabled = enabled;
                this.emit('handlerToggled', { handlerId, eventName, enabled });
                return true;
            }
        }
        return false;
    }
    
    /**
     * Get event handlers for a specific event
     * @param {string} eventName - Event name
     * @returns {Array} - Array of handlers
     */
    getEventHandlers(eventName) {
        return this.eventHandlers.get(eventName) || [];
    }
    
    /**
     * Get all registered handlers
     * @returns {Object} - Map of event names to handlers
     */
    getAllHandlers() {
        const result = {};
        for (const [eventName, handlers] of this.eventHandlers) {
            result[eventName] = handlers.map(h => ({
                id: h.id,
                enabled: h.enabled,
                priority: h.priority
            }));
        }
        return result;
    }
    
    /**
     * Clear all event handlers
     */
    clearHandlers() {
        this.eventHandlers.clear();
        this.emit('handlersCleared');
    }
    
    /**
     * Get event history
     * @param {Object} options - Filter options
     * @returns {Array} - Filtered event history
     */
    getEventHistory(options = {}) {
        const {
            eventName = null,
            startTime = null,
            endTime = null,
            limit = 100,
            processed = null
        } = options;
        
        let filteredHistory = this.eventHistory;
        
        // Filter by event name
        if (eventName) {
            filteredHistory = filteredHistory.filter(h => h.eventName === eventName);
        }
        
        // Filter by time range
        if (startTime) {
            filteredHistory = filteredHistory.filter(h => h.timestamp >= startTime);
        }
        if (endTime) {
            filteredHistory = filteredHistory.filter(h => h.timestamp <= endTime);
        }
        
        // Filter by processed status
        if (processed !== null) {
            filteredHistory = filteredHistory.filter(h => h.processed === processed);
        }
        
        // Apply limit and sort by timestamp (newest first)
        return filteredHistory
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }
    
    /**
     * Clear event history
     * @param {Object} options - Clear options
     */
    clearEventHistory(options = {}) {
        const {
            eventName = null,
            olderThan = null
        } = options;
        
        if (eventName) {
            // Clear specific event type
            this.eventHistory = this.eventHistory.filter(h => h.eventName !== eventName);
        } else if (olderThan) {
            // Clear events older than specified time
            const cutoffTime = Date.now() - olderThan;
            this.eventHistory = this.eventHistory.filter(h => h.timestamp >= cutoffTime);
        } else {
            // Clear all history
            this.eventHistory = [];
        }
        
        this.emit('eventHistoryCleared', options);
    }
    
    /**
     * Get event statistics
     * @returns {Object} - Statistics object
     */
    getEventStats() {
        const totalEvents = this.eventHistory.length;
        const processedEvents = this.eventHistory.filter(h => h.processed).length;
        const failedEvents = totalEvents - processedEvents;
        
        // Count events by type
        const eventCounts = {};
        this.eventHistory.forEach(h => {
            eventCounts[h.eventName] = (eventCounts[h.eventName] || 0) + 1;
        });
        
        return {
            totalEvents,
            processedEvents,
            failedEvents,
            successRate: totalEvents > 0 ? (processedEvents / totalEvents) * 100 : 0,
            eventCounts,
            queueLength: this.eventQueue.length,
            isProcessing: this.isProcessing,
            totalHandlers: Array.from(this.eventHandlers.values())
                .reduce((sum, handlers) => sum + handlers.length, 0)
        };
    }
    
    /**
     * Set maximum history size
     * @param {number} size - Maximum number of events to keep in history
     */
    setMaxHistorySize(size) {
        this.maxHistorySize = size;
        
        // Trim existing history if needed
        if (this.eventHistory.length > size) {
            this.eventHistory = this.eventHistory.slice(-size);
        }
        
        this.emit('maxHistorySizeChanged', { size });
    }
    
    /**
     * Export event data
     * @param {Object} options - Export options
     * @returns {Object} - Exported data
     */
    exportEventData(options = {}) {
        const {
            includeHistory = true,
            includeHandlers = true,
            includeQueue = false
        } = options;
        
        const exportData = {
            timestamp: Date.now(),
            maxHistorySize: this.maxHistorySize,
            stats: this.getEventStats()
        };
        
        if (includeHistory) {
            exportData.eventHistory = this.eventHistory;
        }
        
        if (includeHandlers) {
            exportData.eventHandlers = this.getAllHandlers();
        }
        
        if (includeQueue) {
            exportData.eventQueue = this.eventQueue;
        }
        
        return exportData;
    }
    
    /**
     * Import event data
     * @param {Object} importData - Event data to import
     */
    importEventData(importData) {
        if (importData.maxHistorySize) {
            this.setMaxHistorySize(importData.maxHistorySize);
        }
        
        if (importData.eventHistory) {
            this.eventHistory = importData.eventHistory;
        }
        
        // Note: Handlers cannot be easily imported as they contain functions
        // This would require a more sophisticated serialization system
        
        this.emit('eventDataImported', { importData });
    }
    
    /**
     * Generate unique event ID
     * @returns {string} - Event ID
     */
    generateEventId() {
        return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Generate unique handler ID
     * @returns {string} - Handler ID
     */
    generateHandlerId() {
        return `handler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Utility function to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = EventManager;