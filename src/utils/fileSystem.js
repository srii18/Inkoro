const fs = require('fs').promises;
const path = require('path');
const config = require('../../config');

async function ensureDirectoriesExist() {
    const toAbs = (p) => (path.isAbsolute(p) ? p : path.join(process.cwd(), p));
    const dirs = [
        toAbs(config.dataPath),
        toAbs(config.whatsappAuthPath),
        toAbs(config.logsPath),
        toAbs(config.storagePath)
    ];

    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`✅ Directory created/verified: ${dir}`);
        } catch (error) {
            if (error.code !== 'EEXIST') {
                console.error(`❌ Error creating directory ${dir}:`, error);
                throw error;
            }
        }
    }
}

module.exports = {
    ensureDirectoriesExist
};