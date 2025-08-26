const axios = require('axios');
const WebSocket = require('ws');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Endpoints, UserAgents, MessageTypes } = require('./constants');
const AuthManager = require('./AuthManager');
const MessageManager = require('./MessageManager');
const MediaManager = require('./MediaManager');
const WebSocketManager = require('./WebSocketManager');

class MessengerClient {
    constructor(options = {}) {
        this.options = {
            userAgent: UserAgents.MOBILE,
            timeout: 30000,
            retryAttempts: 3,
            autoReconnect: true,
            ...options
        };

        this.isAuthenticated = false;
        this.userId = null;
        this.accessToken = null;
        this.cookies = {};
        this.eventListeners = {};

        // Initialize managers
        this.authManager = new AuthManager(this);
        this.messageManager = new MessageManager(this);
        this.mediaManager = new MediaManager(this);
        this.wsManager = new WebSocketManager(this);

        // Setup axios instance
        this.http = axios.create({
            timeout: this.options.timeout,
            headers: {
                'User-Agent': this.options.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        // Setup interceptors
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Request interceptor
        this.http.interceptors.request.use((config) => {
            if (this.cookies && Object.keys(this.cookies).length > 0) {
                config.headers.Cookie = Object.entries(this.cookies)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('; ');
            }
            return config;
        });

        // Response interceptor
        this.http.interceptors.response.use(
            (response) => {
                // Extract cookies from response
                if (response.headers['set-cookie']) {
                    response.headers['set-cookie'].forEach(cookie => {
                        const [cookiePart] = cookie.split(';');
                        const [name, value] = cookiePart.split('=');
                        this.cookies[name] = value;
                    });
                }
                return response;
            },
            (error) => {
                console.error('HTTP Error:', error.message);
                return Promise.reject(error);
            }
        );
    }

    async login(credentials) {
        try {
            console.log('Attempting to login...');
            const result = await this.authManager.login(credentials);
            
            if (result.success) {
                this.isAuthenticated = true;
                this.userId = result.userId;
                this.accessToken = result.accessToken;
                
                // Start WebSocket connection
                await this.wsManager.connect();
                
                console.log('Login successful!');
                this.emit('login', { userId: this.userId });
                return result;
            } else {
                throw new Error(result.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error.message);
            throw error;
        }
    }

    async logout() {
        try {
            await this.wsManager.disconnect();
            await this.authManager.logout();
            
            this.isAuthenticated = false;
            this.userId = null;
            this.accessToken = null;
            this.cookies = {};
            
            console.log('Logout successful!');
            this.emit('logout');
        } catch (error) {
            console.error('Logout error:', error.message);
            throw error;
        }
    }

    async sendMessage(recipientId, content, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.sendMessage(recipientId, content, options);
        } catch (error) {
            console.error('Send message error:', error.message);
            throw error;
        }
    }

    async sendMedia(recipientId, mediaPath, type, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.mediaManager.sendMedia(recipientId, mediaPath, type, options);
        } catch (error) {
            console.error('Send media error:', error.message);
            throw error;
        }
    }

    async sendSticker(recipientId, stickerId, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.sendSticker(recipientId, stickerId, options);
        } catch (error) {
            console.error('Send sticker error:', error.message);
            throw error;
        }
    }

    async sendReaction(recipientId, messageId, reaction, options = {}) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.sendReaction(recipientId, messageId, reaction, options);
        } catch (error) {
            console.error('Send reaction error:', error.message);
            throw error;
        }
    }

    async markAsRead(recipientId, messageId) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.markAsRead(recipientId, messageId);
        } catch (error) {
            console.error('Mark as read error:', error.message);
            throw error;
        }
    }

    async sendTyping(recipientId, isTyping = true) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.sendTyping(recipientId, isTyping);
        } catch (error) {
            console.error('Send typing error:', error.message);
            throw error;
        }
    }

    async getThreads(limit = 20) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.getThreads(limit);
        } catch (error) {
            console.error('Get threads error:', error.message);
            throw error;
        }
    }

    async getMessages(threadId, limit = 50) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        try {
            return await this.messageManager.getMessages(threadId, limit);
        } catch (error) {
            console.error('Get messages error:', error.message);
            throw error;
        }
    }

    // Event handling
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    off(event, callback) {
        if (this.eventListeners[event]) {
            this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
        }
    }

    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }

    // Automation methods
    async sendMessageLoop(recipientId, messages, delay = 1000) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        const results = [];
        for (let i = 0; i < messages.length; i++) {
            try {
                const result = await this.sendMessage(recipientId, messages[i]);
                results.push(result);
                
                if (i < messages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`Error sending message ${i + 1}:`, error.message);
                results.push({ error: error.message });
            }
        }
        return results;
    }

    async sendMediaLoop(recipientId, mediaFiles, delay = 2000) {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }

        const results = [];
        for (let i = 0; i < mediaFiles.length; i++) {
            try {
                const { path: mediaPath, type } = mediaFiles[i];
                const result = await this.sendMedia(recipientId, mediaPath, type);
                results.push(result);
                
                if (i < mediaFiles.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`Error sending media ${i + 1}:`, error.message);
                results.push({ error: error.message });
            }
        }
        return results;
    }

    // Utility methods
    isConnected() {
        return this.isAuthenticated && this.wsManager.isConnected();
    }

    getUserId() {
        return this.userId;
    }

    getCookies() {
        return { ...this.cookies };
    }

    setCookies(cookies) {
        this.cookies = { ...this.cookies, ...cookies };
    }
}

module.exports = MessengerClient;