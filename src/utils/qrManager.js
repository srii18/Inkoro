/**
 * QR Manager - Handles QR code generation with timer-based lifecycle
 */
class QRManager {
    constructor(whatsappClient) {
        this.whatsappClient = whatsappClient;
        this.currentQR = null;
        this.qrGeneratedAt = null;
        this.qrTimeout = null;
        this.qrLifetime = 120000; // 120 seconds to match WhatsApp client
        this.isGenerating = false;
        this.lastQRUpdate = 0;
        this.qrUpdateDebounce = 1000; // Reduced to 1 second debounce
        
        // Listen for QR codes from WhatsApp client
        if (this.whatsappClient) {
            this.whatsappClient.on('qr', (qr) => {
                if (qr) {
                    this.handleNewQR(qr);
                }
            });
        }
    }
    
    handleNewQR(qr) {
        const now = Date.now();
        
        // Debounce rapid QR updates
        if (now - this.lastQRUpdate < this.qrUpdateDebounce) {
            console.log('QR Manager: QR update too soon, ignoring (debounced)');
            return;
        }
        
        // Only update if this is actually a new QR
        if (this.currentQR === qr) {
            console.log('QR Manager: Same QR received, ignoring');
            return;
        }
        
        console.log('QR Manager: New QR received, updating');
        this.currentQR = qr;
        this.qrGeneratedAt = now;
        this.lastQRUpdate = now;
        this.isGenerating = false;
        
        // Clear existing timeout
        if (this.qrTimeout) {
            clearTimeout(this.qrTimeout);
        }
        
        // Set new timeout
        this.qrTimeout = setTimeout(() => {
            console.log('QR Manager: QR expired after timeout');
            this.currentQR = null;
            this.qrGeneratedAt = null;
        }, this.qrLifetime);
    }
    
    async getQR() {
        // If we have a valid QR, return it
        if (this.isQRValid()) {
            console.log('QR Manager: Returning existing valid QR');
            return this.currentQR;
        }
        
        // If already generating, wait for it
        if (this.isGenerating) {
            console.log('QR Manager: QR generation in progress, waiting...');
            return this.waitForQR();
        }
        
        // Generate new QR
        console.log('QR Manager: Generating new QR');
        return this.generateNewQR();
    }
    
    isQRValid() {
        if (!this.currentQR || !this.qrGeneratedAt) {
            return false;
        }
        
        const age = Date.now() - this.qrGeneratedAt;
        return age < this.qrLifetime;
    }
    
    async generateNewQR() {
        if (this.isGenerating) {
            console.log('QR Manager: Already generating, waiting for existing process');
            return this.waitForQR();
        }
        
        this.isGenerating = true;
        console.log('QR Manager: Starting new QR generation');
        
        try {
            // Don't clear old QR immediately - keep it until new one is ready
            // This prevents flickering between old and new QR
            
            // Force WhatsApp to generate new QR
            if (this.whatsappClient && typeof this.whatsappClient.forceQR === 'function') {
                await this.whatsappClient.forceQR();
            }
            
            // Wait for QR to be generated
            const newQR = await this.waitForQR(10000); // 10 second timeout
            
            // Only update if we got a new QR
            if (newQR && newQR !== this.currentQR) {
                console.log('QR Manager: New QR received, updating');
                this.handleNewQR(newQR);
            }
            
            return newQR;
            
        } catch (error) {
            console.error('QR Manager: Error generating QR:', error);
            this.isGenerating = false;
            throw error;
        }
    }
    
    waitForQR(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkQR = () => {
                // Check if QR is available
                if (this.currentQR) {
                    resolve(this.currentQR);
                    return;
                }
                
                // Check timeout
                if (Date.now() - startTime > timeout) {
                    this.isGenerating = false;
                    reject(new Error('QR generation timeout'));
                    return;
                }
                
                // Check again in 500ms
                setTimeout(checkQR, 500);
            };
            
            checkQR();
        });
    }
    
    clearQR() {
        console.log('QR Manager: Clearing QR');
        this.currentQR = null;
        this.qrGeneratedAt = null;
        this.isGenerating = false;
        
        if (this.qrTimeout) {
            clearTimeout(this.qrTimeout);
            this.qrTimeout = null;
        }
    }
    
    getStatus() {
        return {
            hasQR: !!this.currentQR,
            isGenerating: this.isGenerating,
            qrAge: this.qrGeneratedAt ? Date.now() - this.qrGeneratedAt : null,
            qrValid: this.isQRValid()
        };
    }
}

module.exports = QRManager;
