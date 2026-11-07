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
      await reg.fetch(new Request("https://registry/register", {
        method: "POST",
        body: JSON.stringify({ name, instructions }),
      }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/init", {
        method: "POST",
        body: JSON.stringify({ name, instructions }),
      }));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/jobs" && request.method === "GET") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/list_jobs"));
    }

    if (url.pathname.startsWith("/api/bot/") && url.pathname.endsWith("/delete") && request.method === "POST") {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/unregister", {
        method: "POST",
        body: JSON.stringify({ name })
      }));
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
      headers: { "content-type": "text/html; charset=utf-8" },
    });
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
    cursor: pointer; transition: all 0.2s; margin-left: auto;
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
  .job-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin-bottom: 12px; }
  .job-card h3 { margin: 0 0 8px 0; font-size: 16px; color: var(--text); }
  .job-card p { margin: 0 0 12px 0; font-size: 14px; color: var(--text-dim); }
  .job-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); border-top: 1px solid var(--border); padding-top: 12px; }
  .job-meta span { display: flex; align-items: center; gap: 4px; }
  #chat { display: none; flex-direction: column; height: 100%; background: var(--bg); }
  #chat header { border-bottom: none; background: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); position: absolute; width: 100%; top: 0; }
  #chat-log { flex: 1; overflow-y: auto; padding: 80px 20px 20px; display: flex; flex-direction: column; gap: 20px; scroll-behavior: smooth; }
  .msg { max-width: 85%; font-size: 16px; line-height: 1.5; animation: slideUp 0.3s ease-out; }
  .msg.user { align-self: flex-end; background: var(--user-bubble); padding: 12px 18px; border-radius: 20px 20px 4px 20px; }
  .msg.bot { align-self: flex-start; padding: 4px 0; white-space: pre-wrap; }
  .msg code { background: var(--surface); padding: 2px 6px; border-radius: 6px; font-family: var(--font-mono); font-size: 0.9em; }
  .msg pre { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; overflow-x: auto; margin: 8px 0; }
  .msg pre code { background: none; padding: 0; }
  .msg strong { color: #fff; font-weight: 600; }
  .thoughts {
    align-self: flex-start; max-width: 85%; background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; margin-bottom: 4px; font-size: 13px; animation: fadeIn 0.3s;
  }
  .thoughts summary {
    padding: 10px 14px; cursor: pointer; color: var(--text-dim); font-weight: 500; list-style: none;
    display: flex; align-items: center; gap: 8px; outline: none;
  }
  .thoughts summary::-webkit-details-marker { display: none; }
  .thoughts summary:before { content: "▶"; font-size: 10px; transition: transform 0.2s; }
  .thoughts[open] summary:before { transform: rotate(90deg); }
  .thoughts .content { padding: 0 14px 14px; font-family: var(--font-mono); color: var(--text-dim); border-top: 1px solid var(--border); margin-top: 4px; padding-top: 10px; }
  .thoughts .content div { margin-bottom: 6px; }
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
  .cursor:after { content: "▋"; color: var(--text-dim); animation: blink 1s steps(2) infinite; margin-left: 2px; }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
</style>
</head>
<body>
<header id="main-header">
  <div class="logo">Grok<span>Fleet</span></div>
  <button class="btn-icon" id="btn-new-bot" title="New Bot">+</button>
</header>
<div id="main">
  <div class="tabs">
    <button id="tab-bots" class="active" onclick="switchTab('bots')">Agents</button>
    <button id="tab-jobs" onclick="switchTab('jobs')">Jobs</button>
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
<script>
const $ = s => document.querySelector(s);
let currentBot = null;
let currentTab = 'bots';
let hasAutoOpened = false;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}

function switchTab(tab) {
  currentTab = tab;
  $('#tab-bots').className = tab === 'bots' ? 'active' : '';
  $('#tab-jobs').className = tab === 'jobs' ? 'active' : '';
  if (tab === 'bots') loadBots(); else loadJobs();
}

async function loadBots() {
  const bots = await api('/api/bots');
  let html = '';
  if (bots.length) {
    html = bots.map(function(b) {
      return '<div class="bot-card">' +
        '<div>' +
          '<h3>' + b.name + '</h3>' +
          '<p>' + (b.instructions || 'No instructions').slice(0,60) + '</p>' +
        '</div>' +
        '<div class="bot-actions">' +
          '<button class="btn-open" onclick="openBot(\\'' + b.name + '\\')">Chat</button>' +
          '<button class="btn-del" onclick="deleteBot(\\'' + b.name + '\\')">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');
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

async function loadJobs() {
  const jobs = await api('/api/jobs');
  let html = '';
  if (jobs.length) {
    html = jobs.map(function(j) {
      return '<div class="job-card">' +
        '<h3>' + j.title + '</h3>' +
        '<p>' + (j.description || 'No description') + '</p>' +
        '<div class="job-meta">' +
          '<span>👤 ' + j.assigned_to + '</span>' +
          '<span>🚦 ' + j.status + '</span>' +
          '<span>🛠 ' + j.creator + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    html = '<p style="color:var(--text-dim);text-align:center;margin-top:40px">Job board is empty.</p>';
  }
  $('#list').innerHTML = html;
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
  const msgs = await api('/api/bot/' + encodeURIComponent(currentBot) + '/messages');
  const log = $('#chat-log');
  log.innerHTML = msgs.map(function(m) {
    return '<div class="msg ' + m.role + '">' + (m.role === 'assistant' ? md(m.content) : esc(m.content)) + '</div>';
  }).join('');
  log.scrollTop = log.scrollHeight;
}

function esc(s) {
  return s.replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function md(raw) {
  let s = esc(raw);
  s = s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, c) { return '<pre><code>' + c.replace(/^\\n/, '') + '</code></pre>'; });
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

  const thoughtsEl = document.createElement('details');
  thoughtsEl.className = 'thoughts';
  thoughtsEl.style.display = 'block'; // Now opens instantly
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = 'Thinking...';
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  thoughtsEl.appendChild(summaryEl);
  thoughtsEl.appendChild(contentEl);
  
  log.appendChild(thoughtsEl); 

  const botEl = document.createElement('div');
  botEl.className = 'msg bot cursor';
  log.appendChild(botEl); log.scrollTop = log.scrollHeight;

  try {
    const res = await fetch('/api/bot/' + encodeURIComponent(currentBot) + '/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', acc = '';
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\\n'); buf = lines.pop();
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          
          if (o.type === 'status') {
            const p = document.createElement('div');
            p.textContent = o.text;
            contentEl.appendChild(p);
            summaryEl.textContent = 'Processed steps';
          }
          
          if (o.type === 'delta') { 
            acc += o.text; 
            botEl.innerHTML = md(acc); 
          }
          if (o.type === 'error') { 
            acc += '\\n\\n' + o.text; 
            botEl.innerHTML = md(acc); 
          }
        } catch {}
      }
      log.scrollTop = log.scrollHeight;
    }
    botEl.classList.remove('cursor');
  } catch (e) {
    botEl.classList.remove('cursor');
    botEl.textContent = 'Error: ' + e.message;
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
  $('#chat').style.display = 'none';
  $('#main').style.display = 'flex';
  $('#main-header').style.display = 'flex';
  if(currentTab === 'bots') loadBots(); else loadJobs();
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

window.openBot = openBot;
window.deleteBot = deleteBot;
switchTab('bots');
</script>
</body>
</html>`;
