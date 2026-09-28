/* =========================================================
   Game Session Automation Studio – Client Script
   ========================================================= */

// -------------------- Global State --------------------
let currentTab = 'dashboard';
let currentCategory = 'games';
let selectedPlatform = 'blooket';
let isRunning = false;
let botInstances = [];
let simulationInterval = null;
let telemetryInterval = null;

let connectionMode = 'simulated';
let socket = null;

let pendingAction = null;
let pendingRevert = null;

let topAlertTimeout = null;

// Cooldown State
let cooldownActive = false;
let cooldownTimer = null;
let lastSessionCount = 0;

// -------------------- Initialization --------------------
window.addEventListener('DOMContentLoaded', () => {
    fetchPublicIP();
    selectCategory('games');
});

function fetchPublicIP() {
    const ipDisplay = document.getElementById('public-ip-display');
    if (!ipDisplay) return;
    fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => {
            if (data && data.ip) {
                ipDisplay.innerText = data.ip;
            }
        })
        .catch(() => {
            ipDisplay.innerText = '198.51.100.42 (Proxy)';
        });
}

// -------------------- Utility Helpers --------------------
function maskID(idStr) {
    if (typeof idStr === 'string' && idStr.length === 10 && /^\d+$/.test(idStr)) {
        return idStr.slice(0, 4) + '******';
    }
    return idStr;
}

function getMaxCapacity() {
    if (currentCategory === 'games') return 50;
    if (currentCategory === 'streams') return 250;
    if (currentCategory === 'social') return 1000;
    return 50;
}

