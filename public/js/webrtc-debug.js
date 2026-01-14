
// WebRTC Debugging Utilities for ModernChat
class WebRTCDebugger {
    constructor() {
        this.isEnabled = localStorage.getItem('webrtc-debug') === 'true';
        this.stats = [];
        this.logContainer = null;
        
        if (this.isEnabled) {
            this.createDebugInterface();
        }
        
        console.log('🔧 WebRTC Debugger initialized, enabled:', this.isEnabled);
    }

    enable() {
        this.isEnabled = true;
        localStorage.setItem('webrtc-debug', 'true');
        this.createDebugInterface();
        console.log('🔧 WebRTC debugging enabled');
    }

    disable() {
        this.isEnabled = false;
        localStorage.setItem('webrtc-debug', 'false');
        if (this.logContainer) {
            this.logContainer.remove();
            this.logContainer = null;
        }
        console.log('🔧 WebRTC debugging disabled');
    }

    createDebugInterface() {
        if (this.logContainer) return;

        this.logContainer = document.createElement('div');
        this.logContainer.id = 'webrtc-debug';
        this.logContainer.className = 'fixed bottom-4 left-4 w-96 h-64 bg-black bg-opacity-90 text-green-400 text-xs font-mono p-2 rounded border overflow-y-auto z-50';
        this.logContainer.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="text-white font-bold">WebRTC Debug</span>
                <button onclick="webrtcDebugger.disable()" class="text-red-400 hover:text-red-600">✕</button>
            </div>
            <div id="debug-log" class="whitespace-pre-wrap"></div>
        `;
        
        document.body.appendChild(this.logContainer);
    }

    log(message, type = 'info') {
        if (!this.isEnabled) return;

        const timestamp = new Date().toLocaleTimeString();
        const colors = {
            info: 'text-green-400',
            warning: 'text-yellow-400',
            error: 'text-red-400',
            success: 'text-blue-400'
        };

        const logMessage = `[${timestamp}] ${message}`;
        console.log(`🔧 ${logMessage}`);

        if (this.logContainer) {
            const logDiv = this.logContainer.querySelector('#debug-log');
            if (logDiv) {
                const entry = document.createElement('div');
                entry.className = colors[type] || colors.info;
                entry.textContent = logMessage;
                logDiv.appendChild(entry);
                logDiv.scrollTop = logDiv.scrollHeight;

                // Keep only last 50 entries
                while (logDiv.children.length > 50) {
                    logDiv.removeChild(logDiv.firstChild);
                }
            }
        }
    }

    async checkMediaDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
            const videoInputs = devices.filter(d => d.kind === 'videoinput');

            this.log(`📱 Media devices: ${audioInputs.length} audio inputs, ${audioOutputs.length} audio outputs, ${videoInputs.length} video inputs`);
            
            audioInputs.forEach((device, i) => {
                this.log(`🎤 Audio input ${i + 1}: ${device.label || 'Unknown'}`);
            });

            return { audioInputs, audioOutputs, videoInputs };
        } catch (error) {
            this.log(`❌ Media device enumeration failed: ${error.message}`, 'error');
            return null;
        }
    }

    async testMediaAccess(constraints = { audio: true, video: false }) {
        try {
            this.log(`🎤 Testing media access with constraints: ${JSON.stringify(constraints)}`);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            stream.getTracks().forEach(track => {
                this.log(`✅ Got ${track.kind} track: ${track.label} (enabled: ${track.enabled})`, 'success');
                track.stop();
            });

            return true;
        } catch (error) {
            this.log(`❌ Media access test failed: ${error.name} - ${error.message}`, 'error');
            return false;
        }
    }

    async testSTUNServers(servers = [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302'
    ]) {
        this.log('🧊 Testing STUN servers...');
        
        for (const server of servers) {
            try {
                const pc = new RTCPeerConnection({ iceServers: [{ urls: server }] });
                
                const testPromise = new Promise((resolve, reject) => {
                    let resolved = false;
                    
                    pc.onicecandidate = (event) => {
                        if (event.candidate && !resolved) {
                            resolved = true;
                            this.log(`✅ STUN server ${server} working`, 'success');
                            pc.close();
                            resolve(true);
                        }
                    };

                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            this.log(`❌ STUN server ${server} timeout`, 'error');
                            pc.close();
                            reject(new Error('Timeout'));
                        }
                    }, 5000);
                });

                // Create a data channel to trigger ICE gathering
                pc.createDataChannel('test');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                await testPromise;
            } catch (error) {
                this.log(`❌ STUN server ${server} failed: ${error.message}`, 'error');
            }
        }
    }

    monitorPeerConnection(pc, callId) {
        if (!this.isEnabled || !pc) return;

        this.log(`🔗 Monitoring peer connection for call ${callId}`);

        pc.onconnectionstatechange = () => {
            this.log(`🔗 Connection state: ${pc.connectionState}`);
        };

        pc.oniceconnectionstatechange = () => {
            this.log(`🧊 ICE connection state: ${pc.iceConnectionState}`);
        };

        pc.onicegatheringstatechange = () => {
            this.log(`🧊 ICE gathering state: ${pc.iceGatheringState}`);
        };

        pc.onsignalingstatechange = () => {
            this.log(`📡 Signaling state: ${pc.signalingState}`);
        };

        pc.onicecandidate = (originalHandler) => {
            return (event) => {
                if (event.candidate) {
                    const candidate = event.candidate;
                    this.log(`🧊 ICE candidate: ${candidate.candidate.split(' ')[7]} ${candidate.candidate.split(' ')[0]}`);
                } else {
                    this.log(`🧊 ICE gathering complete`);
                }
                if (originalHandler) originalHandler(event);
            };
        };

        pc.ontrack = (originalHandler) => {
            return (event) => {
                this.log(`📥 Received ${event.track.kind} track: ${event.track.label}`);
                if (originalHandler) originalHandler(event);
            };
        };

        // Monitor stats every 5 seconds during call
        const statsInterval = setInterval(async () => {
            if (pc.connectionState === 'closed') {
                clearInterval(statsInterval);
                return;
            }

            try {
                const stats = await pc.getStats();
                this.processStats(stats, callId);
            } catch (error) {
                this.log(`❌ Stats collection failed: ${error.message}`, 'error');
            }
        }, 5000);
    }

    processStats(stats, callId) {
        let audioInbound = null;
        let audioOutbound = null;

        stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                audioInbound = report;
            } else if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                audioOutbound = report;
            }
        });

        if (audioInbound) {
            this.log(`📊 Audio RX: ${audioInbound.packetsReceived} packets, ${audioInbound.bytesReceived} bytes`);
        }

        if (audioOutbound) {
            this.log(`📊 Audio TX: ${audioOutbound.packetsSent} packets, ${audioOutbound.bytesSent} bytes`);
        }
    }

    async runFullDiagnostic() {
        this.log('🔧 Starting full WebRTC diagnostic...', 'info');
        
        // Check media devices
        await this.checkMediaDevices();
        
        // Test media access
        await this.testMediaAccess();
        
        // Test STUN servers
        await this.testSTUNServers();
        
        this.log('🔧 Diagnostic complete', 'success');
    }
}

// Initialize debugger
const webrtcDebugger = new WebRTCDebugger();

// Global functions for console access
window.enableWebRTCDebug = () => webrtcDebugger.enable();
window.disableWebRTCDebug = () => webrtcDebugger.disable();
window.runWebRTCDiagnostic = () => webrtcDebugger.runFullDiagnostic();

// Integrate with call manager if available
if (typeof CallManager !== 'undefined') {
    const originalCreatePeerConnection = CallManager.prototype.createPeerConnection;
    CallManager.prototype.createPeerConnection = function() {
        const pc = originalCreatePeerConnection.call(this);
        webrtcDebugger.monitorPeerConnection(pc, this.currentCall?.callId);
        return pc;
    };
}

console.log('🔧 WebRTC Debug utilities loaded. Use enableWebRTCDebug() to start debugging.');
