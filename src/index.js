import { BotDurableObject } from "./bot.js";
export { BotDurableObject };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/reset") { const reg = env.BOT.get(env.BOT.idFromName("registry")); await reg.fetch(new Request("https://registry/reset")); return Response.json({ ok: true }); }
    if (url.pathname === "/api/bots" && request.method === "GET") { const reg = env.BOT.get(env.BOT.idFromName("registry")); return reg.fetch(new Request("https://registry/ensure_defaults")); }
    if (url.pathname === "/api/bots" && request.method === "POST") {
      const { name, instructions } = await request.json();
      if (!name || name === "registry") return Response.json({ error: "invalid name" }, { status: 400 });
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/register", { method: "POST", body: JSON.stringify({ name, instructions }) }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/init", { method: "POST", body: JSON.stringify({ name, instructions }) }));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/settings" && request.method === "GET") { const reg = env.BOT.get(env.BOT.idFromName("registry")); return reg.fetch(new Request("https://registry/get_github_token")); }
    if (url.pathname === "/api/settings" && request.method === "POST") { const body = await request.json(); const reg = env.BOT.get(env.BOT.idFromName("registry")); return reg.fetch(new Request("https://registry/set_github_token", { method: "POST", body: JSON.stringify(body) })); }
    if (url.pathname.startsWith("/api/bot/") && url.pathname.endsWith("/delete") && request.method === "POST") {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      if (name === "registry") return new Response("cannot delete", { status: 400 });
      const reg = env.BOT.get(env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/unregister", { method: "POST", body: JSON.stringify({ name }) }));
      const stub = env.BOT.get(env.BOT.idFromName(name));
      await stub.fetch(new Request("https://bot/delete", { method: "POST" }));
      return Response.json({ ok: true });
    }
    const botMatch = url.pathname.match(/^\/api\/bot\/([^/]+)\/(.+)$/);
    if (botMatch) {
      const name = decodeURIComponent(botMatch[1]); const rest = botMatch[2];
      const stub = env.BOT.get(env.BOT.idFromName(name));
      const target = new URL("https://bot/" + rest); target.search = url.search;
      return stub.fetch(new Request(target, request));
    }
    return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#000000">
<title>Grok Fleet</title>
<style>
:root{--bg:#000;--glass:rgba(30,30,30,0.6);--border:rgba(255,255,255,0.1);--txt:#fff;--dim:#999;--bub:rgba(60,60,60,0.8)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;height:100dvh;background:radial-gradient(circle at top left,#1a1a2e,#000);color:var(--txt);font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 12px) 20px 12px;background:var(--glass);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border);flex-shrink:0;z-index:10}
.logo{font:700 20px monospace;display:flex;gap:8px}
.logo span{font:600 10px -apple-system;color:#fff;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:6px;text-transform:uppercase}
.btn-i{background:var(--glass);border:1px solid var(--border);color:var(--txt);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;transition:.2s;backdrop-filter:blur(10px)}
.btn-i:active{background:rgba(255,255,255,0.2);transform:scale(.95)}
#main{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px;min-height:0}
.crd{background:var(--glass);border:1px solid var(--border);border-radius:20px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 8px 32px rgba(0,0,0,0.3)}
.crd h3{margin:0 0 4px 0;font-size:16px;font-weight:600}
.crd p{margin:0;color:var(--dim);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.acts{display:flex;gap:8px}
.b-o{background:#fff;color:#000;border:none;border-radius:20px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;transition:.2s}
.b-o:active{transform:scale(.95)}
.b-d{background:rgba(255,69,58,0.1);color:#ff453a;border:1px solid rgba(255,69,58,0.3);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer}

/* STRICT FLEXBOX CHAT LAYOUT */
#chat{display:none;flex-direction:column;flex:1;min-height:0;overflow:hidden;position:relative}
#chat header{border-bottom:1px solid var(--border);background:var(--glass);backdrop-filter:blur(20px);position:absolute;width:100%;top:0;z-index:10;justify-content:center;border-bottom:none}
#clog{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:80px 20px 20px;display:flex;flex-direction:column;gap:16px;min-height:0}
.msg{max-width:85%;font-size:16px;line-height:1.5;white-space:pre-wrap;padding:12px 18px;border-radius:20px;backdrop-filter:blur(10px)}
.msg.u{align-self:flex-end;background:#0a84ff;color:#fff;border-bottom-right-radius:4px;box-shadow:0 4px 15px rgba(10,132,255,0.3)}
.msg.b{align-self:flex-start;background:var(--bub);border:1px solid var(--border);border-bottom-left-radius:4px}
.thn{align-self:flex-start;max-width:85%;background:var(--glass);border:1px solid var(--border);border-radius:12px;margin-bottom:4px;font-size:13px;backdrop-filter:blur(10px)}
.thn summary{padding:10px 14px;color:var(--dim);list-style:none;display:flex;gap:8px;cursor:pointer}
.thn summary::-webkit-details-marker{display:none}
.thn summary:before{content:"▶";font-size:10px}
.thn[open] summary:before{transform:rotate(90deg)}
.thn .c{padding:0 14px 14px;font-family:monospace;color:var(--dim);border-top:1px solid var(--border);margin-top:4px;padding-top:10px}
.thn .c div{margin-bottom:6px}

/* INPUT BAR PINNED TO BOTTOM */
#cbar{padding:12px 20px calc(env(safe-area-inset-bottom) + 12px);background:var(--glass);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid var(--border);display:flex;gap:10px;align-items:flex-end;flex-shrink:0;position:relative;z-index:10}
#ci{flex:1;background:rgba(0,0,0,0.5);color:var(--txt);border:1px solid var(--border);border-radius:24px;padding:12px 18px;font:inherit;resize:none;max-height:120px;outline:none;transition:.2s}
#ci:focus{border-color:rgba(255,255,255,0.3)}
#cs{background:#fff;color:#000;border:none;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;flex-shrink:0;transition:.2s}
#cs:active{transform:scale(.9)}#cs:disabled{opacity:.3}

/* MODALS */
.mdl{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(5px);z-index:100;align-items:flex-end;justify-content:center}
.mdl-b{background:var(--glass);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid var(--border);border-bottom:none;border-radius:24px 24px 0 0;padding:24px 24px calc(env(safe-area-inset-bottom) + 24px);width:100%;max-width:600px;animation:slideUp .3s cubic-bezier(0.16,1,0.3,1);box-shadow:0 -8px 32px rgba(0,0,0,0.5)}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.mdl-b h2{margin:0 0 6px;font-size:22px;font-weight:700}
.mdl-b p{margin:0 0 20px;font-size:14px;color:var(--dim)}
.mdl-b input,.mdl-b textarea{width:100%;background:rgba(0,0,0,0.5);border:1px solid var(--border);color:var(--txt);padding:14px;border-radius:12px;margin-bottom:16px;outline:none;font-size:16px;transition:.2s}
.mdl-b input:focus,.mdl-b textarea:focus{border-color:rgba(255,255,255,0.3)}
.m-a{display:flex;gap:12px}
.m-a button{flex:1;padding:14px;border-radius:12px;font-weight:600;font-size:16px;border:none;cursor:pointer;transition:.2s}
.b-c{background:rgba(255,255,255,0.1);color:#fff}
.b-s{background:#0a84ff;color:#fff}
.b-dng{background:rgba(255,69,58,0.1);color:#ff453a;border:1px solid rgba(255,69,58,0.3);width:100%;margin-top:20px;padding:14px;border-radius:12px;font-weight:600;font-size:15px;cursor:pointer}
</style>
</head>
<body>
<header id="mh">
  <div class="logo">Grok <span>Fleet</span></div>
  <div style="display:flex;gap:8px">
    <button class="btn-i" onclick="oS()">⚙</button>
    <button class="btn-i" onclick="oN()">+</button>
  </div>
</header>
<div id="main"><div id="list" style="display:flex;flex-direction:column;gap:16px"></div></div>
<div id="chat">
  <header>
    <button class="btn-i" onclick="gB()" style="position:absolute;left:20px;border:none;background:none">←</button>
    <div class="logo" id="ct" style="font-size:18px">Agent</div>
  </header>
  <div id="clog"></div>
  <div id="cbar"><textarea id="ci" rows="1" placeholder="Message..."></textarea><button id="cs" onclick="sM()">↑</button></div>
</div>
<div class="mdl" id="ms">
  <div class="mdl-b">
    <h2>Settings</h2><p>Paste your GitHub Token.</p>
    <input type="password" id="igt" placeholder="ghp_...">
    <div class="m-a" style="margin-bottom:10px"><button class="b-c" onclick="cM('ms')">Cancel</button><button class="b-s" onclick="sS()">Save</button></div>
    <button class="b-dng" onclick="rA()">Reset App</button>
  </div>
</div>
<div class="mdl" id="mn">
  <div class="mdl-b">
    <h2>New Agent</h2>
    <input type="text" id="ian" placeholder="Name (no spaces)">
    <textarea id="iai" placeholder="Instructions..."></textarea>
    <div class="m-a"><button class="b-c" onclick="cM('mn')">Cancel</button><button class="b-s" onclick="cA()">Create</button></div>
  </div>
</div>
<script>
var cB=null,pI=null;
function api(u,o){return fetch(u,o).then(r=>r.json())}
function lB(){api('/api/bots').then(b=>{var l=document.getElementById('list');l.innerHTML='';if(!Array.isArray(b)||!b.length)return l.innerHTML='<p style="color:#888;text-align:center;margin-top:40px">No agents yet. Tap + to create one.</p>';for(var i=0;i<b.length;i++){var x=b[i],c=document.createElement('div');c.className='crd';var f=document.createElement('div'),h=document.createElement('h3');h.textContent=x.name;var p=document.createElement('p');p.textContent=(x.instructions||'').slice(0,60);f.appendChild(h);f.appendChild(p);var a=document.createElement('div');a.className='acts';var bo=document.createElement('button');bo.className='b-o';bo.textContent='Chat';bo.onclick=(function(n){return function(){oB(n)}})(x.name);var bd=document.createElement('button');bd.className='b-d';bd.textContent='✕';bd.onclick=(function(n){return function(){dB(n)}})(x.name);a.appendChild(bo);a.appendChild(bd);c.appendChild(f);c.appendChild(a);l.appendChild(c)}})}
function oB(n){cB=n;document.getElementById('main').style.display='none';document.getElementById('mh').style.display='none';document.getElementById('chat').style.display='flex';document.getElementById('ct').textContent=n;lL(true)}
function gB(){cB=null;if(pI)clearInterval(pI);document.getElementById('chat').style.display='none';document.getElementById('main').style.display='flex';document.getElementById('mh').style.display='flex';lB()}
function lL(s){if(!cB)return;api('/api/bot/'+cB+'/messages').then(d=>{var l=document.getElementById('clog');l.innerHTML='';if(d&&d.messages){for(var i=0;i<d.messages.length;i++){var m=d.messages[i],e=document.createElement('div');e.className='msg '+(m.role==='assistant'?'b':'u');e.textContent=m.content;l.appendChild(e)}}if(d&&d.status==='working'){var t=document.createElement('details');t.className='thn';t.open=true;var su=document.createElement('summary');su.textContent='Thinking...';var co=document.createElement('div');co.className='c';if(d.thoughts){for(var k=0;k<d.thoughts.length;k++){var p=document.createElement('div');p.textContent=d.thoughts[k];co.appendChild(p)}}t.appendChild(su);t.appendChild(co);l.appendChild(t);document.getElementById('cs').disabled=true;document.getElementById('cs').style.background='var(--dim)';if(s&&!pI){pI=setInterval(()=>lL(false),2000)}}else{if(pI){clearInterval(pI);pI=null}document.getElementById('cs').disabled=false;document.getElementById('cs').style.background='#fff'}l.scrollTop=l.scrollHeight})}
function sM(){var t=document.getElementById('ci').value.trim();if(!t||!cB)return;document.getElementById('ci').value='';document.getElementById('ci').style.height='auto';var l=document.getElementById('clog'),u=document.createElement('div');u.className='msg u';u.textContent=t;l.appendChild(u);l.scrollTop=l.scrollHeight;api('/api/bot/'+cB+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:t})}).then(()=>lL(true))}
document.getElementById('ci').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sM()}};
document.getElementById('ci').oninput=function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'};
function oS(){api('/api/settings').then(d=>{if(d&&d.token)document.getElementById('igt').value=d.token;document.getElementById('ms').style.display='flex'})}
function sS(){var t=document.getElementById('igt').value.trim();api('/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:t})}).then(()=>{document.getElementById('ms').style.display='none'})}
function oN(){document.getElementById('ian').value='';document.getElementById('iai').value='';document.getElementById('mn').style.display='flex'}
function cA(){var n=document.getElementById('ian').value.trim(),i=document.getElementById('iai').value.trim();if(!n)return alert('Name required');api('/api/bots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:n,instructions:i})}).then(()=>{document.getElementById('mn').style.display='none';lB()})}
function dB(n){if(!confirm('Delete this agent permanently?'))return;api('/api/bot/'+n+'/delete',{method:'POST'}).then(lB)}
function rA(){if(!confirm('Wipe everything?'))return;fetch('/api/reset').then(()=>location.reload())}
function cM(i){document.getElementById(i).style.display='none'}
lB();
</script>
</body>
</html>`;
