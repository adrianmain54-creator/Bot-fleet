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
          { name: "chief", instructions: "You are the Chief, a relentless autonomous developer. You must ALWAYS respond with a JSON object when using a tool. Example: {\"tool\":\"execute_code\",\"language\":\"python\",\"code\":\"print('hello')\"}. Do not wrap it in markdown. Do not add text outside the JSON. If a test fails, analyze the error, rewrite the code, and test it AGAIN. Do not stop iterating until the test passes perfectly." }
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
    const memory = (await this.ctx.storage.get("memory")) || [];
    const system = `You are "${this.name}", an autonomous AI worker.
Instructions: ${this.instructions}
You have these tools (you MUST reply with ONLY raw JSON to use a tool):
- {"tool":"search","query":"..."}
- {"tool":"fetch","url":"..."}
- {"tool":"execute_code","language":"python|javascript","code":"..."}
- {"tool":"browser_test","url":"...","script":"..."}
- {"tool":"github_create_repo","name":"...","description":"..."}
- {"tool":"github_push_file","repo":"...","path":"...","content":"...","message":"..."}
- {"tool":"github_read_file","repo":"...","path":"..."}
- {"tool":"remember","note":"..."}
- {"tool":"schedule","when":"...","task":"..."}
- {"tool":"add_job","title":"...","description":"...","assigned_to":"..."}
- {"tool":"list_jobs"}
- {"tool":"update_job","id":"...","status":"..."}
- {"tool":"message_bot","target":"...","message":"..."}

CRITICAL: Do NOT wrap your JSON in markdown block quotes. Just output raw JSON.
If you just want to talk, reply in plain text.
Long-term memory: ${memory.length ? memory.join("; ") : "empty"}`;

    const messages = [
      { role: "system", content: system },
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    let raw = await this.askBrain(messages);
    let steps = 0;
    const maxSteps = 15;

    while (steps < maxSteps) {
      const toolCall = this.parseTool(raw);
      if (!toolCall) break; 
      
      steps++;
      send({ type: "status", text: `Step ${steps}/${maxSteps}: Using ${toolCall.tool}...` });
      
      const result = await this.runTool(toolCall);
      
      send({ type: "status", text: `Result: ${result.slice(0, 150)}...` });
      
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });

      if (steps === maxSteps - 1) {
        messages.push({ role: "user", content: "You are almost out of steps. Stop testing and output your final answer now." });
      }
      
      raw = await this.askBrain(messages);
      if (!raw || typeof raw !== 'string') {
         raw = "I experienced an internal error generating a response.";
         break;
      }
    }

    if (raw.trim().startsWith('{"tool"')) {
       return "I ran into a formatting error and couldn't finish the task.";
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

    if (tool === "fetch") {
      try {
        const res = await fetch(args.url, {
          headers: { "user-agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" },
        });
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 4000);
        return text || "empty page";
      } catch (e) {
        return "fetch failed: " + e.message;
      }
    }

    if (tool === "execute_code") {
      try {
        const res = await fetch("https://emkc.org/api/v2/piston/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            language: args.language || "python",
            version: "*",
            files: [{ content: args.code || "" }]
          })
        });
        const data = await res.json();
        if (data.run) {
           return data.run.stdout || data.run.stderr || "Code executed with no output.";
        }
        return "Execution error: " + JSON.stringify(data);
      } catch (e) {
        return "Execution failed: " + e.message;
      }
    }

    if (tool === "browser_test") {
      if (!this.env.BROWSERLESS_API_KEY) return "Error: You need to add BROWSERLESS_API_KEY to your Cloudflare variables to test browser actions.";
      try {
        const res = await fetch(`https://chrome.browserless.io/function?token=${this.env.BROWSERLESS_API_KEY}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: `
              export default async function ({ page }) {
                await page.goto('${args.url}');
                ${args.script}
                const html = await page.content();
                return { data: html.slice(0, 2000), type: 'text/plain' };
              }
            `
          })
        });
        const text = await res.text();
        if (!res.ok) return "Browserless error: " + text;
        return "Action succeeded. Resulting HTML snippet: " + text.slice(0, 1000);
      } catch (e) {
        return "Browser test failed: " + e.message;
      }
    }

    if (tool === "github_create_repo") {
      if (!this.env.GITHUB_TOKEN) return "Error: GITHUB_TOKEN is not set in Cloudflare environment variables.";
      try {
        const res = await fetch("https://api.github.com/user/repos", {
          method: "POST",
          headers: {
            "authorization": "Bearer " + this.env.GITHUB_TOKEN,
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
      if (!this.env.GITHUB_TOKEN) return "Error: GITHUB_TOKEN is not set.";
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "authorization": "Bearer " + this.env.GITHUB_TOKEN, "user-agent": "BotFleet" }
        });
        const user = await userRes.json();
        
        let sha = null;
        const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
          headers: { "authorization": "Bearer " + this.env.GITHUB_TOKEN, "user-agent": "BotFleet" }
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
            "authorization": "Bearer " + this.env.GITHUB_TOKEN,
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
      if (!this.env.GITHUB_TOKEN) return "Error: GITHUB_TOKEN is not set.";
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: { "authorization": "Bearer " + this.env.GITHUB_TOKEN, "user-agent": "BotFleet" }
        });
        const user = await userRes.json();

        const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, {
          headers: { "authorization": "Bearer " + this.env.GITHUB_TOKEN, "user-agent": "BotFleet" }
        });
        if (!res.ok) return "GitHub error: " + (await res.text());
        const data = await res.json();
        
        const content = decodeURIComponent(escape(atob(data.content)));
        return `File contents of ${args.path}:\n\n${content}`;
      } catch (e) {
        return "Failed: " + e.message;
      }
    }

    if (tool === "remember") {
      const mem = (await this.ctx.storage.get("memory")) || [];
      mem.push(String(args.note).slice(0, 300));
      await this.ctx.storage.put("memory", mem.slice(-50));
      return "saved";
    }

    if (tool === "recall") {
      const mem = (await this.ctx.storage.get("memory")) || [];
      return mem.length ? mem.join("\n") : "empty";
    }

    if (tool === "schedule") {
      const when = new Date(args.when).getTime();
      if (!when) return "invalid date";
      await this.ctx.storage.setAlarm(when);
      await this.ctx.storage.put("scheduledTask", args.task || "wake up and check in");
      return `scheduled for ${new Date(when).toISOString()}`;
    }

    if (tool === "add_job") {
      const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/add_job", {
        method: "POST",
        body: JSON.stringify({
          title: args.title || "Untitled Job",
          description: args.description || "",
          assigned_to: args.assigned_to || "unassigned",
          creator: this.name
        })
      }));
      return "job added to board";
    }

    if (tool === "list_jobs") {
      const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
      const res = await reg.fetch(new Request("https://registry/list_jobs"));
      const jobs = await res.json();
      if (!jobs.length) return "job board is empty";
      return jobs.map(j => `[ID: ${j.id}] ${j.title} (Assigned to: ${j.assigned_to}, Status: ${j.status})`).join("\n");
    }

    if (tool === "update_job") {
      const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/update_job", {
        method: "POST",
        body: JSON.stringify({ id: args.id, status: args.status })
      }));
      return "job updated";
    }

    if (tool === "message_bot") {
      if (args.target === this.name) return "You cannot message yourself.";
      const targetStub = this.env.BOT.get(this.env.BOT.idFromName(args.target));
      
      const res = await targetStub.fetch(new Request("https://bot/message", {
        method: "POST",
        body: JSON.stringify({ message: `[Message from ${this.name}]: ${args.message}` })
      }));
      
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', reply = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            if (o.type === 'delta') reply += o.text;
          } catch {}
        }
      }
      return reply || "They didn't reply with anything.";
    }

    return "unknown tool";
  }

  async askBrain(messages) {
    try {
      if (this.env.BRAIN === "groq" && this.env.GROQ_API_KEY) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + this.env.GROQ_API_KEY,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.7,
            max_tokens: 800,
          }),
        });
        if (!res.ok) throw new Error("groq: " + (await res.text()).slice(0, 200));
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
      
      const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
        messages,
        max_tokens: 800,
      });
      
      if (typeof res === 'string') return res;
      if (res && typeof res.response === 'string') return res.response;
      
      return JSON.stringify(res);
    } catch (e) {
      return "Brain Error: " + e.message;
    }
  }

  async alarm() {
    const task = (await this.ctx.storage.get("scheduledTask")) || "wake up and continue your research";
    const history = (await this.ctx.storage.get("history")) || [];
    const reply = await this.runAgent(`Scheduled task: ${task}`, history, () => {});
    history.push({ role: "assistant", content: `[scheduled] ${reply}`, ts: Date.now() });
    await this.ctx.storage.put("history", history.slice(-40));
    await this.ctx.storage.delete("scheduledTask");
  }
}
