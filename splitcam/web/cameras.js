// Shared camera logic for index.html (web) and embed.html (Homarr widget).
//
// Page contract: for each camera N in the list below, the page provides
//   #videoN   <video> element
//   #loadingN "Connecting..." overlay
//   #statusN  status dot (gets class connecting/connected/error/disconnected)
// Buttons #connectBtn / #disconnectBtn are optional.
//
// Connects over WebRTC through nginx's /api/ proxy to go2rtc and reconnects
// automatically with exponential backoff.

const cameras = [
    { id: 1, name: 'camera1', pc: null, wanted: false, retryTimer: null, retryDelay: 0 },
    { id: 2, name: 'camera2', pc: null, wanted: false, retryTimer: null, retryDelay: 0 }
];

// Auto-reconnect: retry after a drop/failure with exponential backoff
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30000;
// A 'disconnected' WebRTC state can recover by itself; give it this long first
const DISCONNECT_GRACE_MS = 5000;

// Optional buttons: pages without them (embed.html) just skip the updates
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

function setButtons(connected) {
    if (connectBtn) connectBtn.disabled = connected;
    if (disconnectBtn) disconnectBtn.disabled = !connected;
}

function updateStatus(cameraId, message, type) {
    const statusDot = document.getElementById(`status${cameraId}`);
    statusDot.className = `status-dot ${type}`;
    statusDot.title = message;
}

function clearRetry(camera) {
    if (camera.retryTimer) {
        clearTimeout(camera.retryTimer);
        camera.retryTimer = null;
    }
}

function scheduleReconnect(camera, delay) {
    if (!camera.wanted || camera.retryTimer) return;
    const wait = delay ?? camera.retryDelay;
    console.log(`Camera ${camera.id} reconnecting in ${wait} ms`);
    camera.retryTimer = setTimeout(() => {
        camera.retryTimer = null;
        if (!camera.wanted) return;
        // Recovered on its own during the wait
        if (camera.pc && camera.pc.connectionState === 'connected') return;
        connectCamera(camera);
    }, wait);
    camera.retryDelay = Math.min(camera.retryDelay * 2, RETRY_MAX_MS);
}

async function connectCamera(camera) {
    const video = document.getElementById(`video${camera.id}`);
    const loading = document.getElementById(`loading${camera.id}`);
    let pc = null;

    clearRetry(camera);

    try {
        loading.style.display = 'block';
        updateStatus(camera.id, 'Connecting...', 'connecting');

        // Close existing connection
        if (camera.pc) {
            camera.pc.close();
        }

        // Create new peer connection
        pc = new RTCPeerConnection({
            iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
        });
        camera.pc = pc;

        // Handle incoming tracks
        pc.ontrack = (event) => {
            if (camera.pc !== pc) return; // stale connection
            console.log(`Camera ${camera.id} received track:`, event.track.kind);
            video.srcObject = event.streams[0];
            loading.style.display = 'none';
            updateStatus(camera.id, 'Connected', 'connected');

            // Ensure video plays
            video.play().catch(e => {
                console.log(`Camera ${camera.id} autoplay issue:`, e);
                // Autoplay might be blocked, but user can click play
            });
        };

        // Handle connection state
        pc.onconnectionstatechange = () => {
            if (camera.pc !== pc) return; // stale connection
            const state = pc.connectionState;
            console.log(`Camera ${camera.id} state:`, state);
            if (state === 'connected') {
                clearRetry(camera);
                camera.retryDelay = RETRY_MIN_MS;
                updateStatus(camera.id, 'Connected', 'connected');
            } else if (state === 'disconnected') {
                updateStatus(camera.id, 'Connection lost, waiting to recover...', 'connecting');
                scheduleReconnect(camera, DISCONNECT_GRACE_MS);
            } else if (state === 'failed') {
                loading.style.display = 'none';
                updateStatus(camera.id, 'Connection failed, retrying...', 'error');
                clearRetry(camera);
                scheduleReconnect(camera);
            }
        };

        // Log ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Camera ${camera.id} ICE candidate:`, event.candidate.candidate);
            }
        };

        // Add transceivers for video and audio
        pc.addTransceiver('video', {direction: 'recvonly'});
        pc.addTransceiver('audio', {direction: 'recvonly'});

        // Create and set local offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete
        if (pc.iceGatheringState !== 'complete') {
            await new Promise(resolve => {
                const checkState = () => {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                pc.addEventListener('icegatheringstatechange', checkState);
                // Timeout after 3 seconds
                setTimeout(resolve, 3000);
            });
        }

        if (camera.pc !== pc) return; // replaced or disconnected meanwhile

        // Send offer to go2rtc and get answer
        const response = await fetch(`/api/webrtc?src=${camera.name}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp'
            },
            body: pc.localDescription.sdp
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const answer = await response.text();
        if (camera.pc !== pc) return; // replaced or disconnected meanwhile
        await pc.setRemoteDescription({
            type: 'answer',
            sdp: answer
        });

        console.log(`Camera ${camera.id} connected successfully`);

    } catch (error) {
        if (pc && camera.pc !== pc) return; // stale attempt
        console.error(`Camera ${camera.id} error:`, error);
        loading.style.display = 'none';
        updateStatus(camera.id, `Error: ${error.message}, retrying...`, 'error');
        scheduleReconnect(camera);
    }
}

function disconnectCamera(camera) {
    const video = document.getElementById(`video${camera.id}`);
    const loading = document.getElementById(`loading${camera.id}`);

    camera.wanted = false;
    clearRetry(camera);
    if (camera.pc) {
        camera.pc.close();
        camera.pc = null;
    }
    video.srcObject = null;
    loading.style.display = 'none';
    updateStatus(camera.id, 'Disconnected', 'disconnected');
}

async function connectAll() {
    setButtons(true);

    for (const camera of cameras) {
        camera.wanted = true;
        camera.retryDelay = RETRY_MIN_MS;
        await connectCamera(camera);
    }
}

function disconnectAll() {
    for (const camera of cameras) {
        disconnectCamera(camera);
    }
    setButtons(false);
}

async function reconnectAll() {
    disconnectAll();
    await new Promise(resolve => setTimeout(resolve, 500));
    connectAll();
}

// Auto-connect on page load
window.addEventListener('load', () => {
    console.log('Auto-connecting cameras...');
    connectAll();
});

// Cleanup on page unload
window.addEventListener('beforeunload', disconnectAll);
