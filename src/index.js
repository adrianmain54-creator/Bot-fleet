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
      await reg.fetch(new Request("https://registry/register", {
        method: "POST",
        body: JSON.stringify({ name, instructions })
      }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/init", {
        method: "POST",
        body: JSON.stringify({ name, instructions })
      }));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/settings" && request.method === "GET") {
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/get_github_token"));
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      const body = await request.json();
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      return reg.fetch(new Request("https://registry/set_github_token", {
        method: "POST",
        body: JSON.stringify(body)
      }));
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
      headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
};

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Grok Fleet</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000000;
    --surface: #0a0a0a;
    --border: #222222;
    --text: #f5f5f5;
    --text-dim: #888888;
    --accent: #ffffff;
    --bubble: #1c1c1e;
    --font-sys: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 var(--font-sys); overflow: hidden; }
  body { display: flex; flex-direction: column; max-width: 800px; margin: 0 auto; width: 100%; }
  
  header { padding: calc(env(safe-area-inset-top) + 16px) 20px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.8); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 10; }
  h1 { margin: 0; font-size: 20px; font-weight: 700; font-family: var(--font-mono); letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; }
  h1 span { font-size: 11px; font-family: var(--font-sys); color: var(--text-dim); background: var(--surface); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); text-transform: uppercase; }
  
  .container { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 24px; }
  
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  
  button { background: var(--surface); color: var(--text); border: 1px solid var(--border); padding: 10px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; cursor: pointer; transition: all 0.2s; }
  button:active { background: var(--bubble); transform: scale(0.96); }
  button.primary { background: var(--text); color: var(--bg); border: none; }
  button.danger { color: #ff453a; border-color: #ff453a33; }
  
  input, textarea { width: 100%; background: var(--surface); color: var(--text); border: 1px solid var(--border); padding: 12px 16px; border-radius: 12px; font: inherit; font-size: 15px; outline: none; margin-bottom: 10px; }
  input:focus, textarea:focus { border-color: #444; }
  textarea { resize: vertical; min-height: 80px; }
  
  h2 { font-size: 13px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0; }
  
  .agent-list { display: flex; flex-direction: column; gap: 8px; }
  .agent-item { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
  .agent-item strong { font-size: 16px; }
  
  .log { background: #000; border: 1px solid var(--border); padding: 16px; border-radius: 12px; height: 250px; overflow-y: auto; white-space: pre-wrap; font-family: var(--font-mono); font-size: 13px; color: #aaa; line-height: 1.6; }
  .muted { color: var(--text-dim); font-size: 14px; }
  #settings { background: var(--surface); border: 1px solid var(--border); padding: 20px; border-radius: 16px; }
</style>
</head>
<body>
<header>
  <h1>Grok <span>Fleet</span></h1>
  <div class="row">
    <button onclick="showSettings()">⚙ Settings</button>
  </div>
</header>

<div class="container">
  <div id="settings" style="display:none">
    <h2>GitHub Token</h2>
    <input id="token" placeholder="ghp_..." type="password">
    <div class="row">
      <button class="primary" onclick="saveToken()">Save</button>
      <button onclick="hideSettings()">Cancel</button>
    </div>
  </div>

  <div>
    <h2>Create Agent</h2>
    <input id="agentName" placeholder="Agent name (e.g. chief)">
    <textarea id="agentInstructions" placeholder="System instructions..."></textarea>
    <button class="primary" onclick="createAgent()">+ Create Agent</button>
  </div>

  <div>
    <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
      <h2 style="margin: 0;">Active Agents</h2>
      <button onclick="loadBots()" style="padding: 6px 12px; font-size: 12px;">Refresh</button>
    </div>
    <div id="agents" class="agent-list"></div>
  </div>

  <div>
    <h2>Console Log</h2>
    <div id="log" class="log">Waiting for agent...</div>
  </div>
  
  <div style="margin-bottom: 40px;">
    <button class="danger" onclick="resetApp()">Reset Database</button>
  </div>
</div>

<script>
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  return r.json();
}

async function loadBots() {
  const bots = await api('/api/bots');
  const el = document.getElementById('agents');
  if (!bots.length) {
    el.innerHTML = '<div class="muted">No agents yet. Create one above.</div>';
    return;
  }
  el.innerHTML = bots.map(b => 
    '<div class="agent-item">' +
      '<strong>' + b.name + '</strong>' +
      '<div class="row">' +
        '<button onclick="openChat(\'' + b.name + '\')" style="padding: 6px 12px; font-size: 12px;">Chat</button>' +
        '<button class="danger" onclick="deleteAgent(\'' + b.name + '\')" style="padding: 6px 12px; font-size: 12px;">✕</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

async function createAgent() {
  const name = document.getElementById('agentName').value.trim();
  const instructions = document.getElementById('agentInstructions').value.trim();
  if (!name) return alert('Name required');
  await api('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, instructions }) });
  document.getElementById('agentName').value = '';
  document.getElementById('agentInstructions').value = '';
  loadBots();
}

async function deleteAgent(name) {
  if (!confirm('Delete ' + name + '?')) return;
  await api('/api/bot/' + encodeURIComponent(name) + '/delete', { method: 'POST' });
  loadBots();
}

async function resetApp() {
  if (!confirm('Wipe everything?')) return;
  await api('/api/reset', { method: 'POST' });
  loadBots();
}

function showSettings() { document.getElementById('settings').style.display = 'block'; }
function hideSettings() { document.getElementById('settings').style.display = 'none'; }

async function saveToken() {
  const token = document.getElementById('token').value.trim();
  await api('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  hideSettings();
  log('GitHub token saved.');
}

function log(s) {
  const el = document.getElementById('log');
  el.textContent += '\n' + s;
  el.scrollTop = el.scrollHeight;
}

function openChat(name) {
  const msg = prompt('Message to ' + name);
  if (msg) sendMessage(name, msg);
}

async function sendMessage(name, message) {
  log('\nYou: ' + message);
  log('Agent is thinking...');
  
  const res = await fetch('/api/bot/' + encodeURIComponent(name) + '/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
  
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let fullReply = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'delta') {
          if (fullReply === '') log('Agent: ');
          fullReply += o.text;
          const el = document.getElementById('log');
          el.textContent += o.text;
          el.scrollTop = el.scrollHeight;
        }
        else if (o.type === 'status') log('\n[System] ' + o.text);
        else if (o.type === 'error') log('\n[Error] ' + o.text);
      } catch {}
    }
  }
}

loadBots();
</script>
</body>
</html>`;
