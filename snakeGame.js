const canvas = document.getElementById('snakeGame');
const ctx = canvas.getContext('2d', { alpha: false });

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayBody = document.getElementById('overlayBody');
const primaryAction = document.getElementById('primaryAction');
const secondaryAction = document.getElementById('secondaryAction');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const difficultySelect = document.getElementById('difficultySelect');
const wrapToggle = document.getElementById('wrapToggle');
const soundToggle = document.getElementById('soundToggle');
const volumeRange = document.getElementById('volumeRange');

const scoreValue = document.getElementById('scoreValue');
const highScoreValue = document.getElementById('highScoreValue');
const speedValue = document.getElementById('speedValue');

const STORAGE_KEY = 'snake_game_v1';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function nowMs() {
    return performance.now();
}

class SoundManager {
    constructor() {
        this.enabled = true;
        this.volume = 0.7;
        this._buffers = new Map();
        this._audioContext = null;
        this._unlockAttempted = false;
        this._fallbackAudio = new Map();
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) {
            for (const audio of this._fallbackAudio.values()) {
                try {
                    audio.pause();
                    audio.currentTime = 0;
                } catch {
                    // ignore
                }
            }
        }
    }

    setVolume(volume) {
        this.volume = clamp(Number(volume), 0, 1);
        for (const audio of this._fallbackAudio.values()) {
            audio.volume = this.volume;
        }
    }

    async unlock() {
        if (this._unlockAttempted) return;
        this._unlockAttempted = true;
        try {
            if (window.location && window.location.protocol === 'file:') {
                this._audioContext = null;
                return;
            }
            const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextImpl) return;
            this._audioContext = new AudioContextImpl();
            if (this._audioContext.state === 'suspended') {
                await this._audioContext.resume();
            }
        } catch {
            this._audioContext = null;
        }
    }

    async _loadBuffer(url) {
        if (!this._audioContext) return null;
        if (this._buffers.has(url)) return this._buffers.get(url);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await this._audioContext.decodeAudioData(arrayBuffer);
        this._buffers.set(url, buffer);
        return buffer;
    }

    _getFallbackAudio(url) {
        if (this._fallbackAudio.has(url)) return this._fallbackAudio.get(url);
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.volume = this.volume;
        this._fallbackAudio.set(url, audio);
        return audio;
    }

    async play(url, { rate = 1 } = {}) {
        if (!this.enabled) return;
        await this.unlock();

        if (this._audioContext) {
            try {
                const buffer = await this._loadBuffer(url);
                if (!buffer) return;
                const source = this._audioContext.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = clamp(rate, 0.5, 2);
                const gainNode = this._audioContext.createGain();
                gainNode.gain.value = this.volume;
                source.connect(gainNode).connect(this._audioContext.destination);
                source.start(0);
                return;
            } catch {
                // fall back to HTMLAudioElement below
            }
        }

        const audio = this._getFallbackAudio(url);
        try {
            audio.currentTime = 0;
            audio.playbackRate = clamp(rate, 0.5, 2);
            await audio.play();
        } catch {
            // ignore play errors
        }
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveSettings(patch) {
    const current = loadSettings() || {};
    const next = { ...current, ...patch };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // ignore
    }
    return next;
}

const sound = new SoundManager();
const SFX = {
    eat: 'assets/sfx/eat.mp3',
    bonus: 'assets/sfx/bonus.wav',
    gameOver: 'assets/sfx/game-over.mp3'
};

const DIFFICULTY = {
    easy: { baseStepMs: 150, speedFactor: 0.985, bonusChance: 0.09 },
    normal: { baseStepMs: 120, speedFactor: 0.982, bonusChance: 0.12 },
    hard: { baseStepMs: 95, speedFactor: 0.979, bonusChance: 0.15 }
};

const game = {
    state: 'menu', // menu | running | paused | gameover
    gridSize: 20,
    cols: 16,
    rows: 24,
    wrapWalls: false,
    difficulty: 'normal',
    baseStepMs: 120,
    stepMs: 120,
    stepFactor: 0.982,
    lastFrameMs: 0,
    accumulatorMs: 0,
    score: 0,
    highScore: 0,
    speedDisplay: 1,
    bonus: {
        active: false,
        x: 0,
        y: 0,
        despawnAtMs: 0
    }
};

const snake = {
    body: [{ x: 10, y: 10 }],
    dir: { x: 1, y: 0 },
    queuedDir: null
};

const food = { x: 5, y: 5 };

function applyDifficulty(name) {
    const config = DIFFICULTY[name] || DIFFICULTY.normal;
    game.difficulty = name in DIFFICULTY ? name : 'normal';
    game.baseStepMs = config.baseStepMs;
    game.stepMs = config.baseStepMs;
    game.stepFactor = config.speedFactor;
}

function resizeGameCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.min(420, Math.floor(window.innerWidth * 0.92));
    const cssHeight = Math.min(640, Math.floor(window.innerHeight * 0.7));

    const grid = game.gridSize;
    const cols = Math.max(12, Math.floor(cssWidth / grid));
    const rows = Math.max(18, Math.floor(cssHeight / grid));

    game.cols = cols;
    game.rows = rows;

    canvas.width = Math.floor(cols * grid * dpr);
    canvas.height = Math.floor(rows * grid * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.width = `${cols * grid}px`;
    canvas.style.height = `${rows * grid}px`;
}

function isOccupied(x, y) {
    return snake.body.some(segment => segment.x === x && segment.y === y);
}

function randomEmptyCell() {
    const maxTries = game.cols * game.rows * 4;
    for (let i = 0; i < maxTries; i++) {
        const x = Math.floor(Math.random() * game.cols);
        const y = Math.floor(Math.random() * game.rows);
        if (isOccupied(x, y)) continue;
        if (x === food.x && y === food.y) continue;
        if (game.bonus.active && x === game.bonus.x && y === game.bonus.y) continue;
        return { x, y };
    }

    return { x: 0, y: 0 };
}

function spawnFood() {
    const cell = randomEmptyCell();
    food.x = cell.x;
    food.y = cell.y;
}

function maybeSpawnBonus() {
    const config = DIFFICULTY[game.difficulty] || DIFFICULTY.normal;
    if (game.bonus.active) return;
    if (Math.random() > config.bonusChance) return;
    const cell = randomEmptyCell();
    game.bonus.active = true;
    game.bonus.x = cell.x;
    game.bonus.y = cell.y;
    game.bonus.despawnAtMs = nowMs() + 4500;
}

function despawnBonus() {
    game.bonus.active = false;
}

function updateHud() {
    scoreValue.textContent = String(game.score);
    highScoreValue.textContent = String(game.highScore);
    speedValue.textContent = `${game.speedDisplay.toFixed(1)}×`;
}

function setOverlay({ title, body, primaryText, secondaryText, show }) {
    overlayTitle.textContent = title;
    overlayBody.textContent = body;
    primaryAction.textContent = primaryText;
    secondaryAction.textContent = secondaryText;
    overlay.hidden = !show;
}

function setControlsState() {
    const runningOrPaused = game.state === 'running' || game.state === 'paused';
    startBtn.disabled = runningOrPaused;
    pauseBtn.disabled = !runningOrPaused;
    restartBtn.disabled = !runningOrPaused;
    pauseBtn.textContent = game.state === 'paused' ? 'Resume' : 'Pause';
}

function setState(nextState) {
    game.state = nextState;
    setControlsState();

    if (nextState === 'menu') {
        setOverlay({
            title: 'Snake',
            body: 'Press Space to start. Arrow keys / WASD to move. R to restart.',
            primaryText: 'Start',
            secondaryText: 'Settings',
            show: true
        });
    }

    if (nextState === 'paused') {
        setOverlay({
            title: 'Paused',
            body: 'Press Space to resume.',
            primaryText: 'Resume',
            secondaryText: 'Restart',
            show: true
        });
    }

    if (nextState === 'gameover') {
        setOverlay({
            title: 'Game Over',
            body: `Score: ${game.score} — Press R to try again.`,
            primaryText: 'Restart',
            secondaryText: 'Menu',
            show: true
        });
    }

    if (nextState === 'running') {
        overlay.hidden = true;
    }
}

function resetGame({ keepHighScore = true } = {}) {
    const centerX = Math.floor(game.cols / 2);
    const centerY = Math.floor(game.rows / 2);

    snake.body = [{ x: centerX, y: centerY }];
    snake.dir = { x: 1, y: 0 };
    snake.queuedDir = null;

    game.score = 0;
    game.stepMs = game.baseStepMs;
    game.accumulatorMs = 0;
    game.lastFrameMs = 0;
    game.speedDisplay = 1;

    despawnBonus();
    spawnFood();

    if (!keepHighScore) {
        game.highScore = 0;
        saveSettings({ highScore: 0 });
    }

    updateHud();
}

function commitHighScore() {
    if (game.score <= game.highScore) return false;
    game.highScore = game.score;
    saveSettings({ highScore: game.highScore });
    updateHud();
    return true;
}

function queueDirection(nextDir) {
    if (game.state !== 'running') return;
    const current = snake.queuedDir || snake.dir;
    if (nextDir.x === -current.x && nextDir.y === -current.y) return;
    snake.queuedDir = nextDir;
}

