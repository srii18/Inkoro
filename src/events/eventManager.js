const EventEmitter = require('events');

class EventManager extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // WhatsApp events
        this.on('whatsapp:status', (status) => {
            console.log('📱 Broadcasting WhatsApp status:', status);
            this.io.broadcastWhatsAppStatus(status);
        });

        this.on('whatsapp:qr', (qr) => {
            console.log('📱 Broadcasting WhatsApp QR code');
            this.io.broadcastWhatsAppQR(qr);
        });

        // Print Queue events
        this.on('queue:jobAdded', (job) => {
            this.io.broadcastNewPrintJob(job);
        });

        this.on('queue:statusUpdated', ({ jobId, status, error }) => {
            this.io.broadcastJobStatusUpdate(jobId, status, { error });
        });

        this.on('queue:updated', (queue, stats) => {
            this.io.broadcastQueueUpdate(queue, stats);
        });

        // System events
        this.on('system:notification', (type, message, data) => {
            this.io.broadcastSystemNotification(type, message, data);
        });

        this.on('printer:status', (status) => {
            this.io.broadcastPrinterStatus(status);
        });
    }
}

module.exports = EventManager; 