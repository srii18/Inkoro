const printerManager = require('../printer/printerManager');
const documentManager = require('../storage/documentManager');

class PrintQueue {
    constructor() {
        if (PrintQueue.instance) {
            return PrintQueue.instance;
        }
        
        this.jobs = new Map();
        this.nextJobId = 1;
        PrintQueue.instance = this;
    }

    async addJob(jobData) {
        try {
            const jobId = this.nextJobId++;
            const job = {
                id: jobId,
                status: 'queued',
                progress: 0,
                data: jobData,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            this.jobs.set(jobId, job);
            this.processJob(jobId);
            
            return job;
        } catch (error) {
            console.error('Error adding job to queue:', error);
            throw error;
        }
    }

    async processJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        try {
            job.status = 'processing';
            job.updatedAt = new Date();
            
            // Get the document
            const document = await documentManager.getDocument(job.data.fileId);
            if (!document) {
                throw new Error('Document not found');
            }

            // Print the document
            const result = await printerManager.printDocument(document.path, job.data.instructions);
            
            job.status = 'completed';
            job.progress = 100;
            job.result = result;
            job.updatedAt = new Date();
        } catch (error) {
            console.error('Error processing print job:', error);
            job.status = 'failed';
            job.error = error.message;
            job.updatedAt = new Date();
        }
    }

    async getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return { status: 'not_found' };
        }

        return {
            id: job.id,
            status: job.status,
            progress: job.progress,
            data: job.data,
            error: job.error,
            result: job.result,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
        };
    }

    async getQueueStatus() {
        return {
            jobs: Array.from(this.jobs.values()).map(job => ({
                id: job.id,
                status: job.status,
                progress: job.progress,
                data: job.data,
                error: job.error,
                result: job.result,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            }))
        };
    }

    async cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status === 'completed' || job.status === 'failed') {
            throw new Error('Cannot cancel completed or failed job');
        }

        job.status = 'cancelled';
        job.updatedAt = new Date();
        return { success: true, message: 'Job cancelled successfully' };
    }
}

// Export a singleton instance
module.exports = new PrintQueue(); 