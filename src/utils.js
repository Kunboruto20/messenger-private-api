const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

/**
 * Utility functions for the messenger-private-api library
 */

/**
 * Generate a unique ID
 * @param {string} prefix - Prefix for the ID
 * @returns {string} - Unique ID
 */
function generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a random string
 * @param {number} length - Length of the string
 * @returns {string} - Random string
 */
function randomString(length = 10) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle a function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} - Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Retry a function with exponential backoff
 * @param {Function} func - Function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Promise that resolves with the function result
 */
async function retry(func, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        retryCondition = null
    } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await func();
        } catch (error) {
            lastError = error;
            
            // Check if we should retry
            if (retryCondition && !retryCondition(error)) {
                throw error;
            }
            
            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Calculate delay with exponential backoff
            const delay = Math.min(
                baseDelay * Math.pow(backoffMultiplier, attempt),
                maxDelay
            );
            
            await sleep(delay);
        }
    }
    
    throw lastError;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - Whether email is valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - Whether phone number is valid
 */
function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether URL is valid
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Sanitize string for safe use
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(str) {
    if (typeof str !== 'string') {
        return '';
    }
    
    return str
        .replace(/[<>]/g, '') // Remove potential HTML tags
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

/**
 * Truncate string to specified length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add if truncated
 * @returns {string} - Truncated string
 */
function truncateString(str, maxLength, suffix = '...') {
    if (str.length <= maxLength) {
        return str;
    }
    
    return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Convert bytes to human readable format
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Human readable string
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Convert milliseconds to human readable format
 * @param {number} ms - Milliseconds
 * @returns {string} - Human readable string
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} - Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (obj instanceof Array) {
        return obj.map(item => deepClone(item));
    }
    
    if (typeof obj === 'object') {
        const cloned = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = deepClone(obj[key]);
            }
        }
        return cloned;
    }
    
    return obj;
}

/**
 * Merge objects deeply
 * @param {...Object} objects - Objects to merge
 * @returns {Object} - Merged object
 */
function deepMerge(...objects) {
    const result = {};
    
    for (const obj of objects) {
        if (obj && typeof obj === 'object') {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                        result[key] = deepMerge(result[key] || {}, obj[key]);
                    } else {
                        result[key] = obj[key];
                    }
                }
            }
        }
    }
    
    return result;
}

/**
 * Check if two objects are equal
 * @param {*} obj1 - First object
 * @param {*} obj2 - Second object
 * @returns {boolean} - Whether objects are equal
 */
function isEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    
    if (obj1 == null || obj2 == null) return false;
    if (obj1.constructor !== obj2.constructor) return false;
    
    if (obj1 instanceof Date && obj2 instanceof Date) {
        return obj1.getTime() === obj2.getTime();
    }
    
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) return false;
        for (let i = 0; i < obj1.length; i++) {
            if (!isEqual(obj1[i], obj2[i])) return false;
        }
        return true;
    }
    
    if (typeof obj1 === 'object' && typeof obj2 === 'object') {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        
        if (keys1.length !== keys2.length) return false;
        
        for (const key of keys1) {
            if (!keys2.includes(key) || !isEqual(obj1[key], obj2[key])) {
                return false;
            }
        }
        
        return true;
    }
    
    return false;
}

/**
 * Pick specific properties from an object
 * @param {Object} obj - Source object
 * @param {Array} keys - Keys to pick
 * @returns {Object} - Object with picked properties
 */
function pick(obj, keys) {
    const result = {};
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}

/**
 * Omit specific properties from an object
 * @param {Object} obj - Source object
 * @param {Array} keys - Keys to omit
 * @returns {Object} - Object without omitted properties
 */
function omit(obj, keys) {
    const result = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && !keys.includes(key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

/**
 * Flatten nested object
 * @param {Object} obj - Object to flatten
 * @param {string} separator - Separator for nested keys
 * @returns {Object} - Flattened object
 */
function flattenObject(obj, separator = '.') {
    const result = {};
    
    function flatten(current, prefix = '') {
        for (const key in current) {
            if (current.hasOwnProperty(key)) {
                const newKey = prefix ? `${prefix}${separator}${key}` : key;
                
                if (current[key] && typeof current[key] === 'object' && !Array.isArray(current[key])) {
                    flatten(current[key], newKey);
                } else {
                    result[newKey] = current[key];
                }
            }
        }
    }
    
    flatten(obj);
    return result;
}

/**
 * Unflatten object
 * @param {Object} obj - Flattened object
 * @param {string} separator - Separator used for flattening
 * @returns {Object} - Unflattened object
 */
function unflattenObject(obj, separator = '.') {
    const result = {};
    
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
        const keys = key.split(separator);
        let current = result;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in current)) {
                current[k] = {};
            }
            current = current[k];
        }
        
        current[keys[keys.length - 1]] = obj[key];
        }
    }
    
    return result;
}

