const socket = io("https://ttu-meet-mvp-node.onrender.com");
// const socket = io("http://localhost:3000");

// DOM elements
const authSection = document.getElementById("authSection");
const videoSection = document.getElementById("videoSection");
const localVideo = document.getElementById("localVideo");
const remoteVideos = document.getElementById("remoteVideos");
const logPanel = document.getElementById("logPanel");

// Forms
const createRoomForm = document.getElementById("createRoomForm");
const joinRoomForm = document.getElementById("joinRoomForm");

// WebRTC
const peers = new Map();
const config = {
  iceServers: [
    { urls: 'stun:uatstun.tingtingu.com:3478' },
    {
      urls: 'turns:uatturn.tingtingu.com:5349?transport=udp',
      username: 'admin',
      credential: '12345'
    },
    {
      urls: 'turns:uatturn.tingtingu.com:5349?transport=tcp',
      username: 'admin',
      credential: '12345'
    }
  ]
};

let localStream;
let currentRoom = null;
let currentUsername = null;

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupSocketListeners();
});

function setupEventListeners() {
  try {
    createRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const formData = new FormData(createRoomForm);
        const roomName = formData.get('roomName').trim();
        const username = formData.get('username').trim();
        const password = formData.get('password').trim();

        if (roomName && username && password) {
          socket.emit('create-room', { roomName, username, password });
        } else {
          showError('All fields are required');
        }
      } catch (err) {
        showError(`Create form error: ${err.message}`);
      }
    });

    joinRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const formData = new FormData(joinRoomForm);
        const roomName = formData.get('roomName').trim();
        const username = formData.get('username').trim();
        const password = formData.get('password').trim();

        if (roomName && username && password) {
          socket.emit('join-room', { roomName, username, password });
        } else {
          showError('All fields are required');
        }
      } catch (err) {
        showError(`Join form error: ${err.message}`);
      }
    });
  } catch (err) {
    showError(`Listener setup error: ${err.message}`);
  }
}

function setupSocketListeners() {
  try {
    socket.on('room-created', ({ roomName, username, message }) => {
      try {
        log(`✅ ${message}`);
        joinVideoCall(roomName, username);
      } catch (err) {
        showError(`Joining created room failed: ${err.message}`);
      }
    });

    socket.on('room-joined', ({ roomName, username, existingUsers }) => {
      try {
        log(`✅ Joined room: ${roomName} as ${username}`);
        log(`👥 Users in room: ${existingUsers.length + 1}`);
        joinVideoCall(roomName, username, existingUsers);
        
        
      } catch (err) {
        showError(`Join room error: ${err.message}`);
      }
    });

    socket.on('room-error', ({ message }) => {
      showError(message);
    });

    socket.on('user-joined', ({ socketId, username }) => {
       log(`👋 ${username} joined`);
      createOfferForUser(socketId, username);
      showSnackbar(`${username} joined this Call`);
    });

    socket.on('user-left', ({ socketId, username }) => {
      try {
        log(`👋 ${username} left`);
        cleanupPeer(socketId);
        showSnackbar(`${username} left this call`);
      } catch (err) {
        showError(`User-left cleanup error: ${err.message}`);
      }
    });

    socket.on('left-room', ({ roomName }) => {
      try {
        log(`📤 Left room: ${roomName}`);
        resetToAuth();
      } catch (err) {
        showError(`Left-room error: ${err.message}`);
      }
    });

    socket.on("offer", async ({ from, offer, username }) => {
      try {
        console.log(`📞 Received offer from ${username || 'Unknown'} (${from})`);
        log(`📞 Received offer from ${username || 'Unknown'} (${from})`);
        
        // Create peer connection with the username from the offer
        const peer = createPeerConnection(from, username || 'Unknown');
        await peer.setRemoteDescription(new RTCSessionDescription(offer));

        if (localStream) {
          localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
          });
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("answer", { to: from, answer });
        log(`📞 Answered call from ${username || 'Unknown'}`);
      } catch (error) {
        showError(`Offer error: ${error.message}`);
      }
    });

    socket.on("answer", async ({ from, answer, username }) => {
      try {
        const peer = peers.get(from);
        if (!peer) {
          console.warn(`No peer found for ${from} when receiving answer`);
          return;
        }
    
        if (peer.signalingState !== "have-local-offer") {
          console.warn(
            `⚠️ Skipping setRemoteDescription: Invalid signaling state (${peer.signalingState}) for peer ${from}`
          );
          return;
        }
    
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
    
        if (username && username !== "Unknown") {
          updatePeerUsername(from, username);
        }
    
        log(`📞 Got answer from ${username || peer.userName || "Unknown"}`);
      } catch (error) {
        showError(`Answer error: ${error.message}`);
      }
    });
    
    socket.on("ice-candidate", ({ from, candidate }) => {
      try {
        const peer = peers.get(from);
        if (peer) {
          peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        showError(`ICE candidate error: ${err.message}`);
      }
    });
    socket.on('user-count-updated', ({ count }) => {
      log(`👥 Total users in room: ${count}`);
      // updateUserCountUI(count);
      const wrapper = document.getElementById('local_video_wrapper');
      if (wrapper && count > 1) {
        wrapper.classList.remove('single-user');
      }
    });
    
  } catch (err) {
    showError(`Socket setup error: ${err.message}`);
  }
}

async function joinVideoCall(roomName, username, existingUsers = []) {
  try {
    currentRoom = roomName;
    currentUsername = username;

    log('🎥 Accessing camera & mic...');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    
    // Add local video name display
    displayLocalVideoName(username);
    
    log('✅ Local stream ready');

    authSection.style.display = 'none';
    videoSection.style.display = 'flex';

    existingUsers.forEach(user => {
      createOfferForUser(user.socketId, user.username);
    });
   
    log(`🎉 Ready in room: ${roomName}`);
  } catch (error) {
    showError(`Media error: ${error.message}`);
  }
}


