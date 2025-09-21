class InstructionParser {
    constructor() {
        this.paperTypes = ['plain', 'photo', 'glossy'];
        this.priorities = ['urgent', 'high', 'normal', 'low'];
    }

    parse(text) {
        const instructions = {
            colorPages: this.extractColorPages(text),
            paperType: this.extractPaperType(text),
            copies: this.extractCopies(text),
            priority: this.extractPriority(text),
            deadline: this.extractDeadline(text)
        };

        return instructions;
    }

    extractColorPages(text) {
        const colorPatterns = [
            /color\s+pages?\s*:?\s*(\d+(?:,\s*\d+)*)/i,
            /pages?\s*(\d+(?:,\s*\d+)*)\s+in\s+color/i,
            /color\s+on\s+pages?\s*(\d+(?:,\s*\d+)*)/i
        ];

        for (const pattern of colorPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].split(/,\s*/).map(num => parseInt(num.trim()));
            }
        }

        return [];
    }

    extractPaperType(text) {
        const textLower = text.toLowerCase();
        
        // Check for specific paper type keywords
        if (textLower.includes('photo') || textLower.includes('photographic')) {
            return 'photo';
        }
        if (textLower.includes('glossy') || textLower.includes('gloss')) {
            return 'glossy';
        }
        if (textLower.includes('plain') || textLower.includes('normal') || textLower.includes('regular')) {
            return 'plain';
        }
        
        // Default to plain paper
        return 'plain';
    }

    extractCopies(text) {
        const copyPatterns = [
            /(\d+)\s+copies?/i,
            /(\d+)\s+times/i,
            /print\s+(\d+)/i
        ];

        for (const pattern of copyPatterns) {
            const match = text.match(pattern);
            if (match) {
                const copies = parseInt(match[1]);
                // Limit copies to maximum 100
                return Math.min(Math.max(copies, 1), 100);
            }
        }

        return 1; // Default to 1 copy
    }

    extractPriority(text) {
        const textLower = text.toLowerCase();
        for (const priority of this.priorities) {
            if (textLower.includes(priority)) {
                return priority;
            }
        }
        return 'normal'; // Default priority
    }

    extractDeadline(text) {
        const deadlinePatterns = [
            /by\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
            /deadline\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
            /need\s+by\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
        ];

        for (const pattern of deadlinePatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }

        return null;
    }
}

module.exports = new InstructionParser(); 