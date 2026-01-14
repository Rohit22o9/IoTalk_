
const mongoose = require("mongoose");

const communitySchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: null },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }],
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isPrivate: { type: Boolean, default: false },
    inviteCode: { type: String, unique: true },
    settings: {
        allowMemberInvites: { type: Boolean, default: true },
        allowGroupCreation: { type: Boolean, default: false }, // Only moderators can create groups by default
        requireApproval: { type: Boolean, default: false }
    },
    created_at: { type: Date, default: Date.now }
});

// Generate unique invite code before saving
communitySchema.pre('save', function(next) {
    if (!this.inviteCode) {
        this.inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    next();
});

module.exports = mongoose.model("Community", communitySchema);
