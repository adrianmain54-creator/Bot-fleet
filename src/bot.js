export class BotDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.name = null;
    this.instructions = "";
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/reset") {
      await this.ctx.storage.deleteAll();
      return Response.json({ ok: true });
    }

    if (path === "/list") {
      return Response.json((await this.ctx.storage.get("registry")) || []);
    }

    if (path === "/ensure_defaults") {
      let reg = (await this.ctx.storage.get("registry")) || [];
      if (!Array.isArray(reg)) reg = [];
      
      if (reg.length === 0) {
        const defaults = [{ name: "chief", instructions: "You are the Chief. ONLY use tools if the user asks you to build something. Do not build unprompted." }];
        for (const bot of defaults) {
          const stub = this.env.BOT.get(this.env.BOT.idFromName(bot.name));
          await stub.fetch(new Request("https://bot/init", { method: "POST", body: JSON.stringify(bot) }));
        }
        await this.ctx.storage.put("registry", defaults);
        return Response.json(defaults);
      }
      return Response.json(reg);
    }

    if (path === "/unregister") {
      const { name } = await request.json();
      let reg = (await this.ctx.storage.get("registry")) || [];
      await this.ctx.storage.put("registry", reg.filter(b => b.name !== name));
      return Response.json({ ok: true });
    }

    if (path === "/register") {
      const { name, instructions } = await request.json();
      const reg = (await this.ctx.storage.get("registry")) || [];
      if (!reg.find(b => b.name === name)) {
        reg.push({ name, instructions });
        await this.ctx.storage.put("registry", reg);
      }
      return Response.json({ ok: true });
    }

    if (path === "/set_github_token") {
      const { token } = await request.json();
      await this.ctx.storage.put("github_token", token);
      return Response.json({ ok: true });
    }
    if (path === "/get_github_token") {
      return Response.json({ token: (await this.ctx.storage.get("github_token")) || null });
    }

    if (path === "/init") {
      const { name, instructions } = await request.json();
      this.name = name;
      this.instructions = instructions || "You are a helpful autonomous research bot.";
      await this.ctx.storage.put("name", this.name);
      await this.ctx.storage.put("instructions", this.instructions);
      return new Response("ok");
    }

    if (path === "/delete") {
      await this.ctx.storage.deleteAll();
      return new Response("deleted");
    }

    if (!this.name) {
      this.name = (await this.ctx.storage.get("name")) || "unnamed";
      this.instructions = (await this.ctx.storage.get("instructions")) || "You are a helpful autonomous research bot.";
    }

    if (path === "/messages") {
      const msgs = (await this.ctx.storage.get("history")) || [];
      const status = (await this.ctx.storage.get("status")) || "idle";
      return Response.json({ messages: msgs, status });
    }

    if (path === "/message" && request.method === "POST") {
      const { message } = await request.json();
      
      const history = (await this.ctx.storage.get("history")) || [];
      history.push({ role: "user", content: message, ts: Date.now() });
      await this.ctx.storage.put("history", history.slice(-100));
      
      await this.ctx.storage.put("status", "working");
      await this.ctx.storage.setAlarm(Date.now() + 100);
      
      return Response.json({ ok: true, status: "working" });
    }

    return new Response("not found", { status: 404 });
  }

  async alarm() {
    const status = await this.ctx.storage.get("status");
    if (status !== "working") return;

    try {
      const history = (await this.ctx.storage.get("history")) || [];
      const reply = await this.runAgent(history);
      
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: reply, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
    } catch (e) {
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: "Background task failed: " + e.message, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
    } finally {
      await this.ctx.storage.put("status", "idle");
    }
  }

  async runAgent(history) {
    const memory = (await this.ctx.storage.get("memory")) || [];
    const system = `You are "${this.name}".
Instructions: ${this.instructions}

CRITICAL RULES:
1. ONLY use tools if asked to build, search, or execute.
2. If the user asks for something impossible (like compiling an IPA or building a VPN server in the chat), explain politely that you cannot do it and suggest an alternative. DO NOT try to use a tool if it won't work.
3. When finished, output a final plain-text summary.

Tools (reply with ONLY raw JSON to use):
- {"tool":"search","query":"..."}
- {"tool":"execute_code","language":"python|javascript","code":"..."}
- {"tool":"github_create_repo","name":"...","description":"..."}
- {"tool":"github_push_file","repo":"...","path":"...","content":"...","message":"..."}
- {"tool":"github_read_file","repo":"...","path":"..."}
- {"tool":"github_list_files","repo":"..."}

Do NOT wrap JSON in markdown. Just raw JSON.`;

    const messages = [
      { role: "system", content: system },
      ...history.slice(-10)
    ];

    let raw = await this.askBrain(messages);
    let steps = 0;
    let thoughts = [];

    while (steps < 15) { 
      const toolCall = this.parseTool(raw);
      if (!toolCall) break; 
      
      steps++;
      thoughts.push(`Step ${steps}: Using ${toolCall.tool}...`);
      
      const result = await this.runTool(toolCall);
      thoughts.push(`Result: ${result.slice(0, 100)}...`);
      
      if (result.includes("GITHUB_TOKEN is not set")) {
        return "Please tap the ⚙ gear icon and add your GitHub token.";
      }

      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });

      raw = await this.askBrain(messages);
      if (!raw || typeof raw !== 'string') {
         raw = "I experienced an internal error.";
         break;
      }
    }

    if (thoughts.length > 0) {
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "system", content: "Thoughts:\n" + thoughts.join("\n"), ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
    }

    if (raw.trim().startsWith('{"tool"')) {
       return "I got stuck trying to use a tool. Please try a different prompt.";
    }

    return raw;
  }

  parseTool(text) {
    if (typeof text !== 'string') return null;
    try {
      let clean = text.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-zA-Z]*\n/, '').replace(/```$/, '').trim();
      }
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        clean = clean.substring(firstBrace, lastBrace + 1);
      }
      const obj = JSON.parse(clean);
      if (obj && obj.tool) return obj;
    } catch (e) {}
    return null;
  }

  async getGithubToken() {
    if (this.env.GITHUB_TOKEN) return this.env.GITHUB_TOKEN;
    const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
    const res = await reg.fetch(new Request("https://registry/get_github_token"));
    return (await res.json()).token;
  }

  async runTool({ tool, ...args }) {
    if (tool === "search") {
      try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query || "")}`, { headers: { "user-agent": "Mozilla/5.0" } });
        const html = await res.text();
        const results = [];
        const re = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html)) && results.length < 5) results.push(`- ${m[2].replace(/<[^>]+>/g, "").trim()} (${m[1]})`);
        return results.length ? results.join("\n") : "no results";
      } catch (e) { return "search failed: " + e.message; }
    }

    if (tool === "execute_code") {
      try {
        const res = await fetch("https://wandbox.org/api/compile.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ compiler: args.language === "javascript" ? "nodejs-20.0.0" : "cpython-3.10.2", code: args.code || "" })
        });
        const data = await res.json();
        return data.program_output || data.compiler_error || data.program_error || "No output.";
      } catch (e) { return "Execution failed: " + e.message; }
    }

    if (tool === "github_create_repo" || tool === "github_push_file" || tool === "github_read_file" || tool === "github_list_files") {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      
      const userRes = await fetch("https://api.github.com/user", { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
      const user = await userRes.json();
      if (!user.login) return "Error: Invalid GitHub token.";

      if (tool === "github_create_repo") {
        try {
          const res = await fetch("https://api.github.com/user/repos", {
            method: "POST",
            headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json", "accept": "application/vnd.github.v3+json" },
            body: JSON.stringify({ name: args.name, description: args.description || "", private: false, auto_init: true })
          });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `Repo created successfully: ${(await res.json()).html_url}`;
        } catch (e) { return "Failed: " + e.message; }
      }

      if (tool === "github_push_file") {
        try {
          let sha = null;
          const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (checkRes.ok) sha = (await checkRes.json()).sha;

          const body = { message: args.message || "Update", content: btoa(unescape(encodeURIComponent(args.content))) };
          if (sha) body.sha = sha;

          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
            method: "PUT",
            headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json", "accept": "application/vnd.github.v3+json" },
            body: JSON.stringify(body)
          });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File ${args.path} pushed successfully.`;
        } catch (e) { return "Failed: " + e.message; }
      }

      if (tool === "github_read_file") {
        try {
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File contents:\n\n${decodeURIComponent(escape(atob((await res.json()).content)))}`;
        } catch (e) { return "Failed: " + e.message; }
      }

      if (tool === "github_list_files") {
        try {
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/main?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) return "GitHub error: " + (await res.text());
          const files = (await res.json()).tree.filter(item => item.type === "blob").map(item => item.path);
          return `Files in ${args.repo}:\n` + files.join("\n");
        } catch (e) { return "Failed: " + e.message; }
      }
    }

    return "Tool executed (or unknown tool).";
  }

  async askBrain(messages) {
    try {
      const res = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages, max_tokens: 1000 });
      if (res && res.choices && res.choices[0] && res.choices[0].message) return res.choices[0].message.content;
      if (typeof res === 'string') return res;
      if (res && typeof res.response === 'string') return res.response;
      return JSON.stringify(res);
    } catch (e) {
      try {
        const fallback = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", { messages, max_tokens: 800 });
        return fallback.response;
      } catch (err) { return "Brain Error: " + e.message; }
    }
  }
}
