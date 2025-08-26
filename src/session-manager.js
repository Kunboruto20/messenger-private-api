const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class SessionManager {
    constructor(client, options = {}) {
        this.client = client;
        this.options = {
            sessionFile: options.sessionFile || 'messenger-session.json',
            autoSave: options.autoSave !== false,
            autoLoad: options.autoLoad !== false,
            encryptionKey: options.encryptionKey || 'default-key-change-me',
            ...options
        };
        
        this.sessionData = null;
        this.isReconnecting = false;
        this.reconnectTimer = null;
        
        // Bind methods
        this.handleDisconnect = this.handleDisconnect.bind(this);
        this.handleReconnect = this.handleReconnect.bind(this);
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Auto-load session if enabled
        if (this.options.autoLoad) {
            this.loadSession().catch(console.error);
        }
    }
    
    setupEventListeners() {
        this.client.on('disconnect', this.handleDisconnect);
        this.client.on('login', () => {
            if (this.options.autoSave) {
                this.saveSession().catch(console.error);
            }
        });
    }
    
    /**
     * Save current session to file
     */
    async saveSession() {
        try {
            if (!this.client.isAuthenticated) {
                return;
            }
            
            const sessionData = {
                userId: this.client.userId,
                cookies: this.client.cookies,
                timestamp: Date.now(),
                userAgent: this.client.http.defaults.headers['User-Agent']
            };
            
            // Encrypt session data
            const encryptedData = this.encryptSessionData(sessionData);
            
            await fs.writeFile(this.options.sessionFile, JSON.stringify(encryptedData));
            console.log('💾 Session saved successfully');
        } catch (error) {
            console.error('Failed to save session:', error.message);
        }
    }
    
    /**
     * Load session from file
     */
    async loadSession() {
        try {
            const filePath = path.resolve(this.options.sessionFile);
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            
            if (!fileExists) {
                console.log('📁 No session file found');
                return false;
            }
            
            const fileContent = await fs.readFile(filePath, 'utf8');
            const encryptedData = JSON.parse(fileContent);
            
            // Decrypt session data
            const sessionData = this.decryptSessionData(encryptedData);
            
            // Check if session is still valid (not too old)
            const sessionAge = Date.now() - sessionData.timestamp;
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours
            
            if (sessionAge > maxAge) {
                console.log('⏰ Session expired, removing old session file');
                await this.clearSession();
                return false;
            }
            
            // Restore session
            this.client.cookies = sessionData.cookies;
            this.client.userId = sessionData.userId;
            
            // Test if session is still valid
            const isValid = await this.validateSession();
            if (isValid) {
                this.client.isAuthenticated = true;
                console.log('✅ Session restored successfully');
                this.client.emit('sessionRestored', sessionData);
                return true;
            } else {
                console.log('❌ Session validation failed, clearing session');
                await this.clearSession();
                return false;
            }
        } catch (error) {
            console.error('Failed to load session:', error.message);
            return false;
        }
    }
    
    /**
     * Validate current session by making a test request
     */
    async validateSession() {
        try {
            const response = await this.client.http.get('https://www.facebook.com/messages/');
            return response.status === 200 && !response.data.includes('login');
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Clear session data
     */
    async clearSession() {
        try {
            this.client.isAuthenticated = false;
            this.client.cookies = {};
            this.client.userId = null;
            
            const filePath = path.resolve(this.options.sessionFile);
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            
            if (fileExists) {
                await fs.unlink(filePath);
            }
            
            console.log('🗑️ Session cleared');
        } catch (error) {
            console.error('Failed to clear session:', error.message);
        }
    }
    
    /**
     * Handle disconnect event
     */
    handleDisconnect() {
        if (this.isReconnecting || !this.options.autoReconnect) {
            return;
        }
        
        console.log('🔌 Connection lost, attempting to reconnect...');
        this.scheduleReconnect();
    }
    
    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        const delay = this.options.reconnectDelay * Math.pow(2, this.client.reconnectAttempts);
        const maxDelay = 60000; // Max 1 minute delay
        
        this.reconnectTimer = setTimeout(() => {
            this.attemptReconnect();
        }, Math.min(delay, maxDelay));
    }
    
    /**
     * Attempt to reconnect
     */
    async attemptReconnect() {
        if (this.isReconnecting) {
            return;
        }
        
        this.isReconnecting = true;
        
        try {
            console.log(`🔄 Reconnection attempt ${this.client.reconnectAttempts + 1}/${this.options.maxReconnectAttempts}`);
            
            // Try to restore session
            const sessionRestored = await this.loadSession();
            
            if (sessionRestored) {
                console.log('✅ Reconnection successful');
                this.client.reconnectAttempts = 0;
                this.client.isConnected = true;
                this.client.emit('reconnected');
                return;
            }
            
            // If session restoration failed, try to re-authenticate
            if (this.client.credentials) {
                console.log('🔐 Attempting to re-authenticate...');
                await this.client.login(this.client.credentials);
                return;
            }
            
            throw new Error('No credentials available for reconnection');
            
        } catch (error) {
            console.error('❌ Reconnection failed:', error.message);
            this.client.reconnectAttempts++;
            
            if (this.client.reconnectAttempts >= this.options.maxReconnectAttempts) {
                console.error('🚫 Max reconnection attempts reached');
                this.client.emit('maxReconnectAttemptsReached');
                return;
            }
            
            // Schedule next reconnection attempt
            this.scheduleReconnect();
        } finally {
            this.isReconnecting = false;
        }
    }
    
    /**
     * Encrypt session data
     */
    encryptSessionData(data) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(this.options.encryptionKey, 'salt', 32);
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipher(algorithm, key);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return {
            iv: iv.toString('hex'),
            encrypted: encrypted
        };
    }
    
    /**
     * Decrypt session data
     */
    decryptSessionData(encryptedData) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(this.options.encryptionKey, 'salt', 32);
        const iv = Buffer.from(encryptedData.iv, 'hex');
        
        const decipher = crypto.createDecipher(algorithm, key);
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }
    
    /**
     * Get session statistics
     */
    getSessionStats() {
        return {
            isAuthenticated: this.client.isAuthenticated,
            isConnected: this.client.isConnected,
            isReconnecting: this.isReconnecting,
            reconnectAttempts: this.client.reconnectAttempts,
            maxReconnectAttempts: this.options.maxReconnectAttempts,
            sessionAge: this.sessionData ? Date.now() - this.sessionData.timestamp : null
        };
    }
    
    /**
     * Export session data (for backup)
     */
    async exportSession() {
        if (!this.client.isAuthenticated) {
            throw new Error('No active session to export');
        }
        
        const sessionData = {
            userId: this.client.userId,
            cookies: this.client.cookies,
            timestamp: Date.now(),
            userAgent: this.client.http.defaults.headers['User-Agent']
        };
        
        return sessionData;
    }
    
    /**
     * Import session data (from backup)
     */
    async importSession(sessionData) {
        try {
            // Validate session data
            if (!sessionData.userId || !sessionData.cookies) {
                throw new Error('Invalid session data format');
            }
            
            // Clear existing session
            await this.clearSession();
            
            // Import new session
            this.client.userId = sessionData.userId;
            this.client.cookies = sessionData.cookies;
            
            if (sessionData.userAgent) {
                this.client.http.defaults.headers['User-Agent'] = sessionData.userAgent;
            }
            
            // Validate imported session
            const isValid = await this.validateSession();
            if (isValid) {
                this.client.isAuthenticated = true;
                console.log('✅ Session imported successfully');
                
                if (this.options.autoSave) {
                    await this.saveSession();
                }
                
                return true;
            } else {
                throw new Error('Imported session validation failed');
            }
        } catch (error) {
            console.error('Failed to import session:', error.message);
            throw error;
        }
    }
}

module.exports = SessionManager;