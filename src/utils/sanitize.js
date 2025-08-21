/**
 * Utility functions for sanitizing log output
 */

function sanitizeLog(input) {
    if (typeof input !== 'string') {
        input = String(input);
    }
    
    // Remove sensitive information like phone numbers, URLs, etc.
    let sanitized = input
        .replace(/\b\d{10,}\b/g, '[PHONE_NUMBER]') // Phone numbers
        .replace(/https?:\/\/[^\s]+/g, '[URL]') // URLs
        .replace(/@[^\s]+/g, '[MENTION]') // Mentions
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'); // Email addresses
    
    // Truncate very long messages
    const maxLength = 100;
    const summary = sanitized.length > maxLength 
        ? sanitized.substring(0, maxLength) + '...' 
        : sanitized;
    
    return {
        sanitized,
        summary,
        originalLength: input.length
    };
}

module.exports = {
    sanitizeLog
};