function logOrchestrator(msg) {
    const container = document.getElementById('orchestrator-log');
    const time = new Date().toISOString().split('T')[1].slice(0, 8);
    const div = document.createElement('div');
    div.innerHTML = `<span class="text-slate-500">${time}</span> ${msg}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function clearLogs() {
    document.getElementById('orchestrator-log').innerHTML =
        '<div class="text-slate-500">[CONSOLE_CLEARED] Output stream reset.</div>';
}

function generateRandom10DigitID() {
    return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

// -------------------- Top Alert Banner --------------------
function showTopAlert(msg) {
    const banner = document.getElementById('top-alert-banner');
    const msgEl = document.getElementById('top-alert-msg');
    if (!banner || !msgEl) return;

    msgEl.innerText = msg;
    banner.classList.remove('-translate-y-full', 'opacity-0', 'pointer-events-none');
    banner.classList.add('translate-y-2', 'opacity-100', 'pointer-events-auto');

    if (topAlertTimeout) clearTimeout(topAlertTimeout);
    topAlertTimeout = setTimeout(() => {
        hideTopAlert();
    }, 3500);
}

function hideTopAlert() {
    const banner = document.getElementById('top-alert-banner');
    if (!banner) return;
    banner.classList.remove('translate-y-2', 'opacity-100', 'pointer-events-auto');
    banner.classList.add('-translate-y-full', 'opacity-0', 'pointer-events-none');
}

// -------------------- Cooldown --------------------
function startCooldown(instanceCount) {
    const count = instanceCount || 50;
    const seconds = Math.max(2, Math.ceil(count / 5));
    cooldownActive = true;
    let remaining = seconds;

    const launchBtn = document.getElementById('btn-launch');
    if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.classList.add('opacity-40', 'cursor-not-allowed');
    }

    logOrchestrator(`[COOLDOWN_INIT] Cooldown period active (${seconds}s) based on ${count} worker sessions utilized.`);

    if (cooldownTimer) clearInterval(cooldownTimer);

    const updateBtnUI = () => {
        if (!launchBtn) return;
        if (remaining > 0) {
            launchBtn.innerHTML = `<i class="fa-solid fa-hourglass-half text-amber-400 mr-1 animate-pulse"></i> Cooldown (${remaining}s)`;
        } else {
            clearInterval(cooldownTimer);
            cooldownActive = false;
            launchBtn.disabled = false;
            launchBtn.classList.remove('opacity-40', 'cursor-not-allowed');
            launchBtn.innerHTML = `<i class="fa-solid fa-play"></i> Launch Pool`;
            logOrchestrator(`[COOLDOWN_EXPIRED] Worker queue cooled down. Orchestrator ready for next execution.`);
        }
    };

    updateBtnUI();
    cooldownTimer = setInterval(() => {
        remaining--;
        updateBtnUI();
    }, 1000);
}

// -------------------- Target Validation --------------------
function validateTargetInput() {
    const inputVal = document.getElementById('game-pin').value.trim();
    const valBox = document.getElementById('target-validation-box');
    if (!valBox) return false;

    let isValid = false;

    if (currentCategory === 'games') {
        isValid = /^\d{6}$/.test(inputVal);
        if (isValid) {
            valBox.innerHTML = `
                <div class="w-full h-full bg-emerald-950/60 border border-emerald-600 text-emerald-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-check mr-1 text-emerald-400"></i> Valid Game PIN</span>
                    <span class="text-[9px] bg-emerald-900/80 text-emerald-200 border border-emerald-700 px-1 uppercase">VERIFIED</span>
                </div>
            `;
        } else {
            valBox.innerHTML = `
                <div class="w-full h-full bg-red-950/60 border border-red-600 text-red-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-xmark mr-1 text-red-400"></i> Invalid Game PIN Entered</span>
                    <span class="text-[9px] bg-red-900/80 text-red-200 border border-red-700 px-1 uppercase">INVALID</span>
                </div>
            `;
        }
    } else if (currentCategory === 'streams') {
        isValid = /^[a-zA-Z0-9_]{3,}$/.test(inputVal);
        if (isValid) {
            valBox.innerHTML = `
                <div class="w-full h-full bg-emerald-950/60 border border-emerald-600 text-emerald-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-check mr-1 text-emerald-400"></i> Valid User ID</span>
                    <span class="text-[9px] bg-emerald-900/80 text-emerald-200 border border-emerald-700 px-1 uppercase">VERIFIED</span>
                </div>
            `;
        } else {
            valBox.innerHTML = `
                <div class="w-full h-full bg-red-950/60 border border-red-600 text-red-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-xmark mr-1 text-red-400"></i> Invalid User ID Entered</span>
                    <span class="text-[9px] bg-red-900/80 text-red-200 border border-red-700 px-1 uppercase">INVALID</span>
                </div>
            `;
        }
    } else if (currentCategory === 'social') {
        isValid = /^[a-zA-Z0-9_.\-]{2,}$/.test(inputVal);
        if (isValid) {
            valBox.innerHTML = `
                <div class="w-full h-full bg-emerald-950/60 border border-emerald-600 text-emerald-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-check mr-1 text-emerald-400"></i> Valid Username</span>
                    <span class="text-[9px] bg-emerald-900/80 text-emerald-200 border border-emerald-700 px-1 uppercase">VERIFIED</span>
                </div>
            `;
        } else {
            valBox.innerHTML = `
                <div class="w-full h-full bg-red-950/60 border border-red-600 text-red-400 font-mono text-[11px] font-bold px-2 py-1 flex items-center justify-between">
                    <span class="truncate"><i class="fa-solid fa-circle-xmark mr-1 text-red-400"></i> Invalid Username Entered</span>
                    <span class="text-[9px] bg-red-900/80 text-red-200 border border-red-700 px-1 uppercase">INVALID</span>
                </div>
            `;
        }
    }

    return isValid;
}

// -------------------- Confirmation Modal --------------------
function confirmActionIfRunning(actionCallback, revertCallback) {
    if (isRunning || botInstances.length > 0) {
        pendingAction = actionCallback;
        pendingRevert = revertCallback || null;
        const count = botInstances.length || parseInt(document.getElementById('bot-count-range').value) || 0;
        document.getElementById('confirm-active-count').innerText = count;
        document.getElementById('confirm-modal').classList.remove('hidden');
    } else {
        actionCallback();
    }
}

function handleConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (pendingAction) {
        pendingAction();
    }
    pendingAction = null;
    pendingRevert = null;
}

function handleCancelModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (pendingRevert) {
        pendingRevert();
    }
    pendingAction = null;
    pendingRevert = null;
}

function saveSettingState(el) {
    el.dataset.prevValue = el.value;
}

function handleSettingChange(el, reason, applyFn) {
    const oldVal = el.dataset.prevValue || el.value;
    const newVal = el.value;
    if (oldVal === newVal && !isRunning && botInstances.length === 0) return;

    confirmActionIfRunning(
        () => {
            el.dataset.prevValue = newVal;
            forceResetSessions(reason);
            if (applyFn) applyFn();
        },
        () => {
            el.value = oldVal;
            el.dataset.prevValue = oldVal;
            if (el.id === 'bot-count-range') {
                updateBotCountLabel(oldVal);
            }
            if (applyFn) applyFn();
        }
    );
}

function forceResetSessions(reason) {
    if (isRunning || botInstances.length > 0) {
        isRunning = false;
        if (simulationInterval) clearInterval(simulationInterval);
        if (telemetryInterval) clearInterval(telemetryInterval);

        if (connectionMode === 'live' && socket && socket.connected) {
            socket.emit('STOP_ALL');
        }

        botInstances = [];
        const grid = document.getElementById('session-grid');
        if (grid) {
            grid.innerHTML = `
                <div id="empty-state" class="col-span-full py-12 flex flex-col items-center justify-center text-center text-slate-500 border border-dashed border-cardBorder bg-darkBg">
                    <i class="fa-solid fa-network-wired text-2xl mb-2 text-slate-600"></i>
                    <p class="text-xs font-mono uppercase font-semibold text-slate-400">No Active Worker Threads</p>
                    <p class="text-[11px] font-mono text-slate-600 mt-0.5">Execute "Launch Pool" above to instantiate browser session contexts.</p>
                </div>
            `;
        }

        resetMeters();

        const launchBtn = document.getElementById('btn-launch');
        const stopBtn = document.getElementById('btn-stop');
        if (launchBtn) {
            launchBtn.disabled = false;
            launchBtn.classList.remove('opacity-40', 'cursor-not-allowed');
        }
        if (stopBtn) {
            stopBtn.disabled = true;
        }

        if (reason) {
            logOrchestrator(`[AUTO_RESET] Active workers cleared due to ${reason}. Re-launch required.`);
        }
    }
    updateActiveVsSelectedBadge();
}

// -------------------- Connection Mode --------------------
function setConnectionMode(mode) {
    if (connectionMode === mode && !isRunning && botInstances.length === 0) return;

    confirmActionIfRunning(() => {
        forceResetSessions('connection mode switch');
        connectionMode = mode;
        const simBtn = document.getElementById('mode-simulated');
        const liveBtn = document.getElementById('mode-live');
        const badge = document.getElementById('socket-conn-badge');

        if (mode === 'live') {
            simBtn.className = "px-2 py-0.5 text-[10px] font-mono uppercase bg-darkBg text-slate-400 border border-cardBorder hover:text-white";
            liveBtn.className = "px-2 py-0.5 text-[10px] font-mono uppercase bg-blue-600 text-white border border-blue-500";

            logOrchestrator(`[WEBSOCKET] Connecting to live Node.js server (http://localhost:4000)...`);
            badge.className = "text-amber-400 font-bold";
            badge.innerText = "CONNECTING...";

            if (typeof io !== 'undefined') {
                try {
                    socket = io('http://localhost:4000', {
                        transports: ['websocket', 'polling'],
                        timeout: 5000
                    });

                    socket.on('connect', () => {
                        badge.className = "text-emerald-400 font-bold";
                        badge.innerText = "CONNECTED";
                        logOrchestrator(`[WEBSOCKET] Connected to server (Socket ID: ${socket.id})`);
                    });

                    socket.on('connect_error', (err) => {
                        badge.className = "text-red-400 font-bold";
                        badge.innerText = "OFFLINE";
                        logOrchestrator(`[WEBSOCKET_ERR] Server offline at http://localhost:4000 (${err.message})`);
                    });

                    socket.on('BOT_STATUS', (data) => {
                        handleLiveBotStatus(data);
                    });

                    socket.on('ALL_STOPPED', () => {
                        logOrchestrator(`[WEBSOCKET] Server confirmed all sessions terminated.`);
                    });

                } catch (e) {
                    badge.className = "text-red-400 font-bold";
                    badge.innerText = "ERROR";
                    logOrchestrator(`[WEBSOCKET_ERR] Socket initialization failed.`);
                }
            }
        } else {
            liveBtn.className = "px-2 py-0.5 text-[10px] font-mono uppercase bg-darkBg text-slate-400 border border-cardBorder hover:text-white";
            simBtn.className = "px-2 py-0.5 text-[10px] font-mono uppercase bg-blue-600 text-white border border-blue-500";

            if (socket) {
                socket.disconnect();
                socket = null;
            }
            badge.className = "text-amber-400";
            badge.innerText = "STANDBY";
            logOrchestrator(`[MODE] Switched to client-side simulation engine.`);
        }
    });
}

