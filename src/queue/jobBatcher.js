const printQueue = require('./printQueue');

class JobBatcher {
    constructor() {
        this.batchTimeout = 30000; // 30 seconds
        this.batches = new Map();
    }

    async addToBatch(job) {
        const batchKey = this.getBatchKey(job);
        
        if (!this.batches.has(batchKey)) {
            this.batches.set(batchKey, {
                jobs: [],
                timeout: setTimeout(() => this.processBatch(batchKey), this.batchTimeout)
            });
        }

        const batch = this.batches.get(batchKey);
        batch.jobs.push(job);

        // If we have enough jobs, process immediately
        if (batch.jobs.length >= 5) {
            clearTimeout(batch.timeout);
            await this.processBatch(batchKey);
        }
    }

    getBatchKey(job) {
        const { instructions } = job;
        return JSON.stringify({
            paperSize: instructions.paperSize,
            paperType: instructions.paperType,
            colorPages: instructions.colorPages,
            copies: instructions.copies
        });
    }

    async processBatch(batchKey) {
        const batch = this.batches.get(batchKey);
        if (!batch) return;

        this.batches.delete(batchKey);
        clearTimeout(batch.timeout);

        // Combine similar jobs
        const combinedJob = this.combineJobs(batch.jobs);
        
        // Add to print queue
        await printQueue.addJob(combinedJob);
    }

    combineJobs(jobs) {
        const firstJob = jobs[0];
        const totalCopies = jobs.reduce((sum, job) => sum + job.instructions.copies, 0);

        return {
            ...firstJob,
            instructions: {
                ...firstJob.instructions,
                copies: totalCopies,
                batchSize: jobs.length
            }
        };
    }

    async cancelBatch(batchKey) {
        const batch = this.batches.get(batchKey);
        if (!batch) return;

        clearTimeout(batch.timeout);
        this.batches.delete(batchKey);

        // Cancel all jobs in the batch
        for (const job of batch.jobs) {
            await printQueue.cancelJob(job.id);
        }
    }

    getBatchStatus() {
        const status = [];
        for (const [key, batch] of this.batches.entries()) {
            status.push({
                key,
                jobCount: batch.jobs.length,
                instructions: JSON.parse(key)
            });
        }
        return status;
    }
}

module.exports = new JobBatcher(); 