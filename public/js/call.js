
// Modern WebRTC Call Manager for ModernChat
class CallManager {
    constructor() {
        this.socket = window.socket || io();
        this.localStream = null;
        this.remoteStreams = new Map(); // For multiple participants in group calls
        this.peerConnections = new Map(); // Multiple peer connections for group calls
        this.currentCall = null;
        this.callTimer = null;
        this.callStartTime = null;
        this.isInitiator = false;

        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.initializeEventListeners();
        console.log('📞 CallManager initialized');
    }

    initializeEventListeners() {
        if (!this.socket) return;
        
        // Incoming call events
        this.socket.on('incoming-call', (data) => {
            console.log('📞 Incoming one-to-one call:', data);
            if (data && data.callId && data.caller) {
                this.showIncomingCallModal(data);
            }
        });

        this.socket.on('incoming-group-call', (data) => {
            console.log('📞 Incoming group call:', data);
            if (data && data.callId && data.groupId) {
                this.showIncomingGroupCallModal(data);
            }
        });

        // WebRTC signaling
        this.socket.on('call-offer', async (data) => {
            console.log('📥 Received call offer');
            await this.handleOffer(data);
        });

        this.socket.on('call-answer', async (data) => {
            console.log('📥 Received call answer');
            await this.handleAnswer(data);
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('📥 Received ICE candidate');
            await this.handleIceCandidate(data);
        });

        this.socket.on('call-rejected', () => {
            console.log('📞 Call rejected');
            this.handleCallRejected();
        });

        this.socket.on('call-ended', () => {
            console.log('📞 Call ended');
            this.endCall();
        });

        this.socket.on('user-joined-call', (data) => {
            console.log('👥 User joined call:', data.userId);
            this.handleUserJoinedCall(data);
        });

        this.socket.on('user-left-call', (data) => {
            console.log('👥 User left call:', data.userId);
            this.handleUserLeftCall(data);
        });
    }

    // Start a one-to-one call
    async startCall(receiverId, type = 'audio') {
        try {
            console.log(`📞 Starting ${type} call to user:`, receiverId);
            
            // Get user media first
            await this.getUserMedia(type);
            
            // Initiate call on server
            const response = await fetch('/api/call/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receiverId, type })
            });

            const result = await response.json();
            if (result.success) {
                this.currentCall = {
                    callId: result.callId,
                    receiverId,
                    type,
                    isGroup: false
                };
                
                this.isInitiator = true;
                this.showOutgoingCallModal();
                
                console.log('📞 Call initiated:', result.callId);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('❌ Error starting call:', error);
            this.cleanup();
            alert('Failed to start call: ' + error.message);
        }
    }

    // Start a group call
    async startGroupCall(groupId, type = 'audio') {
        try {
            console.log(`📞 Starting ${type} group call:`, groupId);
            
            // Get user media first
            await this.getUserMedia(type);
            
            // Initiate group call on server
            const response = await fetch('/api/call/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, type })
            });

            const result = await response.json();
            if (result.success) {
                this.currentCall = {
                    callId: result.callId,
                    groupId,
                    type,
                    isGroup: true
                };
                
                this.isInitiator = true;
                this.showGroupCallModal();
                
                console.log('📞 Group call initiated:', result.callId);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('❌ Error starting group call:', error);
            this.cleanup();
            alert('Failed to start group call: ' + error.message);
        }
    }

    // Accept incoming call
    async acceptCall(callData) {
        try {
            console.log('📞 Accepting call:', callData.callId);
            
            this.currentCall = callData;
            this.isInitiator = false;
            
            // Get user media
            await this.getUserMedia(callData.type);
            
            // Create peer connection
            const peerConnection = this.createPeerConnection(callData.caller?.id || 'caller');
            
            if (callData.isGroup) {
                this.showGroupCallModal();
                this.socket.emit('join-group-call', { callId: callData.callId });
            } else {
                this.showInCallModal();
            }
            
            this.hideIncomingCallModal();
            
            console.log('✅ Call accepted');
        } catch (error) {
            console.error('❌ Error accepting call:', error);
            this.rejectCall(callData);
            alert('Failed to accept call: ' + error.message);
        }
    }

    // Reject incoming call
    rejectCall(callData) {
        console.log('📞 Rejecting call:', callData.callId);
        
        this.socket.emit('reject-call', { callId: callData.callId });
        this.hideIncomingCallModal();
        this.cleanup();
    }