// -------------------- Category / Platform Selection --------------------
function selectCategory(cat) {
    if (currentCategory === cat && !isRunning && botInstances.length === 0) return;

    confirmActionIfRunning(() => {
        forceResetSessions('category change');
        currentCategory = cat;

        document.querySelectorAll('.cat-tab-btn').forEach(btn => {
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('text-slate-400');
        });
        const activeTab = document.getElementById(`cat-${cat}`);
        if (activeTab) {
            activeTab.classList.add('bg-blue-600', 'text-white');
            activeTab.classList.remove('text-slate-400');
        }

        document.querySelectorAll('.plat-group').forEach(el => el.classList.add('hidden'));
        const activeGroup = document.getElementById(`plat-group-${cat}`);
        if (activeGroup) activeGroup.classList.remove('hidden');

        const targetInput = document.getElementById('game-pin');
        const labelTarget = document.getElementById('label-target-id');
        const labelPrefix = document.getElementById('label-prefix');
        const prefixContainer = document.getElementById('prefix-container');

        const slider = document.getElementById('bot-count-range');
        const minLabel = document.getElementById('slider-min-label');
        const midLabel = document.getElementById('slider-mid-label');
        const maxLabel = document.getElementById('slider-max-label');

        if (cat === 'games') {
            selectedPlatform = 'blooket';
            labelTarget.innerText = 'Blooket Game ID';
            labelPrefix.innerText = 'Bot Nickname Prefix';
            targetInput.value = '849201';

            prefixContainer.innerHTML = `
                <input type="text" id="bot-prefix" value="BlooketBot" onfocus="saveSettingState(this)" onchange="handleSettingChange(this, 'prefix change')" class="w-full bg-darkBg border border-cardBorder rounded-none px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-600">
                <span id="prefix-suffix" class="absolute right-2 top-1.5 text-[10px] font-mono text-slate-500">_#</span>
            `;

        } else if (cat === 'streams') {
            selectedPlatform = 'twitch';
            labelTarget.innerText = 'Stream Channel / User ID';
            labelPrefix.innerText = 'Worker Identifiers';
            targetInput.value = 'ninja_stream';

            prefixContainer.innerHTML = `
                <div class="w-full bg-darkBg border border-cardBorder px-2.5 py-1.5 text-[11px] font-mono text-slate-400 flex items-center justify-between select-none">
                    <span>Random 10-Digit ID</span>
                    <i class="fa-solid fa-lock text-[10px] text-slate-500"></i>
                </div>
            `;

        } else if (cat === 'social') {
            selectedPlatform = 'instagram';
            labelTarget.innerText = 'Profile Handle';
            labelPrefix.innerText = 'Worker Identifiers';
            targetInput.value = 'creator_official';

            prefixContainer.innerHTML = `
                <div class="w-full bg-darkBg border border-cardBorder px-2.5 py-1.5 text-[11px] font-mono text-slate-400 flex items-center justify-between select-none">
                    <span>Random 10-Digit ID</span>
                    <i class="fa-solid fa-lock text-[10px] text-slate-500"></i>
                </div>
            `;
        }

        validateTargetInput();

        const maxCap = getMaxCapacity();
        slider.max = maxCap.toString();

        minLabel.innerText = "1 Session";
        midLabel.innerText = `${Math.floor(maxCap / 2)} Sessions`;
        maxLabel.innerText = `${maxCap >= 1000 ? '1,000 (1k)' : maxCap} Sessions`;

        let currentVal = parseInt(slider.value) || 1;
        if (currentVal > maxCap) {
            slider.value = maxCap;
            showTopAlert(`Maximum instance threshold enforced: ${maxCap} sessions max.`);
        }

        saveSettingState(targetInput);
        saveSettingState(slider);

        updateBotCountLabel(slider.value);
        selectPlatform(selectedPlatform);
        resetMeters();
        updateActiveVsSelectedBadge();
        logOrchestrator(`[MODE] Switched category -> ${cat.toUpperCase()} (${selectedPlatform.toUpperCase()})`);
    });
}

