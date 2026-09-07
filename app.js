const STORAGE_KEY = "logogram-demo-state";
const SESSION_KEY = "logogram-session";
const SESSION_PASSWORD_KEY = "logogram-session-password";
const SOCKET_URL = location.protocol === "file:" ? "ws://localhost:3000" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

const seedUsers = [
  { username: "test1", password: "SPIDER200", role: "admin", name: "Maya Chen", bio: "Designing small things with care.", initials: "MC", color: "#d97963", online: true },
  { username: "admin", password: "SPIDER500", name: "Ari Morgan", bio: "Keeping the signal clear.", initials: "AM", color: "#9370b2", online: false }
];

const seedMessages = { admin: [] };

let state = loadState();
let currentUser = null;
let selectedChat = null;
let typingTimer = null;
let pendingAttachment = null;
let socket = null;
let pendingAuthPassword = "";
let peerConnection = null;
let localStream = null;
let callPeer = null;
let callRole = null;
let pendingCallSignals = [];
let draftText = "";
let mobileChatOpen = false;
let reconnectTimer = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (error) { /* reset malformed demo data */ }
  return { users: seedUsers, messages: seedMessages, unread: { admin: 1 }, theme: "light" };
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function getUser(username) { return state.users.find(user => user.username === username); }
function getInitials(user) { return user.initials || user.name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function escapeHtml(value = "") { return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
function formatTime() { return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date()); }
function otherUser() { return getUser(selectedChat); }

function connectToServer() {
  if (!currentUser || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  socket = new WebSocket(SOCKET_URL);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "login", username: currentUser.username, password: currentUser.password })));
  socket.addEventListener("message", event => handleServerMessage(JSON.parse(event.data)));
  socket.addEventListener("close", () => {
    socket = null;
    if (localStorage.getItem(SESSION_KEY)) {
      showToast("Переподключаемся к серверу...");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectToServer, 1500);
    }
  });
  socket.addEventListener("error", () => showToast("Не удалось подключиться к серверу"));
}

function connectForAuth(payload) {
  if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
  socket = new WebSocket(SOCKET_URL);
  socket.addEventListener("open", () => socket.send(JSON.stringify(payload)));
  socket.addEventListener("message", event => handleServerMessage(JSON.parse(event.data)));
  socket.addEventListener("error", () => showToast("Не удалось подключиться к серверу"));
}

function handleServerMessage(payload) {
  if (payload.type === "auth_error") { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_PASSWORD_KEY); return renderAuth("login"); }
  if (payload.type === "auth_ok") {
    const localPassword = currentUser?.password || pendingAuthPassword || localStorage.getItem(SESSION_PASSWORD_KEY);
    if (!currentUser) {
      currentUser = { ...payload.user, password: localPassword };
      localStorage.setItem(SESSION_KEY, currentUser.username);
    }
    localStorage.setItem(SESSION_PASSWORD_KEY, localPassword || "");
    state.users = payload.users;
    const sessionUser = state.users.find(user => user.username === currentUser.username);
    if (sessionUser) sessionUser.password = localPassword;
    state.messages = {};
    state.unread = {};
    Object.entries(payload.messages || {}).forEach(([key, conversation]) => {
      const participants = key.split(":");
      const peer = participants.find(username => username !== currentUser.username);
      if (peer) state.messages[peer] = conversation;
    });
    saveState(); render(); return;
  }
  if (payload.type === "users") {
    const password = currentUser?.password || getUser(currentUser?.username)?.password;
    state.users = payload.users;
    const sessionUser = state.users.find(user => user.username === currentUser?.username);
    if (sessionUser && password) sessionUser.password = password;
    saveState(); render(); return;
  }
  if (payload.type === "message") {
    const message = payload.message;
    const peer = message.from === currentUser.username ? message.to : message.from;
    state.messages[peer] = [...(state.messages[peer] || []), message];
    if (peer !== selectedChat && message.from !== currentUser.username) state.unread[peer] = (state.unread[peer] || 0) + 1;
    saveState(); render();
    if (message.from !== currentUser.username) showToast(`Новое сообщение от ${getUser(peer)?.name || peer}`);
  }
  if (payload.type === "typing" && payload.from === selectedChat) {
    const target = document.querySelector("[data-typing]");
    if (target) target.innerHTML = payload.active ? '<span class="typing-dots"><i></i><i></i><i></i></span>печатает...' : "";
  }
  if (["call", "call-accept", "call-reject", "call-signal", "call-end"].includes(payload.type)) handleCallSignal(payload);
}
function avatar(user, className = "avatar") {
  const image = user.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}" />` : escapeHtml(getInitials(user));
  return `<div class="${className}" style="--avatar:${user.color || "#547a79"}">${image}</div>`;
}

