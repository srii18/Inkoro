const EventEmitter = require('events');
const { sanitizeLog } = require('../utils/sanitize');

class EventManager extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        // WhatsApp events
        this.on('whatsapp:status', (status) => {
            const { summary } = sanitizeLog(status);
            console.log('📱 Broadcasting WhatsApp status:', summary);
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
            const msg = sanitizeLog(message).preview;
            const dataSummary = sanitizeLog(data).preview;
            console.log(`🔔 System notification: type=${type}, message=${msg}, data=${dataSummary}`);
            this.io.broadcastSystemNotification(type, message, data);
        });

        this.on('printer:status', (status) => {
            this.io.broadcastPrinterStatus(status);
        });

        // Image batch preview event
        this.on('imageBatchPreview', (preview) => {
            this.io.emit('image_batch_preview', preview);
        });
    }
}

module.exports = EventManager; 