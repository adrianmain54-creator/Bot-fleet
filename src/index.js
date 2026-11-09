import { BotDurableObject } from "./bot.js";

export { BotDurableObject };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/bots" && request.method === "GET") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/ensure_defaults"));
    }

    if (url.pathname === "/api/bots" && request.method === "POST") {
      const { name, instructions } = await request.json();
      if (!name) return new Response("name required", { status: 400 });
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

    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Grok Bot">
<meta name="theme-color" content="#000000">
<title>Grok Bot</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000000;
    --surface: #0a0a0a;
    --surface-hover: #141414;
    --border: #222222;
    --text: #f5f5f5;
    --text-dim: #888888;
    --accent: #ffffff;
    --accent-bg: #1a1a1a;
    --user-bubble: #1c1c1e;
    --font-sys: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 16px/1.5 var(--font-sys); overflow: hidden; }
  body { display: flex; flex-direction: column; height: 100dvh; }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: calc(env(safe-area-inset-top) + 12px) 20px 12px;
    background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .logo { font: 700 20px var(--font-mono); letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; }
  .logo span { font: 500 11px var(--font-sys); color: var(--text-dim); background: var(--surface); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.5px; }
  .btn-icon {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s;
  }
  .btn-icon:active { background: var(--surface-hover); transform: scale(0.95); }
  #main { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; }
  .tabs { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; margin-bottom: 24px; }
  .tabs button {
    flex: 1; background: transparent; border: none; color: var(--text-dim); padding: 10px;
    border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: all 0.2s;
  }
  .tabs button.active { background: var(--accent-bg); color: var(--text); box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
  .bot-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 16px 20px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;
    transition: background 0.2s;
  }
  .bot-card:active { background: var(--surface-hover); }
  .bot-card h3 { margin: 0 0 4px 0; font-size: 16px; font-weight: 600; }
  .bot-card p { margin: 0; color: var(--text-dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .bot-actions { display: flex; gap: 8px; align-items: center; }
  .btn-open { background: var(--text); color: var(--bg); border: none; border-radius: 20px; padding: 8px 16px; font-weight: 600; font-size: 13px; }
  .btn-del { background: transparent; color: #ff453a; border: 1px solid #ff453a33; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  #chat { display: none; flex-direction: column; height: 100%; background: var(--bg); position: relative; }
  #chat header { border-bottom: none; background: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); position: absolute; width: 100%; top: 0; }
  #chat-log { flex: 1; overflow-y: auto; padding: 80px 20px 20px; display: flex; flex-direction: column; gap: 20px; scroll-behavior: smooth; }
  .msg { max-width: 85%; font-size: 16px; line-height: 1.5; animation: slideUp 0.3s ease-out; }
  .msg.user { align-self: flex-end; background: var(--user-bubble); padding: 12px 18px; border-radius: 20px 20px 4px 20px; }
  .msg.bot { align-self: flex-start; padding: 4px 0; white-space: pre-wrap; }
  .msg.system { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); background: var(--surface); padding: 10px; border-radius: 8px; align-self: center; max-width: 100%; white-space: pre-wrap; }
  .msg code { background: var(--surface); padding: 2px 6px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.9em; }
  .msg pre { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; overflow-x: auto; margin: 8px 0; }
  .msg pre code { background: none; padding: 0; }
  .msg strong { color: #fff; font-weight: 600; }
  #chat-bar { 
    padding: 12px 20px calc(env(safe-area-inset-bottom) + 12px); 
    background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--border); display: flex; gap: 12px; align-items: flex-end;
  }
  #chat-input {
    flex: 1; background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 24px; padding: 12px 18px; font: inherit; font-size: 16px; resize: none; max-height: 120px;
    outline: none; transition: border-color 0.2s;
  }
  #chat-input:focus { border-color: #444; }
  #chat-send {
    background: var(--text); color: var(--bg); border: none; border-radius: 50%; width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center; font-size: 20px; transition: transform 0.2s; flex-shrink: 0;
  }
  #chat-send:active { transform: scale(0.9); }
  #chat-send:disabled { opacity: 0.3; }
  #modal-settings {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100;
    align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(10px);
  }
  .modal-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 24px; width: 100%; max-width: 400px; animation: slideUp 0.2s ease-out;
  }
  .modal-box h2 { margin: 0 0 8px 0; font-size: 20px; }
  .modal-box p { margin: 0 0 16px 0; font-size: 14px; color: var(--text-dim); }
  .modal-box input {
    width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text);
    padding: 12px; border-radius: 8px; font-family: var(--font-mono); margin-bottom: 16px; outline: none;
  }
  .modal-box input:focus { border-color: #444; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 12px; }
  .modal-actions button { padding: 10px 16px; border-radius: 8px; font-weight: 600; border: none; font-size: 14px; }
  .btn-cancel { background: transparent; color: var(--text-dim); }
  .btn-save { background: var(--text); color: var(--bg); }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<header id="main-header">
  <div class="logo">Grok<span>Fleet</span></div>
  <div style="display:flex; gap:8px; margin-left:auto;">
    <button class="btn-icon" id="btn-settings">⚙</button>
    <button class="btn-icon" id="btn-new-bot">+</button>
  </div>
</header>
<div id="main">
  <div class="tabs">
    <button id="tab-bots" class="active" onclick="switchTab('bots')">Agents</button>
  </div>
  <div id="list"></div>
</div>
<div id="chat">
  <header>
    <button class="btn-icon" id="btn-back" style="margin-left:0; border:none; background:none;">←</button>
    <div class="logo" id="chat-title" style="font-size:18px;"></div>
    <div style="margin-left:auto; width:36px;"></div>
  </header>
  <div id="chat-log"></div>
  <div id="chat-bar">
    <textarea id="chat-input" rows="1" placeholder="Message..."></textarea>
    <button id="chat-send">↑</button>
  </div>
</div>
<div id="modal-settings">
  <div class="modal-box">
    <h2>Settings</h2>
    <p>Paste your GitHub Personal Access Token.</p>
    <input type="password" id="input-github-token" placeholder="ghp_..." autocomplete="off" spellcheck="false">
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeSettings()">Cancel</button>
      <button class="btn-save" onclick="saveSettings()">Save</button>
    </div>
  </div>
</div>
<script>
const $ = s => document.querySelector(s);
let currentBot = null;
let currentTab = 'bots';
let hasAutoOpened = false;
let pollInterval = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

function switchTab(tab) {
  currentTab = tab;
  if (tab === 'bots') loadBots();
}

async function loadBots() {
  const bots = await api('/api/bots');
  let html = '';
  if (bots.length) {
    html = bots.map(b => `
      <div class="bot-card">
        <div><h3>${b.name}</h3><p>${(b.instructions||'').slice(0,60)}</p></div>
        <div class="bot-actions">
          <button class="btn-open" onclick="openBot('${b.name}')">Chat</button>
          <button class="btn-del" onclick="deleteBot('${b.name}')">✕</button>
        </div>
      </div>`).join('');
  } else {
    html = '<p style="color:var(--text-dim);text-align:center;margin-top:40px">No agents yet. Tap + to create one.</p>';
  }
  $('#list').innerHTML = html;
  
  if (!hasAutoOpened && bots.find(b => b.name === 'chief')) {
    hasAutoOpened = true;
    openBot('chief');
  }
}

async function deleteBot(name) {
  if (!confirm("Delete " + name + " forever?")) return;
  await api('/api/bot/' + name + '/delete', { method: 'POST' });
  loadBots();
}

async function openBot(name) {
  currentBot = name;
  $('#main').style.display = 'none';
  $('#main-header').style.display = 'none';
  $('#chat').style.display = 'flex';
  $('#chat-title').textContent = name;
  await loadLog();
}

async function loadLog() {
  const data = await api('/api/bot/' + encodeURIComponent(currentBot) + '/messages');
  const log = $('#chat-log');
  log.innerHTML = data.messages.map(m => {
    if (m.role === 'system') {
      return '<div class="msg system">' + esc(m.content) + '</div>';
    }
    return '<div class="msg ' + m.role + '">' + (m.role === 'assistant' ? md(m.content) : esc(m.content)) + '</div>';
  }).join('');
  log.scrollTop = log.scrollHeight;

  if (data.status === 'working') {
    if (!pollInterval) {
      pollInterval = setInterval(loadLog, 3000);
    }
    $('#chat-send').disabled = true;
  } else {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    $('#chat-send').disabled = false;
  }
}

function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function md(raw) {
  let s = esc(raw);
  s = s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_, c) => '<pre><code>' + c.replace(/^\\n/, '') + '</code></pre>');
  s = s.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
  s = s.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
  return s;
}