/**
 * Check if file exists
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>} - Whether file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get file extension
 * @param {string} filePath - Path to file
 * @returns {string} - File extension
 */
function getFileExtension(filePath) {
    return path.extname(filePath).toLowerCase().substring(1);
}

/**
 * Get file size
 * @param {string} filePath - Path to file
 * @returns {Promise<number>} - File size in bytes
 */
async function getFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
async function ensureDirectory(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Generate hash from string
 * @param {string} str - String to hash
 * @param {string} algorithm - Hash algorithm
 * @returns {string} - Hash string
 */
function hashString(str, algorithm = 'md5') {
    return crypto.createHash(algorithm).update(str).digest('hex');
}

/**
 * Generate hash from file
 * @param {string} filePath - Path to file
 * @param {string} algorithm - Hash algorithm
 * @returns {Promise<string>} - Hash string
 */
async function hashFile(filePath, algorithm = 'md5') {
    try {
        const fileBuffer = await fs.readFile(filePath);
        return crypto.createHash(algorithm).update(fileBuffer).digest('hex');
    } catch {
        return '';
    }
}

/**
 * Parse query string
 * @param {string} queryString - Query string to parse
 * @returns {Object} - Parsed query parameters
 */
function parseQueryString(queryString) {
    const params = {};
    
    if (!queryString) return params;
    
    const pairs = queryString.split('&');
    for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) {
            params[decodeURIComponent(key)] = decodeURIComponent(value || '');
        }
    }
    
    return params;
}

/**
 * Build query string
 * @param {Object} params - Parameters to build query string from
 * @returns {string} - Query string
 */
function buildQueryString(params) {
    if (!params || typeof params !== 'object') {
        return '';
    }
    
    const pairs = [];
    for (const key in params) {
        if (params.hasOwnProperty(key) && params[key] != null) {
            pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
        }
    }
    
    return pairs.join('&');
}

/**
 * Escape HTML entities
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
    };
    
    return str.replace(/[&<>"'/]/g, match => htmlEscapes[match]);
}

/**
 * Unescape HTML entities
 * @param {string} str - String to unescape
 * @returns {string} - Unescaped string
 */
function unescapeHtml(str) {
    const htmlUnescapes = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#x27;': "'",
        '&#x2F;': '/'
    };
    
    return str.replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#x2F;/g, match => htmlUnescapes[match]);
}

/**
 * Format timestamp
 * @param {number|Date} timestamp - Timestamp to format
 * @param {string} format - Output format
 * @returns {string} - Formatted timestamp
 */
function formatTimestamp(timestamp, format = 'ISO') {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    
    switch (format) {
        case 'ISO':
            return date.toISOString();
        case 'UTC':
            return date.toUTCString();
        case 'local':
            return date.toString();
        case 'date':
            return date.toDateString();
        case 'time':
            return date.toTimeString();
        default:
            return date.toISOString();
    }
}

/**
 * Get relative time string
 * @param {number|Date} timestamp - Timestamp to get relative time for
 * @returns {string} - Relative time string
 */
function getRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - (timestamp instanceof Date ? timestamp.getTime() : timestamp);
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (seconds > 0) return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
    
    return 'just now';
}

module.exports = {
    generateId,
    randomString,
    sleep,
    debounce,
    throttle,
    retry,
    isValidEmail,
    isValidPhone,
    isValidUrl,
    sanitizeString,
    truncateString,
    formatBytes,
    formatDuration,
    deepClone,
    deepMerge,
    isEqual,
    pick,
    omit,
    flattenObject,
    unflattenObject,
    fileExists,
    getFileExtension,
    getFileSize,
    ensureDirectory,
    hashString,
    hashFile,
    parseQueryString,
    buildQueryString,
    escapeHtml,
    unescapeHtml,
    formatTimestamp,
    getRelativeTime
};