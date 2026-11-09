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

    if (path === "/list") {
      const reg = (await this.ctx.storage.get("registry")) || [];
      return Response.json(reg);
    }

    if (path === "/ensure_defaults") {
      const reg = (await this.ctx.storage.get("registry")) || [];
      if (reg.length === 0) {
        const defaults = [
          { name: "chief", instructions: "You are the Chief. You are a helpful, conversational AI. If the user says hello or asks a question, just reply normally. ONLY use your tools if the user asks you to build something, search the web, or write code. Do not build things unprompted. If you crash or lose your train of thought, use github_list_files to see what you've already built." }
        ];
        for (const bot of defaults) {
          const stub = this.env.BOT.get(this.env.BOT.idFromName(bot.name));
          await stub.fetch(new Request("https://bot/init", {
            method: "POST",
            body: JSON.stringify(bot)
          }));
        }
        await this.ctx.storage.put("registry", defaults);
        return Response.json(defaults);
      }
      return Response.json(reg);
    }

    if (path === "/unregister") {
      const { name } = await request.json();
      let reg = (await this.ctx.storage.get("registry")) || [];
      reg = reg.filter(b => b.name !== name);
      await this.ctx.storage.put("registry", reg);
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
      const token = await this.ctx.storage.get("github_token");
      return Response.json({ token: token || null });
    }

    if (path === "/add_job") {
      const job = await request.json();
      const jobs = (await this.ctx.storage.get("jobs")) || [];
      job.id = Date.now().toString();
      job.status = job.status || "pending";
      jobs.push(job);
      await this.ctx.storage.put("jobs", jobs);
      return Response.json({ ok: true, job });
    }

    if (path === "/list_jobs") {
      const jobs = (await this.ctx.storage.get("jobs")) || [];
      return Response.json(jobs);
    }

    if (path === "/update_job") {
      const { id, status } = await request.json();
      const jobs = (await this.ctx.storage.get("jobs")) || [];
      const job = jobs.find(j => j.id === id);
      if (job) {
        job.status = status;
        await this.ctx.storage.put("jobs", jobs);
      }
      return Response.json({ ok: true });
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
    send({ type: "status", text: "Analyzing request..." });

    const memory = (await this.ctx.storage.get("memory")) || [];
    const system = `You are "${this.name}", an autonomous AI worker.
Instructions: ${this.instructions}

CRITICAL RULES:
1. If the user just says hello or asks a normal question, reply normally in plain text. DO NOT use tools.
2. ONLY use tools if the user explicitly asks you to build something, search, or execute code.
3. DO NOT write massive blocks of code in the chat. Use github_create_repo and github_push_file to actually build things.
4. When you are completely finished with the task, stop using tools and output a final plain-text summary of what you did.

You have these tools (you MUST reply with ONLY raw JSON to use a tool):
- {"tool":"search","query":"..."}
- {"tool":"fetch","url":"..."}
- {"tool":"execute_code","language":"python|javascript","code":"..."}
- {"tool":"github_create_repo","name":"...","description":"..."}
- {"tool":"github_push_file","repo":"...","path":"...","content":"...","message":"..."}
- {"tool":"github_read_file","repo":"...","path":"..."}
- {"tool":"github_list_files","repo":"..."}
- {"tool":"remember","note":"..."}
- {"tool":"schedule","when":"...","task":"..."}

Do NOT wrap your JSON in markdown block quotes. Just output raw JSON.`;

    const messages = [
      { role: "system", content: system },
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    let raw = await this.askBrain(messages);
    let steps = 0;

    while (true) {
      const toolCall = this.parseTool(raw);
      if (!toolCall) break; 
      
      steps++;
      send({ type: "status", text: `Step ${steps}: Using ${toolCall.tool}...` });
      
      const result = await this.runTool(toolCall);
      
      send({ type: "status", text: `Result: ${result.slice(0, 150)}...` });
      
      if (result.includes("GITHUB_TOKEN is not set")) {
        return "I need permission to access your GitHub. Please tap the ⚙ gear icon in the top right and paste your GitHub token.";
      }

      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });

      raw = await this.askBrain(messages);
      if (!raw || typeof raw !== 'string') {
         raw = "I experienced an internal error generating a response.";
         break;
      }
    }

    if (raw.trim().startsWith('{"tool"')) {
       return "I got stuck trying to use a tool. Please try again.";
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
    const data = await res.json();
    return data.token;
  }

  async runTool({ tool, ...args }) {
    if (tool === "search") {
      try {
        const q = encodeURIComponent(args.query || "");
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
          headers: { "user-agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" },
        });
        const html = await res.text();
        const results = [];
        const re = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html)) && results.length < 5) {
          results.push(`- ${m[2].replace(/<[^>]+>/g, "").trim()} (${m[1]})`);
        }
        return results.length ? results.join("\n") : "no results";
      } catch (e) {
        return "search failed: " + e.message;
      }
    }

    if (tool === "execute_code") {
      try {
        const res = await fetch("https://wandbox.org/api/compile.json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            compiler: args.language === "javascript" ? "nodejs-20.0.0" : "cpython-3.10.2",
            code: args.code || ""
          })
        });
        const data = await res.json();
        return data.program_output || data.compiler_error || data.program_error || "Code executed with no output.";
      } catch (e) {
        return "Execution failed: " + e.message;
      }
    }

    if (tool === "github_create_repo") {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      try {
        const res = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            "authorization": "Bearer " + token,
            "user-agent": "BotFleet",
            "content-type": "application/json",
            "accept": "application/vnd.github.v3+json"
          },
          body: JSON.stringify({
            name: args.name,
            description: args.description || "",
            private: false,
            auto_init: true
          })
        });
        if (!res.ok) return "GitHub error: " + (await res.text());
        const data = await res.json();
        return `Repo created successfully: ${data.html_url}`;
      } catch (e) {
        return "Failed: " + e.message;
      }
    }

    if (tool === "github_push_file") {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        const user = await userRes.json();
        
        let sha = null;
        const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        if (checkRes.ok) {
          const fileData = await checkRes.json();
          sha = fileData.sha;
        }

        const body = {
          message: args.message || "Update from Bot Fleet",
          content: btoa(unescape(encodeURIComponent(args.content))),
        };
        if (sha) body.sha = sha;

        const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
          method: "PUT",
          headers: {
            "authorization": "Bearer " + token,
            "user-agent": "BotFleet",
            "content-type": "application/json",
            "accept": "application/vnd.github.v3+json"
          },
          body: JSON.stringify(body)
        });
        
        if (!res.ok) return "GitHub error: " + (await res.text());
        return `File ${args.path} pushed successfully.`;
      } catch (e) {
        return "Failed: " + e.message;
      }
    }

    if (tool === "github_read_file") {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        const user = await userRes.json();

        const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        if (!res.ok) return "GitHub error: " + (await res.text());
        const data = await res.json();
        
        const content = decodeURIComponent(escape(atob(data.content)));
        return `File contents of ${args.path}:\n\n${content}`;
      } catch (e) {
        return "Failed: " + e.message;
      }
    }

    if (tool === "github_list_files") {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        const user = await userRes.json();

        const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/main?recursive=1`, {
          headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" }
        });
        if (!res.ok) return "GitHub error: " + (await res.text());
        const data = await res.json();
        
        const files = data.tree.filter(item => item.type === "blob").map(item => item.path);
        return `Files in ${args.repo}:\n` + files.join("\n");
      } catch (e) {
        return "Failed: " + e.message;
      }
    }

    return "Tool executed (or unknown tool).";
  }

  async askBrain(messages) {
    try {
      const res = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages,
        max_tokens: 1000,
      });
      
      if (res && res.choices && res.choices[0] && res.choices[0].message) {
        return res.choices[0].message.content;
      }
      if (typeof res === 'string') return res;
      if (res && typeof res.response === 'string') return res.response;
      
      return JSON.stringify(res);
    } catch (e) {
      try {
        const fallback = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages,
          max_tokens: 800,
        });
        return fallback.response;
      } catch (err) {
        return "Brain Error: " + e.message;
      }
    }
  }

  async alarm() {}
}