async function send() {
  const text = $('#chat-input').value.trim();
  if (!text || !currentBot) return;
  $('#chat-input').value = ''; $('#chat-input').style.height = 'auto';
  
  const log = $('#chat-log');
  const u = document.createElement('div');
  u.className = 'msg user'; u.textContent = text;
  log.appendChild(u); log.scrollTop = log.scrollHeight;

  try {
    await fetch('/api/bot/' + encodeURIComponent(currentBot) + '/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    
    // Instantly load log to show the "working" state and start polling
    loadLog();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

$('#chat-send').onclick = send;
$('#chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#chat-input').addEventListener('input', () => {
  $('#chat-input').style.height = 'auto';
  $('#chat-input').style.height = Math.min($('#chat-input').scrollHeight, 120) + 'px';
});

$('#btn-back').onclick = () => {
  currentBot = null;
  if (pollInterval) clearInterval(pollInterval);
  $('#chat').style.display = 'none';
  $('#main').style.display = 'flex';
  $('#main-header').style.display = 'flex';
  loadBots();
};

$('#btn-new-bot').onclick = async () => {
  const name = prompt('Agent Name (no spaces):');
  if (!name) return;
  const instructions = prompt('System Instructions:') || '';
  await api('/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, instructions }),
  });
  loadBots();
};

$('#btn-settings').onclick = async () => {
  const data = await api('/api/settings');
  if (data.token) $('#input-github-token').value = data.token;
  $('#modal-settings').style.display = 'flex';
};

function closeSettings() { $('#modal-settings').style.display = 'none'; }

async function saveSettings() {
  const token = $('#input-github-token').value.trim();
  await api('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
  closeSettings();
}

window.openBot = openBot;
window.deleteBot = deleteBot;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
switchTab('bots');
</script>
</body>
</html>`;
