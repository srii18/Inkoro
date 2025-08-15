require('dotenv').config();
const Server = require('./server');
const WhatsAppClient = require('./whatsapp/client');
const config = require('../config');
const { ensureDirectoriesExist } = require('./utils/fileSystem');

async function start() {
    try {
        console.log('🚀 Starting Photocopy Optimizer...');
        
        // Ensure required directories exist
        await ensureDirectoriesExist();
        
        // Initialize WhatsApp client but do NOT auto-connect.
        // The web dashboard's Connect button will call the API to connect.
        const whatsapp = new WhatsAppClient();

        // Initialize server with WhatsApp instance for API control
        const server = new Server(whatsapp);
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