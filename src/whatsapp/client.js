const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
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
        this.qrTimeoutMs = 120000; // Increased to 2 minutes
        this.connectionStatus = 'disconnected';
        // Resolve auth folder from config (env-backed) with absolute path
        this.authFolder = path.isAbsolute(config.whatsappAuthPath)
            ? config.whatsappAuthPath
            : path.join(process.cwd(), config.whatsappAuthPath);
        this.initializeAuthFolder();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3; // Reduced from 5
        this.reconnectDelay = 30000; // Increased to 30 seconds
        this.isConnecting = false;
        this.pendingJobs = new Map();
        this.qrTimeoutHandle = null;
        this.lastReconnectAttempt = 0; // Track last reconnect attempt
        this.minReconnectInterval = 60000; // Increased to 60 seconds between attempts
        // Add per-user session state
        this.userSessions = new Map(); // { [jid]: { active: bool, timeout: NodeJS.Timeout|null } }
        this.CODE_MESSAGE = 'hi'; // code to start sequence
        this.EXIT_MESSAGE = 'exit'; // code to exit sequence
        this.SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
        this.imageBatchBuffer = new Map(); // { [jid]: { images: [], timer: NodeJS.Timeout|null } }
        this.IMAGE_BATCH_WINDOW_MS = 60 * 1000; // 1 minute
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
        // Force a fresh QR by clearing auth state and reconnecting
        try {
            if (this.client) {
                await this.disconnect();
            }
            await this.clearAuthState();
            this.connectionStatus = 'connecting';
            this.isConnecting = true;
            this.isConnected = false;
            this.emit('statusChange', this.connectionStatus);
        } catch (_) {}
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
                browser: ['Inkoro', 'Chrome', '1.0.0'],
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
                            // Do not emit null rapidly; allow frontend to explicitly
                            // request a fresh QR when needed via API.
                            this.qrCode = null;
                            this.qrTimestamp = null;
                        }
                    }, this.qrTimeoutMs + 5000);
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
                        // Clear auth state so next attempt will produce a QR
                        try { await this.clearAuthState(); } catch {}
                        this.reconnectAttempts = 0;
                        // Increase wait time for rate limiting and add exponential backoff
                        const waitTime = Math.min(60000, 30000 * Math.pow(2, this.reconnectAttempts));
                        console.log(`Waiting ${waitTime}ms before reconnecting...`);
                        setTimeout(() => this.connect(), waitTime);
                        return;
                    }
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                         this.reconnectAttempts < this.maxReconnectAttempts &&
                                         this.canAttemptReconnect();
                    if (shouldReconnect) {
                        this.reconnectAttempts++;
                        this.lastReconnectAttempt = Date.now();
                        this.connectionStatus = 'reconnecting';
                        this.emit('statusChange', this.connectionStatus);
                        setTimeout(() => this.connect(), this.reconnectDelay);
                    } else {
                        this.connectionStatus = 'disconnected';
                        this.emit('statusChange', this.connectionStatus);
                        this.isConnected = false;
                        this.isConnecting = false;
                        if (!this.canAttemptReconnect()) {
                            console.log(`Waiting ${Math.ceil((this.minReconnectInterval - (Date.now() - this.lastReconnectAttempt)) / 1000)}s before next reconnect attempt`);
                        } else {
                            this.reconnectAttempts = 0;
                        }
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

            // Add connection health check
            this.startHealthCheck();
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
                // Detach error listeners to avoid unhandled 'error' events during logout
                try {
                    const ws = this.client.ws;
                    if (ws && typeof ws.removeAllListeners === 'function') {
                        ws.removeAllListeners('error');
                    }
                } catch (_) {}

                // Only attempt logout if WS is OPEN; otherwise skip to cleanup
                try {
                    const ws = this.client.ws;
                    const OPEN = 1;
                    if (ws && ws.readyState === OPEN && typeof this.client.logout === 'function') {
                        await this.client.logout();
                    }
                } catch (e) {
                    console.warn('Logout encountered an error (ignored):', e?.message || e);
                }

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

    isReady() {
        return this.isConnected && this.connectionStatus === 'connected' && this.client;
    }

    canAttemptReconnect() {
        const now = Date.now();
        return (now - this.lastReconnectAttempt) >= this.minReconnectInterval;
    }

    async recoverConnection() {
        try {
            console.log('Attempting to recover connection...');
            if (this.client && this.connectionStatus === 'connected') {
                return true; // Already connected
            }
            
            // Try to reconnect
            await this.connect();
            return true;
        } catch (error) {
            console.error('Connection recovery failed:', error);
            return false;
        }
    }

    startHealthCheck() {
        // Check connection health every 60 seconds (reduced frequency)
        setInterval(async () => {
            try {
                if (this.client && this.connectionStatus === 'connected') {
                    // Try a simple operation to test connection
                    if (this.client.user) {
                        // Connection is healthy
                        return;
                    }
                }

                // Connection seems unhealthy, try to recover (only if not already attempting)
                if ((this.connectionStatus === 'disconnected' || this.connectionStatus === 'failed') && !this.isConnecting) {
                    console.log('Connection unhealthy, attempting recovery...');
                    await this.recoverConnection();
                }
            } catch (error) {
                console.error('Health check error:', error);
            }
        }, 60000); // 60 seconds - reduced frequency
    }

    async handleIncomingMessage(message) {
        try {
            // Check connection state before processing messages
            if (!this.isConnected || this.connectionStatus !== 'connected') {
                console.log('Skipping message processing: WhatsApp not connected');
                return;
            }
            
            const messageContent = message.message;
            if (!messageContent) return;

            // Only process personal chats
            const remoteJid = message.key.remoteJid;
            if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) {
                // Ignore group, community, or broadcast messages
                return;
            }

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
            try {
                await this.sendMessage(message.key.remoteJid, '❌ Sorry, there was an error processing your request.');
            } catch (sendError) {
                console.error('Failed to send error message to user:', sendError);
            }
        }
    }

    async handleDocumentMessage(message) {
        try {
            // Check connection state before processing
            if (!this.isConnected || this.connectionStatus !== 'connected') {
                console.log('Skipping document processing: WhatsApp not connected');
                return;
            }

            const documentManager = require('../storage/documentManager');
            const document = message.message.documentMessage;
            const fileName = document.fileName || `document_${Date.now()}.${document.mimetype ? document.mimetype.split('/').pop() : 'pdf'}`;
            const sender = message.key.remoteJid;

            console.log(`📄 Document received: ${fileName} from ${sender}`);

            // Activate session for this user
            let session = this.userSessions.get(sender);
            if (!session) {
                session = { active: false, timeout: null };
                this.userSessions.set(sender, session);
            }
            if (!session.active) {
                session.active = true;
                this.userSessions.set(sender, session);
            }
            // Reset timeout
            if (session.timeout) clearTimeout(session.timeout);
            session.timeout = setTimeout(() => {
                session.active = false;
                this.userSessions.set(sender, session);
                this.sendMessage(sender, '⏳ Session timed out. Send "hi" to start again.');
            }, this.SESSION_TIMEOUT_MS);

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

            // Store as pending job and notify dashboard via event
            this.setPendingJob(sender, pendingJob);
            this.emit('newDocument', { ...savedDoc, size: fileData.size });

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
            try {
                await this.sendMessage(
                    message.key.remoteJid,
                    `❌ Error processing document: ${error.message}\n\n` +
                    'Please try sending the file again or contact support if the problem persists.'
                );
            } catch (sendError) {
                console.error('Failed to send error message for document:', sendError);
            }
        }
    }

    async handleTextMessage(message) {
        try {
            // Check connection state before processing
            if (!this.isConnected || this.connectionStatus !== 'connected') {
                console.log('Skipping text message processing: WhatsApp not connected');
                return;
            }
            
            const instructionParser = require('../parser/instructionParser');
            const documentManager = require('../storage/documentManager');
            const printQueue = require('../print/queue');
            const text = (message.message.conversation || message.message.extendedTextMessage?.text || '').trim().toLowerCase();
            const sender = message.key.remoteJid;
            if (!text) return;
            console.log(`💬 Text message received: ${text} from ${sender}`);

            // Cancel job command
            if (text === 'cancel job') {
                try {
                    const queueInstance = require('../queue/printQueue');
                    const jobs = Array.from(queueInstance.jobs.values());
                    const userJob = jobs
                        .filter(j => (j.status === 'queued' || j.status === 'pending') && j.data && j.data.sender === sender)
                        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
                    if (userJob) {
                        await queueInstance.removeJob(userJob.id);
                        await this.sendMessage(sender, '❌ Your print job has been cancelled.');
                    } else {
                        await this.sendMessage(sender, 'No pending print job found to cancel.');
                    }
                } catch (e) {
                    console.error('Error cancelling job for user:', e);
                    await this.sendMessage(sender, '❌ Failed to cancel job. Please try again.');
                }
                return;
            }

            // Session state logic
            let session = this.userSessions.get(sender);
            if (!session) {
                session = { active: false, timeout: null };
                this.userSessions.set(sender, session);
            }
            // Always reset timeout on any message
            if (session.timeout) clearTimeout(session.timeout);
            session.timeout = setTimeout(() => {
                session.active = false;
                this.userSessions.set(sender, session);
                this.sendMessage(sender, '⏳ Session timed out. Please type "hi" to start again.');
            }, this.SESSION_TIMEOUT_MS);

            // Exit message
            if (text === this.EXIT_MESSAGE) {
                session.active = false;
                this.userSessions.set(sender, session);
                await this.sendMessage(sender, '👋 Session ended. Type "hi" to start again.');
                return;
            }

            // Check for pending job first (allows processing instructions even without active session)
            const pendingJob = this.getPendingJob(sender);
            if (pendingJob) {
                // Activate session if not already active
                if (!session.active) {
                    session.active = true;
                    this.userSessions.set(sender, session);
                }
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

                // Add job to print queue
                try {
                    const printQueue = require('../queue/printQueue');
                    const queuedJob = await printQueue.addJob(updatedJob);
                    console.log(`📋 Print job added to queue: ${queuedJob.id}`);

                    // Send confirmation with queue position
                    const queueMessage = await this.getQueueMessage(sender, queuedJob);
                    await this.sendMessage(sender,
                        `✅ Print job created!\n\n` +
                        `📄 ${updatedJob.fileName}\n` +
                        `📋 Copies: ${updatedJob.instructions.copies}\n` +
                        `📏 Paper: ${updatedJob.instructions.paperSize.toUpperCase()}\n` +
                        `🎨 Color pages: ${updatedJob.instructions.colorPages.length > 0 ? updatedJob.instructions.colorPages.join(', ') : 'None'}\n` +
                        `⏰ Priority: ${updatedJob.instructions.priority}\n\n` +
                        `🖨️ ${queueMessage}`
                    );
                } catch (queueError) {
                    console.error('Failed to add job to print queue:', queueError);
                    await this.sendMessage(sender,
                        `⚠️ Print job created but failed to add to queue: ${queueError.message}\n` +
                        `Please contact support if this issue persists.`
                    );
                }

                // Emit print job event for other components
                this.emit('printJob', updatedJob);
                // Remove from pending jobs
                this.removePendingJob(sender);
            } else {
                // Code message to start sequence
                if (!session.active) {
                    if (text === this.CODE_MESSAGE) {
                        session.active = true;
                        this.userSessions.set(sender, session);
                        // Send detailed welcome message
                        await this.sendMessage(sender, `👋 Welcome to Inkoro (your friendly photocopy optimizer)!

📄 Send me a document to print
💬 Or reply to a document with instructions like:
• "2 copies"
• "Color pages 1-3"
• "A3 paper, urgent"
• "3 copies, glossy paper"

🆘 Need help? Just ask!
Type "exit" anytime to end this session.`);
                    } else {
                        // Handle "print" command even without pending job (for testing or if job was cleared)
                        if (text.toLowerCase() === 'print') {
                            await this.sendMessage(sender, 'No document found to print. Please send a document first, then reply with "print" or specify your requirements.');
                        } else if (text === 'help') {
                            await this.sendMessage(sender, 'Tips: Send a document, then reply with instructions like "2 copies", "color pages 1-3". Type "cancel job" to cancel.');
                        }
                        // Only respond to code message, ignore other texts
                    }
                    return;
                }

                // Session is active but no pending job
                if (text === 'help') {
                    await this.sendMessage(sender, 'Tips: Send a document, then reply with instructions like "2 copies", "color pages 1-3". Type "cancel job" to cancel.');
                }
            }

            // Handle image batch grouping and preview
            if (session && session.pendingImageBatch) {
                // User is responding to image batch prompt
                const num = parseInt(text);
                if ([1,2,4,6,8,9,12,16].includes(num)) {
                    // Create a preview (simulate for now)
                    // In production, generate a real preview image and send to dashboard
                    this.emit('imageBatchPreview', { sender, images: session.pendingImageBatch, perPage: num });
                    await this.sendMessage(sender, `🖼️ Preview sent to dashboard.\nType 'print color' or 'print bw' to print in color or black & white.`);
                    session.imageBatchPerPage = num;
                    this.userSessions.set(sender, session);
                    return;
                }
                if (text === 'print color' || text === 'print bw') {
                    if (session.pendingImageBatch && session.imageBatchPerPage) {
                        // Create a print job for the batch
                        const printJob = {
                            images: session.pendingImageBatch,
                            sender: sender,
                            instructions: {
                                copies: 1,
                                paperSize: 'a4',
                                paperType: 'photo',
                                color: text === 'print color',
                                perPage: session.imageBatchPerPage,
                                priority: 'normal'
                            },
                            timestamp: new Date().toISOString()
                        };
                        // Add job to print queue
                        try {
                            const printQueue = require('../queue/printQueue');
                            const queuedJob = await printQueue.addJob(printJob);
                            console.log(`📋 Print job added to queue: ${queuedJob.id}`);
                            // Send confirmation with queue position
                            const queueMessage = await this.getQueueMessage(sender, queuedJob);
                            await this.sendMessage(sender, 
                                `✅ Print job created for ${session.pendingImageBatch.length} images (${text === 'print color' ? 'Color' : 'B&W'}).`);
                            // Emit print job event for other components
                            this.emit('printJob', printJob);
                        } catch (queueError) {
                            console.error('Failed to add job to print queue:', queueError);
                            await this.sendMessage(sender, 
                                `⚠️ Print job created but failed to add to queue: ${queueError.message}\n` +
                                `Please contact support if this issue persists.`
                            );
                        }
                        delete session.pendingImageBatch;
                        delete session.imageBatchPerPage;
                        this.userSessions.set(sender, session);
                        return;
                    }
                }
            }

        } catch (error) {
            console.error('Error handling text message:', error);
            try {
                await this.sendMessage(message.key.remoteJid, '❌ Error processing message. Please try again.');
            } catch (sendError) {
                console.error('Failed to send error message for text:', sendError);
            }
        }
    }

    async handleImageMessage(message) {
        try {
            // Check connection state before processing
            if (!this.isConnected || this.connectionStatus !== 'connected') {
                console.log('Skipping image processing: WhatsApp not connected');
                return;
            }

            const documentManager = require('../storage/documentManager');
            const image = message.message.imageMessage;
            const fileName = `image_${Date.now()}.${image.mimetype ? image.mimetype.split('/').pop() : 'jpg'}`;
            const sender = message.key.remoteJid;

            console.log(`🖼️ Image received from ${sender}`);

            // Activate session for this user
            let session = this.userSessions.get(sender);
            if (!session) {
                session = { active: false, timeout: null };
                this.userSessions.set(sender, session);
            }
            if (!session.active) {
                session.active = true;
                this.userSessions.set(sender, session);
            }
            // Reset timeout
            if (session.timeout) clearTimeout(session.timeout);
            session.timeout = setTimeout(() => {
                session.active = false;
                this.userSessions.set(sender, session);
                this.sendMessage(sender, '⏳ Session timed out. Send "hi" to start again.');
            }, this.SESSION_TIMEOUT_MS);

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
            
            // Grouping logic
            let batch = this.imageBatchBuffer.get(sender);
            if (!batch) {
                batch = { images: [], timer: null };
                this.imageBatchBuffer.set(sender, batch);
            }
            batch.images.push({
                fileId: savedDoc.fileId,
                fileName: savedDoc.originalName || fileName,
                path: savedDoc.filePath,
                timestamp: new Date().toISOString(),
                size: imageData.size
            });
            // Reset timer
            if (batch.timer) clearTimeout(batch.timer);
            batch.timer = setTimeout(async () => {
                // When timer expires, treat as a batch
                const images = batch.images;
                this.imageBatchBuffer.delete(sender);
                if (images.length > 1) {
                    // Ask user for grouping option
                    await this.sendMessage(sender,
                        `📸 You sent ${images.length} images.\nHow many images per page do you want? (1, 2, 4, 6, 8, 9, 12, 16)\nReply with a number.`
                    );
                    // Store batch in session for next step
                    let session = this.userSessions.get(sender) || { active: true };
                    session.pendingImageBatch = images;
                    this.userSessions.set(sender, session);
                } else {
                    // Single image, proceed as before
                    const printJob = {
                        fileId: images[0].fileId,
                        fileName: images[0].fileName,
                        sender: sender,
                        instructions: {
                            copies: 1,
                            paperSize: 'a4',
                            paperType: 'photo',
                            colorPages: [1],
                            priority: 'normal'
                        },
                        timestamp: images[0].timestamp,
                        fileSize: images[0].size
                    };
                    this.emit('printJob', printJob);
                    await this.sendMessage(sender,
                        `✅ Image received!\n📊 Size: ${Math.round(images[0].size / 1024)}KB\n📋 Creating photo print job...\n📄 Default: 1 copy, A4 photo paper\n💬 Reply with instructions to customize`
                    );
                }
            }, this.IMAGE_BATCH_WINDOW_MS);
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
            try {
                if (messageObj) {
                    // Use the full message object for proper media download
                    buffer = await downloadMediaMessage(messageObj, 'buffer', {});
                } else if (url) {
                    // Fallback method if only URL is available
                    buffer = await downloadMediaMessage({
                        key: { remoteJid: 'status@broadcast' },
                        message: { 
                            documentMessage: { 
                                url: url,
                                mimetype: this.getMimeType(fileName)
                            } 
                        }
                    }, 'buffer', {});
                } else {
                    throw new Error('Neither message object nor URL provided for download');
                }
            } catch (downloadError) {
                console.error('Download error details:', {
                    error: downloadError.message,
                    stack: downloadError.stack,
                    messageObj: messageObj ? 'present' : 'missing',
                    url: url || 'missing'
                });
                
                // Try alternative download method if the first one fails
                if (messageObj && messageObj.message) {
                    try {
                        // Try to extract direct URL from message
                        const message = messageObj.message;
                        let mediaUrl = null;
                        
                        if (message.documentMessage) {
                            mediaUrl = message.documentMessage.url;
                        } else if (message.imageMessage) {
                            mediaUrl = message.imageMessage.url;
                        }
                        
                        if (mediaUrl) {
                            console.log('Trying alternative download method with URL:', mediaUrl);
                            buffer = await downloadMediaMessage({
                                key: { remoteJid: 'status@broadcast' },
                                message: { 
                                    documentMessage: { 
                                        url: mediaUrl,
                                        mimetype: this.getMimeType(fileName)
                                    } 
                                }
                            }, 'buffer', {});
                        } else {
                            throw new Error('No media URL found in message');
                        }
                    } catch (altError) {
                        console.error('Alternative download method also failed:', altError.message);
                        throw new Error(`Download failed: ${downloadError.message}. Alternative method: ${altError.message}`);
                    }
                } else {
                    throw downloadError;
                }
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
        const printQueue = require('../print/queue');
        const checkStatus = async () => {
            try {
                const status = await printQueue.getJobStatus(jobId);
                if (status.status === 'completed') {
                    await this.sendMessage(recipient,
                        `✅ Your print job is ready!\n` +
                        `Job ID: ${jobId}\n` +
                        `Please collect your prints.`
                    );
                    return;
                }
                if (status.status === 'failed') {
                    await this.sendMessage(recipient,
                        `❌ Your print job failed.\n` +
                        `Job ID: ${jobId}\n` +
                        `Please try again or contact support.`
                    );
                    return;
                }
                // still processing — check again later
                setTimeout(checkStatus, 5000);
            } catch (error) {
                console.error('Error monitoring job status:', error.message);
                // try again later rather than crashing
                setTimeout(checkStatus, 5000);
            }
        };
        checkStatus();
    }

    async sendMessage(to, message) {
        try {
            if (!this.isReady()) {
                console.warn('Skipping sendMessage: WhatsApp client not ready');
                return { success: false, message: 'not ready' };
            }
            await this.client.sendMessage(to, { text: message });
            return { success: true };
        } catch (error) {
            console.error('Error sending message:', error);
            // Do not throw to avoid cascading crashes during transient disconnects
            return { success: false, error: error.message };
        }
    }

    // Helper to get queue message for a user
    async getQueueMessage(sender, job) {
        try {
            const printQueue = require('../print/queue');
            const queued = Array.from(printQueue.jobs.values())
                .filter(j => j.status === 'queued')
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const idx = queued.findIndex(j => j.id === job.id);
            if (idx === -1) return 'Your job is in the queue. ETA: unknown. Type "cancel job" to cancel.';
            const position = idx + 1;
            // Estimate ETA: assume 2 minutes per job (very rough)
            const eta = position * 2;
            return `Status: ${position === 1 ? 'Next' : 'In queue'}\nQueue position: ${position}\nETA: ${eta} minutes (approx)\nType "cancel job" to cancel your job.`;
        } catch (e) {
            return 'Your job is in the queue. ETA: unknown. Type "cancel job" to cancel.';
        }
    }

    // Listen for job status updates and notify user
    onJobStatusUpdate(jobId, status, details) {
        const printQueue = require('../print/queue');
        const job = printQueue.queue.find(j => j.id === jobId) || printQueue.completedJobs.find(j => j.id === jobId);
        if (!job || !job.sender) return;
        const sender = job.sender;
        if (status === 'completed') {
            this.sendMessage(sender, `✅ Your print job is ready!\nJob ID: ${jobId}\nPlease collect your prints.`);
        } else if (status === 'failed') {
            this.sendMessage(sender, `❌ Your print job failed.\nJob ID: ${jobId}\nPlease try again or contact support.`);
        } else if (status === 'removed' || status === 'cancelled') {
            this.sendMessage(sender, `❌ Your print job was cancelled.\nJob ID: ${jobId}`);
        }
    }
}

module.exports = WhatsAppClient; 