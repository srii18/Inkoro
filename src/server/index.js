const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const EventEmitter = require('events');
const { sanitizeLog } = require('../utils/sanitize');

class Server extends EventEmitter {
    constructor(whatsapp = null) {
        super();
        this.app = express();
        this.whatsapp = whatsapp;
        this.wsClients = new Set();
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
                if (!this.whatsapp) {
                    return res.status(400).json({ success: false, error: 'WhatsApp client not initialized' });
                }
                const result = await this.whatsapp.connect();
                const status = await this.whatsapp.getStatus();
                res.json({ success: result?.success !== false, status });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
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
        this.app.get('/api/queue', (req, res) => {
            try {
                // Mock queue data for now
                res.json({
                    jobs: []
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.delete('/api/queue/job/:jobId', (req, res) => {
            try {
                const { jobId } = req.params;
                // Mock response for now
                res.json({
                    success: true,
                    message: `Job ${jobId} cancelled successfully`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/queue/job/:jobId/retry', (req, res) => {
            try {
                const { jobId } = req.params;
                // Mock response for now
                res.json({
                    success: true,
                    message: `Job ${jobId} retried successfully`
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/queue/clear-completed', (req, res) => {
            try {
                // Mock response for now
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

        // Documents API routes
        this.app.get('/api/documents/recent', (req, res) => {
            try {
                // Mock recent documents for now
                res.json([]);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
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
            for (const ws of this.wsClients) {
                try { ws.send(data); } catch (_) {}
            }
        };
        // Status updates
        this.whatsapp.on('statusChange', () => {
            const status = this.whatsapp.getStatus();
            safeBroadcast({ event: 'whatsapp_status_update', status });
        });
        // QR updates (client should emit 'qr' with code or null)
        this.whatsapp.on('qr', (qr) => {
            if (!qr) return; // ignore null expiry notices for now
            safeBroadcast({ event: 'whatsapp_qr', qr });
        });
    }

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
                    if (parsed && parsed.action === 'request_whatsapp_qr') {
                        if (this.whatsapp) {
                            const status = this.whatsapp.getStatus();
                            if (status.qrCode) {
                                ws.send(JSON.stringify({ event: 'whatsapp_qr', qr: status.qrCode }));
                            } else {
                                // Always try to force a fresh QR when requested
                                this.whatsapp.forceQR?.().catch(() => {});
                            }
                        }
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
