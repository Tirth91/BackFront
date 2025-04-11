let client;
let localTrack;
let localUid;
let channelName;
let model;
const labelMap = ["1L", "1R", "2L", "2R", "3L", "3R", "4L", "4R", "5R", "6L", "6R", "7L", "7R", "8L", "8R", "9L", "9R", "A", "B", "C", "D", "L"];

const users = {};

async function joinCall() {
  channelName = document.getElementById("room-input").value;
  document.getElementById("room-name").innerText = channelName;

  client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  await client.join("YOUR_AGORA_APP_ID", channelName, null, null);

  localTrack = await AgoraRTC.createCameraVideoTrack();
  localUid = client.uid;

  addVideoElement(localUid, "You");

  localTrack.play(`video-${localUid}`);
  client.publish([localTrack]);

  const dataStream = await client.createDataStream();

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") {
      addVideoElement(user.uid, `User ${user.uid}`);
      user.videoTrack.play(`video-${user.uid}`);
    }
  });

  client.on("user-unpublished", (user) => {
    document.getElementById(`container-${user.uid}`)?.remove();
  });

  client.on("stream-message", (uid, message) => {
    const msg = JSON.parse(new TextDecoder().decode(message));
    if (msg.type === "gesture") {
      const gestureEl = document.getElementById(`gesture-${uid}`);
      if (gestureEl) gestureEl.innerText = `Gesture: ${msg.gesture}`;
    }
  });

  await loadModel();
  startGesturePrediction(dataStream);
}

function leaveCall() {
  client.leave();
  window.location.reload();
}

function addVideoElement(uid, name) {
  if (document.getElementById(`container-${uid}`)) return;
  const container = document.createElement("div");
  container.className = "video-box";
  container.id = `container-${uid}`;
  container.innerHTML = `
    <div><video id="video-${uid}" autoplay muted playsinline></video></div>
    <div>${name}</div>
    <div id="gesture-${uid}" class="gesture-label">Gesture: None</div>
  `;
  document.getElementById("videos").appendChild(container);
  updateUserCount();
}

function updateUserCount() {
  document.getElementById("user-count").innerText =
    document.querySelectorAll(".video-box").length;
}

async function loadModel() {
  model = await tf.loadLayersModel("landmark_model_tfjs/model.json");
}

function startGesturePrediction(dataStream) {
  const videoEl = document.createElement("video");
  videoEl.setAttribute("autoplay", "");
  videoEl.setAttribute("muted", "");
  videoEl.setAttribute("playsinline", "");
  videoEl.style.display = "none";
  document.body.appendChild(videoEl);

  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    videoEl.srcObject = stream;
    const camera = new Camera(videoEl, {
      onFrame: async () => {
        await hands.send({ image: videoEl });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  });

  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  hands.onResults((results) => {
    if (results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0]
        .map((lm) => [lm.x, lm.y, lm.z])
        .flat();
      const input = tf.tensor([landmarks]);
      const prediction = model.predict(input);
      const predictedIndex = prediction.argMax(-1).dataSync()[0];
      const gesture = labelMap[predictedIndex];

      document.getElementById(`gesture-${localUid}`).innerText = `Gesture: ${gesture}`;
      const msg = new TextEncoder().encode(
        JSON.stringify({ type: "gesture", gesture })
      );
      dataStream.send(msg);
    }
  });
}