    // End current call
    async endCall() {
        if (!this.currentCall) return;
        
        console.log('📞 Ending call:', this.currentCall.callId);
        
        try {
            // End call on server
            await fetch(`/api/call/${this.currentCall.callId}/end`, {
                method: 'POST'
            });
            
            // Emit end call event
            this.socket.emit('end-call', { callId: this.currentCall.callId });
        } catch (error) {
            console.error('❌ Error ending call on server:', error);
        }
        
        this.cleanup();
    }

    // Get user media
    async getUserMedia(type) {
        try {
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: type === 'video'
            };

            console.log('🎥 Getting user media with constraints:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            console.log('✅ User media obtained');
            return this.localStream;
        } catch (error) {
            console.error('❌ Error getting user media:', error);
            throw error;
        }
    }

    // Create peer connection
    createPeerConnection(participantId) {
        console.log('🔗 Creating peer connection for participant:', participantId);
        
        const peerConnection = new RTCPeerConnection(this.config);
        this.peerConnections.set(participantId, peerConnection);

        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('➕ Adding local track:', track.kind);
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log('📥 Received remote track from:', participantId);
            const remoteStream = event.streams[0];
            this.remoteStreams.set(participantId, remoteStream);
            this.displayRemoteStream(participantId, remoteStream);
            
            if (!this.callTimer) {
                this.startCallTimer();
            }
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate to:', participantId);
                this.socket.emit('ice-candidate', {
                    callId: this.currentCall.callId,
                    candidate: event.candidate
                });
            }
        };

        // Connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Connection state with', participantId, ':', peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                this.updateCallStatus('Connected');
                if (!this.callTimer) {
                    this.startCallTimer();
                }
            } else if (peerConnection.connectionState === 'failed') {
                console.error('❌ Connection failed with:', participantId);
                this.peerConnections.delete(participantId);
                this.remoteStreams.delete(participantId);
                this.removeRemoteStream(participantId);
            }
        };

        return peerConnection;
    }

    // Handle WebRTC offer
    async handleOffer(data) {
        try {
            console.log('📥 Handling offer from:', data.from);
            
            if (!this.currentCall || this.currentCall.callId !== data.callId) {
                console.warn('❌ No matching call for offer');
                return;
            }

            let peerConnection = this.peerConnections.get(data.from);
            if (!peerConnection) {
                peerConnection = this.createPeerConnection(data.from);
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.socket.emit('accept-call', {
                callId: data.callId,
                answer: answer
            });

            console.log('✅ Offer handled, answer sent');
        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    }

    // Handle WebRTC answer
    async handleAnswer(data) {
        try {
            console.log('📥 Handling answer from:', data.from);
            
            const peerConnection = this.peerConnections.get(data.from);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('✅ Answer handled');
            }
        } catch (error) {
            console.error('❌ Error handling answer:', error);
        }
    }

    // Handle ICE candidate
    async handleIceCandidate(data) {
        try {
            const peerConnection = this.peerConnections.get(data.from);
            if (peerConnection && data.candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log('✅ ICE candidate added from:', data.from);
            }
        } catch (error) {
            console.error('❌ Error handling ICE candidate:', error);
        }
    }

    // Handle user joined call (group calls)
    async handleUserJoinedCall(data) {
        if (!this.currentCall || !this.currentCall.isGroup) return;
        
        console.log('👥 User joined call:', data.userId);
        
        if (this.isInitiator) {
            // Create offer for new participant
            const peerConnection = this.createPeerConnection(data.userId);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.socket.emit('call-user', {
                callId: this.currentCall.callId,
                offer: offer
            });
        }
    }

    // Handle user left call (group calls)
    handleUserLeftCall(data) {
        console.log('👥 User left call:', data.userId);
        
        const peerConnection = this.peerConnections.get(data.userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(data.userId);
        }
        
        this.remoteStreams.delete(data.userId);
        this.removeRemoteStream(data.userId);
    }

    // Handle call rejected
    handleCallRejected() {
        console.log('📞 Call was rejected');
        alert('Call was rejected');
        this.cleanup();
    }

    // Display remote stream
    displayRemoteStream(participantId, stream) {
        console.log('🖥️ Displaying remote stream from:', participantId);
        
        const callContainer = document.getElementById('call-streams-container');
        if (!callContainer) return;

        // Remove existing stream for this participant
        this.removeRemoteStream(participantId);

        // Create video/audio element
        const mediaElement = this.currentCall.type === 'video' 
            ? document.createElement('video') 
            : document.createElement('audio');
            
        mediaElement.id = `remote-stream-${participantId}`;
        mediaElement.srcObject = stream;
        mediaElement.autoplay = true;
        mediaElement.playsInline = true;
        
        if (this.currentCall.type === 'video') {
            mediaElement.className = 'w-full h-full object-cover rounded-lg';
        } else {
            mediaElement.className = 'hidden';
        }

        // Create container for the stream
        const streamContainer = document.createElement('div');
        streamContainer.id = `stream-container-${participantId}`;
        streamContainer.className = 'relative bg-gray-900 rounded-lg overflow-hidden';
        
        if (this.currentCall.type === 'video') {
            streamContainer.className += ' aspect-video';
        }
        
        streamContainer.appendChild(mediaElement);
        callContainer.appendChild(streamContainer);

        // Update grid layout
        this.updateStreamGrid();
    }

    // Remove remote stream
    removeRemoteStream(participantId) {
        const streamContainer = document.getElementById(`stream-container-${participantId}`);
        if (streamContainer) {
            streamContainer.remove();
            this.updateStreamGrid();
        }
    }

    // Update stream grid layout
    updateStreamGrid() {
        const callContainer = document.getElementById('call-streams-container');
        if (!callContainer) return;

        const streamCount = callContainer.children.length;
        
        // Responsive grid classes based on participant count
        let gridClass = 'grid-cols-1';
        if (streamCount === 2) gridClass = 'grid-cols-2';
        else if (streamCount <= 4) gridClass = 'grid-cols-2';
        else if (streamCount <= 9) gridClass = 'grid-cols-3';
        
        callContainer.className = `grid ${gridClass} gap-4 h-full`;
    }

    // Start call timer
    startCallTimer() {
        if (this.callTimer) return;
        
        this.callStartTime = Date.now();
        this.callTimer = setInterval(() => {
            const elapsed = Date.now() - this.callStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            const timerElement = document.getElementById('call-timer');
            if (timerElement) {
                timerElement.textContent = timeStr;
            }
        }, 1000);
    }

    // Update call status
    updateCallStatus(status) {
        const statusElement = document.getElementById('call-status');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    // Toggle mute
    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                const muteBtn = document.getElementById('mute-btn');
                if (muteBtn) {
                    muteBtn.textContent = audioTrack.enabled ? '🎤' : '🔇';
                    muteBtn.className = audioTrack.enabled 
                        ? 'bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700'
                        : 'bg-red-600 text-white px-4 py-2 rounded-full hover:bg-red-700';
                }
            }
        }
    }

    // Toggle video
    toggleVideo() {
        if (this.localStream && this.currentCall.type === 'video') {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                const videoBtn = document.getElementById('video-btn');
                if (videoBtn) {
                    videoBtn.textContent = videoTrack.enabled ? '📹' : '📹';
                    videoBtn.className = videoTrack.enabled 
                        ? 'bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700'
                        : 'bg-red-600 text-white px-4 py-2 rounded-full hover:bg-red-700';
                }
                
                // Hide/show local video
                const localVideo = document.getElementById('local-video');
                if (localVideo) {
                    localVideo.style.opacity = videoTrack.enabled ? '1' : '0.3';
                }
            }
        }
    }

    // Show incoming call modal
    showIncomingCallModal(callData) {
        this.hideAllModals();
        
        const modal = document.createElement('div');
        modal.id = 'incoming-call-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <div class="text-center">
                    <div class="mb-6">
                        <img src="${callData.caller.avatar || '/avatars/default.png'}" 
                             alt="${callData.caller.username}" 
                             class="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-green-200">
                        <h3 class="text-xl font-bold text-gray-900">${callData.caller.username}</h3>
                        <p class="text-gray-600 text-sm mt-1">Incoming ${callData.type} call</p>
                    </div>
                    <div class="flex space-x-4">
                        <button onclick="callManager.rejectCall({callId: '${callData.callId}'})" 
                                class="flex-1 bg-red-500 text-white px-6 py-3 rounded-xl hover:bg-red-600 transition-colors font-semibold shadow-lg">
                            Decline
                        </button>
                        <button onclick="callManager.acceptCall({callId: '${callData.callId}', type: '${callData.type}', caller: {id: '${callData.caller.id}'}, isGroup: false})" 
                                class="flex-1 bg-green-500 text-white px-6 py-3 rounded-xl hover:bg-green-600 transition-colors font-semibold shadow-lg">
                            Accept
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Show incoming group call modal
    showIncomingGroupCallModal(callData) {
        this.hideAllModals();
        
        const modal = document.createElement('div');
        modal.id = 'incoming-group-call-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <div class="text-center">
                    <div class="mb-6">
                        <div class="w-24 h-24 bg-blue-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                            <svg class="w-12 h-12 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9 12a1 1 0 102 0V7a1 1 0 10-2 0v5zm2-7a3 3 0 11-6 0 3 3 0 016 0z"/>
                                <path d="M14 13a2 2 0 01-2-2V9a2 2 0 012-2 1 1 0 011 1v3a1 1 0 11-2 0V8a1 1 0 10-2 0v3a4 4 0 01-4 4H8a1 1 0 110-2h1a2 2 0 002-2z"/>
                            </svg>
                        </div>
                        <h3 class="text-xl font-bold text-gray-900">${callData.groupName}</h3>
                        <p class="text-gray-600 text-sm mt-1">${callData.caller.username} started a ${callData.type} call</p>
                    </div>
                    <div class="flex space-x-4">
                        <button onclick="callManager.rejectCall({callId: '${callData.callId}'})" 
                                class="flex-1 bg-red-500 text-white px-6 py-3 rounded-xl hover:bg-red-600 transition-colors font-semibold shadow-lg">
                            Decline
                        </button>
                        <button onclick="callManager.acceptCall({callId: '${callData.callId}', type: '${callData.type}', groupId: '${callData.groupId}', isGroup: true})" 
                                class="flex-1 bg-green-500 text-white px-6 py-3 rounded-xl hover:bg-green-600 transition-colors font-semibold shadow-lg">
                            Join Call
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Show outgoing call modal
    showOutgoingCallModal() {
        this.hideAllModals();
        
        const modal = document.createElement('div');
        modal.id = 'outgoing-call-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center';
        modal.innerHTML = `
            <div class="text-center text-white">
                <div class="mb-8">
                    <div class="w-32 h-32 bg-white bg-opacity-20 rounded-full mx-auto mb-4 flex items-center justify-center animate-pulse">
                        <svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"></path>
                        </svg>
                    </div>
                    <h3 class="text-2xl font-bold mb-2">Calling...</h3>
                    <p id="call-status" class="text-lg opacity-75">Connecting...</p>
                </div>
                <button onclick="callManager.endCall()" 
                        class="bg-red-600 text-white px-8 py-4 rounded-full hover:bg-red-700 transition-colors shadow-lg">
                    End Call
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    // Show in-call modal
    showInCallModal() {
        this.hideAllModals();
        
        const modal = document.createElement('div');
        modal.id = 'in-call-modal';
        modal.className = 'fixed inset-0 bg-black z-50 flex flex-col';
        
        const isVideo = this.currentCall.type === 'video';
        
        modal.innerHTML = `
            <div class="flex-1 relative">
                <!-- Call streams container -->
                <div id="call-streams-container" class="absolute inset-4 grid grid-cols-1 gap-4">
                    <!-- Remote streams will be added here -->
                </div>
                
                <!-- Local video (only for video calls) -->
                ${isVideo ? `
                <div class="absolute top-4 right-4 w-32 h-24 bg-gray-900 rounded-lg overflow-hidden border-2 border-white shadow-lg">
                    <video id="local-video" autoplay muted playsInline class="w-full h-full object-cover"></video>
                </div>
                ` : ''}
                
                <!-- Call info -->
                <div class="absolute top-4 left-4 text-white">
                    <p id="call-status" class="text-lg font-semibold">Connected</p>
                    <p id="call-timer" class="text-2xl font-mono">00:00</p>
                </div>
            </div>
            
            <!-- Call controls -->
            <div class="bg-black bg-opacity-50 p-6 flex justify-center space-x-4">
                <button id="mute-btn" onclick="callManager.toggleMute()" 
                        class="bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700 transition-colors">
                    🎤
                </button>
                ${isVideo ? `
                <button id="video-btn" onclick="callManager.toggleVideo()" 
                        class="bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700 transition-colors">
                    📹
                </button>
                ` : ''}
                <button onclick="callManager.endCall()" 
                        class="bg-red-600 text-white px-6 py-2 rounded-full hover:bg-red-700 transition-colors">
                    End Call
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Set up local video if video call
        if (isVideo && this.localStream) {
            setTimeout(() => {
                const localVideo = document.getElementById('local-video');
                if (localVideo) {
                    localVideo.srcObject = this.localStream;
                }
            }, 100);
        }
    }

    // Show group call modal
    showGroupCallModal() {
        this.hideAllModals();
        
        const modal = document.createElement('div');
        modal.id = 'group-call-modal';
        modal.className = 'fixed inset-0 bg-black z-50 flex flex-col';
        
        const isVideo = this.currentCall.type === 'video';
        
        modal.innerHTML = `
            <div class="flex-1 relative">
                <!-- Group call streams container -->
                <div id="call-streams-container" class="absolute inset-4 grid grid-cols-2 gap-4">
                    <!-- Participant streams will be added here -->
                </div>
                
                <!-- Local video (only for video calls) -->
                ${isVideo ? `
                <div class="absolute top-4 right-4 w-32 h-24 bg-gray-900 rounded-lg overflow-hidden border-2 border-white shadow-lg z-10">
                    <video id="local-video" autoplay muted playsInline class="w-full h-full object-cover"></video>
                </div>
                ` : ''}
                
                <!-- Call info -->
                <div class="absolute top-4 left-4 text-white z-10">
                    <p id="call-status" class="text-lg font-semibold">Group Call</p>
                    <p id="call-timer" class="text-xl font-mono">00:00</p>
                </div>
            </div>
            
            <!-- Call controls -->
            <div class="bg-black bg-opacity-50 p-6 flex justify-center space-x-4">
                <button id="mute-btn" onclick="callManager.toggleMute()" 
                        class="bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700 transition-colors">
                    🎤
                </button>
                ${isVideo ? `
                <button id="video-btn" onclick="callManager.toggleVideo()" 
                        class="bg-gray-600 text-white px-4 py-2 rounded-full hover:bg-gray-700 transition-colors">
                    📹
                </button>
                ` : ''}
                <button onclick="callManager.endCall()" 
                        class="bg-red-600 text-white px-6 py-2 rounded-full hover:bg-red-700 transition-colors">
                    Leave Call
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Set up local video if video call
        if (isVideo && this.localStream) {
            setTimeout(() => {
                const localVideo = document.getElementById('local-video');
                if (localVideo) {
                    localVideo.srcObject = this.localStream;
                }
            }, 100);
        }
    }

    // Hide incoming call modal
    hideIncomingCallModal() {
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();
        
        const groupModal = document.getElementById('incoming-group-call-modal');
        if (groupModal) groupModal.remove();
    }

    // Hide all modals
    hideAllModals() {
        const modals = [
            'incoming-call-modal',
            'incoming-group-call-modal', 
            'outgoing-call-modal',
            'in-call-modal',
            'group-call-modal'
        ];
        
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (modal) modal.remove();
        });
    }

    // Cleanup resources
    cleanup() {
        console.log('🧹 Cleaning up call resources');
        
        // Stop call timer
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
        
        // Close all peer connections
        this.peerConnections.forEach(pc => pc.close());
        this.peerConnections.clear();
        
        // Release media streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        this.remoteStreams.clear();
        
        // Hide all modals
        this.hideAllModals();
        
        // Reset state
        this.currentCall = null;
        this.callStartTime = null;
        this.isInitiator = false;
        
        console.log('✅ Call cleanup complete');
    }
}

// Initialize call manager when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (typeof io !== 'undefined') {
        window.callManager = new CallManager();
        console.log('📞 Global call manager ready');
    }
});

// Global helper functions
window.startAudioCall = function(receiverId) {
    if (window.callManager) {
        window.callManager.startCall(receiverId, 'audio');
    }
};

window.startVideoCall = function(receiverId) {
    if (window.callManager) {
        window.callManager.startCall(receiverId, 'video');
    }
};

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
