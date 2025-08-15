const EventEmitter = require('events');
const printerManager = require('../printer/printerManager');
const documentManager = require('../storage/documentManager');

const BATCH_INTERVAL = 10000; // 10 seconds

class PrintQueue extends EventEmitter {
    /**
     * Change the priority of a print job if it is not currently processing.
     * @param {number} jobId - The ID of the job to update.
     * @param {string} newPriority - The new priority value (e.g., 'low', 'medium', 'high').
     * @throws {Error} If the job is not found or is currently processing.
     */
    async changeJobPriority(jobId, newPriority) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error('Job not found');
        }
        if (job.status === 'processing') {
            throw new Error('Cannot change priority while job is processing');
        }
        if (!job.data.instructions) {
            job.data.instructions = {};
        }
        job.data.instructions.priority = newPriority;
        job.updatedAt = new Date();
        this.emit('priorityChanged', { jobId: job.id, newPriority });
        return { success: true, message: 'Priority changed successfully' };
    }

    constructor() {
        super();
        if (PrintQueue.instance) {
            return PrintQueue.instance;
        }
        
        this.jobs = new Map();
        this.nextJobId = 1;
        this.isProcessing = false;
        PrintQueue.instance = this;

        // Start the batch processing loop
        setInterval(() => this._processBatches(), BATCH_INTERVAL);
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
            // Job is queued, will be picked up by the batch processor
            this.emit('jobAdded', job);
            
            return job;
        } catch (error) {
            console.error('Error adding job to queue:', error);
            throw error;
        }
    }

    async _processBatches() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            const queuedJobs = Array.from(this.jobs.values()).filter(job => job.status === 'queued');
            if (queuedJobs.length === 0) {
                return;
            }

            const batches = await this._createBatches(queuedJobs);

            for (const [batchKey, jobsInBatch] of batches.entries()) {
                console.log(`Processing batch: ${batchKey} with ${jobsInBatch.length} jobs`);
                for (const job of jobsInBatch) {
                    await this._executeJob(job);
                }
            }
        } catch (error) {
            console.error('Error in batch processing cycle:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    async _createBatches(jobs) {
        const batches = new Map();

        for (const job of jobs) {
            try {
                const printer = await printerManager.selectBestPrinter(job.data.instructions);
                const batchKey = `${printer}:${job.data.instructions.paperType || 'default'}:${job.data.instructions.quality || 'normal'}`;

                if (!batches.has(batchKey)) {
                    batches.set(batchKey, []);
                }
                batches.get(batchKey).push(job);
            } catch (error) {
                console.error(`Failed to create batch for job ${job.id}:`, error);
                job.status = 'failed';
                job.error = 'Failed to determine printer or batch.';
            }
        }

        return batches;
    }

    async _executeJob(job) {
        if (!job) return;

        try {
            job.status = 'processing';
            job.updatedAt = new Date();
            this.emit('statusUpdated', { jobId: job.id, status: job.status, progress: job.progress });
            
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
            this.emit('statusUpdated', { jobId: job.id, status: job.status, progress: job.progress });
        } catch (error) {
            console.error('Error processing print job:', error);
            job.status = 'failed';
            job.error = error.message;
            job.updatedAt = new Date();
            this.emit('statusUpdated', { jobId: job.id, status: job.status, error: job.error });
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
        const jobsWithBatchKey = await Promise.all(Array.from(this.jobs.values()).map(async (job) => {
            let batchKey = 'N/A';
            if (job.status === 'queued' || job.status === 'processing') {
                try {
                    const printer = await printerManager.selectBestPrinter(job.data.instructions);
                    batchKey = `${printer}:${job.data.instructions.paperType || 'default'}:${job.data.instructions.quality || 'normal'}`;
                } catch (error) {
                    batchKey = 'unbatched';
                }
            }

            return {
                id: job.id,
                status: job.status,
                progress: job.progress,
                data: job.data,
                error: job.error,
                result: job.result,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                batchKey: batchKey
            };
        }));

        return {
            jobs: jobsWithBatchKey
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
        this.emit('statusUpdated', { jobId: job.id, status: job.status });
        return { success: true, message: 'Job cancelled successfully' };
    }

    async retryJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status !== 'failed' && job.status !== 'cancelled') {
            throw new Error('Can only retry failed or cancelled jobs');
        }

        job.status = 'queued';
        job.progress = 0;
        job.error = null;
        job.updatedAt = new Date();
        this.emit('statusUpdated', { jobId: job.id, status: job.status, progress: job.progress });
        return job;
    }

    async removeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status === 'processing') {
            throw new Error('Cannot remove job that is currently processing');
        }

        this.jobs.delete(jobId);
        this.emit('statusUpdated', { jobId: job.id, status: 'removed' });
        return { success: true, message: 'Job removed successfully' };
    }
}

// Export a singleton instance
module.exports = new PrintQueue(); 