function render() {
  document.documentElement.dataset.theme = state.theme || "light";
  const keepMobileChatOpen = mobileChatOpen || document.querySelector("[data-app-frame]")?.classList.contains("mobile-chat-open");
  currentUser = state.users.find(user => user.username === localStorage.getItem(SESSION_KEY));
  if (currentUser && !currentUser.password) currentUser.password = localStorage.getItem(SESSION_PASSWORD_KEY) || "";
  if (!currentUser) return renderAuth("login");
  connectToServer();
  if (!selectedChat || !getUser(selectedChat)) selectedChat = state.users.find(user => user.username !== currentUser.username)?.username;
  document.querySelector("#app").innerHTML = appTemplate();
  if (keepMobileChatOpen) document.querySelector("[data-app-frame]").classList.add("mobile-chat-open");
  bindAppEvents();
}

function renderAuth(mode) {
  document.querySelector("#app").innerHTML = `<main class="auth-page">
    <div class="logo-row"><div class="brand-mark">L</div><div><div class="logo-name">Logogram Connect</div><p class="eyebrow">Conversations that feel alive</p></div></div>
    <div class="auth-copy"><h1>${mode === "login" ? "Welcome back" : "Make room for good talk"}</h1><p>${mode === "login" ? "Pick up where you left off." : "Create your place for thoughtful conversations."}</p></div>
    <form class="auth-form" data-auth-form>
      <label class="field-label">Username<input class="field" name="username" autocomplete="username" placeholder="your username" required /></label>
      <label class="field-label">Password<input class="field" name="password" type="password" autocomplete="current-password" placeholder="your password" required /></label>
      ${mode === "register" ? '<label class="field-label">Display name<input class="field" name="name" placeholder="How should people see you?" required /></label>' : ""}
      <button class="primary-button" type="submit">${mode === "login" ? "Enter Logogram Connect" : "Create account"}</button>
    </form>
    <div class="auth-switch">${mode === "login" ? "New here?" : "Already have an account?"} <button class="text-button" data-auth-toggle>${mode === "login" ? "Create an account" : "Sign in"}</button></div>
  </main>`;
  document.querySelector("[data-auth-form]").addEventListener("submit", event => handleAuth(event, mode));
  document.querySelector("[data-auth-toggle]").addEventListener("click", () => renderAuth(mode === "login" ? "register" : "login"));
}

function handleAuth(event, mode) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get("username")).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const password = String(form.get("password"));
  if (mode === "login") {
    const storedUser = getUser(username);
    const builtInUser = seedUsers.find(item => item.username === username);
    const user = builtInUser || storedUser;
    if (!user || user.password !== password) return showToast("That username or password did not match.");
    if (!storedUser) state.users.push({ ...user });
    else if (!storedUser.password) storedUser.password = user.password;
    localStorage.setItem(SESSION_KEY, username); localStorage.setItem(SESSION_PASSWORD_KEY, password); selectedChat = state.users.find(item => item.username !== username)?.username; render();
    return;
  }
  if (username.length < 3 || getUser(username)) return showToast("Choose a unique username with at least 3 letters.");
  const name = String(form.get("name")).trim() || username;
  const user = { username, password, name, bio: "New around here.", initials: name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase(), color: "#0b8f85", online: true };
  pendingAuthPassword = password;
  connectForAuth({ type: "register", username, password, name });
}

function appTemplate() {
  const contactUsers = state.users.filter(user => user.username !== currentUser.username);
  return `<div class="app-frame" data-app-frame>
    <aside class="sidebar">
      <div class="sidebar-top"><div class="top-actions"><div class="logo-row"><div class="brand-mark">L</div><div><div class="logo-name">Logogram Connect</div><p class="eyebrow">A quieter kind of social</p></div></div><button class="icon-button" data-theme-toggle title="Toggle theme">${state.theme === "dark" ? "☼" : "☾"}</button></div>
        <label class="search-box"><span>⌕</span><input data-search-input placeholder="Search by @username" autocomplete="off" /></label>
        <div class="section-label"><span>Your conversations</span><span class="status-dot"></span></div><div class="search-results" data-search-results hidden></div>
      </div><div class="chat-list" data-chat-list>${contactUsers.map(chatRow).join("")}</div>
      <div class="account-card">${avatar(currentUser)}<div class="account-copy"><div class="account-name">${escapeHtml(currentUser.name)}</div><div class="account-handle">@${currentUser.username}</div></div><button class="icon-button" data-logout title="Sign out">↗</button></div>
    </aside>
    <main class="chat-panel">${chatHeader()}<div class="message-area" data-message-area>${messageTemplate()}</div>${composerTemplate()}</main>
    <aside class="profile-panel" data-profile-panel>${profileTemplate(otherUser())}</aside>
  </div>`;
}

