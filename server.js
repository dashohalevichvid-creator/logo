const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const root = __dirname;
const clients = new Map();
const users = new Map([
  ["test1", { username: "test1", password: "SPIDER200", role: "admin", name: "Maya Chen", bio: "Designing small things with care.", initials: "MC", color: "#d97963", online: false }],
  ["admin", { username: "admin", password: "SPIDER500", name: "Ari Morgan", bio: "Keeping the signal clear.", initials: "AM", color: "#9370b2", online: false }]
]);
const messages = new Map();

function publicUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}
function userList() { return [...users.values()].map(publicUser); }
function hasOnlineSession(username) { return [...clients.values()].some(value => value === username); }
function conversationKey(first, second) { return [first, second].sort().join(":"); }
function send(client, payload) { if (client.readyState === 1) client.send(JSON.stringify(payload)); }
function broadcastPresence() {
  const payload = { type: "users", users: userList() };
  for (const client of clients.keys()) send(client, payload);
}
function serveFile(request, response) {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(root, requested.split("?")[0]);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) { response.writeHead(404); response.end("Not found"); return; }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
  response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(serveFile);
const wss = new WebSocketServer({ server });

wss.on("connection", client => {
  client.on("message", raw => {
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return send(client, { type: "error", message: "Invalid message" }); }
    if (payload.type === "register") {
      const username = String(payload.username || "").toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username) || users.has(username)) return send(client, { type: "auth_error", message: "Username is unavailable" });
      const name = String(payload.name || username).slice(0, 80);
      const user = { username, password: String(payload.password || ""), name, bio: "New around here.", initials: name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase(), color: "#0b8f85", online: true };
      users.set(username, user); clients.set(client, username);
      send(client, { type: "auth_ok", user: publicUser(user), users: userList(), messages: Object.fromEntries(messages) });
      broadcastPresence();
      return;
    }
    if (payload.type === "login") {
      const user = users.get(String(payload.username || "").toLowerCase());
      if (!user || user.password !== payload.password) return send(client, { type: "auth_error", message: "Неверный логин или пароль" });
      clients.set(client, user.username); user.online = true;
      send(client, { type: "auth_ok", user: publicUser(user), users: userList(), messages: Object.fromEntries(messages) });
      broadcastPresence();
      return;
    }
    const username = clients.get(client);
    if (!username) return send(client, { type: "error", message: "Сначала войдите в аккаунт" });
    if (payload.type === "message") {
      const recipient = users.get(payload.to);
      if (!recipient || typeof payload.text !== "string") return;
      const item = { id: crypto.randomUUID(), from: username, to: recipient.username, text: payload.text.slice(0, 10000), time: new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date()), read: false, attachment: payload.attachment || null };
      const key = conversationKey(username, recipient.username);
      messages.set(key, [...(messages.get(key) || []), item]);
      for (const [peer, peerUsername] of clients) if (peerUsername === username || peerUsername === recipient.username) send(peer, { type: "message", message: item });
      return;
    }
    if (payload.type === "typing") {
      for (const [peer, peerUsername] of clients) if (peerUsername === payload.to) send(peer, { type: "typing", from: username, active: Boolean(payload.active) });
    }
    if (["call", "call-accept", "call-reject", "call-signal", "call-end"].includes(payload.type)) {
      for (const [peer, peerUsername] of clients) if (peerUsername === payload.to) send(peer, { ...payload, from: username });
    }
  });
  client.on("close", () => { const username = clients.get(client); clients.delete(client); if (username && users.has(username)) users.get(username).online = hasOnlineSession(username); broadcastPresence(); });
});

server.listen(PORT, () => console.log(`Logogram server running at http://localhost:${PORT}`));
