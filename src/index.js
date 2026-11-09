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
    return new Response(HTML, { 
      headers: { 
        "content-type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      } 
    });
  },
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Grok V7">
<title>Grok V7</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000000; --surface: #0a0a0a; --surface-hover: #141414; --border: #222222;
    --text: #f5f5f5; --text-dim: #888888; --accent-bg: #1a1a1a; --user-bubble: #1c1c1e;
    --font-sys: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 var(--font-sys); overflow: hidden; }
  body { display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 12px; padding: calc(env(safe-area-inset-top) + 12px) 20px 12px; background: rgba(0,0,0,0.8); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
  .logo { font: 700 20px var(--font-mono); display: flex; align-items: center; gap: 8px; }
  .logo span { font: 500 11px var(--font-sys); color: var(--text-dim); background: var(--surface); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); text-transform: uppercase; }
  .btn-icon { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .btn-icon:active { background: var(--surface-hover); transform: scale(0.95); }
  #main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; }
  .tabs { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; margin-bottom: 24px; }
  .tabs button { flex: 1; background: transparent; border: none; color: var(--text-dim); padding: 10px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
  .tabs button.active { background: var(--accent-bg); color: var(--text); box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
  .bot-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px 20px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .bot-card:active { background: var(--surface-hover); }
  .bot-card h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 600; }
  .bot-card p { margin: 0; color: var(--text-dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .bot-actions { display: flex; gap: 8px; align-items: center; }
  .btn-open { background: var(--text); color: var(--bg); border: none; border-radius: 20px; padding: 8px 16px; font-weight: 600; font-size: 13px; }
  .btn-del { background: transparent; color: #ff453a; border: 1px solid #ff453a33; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  #chat { display: none; flex-direction: column; height: 100%; background: var(--bg); position: relative; }
  #chat header { border-bottom: none; background: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); position: absolute; width: 100%; top: 0; }
  #chat-log { flex: 1; overflow-y: auto; padding: 80px 20px 20px; display: flex; flex-direction: column; gap: 20px; }
  .msg { max-width: 85%; font-size: 16px; line-height: 1.5; white-space: pre-wrap; }
  .msg.user { align-self: flex-end; background: var(--user-bubble); padding: 12px 18px; border-radius: 20px 20px 4px 20px; }
  .msg.bot { align-self: flex-start; padding: 4px 0; }
  .msg.system { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); background: var(--surface); padding: 10px; border-radius: 8px; align-self: center; max-width: 100%; }
  .thoughts { align-self: flex-start; max-width: 85%; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 4px; font-size: 13px; }
  .thoughts summary { padding: 10px 14px; cursor: pointer; color: var(--text-dim); font-weight: 500; list-style: none; display: flex; align-items: center; gap: 8px; outline: none; }
  .thoughts summary::-webkit-details-marker { display: none; }
  .thoughts summary:before { content: "▶"; font-size: 10px; transition: transform 0.2s; }
  .thoughts[open] summary:before { transform: rotate(90deg); }
  .thoughts .content { padding: 0 14px 14px; font-family: var(--font-mono); color: var(--text-dim); border-top: 1px solid var(--border); margin-top: 4px; padding-top: 10px; }
  .thoughts .content div { margin-bottom: 6px; }
  #chat-bar { padding: 12px 20px calc(env(safe-area-inset-bottom) + 12px); background: rgba(0,0,0,0.8); backdrop-filter: blur(20px); border-top: 1px solid var(--border); display: flex; gap: 12px; align-items: flex-end; }
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
  <div class="logo">Grok<span>V7</span></div>
  <div style="display:flex; gap:8px; margin-left:auto;">
    <button class="btn-icon" id="btn-settings">⚙</button>
    <button class="btn-icon" id="btn-new-bot">+</button>
  </div>
</header>
<div id="main">
  <div class="tabs">
    <button id="tab-bots" class="active">Agents</button>
  </div>
  <div id="list"></div>
</div>
<div id="chat">
  <header>
    <button class="btn-icon" id="btn-back" style="border:none; background:none;">←</button>
    <div class="logo" id="chat-title" style="font-size:18px;"></div>
    <div style="width:36px;"></div>
  </header>
  <div id="chat-log"></div>
  <div id="chat-bar">
    <textarea id="chat-input" rows="1" placeholder="Message..."></textarea>
    <button id="chat-send">↑</button>
  </div>
</div>
<div class="modal-overlay" id="modal-settings">
  <div class="modal-box">
    <h2>Settings</h2>
    <p>Paste your GitHub Token.</p>
    <input type="password" id="input-github-token" placeholder="ghp_..." autocomplete="off" spellcheck="false">
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
    <input type="text" id="input-agent-name" placeholder="Name (no spaces)" autocomplete="off" spellcheck="false">
    <textarea id="input-agent-instructions" placeholder="Instructions..."></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal('modal-new-agent')">Cancel</button>
      <button class="btn-save" onclick="createAgent()">Create</button>
    </div>
  </div>
</div>
<script>
if (localStorage.getItem('v') !== '7') {
  localStorage.clear();
  localStorage.setItem('v', '7');
}

var $ = function(s) { return document.querySelector(s); };
var currentBot = null;
var pollInterval = null;

function api(path, opts) {
  return fetch(path, opts).then(function(r) {
    if (!r.ok) throw new Error("Error " + r.status);
    var ct = r.headers.get('content-type') || '';
    return ct.indexOf('json') > -1 ? r.json() : r.text();
  });
}

function loadBots() {
  api('/api/bots').then(function(bots) {
    if (!Array.isArray(bots)) return $('#list').innerHTML = '<p style="color:red;text-align:center;margin-top:40px">Error: Invalid data. Tap ⚙ to reset.</p>';
    if (bots.length === 0) return $('#list').innerHTML = '<p style="color:var(--text-dim);text-align:center;margin-top:40px">No agents yet. Tap + to create one.</p>';

    var html = '';
    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      html += '<div class="bot-card"><div><h3>' + b.name + '</h3><p>' + (b.instructions || '').slice(0,60) + '</p></div>';
      html += '<div class="bot-actions"><button class="btn-open" onclick="openBot(\'' + b.name + '\')">Chat</button>';
      html += '<button class="btn-del" onclick="deleteBot(\'' + b.name + '\')">✕</button></div></div>';
    }
    $('#list').innerHTML = html;
    
    if (!window.hasAutoOpened && bots.length > 0) {
      window.hasAutoOpened = true;
      openBot('chief');
    }
  }).catch(function(err) {
    $('#list').innerHTML = '<p style="color:red;text-align:center;margin-top:40px">Error: ' + err.message + '</p>';
  });
}

function loadLog() {
  if (!currentBot) return;
  api('/api/bot/' + encodeURIComponent(currentBot) + '/messages').then(function(data) {
    if (!data || !data.messages) return;
    
    var log = $('#chat-log'), html = '';
    for (var i = 0; i < data.messages.length; i++) {
      var m = data.messages[i];
      if (m.role === 'system' && m.content.startsWith('Thoughts:')) {
        var lines = m.content.replace('Thoughts:', '').split('|');
        html += '<details class="thoughts"><summary>Processed steps</summary><div class="content">';
        for (var j = 0; j < lines.length; j++) {
          if (lines[j].trim()) html += '<div>' + esc(lines[j]) + '</div>';
        }
        html += '</div></details>';
      } else if (m.role === 'system') {
        html += '<div class="msg system">' + esc(m.content) + '</div>';
      } else {
        html += '<div class="msg ' + (m.role === 'assistant' ? 'bot' : m.role) + '">' + esc(m.content) + '</div>';
      }
    }
    
    if (data.status === 'working') {
      if (data.live_thoughts && data.live_thoughts.length > 0) {
        html += '<details class="thoughts" open><summary>Thinking...</summary><div class="content">';
        for (var k = 0; k < data.live_thoughts.length; k++) {
          html += '<div>' + esc(data.live_thoughts[k]) + '</div>';
        }
        html += '</div></details>';
      } else {
        html += '<div class="msg bot" style="color:var(--text-dim)">Thinking...</div>';
      }
    }
    
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;

    if (data.status === 'working') {
      if (!pollInterval) pollInterval = setInterval(loadLog, 3000);
      $('#chat-send').disabled = true;
      $('#chat-input').placeholder = "Working in background...";
    } else {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      $('#chat-send').disabled = false;
      $('#chat-input').placeholder = "Message...";
    }
  }).catch(function(e) { console.log(e); });
}

function esc(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function send() {
  var text = $('#chat-input').value.trim();
  if (!text || !currentBot) return;
  $('#chat-input').value = ''; $('#chat-input').style.height = 'auto';
  
  var log = $('#chat-log');
  var u = document.createElement('div');
  u.className = 'msg user'; u.textContent = text;
  log.appendChild(u); log.scrollTop = log.scrollHeight;

  api('/api/bot/' + encodeURIComponent(currentBot) + '/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: text })
  }).then(function() { loadLog(); }).catch(function(e) { alert('Error: ' + e.message); });
}

$('#chat-send').onclick = send;
$('#chat-input').onkeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
};
$('#chat-input').oninput = function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
};

function openBot(name) {
  currentBot = name;
  $('#main').style.display = 'none';
  $('#main-header').style.display = 'none';
  $('#chat').style.display = 'flex';
  $('#chat-title').textContent = name;
  loadLog();
}

function deleteBot(name) {
  if (!confirm("Delete " + name + " forever?")) return;
  api('/api/bot/' + name + '/delete', { method: 'POST' }).then(function() { loadBots(); });
}

function closeModal(id) { $('#' + id).style.display = 'none'; }

function saveSettings() {
  var token = $('#input-github-token').value.trim();
  api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token }) }).then(function() { closeModal('modal-settings'); });
}

