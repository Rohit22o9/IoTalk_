
const fs = require('fs');
const path = require('path');

class AIModeration {
    constructor() {
        // Load local profanity and toxic words lists
        this.loadLocalModels();
        
        // Severity levels
        this.severityLevels = {
            LOW: 1,
            MEDIUM: 2,
            HIGH: 3,
            CRITICAL: 4
        };
    }

    loadLocalModels() {
        // Profanity words (you can expand this list)
        this.profanityWords = [
            'fuck', 'shit', 'bitch', 'damn', 'hell', 'ass', 'bastard',
            'crap', 'piss', 'whore', 'slut', 'cocksucker', 'motherfucker'
        ];

        // Toxic patterns
        this.toxicPatterns = [
            // Threats
            /\b(kill|murder|die|death|hurt|harm|violence)\b.*\b(you|yourself|him|her|them)\b/i,
            /\bi\s+(will|gonna|going\s+to)\s+(kill|hurt|harm|destroy)\b/i,
            
            // Harassment
            /\b(stupid|idiot|moron|retard|loser|pathetic)\b/i,
            /\b(go\s+to\s+hell|fuck\s+off|shut\s+up)\b/i,
            
            // Hate speech
            /\b(racist|sexist|homophobic|transphobic)\b/i,
            /\b(hate|despise|disgusted)\s+by\s+(you|your|people|like|you)\b/i,
            
            // Spam patterns
            /(.)\1{10,}/i, // Repeated characters
            /\b(buy\s+now|click\s+here|free\s+money|earn\s+\$\d+)\b/i,
            
            // NSFW content
            /\b(nude|naked|sex|porn|adult|xxx)\b/i
        ];

        // Positive words for sentiment analysis
        this.positiveWords = [
            'good', 'great', 'awesome', 'amazing', 'wonderful', 'fantastic',
            'excellent', 'perfect', 'love', 'like', 'happy', 'joy', 'pleased',
            'satisfied', 'thankful', 'grateful', 'appreciate', 'brilliant'
        ];

        // Negative words for sentiment analysis
        this.negativeWords = [
            'bad', 'terrible', 'awful', 'horrible', 'disgusting', 'hate',
            'dislike', 'angry', 'mad', 'furious', 'disappointed', 'sad',
            'depressed', 'upset', 'annoyed', 'frustrated', 'worried'
        ];
    }

    // Main text moderation function
    async moderateText(text) {
        if (!text || text.trim().length === 0) {
            return { flagged: false, severity: 0, reasons: [] };
        }

        const results = {
            flagged: false,
            severity: 0,
            reasons: [],
            categories: {},
            confidence: 0
        };

        const lowerText = text.toLowerCase();

        // Check for profanity
        const profanityCheck = this.checkProfanity(lowerText);
        if (profanityCheck.found) {
            results.flagged = true;
            results.reasons.push('profanity');
            results.categories.profanity = true;
            results.severity = Math.max(results.severity, this.severityLevels.MEDIUM);
        }

        // Check for toxic patterns
        const toxicityCheck = this.checkToxicity(text);
        if (toxicityCheck.found) {
            results.flagged = true;
            results.reasons.push('toxicity');
            results.categories.toxicity = true;
            results.severity = Math.max(results.severity, toxicityCheck.severity);
        }

        // Check for spam
        const spamCheck = this.checkSpam(text);
        if (spamCheck.found) {
            results.flagged = true;
            results.reasons.push('spam');
            results.categories.spam = true;
            results.severity = Math.max(results.severity, this.severityLevels.LOW);
        }

        // Check for excessive caps (shouting)
        const capsCheck = this.checkExcessiveCaps(text);
        if (capsCheck.found) {
            results.flagged = true;
            results.reasons.push('excessive_caps');
            results.categories.excessive_caps = true;
            results.severity = Math.max(results.severity, this.severityLevels.LOW);
        }

        // Calculate confidence based on number of violations
        results.confidence = Math.min(results.reasons.length * 0.3, 0.95);

        return results;
    }

    checkProfanity(text) {
        const found = this.profanityWords.some(word => 
            text.includes(word) || this.fuzzyMatch(text, word)
        );
        return { found, count: this.profanityWords.filter(word => text.includes(word)).length };
    }

    checkToxicity(text) {
        let severity = 0;
        let found = false;

        for (const pattern of this.toxicPatterns) {
            if (pattern.test(text)) {
                found = true;
                // Different patterns have different severities
                if (text.match(/\b(kill|murder|die|death)\b/i)) {
                    severity = this.severityLevels.CRITICAL;
                } else if (text.match(/\b(hate|despise)\b/i)) {
                    severity = this.severityLevels.HIGH;
                } else {
                    severity = this.severityLevels.MEDIUM;
                }
                break;
            }
        }

        return { found, severity };
    }

    checkSpam(text) {
        // Check for repeated characters
        const repeatedChars = /(.)\1{5,}/i.test(text);
        
        // Check for repeated words
        const words = text.split(/\s+/);
        const wordCounts = {};
        words.forEach(word => {
            wordCounts[word.toLowerCase()] = (wordCounts[word.toLowerCase()] || 0) + 1;
        });
        const repeatedWords = Object.values(wordCounts).some(count => count > 3);

        // Check for promotional content
        const promotional = /\b(buy\s+now|click\s+here|free\s+money|earn\s+\$\d+)\b/i.test(text);

        // Check message length vs content ratio
        const lengthSpam = text.length > 500 && words.length < 20;

        const found = repeatedChars || repeatedWords || promotional || lengthSpam;
        return { found };
    }

