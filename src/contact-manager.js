const EventEmitter = require('events');

class ContactManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.contacts = new Map();
        this.friends = new Map();
        this.contactLists = new Map();
        this.blockedUsers = new Map();
        
        // Bind methods
        this.handleContactUpdate = this.handleContactUpdate.bind(this);
    }
    
    /**
     * Get all contacts for the authenticated user
     * @returns {Promise<Array>} - Array of contact objects
     */
    async getContacts() {
        if (!this.client.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const response = await this.client.http.get('https://www.facebook.com/friends/center/friends/');
            const contacts = this.parseContacts(response.data);
            
            // Update internal cache
            contacts.forEach(contact => {
                this.contacts.set(contact.id, contact);
            });
            
            return contacts;
        } catch (error) {
            console.error('Failed to get contacts:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse contacts from HTML response
     */
    parseContacts(html) {
        const contacts = [];
        
        // This is a simplified parser - in a real implementation,
        // you'd need more sophisticated HTML parsing
        const contactMatches = html.match(/profile\.php\?id=(\d+)/g);
        
        if (contactMatches) {
            contactMatches.forEach(match => {
                const userId = match.split('=')[1];
                contacts.push({
                    id: userId,
                    name: `User ${userId}`,
                    type: 'contact',
                    isFriend: true,
                    isOnline: false,
                    lastSeen: null
                });
            });
        }
        
        return contacts;
    }
    
    /**
     * Get contact information
     * @param {string} userId - User ID
     * @returns {Promise<Object>} - Contact information
     */
    async getContactInfo(userId) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/profile.php?id=${userId}`);
            const contactInfo = this.parseContactInfo(response.data, userId);
            
            // Cache contact info
            this.contacts.set(userId, contactInfo);
            
            return contactInfo;
        } catch (error) {
            console.error('Failed to get contact info:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse contact information from HTML
     */
    parseContactInfo(html, userId) {
        // Simplified parser - would need more sophisticated implementation
        return {
            id: userId,
            name: `User ${userId}`,
            type: 'contact',
            isFriend: true,
            isOnline: false,
            lastSeen: null,
            profileUrl: `https://www.facebook.com/profile.php?id=${userId}`,
            avatar: null,
            bio: '',
            location: '',
            joinedDate: null
        };
    }
    
    /**
     * Search for users
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Array of user results
     */
    async searchUsers(query, options = {}) {
        const {
            type = 'all', // all, friends, non-friends
            limit = 50
        } = options;
        
        try {
            const response = await this.client.http.get(`https://www.facebook.com/search/people/?q=${encodeURIComponent(query)}`);
            const users = this.parseUserSearch(response.data);
            
            // Filter based on type
            let filteredUsers = users;
            if (type === 'friends') {
                filteredUsers = users.filter(user => user.isFriend);
            } else if (type === 'non-friends') {
                filteredUsers = users.filter(user => !user.isFriend);
            }
            
            // Apply limit
            return filteredUsers.slice(0, limit);
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
        
        // Simplified parser
        const userMatches = html.match(/profile\.php\?id=(\d+)/g);
        
        if (userMatches) {
            userMatches.forEach(match => {
                const userId = match.split('=')[1];
                users.push({
                    id: userId,
                    name: `User ${userId}`,
                    type: 'user',
                    isFriend: false,
                    profileUrl: `https://www.facebook.com/profile.php?id=${userId}`
                });
            });
        }
        
        return users;
    }
    
    /**
     * Send friend request
     * @param {string} userId - User ID to send friend request to
     * @returns {Promise<boolean>} - Success status
     */
    async sendFriendRequest(userId) {
        try {
            const requestData = {
                user_id: userId,
                action: 'send_friend_request'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/friends/requests/send.php', requestData);
            
            if (response.status === 200) {
                this.emit('friendRequestSent', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to send friend request:', error.message);
            throw error;
        }
    }
    
    /**
     * Accept friend request
     * @param {string} userId - User ID to accept friend request from
     * @returns {Promise<boolean>} - Success status
     */
    async acceptFriendRequest(userId) {
        try {
            const acceptData = {
                user_id: userId,
                action: 'accept_friend_request'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/friends/requests/accept.php', acceptData);
            
            if (response.status === 200) {
                // Update contact status
                const contact = this.contacts.get(userId);
                if (contact) {
                    contact.isFriend = true;
                    this.contacts.set(userId, contact);
                }
                
                this.emit('friendRequestAccepted', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to accept friend request:', error.message);
            throw error;
        }
    }
    
    /**
     * Decline friend request
     * @param {string} userId - User ID to decline friend request from
     * @returns {Promise<boolean>} - Success status
     */
    async declineFriendRequest(userId) {
        try {
            const declineData = {
                user_id: userId,
                action: 'decline_friend_request'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/friends/requests/decline.php', declineData);
            
            if (response.status === 200) {
                this.emit('friendRequestDeclined', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to decline friend request:', error.message);
            throw error;
        }
    }
    
    /**
     * Remove friend
     * @param {string} userId - User ID to remove as friend
     * @returns {Promise<boolean>} - Success status
     */
    async removeFriend(userId) {
        try {
            const removeData = {
                user_id: userId,
                action: 'remove_friend'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/friends/remove.php', removeData);
            
            if (response.status === 200) {
                // Update contact status
                const contact = this.contacts.get(userId);
                if (contact) {
                    contact.isFriend = false;
                    this.contacts.set(userId, contact);
                }
                
                this.emit('friendRemoved', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to remove friend:', error.message);
            throw error;
        }
    }
    
    /**
     * Block user
     * @param {string} userId - User ID to block
     * @returns {Promise<boolean>} - Success status
     */
    async blockUser(userId) {
        try {
            const blockData = {
                user_id: userId,
                action: 'block_user'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/privacy/block_user.php', blockData);
            
            if (response.status === 200) {
                // Add to blocked users
                this.blockedUsers.set(userId, {
                    id: userId,
                    blockedAt: Date.now(),
                    reason: ''
                });
                
                this.emit('userBlocked', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to block user:', error.message);
            throw error;
        }
    }
    
    /**
     * Unblock user
     * @param {string} userId - User ID to unblock
     * @returns {Promise<boolean>} - Success status
     */
    async unblockUser(userId) {
        try {
            const unblockData = {
                user_id: userId,
                action: 'unblock_user'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/privacy/unblock_user.php', unblockData);
            
            if (response.status === 200) {
                // Remove from blocked users
                this.blockedUsers.delete(userId);
                
                this.emit('userUnblocked', { userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to unblock user:', error.message);
            throw error;
        }
    }
    
    /**
     * Get blocked users
     * @returns {Promise<Array>} - Array of blocked users
     */
    async getBlockedUsers() {
        try {
            const response = await this.client.http.get('https://www.facebook.com/settings?tab=blocking');
            const blockedUsers = this.parseBlockedUsers(response.data);
            
            // Update internal cache
            blockedUsers.forEach(user => {
                this.blockedUsers.set(user.id, user);
            });
            
            return blockedUsers;
        } catch (error) {
            console.error('Failed to get blocked users:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse blocked users from HTML
     */
    parseBlockedUsers(html) {
        const blockedUsers = [];
        
        // Simplified parser
        const blockedMatches = html.match(/profile\.php\?id=(\d+)/g);
        
        if (blockedMatches) {
            blockedMatches.forEach(match => {
                const userId = match.split('=')[1];
                blockedUsers.push({
                    id: userId,
                    blockedAt: Date.now(),
                    reason: ''
                });
            });
        }
        
        return blockedUsers;
    }
    
    /**
     * Create contact list
     * @param {string} name - List name
     * @param {Array} userIds - Array of user IDs to add to list
     * @returns {Promise<string>} - List ID
     */
    async createContactList(name, userIds = []) {
        try {
            const listData = {
                name: name,
                user_ids: userIds.join(','),
                action: 'create_list'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/friends/lists/create.php', listData);
            
            if (response.status === 200) {
                const listId = this.generateListId();
                const contactList = {
                    id: listId,
                    name: name,
                    userIds: userIds,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                
                this.contactLists.set(listId, contactList);
                
                this.emit('contactListCreated', { listId, name, userIds });
                return listId;
            }
            
            throw new Error('Failed to create contact list');
        } catch (error) {
            console.error('Failed to create contact list:', error.message);
            throw error;
        }
    }
    
    /**
     * Add user to contact list
     * @param {string} listId - List ID
     * @param {string} userId - User ID to add
     * @returns {Promise<boolean>} - Success status
     */
    async addUserToList(listId, userId) {
        try {
            const list = this.contactLists.get(listId);
            if (!list) {
                throw new Error('Contact list not found');
            }
            
            if (!list.userIds.includes(userId)) {
                list.userIds.push(userId);
                list.updatedAt = Date.now();
                this.contactLists.set(listId, list);
                
                this.emit('userAddedToList', { listId, userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to add user to list:', error.message);
            throw error;
        }
    }
    
    /**
     * Remove user from contact list
     * @param {string} listId - List ID
     * @param {string} userId - User ID to remove
     * @returns {Promise<boolean>} - Success status
     */
    async removeUserFromList(listId, userId) {
        try {
            const list = this.contactLists.get(listId);
            if (!list) {
                throw new Error('Contact list not found');
            }
            
            const index = list.userIds.indexOf(userId);
            if (index > -1) {
                list.userIds.splice(index, 1);
                list.updatedAt = Date.now();
                this.contactLists.set(listId, list);
                
                this.emit('userRemovedFromList', { listId, userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to remove user from list:', error.message);
            throw error;
        }
    }
    
    /**
     * Delete contact list
     * @param {string} listId - List ID to delete
     * @returns {Promise<boolean>} - Success status
     */
    async deleteContactList(listId) {
        try {
            const deleted = this.contactLists.delete(listId);
            if (deleted) {
                this.emit('contactListDeleted', { listId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to delete contact list:', error.message);
            throw error;
        }
    }
    
    /**
     * Get contact lists
     * @returns {Array} - Array of contact lists
     */
    getContactLists() {
        return Array.from(this.contactLists.values());
    }
    
    /**
     * Get contacts by list
     * @param {string} listId - List ID
     * @returns {Array} - Array of contacts in the list
     */
    getContactsByList(listId) {
        const list = this.contactLists.get(listId);
        if (!list) {
            return [];
        }
        
        return list.userIds
            .map(userId => this.contacts.get(userId))
            .filter(contact => contact !== undefined);
    }
    
    /**
     * Check if user is online
     * @param {string} userId - User ID
     * @returns {Promise<boolean>} - Online status
     */
    async checkUserOnline(userId) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/ajax/presence/status.php?user_id=${userId}`);
            const isOnline = this.parseOnlineStatus(response.data);
            
            // Update contact status
            const contact = this.contacts.get(userId);
            if (contact) {
                contact.isOnline = isOnline;
                contact.lastSeen = isOnline ? null : Date.now();
                this.contacts.set(userId, contact);
            }
            
            return isOnline;
        } catch (error) {
            console.error('Failed to check user online status:', error.message);
            return false;
        }
    }
    
    /**
     * Parse online status from response
     */
    parseOnlineStatus(data) {
        // Simplified parser - would need more sophisticated implementation
        return data.includes('online') || data.includes('active');
    }
    
    /**
     * Handle contact updates
     */
    handleContactUpdate(update) {
        this.emit('contactUpdated', update);
    }
    
    /**
     * Generate unique list ID
     */
    generateListId() {
        return `list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Get all cached contacts
     * @returns {Array} - Array of cached contacts
     */
    getCachedContacts() {
        return Array.from(this.contacts.values());
    }
    
    /**
     * Clear contact cache
     */
    clearCache() {
        this.contacts.clear();
        this.friends.clear();
        this.contactLists.clear();
        this.blockedUsers.clear();
    }
    
    /**
     * Get contact manager statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
        return {
            totalContacts: this.contacts.size,
            totalFriends: Array.from(this.contacts.values()).filter(c => c.isFriend).length,
            totalBlocked: this.blockedUsers.size,
            totalLists: this.contactLists.size,
            onlineContacts: Array.from(this.contacts.values()).filter(c => c.isOnline).length
        };
    }
}

module.exports = ContactManager;