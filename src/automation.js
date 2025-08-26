const EventEmitter = require('events');

class AutomationManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.activeLoops = new Map();
        this.scheduledTasks = new Map();
        this.messageQueue = [];
        this.isProcessing = false;
        
        // Bind methods
        this.processQueue = this.processQueue.bind(this);
    }
    
    /**
     * Send message loop with configurable delay
     * @param {string} jid - Recipient ID
     * @param {Array} messages - Array of messages to send
     * @param {Object} options - Loop options
     * @returns {string} - Loop ID
     */
    async startMessageLoop(jid, messages, options = {}) {
        const {
            delay = 1000,
            maxRetries = 3,
            retryDelay = 5000,
            callback = null,
            loopId = null
        } = options;
        
        const loopIdFinal = loopId || this.generateLoopId();
        
        if (this.activeLoops.has(loopIdFinal)) {
            throw new Error(`Loop with ID ${loopIdFinal} is already running`);
        }
        
        const loop = {
            id: loopIdFinal,
            jid,
            messages: [...messages],
            delay,
            maxRetries,
            retryDelay,
            callback,
            isRunning: true,
            currentIndex: 0,
            retryCount: 0,
            startTime: Date.now()
        };
        
        this.activeLoops.set(loopIdFinal, loop);
        this.emit('loopStarted', { loopId: loopIdFinal, totalMessages: messages.length });
        
        // Start the loop
        this.runMessageLoop(loop);
        
        return loopIdFinal;
    }
    
    /**
     * Run the actual message loop
     */
    async runMessageLoop(loop) {
        while (loop.isRunning && loop.currentIndex < loop.messages.length) {
            try {
                const message = loop.messages[loop.currentIndex];
                const result = await this.client.sendMessage(loop.jid, message);
                
                // Update loop state
                loop.currentIndex++;
                
                // Emit progress event
                this.emit('loopProgress', {
                    loopId: loop.id,
                    currentIndex: loop.currentIndex,
                    totalMessages: loop.messages.length,
                    message: result
                });
                
                // Call callback if provided
                if (loop.callback) {
                    try {
                        await loop.callback(result, loop.currentIndex - 1, loop.messages.length);
                    } catch (error) {
                        console.error('Loop callback error:', error.message);
                    }
                }
                
                // Wait before next message (except for the last one)
                if (loop.currentIndex < loop.messages.length) {
                    await this.sleep(loop.delay);
                }
                
            } catch (error) {
                console.error(`Loop error at message ${loop.currentIndex + 1}:`, error.message);
                
                // Handle retries
                if (loop.retryCount < loop.maxRetries) {
                    loop.retryCount++;
                    this.emit('loopRetry', {
                        loopId: loop.id,
                        messageIndex: loop.currentIndex,
                        retryCount: loop.retryCount,
                        error: error.message
                    });
                    
                    await this.sleep(loop.retryDelay);
                    continue;
                } else {
                    // Max retries reached, stop the loop
                    this.emit('loopError', {
                        loopId: loop.id,
                        messageIndex: loop.currentIndex,
                        error: error.message
                    });
                    break;
                }
            }
        }
        
        // Loop finished
        loop.isRunning = false;
        this.activeLoops.delete(loop.id);
        
        this.emit('loopFinished', {
            loopId: loop.id,
            totalMessages: loop.messages.length,
            successCount: loop.currentIndex,
            duration: Date.now() - loop.startTime
        });
    }
    
    /**
     * Stop a running message loop
     * @param {string} loopId - Loop ID to stop
     */
    stopMessageLoop(loopId) {
        const loop = this.activeLoops.get(loopId);
        if (loop) {
            loop.isRunning = false;
            this.activeLoops.delete(loopId);
            this.emit('loopStopped', { loopId, reason: 'manual' });
            return true;
        }
        return false;
    }
    
    /**
     * Stop all running loops
     */
    stopAllLoops() {
        const stoppedLoops = [];
        for (const [loopId, loop] of this.activeLoops) {
            loop.isRunning = false;
            stoppedLoops.push(loopId);
        }
        this.activeLoops.clear();
        
        stoppedLoops.forEach(loopId => {
            this.emit('loopStopped', { loopId, reason: 'stopAll' });
        });
        
        return stoppedLoops;
    }
    
    /**
     * Get active loops status
     */
    getActiveLoops() {
        const loops = [];
        for (const [loopId, loop] of this.activeLoops) {
            loops.push({
                id: loopId,
                jid: loop.jid,
                currentIndex: loop.currentIndex,
                totalMessages: loop.messages.length,
                isRunning: loop.isRunning,
                startTime: loop.startTime,
                duration: Date.now() - loop.startTime
            });
        }
        return loops;
    }
    
    /**
     * Schedule a message to be sent at a specific time
     * @param {string} jid - Recipient ID
     * @param {string} message - Message content
     * @param {Date|string} scheduleTime - When to send the message
     * @param {Object} options - Additional options
     * @returns {string} - Task ID
     */
    scheduleMessage(jid, message, scheduleTime, options = {}) {
        const taskId = this.generateTaskId();
        const scheduleDate = new Date(scheduleTime);
        
        if (isNaN(scheduleDate.getTime())) {
            throw new Error('Invalid schedule time');
        }
        
        const delay = scheduleDate.getTime() - Date.now();
        
        if (delay <= 0) {
            throw new Error('Schedule time must be in the future');
        }
        
        const task = {
            id: taskId,
            jid,
            message,
            scheduleTime: scheduleDate,
            options,
            timer: setTimeout(async () => {
                try {
                    await this.client.sendMessage(jid, message);
                    this.emit('scheduledMessageSent', { taskId, jid, message });
                } catch (error) {
                    this.emit('scheduledMessageError', { taskId, jid, message, error });
                } finally {
                    this.scheduledTasks.delete(taskId);
                }
            }, delay)
        };
        
        this.scheduledTasks.set(taskId, task);
        this.emit('messageScheduled', { taskId, jid, message, scheduleTime: scheduleDate });
        
        return taskId;
    }
    
    /**
     * Cancel a scheduled message
     * @param {string} taskId - Task ID to cancel
     */
    cancelScheduledMessage(taskId) {
        const task = this.scheduledTasks.get(taskId);
        if (task) {
            clearTimeout(task.timer);
            this.scheduledTasks.delete(taskId);
            this.emit('scheduledMessageCancelled', { taskId, jid: task.jid, message: task.message });
            return true;
        }
        return false;
    }
    
    /**
     * Get scheduled messages
     */
    getScheduledMessages() {
        const tasks = [];
        for (const [taskId, task] of this.scheduledTasks) {
            tasks.push({
                id: taskId,
                jid: task.jid,
                message: task.message,
                scheduleTime: task.scheduleTime,
                remainingTime: task.scheduleTime.getTime() - Date.now()
            });
        }
        return tasks;
    }
    
    /**
     * Add message to queue for processing
     * @param {Object} messageData - Message data
     * @param {number} priority - Priority (lower = higher priority)
     */
    addToQueue(messageData, priority = 5) {
        const queueItem = {
            id: this.generateQueueId(),
            ...messageData,
            priority,
            timestamp: Date.now()
        };
        
        // Insert based on priority
        const insertIndex = this.messageQueue.findIndex(item => item.priority > priority);
        if (insertIndex === -1) {
            this.messageQueue.push(queueItem);
        } else {
            this.messageQueue.splice(insertIndex, 0, queueItem);
        }
        
        this.emit('messageQueued', queueItem);
        
        // Start processing if not already running
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    
    /**
     * Process the message queue
     */
    async processQueue() {
        if (this.isProcessing || this.messageQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        while (this.messageQueue.length > 0) {
            const item = this.messageQueue.shift();
            
            try {
                this.emit('processingMessage', item);
                
                if (item.type === 'media') {
                    await this.client.sendMedia(item.jid, item.mediaPath, item.mediaType, item.options);
                } else {
                    await this.client.sendMessage(item.jid, item.content, item.options);
                }
                
                this.emit('messageProcessed', item);
                
            } catch (error) {
                console.error('Failed to process queued message:', error.message);
                this.emit('messageProcessingError', { item, error });
                
                // Re-queue with lower priority if retries allowed
                if (item.retryCount < (item.maxRetries || 3)) {
                    item.retryCount = (item.retryCount || 0) + 1;
                    item.priority = Math.min(item.priority + 1, 10); // Lower priority
                    this.messageQueue.push(item);
                }
            }
            
            // Small delay between messages to avoid rate limiting
            await this.sleep(100);
        }
        
        this.isProcessing = false;
        this.emit('queueEmpty');
    }
    
    /**
     * Get queue status
     */
    getQueueStatus() {
        return {
            length: this.messageQueue.length,
            isProcessing: this.isProcessing,
            items: this.messageQueue.map(item => ({
                id: item.id,
                jid: item.jid,
                priority: item.priority,
                timestamp: item.timestamp,
                retryCount: item.retryCount || 0
            }))
        };
    }
    
    /**
     * Clear the message queue
     */
    clearQueue() {
        const clearedCount = this.messageQueue.length;
        this.messageQueue = [];
        this.emit('queueCleared', { clearedCount });
        return clearedCount;
    }
    
    /**
     * Send message with typing indicator
     * @param {string} jid - Recipient ID
     * @param {string} message - Message content
     * @param {Object} options - Options
     */
    async sendWithTyping(jid, message, options = {}) {
        const { typingDuration = 2000, ...messageOptions } = options;
        
        try {
            // Show typing indicator
            await this.client.sendTypingIndicator(jid, true);
            
            // Wait for typing duration
            await this.sleep(typingDuration);
            
            // Send message
            const result = await this.client.sendMessage(jid, message, messageOptions);
            
            // Hide typing indicator
            await this.client.sendTypingIndicator(jid, false);
            
            return result;
        } catch (error) {
            // Hide typing indicator on error
            await this.client.sendTypingIndicator(jid, false);
            throw error;
        }
    }
    
    /**
     * Send message with reaction
     * @param {string} jid - Recipient ID
     * @param {string} message - Message content
     * @param {string} reaction - Reaction emoji
     * @param {Object} options - Options
     */
    async sendWithReaction(jid, message, reaction, options = {}) {
        const result = await this.client.sendMessage(jid, message, options);
        
        // Add reaction (this would need to be implemented in the client)
        // await this.client.addReaction(result.id, reaction);
        
        return result;
    }
    
    /**
     * Generate unique loop ID
     */
    generateLoopId() {
        return `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Generate unique task ID
     */
    generateTaskId() {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Generate unique queue ID
     */
    generateQueueId() {
        return `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Utility function to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get automation statistics
     */
    getStats() {
        return {
            activeLoops: this.activeLoops.size,
            scheduledTasks: this.scheduledTasks.size,
            queueLength: this.messageQueue.length,
            isProcessing: this.isProcessing
        };
    }
}

module.exports = AutomationManager;