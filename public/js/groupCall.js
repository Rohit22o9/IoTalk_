
// Group calls are now handled by the main CallManager in call.js
// This file is kept for backward compatibility

console.log('Group calls are handled by CallManager in call.js');

// Redirect group call functions to main call manager
if (typeof window !== 'undefined') {
    window.startGroupAudioCall = function(groupId) {
        if (window.callManager) {
            window.callManager.startGroupCall(groupId, 'audio');
        }
    };

    window.startGroupVideoCall = function(groupId) {
        if (window.callManager) {
            window.callManager.startGroupCall(groupId, 'video');
        }
    };
}
