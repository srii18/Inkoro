const express = require('express');
const http = require('http');
const path = require('path');
const { setupWebSocket } = require('../websocket/server');
const WhatsAppClient = require('../whatsapp/client');
const PrintQueue = require('../print/queue');
const EventManager = require('../events/eventManager');

class PhotocopyServer {
    constructor() {
        this.app = express();
        this.whatsappClient = new WhatsAppClient();
        this.server = http.createServer(this.app);
        this.io = setupWebSocket(this.server, this.whatsappClient);
        this.eventManager = new EventManager(this.io);
        
        this.printQueue = null;
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../../public')));
    }

    setupRoutes() {
        // WhatsApp routes
        this.app.post('/api/whatsapp/connect', async (req, res) => {
            try {
                if (!this.whatsappClient) {
                    res.status(500).json({ 
                        success: false, 
                        error: 'WhatsApp client not initialized' 
                    });
                    return;
                }
                
                const result = await this.whatsappClient.connect();
                const status = this.whatsappClient.getStatus();
                
                res.json({ 
                    success: true, 
                    message: result.message,
                    status: status
                });
            } catch (error) {
                console.error('WhatsApp connect error:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        this.app.post('/api/whatsapp/disconnect', async (req, res) => {
            try {
                if (!this.whatsappClient) {
                    res.json({ 
                        success: true, 
                        message: 'WhatsApp was not connected' 
                    });
                    return;
                }
                
                const result = await this.whatsappClient.disconnect();
                res.json({ 
                    success: true, 
                    message: result.message 
                });
            } catch (error) {
                console.error('WhatsApp disconnect error:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        this.app.get('/api/whatsapp/status', (req, res) => {
            if (!this.whatsappClient) {
                res.json({ 
                    success: false, 
                    status: { status: 'disconnected' } 
                });
                return;
            }
            
            const status = this.whatsappClient.getStatus();
            res.json({ 
                success: true, 
                status: status 
            });
        });

        // Print queue routes
        this.app.get('/api/queue', (req, res) => {
            res.json({
                jobs: this.printQueue.queue,
                completedJobs: this.printQueue.completedJobs,
                stats: this.printQueue.getStats()
            });
        });

        this.app.post('/api/queue/job/:id/retry', async (req, res) => {
            try {
                const job = await this.printQueue.retryJob(req.params.id);
                res.json({ success: true, job });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.delete('/api/queue/job/:id', async (req, res) => {
            try {
                await this.printQueue.removeJob(req.params.id);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Printer routes
        this.app.get('/api/printer/status', async (req, res) => {
            try {
                const printerManager = require('../printer/printerManager');
                const status = await printerManager.getPrinterStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({ 
                    error: error.message,
                    message: 'Failed to get printer status'
                });
            }
        });

        // Document routes
        this.app.get('/api/documents/recent', async (req, res) => {
            try {
                const documentManager = require('../storage/documentManager');
                const documents = await documentManager.getRecentDocuments(10);
                res.json(documents);
            } catch (error) {
                res.status(500).json({ 
                    error: error.message,
                    message: 'Failed to get recent documents'
                });
            }
        });

        this.app.get('/api/documents/:fileId', async (req, res) => {
            try {
                const documentManager = require('../storage/documentManager');
                const document = await documentManager.getDocument(req.params.fileId);
                res.json(document);
            } catch (error) {
                res.status(404).json({ 
                    error: error.message,
                    message: 'Document not found'
                });
            }
        });
    }

    async initialize() {
        try {
            console.log('🚀 Starting Photocopy Management System...');
            
            // Initialize print queue
            this.printQueue = new PrintQueue();
            this.printQueue.on('jobAdded', (job) => {
                this.eventManager.emit('queue:jobAdded', job);
            });
            this.printQueue.on('statusUpdated', (data) => {
                this.eventManager.emit('queue:statusUpdated', data);
            });
            this.printQueue.on('updated', (queue, stats) => {
                this.eventManager.emit('queue:updated', queue, stats);
            });

            // Initialize WhatsApp client
            console.log('📱 Initializing WhatsApp client...');
            
            this.whatsappClient.on('statusChange', (status) => {
                console.log('📱 WhatsApp status changed:', status);
                this.eventManager.emit('whatsapp:status', status);
            });
            
            this.whatsappClient.on('qr', (qr) => {
                console.log('📱 QR code received');
                this.eventManager.emit('whatsapp:qr', qr);
            });
            
            this.whatsappClient.on('printJob', async (job) => {
                console.log('📱 Print job received:', job);
                try {
                    const queueItem = await this.printQueue.addJob(job);
                    this.eventManager.emit('system:notification', 'info', 
                        'New print job received', { jobId: queueItem.id });
                } catch (error) {
                    console.error('📱 Failed to add print job:', error);
                    this.eventManager.emit('system:notification', 'error',
                        'Failed to add print job', { error: error.message });
                }
            });
            
            console.log('📱 WhatsApp client initialized successfully');

            // Set up WebSocket event handlers
            this.setupWebSocketHandlers();
            
            // Start server
            await this.startServer();
            
        } catch (error) {
            console.error('Failed to initialize server:', error);
            process.exit(1);
        }
    }

    setupWebSocketHandlers() {
        this.io.on('connection', (socket) => {
            // Handle WhatsApp restart request
            socket.on('restart_whatsapp', async (callback) => {
                try {
                    await this.whatsappClient.disconnect();
                    setTimeout(async () => {
                        await this.whatsappClient.connect();
                    }, 2000);
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ success: false, error: error.message });
                }
            });

            // Handle print job actions
            socket.on('print_job_action', async (data, callback) => {
                const { action, jobId } = data;
                try {
                    switch (action) {
                        case 'retry':
                            await this.printQueue.retryJob(jobId);
                            break;
                        case 'cancel':
                            await this.printQueue.removeJob(jobId);
                            break;
                    }
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ success: false, error: error.message });
                }
            });

            // Handle queue actions
            socket.on('queue_action', async (data, callback) => {
                const { action, params } = data;
                try {
                    switch (action) {
                        case 'clear':
                            // Implement queue clearing logic
                            break;
                        case 'pause':
                            // Implement queue pausing logic
                            break;
                    }
                    if (callback) callback({ success: true });
                } catch (error) {
                    if (callback) callback({ success: false, error: error.message });
                }
            });
        });
    }

    async startServer() {
        return new Promise((resolve, reject) => {
            const port = process.env.PORT || 3002;
            this.server.listen(port, () => {
                console.log(`🌐 Server running on port ${port}`);
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    async gracefulShutdown(signal) {
        console.log(`\n📴 Received ${signal}. Starting graceful shutdown...`);
        
        try {
            // Disconnect WhatsApp
            if (this.whatsappClient) {
                await this.whatsappClient.disconnect();
            }

            // Close server
            await new Promise((resolve) => {
                this.server.close(resolve);
            });

            console.log('✅ Server shutdown complete');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    }
}

module.exports = PhotocopyServer; 