function chatRow(user) {
  const messages = state.messages[user.username] || [];
  const last = messages[messages.length - 1];
  const preview = last ? (last.attachment ? `Attachment: ${last.attachment.name}` : last.text) : "Start a new conversation";
  const count = state.unread[user.username] || 0;
  return `<button class="chat-row ${selectedChat === user.username ? "active" : ""}" data-chat="${user.username}">${avatar(user)}<div class="chat-copy"><div class="chat-name-line"><span class="chat-name">${escapeHtml(user.name)}</span><span class="chat-time">${last?.time || ""}</span></div><div class="chat-meta"><span class="chat-preview">${escapeHtml(preview)}</span>${count ? `<span class="unread">${count}</span>` : ""}</div></div></button>`;
}

function chatHeader() {
  const user = otherUser();
  return `<header class="chat-header"><button class="icon-button mobile-back" data-back>‹</button>${avatar(user)}<div class="header-copy"><div class="header-name">${escapeHtml(user.name)}</div><div class="header-status ${user.online ? "online" : ""}"><span class="status-dot"></span>${user.online ? "Online now" : "Last seen recently"}</div></div><div class="header-tools"><button class="icon-button" data-call title="Start audio call">☎</button><button class="icon-button profile-toggle" data-profile-toggle title="View profile">ⓘ</button><button class="icon-button" data-theme-toggle title="Toggle theme">${state.theme === "dark" ? "☼" : "☾"}</button></div></header>`;
}

function messageTemplate() {
  const messages = state.messages[selectedChat] || [];
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  if (!messages.length) return `<div class="date-divider">${today}</div><div class="empty-state">No messages yet. Say hello to ${escapeHtml(otherUser().name.split(" ")[0])}.</div>`;
  return `<div class="date-divider">${today}</div>${messages.map(message => { const mine = message.from === currentUser.username; return `<div class="message ${mine ? "mine" : ""}"><div class="message-bubble">${message.attachment ? (message.attachment.type?.startsWith("image/") ? `<img class="message-image" src="${message.attachment.data}" alt="${escapeHtml(message.attachment.name)}" />` : `<div class="message-file"><span class="file-icon">□</span><span class="file-name">${escapeHtml(message.attachment.name)}</span></div>`) : ""}${message.text ? `<div class="message-text">${escapeHtml(message.text)}</div>` : ""}<div class="message-meta"><span>${escapeHtml(message.time)}</span>${mine ? `<span class="read-mark">✓✓</span>` : ""}</div></div></div>`; }).join("")}<div class="typing-row" data-typing></div>`;
}

function composerTemplate() { return `<form class="composer" data-composer><div class="composer-box"><button type="button" class="attachment-button" data-attach title="Attach a photo or file">＋</button><textarea data-message-input rows="1" placeholder="Write a message..." aria-label="Message">${escapeHtml(draftText)}</textarea><button type="button" class="attachment-button" data-emoji title="Add emoji">☺</button></div><button class="send-button" type="submit" title="Send message">↑</button><input type="file" data-file-input hidden /></form>`; }

function profileTemplate(user) {
  return `<div class="profile-top"><div class="profile-top-label">Conversation profile</div></div><div class="profile-content">${avatar(user, "avatar profile-avatar")}<div class="profile-name">${escapeHtml(user.name)}</div><div class="profile-handle">@${user.username}${user.role === "admin" ? " · Administrator" : ""}</div><p class="profile-bio">${escapeHtml(user.bio || "No bio yet.")}</p><div class="profile-section"><div class="profile-section-title">Details</div><div class="detail-row"><span class="detail-icon">◉</span><div class="detail-copy"><strong>${user.online ? "Online now" : "Away for a while"}</strong><span>Presence status</span></div></div><div class="detail-row"><span class="detail-icon">⌁</span><div class="detail-copy"><strong>${user.role === "admin" ? "Administrator" : "Member since 2024"}</strong><span>${user.role === "admin" ? "Account role" : "Part of the Logogram circle"}</span></div></div></div><div class="profile-section profile-actions"><button class="secondary-button" data-edit-profile>Edit my profile</button><button class="secondary-button" data-clear-chat>Clear conversation</button></div></div>`;
}

