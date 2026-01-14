const OpenAI = require('openai');

class AIAutoResponder {
    constructor() {
        const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
        const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

        if (!apiKey) {
            console.warn('⚠️ OpenAI API Key is missing. AI suggestions will use fallback responses.');
        }

        this.openai = apiKey ? new OpenAI({
            apiKey: apiKey,
            ...(baseURL ? { baseURL: baseURL } : {})
        }) : null;
    }

    async generateSuggestions(messages) {
        if (!messages || messages.length === 0) {
            return ['Hello!', 'How are you?', 'What\'s up?'];
        }

        if (!this.openai) {
            return this.getFallbackSuggestions(messages);
        }

        try {
            const systemPrompt = {
                role: 'system',
                content: `You are an AI assistant helping a user reply to messages in a chat app. 
                Based on the conversation history provided, suggest 5 concise, relevant, and helpful replies. 
                The replies should match the tone and language of the existing chat (English, Hindi, or Hinglish).
                The suggestions should be natural, casual, and directly related to the last few messages.
                Return ONLY a JSON array of 5 strings.`
            };

            const apiMessages = [systemPrompt, ...messages.map(m => ({
                role: m.role || (m.isOwn ? 'assistant' : 'user'),
                content: m.content || m.message
            }))];

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: apiMessages,
                max_tokens: 200,
                temperature: 0.7
            });

            const content = response.choices[0].message.content.trim();
            
            try {
                const match = content.match(/\[.*\]/s);
                if (match) {
                    return JSON.parse(match[0]).slice(0, 5);
                }
                return content.split('\n')
                    .map(s => s.replace(/^\d+\.\s*/, '').replace(/^["']|["']$/g, '').trim())
                    .filter(s => s.length > 0)
                    .slice(0, 5);
            } catch (e) {
                console.error('Error parsing AI content:', e);
                return content.split('\n').slice(0, 5);
            }
        } catch (error) {
            console.error('AI Suggestion generation error:', error);
            return this.getFallbackSuggestions(messages);
        }
    }

    getFallbackSuggestions(messages) {
        const lastMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';
        
        if (lastMsg.includes('hello') || lastMsg.includes('hi') || lastMsg.includes('hey')) {
            return ['Hi!', 'Hello there!', 'Hey! How are you?', 'Namaste', 'Wassup?'];
        }
        if (lastMsg.includes('how are you')) {
            return ['I am good, thanks!', 'Doing great!', 'All good here!', 'How about you?', 'I am fine'];
        }
        if (lastMsg.includes('bye') || lastMsg.includes('goodnight')) {
            return ['Goodbye!', 'Bye!', 'Take care!', 'See you later!', 'Goodnight'];
        }
        
        return ['Okay', 'Got it', 'Thanks!', 'Interesting', 'Cool'];
    }
}

module.exports = new AIAutoResponder();