function stepGame() {
    if (snake.queuedDir) {
        snake.dir = snake.queuedDir;
        snake.queuedDir = null;
    }

    const head = snake.body[0];
    let nextX = head.x + snake.dir.x;
    let nextY = head.y + snake.dir.y;

    if (game.wrapWalls) {
        nextX = (nextX + game.cols) % game.cols;
        nextY = (nextY + game.rows) % game.rows;
    } else {
        if (nextX < 0 || nextX >= game.cols || nextY < 0 || nextY >= game.rows) {
            triggerGameOver();
            return;
        }
    }

    const nextHead = { x: nextX, y: nextY };

    for (let i = 0; i < snake.body.length; i++) {
        const segment = snake.body[i];
        if (segment.x === nextHead.x && segment.y === nextHead.y) {
            triggerGameOver();
            return;
        }
    }

    snake.body.unshift(nextHead);

    let ate = false;
    if (nextHead.x === food.x && nextHead.y === food.y) {
        ate = true;
        game.score += 10;
        spawnFood();
        maybeSpawnBonus();
        sound.play(SFX.eat, { rate: clamp(1 + (game.baseStepMs - game.stepMs) / 180, 0.8, 1.4) });
        game.stepMs = Math.max(52, game.stepMs * game.stepFactor);
        game.speedDisplay = clamp(game.baseStepMs / game.stepMs, 1, 4.5);
    }

    if (game.bonus.active && nextHead.x === game.bonus.x && nextHead.y === game.bonus.y) {
        ate = true;
        game.score += 50;
        despawnBonus();
        sound.play(SFX.bonus, { rate: 1 });
        game.stepMs = Math.max(52, game.stepMs * game.stepFactor);
        game.speedDisplay = clamp(game.baseStepMs / game.stepMs, 1, 4.5);
    }

    if (!ate) {
        snake.body.pop();
    }

    updateHud();

    if (game.bonus.active && nowMs() > game.bonus.despawnAtMs) {
        despawnBonus();
    }
}

function drawBackground() {
    ctx.fillStyle = '#f7f8ff';
    ctx.fillRect(0, 0, game.cols * game.gridSize, game.rows * game.gridSize);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#0b0f2a';
    for (let y = 0; y < game.rows; y++) {
        for (let x = 0; x < game.cols; x++) {
            if ((x + y) % 2 === 0) {
                ctx.fillRect(x * game.gridSize, y * game.gridSize, game.gridSize, game.gridSize);
            }
        }
    }
    ctx.globalAlpha = 1;
}

function drawFoodCircle(x, y, color) {
    const size = game.gridSize;
    const cx = x * size + size / 2;
    const cy = y * size + size / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

function drawSnake() {
    const size = game.gridSize;

    for (let i = snake.body.length - 1; i >= 0; i--) {
        const segment = snake.body[i];
        const t = i / Math.max(1, snake.body.length - 1);
        const r = Math.floor(70 + 30 * (1 - t));
        const g = Math.floor(190 + 40 * (1 - t));
        const b = Math.floor(110 + 30 * (1 - t));

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(segment.x * size + 1, segment.y * size + 1, size - 2, size - 2);
    }

    const head = snake.body[0];
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(head.x * size + 1, head.y * size + 1, size - 2, size - 2);
}

function render() {
    drawBackground();

    if (game.bonus.active) {
        drawFoodCircle(game.bonus.x, game.bonus.y, '#7c5cff');
        ctx.globalAlpha = 0.25;
        drawFoodCircle(game.bonus.x, game.bonus.y, '#7c5cff');
        ctx.globalAlpha = 1;
    }

    drawFoodCircle(food.x, food.y, '#ff5a7a');
    drawSnake();

    if (game.state === 'running') return;

    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, game.cols * game.gridSize, game.rows * game.gridSize);
    ctx.globalAlpha = 1;
}

function triggerGameOver() {
    if (game.state !== 'running') return;
    const isNewHigh = commitHighScore();
    setState('gameover');
    if (isNewHigh) {
        overlayBody.textContent = `New High Score: ${game.score} — Press R to try again.`;
    }
    sound.play(SFX.gameOver, { rate: 1 });
}

function startGame() {
    resetGame({ keepHighScore: true });
    setState('running');
}

function togglePause() {
    if (game.state === 'menu') {
        startGame();
        return;
    }

    if (game.state === 'running') {
        setState('paused');
        return;
    }

    if (game.state === 'paused') {
        setState('running');
    }
}

function restartGame() {
    if (game.state === 'menu') {
        startGame();
        return;
    }
    resetGame({ keepHighScore: true });
    setState('running');
}

function goToMenu() {
    setState('menu');
}