function selectPlatform(plat) {
    if (selectedPlatform === plat && !isRunning && botInstances.length === 0) return;

    confirmActionIfRunning(() => {
        forceResetSessions('platform change');
        selectedPlatform = plat;
        document.querySelectorAll('.platform-btn').forEach(btn => {
            btn.classList.remove('border-blue-600', 'bg-blue-950/40', 'text-white');
            btn.classList.add('border-cardBorder', 'bg-darkBg', 'text-slate-400');
        });
        const selectedBtn = document.getElementById(`plat-${plat}`);
        if (selectedBtn) {
            selectedBtn.classList.add('border-blue-600', 'bg-blue-950/40', 'text-white');
            selectedBtn.classList.remove('border-cardBorder', 'bg-darkBg', 'text-slate-400');
        }
        logOrchestrator(`[CONFIG] Target platform set to ${plat.toUpperCase()}`);
    });
}

// -------------------- Tab Switching --------------------
function switchTab(tab) {
    if (currentTab === tab) return;

    confirmActionIfRunning(() => {
        if (isRunning || botInstances.length > 0) {
            forceResetSessions('navigation tab change');
        }
        currentTab = tab;
        ['dashboard', 'architecture', 'code', 'setup'].forEach(t => {
            const el = document.getElementById(`tab-${t}`);
            const btn = document.getElementById(`tab-btn-${t}`);
            if (t === tab) {
                el.classList.remove('hidden');
                el.classList.add('flex');
                btn.classList.add('bg-blue-600', 'text-white');
                btn.classList.remove('text-slate-400');
            } else {
                el.classList.add('hidden');
                el.classList.remove('flex');
                btn.classList.remove('bg-blue-600', 'text-white');
                btn.classList.add('text-slate-400');
            }
        });
    });
}

