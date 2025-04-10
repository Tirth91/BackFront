// Updated script.js with Zoom-like UI enhancements and Agora data stream gesture sharing

const labelMap = [
    "1L", "1R", "2L", "2R", "3L", "3R",
    "4L", "4R", "5R", "6L", "6R", "7L", "7R",
    "8L", "8R", "9L", "9R", "A", "B", "C", "D", "L"
  ];
  const CONFIDENCE_THRESHOLD = 0.7;
  
  const predictionSpan = document.getElementById("prediction");
  
  let model;
  let dataStreamId;
  let localTrack;
  const APP_ID = "0f3fde8ae17c4048bcfc8d69286bc851";
  const CHANNEL = "gesture-room";
  const TOKEN = null;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  const video = document.getElementById("hidden-cam");
  
  async function loadModel() {
    model = await tf.loadLayersModel("landmark_model_tfjs/model.json");
    predictionSpan.textContent = "Model Loaded!";
  }
  loadModel();
  
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });
  hands.onResults(onResults);
  
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    video.play();
  
    const camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  }
  startCamera();
  
  function onResults(results) {
    let landmarks = [];
    for (let i = 0; i < 2; i++) {
      if (results.multiHandLandmarks[i]) {
        for (let lm of results.multiHandLandmarks[i]) {
          landmarks.push(lm.x, lm.y, lm.z);
        }
      } else {
        for (let j = 0; j < 21; j++) {
          landmarks.push(0, 0, 0);
        }
      }
    }
  
    while (landmarks.length < 188) landmarks.push(0.0);
    landmarks = landmarks.slice(0, 188);
  
    if (landmarks.reduce((a, b) => a + b, 0) !== 0) {
      const input = tf.tensor2d([landmarks]);
      const prediction = model.predict(input);
      prediction.array().then((probs) => {
        const values = probs[0];
        const maxProb = Math.max(...values);
        const maxIndex = values.indexOf(maxProb);
        const finalLabel = maxProb >= CONFIDENCE_THRESHOLD ? labelMap[maxIndex] : "Sign Not Recognized";
        predictionSpan.textContent = finalLabel;
        if (dataStreamId) client.sendStreamMessage(dataStreamId, finalLabel);
      });
      input.dispose();
      prediction.dispose();
    } else {
      predictionSpan.textContent = "No hand detected";
    }
  }
  
  async function joinCall() {
    await client.join(APP_ID, CHANNEL, TOKEN, null);
    localTrack = await AgoraRTC.createCameraVideoTrack();
    await localTrack.play("webcam", { mirror: false });
    await client.publish([localTrack]);
    dataStreamId = await client.createDataStream({ reliable: true, ordered: true });
  
    client.on("user-published", async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === "video") {
        const remoteDiv = document.createElement("div");
        remoteDiv.className = "video-box";
        remoteDiv.id = `remote-${user.uid}`;
  
        const videoDiv = document.createElement("div");
        videoDiv.id = `video-${user.uid}`;
        remoteDiv.appendChild(videoDiv);
  
        const labelDiv = document.createElement("div");
        labelDiv.className = "prediction-label";
        labelDiv.id = `label-${user.uid}`;
        labelDiv.innerText = `User ${user.uid}: ...`;
        remoteDiv.appendChild(labelDiv);
  
        document.getElementById("remote-container").appendChild(remoteDiv);
        user.videoTrack.play(videoDiv.id);
      }
    });
  
    client.on("user-unpublished", (user) => {
      const remoteDiv = document.getElementById(`remote-${user.uid}`);
      if (remoteDiv) remoteDiv.remove();
    });
  
    client.on("stream-message", (uid, message) => {
      const labelDiv = document.getElementById(`label-${uid}`);
      if (labelDiv) labelDiv.innerText = `User ${uid}: ${message}`;
    });
  }
  
  async function leaveCall() {
    await client.leave();
    if (localTrack) {
      localTrack.stop();
      localTrack.close();
    }
    document.getElementById("remote-container").innerHTML = "";
    predictionSpan.textContent = "Left Call";
  }