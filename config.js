module.exports = {
    port: process.env.PORT || 3000,
    storagePath: process.env.STORAGE_PATH || './storage',
    whatsappAuthPath: process.env.WHATSAPP_AUTH_PATH || './whatsapp_auth',
    dataPath: process.env.DATA_PATH || './data',
    logsPath: process.env.LOGS_PATH || './logs'
};