const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const EventEmitter = require('events');
const { sanitizeLog } = require('../utils/sanitize');
const QRManager = require('../utils/qrManager');

class Server extends EventEmitter {
    constructor(whatsapp = null, printQueue = null) {
        super();
        this.app = express();
        this.whatsapp = whatsapp;
        this.printQueue = printQueue;
        this.wsClients = new Set();
        this.qrManager = whatsapp ? new QRManager(whatsapp) : null;
        this.setupMiddleware();
        this.setupRoutes();
        this.setupAPIRoutes();
        this.setupWhatsAppEventBridge();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../../public')));
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../../public/index.html'));
        });
    }

    setupAPIRoutes() {
        // WhatsApp API routes
        this.app.get('/api/whatsapp/status', async (req, res) => {
            try {
                if (!this.whatsapp) {
                    return res.json({ success: true, status: { status: 'disconnected', isConnected: false, isConnecting: false } });
                }
                const status = await this.whatsapp.getStatus();
                res.json({ success: true, status });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.app.post('/api/whatsapp/connect', async (req, res) => {
            try {
                console.log('Connect API called');
                
                if (!this.whatsapp) {
                    console.log('WhatsApp client not initialized');
                    return res.status(400).json({ success: false, error: 'WhatsApp client not initialized' });
                }
                
                // Check if already connecting or connected
                const currentStatus = this.whatsapp.getStatus();
                if (currentStatus.isConnecting || currentStatus.isConnected) {
                    console.log('Already connecting or connected, returning current status');
                    return res.json({ 
                        success: true, 
                        status: currentStatus,
                        message: 'Already connected or connecting'
                    });
                }
                
                console.log('Starting WhatsApp connection...');
                
                // Start the connection process
                const result = await this.whatsapp.connect();
                console.log('Connect result:', result);
                
                // Get current status
                const status = this.whatsapp.getStatus();
                console.log('Current status:', status);
                
                // Return success if connection started successfully
                res.json({ 
                    success: true, 
                    status: status,
                    message: result?.message || 'Connection process started'
                });
                
            } catch (error) {
                console.error('WhatsApp connect error:', error);
                res.status(500).json({ success: false, error: error.message || 'Unknown connection error' });
            }
        });

        this.app.post('/api/whatsapp/disconnect', async (req, res) => {
            try {
                if (!this.whatsapp) {
                    return res.json({ success: true, status: { status: 'disconnected', isConnected: false, isConnecting: false } });
                }
                await this.whatsapp.disconnect();
                res.json({ success: true, status: { status: 'disconnected', isConnected: false, isConnecting: false } });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Simple QR endpoint using QR Manager
        this.app.get('/api/whatsapp/qr', async (req, res) => {
            try {
                if (!this.qrManager) {
                    return res.json({ success: false, error: 'QR Manager not initialized' });
                }
                
                console.log('QR API called, QR Manager status:', this.qrManager.getStatus());
                
                const qrCode = await this.qrManager.getQR();
                
                if (qrCode) {
                    res.json({ success: true, qr: qrCode });
                } else {
                    res.json({ success: false, message: 'QR code not available' });
                }
                
            } catch (error) {
                console.error('QR API error:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Printer API routes
        this.app.get('/api/printer/status', async (req, res) => {
            try {
                // Mock printer status for now
                res.json({
                    name: 'Microsoft Print to PDF',
                    status: 'ready',
                    details: 'PDF printer is ready',
                    message: 'PDF printer is ready to accept jobs'
                });
            } catch (error) {
                res.status(500).json({
                    error: true,
                    message: error.message
                });
            }
        });

        // Queue API routes
        this.app.get('/api/queue', async (req, res) => {
            try {
                if (!this.printQueue) {
                    return res.json({ jobs: [], stats: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 } });
                }
                const status = await this.printQueue.getQueueStatus();
                const stats = this.printQueue.getStats();
                res.json({ jobs: status.jobs, stats });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.delete('/api/queue/job/:jobId', async (req, res) => {
            try {
                const { jobId } = req.params;
                if (!this.printQueue) throw new Error('Queue not available');
                const result = await this.printQueue.removeJob(jobId);
                if (result) {
                    res.json({
                        success: true,
                        message: `Job ${jobId} cancelled successfully`
                    });
                } else {
                    res.status(404).json({
                        success: false,
                        error: 'Job not found'
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/queue/job/:jobId/retry', async (req, res) => {
            try {
                const { jobId } = req.params;
                if (!this.printQueue) throw new Error('Queue not available');
                const result = await this.printQueue.retryJob(jobId);
                if (result) {
                    res.json({
                        success: true,
                        message: `Job ${jobId} retried successfully`
                    });
                } else {
                    res.status(404).json({
                        success: false,
                        error: 'Job not found'
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/queue/clear-completed', async (req, res) => {
            try {
                if (!this.printQueue) throw new Error('Queue not available');
                await this.printQueue.cleanupOldJobs(0); // Remove all completed jobs
                res.json({
                    success: true,
                    message: 'Completed jobs cleared successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Accept job endpoint
        this.app.post('/api/queue/job/:jobId/accept', async (req, res) => {
            try {
                const { jobId } = req.params;
                const acceptedBy = (req.body && req.body.acceptedBy) || 'Dashboard';
                if (!this.printQueue) throw new Error('Queue not available');
                const result = await this.printQueue.acceptJob(jobId, acceptedBy);
                res.json({ success: true, job: result });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });

        // Documents API routes
        this.app.get('/api/documents/recent', async (req, res) => {
            try {
                const documentManager = require('../storage/documentManager');
                const documents = await documentManager.getRecentDocuments(50); // Get last 50 documents
                res.json(documents || []);
            } catch (error) {
                console.error('Error fetching recent documents:', error);
                res.json([]); // Return empty array on error to prevent frontend crashes
            }
        });

        this.app.delete('/api/documents/recent', async (req, res) => {
            try {
                const documentManager = require('../storage/documentManager');
                if (documentManager.clearRecentDocuments) {
                    await documentManager.clearRecentDocuments();
                } else {
                    await documentManager.clearAllDocuments();
                }
                res.json({
                    success: true,
                    message: 'Recent documents cleared successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Delete a single document by fileId
        this.app.delete('/api/documents/:fileId', async (req, res) => {
            try {
                const { fileId } = req.params;
                const documentManager = require('../storage/documentManager');
                await documentManager.deleteDocument(fileId);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Serve document files
        this.app.get('/storage/documents/:filename', (req, res) => {
            try {
                const { filename } = req.params;
                const documentManager = require('../storage/documentManager');
                const filePath = documentManager.getDocumentPath(filename);
                
                if (filePath && require('fs').existsSync(filePath)) {
                    res.sendFile(filePath);
                } else {
                    res.status(404).json({ error: 'Document not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // WebSocket endpoint for Socket.IO
        this.app.get('/socket.io/socket.io.js', (req, res) => {
            res.redirect('https://cdn.socket.io/4.8.1/socket.io.min.js');
        });
    }

    setupWhatsAppEventBridge() {
        if (!this.whatsapp) return;
        const safeBroadcast = (payload) => {
            const data = JSON.stringify(payload);
            console.log('Broadcasting to', this.wsClients.size, 'clients:', payload.event);
            for (const ws of this.wsClients) {
                try { 
                    if (ws.readyState === 1) { // WebSocket.OPEN
                        ws.send(data); 
                    }
                } catch (e) {
                    console.error('Error broadcasting to client:', e.message);
                }
            }
        };
        // Status updates
        this.whatsapp.on('statusChange', () => {
            const status = this.whatsapp.getStatus();
            console.log('WhatsApp status changed:', status.status);
            // Clear QR when connected
            if (status.status === 'connected' && this.qrManager) {
                this.qrManager.clearQR();
            }
            safeBroadcast({ event: 'whatsapp_status_update', status });
        });
        // QR updates (client should emit 'qr' with code or null)
        this.whatsapp.on('qr', (qr) => {
            console.log('QR event received in server, broadcasting to clients');
            if (!qr) {
                console.log('QR is null, not broadcasting');
                return; // ignore null expiry notices for now
            }
            safeBroadcast({ event: 'whatsapp_qr', qr });
        });

        // New document received -> let UI refresh recent documents
        this.whatsapp.on('newDocument', (doc) => {
            safeBroadcast({ event: 'new_document', doc });
        });
    }

    // QR management is now handled by QRManager class

    start(port) {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(port, () => {
                    console.log('\n🌐 Server running at:');
                    console.log(`  > Local: http://localhost:${port}`);
                    console.log(`  > Network: http://${this._getLocalIP()}:${port}\n`);
                    this.setupWebSocket();
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    _getLocalIP() {
        const { networkInterfaces } = require('os');
        const nets = networkInterfaces();
        
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        return '127.0.0.1';
    }

    setupWebSocket() {
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            console.log('New WebSocket connection');
            this.wsClients.add(ws);
            // Send initial status to the newly connected client
            try {
                if (this.whatsapp) {
                    const status = this.whatsapp.getStatus();
                    ws.send(JSON.stringify({ event: 'whatsapp_status_update', status }));
                }
            } catch (_) {}
            
            ws.on('message', (message) => {
                try {
                    const { summary } = sanitizeLog(String(message));
                    console.log('Received WS message:', summary);
                    // Try to parse commands
                    let parsed = null;
                    try { parsed = JSON.parse(String(message)); } catch {}
                                            // QR requests are now handled via API endpoint /api/whatsapp/qr
                        // WebSocket is only used for status updates
                        if (parsed && parsed.action === 'request_whatsapp_qr') {
                            console.log('QR request received via WebSocket - use API endpoint instead');
                        }
                } catch {
                    console.log('Received WS message: [unreadable]');
                }
            });

            ws.on('close', () => {
                this.wsClients.delete(ws);
            });
        });
    }
}

module.exports = Server;
