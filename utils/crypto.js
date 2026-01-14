const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; // Must be 32 bytes
const IV_LENGTH = 16; // For AES

/**
 * Encrypts text using AES-256-CBC with a provided session key.
 * @param {string} text - The plain text to encrypt.
 * @param {string} key - The 32-byte (256-bit) session key in hex.
 * @returns {string} The encrypted text in iv:encrypted format.
 */
function encryptMessage(text, key) {
    if (!text) return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const encryptionKey = Buffer.from(key, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts text using AES-256-CBC with a provided session key.
 * @param {string} encryptedText - The text in iv:encrypted format.
 * @param {string} key - The 32-byte (256-bit) session key in hex.
 * @returns {string} The decrypted plain text.
 */
function decryptMessage(encryptedText, key) {
    try {
        if (!encryptedText || !encryptedText.includes(':')) {
            return encryptedText;
        }
        const [ivHex, encrypted] = encryptedText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decryptionKey = Buffer.from(key, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', decryptionKey, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption error:', err.message);
        return encryptedText;
    }
}

function encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
    try {
        if (!encryptedText || !encryptedText.includes(':')) {
            // Already plain text (not encrypted earlier)
            return encryptedText;
        }
        const [ivHex, encrypted] = encryptedText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption error:', err.message);
        return encryptedText; // Return original text if decryption fails
    }
}

module.exports = { 
    encrypt, 
    decrypt,
    encryptMessage,
    decryptMessage
};