// -------------------- Bot Count / Badge --------------------
function updateBotCountLabel(val) {
    let unit = 'Workers';
    if (currentCategory === 'games') unit = 'Bots';
    else if (currentCategory === 'streams') unit = 'Viewers';
    else if (currentCategory === 'social') unit = 'Followers';

    const maxCap = getMaxCapacity();
    let parsedVal = parseInt(val) || 1;

    if (parsedVal >= maxCap) {
        parsedVal = maxCap;
        const slider = document.getElementById('bot-count-range');
        if (slider) slider.value = maxCap;

        if (currentCategory === 'games') {
            showTopAlert("Max instances selected! This could crash the game.");
        } else {
            showTopAlert(`Maximum instance threshold reached: ${maxCap} ${unit} max.`);
        }
    }

    const formattedVal = parsedVal >= 1000 ? '1k (1,000)' : parsedVal;
    document.getElementById('bot-count-val').innerText = `${formattedVal} ${unit}`;
    updateActiveVsSelectedBadge();
}

function updateActiveVsSelectedBadge() {
    const badge = document.getElementById('active-vs-selected-badge');
    if (!badge) return;
    const targetCount = parseInt(document.getElementById('bot-count-range').value) || 0;
    const activeCount = botInstances.length;
    badge.innerText = `${activeCount} / ${targetCount} Active`;
}

