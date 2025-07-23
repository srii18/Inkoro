const { Server } = require('socket.io');
const WhatsAppClient = require('../whatsapp/client');

function setupWebSocket(httpServer, whatsappClient) {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        pingTimeout: 60000,
        pingInterval: 25000
    });

    let connectedClients = 0;
    let lastWhatsAppQR = null;
    whatsappClientInstance = whatsappClient;

    io.on('connection', (socket) => {
        connectedClients++;
        console.log(`📱 Dashboard client connected (${connectedClients} total)`);

        // Send welcome message with current timestamp
        socket.emit('connection_established', {
            message: 'Connected to Photocopy Management System',
            timestamp: new Date().toISOString(),
            clientId: socket.id
        });

        // Handle client requesting current status
        socket.on('request_status', (callback) => {
            socket.emit('status_requested');
            if (callback) callback({ received: true });
        });

        // Handle WhatsApp restart request from dashboard
        socket.on('restart_whatsapp', (callback) => {
            socket.emit('whatsapp_restart_requested');
            if (callback) callback({ received: true });
        });

        // Handle print job actions from dashboard
        socket.on('print_job_action', (data, callback) => {
            const { action, jobId } = data;
            console.log(`Print job action: ${action} for job ${jobId}`);
            
            socket.emit('print_job_action_requested', { action, jobId });
            
            if (callback) callback({ 
                received: true, 
                action, 
                jobId,
                timestamp: new Date().toISOString()
            });
        });

        // Handle queue management requests
        socket.on('queue_action', (data, callback) => {
            const { action, params } = data;
            console.log(`Queue action: ${action}`, params);
            
            socket.emit('queue_action_requested', { action, params });
            
            if (callback) callback({ 
                received: true, 
                action,
                timestamp: new Date().toISOString()
            });
        });

        // Handle printer status requests
        socket.on('printer_status_request', (callback) => {
            socket.emit('printer_status_requested');
            if (callback) callback({ received: true });
        });

        // Handle client disconnect
        socket.on('disconnect', (reason) => {
            connectedClients--;
            console.log(`📱 Dashboard client disconnected: ${reason} (${connectedClients} remaining)`);
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            socket.emit('heartbeat', { 
                timestamp: new Date().toISOString(),
                serverUptime: process.uptime()
            });
        }, 30000); // Every 30 seconds

        socket.on('disconnect', () => {
            clearInterval(heartbeat);
        });

        socket.on('request_whatsapp_qr', async () => {
            if (whatsappClientInstance) {
                if (whatsappClientInstance.isQRExpired()) {
                    await whatsappClientInstance.forceQR();
                } else if (lastWhatsAppQR) {
                    socket.emit('whatsapp_qr', {
                        qr: lastWhatsAppQR,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });
    });

    // Broadcast system-wide notifications
    io.broadcastSystemNotification = (type, message, data = {}) => {
        io.emit('system_notification', {
            type, // 'info', 'warning', 'error', 'success'
            message,
            data,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast WhatsApp status updates
    io.broadcastWhatsAppStatus = (status) => {
        io.emit('whatsapp_status_update', {
            status,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast WhatsApp QR code
    io.broadcastWhatsAppQR = (qr) => {
        lastWhatsAppQR = qr;
        io.emit('whatsapp_qr', {
            qr,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast print queue updates
    io.broadcastQueueUpdate = (queue, stats) => {
        io.emit('print_queue_update', {
            queue,
            stats,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast new print job
    io.broadcastNewPrintJob = (job) => {
        io.emit('new_print_job', {
            job,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast print job status update
    io.broadcastJobStatusUpdate = (jobId, status, details = {}) => {
        io.emit('print_job_status_update', {
            jobId,
            status,
            details,
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast printer status
    io.broadcastPrinterStatus = (printerStatus) => {
        io.emit('printer_status_update', {
            status: printerStatus,
            timestamp: new Date().toISOString()
        });
    };

    // Get connected clients count
    io.getConnectedClientsCount = () => connectedClients;

    // Broadcast server stats
    const broadcastStats = () => {
        io.emit('server_stats', {
            connectedClients,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        });
    };

    // Broadcast stats every minute
    setInterval(broadcastStats, 60000);

    console.log('🔌 WebSocket server initialized');
    return io;
}

module.exports = { setupWebSocket }; 