function createAgent() {
  var name = $('#input-agent-name').value.trim();
  var instructions = $('#input-agent-instructions').value.trim();
  if (!name) return alert('Name is required');
  
  api('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name, instructions: instructions }) }).then(function() {
    closeModal('modal-new-agent');
    loadBots();
  }).catch(function(e) { alert(e.message); });
}

function resetApp() {
  if (!confirm("Reset all bots and history?")) return;
  fetch('/api/reset').then(function() { location.reload(); });
}

$('#btn-back').onclick = function() {
  currentBot = null;
  if (pollInterval) clearInterval(pollInterval);
  $('#chat').style.display = 'none';
  $('#main').style.display = 'flex';
  $('#main-header').style.display = 'flex';
  loadBots();
};

$('#btn-new-bot').onclick = function() {
  $('#input-agent-name').value = '';
  $('#input-agent-instructions').value = '';
  $('#modal-new-agent').style.display = 'flex';
};

$('#btn-settings').onclick = function() {
  api('/api/settings').then(function(data) {
    if (data && data.token) $('#input-github-token').value = data.token;
    $('#modal-settings').style.display = 'flex';
  });
};

// Ensure window scope
window.openBot = openBot;
window.deleteBot = deleteBot;
window.closeModal = closeModal;
window.saveSettings = saveSettings;
window.createAgent = createAgent;
window.resetApp = resetApp;

loadBots();
</script>
</body>
</html>`;