// -------------------- Worker Cards --------------------
function renderWorkerCard(botObj) {
    const card = document.createElement('div');
    card.id = botObj.id;
    card.className = "bot-card bg-darkBg border border-cardBorder rounded-none p-2.5 flex flex-col justify-between hover:border-slate-500 transition-none font-mono";

    const displayName = maskID(botObj.name);

    if (botObj.category === 'games') {
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-cardBorder">
                    <span class="font-bold text-xs text-white truncate max-w-[110px]" title="${botObj.name}">${displayName}</span>
                    <span class="status-badge text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800 px-1 py-0.2">
                        INIT
                    </span>
                </div>
                <div class="space-y-1.5 text-[10px]">
                    <div class="flex justify-between text-slate-400">
                        <span>PIN: <span class="text-amber-400 font-bold">${botObj.targetId}</span></span>
                        <span class="text-cyan-400 font-semibold">[${botObj.platform}]</span>
                    </div>
                    <div class="flex justify-between text-slate-400">
                        <span>Ping: <span class="card-ping text-white">${botObj.ping}ms</span></span>
                        <span>Stability: <span class="text-emerald-400 font-bold">${botObj.stability}%</span></span>
                    </div>
                    <div class="w-full bg-cardBg border border-cardBorder h-1.5 p-0.2 mt-1">
                        <div class="card-progress bg-amber-500 h-full transition-none" style="width: 30%"></div>
                    </div>
                </div>
            </div>
            <div class="mt-2 pt-1.5 border-t border-cardBorder flex items-center justify-between text-[10px] text-slate-500">
                <span>PID: ${botObj.pid}</span>
                <button onclick="disconnectSingleBot('${botObj.id}')" class="hover:text-red-400 text-slate-400">
                    [KILL]
                </button>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-cardBorder">
                    <span class="font-bold text-xs text-white truncate max-w-[110px]" title="${botObj.name}">${displayName}</span>
                    <span class="status-badge text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800 px-1 py-0.2">
                        INIT
                    </span>
                </div>
                <div class="space-y-1.5 text-[10px]">
                    <div class="flex justify-between text-slate-400">
                        <span>Target: <span class="text-cyan-400 font-semibold truncate max-w-[80px]" title="${botObj.targetId}">${botObj.targetId}</span></span>
                        <span class="text-purple-400 font-semibold">[${botObj.platform}]</span>
                    </div>
                    <div class="flex justify-between text-slate-400">
                        <span>Ping: <span class="card-ping text-white">${botObj.ping}ms</span></span>
                        <span>Stability: <span class="text-emerald-400 font-bold">${botObj.stability}%</span></span>
                    </div>
                    <div class="w-full bg-cardBg border border-cardBorder h-1.5 p-0.2 mt-1">
                        <div class="card-progress bg-amber-500 h-full transition-none" style="width: 30%"></div>
                    </div>
                </div>
            </div>
            <div class="mt-2 pt-1.5 border-t border-cardBorder flex items-center justify-between text-[10px] text-slate-500">
                <span>PID: ${botObj.pid}</span>
                <button onclick="disconnectSingleBot('${botObj.id}')" class="hover:text-red-400 text-slate-400">
                    [KILL]
                </button>
            </div>
        `;
    }

    return card;
}

// -------------------- Launch / Stop Sessions --------------------
function startSimulatedSessions() {
    if (isRunning || cooldownActive) return;

    const isValid = validateTargetInput();
    if (!isValid) {
        const targetType = currentCategory === 'games' ? 'Game PIN' : (currentCategory === 'streams' ? 'User ID' : 'Username');
        showTopAlert(`Cannot launch pool: Invalid ${targetType} entered.`);
        return;
    }

    const targetVal = document.getElementById('game-pin').value.trim();
    const prefixEl = document.getElementById('bot-prefix');
    const prefix = prefixEl ? prefixEl.value : 'Bot';
    const targetCount = parseInt(document.getElementById('bot-count-range').value);
    const delay = parseInt(document.getElementById('join-delay').value);

    lastSessionCount = targetCount;

    if (connectionMode === 'live' && socket && socket.connected) {
        isRunning = true;
        document.getElementById('btn-launch').disabled = true;
        document.getElementById('btn-launch').classList.add('opacity-40', 'cursor-not-allowed');
        document.getElementById('btn-stop').disabled = false;

        logOrchestrator(`[BLOOKET_LAUNCH] Emitting START_SESSIONS event to server at http://localhost:4000...`);
        socket.emit('START_SESSIONS', {
            category: currentCategory,
            platform: selectedPlatform,
            targetId: targetVal,
            prefix: prefix,
            botCount: targetCount,
            joinDelay: delay
        });
        startTelemetryLoop();
        return;
    }

    isRunning = true;
    document.getElementById('btn-launch').disabled = true;
    document.getElementById('btn-launch').classList.add('opacity-40', 'cursor-not-allowed');
    document.getElementById('btn-stop').disabled = false;

    document.getElementById('empty-state')?.remove();

    logOrchestrator(`[POOL_START] Spawning ${targetCount} ${selectedPlatform.toUpperCase()} workers for Target: ${targetVal}...`);

    let currentCreated = 0;
    const grid = document.getElementById('session-grid');

    grid.querySelectorAll('.bot-card').forEach(c => c.remove());
    botInstances = [];

    const launchTimer = setInterval(() => {
        if (currentCreated >= targetCount || !isRunning) {
            clearInterval(launchTimer);
            if (isRunning) {
                logOrchestrator(`[POOL_READY] All ${targetCount} ${selectedPlatform.toUpperCase()} worker contexts active.`);
            }
            return;
        }

        currentCreated++;

        let workerDisplayName = '';
        if (currentCategory === 'games') {
            workerDisplayName = `${prefix}_${currentCreated}`;
        } else {
            workerDisplayName = generateRandom10DigitID();
        }

        const botId = `bot-${Date.now()}-${currentCreated}`;

        const botObj = {
            id: botId,
            name: workerDisplayName,
            botNum: currentCreated,
            pid: 1000 + currentCreated,
            targetId: targetVal,
            platform: selectedPlatform.toUpperCase(),
            category: currentCategory,
            status: 'Joining',
            ping: Math.floor(Math.random() * 25) + 15,
            stability: (98.5 + Math.random() * 1.5).toFixed(1),
            progress: 30
        };
        botInstances.push(botObj);

        const card = renderWorkerCard(botObj);
        grid.appendChild(card);

        setTimeout(() => {
            if (!isRunning) return;
            botObj.status = 'ACTIVE';
            botObj.progress = 100;
            const cardEl = document.getElementById(botId);
            if (cardEl) {
                const badge = cardEl.querySelector('.status-badge');
                if (badge) {
                    badge.className = "status-badge text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800 px-1 py-0.2";
                    badge.innerText = 'ACTIVE';
                }
                const progressBar = cardEl.querySelector('.card-progress');
                if (progressBar) {
                    progressBar.style.width = '100%';
                    progressBar.className = 'card-progress bg-emerald-500 h-full';
                }
            }
            updateTelemetryStats();
        }, 1000 + Math.random() * 600);

        updateTelemetryStats();
        updateActiveVsSelectedBadge();
    }, delay);

    startTelemetryLoop();
}

