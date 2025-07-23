const socket = io("https://ttu-meet-mvp-node.onrender.com");
// const socket = io("http://localhost:3000");


const localVideo = document.getElementById("localVideo");
const videos = document.getElementById("videos");
const logPanel = document.getElementById("logPanel");
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
const room = "test-room";

log("Getting local media...");
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
    log("Local stream ready");
    socket.emit("join", room);
  })
  .catch(err => log("Media error: " + err));

socket.on("all-users", users => {
  log("Existing users: " + users);
  users.forEach(createOfferForUser);
});

socket.on("new-user", userId => {
  log("New user joined: " + userId);
});

socket.on("offer", async ({ from, offer }) => {
  const peer = createPeerConnection(from);
  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  socket.emit("answer", { to: from, answer });
  log("Answered offer from " + from);
});

socket.on("answer", async ({ from, answer }) => {
  const peer = peers.get(from);
  await peer.setRemoteDescription(new RTCSessionDescription(answer));
  log("Answer received from " + from);
});

socket.on("ice-candidate", ({ from, candidate }) => {
  const peer = peers.get(from);
  if (peer) {
    peer.addIceCandidate(new RTCIceCandidate(candidate));
    log("ICE candidate from " + from);
  }
});

socket.on("user-left", userId => {
  log("User left: " + userId);
  const vid = document.getElementById(userId);
  if (vid) vid.remove();
  const peer = peers.get(userId);
  if (peer) peer.close();
  peers.delete(userId);
});

function createPeerConnection(userId) {
  const peer = new RTCPeerConnection(config);
  peers.set(userId, peer);

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("ice-candidate", { to: userId, candidate: e.candidate });
    }
  };

  peer.ontrack = e => {
    let vid = document.getElementById(userId);
    if (!vid) {
      vid = document.createElement("video");
      vid.id = userId;
      vid.autoplay = true;
      vid.playsInline = true;
      videos.appendChild(vid);
    }
    vid.srcObject = e.streams[0];
  };

  return peer;
}

function createOfferForUser(userId) {
  const peer = createPeerConnection(userId);
  localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
  peer.createOffer().then(offer => {
    peer.setLocalDescription(offer);
    socket.emit("offer", { to: userId, offer });
    log("Offer sent to " + userId);
  });
}

function log(msg) {
  console.log(msg);
  const entry = document.createElement("div");
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(entry);
  logPanel.scrollTop = logPanel.scrollHeight;
}