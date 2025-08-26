const EventEmitter = require('events');

class GroupManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.groups = new Map();
        this.groupMembers = new Map();
        this.groupSettings = new Map();
        
        // Bind methods
        this.handleGroupUpdate = this.handleGroupUpdate.bind(this);
    }
    
    /**
     * Get all groups for the authenticated user
     * @returns {Promise<Array>} - Array of group objects
     */
    async getGroups() {
        if (!this.client.isAuthenticated) {
            throw new Error('Not authenticated. Please login first.');
        }
        
        try {
            const response = await this.client.http.get('https://www.facebook.com/messaging/thread_info/');
            const groups = this.parseGroups(response.data);
            
            // Update internal cache
            groups.forEach(group => {
                this.groups.set(group.id, group);
            });
            
            return groups;
        } catch (error) {
            console.error('Failed to get groups:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse groups from HTML response
     */
    parseGroups(html) {
        const groups = [];
        
        // This is a simplified parser - in a real implementation,
        // you'd need more sophisticated HTML parsing
        const groupMatches = html.match(/thread_id=(\d+)/g);
        
        if (groupMatches) {
            groupMatches.forEach(match => {
                const groupId = match.split('=')[1];
                groups.push({
                    id: groupId,
                    name: `Group ${groupId}`,
                    type: 'group',
                    memberCount: 0,
                    isAdmin: false
                });
            });
        }
        
        return groups;
    }
    
    /**
     * Get group information
     * @param {string} groupId - Group ID
     * @returns {Promise<Object>} - Group information
     */
    async getGroupInfo(groupId) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/messaging/thread_info/?thread_id=${groupId}`);
            const groupInfo = this.parseGroupInfo(response.data, groupId);
            
            // Cache group info
            this.groups.set(groupId, groupInfo);
            
            return groupInfo;
        } catch (error) {
            console.error('Failed to get group info:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse group information from HTML
     */
    parseGroupInfo(html, groupId) {
        // Simplified parser - would need more sophisticated implementation
        return {
            id: groupId,
            name: `Group ${groupId}`,
            type: 'group',
            memberCount: 0,
            isAdmin: false,
            description: '',
            createdAt: null,
            updatedAt: Date.now()
        };
    }
    
    /**
     * Get group members
     * @param {string} groupId - Group ID
     * @returns {Promise<Array>} - Array of member objects
     */
    async getGroupMembers(groupId) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/messaging/thread_info/?thread_id=${groupId}&members=1`);
            const members = this.parseGroupMembers(response.data);
            
            // Cache members
            this.groupMembers.set(groupId, members);
            
            return members;
        } catch (error) {
            console.error('Failed to get group members:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse group members from HTML
     */
    parseGroupMembers(html) {
        const members = [];
        
        // Simplified parser
        const memberMatches = html.match(/profile\.php\?id=(\d+)/g);
        
        if (memberMatches) {
            memberMatches.forEach(match => {
                const userId = match.split('=')[1];
                members.push({
                    id: userId,
                    name: `User ${userId}`,
                    role: 'member',
                    joinedAt: null
                });
            });
        }
        
        return members;
    }
    
    /**
     * Add member to group
     * @param {string} groupId - Group ID
     * @param {string} userId - User ID to add
     * @returns {Promise<boolean>} - Success status
     */
    async addMemberToGroup(groupId, userId) {
        try {
            const addData = {
                thread_id: groupId,
                user_id: userId,
                action: 'add_member'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/add_member.php', addData);
            
            if (response.status === 200) {
                // Update cached members
                const members = this.groupMembers.get(groupId) || [];
                members.push({
                    id: userId,
                    name: `User ${userId}`,
                    role: 'member',
                    joinedAt: Date.now()
                });
                this.groupMembers.set(groupId, members);
                
                this.emit('memberAdded', { groupId, userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to add member to group:', error.message);
            throw error;
        }
    }
    
    /**
     * Remove member from group
     * @param {string} groupId - Group ID
     * @param {string} userId - User ID to remove
     * @returns {Promise<boolean>} - Success status
     */
    async removeMemberFromGroup(groupId, userId) {
        try {
            const removeData = {
                thread_id: groupId,
                user_id: userId,
                action: 'remove_member'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/remove_member.php', removeData);
            
            if (response.status === 200) {
                // Update cached members
                const members = this.groupMembers.get(groupId) || [];
                const updatedMembers = members.filter(member => member.id !== userId);
                this.groupMembers.set(groupId, updatedMembers);
                
                this.emit('memberRemoved', { groupId, userId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to remove member from group:', error.message);
            throw error;
        }
    }
    
    /**
     * Change member role
     * @param {string} groupId - Group ID
     * @param {string} userId - User ID
     * @param {string} newRole - New role (admin, moderator, member)
     * @returns {Promise<boolean>} - Success status
     */
    async changeMemberRole(groupId, userId, newRole) {
        try {
            const roleData = {
                thread_id: groupId,
                user_id: userId,
                action: 'change_role',
                new_role: newRole
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/change_role.php', roleData);
            
            if (response.status === 200) {
                // Update cached member role
                const members = this.groupMembers.get(groupId) || [];
                const member = members.find(m => m.id === userId);
                if (member) {
                    member.role = newRole;
                    this.groupMembers.set(groupId, members);
                }
                
                this.emit('memberRoleChanged', { groupId, userId, newRole });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to change member role:', error.message);
            throw error;
        }
    }
    
    /**
     * Leave group
     * @param {string} groupId - Group ID
     * @returns {Promise<boolean>} - Success status
     */
    async leaveGroup(groupId) {
        try {
            const leaveData = {
                thread_id: groupId,
                action: 'leave_group'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/leave_group.php', leaveData);
            
            if (response.status === 200) {
                // Remove from cache
                this.groups.delete(groupId);
                this.groupMembers.delete(groupId);
                
                this.emit('groupLeft', { groupId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to leave group:', error.message);
            throw error;
        }
    }
    
    /**
     * Delete group (admin only)
     * @param {string} groupId - Group ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteGroup(groupId) {
        try {
            const deleteData = {
                thread_id: groupId,
                action: 'delete_group'
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/delete_group.php', deleteData);
            
            if (response.status === 200) {
                // Remove from cache
                this.groups.delete(groupId);
                this.groupMembers.delete(groupId);
                this.groupSettings.delete(groupId);
                
                this.emit('groupDeleted', { groupId });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to delete group:', error.message);
            throw error;
        }
    }
    
    /**
     * Update group settings
     * @param {string} groupId - Group ID
     * @param {Object} settings - Settings to update
     * @returns {Promise<boolean>} - Success status
     */
    async updateGroupSettings(groupId, settings) {
        try {
            const settingsData = {
                thread_id: groupId,
                action: 'update_settings',
                ...settings
            };
            
            const response = await this.client.http.post('https://www.facebook.com/ajax/messaging/update_group_settings.php', settingsData);
            
            if (response.status === 200) {
                // Update cached settings
                const currentSettings = this.groupSettings.get(groupId) || {};
                this.groupSettings.set(groupId, { ...currentSettings, ...settings });
                
                this.emit('groupSettingsUpdated', { groupId, settings });
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Failed to update group settings:', error.message);
            throw error;
        }
    }
    
    /**
     * Get group settings
     * @param {string} groupId - Group ID
     * @returns {Promise<Object>} - Group settings
     */
    async getGroupSettings(groupId) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/messaging/thread_info/?thread_id=${groupId}&settings=1`);
            const settings = this.parseGroupSettings(response.data);
            
            // Cache settings
            this.groupSettings.set(groupId, settings);
            
            return settings;
        } catch (error) {
            console.error('Failed to get group settings:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse group settings from HTML
     */
    parseGroupSettings(html) {
        // Simplified parser
        return {
            privacy: 'closed',
            approvalRequired: false,
            membersCanInvite: true,
            adminsCanEdit: true,
            notifications: 'all'
        };
    }
    
    /**
     * Send message to group
     * @param {string} groupId - Group ID
     * @param {string} content - Message content
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Message result
     */
    async sendGroupMessage(groupId, content, options = {}) {
        return this.client.sendMessage(groupId, content, options);
    }
    
    /**
     * Send media to group
     * @param {string} groupId - Group ID
     * @param {string} mediaPath - Path to media file
     * @param {string} type - Media type
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Media message result
     */
    async sendGroupMedia(groupId, mediaPath, type, options = {}) {
        return this.client.sendMedia(groupId, mediaPath, type, options);
    }
    
    /**
     * Get group statistics
     * @param {string} groupId - Group ID
     * @returns {Promise<Object>} - Group statistics
     */
    async getGroupStats(groupId) {
        try {
            const group = this.groups.get(groupId);
            const members = this.groupMembers.get(groupId) || [];
            const settings = this.groupSettings.get(groupId) || {};
            
            return {
                id: groupId,
                name: group?.name || 'Unknown Group',
                memberCount: members.length,
                adminCount: members.filter(m => m.role === 'admin').length,
                moderatorCount: members.filter(m => m.role === 'moderator').length,
                memberCount: members.filter(m => m.role === 'member').length,
                settings,
                lastUpdated: Date.now()
            };
        } catch (error) {
            console.error('Failed to get group stats:', error.message);
            throw error;
        }
    }
    
    /**
     * Search groups
     * @param {string} query - Search query
     * @returns {Promise<Array>} - Array of matching groups
     */
    async searchGroups(query) {
        try {
            const response = await this.client.http.get(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(query)}`);
            const groups = this.parseGroupSearch(response.data);
            return groups;
        } catch (error) {
            console.error('Failed to search groups:', error.message);
            throw error;
        }
    }
    
    /**
     * Parse group search results
     */
    parseGroupSearch(html) {
        const groups = [];
        
        // Simplified parser
        const groupMatches = html.match(/group\.php\?id=(\d+)/g);
        
        if (groupMatches) {
            groupMatches.forEach(match => {
                const groupId = match.split('=')[1];
                groups.push({
                    id: groupId,
                    name: `Group ${groupId}`,
                    type: 'group',
                    memberCount: 0
                });
            });
        }
        
        return groups;
    }
    
    /**
     * Handle group updates
     */
    handleGroupUpdate(update) {
        this.emit('groupUpdated', update);
    }
    
    /**
     * Get all cached groups
     * @returns {Array} - Array of cached groups
     */
    getCachedGroups() {
        return Array.from(this.groups.values());
    }
    
    /**
     * Clear group cache
     */
    clearCache() {
        this.groups.clear();
        this.groupMembers.clear();
        this.groupSettings.clear();
    }
    
    /**
     * Get group manager statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
        return {
            totalGroups: this.groups.size,
            totalMembers: Array.from(this.groupMembers.values())
                .reduce((sum, members) => sum + members.length, 0),
            cachedGroups: this.groups.size,
            cachedMembers: this.groupMembers.size,
            cachedSettings: this.groupSettings.size
        };
    }
}

module.exports = GroupManager;