function handleLiveBotStatus(data) {
    const grid = document.getElementById('session-grid');
    document.getElementById('empty-state')?.remove();

    let botObj = botInstances.find(b => b.id === data.id);
    if (!botObj) {
        botObj = {
            id: data.id,
            name: data.name,
            pid: 1000 + botInstances.length + 1,
            targetId: data.targetId || document.getElementById('game-pin').value.trim(),
            platform: (data.platform || selectedPlatform).toUpperCase(),
            category: data.category || currentCategory,
            status: data.status,
            ping: data.ping || 22,
            stability: '99.2',
            progress: data.status === 'CONNECTED' ? 100 : 30
        };
        botInstances.push(botObj);
        const card = renderWorkerCard(botObj);
        grid.appendChild(card);
    } else {
        botObj.status = data.status;
        const cardEl = document.getElementById(data.id);
        if (cardEl && data.status === 'CONNECTED') {
            const badge = cardEl.querySelector('.status-badge');
            if (badge) {
                badge.className = "status-badge text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800 px-1 py-0.2";
                badge.innerText = 'ACTIVE';
            }
            const progressBar = cardEl.querySelector('.card-progress');
            if (progressBar) {
                progressBar.style.width = '100%';
                progressBar.className = 'card-progress bg-emerald-500 h-full';
            }
        }
    }
    updateTelemetryStats();
    updateActiveVsSelectedBadge();
}

function stopAllSessions() {
    const countToCooldown = lastSessionCount || botInstances.length || parseInt(document.getElementById('bot-count-range').value);

    isRunning = false;
    if (simulationInterval) clearInterval(simulationInterval);
    if (telemetryInterval) clearInterval(telemetryInterval);

    if (connectionMode === 'live' && socket && socket.connected) {
        logOrchestrator(`[LIVE_STOP] Emitting STOP_ALL signal to server...`);
        socket.emit('STOP_ALL');
    }

    logOrchestrator(`[POOL_STOP] Terminating active browser sessions...`);

    document.querySelectorAll('.bot-card').forEach(card => {
        const badge = card.querySelector('.status-badge');
        if (badge) {
            badge.className = "status-badge text-[10px] bg-red-950/60 text-red-400 border border-red-800 px-1 py-0.2";
            badge.innerText = 'TERMINATED';
        }
    });

    setTimeout(() => {
        document.getElementById('session-grid').innerHTML = `
            <div id="empty-state" class="col-span-full py-12 flex flex-col items-center justify-center text-center text-slate-500 border border-dashed border-cardBorder bg-darkBg">
                <i class="fa-solid fa-network-wired text-2xl mb-2 text-slate-600"></i>
                <p class="text-xs font-mono uppercase font-semibold text-slate-400">No Active Worker Threads</p>
                <p class="text-[11px] font-mono text-slate-600 mt-0.5">Execute "Launch Pool" above to instantiate browser session contexts.</p>
            </div>
        `;
        botInstances = [];
        updateTelemetryStats();
        updateActiveVsSelectedBadge();
        logOrchestrator(`[POOL_STOP] All workers freed. Systems nominal.`);

        startCooldown(countToCooldown);
    }, 600);

    document.getElementById('btn-stop').disabled = true;
}

function disconnectSingleBot(id) {
    const el = document.getElementById(id);
    if (el) {
        el.remove();
        botInstances = botInstances.filter(b => b.id !== id);
        updateTelemetryStats();
        updateActiveVsSelectedBadge();
        logOrchestrator(`[KILL_WORKER] Closed session instance #${id}`);
    }
}

function kickInactive() {
    botInstances = botInstances.filter(b => b.progress === 100);
    document.querySelectorAll('.bot-card').forEach(c => {
        if (!c.querySelector('.status-badge').innerText.includes('ACTIVE')) {
            c.remove();
        }
    });
    updateTelemetryStats();
    updateActiveVsSelectedBadge();
    logOrchestrator(`[PURGE] Cleared non-connected sessions.`);
}