function bindAppEvents() {
  document.querySelectorAll("[data-chat]").forEach(button => button.addEventListener("click", () => { selectedChat = button.dataset.chat; mobileChatOpen = true; state.unread[selectedChat] = 0; saveState(); render(); document.querySelector("[data-app-frame]").classList.add("mobile-chat-open"); }));
  document.querySelectorAll("[data-theme-toggle]").forEach(button => button.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; saveState(); render(); }));
  document.querySelector("[data-logout]").addEventListener("click", () => { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_PASSWORD_KEY); socket?.close(); render(); });
  document.querySelector("[data-composer]").addEventListener("submit", event => { event.preventDefault(); sendMessage(); });
  document.querySelector("[data-call]").addEventListener("click", startCall);
  document.querySelector("[data-message-input]").addEventListener("input", event => { draftText = event.target.value; handleTyping(event); });
  document.querySelector("[data-attach]").addEventListener("click", () => document.querySelector("[data-file-input]").click());
  document.querySelector("[data-file-input]").addEventListener("change", handleAttachment);
  document.querySelector("[data-emoji]").addEventListener("click", () => { const input = document.querySelector("[data-message-input]"); input.value += " ✦"; input.focus(); });
  document.querySelector("[data-profile-toggle]").addEventListener("click", () => document.querySelector("[data-profile-panel]").classList.toggle("is-open"));
  document.querySelector("[data-back]").addEventListener("click", () => { mobileChatOpen = false; document.querySelector("[data-app-frame]").classList.remove("mobile-chat-open"); });
  document.querySelector("[data-edit-profile]").addEventListener("click", editProfile);
  document.querySelector("[data-clear-chat]").addEventListener("click", clearConversation);
  document.querySelector("[data-search-input]").addEventListener("input", handleSearch);
  scrollToBottom();
}

function sendCallSignal(type, to, extra = {}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, to, ...extra }));
}

async function createPeerConnection(peer, initiator) {
  callPeer = peer;
  peerConnection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peerConnection.onicecandidate = event => { if (event.candidate) sendCallSignal("call-signal", peer, { signal: { candidate: event.candidate } }); };
  peerConnection.ontrack = event => { const audio = document.querySelector("[data-call-audio]"); if (audio) { audio.srcObject = event.streams[0]; audio.play().catch(() => {}); } };
  peerConnection.onconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) endCall(false); };
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  if (initiator) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendCallSignal("call-signal", peer, { signal: { description: peerConnection.localDescription } });
  }
}

async function startCall() {
  if (!otherUser()) return showToast("Пользователь не найден");
  if (!navigator.mediaDevices?.getUserMedia) return showToast("Браузер не поддерживает аудиозвонки");
  try { callRole = "caller"; callPeer = selectedChat; renderCallOverlay(`Звоним ${otherUser().name}...`); sendCallSignal("call", selectedChat); await createPeerConnection(selectedChat, true); } catch { endCall(true); showToast("Нет доступа к микрофону"); }
}

async function acceptCall(from) {
  hideCallOverlay();
  try { callRole = "callee"; callPeer = from; sendCallSignal("call-accept", from); renderCallOverlay(`Разговор с ${getUser(from)?.name || from}`); await createPeerConnection(from, false); for (const signal of pendingCallSignals.splice(0)) await handleCallSignal(signal); } catch { sendCallSignal("call-reject", from); endCall(false); showToast("Нет доступа к микрофону"); }
}

async function handleCallSignal(payload) {
  if (payload.type === "call") return renderIncomingCall(payload.from);
  if (payload.type === "call-reject") { endCall(false); return showToast("Звонок отклонён"); }
  if (payload.type === "call-end") return endCall(false);
  if (payload.type === "call-accept" && callRole === "caller") return renderCallOverlay(`Разговор с ${getUser(payload.from)?.name || payload.from}`);
  if (payload.type !== "call-signal") return;
  if (!peerConnection) { pendingCallSignals.push(payload); return; }
  const signal = payload.signal;
  if (signal.description) {
    await peerConnection.setRemoteDescription(signal.description);
    if (signal.description.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      sendCallSignal("call-signal", payload.from, { signal: { description: peerConnection.localDescription } });
    }
  }
  if (signal.candidate) await peerConnection.addIceCandidate(signal.candidate);
}

