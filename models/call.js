
const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
    callId: {
        type: String,
        required: true,
        unique: true
    },
    caller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    },
    type: {
        type: String,
        enum: ['audio', 'video'],
        required: true
    },
    status: {
        type: String,
        enum: ['ringing', 'connected', 'ended', 'rejected', 'missed'],
        default: 'ringing'
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: Date,
    duration: {
        type: Number, // in seconds
        default: 0
    }
}, {
    timestamps: true
});

// Calculate duration before saving
callSchema.pre('save', function(next) {
    if (this.endTime && this.startTime && this.status === 'ended') {
        this.duration = Math.floor((this.endTime - this.startTime) / 1000);
    }
    next();
});

// Get formatted duration
callSchema.virtual('formattedDuration').get(function() {
    if (!this.duration) return '00:00';
    const minutes = Math.floor(this.duration / 60);
    const seconds = this.duration % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

module.exports = mongoose.model('Call', callSchema);
