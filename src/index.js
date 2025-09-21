require('dotenv').config();
const Server = require('./server');
const WhatsAppClient = require('./whatsapp/client');
const printQueue = require('./queue/printQueue');
const config = require('../config');
const { ensureDirectoriesExist } = require('./utils/fileSystem');

async function start() {
    try {
        console.log('🚀 Starting Photocopy Optimizer...');
        
        // Ensure required directories exist
        await ensureDirectoriesExist();
        
        // Initialize print queue (singleton)
        console.log('✅ Print queue initialized');
        
        // Initialize WhatsApp client but do NOT auto-connect.
        // The web dashboard's Connect button will call the API to connect.
        const whatsapp = new WhatsAppClient();
        
        // Note: WhatsApp client now adds jobs directly to the unified queue.
        // Avoid double-adding by not re-adding here.
        
        // Connect print queue status updates back to WhatsApp
        printQueue.on('statusUpdated', (update) => {
            if (whatsapp.onJobStatusUpdate) {
                whatsapp.onJobStatusUpdate(update.jobId, update.status, update);
            }
        });

        // Initialize server with WhatsApp instance and print queue for API control
        const server = new Server(whatsapp, printQueue);
        await server.start(config.port);
        console.log('✅ Server started successfully');

        // Graceful shutdown handler
        process.on('SIGTERM', async () => {
            console.log('Shutting down...');
            try {
                await whatsapp.disconnect();
            } catch (error) {
                console.log('Error disconnecting WhatsApp:', error.message);
            }
            process.exit(0);
        });

        console.log('✅ Photocopy Optimizer started successfully');
        console.log(`🌐 Web dashboard available at: http://localhost:${config.port}`);
        
    } catch (error) {
        console.error('❌ Failed to start Photocopy Optimizer:', error);
        process.exit(1);
    }
}

start();