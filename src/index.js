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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Bot Fleet">
<title>Bot Fleet</title>
<style>
:root{color-scheme:dark;--bg:#000;--fg:#e8e8e8;--dim:#6b6b6b;--line:#1a1a1a;--accent:#7c5cff;--bubble:#141414}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
header{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top) + 10px) 16px 10px;border-bottom:1px solid var(--line);flex-shrink:0}
.logo{font:700 18px ui-monospace,"SF Mono",monospace;letter-spacing:-.5px}
.pill{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--accent);border:1px solid #2a2247;border-radius:20px;padding:3px 9px}
header button{margin-left:auto;background:none;border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:6px 10px;font-size:13px}
#main{flex:1;overflow-y:auto;padding:14px 16px}
.bot-card{background:var(--bubble);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.bot-card strong{font-size:15px}
.bot-card .sub{color:var(--dim);font-size:13px;margin-top:2px}
.bot-card button{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600}
.job-card{background:#0a0a0a;border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;font-size:14px}
.job-card strong{color:var(--accent);display:block;margin-bottom:4px}
.job-card .meta{color:var(--dim);font-size:12px;margin-top:6px}
#chat{display:none;flex-direction:column;height:100%}
#log{flex:1;overflow-y:auto;padding:14px 16px 8px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:92%;word-wrap:break-word;padding:10px 14px;border-radius:16px;white-space:pre-wrap}
.msg.user{align-self:flex-end;background:var(--bubble);border:1px solid var(--line)}
.msg.bot{align-self:flex-start;background:#0d0d0d;border:1px solid #1f1f1f}
.msg code{background:#111;padding:1px 5px;border-radius:4px;font-family:ui-monospace,"SF Mono",monospace;font-size:.92em}
.msg pre{background:#0b0b0b;border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto;margin:8px 0}
.msg pre code{background:none;padding:0}
.msg strong{color:#fff}
#bar{display:flex;gap:8px;padding:10px 12px calc(env(safe-area-inset-bottom) + 10px);border-top:1px solid var(--line);background:#000;flex-shrink:0}
#in{flex:1;background:#0d0d0d;color:var(--fg);border:1px solid var(--line);border-radius:20px;padding:11px 16px;font:inherit;resize:none;max-height:120px;min-height:44px;outline:none}
#send{background:var(--accent);color:#fff;border:none;border-radius:22px;padding:0 18px;font-weight:600;font-size:15px}
#send:disabled{opacity:.4}
.cursor:after{content:"▋";color:var(--dim);animation:b 1s steps(2) infinite}
@keyframes b{50%{opacity:0}}
.back{background:none;border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:6px 10px;font-size:13px}
.tabs{display:flex;gap:8px;margin-bottom:14px}
.tabs button{flex:1;background:#0d0d0d;border:1px solid var(--line);color:var(--fg);padding:8px;border-radius:8px;font-weight:600;font-size:13px}
.tabs button.active{background:var(--accent);border-color:var(--accent);color:#fff}
</style>
</head>
<body>
<header>
  <div class="logo">bot fleet</div>
  <div class="pill">free</div>
  <button id="newBtn">+ new bot</button>
</header>
<div id="main">
  <div class="tabs">
    <button id="tabBots" class="active" onclick="switchTab('bots')">Bots</button>
    <button id="tabJobs" onclick="switchTab('jobs')">Job Board</button>
  </div>
  <div id="list"></div>
</div>
<div id="chat">
  <header>
    <button class="back" id="backBtn">← back</button>
    <div class="logo" id="chatName" style="margin-left:8px"></div>
  </header>
  <div id="log"></div>
  <div id="bar">
    <textarea id="in" rows="1" placeholder="assign a job…" enterkeyhint="send"></textarea>
    <button id="send">send</button>
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
  $('#tabBots').className = tab === 'bots' ? 'active' : '';
  $('#tabJobs').className = tab === 'jobs' ? 'active' : '';
  if (tab === 'bots') loadBots(); else loadJobs();
}

async function loadBots() {
  const bots = await api('/api/bots');
  $('#list').innerHTML = bots.length ? bots.map(b => \`
    <div class="bot-card">
      <div><strong>\${b.name}</strong><div class="sub">\${(b.instructions||'no instructions').slice(0,60)}</div></div>
      <button onclick="openBot('\${b.name}')">open</button>
    </div>\`).join('') : '<p style="color:var(--dim);text-align:center;margin-top:40px">No bots yet. Tap "+ new bot".</p>';
    
  // Auto-open Chief on first load
  if (!hasAutoOpened && bots.find(b => b.name === 'chief')) {
    hasAutoOpened = true;
    openBot('chief');
  }
}

async function loadJobs() {
  const jobs = await api('/api/jobs');
  $('#list').innerHTML = jobs.length ? jobs.map(j => \`
    <div class="job-card">
      <strong>\${j.title}</strong>
      \${j.description || ''}
      <div class="meta">Assigned: \${j.assigned_to} | Status: \${j.status} | By: \${j.creator}</div>
    </div>\`).join('') : '<p style="color:var(--dim);text-align:center;margin-top:40px">Job board is empty.</p>';
}

async function openBot(name) {
  currentBot = name;
  $('#main').style.display = 'none';
  $('#chat').style.display = 'flex';
  $('#chatName').textContent = name;
  await loadLog();
}

async function loadLog() {
  const msgs = await api(\`/api/bot/\${encodeURIComponent(currentBot)}/messages\`);
  const log = $('#log');
  log.innerHTML = msgs.map(m => \`<div class="msg \${m.role}">\${m.role==='assistant'?md(m.content):esc(m.content)}</div>\`).join('');
  log.scrollTop = log.scrollHeight;
}

function esc(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function md(raw){
  let s=esc(raw);
  s=s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,(_,c)=>'<pre><code>'+c.replace(/^\\n/,'')+'</code></pre>');
  s=s.replace(/\`([^\`\\n]+)\`/g,'<code>$1</code>');
  s=s.replace(/\\*\\*([^*\\n]+)\\*\\*/g,'<strong>$1</strong>');
  return s;
}

async function send() {
  const text = $('#in').value.trim();
  if (!text || !currentBot) return;
  $('#in').value = ''; $('#in').style.height = 'auto';
  const log = $('#log');
  const u = document.createElement('div');
  u.className = 'msg user'; u.textContent = text;
  log.appendChild(u); log.scrollTop = log.scrollHeight;

  const botEl = document.createElement('div');
  botEl.className = 'msg bot cursor';
  log.appendChild(botEl); log.scrollTop = log.scrollHeight;

  try {
    const res = await fetch(\`/api/bot/\${encodeURIComponent(currentBot)}/message\`, {
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
          if (o.type === 'delta') { acc += o.text; botEl.innerHTML = md(acc); }
          if (o.type === 'error') { acc += '\\n\\n' + o.text; botEl.innerHTML = md(acc); }
        } catch {}
      }
      log.scrollTop = log.scrollHeight;
    }
    botEl.classList.remove('cursor');
  } catch (e) {
    botEl.classList.remove('cursor');
    botEl.textContent = 'error: ' + e.message;
  }
}

$('#send').onclick = send;
$('#in').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#in').addEventListener('input', () => {
  $('#in').style.height = 'auto';
  $('#in').style.height = Math.min($('#in').scrollHeight, 120) + 'px';
});
$('#backBtn').onclick = () => {
  currentBot = null;
  $('#chat').style.display = 'none';
  $('#main').style.display = 'block';
  if(currentTab === 'bots') loadBots(); else loadJobs();
};
$('#newBtn').onclick = async () => {
  const name = prompt('Bot name (no spaces):');
  if (!name) return;
  const instructions = prompt('What should this bot do?') || '';
  await api('/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, instructions }),
  });
  loadBots();
};
window.openBot = openBot;
switchTab('bots');
</script>
</body>
</html>`;
