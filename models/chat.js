const mongoose = require("mongoose");
const { encrypt, decrypt, encryptMessage, decryptMessage } = require("../utils/crypto");
const { generateQuantumSafeKey } = require("../utils/quantumKey");

const chatSchema = new mongoose.Schema({
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    msg: { type: String, required: false },
    media: String,
    originalName: { type: String, default: null },
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
    created_at: { type: Date, default: Date.now },
    // New fields for delete and edit functionality
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // Array of user IDs who deleted this message for themselves
    deletedForEveryone: { type: Boolean, default: false }, // True if message is deleted for everyone
    edited: { type: Boolean, default: false },
    editedAt: { type: Date },
    // Reactions field
    reactions: [{
        emoji: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
    }],
    // Reply functionality
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", default: null },
    // Quantum key for this specific message
    quantumKey: { type: String },
    // Self-destruct field
    selfDestructAt: { type: Date, default: null }
});

chatSchema.pre('save', function (next) {
    if (this.isModified('msg') && this.msg) {
        if (!this.quantumKey) {
            this.quantumKey = generateQuantumSafeKey();
        }
        console.log(`[QuantumSafe] Encrypting message for storage with key: ${this.quantumKey.substring(0, 8)}...`);
        this.msg = encryptMessage(this.msg, this.quantumKey);
    }
    next();
});

chatSchema.methods.getDecrypted = function () {
    const obj = this.toObject();
    if (this.msg && this.quantumKey) {
        obj.msg = decryptMessage(this.msg, this.quantumKey);
    } else if (this.msg) {
        // Fallback to old decryption if no quantum key exists
        obj.msg = decrypt(this.msg);
    } else {
        obj.msg = '';
    }
    return obj;
};

// Method to check if message is deleted for a specific user
chatSchema.methods.isDeletedForUser = function(userId) {
    return this.deletedForEveryone || this.deletedFor.includes(userId);
};

const Chat = mongoose.model("Chat", chatSchema);
module.exports = Chat;