function gameLoop(timestampMs) {
    if (!game.lastFrameMs) game.lastFrameMs = timestampMs;
    const deltaMs = clamp(timestampMs - game.lastFrameMs, 0, 60);
    game.lastFrameMs = timestampMs;

    if (game.state === 'running') {
        game.accumulatorMs += deltaMs;
        while (game.accumulatorMs >= game.stepMs) {
            stepGame();
            game.accumulatorMs -= game.stepMs;
            if (game.state !== 'running') break;
        }
    }

    render();
    requestAnimationFrame(gameLoop);
}

function initFromStorage() {
    const stored = loadSettings() || {};
    game.highScore = Number(stored.highScore || 0);
    applyDifficulty(String(stored.difficulty || 'normal'));
    game.wrapWalls = Boolean(stored.wrapWalls || false);

    const enabled = stored.soundEnabled !== false;
    const volume = stored.volume == null ? 0.7 : Number(stored.volume);

    soundToggle.checked = enabled;
    sound.setEnabled(enabled);
    volumeRange.value = String(clamp(volume, 0, 1));
    sound.setVolume(volumeRange.value);

    wrapToggle.checked = game.wrapWalls;
    difficultySelect.value = game.difficulty;
    updateHud();
}

function bindUi() {
    window.addEventListener('resize', () => {
        resizeGameCanvas();
        if (game.state !== 'running') render();
    });

    const unlockOnGesture = async () => {
        await sound.unlock();
        window.removeEventListener('pointerdown', unlockOnGesture);
        window.removeEventListener('keydown', unlockOnGesture);
    };
    window.addEventListener('pointerdown', unlockOnGesture, { once: true });
    window.addEventListener('keydown', unlockOnGesture, { once: true });

    startBtn.addEventListener('click', startGame);
    pauseBtn.addEventListener('click', togglePause);
    restartBtn.addEventListener('click', restartGame);

    primaryAction.addEventListener('click', () => {
        if (game.state === 'menu') startGame();
        else if (game.state === 'paused') togglePause();
        else if (game.state === 'gameover') restartGame();
    });

    secondaryAction.addEventListener('click', () => {
        if (game.state === 'paused') restartGame();
        else if (game.state === 'gameover') goToMenu();
        else overlay.hidden = true;
    });

    difficultySelect.addEventListener('change', () => {
        applyDifficulty(difficultySelect.value);
        saveSettings({ difficulty: game.difficulty });
        if (game.state !== 'running') render();
    });

    wrapToggle.addEventListener('change', () => {
        game.wrapWalls = wrapToggle.checked;
        saveSettings({ wrapWalls: game.wrapWalls });
    });

    soundToggle.addEventListener('change', () => {
        sound.setEnabled(soundToggle.checked);
        saveSettings({ soundEnabled: soundToggle.checked });
    });

    volumeRange.addEventListener('input', () => {
        sound.setVolume(volumeRange.value);
        saveSettings({ volume: Number(volumeRange.value) });
    });

    document.addEventListener('keydown', event => {
        const key = event.key.toLowerCase();

        if (key === ' ' || key === 'spacebar') {
            event.preventDefault();
            togglePause();
            return;
        }

        if (key === 'r') {
            restartGame();
            return;
        }

        if (key === 'arrowup' || key === 'w') queueDirection({ x: 0, y: -1 });
        if (key === 'arrowdown' || key === 's') queueDirection({ x: 0, y: 1 });
        if (key === 'arrowleft' || key === 'a') queueDirection({ x: -1, y: 0 });
        if (key === 'arrowright' || key === 'd') queueDirection({ x: 1, y: 0 });
    });

    canvas.addEventListener('click', () => {
        if (game.state === 'menu') startGame();
        else if (game.state === 'paused') togglePause();
        else if (game.state === 'gameover') restartGame();
    });

    let touchStart = null;
    canvas.addEventListener(
        'touchstart',
        event => {
            if (!event.touches || event.touches.length === 0) return;
            const t = event.touches[0];
            touchStart = { x: t.clientX, y: t.clientY };
        },
        { passive: true }
    );

    canvas.addEventListener(
        'touchmove',
        event => {
            if (!touchStart) return;
            if (!event.touches || event.touches.length === 0) return;
            const t = event.touches[0];
            const dx = t.clientX - touchStart.x;
            const dy = t.clientY - touchStart.y;
            const threshold = 24;
            if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

            if (Math.abs(dx) > Math.abs(dy)) queueDirection({ x: dx > 0 ? 1 : -1, y: 0 });
            else queueDirection({ x: 0, y: dy > 0 ? 1 : -1 });

            touchStart = { x: t.clientX, y: t.clientY };
        },
        { passive: true }
    );
}

resizeGameCanvas();
initFromStorage();
resetGame({ keepHighScore: true });
setState('menu');
bindUi();
requestAnimationFrame(gameLoop);