function renderIncomingCall(from) {
  document.querySelector("[data-incoming-call]")?.remove();
  const box = document.createElement("div"); box.className = "incoming-call"; box.dataset.incomingCall = "";
  box.innerHTML = `<strong>Входящий звонок</strong><span>${escapeHtml(getUser(from)?.name || from)} звонит вам</span><div><button data-accept-call>Принять</button><button data-reject-call>Отклонить</button></div>`;
  document.body.appendChild(box);
  box.querySelector("[data-accept-call]").onclick = () => acceptCall(from);
  box.querySelector("[data-reject-call]").onclick = () => { sendCallSignal("call-reject", from); box.remove(); };
}

function renderCallOverlay(label) {
  hideCallOverlay();
  const box = document.createElement("div"); box.className = "call-overlay"; box.dataset.callOverlay = "";
  box.innerHTML = `<span class="call-pulse">☎</span><strong>${escapeHtml(label)}</strong><button data-end-call>Завершить</button><audio data-call-audio autoplay></audio>`;
  document.body.appendChild(box); box.querySelector("[data-end-call]").onclick = () => endCall(true);
}

function hideCallOverlay() { document.querySelector("[data-call-overlay]")?.remove(); document.querySelector("[data-incoming-call]")?.remove(); }
function endCall(notifyPeer) { if (notifyPeer && callPeer) sendCallSignal("call-end", callPeer); localStream?.getTracks().forEach(track => track.stop()); peerConnection?.close(); localStream = null; peerConnection = null; callPeer = null; callRole = null; pendingCallSignals = []; hideCallOverlay(); }

function sendMessage() {
  const input = document.querySelector("[data-message-input]");
  const text = input.value.trim();
  if (!text && !pendingAttachment) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast("Сервер недоступен. Запустите Logogram server.");
  socket.send(JSON.stringify({ type: "message", to: selectedChat, text, attachment: pendingAttachment }));
  input.value = "";
  draftText = "";
  pendingAttachment = null;
}

function handleTyping(event) {
  const target = document.querySelector("[data-typing]");
  if (!target) return;
  target.innerHTML = event.target.value ? '<span class="typing-dots"><i></i><i></i><i></i></span>typing...' : "";
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "typing", to: selectedChat, active: Boolean(event.target.value) }));
  clearTimeout(typingTimer); typingTimer = setTimeout(() => { if (target) target.innerHTML = ""; }, 1200);
}

function handleAttachment(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = () => { pendingAttachment = { name: file.name, type: file.type, data: reader.result }; showToast(`${file.name} is ready to send`); }; reader.readAsDataURL(file); event.target.value = "";
}

function handleSearch(event) {
  const query = event.target.value.trim().replace(/^@/, "").toLowerCase(); const results = document.querySelector("[data-search-results]");
  if (!query) { results.hidden = true; return; }
  const matches = state.users.filter(user => user.username !== currentUser.username && user.username.includes(query)); results.hidden = false; results.innerHTML = matches.length ? matches.map(user => `<button class="search-result" data-search-chat="${user.username}">${avatar(user)}<span><strong>${escapeHtml(user.name)}</strong><br><small>@${user.username}</small></span></button>`).join("") : "No users found";
  results.querySelectorAll("[data-search-chat]").forEach(button => button.addEventListener("click", () => { selectedChat = button.dataset.searchChat; state.unread[selectedChat] = 0; saveState(); render(); }));
}

function editProfile() {
  const name = window.prompt("Display name", currentUser.name); if (name === null || !name.trim()) return;
  const bio = window.prompt("Short bio", currentUser.bio); currentUser.name = name.trim(); if (bio !== null) currentUser.bio = bio.trim(); currentUser.initials = getInitials(currentUser); saveState(); render(); showToast("Profile updated");
}

function clearConversation() { if (!window.confirm("Clear this conversation from the demo?")) return; state.messages[selectedChat] = []; saveState(); render(); showToast("Conversation cleared"); }
function scrollToBottom() { const area = document.querySelector("[data-message-area]"); if (area) area.scrollTop = area.scrollHeight; }
function showToast(message) { const region = document.querySelector("#toast-region"); const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; region.appendChild(toast); window.setTimeout(() => toast.remove(), 2800); }

render();