function filterSessions() {
    const q = document.getElementById('grid-search').value.toLowerCase();
    document.querySelectorAll('.bot-card').forEach(c => {
        const name = c.querySelector('.font-bold').innerText.toLowerCase();
        c.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// -------------------- Telemetry --------------------
function startTelemetryLoop() {
    if (telemetryInterval) clearInterval(telemetryInterval);
    telemetryInterval = setInterval(() => {
        if (!isRunning && botInstances.length === 0) {
            resetMeters();
            return;
        }

        const count = botInstances.length;
        const cpu = Math.min(98, Math.floor(10 + count * 1.5 + Math.random() * 6));
        const ramMB = Math.floor(350 + count * 40 + Math.random() * 15);
        const ramPercent = Math.min(95, Math.floor((ramMB / 8192) * 100));

        const ping = Math.floor(14 + Math.random() * 8);
        const responseTime = Math.floor(85 + count * 0.8 + Math.random() * 20);
        const responsePercent = Math.min(100, Math.floor((responseTime / 400) * 100));

        document.getElementById('cpu-bar').style.width = `${cpu}%`;
        document.getElementById('cpu-text').innerText = `${cpu}%`;

        document.getElementById('ram-bar').style.width = `${ramPercent}%`;
        document.getElementById('ram-text').innerText = `${ramMB} MB / 8.0 GB`;

        document.getElementById('response-bar').style.width = `${responsePercent}%`;
        document.getElementById('response-bar-text').innerText = `${responseTime} ms (${responseTime < 200 ? 'Optimal' : 'Elevated Load'})`;

        document.getElementById('stat-response').innerText = `${responseTime} ms`;
        document.getElementById('stat-latency').innerText = `${ping} ms`;

        botInstances.forEach(b => {
            b.ping = Math.floor(Math.random() * 20) + 15;
            const card = document.getElementById(b.id);
            if (card) {
                const pingEl = card.querySelector('.card-ping');
                if (pingEl) pingEl.innerText = `${b.ping}ms`;
            }
        });
    }, 1200);
}

function updateTelemetryStats() {
    const count = botInstances.length;
    const maxCap = getMaxCapacity();
    const available = Math.max(0, maxCap - count);

    const formatMax = maxCap >= 1000 ? '1k' : maxCap;
    const formatAvail = available >= 1000 ? '1,000' : available;

    document.getElementById('stat-active').innerHTML = `${count} <span class="text-xs font-normal text-slate-500">/ ${formatMax}</span>`;
    document.getElementById('stat-available').innerHTML = `${formatAvail} <span class="text-xs font-normal text-slate-500">/ ${formatMax}</span>`;
    document.getElementById('stat-threads').innerText = count;
}

function resetMeters() {
    const maxCap = getMaxCapacity();
    const formatMax = maxCap >= 1000 ? '1k' : maxCap;
    const formatAvail = maxCap >= 1000 ? '1,000' : maxCap;

    document.getElementById('cpu-bar').style.width = `12%`;
    document.getElementById('cpu-text').innerText = `12%`;
    document.getElementById('ram-bar').style.width = `8%`;
    document.getElementById('ram-text').innerText = `420 MB / 8.0 GB`;

    document.getElementById('response-bar').style.width = `15%`;
    document.getElementById('response-bar-text').innerText = `-- ms (Standby)`;

    document.getElementById('stat-response').innerText = `-- ms`;
    document.getElementById('stat-latency').innerText = `-- ms`;
    document.getElementById('stat-active').innerHTML = `0 <span class="text-xs font-normal text-slate-500">/ ${formatMax}</span>`;
    document.getElementById('stat-available').innerHTML = `${formatAvail} <span class="text-xs font-normal text-slate-500">/ ${formatMax}</span>`;
    document.getElementById('stat-threads').innerText = `0`;
}

// -------------------- Architecture Detail Panel --------------------
function highlightArchStep(step) {
    const title = document.getElementById('arch-title');
    const desc = document.getElementById('arch-desc');

    const details = {
        frontend: {
            title: '<i class="fa-solid fa-desktop text-blue-400"></i> 01. Client Dashboard',
            desc: 'Front-end control panel transmitting parameter configs via JSON HTTP/WebSocket sockets.'
        },
        orchestrator: {
            title: '<i class="fa-solid fa-server text-purple-400"></i> 02. Node.js Master Server',
            desc: 'Task distribution daemon balancing join rate limits and Playwright workers.'
        },
        workers: {
            title: '<i class="fa-brands fa-docker text-cyan-400"></i> 03. Playwright Worker Cluster',
            desc: 'Isolated Chromium contexts executing DOM form fills and maintaining WebSocket connections.'
        },
        target: {
            title: '<i class="fa-solid fa-cloud text-emerald-400"></i> 04. Target Server Endpoint',
            desc: 'Destination host server receiving active automated browser worker connections.'
        }
    };

    if (details[step]) {
        title.innerHTML = details[step].title;
        desc.innerText = details[step].desc;
    }
}

// -------------------- Copy Code Button --------------------
function copyCode() {
    const codeText = document.getElementById('code-block').innerText;
    navigator.clipboard.writeText(codeText).then(() => {
        const btnText = document.getElementById('copy-text');
        btnText.innerText = 'Copied to Clipboard';
        setTimeout(() => { btnText.innerText = 'Copy Node.js Server'; }, 2000);
    });
}

