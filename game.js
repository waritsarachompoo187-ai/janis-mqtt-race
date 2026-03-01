const BROKER = 'wss://test.mosquitto.org:8081';
const TOPIC_BASE = 'oracle/race/janis';
const PLAYER_ID = 'p_' + Math.random().toString(36).substr(2, 6);

let mqttClient;
let myName = '';
let myProgress = 0;
let isStarted = false;
let isFinished = false;
let startTime = 0;
let hallOfFame = [];

const players = {}; // { id: { name, progress, lastSeen } }

// --- DOM Elements ---
const joinScreen = document.getElementById('join-screen');
const gameArena = document.getElementById('game-arena');
const tracksContainer = document.getElementById('racing-tracks');
const timerDisplay = document.getElementById('game-timer');
const leaderboard = document.getElementById('leaderboard');
const winScreen = document.getElementById('win-screen');

// --- Initialization ---
document.getElementById('start-btn').onclick = startJoin;

function startJoin() {
    myName = document.getElementById('player-name').value.trim() || 'Anonymous Oracle';
    joinScreen.classList.add('hidden');
    gameArena.classList.remove('hidden');
    initMQTT();
}

function initMQTT() {
    mqttClient = mqtt.connect(BROKER, {
        keepalive: 30,
        clientId: PLAYER_ID,
        will: {
            topic: `${TOPIC_BASE}/leave`,
            payload: JSON.stringify({ id: PLAYER_ID }),
            qos: 0,
            retain: false
        }
    });

    mqttClient.on('connect', () => {
        console.log('Connected to Oracle Network');
        mqttClient.subscribe(`${TOPIC_BASE}/join`);
        mqttClient.subscribe(`${TOPIC_BASE}/state/+`);
        mqttClient.subscribe(`${TOPIC_BASE}/leave`);
        mqttClient.subscribe(`${TOPIC_BASE}/hall-of-fame`);

        // Announce Arrival
        mqttClient.publish(`${TOPIC_BASE}/join`, JSON.stringify({ id: PLAYER_ID, name: myName }));
    });

    mqttClient.on('message', (topic, message) => {
        const data = JSON.parse(message.toString());

        if (topic.includes('state')) {
            updatePlayerState(data);
        } else if (topic.includes('join')) {
            if (data.id !== PLAYER_ID) syncJoin(data);
        } else if (topic.includes('leave')) {
            removePlayer(data.id);
        } else if (topic.includes('hall-of-fame')) {
            updateLeaderboard(data);
        }
    });
}

// --- Game Engine ---
window.onkeydown = (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (isFinished) return;

        if (!isStarted) {
            isStarted = true;
            startTime = Date.now();
            requestAnimationFrame(updateTimer);
        }

        myProgress += 0.02; // Change speed here
        if (myProgress >= 1.0) finishRace();

        broadcastState();
        renderTracks();
    }
};

function updateTimer() {
    if (isFinished) return;
    const elapsed = (Date.now() - startTime) / 1000;
    timerDisplay.textContent = elapsed.toFixed(2) + 's';
    requestAnimationFrame(updateTimer);
}

function broadcastState() {
    if (!mqttClient) return;
    mqttClient.publish(`${TOPIC_BASE}/state/${PLAYER_ID}`, JSON.stringify({
        id: PLAYER_ID,
        name: myName,
        progress: myProgress
    }));
}

function updatePlayerState(data) {
    if (data.id === PLAYER_ID) return;
    if (!players[data.id]) {
        players[data.id] = { name: data.name, progress: 0 };
    }
    players[data.id].progress = data.progress;
    players[data.id].lastSeen = Date.now();
    renderTracks();
}

function syncJoin(data) {
    if (!players[data.id]) {
        players[data.id] = { name: data.name, progress: 0 };
        broadcastState(); // Let them know I'm here
    }
}

function removePlayer(id) {
    delete players[id];
    renderTracks();
}

function renderTracks() {
    let html = `
        <div class="lane local">
            <div class="racer" style="left: calc(${myProgress * 90}% + 10px)">
                <div class="racer-icon">🚄</div>
                <div class="racer-name">YOU: ${myName}</div>
            </div>
        </div>
    `;

    Object.keys(players).forEach(id => {
        const p = players[id];
        html += `
            <div class="lane">
                <div class="racer" style="left: calc(${p.progress * 90}% + 10px)">
                    <div class="racer-icon" style="color: #64748b">🚄</div>
                    <div class="racer-name">${p.name}</div>
                </div>
            </div>
        `;
    });

    tracksContainer.innerHTML = html;
}

function finishRace() {
    isFinished = true;
    myProgress = 1.0;
    const finalTime = (Date.now() - startTime) / 1000;

    document.getElementById('win-details').textContent = `เวลาที่คุณทำได้: ${finalTime.toFixed(2)}s`;
    winScreen.classList.remove('hidden');

    // Check Hall of Fame
    checkAndPublishHighscore(finalTime);
}

function checkAndPublishHighscore(time) {
    let updated = false;
    const newRecord = { name: myName, score: time };

    hallOfFame.push(newRecord);
    hallOfFame.sort((a, b) => a.score - b.score);
    hallOfFame = hallOfFame.slice(0, 10); // Top 10

    mqttClient.publish(`${TOPIC_BASE}/hall-of-fame`, JSON.stringify(hallOfFame), { retain: true });
}

function updateLeaderboard(data) {
    hallOfFame = Array.isArray(data) ? data : [];
    if (hallOfFame.length === 0) {
        leaderboard.innerHTML = '<li class="empty">ยังไม่มีสถิติ...</li>';
        return;
    }

    leaderboard.innerHTML = hallOfFame.map((entry, idx) => `
        <li>
            <span>${idx + 1}. ${entry.name}</span>
            <span>${entry.score.toFixed(2)}s</span>
        </li>
    `).join('');
}

// Cleanup stale players
setInterval(() => {
    const now = Date.now();
    Object.keys(players).forEach(id => {
        if (now - players[id].lastSeen > 10000) removePlayer(id);
    });
}, 5000);