function displayLocalVideoName(username) {
  try {
    const nameTag = document.getElementById("localUsername");
    nameTag.textContent = `${username} (You)`;
    nameTag.classList.add("local-video-name");
  } catch (error) {
    console.log(error);
  }
}

function createPeerConnection(userId, userName) {
  console.log("============>", `Creating peer connection for ${userName || 'Unknown'} (${userId})`);
  const peer = new RTCPeerConnection(config);
  peers.set(userId, peer);
  peer.userName = userName || 'Unknown';
  peer.userId = userId; // Store userId for reference

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { to: userId, candidate: event.candidate });
    }
  };

  peer.ontrack = (event) => {
    try {
      const name = peer.userName || `Unknown-${userId}`;
      console.log(`📺 ontrack event for ${name} (${userId})`);

      log('📺 Received remote stream from', name);
      const existingWrapper = document.getElementById(`user-wrapper-${userId}`);
      if (!existingWrapper) {
        const wrapper = document.createElement("div");
        wrapper.id = `user-wrapper-${userId}`;
        wrapper.classList.add("remote-video-wrapper");
        wrapper.style.position = 'relative';

        const nameTag = document.createElement("div");
        nameTag.textContent = name;
        nameTag.classList.add("remote-video-name");
    
        const video = document.createElement("video");
        video.id = `video-${userId}`;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = "250px";
        video.style.height = "200px";
        video.style.border = "1px solid #ccc";
        video.style.borderRadius = "8px";
        video.srcObject = event.streams[0];

        wrapper.appendChild(video);
        wrapper.appendChild(nameTag);
        remoteVideos.appendChild(wrapper);
        
        console.log(`Created video wrapper for ${name}`);
      } else {
        const video = document.getElementById(`video-${userId}`);
        const nameTag = existingWrapper.querySelector('.remote-video-name');
        if (video) {
          video.srcObject = event.streams[0];
          console.log(`Updated video stream for ${name}`);
        }
        if (nameTag && name !== `Unknown-${userId}`) {
          nameTag.textContent = name;
          console.log(`Updated name tag to: ${name}`);
        }
      }
    } catch (err) {
      showError(`Track handling error: ${err.message}`);
    }
  };

  peer.onconnectionstatechange = () => {
    log(`🔗 Connection with ${peer.userName}: ${peer.connectionState}`);
    if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      cleanupPeer(userId);
    }
  };

  return peer;
}

function updatePeerUsername(userId, newUsername) {
  const peer = peers.get(userId);
  if (peer && newUsername && newUsername !== 'Unknown') {
    console.log(`Updating peer ${userId} username from "${peer.userName}" to "${newUsername}"`);
    peer.userName = newUsername;
    
    // Update the name tag in the UI
    const wrapper = document.getElementById(`user-wrapper-${userId}`);
    if (wrapper) {
      const nameTag = wrapper.querySelector('.remote-video-name');
      if (nameTag) {
        nameTag.textContent = newUsername;
        console.log(`Updated UI name tag to: ${newUsername}`);
      }
    }
  }
}

async function createOfferForUser(userId, userName) {
  try {
    console.log(`Creating offer for user: ${userName || 'Unknown'} (${userId})`);
    const peer = createPeerConnection(userId, userName);

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
      });
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("offer", { to: userId, offer, username: currentUsername });

    log(`📞 Sent offer to ${userName || 'Unknown'}`);
  } catch (error) {
    showError(`Offer error: ${error.message}`);
  }
}

function cleanupPeer(userId) {
  try {
    const peer = peers.get(userId);
    if (peer) peer.close();
    peers.delete(userId);

    const wrapper = document.getElementById(`user-wrapper-${userId}`);
    if (wrapper) wrapper.remove();
  } catch (err) {
    showError(`Cleanup error: ${err.message}`);
  }
}

function resetToAuth() {
  try {
    // Cleanup local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Cleanup all peer connections
    peers.forEach(peer => peer.close());
    peers.clear();

    // Remove all remote video elements
    remoteVideos.innerHTML = '';

    // Remove local video name tag
    const localNameTag = document.querySelector('.local-video-name');
    if (localNameTag) {
      localNameTag.remove();
    }

    currentRoom = null;
    currentUsername = null;
    createRoomForm.reset();
    joinRoomForm.reset();
    authSection.style.display = 'block';
    videoSection.style.display = 'none';
  } catch (err) {
    showError(`Reset error: ${err.message}`);
  }
}

function showError(message) {
  log(`❌ ${message}`);
  alert(message);
}

function log(message) {
  console.log(message);
  // Enable below for visible UI logs
  // const timestamp = new Date().toLocaleTimeString();
  // const logEntry = document.createElement("div");
  // logEntry.innerHTML = `<span style="color: #888;">${timestamp}</span> ${message}`;
  // logPanel.appendChild(logEntry);
  // logPanel.scrollTop = logPanel.scrollHeight;
}

function switchTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  // Update forms
  document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
  if (tab === 'create') {
      document.getElementById('createRoomForm').classList.add('active');
  } else {
      document.getElementById('joinRoomForm').classList.add('active');
  }
}

function showSnackbar(message, icon = '') {
  // debugger;
  const container = document.getElementById('snackbar-container');

  const snackbar = document.createElement('div');
  snackbar.className = 'snackbar';
  let imrUrl = './assets/img/user.png';
  snackbar.innerHTML = `<img  src="${imrUrl}"> <span>${message}</span>`;
  container.appendChild(snackbar);

  // Remove after animation completes (~3.3s)
  setTimeout(() => {
    snackbar.remove();
  }, 14500);
}
