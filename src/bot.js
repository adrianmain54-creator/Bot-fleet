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

    if (!this.name) {
      this.name = (await this.ctx.storage.get("name")) || "unnamed";
      this.instructions = (await this.ctx.storage.get("instructions")) || "You are a helpful AI.";
    }

    if (path === "/list") { return Response.json((await this.ctx.storage.get("registry")) || []); }

    if (path === "/ensure_defaults") {
      let reg = (await this.ctx.storage.get("registry")) || [];
      if (!Array.isArray(reg)) reg = [];
      if (reg.length === 0) {
        const defaults = [{ name: "chief", instructions: "You are the Chief Manager of a software dev team. You do not write code. You delegate." }];
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
      this.instructions = instructions || "You are a helpful AI.";
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
      const status = (await this.ctx.storage.get("status")) || "idle";
      const thoughts = (await this.ctx.storage.get("thoughts")) || [];
      return Response.json({ messages: msgs, status, thoughts });
    }

    if (path === "/message" && request.method === "POST") {
      const { message } = await request.json();
      const history = (await this.ctx.storage.get("history")) || [];
      history.push({ role: "user", content: message, ts: Date.now() });
      await this.ctx.storage.put("history", history.slice(-100));
      
      await this.ctx.storage.put("status", "working");
      await this.ctx.storage.put("thoughts", ["Reading request..."]);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      
      return Response.json({ ok: true, status: "working" });
    }

    return new Response("not found", { status: 404 });
  }

  // THIS RUNS IN THE BACKGROUND, SURVIVING CLOUDFLARE TIMEOUTS
  async alarm() {
    const status = await this.ctx.storage.get("status");
    if (status !== "working") return;

    try {
      const history = (await this.ctx.storage.get("history")) || [];
      const lastMsg = history.filter(m => m.role === "user").pop();
      if (!lastMsg) throw new Error("No message.");

      const reply = await this.runAgent(lastMsg.content, history);
      
      // If reply is null, it means we are waiting for a worker (alarm was rescheduled)
      if (reply === null) return;

      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: reply, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
      await this.ctx.storage.put("status", "idle");
      await this.ctx.storage.delete("thoughts");

    } catch (e) {
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: "Error: " + e.message, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
      await this.ctx.storage.put("status", "idle");
    }
  }

  async runAgent(userMessage, history) {
    const isManager = this.name === "chief";
    
    // Check if we are waking up from a sleep to check a worker
    const pendingWorker = await this.ctx.storage.get("pending_worker");
    
    if (pendingWorker) {
      // Check status of the worker we are waiting for
      const stub = this.env.BOT.get(this.env.BOT.idFromName(pendingWorker));
      const res = await stub.fetch(new Request("https://bot/messages"));
      const data = await res.json();
      
      await this.addThought(`Checking status of ${pendingWorker}: ${data.status}`);
      
      if (data.status === "idle") {
        // Worker is done!
        const workerReply = data.messages[data.messages.length-1].content;
        await this.ctx.storage.delete("pending_worker");
        
        const newHistory = (await this.ctx.storage.get("history")) || [];
        newHistory.push({ role: "system", content: `${pendingWorker} replied: ${workerReply}`, ts: Date.now() });
        await this.ctx.storage.put("history", newHistory.slice(-100));
        
        // Return to normal loop
      } else {
        // Worker is still working. Sleep for 10 seconds and check again.
        await this.ctx.storage.setAlarm(Date.now() + 10000);
        return null; 
      }
    }

    const system = `You are "${this.name}".
${this.instructions}

${isManager ? `
YOU ARE THE MANAGER. 
DO NOT WRITE CODE. 
When given a task, you MUST:
1. Spawn a "coder" agent if you haven't already.
2. Delegate the task to the coder.
3. Wait for the coder to finish.
4. When done, reply to the user using the "finish" tool.
` : `
YOU ARE THE WORKER.
Your job is to actually do the work.
Use the github tools to read and write files.
When you have completed the task, use the "finish" tool to report back.
`}

CRITICAL RULES:
1. DO NOT CREATE A NEW REPO unless explicitly asked.
2. YOU CANNOT COMPILE BINARIES (.ipa, .exe). If asked, write the source code and a GitHub Action (.github/workflows/build.yml) to compile it. Tell the user to check the "Actions" tab.
3. NEVER hallucinate file content. Write real code.
4. If you want to talk to the user, use the "chat" tool.
5. When you are completely finished, use the "finish" tool.

Tools (reply with raw JSON):
- {"tool":"chat","text":"your normal reply"}
- {"tool":"finish","report":"Final summary"}
- {"tool":"spawn_agent","name":"coder","instructions":"You are a senior coder."}
- {"tool":"delegate_task","name":"coder","task":"the task"}
- {"tool":"github_list_files","repo":"name"}
- {"tool":"github_read_file","repo":"name","path":"file"}
- {"tool":"github_push_file","repo":"name","path":"file","content":"code","message":"msg"}
- {"tool":"github_create_repo","name":"name","description":"desc"}

Do NOT wrap JSON in markdown.`;

    const messages = [ { role: "system", content: system }, ...history.slice(-15) ];

    let raw = await this.askBrain(messages);

    while (true) {
      const parsed = this.extractJSON(raw);
      
      if (!parsed) {
        return raw;
      }

      const toolCall = parsed.json;

      if (toolCall.tool === "finish") {
        return toolCall.report;
      }
      if (toolCall.tool === "chat") {
        return toolCall.text;
      }

      await this.addThought(`Using ${toolCall.tool}...`);
      const result = await this.runTool(toolCall);
      await this.addThought(`Result: ${result.slice(0, 100)}...`);

      // INTERCEPT: If we just delegated a task, go to sleep!
      if (toolCall.tool === "delegate_task") {
        await this.ctx.storage.put("pending_worker", toolCall.name);
        await this.ctx.storage.setAlarm(Date.now() + 10000);
        return null; // Tells the alarm function we are sleeping
      }
      
      if (result.includes("GITHUB_TOKEN is not set") && toolCall.tool.includes("github_")) {
        return "Please tap the ⚙ gear icon and add your GitHub token.";
      }

      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });

      raw = await this.askBrain(messages);
    }
  }

  async addThought(txt) {
    let thoughts = (await this.ctx.storage.get("thoughts")) || [];
    thoughts.push(txt);
    await this.ctx.storage.put("thoughts", thoughts.slice(-10));
  }

  extractJSON(text) {
    if (typeof text !== 'string') return null;
    let firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;
    
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = firstBrace; i < text.length; i++) {
      let char = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\') { escapeNext = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      
      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            try {
              let json = JSON.parse(text.substring(firstBrace, i + 1));
              if (json && json.tool) {
                return { json: json };
              }
            } catch (e) {}
            return null;
          }
        }
      }
    }
    return null;
  }

  async getGithubToken() {
    if (this.env.GITHUB_TOKEN) return this.env.GITHUB_TOKEN;
    const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
    const res = await reg.fetch(new Request("https://registry/get_github_token"));
    return (await res.json()).token;
  }

  utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
  base64ToUtf8(str) { return decodeURIComponent(escape(atob(str))); }

  async runTool({ tool, ...args }) {
    if (tool === "spawn_agent") {
      const reg = this.env.BOT.get(this.env.BOT.idFromName("registry"));
      await reg.fetch(new Request("https://registry/register", { method: "POST", body: JSON.stringify({ name: args.name, instructions: args.instructions }) }));
      const stub = this.env.BOT.get(this.env.BOT.idFromName(args.name));
      await stub.fetch(new Request("https://bot/init", { method: "POST", body: JSON.stringify({ name: args.name, instructions: args.instructions }) }));
      return `Agent ${args.name} spawned successfully.`;
    }

    if (tool === "delegate_task") {
      const stub = this.env.BOT.get(this.env.BOT.idFromName(args.name));
      await stub.fetch(new Request("https://bot/message", { method: "POST", body: JSON.stringify({ message: args.task }) }));
      return `Task delegated to ${args.name}.`;
    }

    if (tool.includes("github_")) {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set.";
      
      const userRes = await fetch("https://api.github.com/user", { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
      const user = await userRes.json();
      if (!user.login) return "Error: Invalid GitHub token.";

      if (tool === "github_list_files") {
        try {
          let res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/main?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/master?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
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

      if (tool === "github_create_repo") {
        if (!args.name) return "Error: Missing repo name.";
        try {
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
      const res = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages, max_tokens: 2500 });
      let out = "";
      if (res && typeof res.response === 'string') out = res.response;
      else if (res && res.choices && res.choices[0] && res.choices[0].message) out = res.choices[0].message.content;
      else if (typeof res === 'string') out = res;
      else out = JSON.stringify(res);
      return out || "Empty response from AI.";
    } catch (e) { return "Brain Error: " + e.message; }
  }
}