    checkExcessiveCaps(text) {
        if (text.length < 10) return { found: false };
        
        const capsCount = (text.match(/[A-Z]/g) || []).length;
        const capsRatio = capsCount / text.length;
        
        return { found: capsRatio > 0.6 };
    }

    // Fuzzy matching for common character substitutions
    fuzzyMatch(text, word) {
        const substitutions = {
            'a': ['@', '4'],
            'e': ['3'],
            'i': ['1', '!'],
            'o': ['0'],
            's': ['$', '5'],
            'u': ['v']
        };

        let fuzzyWord = word;
        for (const [letter, subs] of Object.entries(substitutions)) {
            for (const sub of subs) {
                fuzzyWord = fuzzyWord.replace(new RegExp(letter, 'g'), `[${letter}${sub}]`);
            }
        }

        return new RegExp(fuzzyWord, 'i').test(text);
    }

    // Sentiment analysis
    analyzeSentiment(text) {
        const words = text.toLowerCase().split(/\s+/);
        const positiveCount = words.filter(word => this.positiveWords.includes(word)).length;
        const negativeCount = words.filter(word => this.negativeWords.includes(word)).length;

        let sentiment = 'neutral';
        let score = 0;

        if (positiveCount > negativeCount) {
            sentiment = 'positive';
            score = (positiveCount - negativeCount) / words.length;
        } else if (negativeCount > positiveCount) {
            sentiment = 'negative';
            score = (negativeCount - positiveCount) / words.length;
        }

        return { sentiment, score, positiveCount, negativeCount };
    }

    // Media content moderation (basic file type and size checking)
    async moderateMedia(mediaPath, mediaType) {
        try {
            if (!fs.existsSync(mediaPath)) {
                return { flagged: true, reason: 'file_not_found' };
            }

            const stats = fs.statSync(mediaPath);
            const fileSize = stats.size;
            const maxSize = 50 * 1024 * 1024; // 50MB limit

            // Check file size
            if (fileSize > maxSize) {
                return { flagged: true, reason: 'file_too_large', size: fileSize };
            }

            // Check file extension
            const ext = path.extname(mediaPath).toLowerCase();
            const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.pdf', '.doc', '.docx'];
            
            if (!allowedExtensions.includes(ext)) {
                return { flagged: true, reason: 'unsupported_file_type', extension: ext };
            }

            // Basic filename check for suspicious patterns
            const filename = path.basename(mediaPath);
            const suspiciousPatterns = [
                /\b(virus|malware|trojan|hack|exploit)\b/i,
                /\.(exe|bat|cmd|scr|vbs|js|jar)$/i
            ];

            const suspicious = suspiciousPatterns.some(pattern => pattern.test(filename));
            if (suspicious) {
                return { flagged: true, reason: 'suspicious_filename', filename };
            }

            return { flagged: false, size: fileSize, type: mediaType };
        } catch (error) {
            console.error('Media moderation error:', error);
            return { flagged: true, reason: 'moderation_error' };
        }
    }

    // Generate moderation notice message
    generateModerationNotice(moderationResult) {
        if (!moderationResult.flagged) return null;

        const reasons = moderationResult.reasons || [];
        let message = '⚠️ Message was automatically moderated';

        if (reasons.length > 0) {
            const reasonText = reasons.map(reason => {
                switch (reason) {
                    case 'profanity': return 'inappropriate language';
                    case 'toxicity': return 'toxic content';
                    case 'spam': return 'spam-like behavior';
                    case 'excessive_caps': return 'excessive capitalization';
                    default: return reason.replace(/_/g, ' ');
                }
            }).join(', ');

            message += ` due to ${reasonText}`;
        }

        message += '. Please keep conversations respectful and appropriate.';

        // Add severity-based additional message
        if (moderationResult.severity >= this.severityLevels.HIGH) {
            message += ' Continued violations may result in restrictions.';
        }

        return message;
    }

    // Check if user should be warned/restricted based on violation history
    shouldRestrictUser(violationHistory) {
        const recentViolations = violationHistory.filter(v => 
            Date.now() - v.timestamp < 24 * 60 * 60 * 1000 // Last 24 hours
        );

        const criticalViolations = recentViolations.filter(v => v.severity >= this.severityLevels.CRITICAL);
        const highViolations = recentViolations.filter(v => v.severity >= this.severityLevels.HIGH);

        // Immediate restriction for critical violations
        if (criticalViolations.length >= 1) {
            return { restrict: true, duration: 24 * 60 * 60 * 1000, reason: 'critical_violation' };
        }

        // Restriction for multiple high violations
        if (highViolations.length >= 3) {
            return { restrict: true, duration: 12 * 60 * 60 * 1000, reason: 'multiple_high_violations' };
        }

        // Restriction for many violations
        if (recentViolations.length >= 5) {
            return { restrict: true, duration: 6 * 60 * 60 * 1000, reason: 'excessive_violations' };
        }

        return { restrict: false };
    }
}

module.exports = new AIModeration();
