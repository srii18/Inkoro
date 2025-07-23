const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
// const documentManager = require('../storage/documentManager');
// const printQueue = require('../queue/printQueue');
// const instructionParser = require('../parser/instructionParser');

// Create a Pino logger instance with minimal output
const logger = pino({
    level: 'silent',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: false,
            translateTime: false,
            ignore: 'pid,hostname'
        }
    }
});

class WhatsAppClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.isConnected = false;
        this.qrCode = null;
        this.qrTimestamp = null;
        this.qrTimeoutMs = 60000; // 60 seconds
        this.connectionStatus = 'disconnected';
        this.authFolder = path.join(process.cwd(), 'whatsapp_auth');
        this.initializeAuthFolder();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.reconnectDelay = 5000; // 5 seconds
        this.isConnecting = false;
        this.pendingJobs = new Map();
        this.qrTimeoutHandle = null;
    }

    initializeAuthFolder() {
        if (!fs.existsSync(this.authFolder)) {
            fs.mkdirSync(this.authFolder, { recursive: true });
        }
    }

    isQRExpired() {
        if (!this.qrTimestamp) return true;
        return (Date.now() - this.qrTimestamp) > this.qrTimeoutMs;
    }

    async forceQR() {
        // Disconnect and reconnect to force a new QR
        if (this.client) {
            await this.disconnect();
        }
        await this.connect();
    }

    async connect() {
        if (this.isConnecting) {
            return { success: false, message: 'Connection already in progress' };
        }
        try {
            this.isConnecting = true;
            this.connectionStatus = 'connecting';
            this.emit('statusChange', this.connectionStatus);
            if (this.connectionStatus === 'failed') {
                await this.clearAuthState();
            }
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            this.client = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: ['Photocopy Optimizer', 'Chrome', '1.0.0'],
                logger: logger,
                connectTimeoutMs: 120000,
                defaultQueryTimeoutMs: 120000,
                retryRequestDelayMs: 10000,
                markOnlineOnConnect: false,
                keepAliveIntervalMs: 30000,
                emitOwnEvents: false,
                syncFullHistory: false,
                shouldIgnoreJid: jid => jid.includes('@broadcast'),
                patchMessageBeforeSending: (msg) => {
                    const requiresPatch = !!(
                        msg.buttonsMessage ||
                        msg.templateMessage ||
                        msg.listMessage
                    );
                    if (requiresPatch) {
                        msg = {
                            viewOnceMessage: {
                                message: {
                                    messageContextInfo: {
                                        deviceListMetadataVersion: 2,
                                        deviceListMetadata: {},
                                    },
                                    ...msg,
                                },
                            },
                        };
                    }
                    return msg;
                }
            });
            this.client.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log('Connection update:', { connection, qr: !!qr });
                if (qr) {
                    console.log('QR Code received');
                    this.qrCode = qr;
                    this.qrTimestamp = Date.now();
                    this.emit('qr', qr);
                    this.connectionStatus = 'connecting';
                    this.emit('statusChange', this.connectionStatus);
                    if (this.qrTimeoutHandle) clearTimeout(this.qrTimeoutHandle);
                    this.qrTimeoutHandle = setTimeout(() => {
                        if (this.qrCode && this.isQRExpired()) {
                            this.qrCode = null;
                            this.qrTimestamp = null;
                            this.emit('qr', null); // Notify QR expired
                        }
                    }, this.qrTimeoutMs);
                    return;
                }
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log('Connection closed with status:', statusCode);
                    if (statusCode === 401) {
                        await this.clearAuthState();
                        this.connectionStatus = 'disconnected';
                        this.emit('statusChange', this.connectionStatus);
                        this.isConnected = false;
                        this.isConnecting = false;
                        this.qrCode = null;
                        this.qrTimestamp = null;
                        if (this.qrTimeoutHandle) clearTimeout(this.qrTimeoutHandle);
                        return;
                    }
                    if (statusCode === 515) {
                        this.connectionStatus = 'connecting';
                        this.emit('statusChange', this.connectionStatus);
                        this.isConnected = false;
                        this.isConnecting = false;
                        setTimeout(() => this.connect(), 5000);
                        return;
                    }
                    if (statusCode === 440) {
                        console.log('Rate limited, waiting before reconnecting...');
                        this.connectionStatus = 'reconnecting';
                        this.emit('statusChange', this.connectionStatus);
                        this.isConnected = false;
                        this.isConnecting = false;
                        setTimeout(() => this.connect(), 15000);
                        return;
                    }
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                         this.reconnectAttempts < this.maxReconnectAttempts;
                    if (shouldReconnect) {
                        this.reconnectAttempts++;
                        this.connectionStatus = 'reconnecting';
                        this.emit('statusChange', this.connectionStatus);
                        setTimeout(() => this.connect(), this.reconnectDelay);
                    } else {
                        this.connectionStatus = 'disconnected';
                        this.emit('statusChange', this.connectionStatus);
                        this.isConnected = false;
                        this.isConnecting = false;
                        this.reconnectAttempts = 0;
                        this.qrCode = null;
                        this.qrTimestamp = null;
                        if (this.qrTimeoutHandle) clearTimeout(this.qrTimeoutHandle);
                    }
                } else if (connection === 'open') {
                    console.log('Connection opened successfully');
                    this.connectionStatus = 'connected';
                    this.emit('statusChange', this.connectionStatus);
                    this.isConnected = true;
                    this.isConnecting = false;
                    this.reconnectAttempts = 0;
                    this.qrCode = null;
                    this.qrTimestamp = null;
                    if (this.qrTimeoutHandle) clearTimeout(this.qrTimeoutHandle);
                }
            });
            this.client.ev.on('creds.update', saveCreds);
            this.client.ev.on('messages.upsert', async ({ messages }) => {
                for (const message of messages) {
                    if (!message.key.fromMe) {
                        await this.handleIncomingMessage(message);
                    }
                }
            });
            return { success: true, message: 'WhatsApp client initialized' };
        } catch (error) {
            console.error('WhatsApp connection error:', error);
            this.connectionStatus = 'failed';
            this.emit('statusChange', this.connectionStatus);
            this.isConnecting = false;
            throw error;
        }
    }

    async clearAuthState() {
        try {
            const files = fs.readdirSync(this.authFolder);
            for (const file of files) {
                fs.unlinkSync(path.join(this.authFolder, file));
            }
        } catch (error) {
            console.error('Error clearing auth state:', error);
        }
    }

    async disconnect() {
        try {
            if (this.client) {
                await this.client.logout();
                this.client = null;
                this.isConnected = false;
                this.connectionStatus = 'disconnected';
                this.emit('statusChange', this.connectionStatus);
                this.qrCode = null;
                this.qrTimestamp = null;
                if (this.qrTimeoutHandle) clearTimeout(this.qrTimeoutHandle);
                return { success: true, message: 'WhatsApp disconnected successfully' };
            }
            return { success: true, message: 'WhatsApp was not connected' };
        } catch (error) {
            console.error('Error disconnecting:', error);
            this.connectionStatus = 'error';
            this.emit('statusChange', this.connectionStatus);
            throw error;
        }
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            status: this.connectionStatus,
            qrCode: this.qrCode,
            isConnecting: this.isConnecting
        };
    }

    async handleIncomingMessage(message) {
        try {
            const messageContent = message.message;
            if (!messageContent) return;

            // Handle document messages
            if (messageContent.documentMessage) {
                await this.handleDocumentMessage(message);
                return;
            }

            // Handle text messages
            if (messageContent.conversation || messageContent.extendedTextMessage) {
                await this.handleTextMessage(message);
                return;
            }

            // Handle image messages
            if (messageContent.imageMessage) {
                await this.handleImageMessage(message);
                return;
            }

        } catch (error) {
            console.error('Error handling incoming message:', error);
            await this.sendMessage(message.key.remoteJid, '❌ Sorry, there was an error processing your request.');
        }
    }

    async handleDocumentMessage(message) {
        try {
            const documentManager = require('../storage/documentManager');
            const document = message.message.documentMessage;
            const fileName = document.fileName || `document_${Date.now()}.${document.mimetype ? document.mimetype.split('/').pop() : 'pdf'}`;
            const sender = message.key.remoteJid;
            
            console.log(`📄 Document received: ${fileName} from ${sender}`);

            // Download the document first
            const fileData = await this.downloadDocument(
                document.url,
                fileName,
                message // Pass the full message object for proper media download
            );

            if (!fileData) {
                throw new Error('Failed to download document');
            }

            // Save document to storage
            const savedDoc = await documentManager.saveDocument(fileData.buffer, fileName);
            
            // Create a pending job for this document
            const pendingJob = {
                fileId: savedDoc.fileId,
                fileName: savedDoc.originalName || fileName,
                sender: sender,
                instructions: {
                    copies: 1,
                    paperSize: 'a4',
                    paperType: 'plain',
                    colorPages: [],
                    priority: 'normal'
                },
                timestamp: new Date().toISOString(),
                fileSize: fileData.size
            };

            // Store as pending job
            this.setPendingJob(sender, pendingJob);

            // Send confirmation and ask for instructions
            await this.sendMessage(sender, 
                `✅ Document received: ${fileName}\n` +
                `📊 Size: ${Math.round(fileData.size / 1024)}KB\n\n` +
                `📋 Please reply with your print instructions:\n` +
                `• "2 copies" - for multiple copies\n` +
                `• "Color pages 1-3" - for specific color pages\n` +
                `• "A3 paper" - for different paper size\n` +
                `• "Urgent" - for priority printing\n` +
                `• "Glossy paper" - for different paper type\n\n` +
                `💬 Or just reply "print" for default settings (1 copy, A4)`
            );

        } catch (error) {
            console.error('Error handling document message:', error);
            await this.sendMessage(
                message.key.remoteJid, 
                `❌ Error processing document: ${error.message}\n\n` +
                'Please try sending the file again or contact support if the problem persists.'
            );
        }
    }

    async handleTextMessage(message) {
        try {
            const instructionParser = require('../parser/instructionParser');
            const documentManager = require('../storage/documentManager');
            const text = message.message.conversation || message.message.extendedTextMessage?.text;
            const sender = message.key.remoteJid;
            
            if (!text) return;

            console.log(`💬 Text message received: ${text} from ${sender}`);

            // Check if this is a reply to a previous document
            const pendingJob = this.getPendingJob(sender);
            
            if (pendingJob) {
                // Parse instructions from text
                const instructions = instructionParser.parse(text);
                
                // Update the pending job with instructions
                const updatedJob = {
                    ...pendingJob,
                    instructions: {
                        ...pendingJob.instructions,
                        ...instructions
                    }
                };

                // The document should already be downloaded and saved when the pending job was created
                // We just need to update the instructions and create the print job
                
                // Create final print job with the file already saved
                const printJob = {
                    ...updatedJob,
                    instructions: {
                        ...updatedJob.instructions,
                        ...instructions
                    }
                };

                // Emit print job event
                this.emit('printJob', printJob);
                
                // Send confirmation
                await this.sendMessage(sender, 
                    `✅ Print job created!\n\n` +
                    `📄 ${printJob.fileName}\n` +
                    `📋 Copies: ${printJob.instructions.copies}\n` +
                    `📏 Paper: ${printJob.instructions.paperSize.toUpperCase()}\n` +
                    `🎨 Color pages: ${printJob.instructions.colorPages.length > 0 ? printJob.instructions.colorPages.join(', ') : 'None'}\n` +
                    `⏰ Priority: ${printJob.instructions.priority}\n\n` +
                    `🖨️ Your job is now in the print queue. You'll be notified when it's ready!`
                );

                // Remove from pending jobs
                this.removePendingJob(sender);
            } else {
                // No pending job, send help message
                await this.sendMessage(sender, 
                    `👋 Welcome to Photocopy Optimizer!\n\n` +
                    `📄 Send me a document to print\n` +
                    `💬 Or reply to a document with instructions like:\n` +
                    `• "2 copies"\n` +
                    `• "Color pages 1-3"\n` +
                    `• "A3 paper, urgent"\n` +
                    `• "3 copies, glossy paper"\n\n` +
                    `🆘 Need help? Just ask!`
                );
            }

        } catch (error) {
            console.error('Error handling text message:', error);
            await this.sendMessage(message.key.remoteJid, '❌ Error processing message. Please try again.');
        }
    }

    async handleImageMessage(message) {
        try {
            const documentManager = require('../storage/documentManager');
            const image = message.message.imageMessage;
            const fileName = `image_${Date.now()}.${image.mimetype ? image.mimetype.split('/').pop() : 'jpg'}`;
            const sender = message.key.remoteJid;
            
            console.log(`🖼️ Image received from ${sender}`);

            // Download the image
            const imageData = await this.downloadDocument(
                image.url,
                fileName,
                message // Pass the full message object for proper media download
            );

            if (!imageData) {
                throw new Error('Failed to download image');
            }

            // Save image to storage
            const savedDoc = await documentManager.saveDocument(imageData.buffer, fileName);
            
            // Create print job for image
            const printJob = {
                fileId: savedDoc.fileId,
                fileName: savedDoc.originalName || fileName,
                sender: sender,
                instructions: {
                    copies: 1,
                    paperSize: 'a4',
                    paperType: 'photo',
                    colorPages: [1], // First page in color for images
                    priority: 'normal'
                },
                timestamp: new Date().toISOString(),
                fileSize: imageData.size
            };

            // Emit print job event
            this.emit('printJob', printJob);
            
            // Send confirmation
            await this.sendMessage(sender, 
                `✅ Image received!\n` +
                `📊 Size: ${Math.round(imageData.size / 1024)}KB\n` +
                `📋 Creating photo print job...\n` +
                `📄 Default: 1 copy, A4 photo paper\n` +
                `💬 Reply with instructions to customize`
            );

        } catch (error) {
            console.error('Error handling image message:', error);
            await this.sendMessage(
                message.key.remoteJid, 
                `❌ Error processing image: ${error.message}\n\n` +
                'Please try sending the image again or contact support if the problem persists.'
            );
        }
    }

    async downloadDocument(url, fileName, messageObj = null) {
        try {
            if (!this.client) {
                throw new Error('WhatsApp client not initialized');
            }

            if (!fileName) {
                throw new Error('File name is required');
            }

            // Validate file extension
            const fileExt = fileName.split('.').pop().toLowerCase();
            const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'txt', 'gif', 'bmp'];
            
            if (!allowedExtensions.includes(fileExt)) {
                throw new Error(`Unsupported file type: .${fileExt}. Supported types: ${allowedExtensions.join(', ')}`);
            }

            // Download the media using the message object if available
            let buffer;
            if (messageObj) {
                // Use the full message object for proper media download
                buffer = await this.client.downloadMediaMessage(messageObj);
            } else if (url) {
                // Fallback method if only URL is available
                buffer = await this.client.downloadMediaMessage({
                    key: { remoteJid: 'status@broadcast' },
                    message: { 
                        documentMessage: { 
                            url: url,
                            mimetype: this.getMimeType(fileName)
                        } 
                    }
                });
            } else {
                throw new Error('Neither message object nor URL provided for download');
            }

            if (!buffer || buffer.length === 0) {
                throw new Error('Failed to download media: Empty or invalid response');
            }

            // Security check: File size limit (50MB)
            const maxFileSize = 50 * 1024 * 1024; // 50MB
            if (buffer.length > maxFileSize) {
                throw new Error(`File size exceeds maximum allowed limit (${Math.round(maxFileSize / (1024 * 1024))}MB)`);
            }

            console.log(`✅ Successfully downloaded: ${fileName} (${Math.round(buffer.length / 1024)}KB)`);

            return {
                buffer: buffer,
                fileName: fileName,
                mimeType: this.getMimeType(fileName),
                size: buffer.length
            };

        } catch (error) {
            console.error('Error downloading document:', {
                error: error.message,
                fileName: fileName,
                hasUrl: !!url,
                hasMessageObj: !!messageObj
            });
            
            // In production, we should not fall back to mock data
            throw new Error(`Failed to download document: ${error.message}`);
        }
    }

    getMimeType(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        const mimeTypes = {
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'txt': 'text/plain'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    // Pending jobs management
    getPendingJob(sender) {
        return this.pendingJobs.get(sender);
    }

    setPendingJob(sender, job) {
        this.pendingJobs.set(sender, job);
        // Auto-remove after 5 minutes
        setTimeout(() => {
            this.pendingJobs.delete(sender);
        }, 5 * 60 * 1000);
    }

    removePendingJob(sender) {
        this.pendingJobs.delete(sender);
    }

    async monitorJobStatus(jobId, recipient) {
        const printQueue = require('../queue/printQueue');
        const checkStatus = async () => {
            try {
                const status = await printQueue.getJobStatus(jobId);
                
                if (status.state === 'completed') {
                    await this.sendMessage(recipient, 
                        `✅ Your print job is ready!\n` +
                        `Job ID: ${jobId}\n` +
                        `Please collect your prints.`
                    );
                    return;
                }

                if (status.state === 'failed') {
                    await this.sendMessage(recipient, 
                        `❌ Your print job failed.\n` +
                        `Job ID: ${jobId}\n` +
                        `Please try again or contact support.`
                    );
                    return;
                }

                // Check again in 5 seconds if still processing
                setTimeout(checkStatus, 5000);
            } catch (error) {
                console.error('Error monitoring job status:', error.message);
            }
        };

        checkStatus();
    }

    async sendMessage(to, message) {
        try {
            if (!this.client) {
                throw new Error('WhatsApp client not initialized');
            }
            await this.client.sendMessage(to, { text: message });
            return { success: true };
        } catch (error) {
            console.error('Error sending message:', error);
            throw error;
        }
    }
}

module.exports = WhatsAppClient; 