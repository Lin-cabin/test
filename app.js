const actionCards = document.querySelectorAll(".action-card");
const actionRail = document.querySelector(".action-rail");
const characterArea = document.querySelector(".character-area");
const characterImg = document.querySelector(".character-img");
const speechBubble = document.querySelector(".speech-bubble");
const navItems = document.querySelectorAll(".nav-item");
const interactionPanel = document.querySelector(".interaction-panel");
const profilePanel = document.querySelector(".profile-panel");
const panelClose = document.querySelector(".panel-close");
const messageList = document.querySelector(".chat-messages");
const messageInput = document.querySelector(".chat-input");
const sendButton = document.querySelector(".chat-send");
const phone = document.querySelector(".phone");
const stickyNote = document.querySelector(".sticky-note");
const stickyHeader = document.querySelector(".sticky-note-header");
const bgmAudio = document.getElementById("bgm");
const bgmToggle = document.querySelector(".bgm-toggle");
const bgmIcon = document.querySelector(".bgm-icon");
const HOME_TRANSITION_MS = 560;
const BGM_VOLUME = 0.18;

const videoEls = {
  idle:   document.getElementById("video-idle"),
  feed:   document.getElementById("video-feed"),
  play:   document.getElementById("video-play"),
  outfit: document.getElementById("video-outfit"),
  odaiji: document.getElementById("video-odaiji"),
};

// 播完后跳转的下一个状态
const nextActionMap = {
  outfit: "odaiji",
  feed:   "idle",
  play:   "idle",
};

const bubbleTexts = {
  feed:   "唔，还行吧～你喂的我都喜欢，下次也要这样呀。",
  play:   "陪我玩一会儿嘛～我才没有一直在等你……就一点点。",
  outfit: "我就路过换了个造型啦，你要多看我一会儿吗？",
};
const chatHistory = [];

const displayReplacements = [
  [/暴\s*君/g, "小领主"],
  [/铲\s*屎\s*的/g, "小家伙"],
  [/本\s*大\s*人/g, "我"],
  [/本\s*座/g, "我"],
  [/你\s*主\s*子/g, "这位"],
  [/朕/g, "我"],
  [/本\s*王/g, "我"],
  [/老\s*子/g, "我"],
  [/仆\s*人/g, "这位"],
  [/小\s*跟\s*班/g, "小家伙"],
  [/切/g, "唔"],
  [/呵/g, "唔"],
  [/啧/g, "唔"],
];

let bubbleTimer, bubbleShowTimer;
let currentAction = null;
let isHomeCollapsed = false;
let currentTab = "home";
let interactOpenTimer = null;
let isSettingsView = false;
let isProfileView = false;
let uiAudioCtx = null;
let isBgmMutedByUser = false;

if (bgmAudio) {
  bgmAudio.volume = BGM_VOLUME;
}

function getUiAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!uiAudioCtx) uiAudioCtx = new Ctx();
  return uiAudioCtx;
}

function playUiSound(kind = "tap") {
  const ctx = getUiAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const isBubble = kind === "bubble";
  osc.type = isBubble ? "sine" : "triangle";
  osc.frequency.setValueAtTime(isBubble ? 760 : 540, now);
  osc.frequency.exponentialRampToValueAtTime(isBubble ? 980 : 420, now + 0.06);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(isBubble ? 0.08 : 0.05, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.12);
}

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest("button")) {
    playUiSound("tap");
  }

  // 全局点击仅用于：在用户未手动静音的情况下，尝试恢复因自动播放策略被阻止的 BGM
  if (bgmAudio && !isBgmMutedByUser) {
    if (bgmAudio.paused) {
      bgmAudio.play()
        .then(() => {
          // 播放成功，更新按钮状态
          if (bgmToggle) bgmToggle.classList.remove("muted");
        })
        .catch(() => {
        // still blocked or user interaction not sufficient
      });
    }
  }
});

// BGM 按钮控制
if (bgmToggle && bgmAudio) {
  // 默认尝试自动播放（遵循浏览器策略，可能需要用户交互后才生效）
  bgmAudio.play()
    .then(() => {
      bgmToggle.classList.remove("muted");
      isBgmMutedByUser = false;
    })
    .catch(() => {
      // 自动播放被阻止，置为静音状态等待交互
      bgmToggle.classList.add("muted");
      isBgmMutedByUser = false; // 注意：虽然静音了，但不是用户主动关的，所以只要一点击就能恢复
    });

  bgmToggle.addEventListener("click", (e) => {
    e.stopPropagation(); // 防止冒泡到 document click
    if (bgmAudio.paused) {
      // 用户主动开启
      bgmAudio.play().catch(() => {});
      bgmToggle.classList.remove("muted");
      isBgmMutedByUser = false;
    } else {
      // 用户主动关闭
      bgmAudio.pause();
      bgmToggle.classList.add("muted");
      isBgmMutedByUser = true;
    }
  });
}

