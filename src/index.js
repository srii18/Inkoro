require('dotenv').config();
const PhotocopyServer = require('./server/index');
const path = require('path');
const fs = require('fs').promises;

async function ensureDirectories() {
    const dirs = [
        path.join(__dirname, '../data'),
        path.join(__dirname, '../whatsapp_auth'),
        path.join(__dirname, '../logs')
    ];

    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`✅ Directory created/verified: ${dir}`);
        } catch (error) {
            console.error(`❌ Error creating directory ${dir}:`, error);
        }
    }
}

async function start() {
    try {
        console.log('🚀 Starting Photocopy Optimizer...');

        // Ensure required directories exist
        await ensureDirectories();

        // Initialize server
        const server = new PhotocopyServer();
        
        // Handle shutdown signals
        const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
        shutdownSignals.forEach(signal => {
            process.on(signal, async () => {
                console.log(`\n📴 Received ${signal}. Starting graceful shutdown...`);
                try {
                    await server.gracefulShutdown(signal);
                } catch (error) {
                    console.error('❌ Error during shutdown:', error);
                    process.exit(1);
                }
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('❌ Uncaught Exception:', error);
            server.gracefulShutdown('uncaughtException').catch(() => {
                process.exit(1);
            });
        });

        // Handle unhandled rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
            server.gracefulShutdown('unhandledRejection').catch(() => {
                process.exit(1);
            });
        });

        // Start the server
        await server.initialize();
        
        console.log('✅ Photocopy Optimizer started successfully');
        console.log('🌐 Web dashboard available at http://localhost:3002');

    } catch (error) {
        console.error('❌ Failed to start Photocopy Optimizer:', error);
        process.exit(1);
    }
}

// Start the application
start().catch((error) => {
    console.error('❌ Fatal error during startup:', error);
    process.exit(1);
}); 