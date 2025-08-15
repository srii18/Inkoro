const EventEmitter = require('events');
const printerManager = require('../printer/printerManager');
const documentManager = require('../storage/documentManager');
const printQueue = require('./queue');

class JobManager extends EventEmitter {
    constructor() {
        super();
        this.activeJobs = new Map();
        this.jobHistory = new Map();
        this.maxRetries = 3;
    }

    async createJob(jobData) {
        const jobId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const job = {
            id: jobId,
            status: 'created',
            data: jobData,
            priority: this._calculatePriority(jobData),
            retryCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            logs: []
        };

        this.activeJobs.set(jobId, job);
        this._addJobLog(jobId, 'Job created');
        
        // Add to print queue
        await printQueue.addJob(job);
        return job;
    }

    async updateJobStatus(jobId, status, details = {}) {
        const job = this.activeJobs.get(jobId);
        if (!job) return null;

        job.status = status;
        job.updatedAt = new Date().toISOString();
        Object.assign(job, details);

        this._addJobLog(jobId, `Status updated to ${status}`);
        this.emit('job:updated', job);

        if (['completed', 'failed', 'cancelled'].includes(status)) {
            this._moveToHistory(jobId);
        }

        return job;
    }

    async retryJob(jobId) {
        const job = this.jobHistory.get(jobId);
        if (!job || job.retryCount >= this.maxRetries) {
            throw new Error('Job cannot be retried');
        }

        job.retryCount++;
        job.status = 'pending';
        job.updatedAt = new Date().toISOString();

        this._addJobLog(jobId, `Retry attempt ${job.retryCount}`);
        this.activeJobs.set(jobId, job);
        this.jobHistory.delete(jobId);

        await printQueue.addJob(job);
        return job;
    }

    _calculatePriority(jobData) {
        let priority = 0;
        
        if (jobData.instructions) {
            if (jobData.instructions.priority === 'urgent') priority += 3;
            if (jobData.instructions.priority === 'high') priority += 2;
            if (jobData.instructions.deadline) priority += 2;
            if (jobData.instructions.colorPages?.length > 0) priority += 1;
        }

        return priority;
    }

    _addJobLog(jobId, message) {
        const job = this.activeJobs.get(jobId) || this.jobHistory.get(jobId);
        if (!job) return;

        job.logs.push({
            timestamp: new Date().toISOString(),
            message
        });
    }

    _moveToHistory(jobId) {
        const job = this.activeJobs.get(jobId);
        if (!job) return;

        this.jobHistory.set(jobId, job);
        this.activeJobs.delete(jobId);
        this._addJobLog(jobId, 'Moved to history');
    }

    getJobDetails(jobId) {
        return this.activeJobs.get(jobId) || this.jobHistory.get(jobId) || null;
    }

    getActiveJobs() {
        return Array.from(this.activeJobs.values());
    }

    getJobHistory(limit = 50) {
        return Array.from(this.jobHistory.values())
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .slice(0, limit);
    }
}

module.exports = new JobManager();