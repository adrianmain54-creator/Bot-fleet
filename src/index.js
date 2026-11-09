import { BotDurableObject } from "./bot.js";
export { BotDurableObject };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/reset") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/reset"));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/bots" && request.method === "GET") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/ensure_defaults"));
    }

    if (url.pathname === "/api/bots" && request.method === "POST") {
      const { name, instructions } = await request.json();
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/register", { method: "POST", body: JSON.stringify({ name, instructions }) }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/init", { method: "POST", body: JSON.stringify({ name, instructions }) }));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/settings" && request.method === "GET") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/get_github_token"));
    }
    if (url.pathname === "/api/settings" && request.method === "POST") {
      const body = await request.json();
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/set_github_token", { method: "POST", body: JSON.stringify(body) }));
    }

    if (url.pathname.startsWith("/api/bot/") && url.pathname.endsWith("/delete") && request.method === "POST") {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/unregister", { method: "POST", body: JSON.stringify({ name }) }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/delete", { method: "POST" }));
      return Response.json({ ok: true });
    }

    const botMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/(.+)$/);
    if (botMatch) {
      const name = decodeURIComponent(botMatch[1]);
      const rest = botMatch[2];
      const stub = env.BOT.get(env.BOT.idFromName(name));
      const target = new URL("https://bot/" + rest);
      target.search = url.search;
      return stub.fetch(new Request(target, request));
    }

    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  },
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Grok Fleet">
<title>Grok Fleet</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000000; --surface: #0a0a0a; --border: #222222;
    --text: #f5f5f5; --text-dim: #888888; --accent-bg: #1a1a1a; --user-bubble: #1c1c1e;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, sans-serif; overflow: hidden; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; justify-content: space-between; padding: calc(env(safe-area-inset-top) + 12px) 20px 12px; background: rgba(0,0,0,0.8); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
  .logo { font: 700 20px monospace; display: flex; align-items: center; gap: 8px; }
  .logo span { font: 500 11px -apple-system; color: var(--text-dim); background: var(--surface); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); text-transform: uppercase; }
  .btn-icon { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .btn-icon:active { background: #141414; transform: scale(0.95); }
  #main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; }
  .tabs { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; margin-bottom: 24px; }
  .tabs button { flex: 1; background: #1a1a1a; border: none; color: #fff; padding: 10px; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .bot-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 20px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .bot-card h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 600; }
  .bot-card p { margin: 0; color: var(--text-dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .bot-actions { display: flex; gap: 8px; align-items: center; }
  .btn-open { background: var(--text); color: var(--bg); border: none; border-radius: 20px; padding: 8px 16px; font-weight: 600; font-size: 13px; }
  .btn-del { background: transparent; color: #ff453a; border: 1px solid #ff453a33; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  #chat { display: none; flex-direction: column; height: 100%; position: relative; }
  #chat header { border-bottom: none; background: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); position: absolute; width: 100%; top: 0; }
  #chat-log { flex: 1; overflow-y: auto; padding: 80px 20px 20px; display: flex; flex-direction: column; gap: 20px; }
  .msg { max-width: 85%; font-size: 16px; line-height: 1.5; white-space: pre-wrap; }
  .msg.user { align-self: flex-end; background: var(--user-bubble); padding: 12px 18px; border-radius: 20px 20px 4px 20px; }
  .msg.bot { align-self: flex-start; padding: 4px 0; }
  .thoughts { align-self: flex-start; max-width: 85%; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 4px; font-size: 13px; }
  .thoughts summary { padding: 10px 14px; cursor: pointer; color: var(--text-dim); font-weight: 500; list-style: none; display: flex; align-items: center; gap: 8px; outline: none; }
  .thoughts summary::-webkit-details-marker { display: none; }
  .thoughts summary:before { content: "▶"; font-size: 10px; transition: transform 0.2s; }
  .thoughts[open] summary:before { transform: rotate(90deg); }
  .thoughts .content { padding: 0 14px 14px; font-family: monospace; color: var(--text-dim); border-top: 1px solid var(--border); margin-top: 4px; padding-top: 10px; }
  .thoughts .content div { margin-bottom: 6px; }
  #chat-bar { padding: 12px 20px calc(env(safe-area-inset-bottom) + 12px); background: rgba(0,0,0,0.8); border-top: 1px solid var(--border); display: flex; gap: 12px; align-items: flex-end; }
  #chat-input { flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 24px; padding: 12px 18px; font: inherit; font-size: 16px; resize: none; max-height: 120px; outline: none; }
  #chat-send { background: var(--text); color: var(--bg); border: none; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
  #chat-send:disabled { opacity: 0.3; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100; align-items: center; justify-content: center; padding: 20px; }
  .modal-box { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; width: 100%; max-width: 400px; }
  .modal-box h2 { margin: 0 0 8px 0; font-size: 20px; }
  .modal-box p { margin: 0 0 16px 0; font-size: 14px; color: var(--text-dim); }
  .modal-box input, .modal-box textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 12px; border-radius: 8px; font-family: inherit; margin-bottom: 16px; outline: none; font-size: 15px; }
  .modal-box textarea { resize: vertical; min-height: 80px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 12px; }
  .modal-actions button { padding: 10px 16px; border-radius: 8px; font-weight: 600; border: none; font-size: 14px; }
  .btn-cancel { background: transparent; color: var(--text-dim); }
  .btn-save { background: var(--text); color: var(--bg); }
  .btn-danger { background: #ff453a22; color: #ff453a; border: 1px solid #ff453a55; width: 100%; margin-top: 10px; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 14px; }
</style>
</head>
<body>
<header id="main-header">
  <div class="logo">Grok<span>Fleet</span></div>
  <div style="display:flex; gap:8px;">
    <button class="btn-icon" onclick="openSettings()">⚙</button>
    <button class="btn-icon" onclick="openNewAgent()">+</button>
  </div>
</header>
<div id="main">
  <div class="tabs"><button>Agents</button></div>
  <div id="list"></div>
</div>
<div id="chat">
  <header>
    <button class="btn-icon" onclick="goBack()" style="border:none; background:none; font-size:20px;">←</button>
    <div class="logo" id="chat-title" style="font-size:18px;"></div>
    <div style="width:36px;"></div>
  </header>
  <div id="chat-log"></div>
  <div id="chat-bar">
    <textarea id="chat-input" rows="1" placeholder="Message..."></textarea>
    <button id="chat-send" onclick="sendMessage()">↑</button>
  </div>
</div>
<div class="modal-overlay" id="modal-settings">
  <div class="modal-box">
    <h2>Settings</h2>
    <p>Paste your GitHub Token.</p>
    <input type="password" id="input-github-token" placeholder="ghp_...">
    <div class="modal-actions" style="margin-bottom:10px;">
      <button class="btn-cancel" onclick="closeModal('modal-settings')">Cancel</button>
      <button class="btn-save" onclick="saveSettings()">Save</button>
    </div>
    <button class="btn-danger" onclick="resetApp()">Reset App</button>
  </div>
</div>
<div class="modal-overlay" id="modal-new-agent">
  <div class="modal-box">
    <h2>New Agent</h2>
    <input type="text" id="input-agent-name" placeholder="Name (no spaces)">
    <textarea id="input-agent-instructions" placeholder="Instructions..."></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('modal-new-agent')">Cancel</button>
      <button class="btn-save" onclick="createAgent()">Create</button>
    </div>
  </div>
</div>
<script>
var currentBot = null;

function api(url, opts) {
  return fetch(url, opts).then(function(r) {
    var ct = r.headers.get('content-type') || '';
    return ct.indexOf('json') > -1 ? r.json() : r.text();
  });
}

function loadBots() {
  api('/api/bots').then(function(bots) {
    if (!Array.isArray(bots)) return document.getElementById('list').innerHTML = '<p style="color:red;text-align:center;">Error. Tap ⚙ to reset.</p>';
    if (!bots.length) return document.getElementById('list').innerHTML = '<p style="color:#888;text-align:center;">No agents yet. Tap + to create one.</p>';
    
    var h = '';
    for (var i = 0; i < bots.length; i++) {
      h += '<div class="bot-card"><div><h3>' + bots[i].name + '</h3><p>' + (bots[i].instructions || '').slice(0, 60) + '</p></div>';
      h += '<div class="bot-actions"><button class="btn-open" onclick="openBot(\'' + bots[i].name + '\')">Chat</button>';
      h += '<button class="btn-del" onclick="deleteBot(\'' + bots[i].name + '\')">✕</button></div></div>';
    }
    document.getElementById('list').innerHTML = h;

    if (!window.auto && bots.length) {
      window.auto = true;
      openBot('chief');
    }
  });
}

function openBot(name) {
  currentBot = name;
  document.getElementById('main').style.display = 'none';
  document.getElementById('main-header').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';
  document.getElementById('chat-title').textContent = name;
  loadLog();
}

function goBack() {
  currentBot = null;
  document.getElementById('chat').style.display = 'none';
  document.getElementById('main').style.display = 'flex';
  document.getElementById('main-header').style.display = 'flex';
  loadBots();
}

function loadLog() {
  if (!currentBot) return;
  api('/api/bot/' + currentBot + '/messages').then(function(msgs) {
    if (!msgs) return;
    var h = '';
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      h += '<div class="msg ' + (m.role === 'assistant' ? 'bot' : m.role) + '">' + m.content + '</div>';
    }
    var log = document.getElementById('chat-log');
    log.innerHTML = h;
    log.scrollTop = log.scrollHeight;
  });
}

function sendMessage() {
  var text = document.getElementById('chat-input').value.trim();
  if (!text || !currentBot) return;
  document.getElementById('chat-input').value = '';
  document.getElementById('chat-input').style.height = 'auto';
  
  var log = document.getElementById('chat-log');
  var u = document.createElement('div');
  u.className = 'msg user'; u.textContent = text;
  log.appendChild(u); log.scrollTop = log.scrollHeight;

  var thoughtsEl = document.createElement('details');
  thoughtsEl.className = 'thoughts';
  thoughtsEl.style.display = 'none';
  var summaryEl = document.createElement('summary');
  summaryEl.textContent = 'Thinking...';
  var contentEl = document.createElement('div');
  contentEl.className = 'content';
  thoughtsEl.appendChild(summaryEl);
  thoughtsEl.appendChild(contentEl);
  log.appendChild(thoughtsEl);

  var botEl = document.createElement('div');
  botEl.className = 'msg bot';
  log.appendChild(botEl); log.scrollTop = log.scrollHeight;

  document.getElementById('chat-send').disabled = true;

  fetch('/api/bot/' + currentBot + '/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: text })
  }).then(function(res) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', acc = '';
    
    function pump() {
      return reader.read().then(function(r) {
        if (r.done) {
          document.getElementById('chat-send').disabled = false;
          return;
        }
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\\n'); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try {
            var o = JSON.parse(lines[i]);
            if (o.type === 'status') {
              thoughtsEl.style.display = 'block';
              var p = document.createElement('div');
              p.textContent = o.text;
              contentEl.appendChild(p);
              summaryEl.textContent = 'Processed steps';
            }
            if (o.type === 'delta') { acc += o.text; botEl.textContent = acc; }
            if (o.type === 'error') { acc += '\\n\\n' + o.text; botEl.textContent = acc; }
          } catch (e) {}
        }
        log.scrollTop = log.scrollHeight;
        return pump();
      });
    }
    return pump();
  }).catch(function(e) {
    botEl.textContent = 'Error: ' + e.message;
    document.getElementById('chat-send').disabled = false;
  });
}

document.getElementById('chat-input').onkeydown = function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
document.getElementById('chat-input').oninput = function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; };

function openSettings() { api('/api/settings').then(function(d) { if (d && d.token) document.getElementById('input-github-token').value = d.token; document.getElementById('modal-settings').style.display = 'flex'; }); }
function saveSettings() { var t = document.getElementById('input-github-token').value.trim(); api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t }) }).then(function() { document.getElementById('modal-settings').style.display = 'none'; }); }
function openNewAgent() { document.getElementById('input-agent-name').value = ''; document.getElementById('input-agent-instructions').value = ''; document.getElementById('modal-new-agent').style.display = 'flex'; }
function createAgent() { var n = document.getElementById('input-agent-name').value.trim(); var i = document.getElementById('input-agent-instructions').value.trim(); if (!n) return alert('Name required'); api('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, instructions: i }) }).then(function() { document.getElementById('modal-new-agent').style.display = 'none'; loadBots(); }); }
function deleteBot(n) { if (!confirm("Delete?")) return; api('/api/bot/' + n + '/delete', { method: 'POST' }).then(loadBots); }
function resetApp() { if (!confirm("Reset?")) return; fetch('/api/reset').then(function() { location.reload(); }); }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

loadBots();
</script>
</body>
</html>`;
