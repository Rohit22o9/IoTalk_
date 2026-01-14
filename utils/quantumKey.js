const crypto = require('crypto');

/**
 * Generates a strong random session key simulating post-quantum principles.
 * In a real-world scenario, this would involve lattice-based cryptography,
 * but for this utility, we ensure high entropy and standard lengths.
 * @returns {string} A hex-encoded quantum-safe style key.
 */
function generateQuantumSafeKey() {
    // We use 256 bits (32 bytes) of entropy, which is standard for 
    // post-quantum security levels in symmetric encryption.
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    generateQuantumSafeKey
};