function clearInteractOpenTimer() {
  if (interactOpenTimer) {
    clearTimeout(interactOpenTimer);
    interactOpenTimer = null;
  }
}

function setActiveTab(tab) {
  currentTab = tab;
  if (phone) phone.setAttribute("data-tab", tab);
  navItems.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function enterSettingsView() {
  exitProfileView();
  isSettingsView = true;
  togglePanel(false);
  if (phone) phone.classList.add("settings-mode");
  if (speechBubble) speechBubble.classList.remove("show");
  actionCards.forEach((c) => c.classList.remove("active"));
  if (actionRail) actionRail.style.display = "none";
  if (stickyNote) stickyNote.style.display = "none";
}

function exitSettingsView() {
  if (!isSettingsView) return;
  isSettingsView = false;
  if (phone) phone.classList.remove("settings-mode");
  if (actionRail) actionRail.style.display = "flex";
}

function enterProfileView() {
  isProfileView = true;
  togglePanel(false);
  clearInteractOpenTimer();
  actionCards.forEach((c) => c.classList.remove("active"));
  if (speechBubble) speechBubble.classList.remove("show");
  if (phone) phone.classList.add("profile-mode");
  if (profilePanel) profilePanel.setAttribute("aria-hidden", "false");
  if (stickyNote) stickyNote.style.display = "none";
  switchTo("idle");
}

function exitProfileView() {
  if (!isProfileView) return;
  isProfileView = false;
  if (phone) phone.classList.remove("profile-mode");
  if (profilePanel) profilePanel.setAttribute("aria-hidden", "true");
}

function resetToHomeState({ resetVideo = true } = {}) {
  // 重置到首页状态
  exitProfileView();
  exitSettingsView();
  togglePanel(false);
  actionCards.forEach((c) => c.classList.remove("active"));
  if (speechBubble) speechBubble.classList.remove("show");
  if (resetVideo) switchTo("idle");
  if (stickyNote) stickyNote.style.display = "block";
}

function collapseToHome() {
  // 收束时不切视频，避免动画期间视频切换引发卡顿
  resetToHomeState({ resetVideo: false });

  // 进入“关闭态”由 CSS transition 平滑过渡
  if (!phone) return;
  phone.classList.add("home-collapsed");
  isHomeCollapsed = true;
}

function expandFromHome() {
  if (!phone) {
    isHomeCollapsed = false;
    return;
  }

  phone.classList.remove("home-collapsed");
  isHomeCollapsed = false;

  // 弹出后回到首页待机
  resetToHomeState({ resetVideo: true });
}

// ─── 核心播放函数 ───────────────────────────────────────────
function switchTo(action) {
  currentAction = action;
  if (characterArea) characterArea.dataset.state = action;

  const v = videoEls[action];
  if (!v) {
    Object.values(videoEls).forEach((video) => {
      if (!video) return;
      video.pause();
      video.style.display = "none";
    });
    if (characterImg) characterImg.style.display = "block";
    return;
  }

  if (characterImg) characterImg.style.display = "none";

  Object.entries(videoEls).forEach(([key, video]) => {
    if (!video || key === action) return;
    video.pause();
    video.style.display = "none";
  });

  if (!v.loop) {
    v.currentTime = 0;
  }

  v.style.display = "block";
  v.play().catch((e) => {
    if (e.name !== "AbortError") console.error("play failed:", action, e);
  });
}

// ─── UI 交互 ──────────────────────────────────────────────
const showBubbleText = (text, { duration = 1800, withSound = true } = {}) => {
  if (!speechBubble || !text) return;
  clearTimeout(bubbleTimer);
  clearTimeout(bubbleShowTimer);
  speechBubble.classList.remove("show");
  bubbleShowTimer = setTimeout(() => {
    speechBubble.textContent = text;
    speechBubble.classList.add("show");
    if (withSound) playUiSound("bubble");
    if (duration > 0) {
      bubbleTimer = setTimeout(() => speechBubble.classList.remove("show"), duration);
    }
  }, 120);
};

const showSpeech = (action) => {
  const text = bubbleTexts[action];
  if (!text) return;
  showBubbleText(text, { duration: 1800, withSound: true });
};

actionCards.forEach((card) => {
  card.addEventListener("click", () => {
    exitProfileView();
    exitSettingsView();
    actionCards.forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    const action = card.dataset.action;
    switchTo(action);
    setTimeout(() => showSpeech(action), 600);
  });
});

const togglePanel = (visible) => {
  if (!interactionPanel) return;
  interactionPanel.classList.toggle("show", visible);
};

const appendMessage = (text, type) => {
  if (!messageList || !text) return;
  const item = document.createElement("div");
  item.className = `chat-message ${type}`;
  item.textContent = text;
  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
};

const normalizeDisplayReply = (text) => {
  let result = String(text || "");
  for (const [pattern, to] of displayReplacements) {
    result = result.replaceAll(pattern, to);
  }
  return result.trim();
};

const handleSend = async () => {
  if (!messageInput) return;
  const content = messageInput.value.trim();
  if (!content) return;

  const historyForRequest = chatHistory.slice(-10);
  chatHistory.push({ role: "user", content });
  messageInput.value = "";

  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "发送中...";
  }

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: content,
        // 只传“发送前”的历史，避免当前用户消息在后端被重复拼接
        history: historyForRequest,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `请求失败 (${resp.status})`);
    }

    const rawReply = String(data.reply || "").trim();
    const reply = normalizeDisplayReply(rawReply) || "我暂时不知道怎么回答这个问题。";
    chatHistory.push({ role: "assistant", content: reply });
    showBubbleText(reply, { duration: 5600, withSound: true });
  } catch (err) {
    const tip = `连接 DeepSeek 失败：${err.message || err}`;
    showBubbleText(tip, { duration: 5600, withSound: true });
  } finally {
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "发送";
    }
  }
};

