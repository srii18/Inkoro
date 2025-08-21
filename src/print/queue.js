const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const printerManager = require('../printer/printerManager');
const documentManager = require('../storage/documentManager');

class PrintQueue extends EventEmitter {
    constructor() {
        super();
        this.queue = [];
        this.completedJobs = [];
        this.dataFile = path.join(__dirname, '../../data/queue.json');
        this.isProcessing = false;
        this.initialize();
    }

    async initialize() {
        try {
            await this.loadQueue();
            // Start processing jobs
            this.processNextJob();
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist yet, that's okay
                console.log('No existing queue found, starting with empty queue');
                this.queue = [];
                this.completedJobs = [];
                await this.saveQueue(); // Create initial queue file
            } else {
                console.error('Failed to initialize print queue:', error);
                this.queue = [];
                this.completedJobs = [];
            }
        }
    }

    async loadQueue() {
        try {
            const data = await fs.readFile(this.dataFile, 'utf8');
            const { queue, completedJobs } = JSON.parse(data);
            this.queue = queue;
            this.completedJobs = completedJobs;
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist yet, that's okay
                this.queue = [];
                this.completedJobs = [];
                await this.saveQueue(); // Create initial queue file
            } else {
                console.error('Failed to load queue:', error);
                throw error;
            }
        }
    }

    async saveQueue() {
        try {
            const data = JSON.stringify({
                queue: this.queue,
                completedJobs: this.completedJobs
            }, null, 2);
            await fs.writeFile(this.dataFile, data);
        } catch (error) {
            console.error('Failed to save queue:', error);
            throw error;
        }
    }

    async addJob(job) {
        const queueItem = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            status: 'pending',
            priority: this.calculatePriority(job),
            estimatedPages: this.estimatePages(job),
            createdAt: new Date().toISOString(),
            progress: 0,
            ...job,
            sender: job.sender || (job.data && job.data.sender) || null
        };

        this.queue.push(queueItem);
        await this.saveQueue();
        this.emit('jobAdded', queueItem);
        this.emit('updated', this.queue, this.getStats());
        
        // Start processing if not already processing
        if (!this.isProcessing) {
            this.processNextJob();
        }
        
        return queueItem;
    }

    calculatePriority(job) {
        let priority = 0;
        if (job.instructions?.priority === 'urgent') priority += 3;
        if (job.instructions?.priority === 'high') priority += 2;
        if (job.instructions?.colorPages?.length > 0) priority += 1;
        if (job.instructions?.copies > 1) priority += 1;
        return priority;
    }

    estimatePages(job) {
        // Basic estimation logic - can be improved based on actual requirements
        return job.instructions?.copies || 1;
    }

    async processNextJob() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            // Sort queue by priority (highest first)
            this.queue.sort((a, b) => b.priority - a.priority);
            
            const job = this.queue[0];
            if (!job) {
                this.isProcessing = false;
                return;
            }

            await this.processJob(job);
        } catch (error) {
            console.error('Error processing job:', error);
        } finally {
            this.isProcessing = false;
            // Process next job after a short delay
            setTimeout(() => this.processNextJob(), 1000);
        }
    }

    async processJob(job) {
        try {
            console.log(`🖨️ Processing print job: ${job.fileName}`);
            
            // Update status to processing
            await this.updateJobStatus(job.id, 'processing');
            
            // Get the document
            const document = await documentManager.getDocument(job.fileId);
            if (!document) {
                throw new Error('Document not found');
            }

            // Update progress
            await this.updateJobProgress(job.id, 25);

            // Prepare print options
            const printOptions = {
                copies: job.instructions?.copies || 1,
                paperSize: job.instructions?.paperSize || 'a4',
                paperType: job.instructions?.paperType || 'plain',
                colorPages: job.instructions?.colorPages || [],
                priority: job.instructions?.priority || 'normal'
            };

            // Update progress
            await this.updateJobProgress(job.id, 50);

            // Print the document
            const result = await printerManager.printDocument(document.path, printOptions);
            
            // Update progress
            await this.updateJobProgress(job.id, 100);
            
            // Mark as completed
            await this.updateJobStatus(job.id, 'completed', null, result);
            
            console.log(`✅ Print job completed: ${job.fileName}`);

        } catch (error) {
            console.error(`❌ Print job failed: ${job.fileName}`, error);
            await this.updateJobStatus(job.id, 'failed', error.message);
        }
    }

    async updateJobStatus(jobId, status, error = null, result = null) {
        const job = this.queue.find(j => j.id === jobId);
        if (!job) return null;

        job.status = status;
        job.error = error;
        job.result = result;
        job.updatedAt = new Date().toISOString();

        if (status === 'completed' || status === 'failed') {
            this.queue = this.queue.filter(j => j.id !== jobId);
            this.completedJobs.push(job);
        }

        await this.saveQueue();
        this.emit('statusUpdated', { jobId, status, error });
        this.emit('updated', this.queue, this.getStats());
        return job;
    }

    async updateJobProgress(jobId, progress) {
        const job = this.queue.find(j => j.id === jobId);
        if (!job) return;

        job.progress = progress;
        job.updatedAt = new Date().toISOString();
        
        this.emit('statusUpdated', { jobId, status: job.status, progress });
        this.emit('updated', this.queue, this.getStats());
    }

    async retryJob(jobId) {
        const job = this.completedJobs.find(j => j.id === jobId);
        if (!job) return null;

        // Reset job status
        job.status = 'pending';
        job.error = null;
        job.result = null;
        job.progress = 0;
        job.retryCount = (job.retryCount || 0) + 1;
        job.updatedAt = new Date().toISOString();

        // Move from completed to queue
        this.completedJobs = this.completedJobs.filter(j => j.id !== jobId);
        this.queue.push(job);

        await this.saveQueue();
        this.emit('statusUpdated', { jobId, status: 'pending' });
        this.emit('updated', this.queue, this.getStats());
        
        // Start processing if not already processing
        if (!this.isProcessing) {
            this.processNextJob();
        }
        
        return job;
    }

    async removeJob(jobId) {
        const job = this.queue.find(j => j.id === jobId) || 
                   this.completedJobs.find(j => j.id === jobId);
        
        if (!job) return null;

        // Remove from appropriate array
        this.queue = this.queue.filter(j => j.id !== jobId);
        this.completedJobs = this.completedJobs.filter(j => j.id !== jobId);

        await this.saveQueue();
        this.emit('statusUpdated', { jobId, status: 'removed' });
        this.emit('updated', this.queue, this.getStats());
        return job;
    }

    async acceptJob(jobId, acceptedBy = null) {
        const job = this.queue.find(j => j.id === jobId);
        if (!job) throw new Error('Job not found');
        if (job.status !== 'pending' && job.status !== 'queued') throw new Error('Only pending or queued jobs can be accepted');
        job.status = 'processing';
        job.acceptedBy = acceptedBy;
        job.updatedAt = new Date().toISOString();
        await this.saveQueue();
        this.emit('statusUpdated', { jobId: job.id, status: job.status });
        this.emit('updated', this.queue, this.getStats());
        return job;
    }

    getStats() {
        return {
            total: this.queue.length + this.completedJobs.length,
            pending: this.queue.filter(j => j.status === 'pending').length,
            processing: this.queue.filter(j => j.status === 'processing').length,
            completed: this.completedJobs.filter(j => j.status === 'completed').length,
            failed: this.completedJobs.filter(j => j.status === 'failed').length
        };
    }

    async cleanupOldJobs(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
        const now = Date.now();
        this.completedJobs = this.completedJobs.filter(job => {
            const jobAge = now - new Date(job.createdAt).getTime();
            return jobAge < maxAge;
        });
        await this.saveQueue();
        this.emit('updated', this.queue, this.getStats());
    }
}

module.exports = new PrintQueue(); 