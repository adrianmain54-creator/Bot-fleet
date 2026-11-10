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

    // PATCH: Load name and instructions on every request to survive cold starts
    if (!this.name) {
      this.name = (await this.ctx.storage.get("name")) || "unnamed";
      this.instructions = (await this.ctx.storage.get("instructions")) || "You are a helpful autonomous developer.";
    }

    if (path === "/list") {
      return Response.json((await this.ctx.storage.get("registry")) || []);
    }

    if (path === "/ensure_defaults") {
      let reg = (await this.ctx.storage.get("registry")) || [];
      if (!Array.isArray(reg)) reg = [];
      if (reg.length === 0) {
        const defaults = [{ name: "chief", instructions: "You are the Chief." }];
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
      this.instructions = instructions || "You are a helpful autonomous developer.";
      await this.ctx.storage.put("name", this.name);
      await this.ctx.storage.put("instructions", this.instructions);
      return new Response("ok");
    }

    if (path === "/delete") {
      await this.ctx.storage.deleteAll();
      return new Response("deleted");
    }

    if (path === "/messages") {
      const msgs = (await this.ctx.storage.get("history")) || [];
      return Response.json(msgs);
    }

    if (path === "/message" && request.method === "POST") {
      const { message } = await request.json();
      return this.handleMessage(message);
    }

    return new Response("not found", { status: 404 });
  }

  async handleMessage(userMessage) {
    const history = (await this.ctx.storage.get("history")) || [];
    history.push({ role: "user", content: userMessage, ts: Date.now() });
    await this.ctx.storage.put("history", history.slice(-40));

    const stream = new ReadableStream({
      start: async (controller) => {
        const enc = new TextEncoder();
        const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          let reply = await this.runAgent(userMessage, history, send);
          for (let i = 0; i < reply.length; i += 60) {
            send({ type: "delta", text: reply.slice(i, i + 60) });
          }
          history.push({ role: "assistant", content: reply, ts: Date.now() });
          await this.ctx.storage.put("history", history.slice(-40));
          send({ type: "done" });
        } catch (e) {
          send({ type: "error", text: String(e.message || e) });
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
    });
  }

  async runAgent(userMessage, history, send) {
    // PATCH: Actually use this.instructions
    const system = `You are "${this.name}".
${this.instructions}

CRITICAL RULES:
1. Act like a senior developer.
2. DO NOT create a new repository unless explicitly told to.
3. ALWAYS use github_list_files and github_read_file to inspect a repo before editing.
4. Provide ENTIRE file contents when using github_push_file.
5. Output ONLY ONE raw JSON object per message when using a tool.

Tools (reply with raw JSON):
- {"tool":"github_list_files","repo":"name"}
- {"tool":"github_read_file","repo":"name","path":"file"}
- {"tool":"github_push_file","repo":"name","path":"file","content":"code","message":"msg"}
- {"tool":"github_delete_file","repo":"name","path":"file","message":"msg"}
- {"tool":"github_create_repo","name":"name","description":"desc"}

Do NOT wrap JSON in markdown.`;

    const messages = [
      { role: "system", content: system },
      ...history.slice(-15)
    ];

    let raw = await this.askBrain(messages);
    let steps = 0;

    while (steps < 15) {
      const toolCall = this.parseTool(raw);
      if (!toolCall) break; 
      
      steps++;
      send({ type: "status", text: `Step ${steps}: Using ${toolCall.tool}...` });
      
      const result = await this.runTool(toolCall);
      send({ type: "status", text: `Result: ${result.slice(0, 100)}...` });
      
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

    let cleanResponse = raw.replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '').trim();
    if (!cleanResponse) return "✅ Task completed. Check your GitHub.";
    return cleanResponse;
  }

  parseTool(text) {
    if (typeof text !== 'string') return null;
    try {
      let clean = text.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-zA-Z]*\n/, '').replace(/```$/, '').trim();
      }
      const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
      if (first !== -1 && last !== -1) clean = clean.substring(first, last + 1);
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

  // PATCH: UTF-8 Safe Base64
  utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  base64ToUtf8(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  async runTool({ tool, ...args }) {
    if (tool.includes("github_")) {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      
      const userRes = await fetch("https://api.github.com/user", { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
      const user = await userRes.json();
      if (!user.login) return "Error: Invalid GitHub token.";

      if (tool === "github_list_files") {
        try {
          // PATCH: Try main, fallback to master
          let res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/main?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) {
             res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/master?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          }
          if (!res.ok) return "GitHub error: " + (await res.text());
          const files = (await res.json()).tree.filter(item => item.type === "blob").map(item => item.path);
          return `Files in ${args.repo}:\n` + files.join("\n");
        } catch (e) { return "failed"; }
      }

      if (tool === "github_read_file") {
        try {
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `Contents:\n\n${this.base64ToUtf8((await res.json()).content)}`;
        } catch (e) { return "failed"; }
      }

      if (tool === "github_push_file") {
        // PATCH: Argument validation
        if (!args.repo || !args.path || args.content === undefined) return "Error: Missing repo, path, or content.";
        try {
          let sha = null;
          const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (checkRes.ok) sha = (await checkRes.json()).sha;
          const body = { message: args.message || "Update", content: this.utf8ToBase64(args.content) };
          if (sha) body.sha = sha;
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { method: "PUT", headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File ${args.path} pushed.`;
        } catch (e) { return "failed"; }
      }

      if (tool === "github_delete_file") {
        if (!args.repo || !args.path) return "Error: Missing repo or path.";
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!checkRes.ok) return "File not found.";
          const sha = (await checkRes.json()).sha;
          const body = { message: args.message || "Delete", sha: sha };
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { method: "DELETE", headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File ${args.path} deleted.`;
        } catch (e) { return "failed"; }
      }

      if (tool === "github_create_repo") {
        if (!args.name) return "Error: Missing repo name.";
        try {
          // PATCH: Default to private: true
          const res = await fetch("https://api.github.com/user/repos", { method: "POST", headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, body: JSON.stringify({ name: args.name, description: args.description || "", private: true, auto_init: true }) });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `Repo created: ${(await res.json()).html_url}`;
        } catch (e) { return "failed"; }
      }
    }
    return "Executed.";
  }

  async askBrain(messages) {
    try {
      const res = await this.env.AI.run("@cf/qwen/qwen2.5-coder-32b-instruct", { messages, max_tokens: 2500 });
      if (res?.choices?.[0]?.message?.content) return res.choices[0].message.content;
      if (typeof res === 'string') return res;
      if (res?.response) return res.response;
      return JSON.stringify(res);
    } catch (e) { return "Brain Error: " + e.message; }
  }
}
