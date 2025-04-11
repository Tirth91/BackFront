const APP_ID = "2a25041a57024e289c67c36418eace00";
const DEFAULT_CHANNEL = "test";
const TOKEN = null;

const labelMap = ["1L","1R","2L","2R","3L","3R","4L","4R","5R","6L","6R","7L","7R","8L","8R","9L","9R","A","B","C","D","L"];
const CONFIDENCE_THRESHOLD = 0.7;
const PREDICTION_INTERVAL = 500;

const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
const videoGrid = document.getElementById("video-grid");
const status = document.getElementById("status");
const hiddenVideo = document.getElementById("hidden-cam");
const participantCount = document.getElementById("participant-count");
const leaveBtn = document.getElementById("leave-btn");
const roomIdInput = document.getElementById("room-id-input");
const errorDetails = document.getElementById("error-details");

let model, localTrack, localUid;
let participants = new Set();
let lastPredictionTime = 0;

// MediaPipe setup
const hands = new Hands({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});
hands.onResults(onResults);

async function joinCall() {
  const CHANNEL = roomIdInput.value.trim() || DEFAULT_CHANNEL;
  if (!CHANNEL) return;

  errorDetails.style.display = "none";
  status.textContent = "Loading model...";
  try {
    model = await tf.loadLayersModel("landmark_model_tfjs/model.json");
  } catch (err) {
    showError("Model load failed", err);
    return;
  }

  status.textContent = "Starting camera...";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    hiddenVideo.srcObject = stream;
  } catch (err) {
    showError("Camera access failed", err);
    return;
  }

  const cam = new Camera(hiddenVideo, {
    onFrame: async () => {
      if (Date.now() - lastPredictionTime > PREDICTION_INTERVAL) {
        await hands.send({ image: hiddenVideo });
        lastPredictionTime = Date.now();
      }
    },
    width: 640,
    height: 480
  });
  cam.start();

  status.textContent = "Joining Agora...";
  try {
    localUid = await client.join(APP_ID, CHANNEL, TOKEN, null);
    participants.add("local");
    updateParticipantCount();

    localTrack = await AgoraRTC.createCameraVideoTrack();
    createVideoBox("local", "You");
    localTrack.play("local");
    await client.publish([localTrack]);

    setupEventListeners();
    leaveBtn.disabled = false;
    roomIdInput.disabled = true;
    status.textContent = `In call: ${CHANNEL}`;
  } catch (err) {
    showError("Failed to join Agora", err);
  }
}

function setupEventListeners() {
  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") {
      const id = `remote-${user.uid}`;
      participants.add(id);
      updateParticipantCount();
      createVideoBox(id, `User ${user.uid}`);
      user.videoTrack.play(id);
    }
  });

  client.on("user-unpublished", user => {
    const id = `remote-${user.uid}`;
    participants.delete(id);
    updateParticipantCount();
    removeVideoBox(id);
  });

  client.on("user-left", user => {
    const id = `remote-${user.uid}`;
    participants.delete(id);
    updateParticipantCount();
    removeVideoBox(id);
  });
}

function onResults(results) {
  if (!model) return;

  const landmarks = [];
  for (let i = 0; i < 2; i++) {
    if (results.multiHandLandmarks[i]) {
      for (let lm of results.multiHandLandmarks[i]) {
        landmarks.push(lm.x, lm.y, lm.z);
      }
    } else {
      for (let j = 0; j < 21; j++) landmarks.push(0, 0, 0);
    }
  }

  while (landmarks.length < 188) landmarks.push(0);

  if (landmarks.some(v => v !== 0)) {
    const input = tf.tensor2d([landmarks]);
    const prediction = model.predict(input);
    prediction.array().then(data => {
      const max = Math.max(...data[0]);
      const index = data[0].indexOf(max);
      const label = max >= CONFIDENCE_THRESHOLD ? labelMap[index] : "No gesture";
      document.getElementById("label-local").textContent = `You: ${label}`;
    }).catch(console.error).finally(() => {
      input.dispose();
      prediction.dispose();
    });
  }
}

async function leaveCall() {
  try {
    await client.leave();
    if (localTrack) {
      localTrack.stop();
      localTrack.close();
    }

    const hiddenCamStream = hiddenVideo.srcObject;
    if (hiddenCamStream) {
      hiddenCamStream.getTracks().forEach(track => track.stop());
      hiddenVideo.srcObject = null;
    }

    videoGrid.innerHTML = "";
    participants.clear();
    updateParticipantCount();
    leaveBtn.disabled = true;
    roomIdInput.disabled = false;
    status.textContent = "Left call";
    errorDetails.style.display = "none";
  } catch (err) {
    showError("Failed to leave", err);
  }
}

function createVideoBox(id, name) {
  if (document.getElementById(`box-${id}`)) return;

  const box = document.createElement("div");
  box.className = "video-box";
  box.id = `box-${id}`;

  const stream = document.createElement("div");
  stream.className = "video-stream";
  stream.id = id;

  const nameLabel = document.createElement("div");
  nameLabel.className = "user-name";
  nameLabel.textContent = name;

  const predictionLabel = document.createElement("div");
  predictionLabel.className = "prediction-label";
  predictionLabel.id = `label-${id}`;
  predictionLabel.textContent = "No gesture";

  box.appendChild(stream);
  box.appendChild(nameLabel);
  box.appendChild(predictionLabel);
  videoGrid.appendChild(box);
}

function removeVideoBox(id) {
  const el = document.getElementById(`box-${id}`);
  if (el) el.remove();
}

function updateParticipantCount() {
  participantCount.textContent = `Participants: ${participants.size}`;
}

function showError(msg, err) {
  status.textContent = msg;
  errorDetails.textContent = `Error: ${err.message || err}`;
  errorDetails.style.display = "block";
  console.error(msg, err);
}

window.addEventListener("beforeunload", leaveCall);
