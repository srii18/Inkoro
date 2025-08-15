const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('../../config');
class DocumentManager {
    constructor() {
        const baseStorage = path.isAbsolute(config.storagePath) ? config.storagePath : path.join(process.cwd(), config.storagePath);
        this.storageDir = path.join(baseStorage, 'documents');
        this.ensureStorageDir();
    }

    async ensureStorageDir() {
        try {
            await fs.mkdir(this.storageDir, { recursive: true });
        } catch (error) {
            console.error('Error creating storage directory:', error.message);
        }
    }

    async saveDocument(buffer, originalName) {
        try {
            const fileId = randomUUID();
            const extension = path.extname(originalName);
            const fileName = `${fileId}${extension}`;
            const filePath = path.join(this.storageDir, fileName);

            await fs.writeFile(filePath, buffer);

            // Save metadata with originalName
            const metaPath = path.join(this.storageDir, `${fileId}.json`);
            await fs.writeFile(metaPath, JSON.stringify({ originalName }, null, 2));

            return {
                fileId,
                fileName,
                originalName,
                filePath,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error saving document:', error.message);
            throw error;
        }
    }

    async getDocument(fileId) {
        try {
            const files = await fs.readdir(this.storageDir);
            const file = files.find(f => f.startsWith(fileId));
            
            if (!file) {
                throw new Error('Document not found');
            }

            const filePath = path.join(this.storageDir, file);
            return {
                path: filePath,
                buffer: await fs.readFile(filePath)
            };
        } catch (error) {
            console.error('Error retrieving document:', error.message);
            throw error;
        }
    }

    async deleteDocument(fileId) {
        try {
            const files = await fs.readdir(this.storageDir);
            const file = files.find(f => f.startsWith(fileId));
            
            if (file) {
                const filePath = path.join(this.storageDir, file);
                await fs.unlink(filePath);
            }
        } catch (error) {
            console.error('Error deleting document:', error.message);
            throw error;
        }
    }

    async getRecentDocuments(limit = 10) {
        try {
            const files = await fs.readdir(this.storageDir);
            const documents = await Promise.all(
                files.filter(f => !f.endsWith('.json')).map(async (fileName) => {
                    const filePath = path.join(this.storageDir, fileName);
                    const stats = await fs.stat(filePath);
                    const fileId = fileName.split('.')[0];
                    // Try to read metadata for originalName
                    let originalName = fileName;
                    try {
                        const metaPath = path.join(this.storageDir, `${fileId}.json`);
                        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                        if (meta.originalName) originalName = meta.originalName;
                    } catch {}
                    return {
                        fileId,
                        fileName,
                        originalName,
                        filePath,
                        timestamp: stats.mtime.toISOString(),
                        size: stats.size
                    };
                })
            );

            // Sort by timestamp descending and limit results
            return documents
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, limit);
        } catch (error) {
            console.error('Error getting recent documents:', error.message);
            throw error;
        }
    }

    async clearAllDocuments() {
        try {
            const files = await fs.readdir(this.storageDir);
            for (const file of files) {
                await fs.unlink(path.join(this.storageDir, file));
            }
        } catch (error) {
            console.error('Error clearing all documents:', error.message);
            throw error;
        }
    }
}

module.exports = new DocumentManager(); 

