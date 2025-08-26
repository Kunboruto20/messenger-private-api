const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MediaManager {
    constructor(client) {
        this.client = client;
        this.supportedTypes = {
            image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
            audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac'],
            document: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt']
        };
        
        this.maxFileSize = {
            image: 10 * 1024 * 1024,    // 10MB
            video: 100 * 1024 * 1024,   // 100MB
            audio: 25 * 1024 * 1024,    // 25MB
            document: 50 * 1024 * 1024  // 50MB
        };
        
        this.mediaCache = new Map();
        this.maxCacheSize = 100;
    }
    
    /**
     * Validate media file
     * @param {string} filePath - Path to media file
     * @param {string} expectedType - Expected media type
     * @returns {Object} - Validation result
     */
    async validateMediaFile(filePath, expectedType) {
        try {
            // Check if file exists
            const stats = await fs.stat(filePath);
            
            // Check file size
            const maxSize = this.maxFileSize[expectedType];
            if (stats.size > maxSize) {
                return {
                    valid: false,
                    error: `File size ${(stats.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size ${(maxSize / 1024 / 1024).toFixed(2)}MB`
                };
            }
            
            // Check file extension
            const extension = path.extname(filePath).toLowerCase().substring(1);
            if (!this.supportedTypes[expectedType].includes(extension)) {
                return {
                    valid: false,
                    error: `File extension .${extension} is not supported for ${expectedType} type`
                };
            }
            
            // Check if file is readable
            await fs.access(filePath, fs.constants.R_OK);
            
            return {
                valid: true,
                size: stats.size,
                extension,
                mimeType: this.getMimeType(extension)
            };
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }
    
    /**
     * Get MIME type for file extension
     * @param {string} extension - File extension
     * @returns {string} - MIME type
     */
    getMimeType(extension) {
        const mimeTypes = {
            // Images
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            
            // Videos
            mp4: 'video/mp4',
            avi: 'video/x-msvideo',
            mov: 'video/quicktime',
            wmv: 'video/x-ms-wmv',
            flv: 'video/x-flv',
            webm: 'video/webm',
            
            // Audio
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            ogg: 'audio/ogg',
            m4a: 'audio/mp4',
            aac: 'audio/aac',
            
            // Documents
            pdf: 'application/pdf',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            txt: 'text/plain',
            rtf: 'application/rtf',
            odt: 'application/vnd.oasis.opendocument.text'
        };
        
        return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
    }
    
    /**
     * Process and optimize media file
     * @param {string} filePath - Path to media file
     * @param {string} type - Media type
     * @param {Object} options - Processing options
     * @returns {Object} - Processing result
     */
    async processMedia(filePath, type, options = {}) {
        try {
            // Validate file first
            const validation = await this.validateMediaFile(filePath, type);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            const {
                compress = false,
                resize = false,
                quality = 80,
                maxWidth = 1920,
                maxHeight = 1080
            } = options;
            
            let processedFilePath = filePath;
            
            // Process based on type
            switch (type) {
                case 'image':
                    if (compress || resize) {
                        processedFilePath = await this.processImage(filePath, { compress, resize, quality, maxWidth, maxHeight });
                    }
                    break;
                    
                case 'video':
                    if (compress) {
                        processedFilePath = await this.processVideo(filePath, { quality, maxWidth, maxHeight });
                    }
                    break;
                    
                case 'audio':
                    if (compress) {
                        processedFilePath = await this.processAudio(filePath, { quality });
                    }
                    break;
                    
                default:
                    // No processing needed for documents
                    break;
            }
            
            // Generate file hash for caching
            const fileHash = await this.generateFileHash(processedFilePath);
            
            // Cache the processed file info
            this.cacheMedia(fileHash, {
                originalPath: filePath,
                processedPath: processedFilePath,
                type,
                size: validation.size,
                mimeType: validation.mimeType,
                timestamp: Date.now()
            });
            
            return {
                success: true,
                originalPath: filePath,
                processedPath: processedFilePath,
                fileHash,
                type,
                size: validation.size,
                mimeType: validation.mimeType
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Process image file (placeholder implementation)
     * @param {string} filePath - Path to image file
     * @param {Object} options - Processing options
     * @returns {string} - Path to processed file
     */
    async processImage(filePath, options) {
        // This is a placeholder - in a real implementation,
        // you would use libraries like sharp, jimp, or imagemagick
        // to actually process the image
        
        console.log(`Processing image: ${filePath} with options:`, options);
        
        // For now, just return the original file path
        // In a real implementation, you would:
        // 1. Load the image
        // 2. Resize if needed
        // 3. Compress if needed
        // 4. Save to a temporary location
        // 5. Return the new file path
        
        return filePath;
    }
    
    /**
     * Process video file (placeholder implementation)
     * @param {string} filePath - Path to video file
     * @param {Object} options - Processing options
     * @returns {string} - Path to processed file
     */
    async processVideo(filePath, options) {
        // This is a placeholder - in a real implementation,
        // you would use libraries like ffmpeg to process videos
        
        console.log(`Processing video: ${filePath} with options:`, options);
        
        return filePath;
    }
    
    /**
     * Process audio file (placeholder implementation)
     * @param {string} filePath - Path to audio file
     * @param {Object} options - Processing options
     * @returns {string} - Path to processed file
     */
    async processAudio(filePath, options) {
        // This is a placeholder - in a real implementation,
        // you would use libraries like ffmpeg to process audio
        
        console.log(`Processing audio: ${filePath} with options:`, options);
        
        return filePath;
    }
    
    /**
     * Generate file hash for caching
     * @param {string} filePath - Path to file
     * @returns {string} - File hash
     */
    async generateFileHash(filePath) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            return crypto.createHash('md5').update(fileBuffer).digest('hex');
        } catch (error) {
            // Fallback to path-based hash if file reading fails
            return crypto.createHash('md5').update(filePath).digest('hex');
        }
    }
    
    /**
     * Cache media file information
     * @param {string} fileHash - File hash
     * @param {Object} fileInfo - File information
     */
    cacheMedia(fileHash, fileInfo) {
        // Remove oldest entries if cache is full
        if (this.mediaCache.size >= this.maxCacheSize) {
            const oldestKey = this.mediaCache.keys().next().value;
            this.mediaCache.delete(oldestKey);
        }
        
        this.mediaCache.set(fileHash, fileInfo);
    }
    
    /**
     * Get cached media information
     * @param {string} fileHash - File hash
     * @returns {Object|null} - Cached file information
     */
    getCachedMedia(fileHash) {
        return this.mediaCache.get(fileHash) || null;
    }
    
    /**
     * Clear media cache
     */
    clearCache() {
        this.mediaCache.clear();
    }
    
    /**
     * Get cache statistics
     * @returns {Object} - Cache statistics
     */
    getCacheStats() {
        return {
            size: this.mediaCache.size,
            maxSize: this.maxCacheSize,
            entries: Array.from(this.mediaCache.entries()).map(([hash, info]) => ({
                hash,
                type: info.type,
                size: info.size,
                timestamp: info.timestamp
            }))
        };
    }
    
    /**
     * Send media with automatic processing
     * @param {string} jid - Recipient ID
     * @param {string} mediaPath - Path to media file
     * @param {string} type - Media type
     * @param {Object} options - Options
     * @returns {Promise<Object>} - Send result
     */
    async sendMediaWithProcessing(jid, mediaPath, type, options = {}) {
        try {
            // Process media first
            const processingResult = await this.processMedia(mediaPath, type, options);
            
            if (!processingResult.success) {
                throw new Error(`Media processing failed: ${processingResult.error}`);
            }
            
            // Send the processed media
            const sendResult = await this.client.sendMedia(
                jid,
                processingResult.processedPath,
                type,
                {
                    ...options,
                    mimeType: processingResult.mimeType
                }
            );
            
            return {
                ...sendResult,
                processing: processingResult
            };
            
        } catch (error) {
            throw new Error(`Failed to send media: ${error.message}`);
        }
    }
    
    /**
     * Send multiple media files
     * @param {string} jid - Recipient ID
     * @param {Array} mediaFiles - Array of media file objects
     * @param {Object} options - Options
     * @returns {Promise<Array>} - Array of send results
     */
    async sendMultipleMedia(jid, mediaFiles, options = {}) {
        const results = [];
        
        for (const mediaFile of mediaFiles) {
            try {
                const result = await this.sendMediaWithProcessing(
                    jid,
                    mediaFile.path,
                    mediaFile.type,
                    { ...options, ...mediaFile.options }
                );
                
                results.push({
                    success: true,
                    file: mediaFile.path,
                    result
                });
                
            } catch (error) {
                results.push({
                    success: false,
                    file: mediaFile.path,
                    error: error.message
                });
            }
            
            // Add delay between sends to avoid rate limiting
            if (mediaFiles.indexOf(mediaFile) < mediaFiles.length - 1) {
                await this.sleep(options.delay || 1000);
            }
        }
        
        return results;
    }
    
    /**
     * Create media album (multiple images/videos)
     * @param {string} jid - Recipient ID
     * @param {Array} mediaPaths - Array of media file paths
     * @param {Object} options - Options
     * @returns {Promise<Object>} - Album send result
     */
    async sendMediaAlbum(jid, mediaPaths, options = {}) {
        try {
            // Validate all media files
            const mediaFiles = [];
            
            for (const mediaPath of mediaPaths) {
                const type = this.detectMediaType(mediaPath);
                const validation = await this.validateMediaFile(mediaPath, type);
                
                if (!validation.valid) {
                    throw new Error(`Invalid media file ${mediaPath}: ${validation.error}`);
                }
                
                mediaFiles.push({
                    path: mediaPath,
                    type,
                    mimeType: validation.mimeType
                });
            }
            
            // Send as multiple media
            const results = await this.sendMultipleMedia(jid, mediaFiles, options);
            
            return {
                success: true,
                totalFiles: mediaFiles.length,
                successfulSends: results.filter(r => r.success).length,
                failedSends: results.filter(r => !r.success).length,
                results
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Detect media type from file path
     * @param {string} filePath - Path to file
     * @returns {string} - Detected media type
     */
    detectMediaType(filePath) {
        const extension = path.extname(filePath).toLowerCase().substring(1);
        
        for (const [type, extensions] of Object.entries(this.supportedTypes)) {
            if (extensions.includes(extension)) {
                return type;
            }
        }
        
        return 'document'; // Default fallback
    }
    
    /**
     * Get supported media types
     * @returns {Object} - Supported types and extensions
     */
    getSupportedTypes() {
        return { ...this.supportedTypes };
    }
    
    /**
     * Get file size limits
     * @returns {Object} - File size limits
     */
    getFileSizeLimits() {
        return { ...this.maxFileSize };
    }
    
    /**
     * Utility function to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = MediaManager;