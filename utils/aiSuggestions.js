/**
 * Lightweight AI Suggestion Utility
 * Logic based on keywords and message patterns
 */
class AISuggestions {
    /**
     * Generate 3-5 short suggested replies based on recent messages
     * @param {Array} messages - Recent messages [{from, message}]
     * @returns {Array} suggestions - Array of strings
     */
    static generate(messages) {
        if (!messages || messages.length === 0) {
            return ["Hello!", "How's it going?", "Hey!"];
        }

        const lastMsg = messages[messages.length - 1].message.toLowerCase().trim();
        const suggestions = new Set();

        // 1. Check for Questions
        if (lastMsg.includes('?') || lastMsg.includes('kya') || lastMsg.includes('kaise')) {
            suggestions.add("Yes, definitely!");
            suggestions.add("I'm not sure yet.");
            suggestions.add("Let me check and get back to you.");
            suggestions.add("Haan, bilkul!");
        }

        // 2. Check for Greetings
        if (/^(hi|hello|hey|namaste|wassup|hii)/i.test(lastMsg)) {
            suggestions.add("Hey! How are you?");
            suggestions.add("Hello! Long time no see.");
            suggestions.add("Hi! What's up?");
            suggestions.add("Namaste! Kaise ho?");
        }

        // 3. Check for Planning / Meetups
        if (lastMsg.includes('meet') || lastMsg.includes('plan') || lastMsg.includes('chalein') || lastMsg.includes('milte')) {
            suggestions.add("Sure, let's do it!");
            suggestions.add("Sounds like a plan.");
            suggestions.add("What time works for you?");
            suggestions.add("Chalo, plan banate hain.");
        }

        // 4. Check for Thank you
        if (lastMsg.includes('thank') || lastMsg.includes('shukriya') || lastMsg.includes('dhanyawad')) {
            suggestions.add("You're welcome!");
            suggestions.add("Anytime!");
            suggestions.add("No problem.");
        }

        // 5. Default Contextual Suggestions
        if (suggestions.size < 3) {
            suggestions.add("I see.");
            suggestions.add("Interesting.");
            suggestions.add("That's great!");
            suggestions.add("Tell me more.");
        }

        // Convert to array and return up to 5
        return Array.from(suggestions).slice(0, 5);
    }
}

module.exports = AISuggestions;
