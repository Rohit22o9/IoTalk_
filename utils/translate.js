const axios = require('axios');

/**
 * Translates text using LibreTranslate API.
 * 
 * @param {string} text - The text to translate.
 * @param {string} targetLang - The target language code (e.g., 'en', 'hi', 'mr').
 * @param {string} sourceLang - The source language code (defaults to 'auto').
 * @returns {Promise<string>} - The translated text or original text if translation fails.
 */
async function translateText(text, targetLang, sourceLang = 'auto') {
    if (!text || text.trim() === '' || sourceLang === targetLang) {
        return text;
    }

    try {
        // Using a public instance of LibreTranslate. 
        // For production, users should host their own or use a reliable provider.
        const response = await axios.post('https://libretranslate.de/translate', {
            q: text,
            source: sourceLang,
            target: targetLang,
            format: 'text'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });

        if (response.data && response.data.translatedText) {
            return response.data.translatedText;
        }
        return text;
    } catch (error) {
        console.error('[Translation Error]:', error.message);
        return text;
    }
}

module.exports = { translateText };
