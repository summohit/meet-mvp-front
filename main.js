const socket = io("https://ttu-meet-mvp-node.onrender.com"); // Backend Socket.IO URL

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let remoteStream;
let peerConnection;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  //  iceServers : [
  //     { urls: 'stun:uatstun.tingtingu.com:3478' },
  //     {
  //       urls: 'turns:uatturn.tingtingu.com:5349?transport=udp',
  //       username: 'admin',
  //       credential: '12345'
  //     },
  //     {
  //       urls: 'turns:uatturn.tingtingu.com:5349?transport=tcp',
  //       username: 'admin',
  //       credential: '12345'
  //     }
  // ]
};

const room = "test-room";

// Initialize
logStatus('🟡 Requesting local media...');

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
    logStatus('🟢 Local media stream acquired.');
    socket.emit("join", room);
    logStatus(`📡 Joining room: ${room}`);
  })
  .catch(error => {
    logStatus(`❌ Failed to get local media: ${error.message}`);
  });

// Socket Events
socket.on("joined", () => {
  logStatus('✅ Successfully joined the room.');
  createPeerConnection();
  // localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.createOffer()
    .then(offer => {
      peerConnection.setLocalDescription(offer);
      socket.emit("offer", { room, offer });
      logStatus('📤 Sent offer to peer.');
    });
});

socket.on("offer", ({ offer }) => {
  logStatus('📥 Received offer from peer.');
  createPeerConnection();
  peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  // localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.createAnswer()
    .then(answer => {
      peerConnection.setLocalDescription(answer);
      socket.emit("answer", { room, answer });
      logStatus('📤 Sent answer to peer.');
    });
});

socket.on("answer", ({ answer }) => {
  logStatus('📥 Received answer from peer.');
  peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", ({ candidate }) => {
  if (candidate) {
    logStatus('📥 Received ICE candidate.');
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

function createPeerConnection() {
  if (peerConnection) return;

  peerConnection = new RTCPeerConnection(config);
  logStatus('🔧 PeerConnection created.');

  // 🔥 Add local tracks ONCE here
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("ice-candidate", { room, candidate: event.candidate });
      logStatus('📤 Sent ICE candidate.');
    }
  };

  peerConnection.ontrack = event => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
      logStatus('📺 Remote video stream initialized.');
    }
    remoteStream.addTrack(event.track);
    logStatus('📡 Remote track received and added.');
  };
}


// 🧠 Logger Panel
function logStatus(message) {
  console.log(message);
  const logDiv = document.getElementById('logPanel');
  if (logDiv) {
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight; // Auto-scroll
  }
}
