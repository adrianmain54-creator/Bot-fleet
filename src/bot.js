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

    // --- REGISTRY LOGIC ---
    if (path === "/list") {
      const reg = (await this.ctx.storage.get("registry")) || [];
      return Response.json(reg);
    }

    if (path === "/ensure_defaults") {
      const reg = (await this.ctx.storage.get("registry")) || [];
      if (reg.length === 0) {
        const defaults = [
          { name: "chief", instructions: "You are the Chief of Staff. Your job is to manage tasks, assign jobs to specialists using the message_bot tool, and summarize results for Aoid. You do not do heavy research yourself. If Aoid asks for something, figure out if you need the researcher or writer, message them, wait for their reply, and then give Aoid the final answer." },
          { name: "researcher", instructions: "You are the Researcher. You only use the search and fetch tools to find facts. When the Chief messages you, do the research and reply with your findings." },
          { name: "writer", instructions: "You are the Writer. You take raw research and turn it into clean, well-formatted reports. When the Chief messages you with research, write the report and reply." }
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
    // ----------------------------------------

    if (path === "/init") {
      const { name, instructions } = await request.json();
      this.name = name;
      this.instructions = instructions || "You are a helpful autonomous research bot.";
      await this.ctx.storage.put("name", this.name);
      await this.ctx.storage.put("instructions", this.instructions);
      return new Response("ok");
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
          let reply = await this.runAgent(userMessage, history);
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

  async runAgent(userMessage, history) {
    const memory = (await this.ctx.storage.get("memory")) || [];
    const system = `You are "${this.name}", an autonomous AI worker.
Instructions: ${this.instructions}
You have these tools (call one by replying with ONLY a JSON object and nothing else):
- {"tool":"search","query":"..."} — search the web
- {"tool":"fetch","url":"..."} — read a webpage
- {"tool":"remember","note":"..."} — save a fact to memory
- {"tool":"recall"} — list memory
- {"tool":"schedule","when":"ISO date","task":"..."} — schedule a future task
- {"tool":"add_job","title":"...","description":"...","assigned_to":"..."} — add a task to the board
- {"tool":"list_jobs"} — see all tasks on the board
- {"tool":"update_job","id":"...","status":"done|in_progress"} — update a task
- {"tool":"message_bot","target":"bot_name","message":"..."} — send a message to another bot and wait for their reply

If no tool is needed, just answer normally in plain text (no JSON).
Long-term memory: ${memory.length ? memory.join("; ") : "empty"}`;

    const messages = [
      { role: "system", content: system },
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    let raw = await this.askBrain(messages);

    for (let i = 0; i < 4; i++) {
      const toolCall = this.parseTool(raw);
      if (!toolCall) break;
      
      const result = await this.runTool(toolCall);
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });
      raw = await this.askBrain(messages);
    }

    return raw;
  }

  parseTool(text) {
    try {
      const obj = JSON.parse(text.trim());
      if (obj && obj.tool) return obj;
    } catch {}
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
      return data.choices[0].message.content;
    }
    
    const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages,
      max_tokens: 800,
    });
    return res.response;
  }

  async alarm() {
    const task = (await this.ctx.storage.get("scheduledTask")) || "wake up and continue your research";
    const history = (await this.ctx.storage.get("history")) || [];
    const reply = await this.runAgent(`Scheduled task: ${task}`, history);
    history.push({ role: "assistant", content: `[scheduled] ${reply}`, ts: Date.now() });
    await this.ctx.storage.put("history", history.slice(-40));
    await this.ctx.storage.delete("scheduledTask");
  }
}
