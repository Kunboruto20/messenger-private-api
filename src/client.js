const axios = require('axios');
const FormData = require('form-data');
const { EventEmitter } = require('events');
const { Endpoints, Headers, MessageTypes } = require('./constants');

class MessengerClient extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            autoReconnect: true,
            reconnectDelay: 5000,
            maxReconnectAttempts: 10,
            ...options
        };
        
        this.isAuthenticated = false;
        this.session = null;
        this.cookies = {};
        this.userId = null;
        this.threads = new Map();
        this.reconnectAttempts = 0;
        this.isConnected = false;
        
        // Setup axios instance
        this.http = axios.create({
            timeout: 30000,
            headers: Headers,
            withCredentials: true
        });
        
        // Setup interceptors
        this.setupInterceptors();
    }
    
    setupInterceptors() {
        // Request interceptor to add cookies
        this.http.interceptors.request.use((config) => {
            if (Object.keys(this.cookies).length > 0) {
                config.headers.Cookie = Object.entries(this.cookies)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('; ');
            }
            return config;
        });
        
        // Response interceptor to handle cookies
        this.http.interceptors.response.use((response) => {
            const setCookieHeaders = response.headers['set-cookie'];
            if (setCookieHeaders) {
                setCookieHeaders.forEach(cookie => {
                    const [cookiePart] = cookie.split(';');
                    const [key, value] = cookiePart.split('=');
                    this.cookies[key] = value;
                });
            }
            return response;
        });
    }
    
    /**
     * Authenticate with Facebook Messenger
     * @param {Object} credentials - Login credentials
     * @param {string} credentials.email - Email or username
     * @param {string} credentials.password - Password
     * @returns {Promise<boolean>} - Authentication success
     */
    async login(credentials) {
        try {
            console.log('🔐 Attempting to login...');
            
            // First, get the login page to extract form data
            const loginPage = await this.http.get(Endpoints.LOGIN);
            
            // Extract form data and hidden fields
            const formData = this.extractFormData(loginPage.data);
            
            // Add credentials
            formData.email = credentials.email;
            formData.pass = credentials.password;
            
            // Submit login form
            const loginResponse = await this.http.post(Endpoints.LOGIN, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': Endpoints.LOGIN
                },
                maxRedirects: 5
            });
            
            // Check if login was successful
            if (this.checkLoginSuccess(loginResponse)) {
                this.isAuthenticated = true;
                this.userId = this.extractUserId(loginResponse.data);
                console.log('✅ Login successful!');
                this.emit('login', { userId: this.userId });
                return true;
            } else {
                throw new Error('Login failed - invalid credentials or 2FA required');
            }
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            this.emit('loginError', error);
            throw error;
        }
    }
    
    /**
     * Extract form data from login page
     */
    extractFormData(html) {
        const formData = {};
        
        // Extract lsd (form security token)
        const lsdMatch = html.match(/name="lsd" value="([^"]+)"/);
        if (lsdMatch) formData.lsd = lsdMatch[1];
        
        // Extract jazoest (JavaScript security token)
        const jazoestMatch = html.match(/name="jazoest" value="([^"]+)"/);
        if (jazoestMatch) formData.jazoest = jazoestMatch[1];
        
        // Extract m_ts (timestamp)
        const mtsMatch = html.match(/name="m_ts" value="([^"]+)"/);
        if (mtsMatch) formData.m_ts = mtsMatch[1];
        
        // Extract li (login identifier)
        const liMatch = html.match(/name="li" value="([^"]+)"/);
        if (liMatch) formData.li = liMatch[1];
        
        // Extract try_number
        const tryNumberMatch = html.match(/name="try_number" value="([^"]+)"/);
        if (tryNumberMatch) formData.try_number = tryNumberMatch[1];
        
        // Extract unrecognized_tries
        const unrecognizedTriesMatch = html.match(/name="unrecognized_tries" value="([^"]+)"/);
        if (unrecognizedTriesMatch) formData.unrecognized_tries = unrecognizedTriesMatch[1];
        
        return formData;
    }
    
    /**
     * Check if login was successful
     */
    checkLoginSuccess(response) {
        // Check for redirect to home page or messenger
        const url = response.request?.res?.responseUrl || response.config?.url;
        return url && (
            url.includes('facebook.com/home') ||
            url.includes('messenger.com') ||
            url.includes('facebook.com/messages')
        );
    }
    
    /**
     * Extract user ID from response
     */
    extractUserId(html) {
        // Try to extract user ID from various sources
        const patterns = [
            /"userID":"(\d+)"/,
            /"actorID":"(\d+)"/,
            /"user_id":"(\d+)"/,
            /profile\.php\?id=(\d+)/
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
        }
        
        return null;
    }
    
    /**
     * Send text message
     * @param {string} jid - Recipient ID or thread ID
     * @param {string} content - Message content
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Message result
     */
    async sendMessage(jid, content, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const messageData = {
                thread_id: jid,
                message: content,
                timestamp: Date.now(),
                ...options
            };
            
            const response = await this.http.post(Endpoints.MESSAGES, messageData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `https://www.facebook.com/messages/t/${jid}`
                }
            });
            
            if (response.status === 200) {
                const result = {
                    id: this.generateMessageId(),
                    jid,
                    content,
                    timestamp: Date.now(),
                    status: 'sent'
                };
                
                this.emit('messageSent', result);
                return result;
            } else {
                throw new Error(`Failed to send message: ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to send message:', error.message);
            this.emit('messageError', { jid, content, error });
            throw error;
        }
    }
    
    /**
     * Send media message
     * @param {string} jid - Recipient ID or thread ID
     * @param {string} mediaPath - Path to media file
     * @param {string} type - Media type (image, video, audio, document)
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Media message result
     */
    async sendMedia(jid, mediaPath, type, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const form = new FormData();
            form.append('thread_id', jid);
            form.append('message', options.caption || '');
            form.append('attachment', mediaPath);
            form.append('type', type);
            
            const response = await this.http.post(Endpoints.MEDIA, form, {
                headers: {
                    ...form.getHeaders(),
                    'Referer': `https://www.facebook.com/messages/t/${jid}`
                }
            });
            
            if (response.status === 200) {
                const result = {
                    id: this.generateMessageId(),
                    jid,
                    mediaPath,
                    type,
                    caption: options.caption,
                    timestamp: Date.now(),
                    status: 'sent'
                };
                
                this.emit('mediaSent', result);
                return result;
            } else {
                throw new Error(`Failed to send media: ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to send media:', error.message);
            this.emit('mediaError', { jid, mediaPath, type, error });
            throw error;
        }
    }
    
    /**
     * Send message with mentions
     * @param {string} jid - Recipient ID or thread ID
     * @param {string} content - Message content with @mentions
     * @param {Array} mentions - Array of user IDs to mention
     * @returns {Promise<Object>} - Message result
     */
    async sendMessageWithMentions(jid, content, mentions = []) {
        let processedContent = content;
        
        mentions.forEach(userId => {
            const mentionTag = `@[${userId}]`;
            processedContent = processedContent.replace(`@${userId}`, mentionTag);
        });
        
        return this.sendMessage(jid, processedContent);
    }
    
    /**
     * Send typing indicator
     * @param {string} jid - Recipient ID or thread ID
     * @param {boolean} isTyping - Whether user is typing
     */
    async sendTypingIndicator(jid, isTyping = true) {
        try {
            const typingData = {
                thread_id: jid,
                typing: isTyping ? '1' : '0'
            };
            
            await this.http.post('https://www.facebook.com/ajax/messaging/typing.php', typingData);
            this.emit('typingIndicator', { jid, isTyping });
        } catch (error) {
            console.error('Failed to send typing indicator:', error.message);
        }
    }
    
    /**
     * Mark message as read
     * @param {string} jid - Thread ID
     * @param {string} messageId - Message ID to mark as read
     */
    async markAsRead(jid, messageId) {
        try {
            const readData = {
                thread_id: jid,
                message_id: messageId,
                action: 'mark_seen'
            };
            
            await this.http.post('https://www.facebook.com/ajax/messaging/mark_seen.php', readData);
            this.emit('messageRead', { jid, messageId });
        } catch (error) {
            console.error('Failed to mark message as read:', error.message);
        }
    }
    
    /**
     * Get conversation threads
     * @returns {Promise<Array>} - Array of conversation threads
     */
    async getThreads() {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const response = await this.http.get('https://www.facebook.com/messaging/thread_info/');
            const threads = this.parseThreads(response.data);
            
            threads.forEach(thread => {
                this.threads.set(thread.id, thread);
            });
            
            return threads;
        } catch (error) {
            console.error('Failed to get threads:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse threads from HTML response
     */
    parseThreads(html) {
        const threads = [];
        
        // This is a simplified parser - in a real implementation,
        // you'd need more sophisticated HTML parsing
        const threadMatches = html.match(/thread_id=(\d+)/g);
        
        if (threadMatches) {
            threadMatches.forEach(match => {
                const threadId = match.split('=')[1];
                threads.push({
                    id: threadId,
                    name: `Thread ${threadId}`,
                    type: 'individual'
                });
            });
        }
        
        return threads;
    }
    
    /**
     * Search for users
     * @param {string} query - Search query
     * @returns {Promise<Array>} - Array of user results
     */
    async searchUsers(query) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const response = await this.http.get(`${Endpoints.SEARCH}?q=${encodeURIComponent(query)}`);
            const users = this.parseUserSearch(response.data);
            return users;
        } catch (error) {
            console.error('Failed to search users:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse user search results
     */
    parseUserSearch(html) {
        const users = [];
        
        // Simplified parser - would need more sophisticated implementation
        const userMatches = html.match(/profile\.php\?id=(\d+)/g);
        
        if (userMatches) {
            userMatches.forEach(match => {
                const userId = match.split('=')[1];
                users.push({
                    id: userId,
                    name: `User ${userId}`,
                    profileUrl: `https://www.facebook.com/profile.php?id=${userId}`
                });
            });
        }
        
        return users;
    }
    
    /**
     * Send message loop with delay
     * @param {string} jid - Recipient ID
     * @param {Array} messages - Array of messages to send
     * @param {number} delay - Delay between messages in milliseconds
     * @param {Function} callback - Callback after each message
     */
    async sendMessageLoop(jid, messages, delay = 1000, callback = null) {
        for (let i = 0; i < messages.length; i++) {
            try {
                const message = messages[i];
                const result = await this.sendMessage(jid, message);
                
                if (callback) {
                    callback(result, i, messages.length);
                }
                
                // Wait before sending next message
                if (i < messages.length - 1) {
                    await this.sleep(delay);
                }
            } catch (error) {
                console.error(`Failed to send message ${i + 1}:`, error.message);
                this.emit('loopError', { jid, messageIndex: i, error });
            }
        }
    }
    
    /**
     * Utility function to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Generate unique message ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Logout and clear session
     */
    async logout() {
        try {
            await this.http.get('https://www.facebook.com/logout.php');
            
            this.isAuthenticated = false;
            this.session = null;
            this.cookies = {};
            this.userId = null;
            this.threads.clear();
            this.isConnected = false;
            
            console.log('👋 Logged out successfully');
            this.emit('logout');
        } catch (error) {
            console.error('Failed to logout:', error.message);
        }
    }
    
    /**
     * Get current session info
     */
    getSessionInfo() {
        return {
            isAuthenticated: this.isAuthenticated,
            userId: this.userId,
            isConnected: this.isConnected,
            threadCount: this.threads.size
        };
    }
    
    /**
     * Check if client is ready
     */
    isReady() {
        return this.isAuthenticated && this.isConnected;
    }
}

module.exports = MessengerClient;