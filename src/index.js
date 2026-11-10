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
      
      // SECURITY PATCH: Block registry wipe
      if (!name || name === "registry" || name.trim() === "") {
        return Response.json({ error: "invalid name" }, { status: 400 });
      }

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
      if (name === "registry") return new Response("cannot delete registry", { status: 400 });
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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grok Fleet</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #eee; }
  h1 { font-size: 1.2rem; }
  button { background: #222; color: #eee; border: 1px solid #444; padding: .4rem .8rem; border-radius: 4px; cursor: pointer; }
  button:hover { background: #333; }
  input, textarea { width: 100%; background: #1a1a1a; color: #eee; border: 1px solid #333; padding: .4rem; border-radius: 4px; margin: .25rem 0; }
  .row { display: flex; gap: .5rem; align-items: center; margin: .5rem 0; }
  .log { background: #000; border: 1px solid #333; padding: .5rem; border-radius: 4px; height: 200px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 12px; }
  .muted { color: #888; }
</style>
</head>
<body>
<h1>Grok Fleet</h1>
<div class="row">
  <button onclick="loadBots()">Refresh agents</button>
  <button onclick="showSettings()">⚙ Settings</button>
  <button onclick="resetApp()">Reset app</button>
</div>
<div id="settings" style="display:none">
  <h2>Settings</h2>
  <input id="token" placeholder="Paste GitHub Token" type="password">
  <div class="row">
    <button onclick="saveToken()">Save</button>
    <button onclick="hideSettings()">Cancel</button>
  </div>
</div>
<h2>New agent</h2>
<input id="agentName" placeholder="Agent name">
<textarea id="agentInstructions" rows="3" placeholder="Instructions"></textarea>
<button onclick="createAgent()">Create</button>
<h2>Agents</h2>
<div id="agents"></div>
<h2>Log</h2>
<div id="log" class="log muted">ready</div>
<script>
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  return r.json();
}

async function loadBots() {
  try {
    const bots = await api('/api/bots');
    const el = document.getElementById('agents');
    el.innerHTML = bots.map(b => 
      '<div class="row"><strong>' + b.name + '</strong>' +
      '<button onclick="deleteAgent(\'' + b.name + '\')">Delete</button>' +
      '<button onclick="openChat(\'' + b.name + '\')">Open</button></div>'
    ).join('') || '<span class="muted">no agents</span>';
  } catch(e) { console.error(e); }
}

async function createAgent() {
  const name = document.getElementById('agentName').value.trim();
  const instructions = document.getElementById('agentInstructions').value.trim();
  if (!name) return alert('name required');
  await api('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, instructions }) });
  loadBots();
}

async function deleteAgent(name) {
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
  log('token saved');
}

function log(s) {
  const el = document.getElementById('log');
  el.textContent += '\\n' + s;
  el.scrollTop = el.scrollHeight;
}

function openChat(name) {
  const msg = prompt('Message to ' + name);
  if (msg) sendMessage(name, msg);
}

async function sendMessage(name, message) {
  log('→ ' + message);
  const res = await fetch('/api/bot/' + encodeURIComponent(name) + '/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (o.type === 'delta') log(o.text);
        else if (o.type === 'status') log('[status] ' + o.text);
        else if (o.type === 'error') log('[error] ' + o.text);
        else if (o.type === 'done') log('[done]');
      } catch {}
    }
  }
}
loadBots();
</script>
</body>
</html>`;