function handleTabSwitch(tab) {
  // Home：切回首页界面，但不触发收缩/展开动画
  if (tab === "home") {
    clearInteractOpenTimer();
    setActiveTab("home");
    if (phone) phone.classList.remove("home-collapsed");
    isHomeCollapsed = false;
    resetToHomeState({ resetVideo: true });
    return;
  }

  const isInteractVisible = interactionPanel?.classList.contains("show");
  clearInteractOpenTimer();

  // 再次点击 Interact：关闭对话框并回到 Home 态
  if (tab === "interact" && currentTab === "interact" && isInteractVisible) {
    togglePanel(false);
    setActiveTab("home");
    return;
  }

  if (tab === "settings") {
    const shouldExpand = isHomeCollapsed || phone?.classList.contains("home-collapsed");
    if (shouldExpand) expandFromHome();
    setActiveTab("settings");
    enterSettingsView();
    return;
  }

  if (tab === "profile") {
    const shouldExpand = isHomeCollapsed || phone?.classList.contains("home-collapsed");
    if (shouldExpand) expandFromHome();
    exitSettingsView();
    setActiveTab("profile");
    enterProfileView();
    return;
  }

  // 若处于“已收束关闭”状态，切其它 tab 时先弹出
  const shouldExpand = isHomeCollapsed || phone?.classList.contains("home-collapsed");
  if (shouldExpand) {
    expandFromHome();
  }

  exitProfileView();
  exitSettingsView();
  setActiveTab(tab);

  // 与 Home 弹出动效错开，避免视觉跳变
  if (shouldExpand && tab === "interact") {
    interactOpenTimer = setTimeout(() => {
      if (currentTab === "interact" && !isHomeCollapsed) togglePanel(true);
      interactOpenTimer = null;
    }, Math.round(HOME_TRANSITION_MS * 0.45));
  } else {
    togglePanel(tab === "interact");
  }

  // 非 Home tab 隐藏 stickyNote
  if (tab !== "home") {
    if (stickyNote) stickyNote.style.display = "none";
  } else {
    // 切回 home 时恢复显示
    if (stickyNote) stickyNote.style.display = "block";
  }
}

if (stickyHeader && stickyNote) {
  stickyHeader.addEventListener("click", () => {
    stickyNote.classList.toggle("collapsed");
  });
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const tab = item.dataset.tab;
    handleTabSwitch(tab);
  });
});

if (panelClose) {
  panelClose.addEventListener("click", () => {
    clearInteractOpenTimer();
    togglePanel(false);
    setActiveTab("home");
  });
}

if (sendButton) sendButton.addEventListener("click", handleSend);
if (messageInput) {
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });
}

// 初始启动 wait.webm
const idleVideo = videoEls["idle"];

Object.values(videoEls).forEach((v) => {
  if (!v) return;
  v.preload = "auto";
  v.load();
  v.style.display = "none";
});

if (idleVideo) {
  idleVideo.style.display = "block";
  idleVideo.play().catch((e) => console.log("自动播放被阻止，需用户交互", e));
  currentAction = "idle";
  if (characterArea) characterArea.dataset.state = "idle";
}

setActiveTab(currentTab);

function wireAutoTransition(from, to) {
  const v = videoEls[from];
  if (!v) return;

  v.addEventListener("ended", () => {
    if (currentAction === from) switchTo(to);
  });
}

Object.entries(nextActionMap).forEach(([from, to]) => wireAutoTransition(from, to));
