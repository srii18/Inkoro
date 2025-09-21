const printer = require('node-printer');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class PrinterManager {
    constructor() {
        this.defaultPrinter = null;
        this.availablePrinters = new Map();
        this.supportedPaperSizes = ['a4', 'a3', 'letter', 'legal'];
        this.supportedPaperTypes = ['plain', 'photo', 'glossy'];
        this.initialized = false;
        
        // Define your specific printers with their capabilities
        this.printerConfig = {
            // Color printers
            'Epson 3250': { type: 'color', brand: 'epson', model: '3250', capabilities: ['color', 'bw'] },
            'Epson 3210': { type: 'color', brand: 'epson', model: '3210', capabilities: ['color', 'bw'] },
            'Epson L500': { type: 'color', brand: 'epson', model: 'L500', capabilities: ['color', 'bw'] },
            
            // Black & White printers
            'Canon 6565': { type: 'bw', brand: 'canon', model: '6565', capabilities: ['bw'] },
            'Canon ir6000': { type: 'bw', brand: 'canon', model: 'ir6000', capabilities: ['bw'] }
        };
    }

    async initializePrinter() {
        if (this.initialized) return;
        
        try {
            // Discover all available printers
            await this.discoverPrinters();
            
            // Get the default printer name from Windows
            const { stdout } = await execPromise('wmic printer where default=true get name');
            const lines = stdout.split('\n').filter(line => line.trim());
            
            if (lines.length > 1) {
                this.defaultPrinter = lines[1].trim();
                console.log(`Default printer set to: ${this.defaultPrinter}`);
            } else {
                console.warn('No default printer found');
                // Try to use the first available configured printer
                const firstAvailable = Array.from(this.availablePrinters.keys())[0];
                this.defaultPrinter = firstAvailable || 'Microsoft Print to PDF';
                console.log(`Using fallback printer: ${this.defaultPrinter}`);
            }
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing printer:', error);
            this.defaultPrinter = 'Microsoft Print to PDF'; // Fallback to PDF printer
            console.log(`Using fallback printer: ${this.defaultPrinter}`);
            this.initialized = true;
        }
    }

    async discoverPrinters() {
        try {
            // Get all installed printers from Windows
            const { stdout } = await execPromise('wmic printer get name,status');
            const lines = stdout.split('\n').filter(line => line.trim() && !line.includes('Name'));

            const previousCount = this.availablePrinters.size;
            this.availablePrinters.clear();

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const printerName = parts.slice(0, -1).join(' ');
                    const status = parts[parts.length - 1];

                    // Check if this printer is in our configured list
                    if (this.printerConfig[printerName]) {
                        this.availablePrinters.set(printerName, {
                            ...this.printerConfig[printerName],
                            status: status.toLowerCase(),
                            available: status.toLowerCase() === 'ok' || status.toLowerCase() === 'ready'
                        });
                        console.log(`✅ Found configured printer: ${printerName} (${status})`);
                    }
                }
            }

            // Only log if the count changed or if this is the first discovery
            if (this.availablePrinters.size !== previousCount || !this.initialized) {
                console.log(`📊 Discovered ${this.availablePrinters.size} configured printers`);
            }
        } catch (error) {
            console.error('Error discovering printers:', error);
        }
    }

    async getDefaultPrinter() {
        if (!this.defaultPrinter) {
            await this.initializePrinter();
        }
        return this.defaultPrinter;
    }

    async getPrinterStatus() {
        try {
            const printerName = await this.getDefaultPrinter();
            if (!printerName) {
                return { 
                    status: 'no_printer',
                    message: 'No printer available'
                };
            }

            // Special handling for Microsoft Print to PDF
            if (printerName === 'Microsoft Print to PDF') {
                return {
                    name: printerName,
                    status: 'ready',
                    details: 'PDF printer is ready',
                    message: 'PDF printer is ready to accept jobs'
                };
            }

            // Get printer status from Windows
            const { stdout } = await execPromise(`wmic printer where name="${printerName}" get status`);
            const lines = stdout.split('\n').filter(line => line.trim());
            
            if (lines.length <= 1) {
                return {
                    name: printerName,
                    status: 'not_ready',
                    details: 'Printer not responding',
                    message: 'Printer is not responding to status check'
                };
            }

            const status = lines[1].trim().toLowerCase();
            const isReady = status === 'ready' || status === 'idle' || status === 'online';

            return {
                name: printerName,
                status: isReady ? 'ready' : 'not_ready',
                details: status,
                message: isReady ? 'Printer is ready' : `Printer status: ${status}`
            };
        } catch (error) {
            console.error('Error getting printer status:', error);
            return { 
                status: 'error', 
                error: error.message,
                message: 'Failed to get printer status'
            };
        }
    }

    async printDocument(filePath, options = {}) {
        try {
            // Select the best printer for this job
            const selectedPrinter = await this.selectBestPrinter(options);
            if (!selectedPrinter) {
                throw new Error('No suitable printer available');
            }

            console.log(`🖨️ Selected printer: ${selectedPrinter} for job`);

            // Validate options
            this.validateOptions(options);

            // Build print command
            const command = this.buildPrintCommand(filePath, options, selectedPrinter);

            // Execute print command
            const { stdout, stderr } = await execPromise(command);
            
            if (stderr) {
                throw new Error(`Print error: ${stderr}`);
            }

            return {
                success: true,
                message: `Document sent to ${selectedPrinter} successfully`,
                printer: selectedPrinter,
                command
            };
        } catch (error) {
            console.error('Print error:', error);
            throw error;
        }
    }

    async selectBestPrinter(options = {}) {
        try {
            await this.initializePrinter();
            
            const { colorPages = [], paperType = 'plain' } = options;
            const needsColor = colorPages.length > 0 || paperType === 'photo';
            
            // Filter available printers based on requirements
            const suitablePrinters = [];
            
            for (const [name, config] of this.availablePrinters.entries()) {
                if (!config.available) continue;
                
                // Check if printer can handle color requirements
                if (needsColor && !config.capabilities.includes('color')) {
                    continue;
                }
                
                suitablePrinters.push({ name, config });
            }
            
            if (suitablePrinters.length === 0) {
                console.warn('No suitable printers found, using default');
                return this.defaultPrinter;
            }
            
            // Prioritize printers based on job requirements
            if (needsColor) {
                // For color jobs, prefer Epson printers
                const epsonPrinters = suitablePrinters.filter(p => p.config.brand === 'epson');
                if (epsonPrinters.length > 0) {
                    return epsonPrinters[0].name;
                }
            } else {
                // For B&W jobs, prefer Canon printers (faster for text)
                const canonPrinters = suitablePrinters.filter(p => p.config.brand === 'canon');
                if (canonPrinters.length > 0) {
                    return canonPrinters[0].name;
                }
            }
            
            // Return first available printer
            return suitablePrinters[0].name;
            
        } catch (error) {
            console.error('Error selecting printer:', error);
            return this.defaultPrinter;
        }
    }

    async getAllPrinters() {
        await this.initializePrinter();
        return Array.from(this.availablePrinters.entries()).map(([name, config]) => ({
            name,
            ...config
        }));
    }

    validateOptions(options) {
        const { paperSize, paperType, copies, colorPages } = options;

        if (paperSize && !this.supportedPaperSizes.includes(paperSize.toLowerCase())) {
            throw new Error(`Unsupported paper size: ${paperSize}`);
        }

        if (paperType && !this.supportedPaperTypes.includes(paperType.toLowerCase())) {
            throw new Error(`Unsupported paper type: ${paperType}`);
        }

        if (copies && (copies < 1 || copies > 100)) {
            throw new Error('Invalid number of copies (1-100)');
        }

        if (colorPages && !Array.isArray(colorPages)) {
            throw new Error('Color pages must be specified as an array');
        }
    }

    buildPrintCommand(filePath, options, printerName = null) {
        const {
            copies = 1,
            paperSize = 'a4',
            paperType = 'plain',
            colorPages = [],
            priority = 'normal'
        } = options;

        const targetPrinter = printerName || this.defaultPrinter;

        // Base command for Windows
        let command = `print /d:"${targetPrinter}" "${filePath}"`;

        // Add copies
        if (copies > 1) {
            command += ` /c:${copies}`;
        }

        return command;
    }

    async getPrintJobs() {
        try {
            const printerName = await this.getDefaultPrinter();
            if (!printerName) {
                return [];
            }

            // Special handling for Microsoft Print to PDF
            if (printerName === 'Microsoft Print to PDF') {
                return [];
            }

            // Get print jobs from Windows
            const { stdout } = await execPromise(`wmic printer where name="${printerName}" get jobs`);
            return this.parsePrintJobs(stdout);
        } catch (error) {
            console.error('Error getting print jobs:', error);
            return [];
        }
    }

    parsePrintJobs(output) {
        const jobs = [];
        const lines = output.split('\n').slice(1); // Skip header

        for (const line of lines) {
            if (line.trim()) {
                const [id, status] = line.trim().split(/\s+/);
                if (id && status) {
                    jobs.push({
                        id,
                        status: status.toLowerCase()
                    });
                }
            }
        }

        return jobs;
    }

    async cancelJob(jobId) {
        try {
            const printerName = await this.getDefaultPrinter();
            if (!printerName) {
                throw new Error('No printer available');
            }

            // Special handling for Microsoft Print to PDF
            if (printerName === 'Microsoft Print to PDF') {
                return { success: true, message: 'PDF printer jobs cannot be cancelled' };
            }

            // Cancel print job in Windows
            await execPromise(`wmic printer where name="${printerName}" call canceljob ${jobId}`);
            return { success: true, message: 'Job cancelled successfully' };
        } catch (error) {
            console.error('Error cancelling print job:', error);
            throw error;
        }
    }
}

module.exports = new PrinterManager(); 