// utils/syncpilot.js

const syncpilotTokens = new Map();

function generateToken(userId) {
    const token = Math.random().toString(36).substring(2, 10).toUpperCase();
    syncpilotTokens.set(token, {
        userId,
        expiresAt: Date.now() + 2 * 60 * 1000 // 2 minutes
    });

    setTimeout(() => {
        syncpilotTokens.delete(token);
    }, 2 * 60 * 1000);

    return token;
}

function validateToken(token) {
    const data = syncpilotTokens.get(token);
    if (!data) return null;

    if (Date.now() > data.expiresAt) {
        syncpilotTokens.delete(token);
        return null;
    }

    syncpilotTokens.delete(token); // one-time use
    return data.userId;
}

module.exports = {
    generateToken,
    validateToken
};
