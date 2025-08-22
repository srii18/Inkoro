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
        this.qrUpdateDebounce = 3000; // Increased to 3 seconds to prevent rapid updates
        this.pendingRequests = []; // Queue for pending QR requests
        
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
        
        // Only update if this is actually a new QR
        if (this.currentQR === qr) {
            console.log('QR Manager: Same QR received, ignoring duplicate');
            return;
        }
        
        // Debounce rapid QR updates more aggressively
        if (now - this.lastQRUpdate < this.qrUpdateDebounce) {
            console.log('QR Manager: QR update too soon, ignoring (debounced)');
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
        
        // Set new timeout with buffer time (115 seconds instead of 120)
        this.qrTimeout = setTimeout(() => {
            console.log('QR Manager: QR expired after timeout');
            this.currentQR = null;
            this.qrGeneratedAt = null;
        }, 115000); // 5 second buffer before actual expiry
        
        // Resolve any pending requests
        this.resolvePendingRequests(qr);
    }
    
    resolvePendingRequests(qr) {
        const requests = this.pendingRequests.splice(0); // Clear the array
        requests.forEach(({ resolve }) => {
            resolve(qr);
        });
    }
    
    rejectPendingRequests(error) {
        const requests = this.pendingRequests.splice(0); // Clear the array
        requests.forEach(({ reject }) => {
            reject(error);
        });
    }
    
    async getQR() {
        // If we have a valid QR with good remaining time, return it
        if (this.isQRValid() && this.getRemainingTime() > 10000) { // At least 10 seconds left
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
    
    getRemainingTime() {
        if (!this.qrGeneratedAt) return 0;
        const age = Date.now() - this.qrGeneratedAt;
        return Math.max(0, this.qrLifetime - age);
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
            // Clear old QR only when starting generation
            this.currentQR = null;
            this.qrGeneratedAt = null;
            if (this.qrTimeout) {
                clearTimeout(this.qrTimeout);
                this.qrTimeout = null;
            }
            
            // Force WhatsApp to generate new QR
            if (this.whatsappClient && typeof this.whatsappClient.forceQR === 'function') {
                await this.whatsappClient.forceQR();
            }
            
            // Wait for QR to be generated
            const newQR = await this.waitForQR(15000); // 15 second timeout
            return newQR;
            
        } catch (error) {
            console.error('QR Manager: Error generating QR:', error);
            this.isGenerating = false;
            this.rejectPendingRequests(error);
            throw error;
        }
    }
    
    waitForQR(timeout = 15000) {
        return new Promise((resolve, reject) => {
            // Add to pending requests
            this.pendingRequests.push({ resolve, reject });
            
            // Set timeout for this specific request
            const timeoutId = setTimeout(() => {
                // Remove this request from pending
                const index = this.pendingRequests.findIndex(req => req.resolve === resolve);
                if (index !== -1) {
                    this.pendingRequests.splice(index, 1);
                }
                
                this.isGenerating = false;
                reject(new Error('QR generation timeout'));
            }, timeout);
            
            // If QR is already available, resolve immediately
            if (this.currentQR) {
                clearTimeout(timeoutId);
                // Remove from pending
                const index = this.pendingRequests.findIndex(req => req.resolve === resolve);
                if (index !== -1) {
                    this.pendingRequests.splice(index, 1);
                }
                resolve(this.currentQR);
            }
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
        
        // Reject any pending requests
        this.rejectPendingRequests(new Error('QR cleared'));
    }
    
    getStatus() {
        return {
            hasQR: !!this.currentQR,
            isGenerating: this.isGenerating,
            qrAge: this.qrGeneratedAt ? Date.now() - this.qrGeneratedAt : null,
            qrValid: this.isQRValid(),
            remainingTime: this.getRemainingTime(),
            pendingRequests: this.pendingRequests.length
        };
    }
}

module.exports = QRManager;