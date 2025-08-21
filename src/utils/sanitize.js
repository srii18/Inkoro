function sanitizeLog(input) {
    const str = String(input || '');
    // Remove control characters and truncate long strings for logs
    const cleaned = str.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').slice(0, 5000);
    return { summary: cleaned };
}

module.exports = { sanitizeLog };

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
