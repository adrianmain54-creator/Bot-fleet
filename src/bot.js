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
      return new Response("reset");
    }

    if (path === "/list") {
      return Response.json((await this.ctx.storage.get("registry")) || []);
    }

    if (path === "/ensure_defaults") {
      let reg = (await this.ctx.storage.get("registry")) || [];
      if (!Array.isArray(reg)) reg = [];
      if (reg.length === 0) {
        const defaults = [{ name: "chief", instructions: "You are a senior developer acting as a coworker." }];
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
      this.instructions = instructions || "You are a senior developer acting as a coworker.";
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
      this.instructions = (await this.ctx.storage.get("instructions")) || "You are a senior developer.";
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
      await this.ctx.storage.put("thoughts", ["Reading workspace..."]);
      
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
      const lastMsg = history.filter(m => m.role === "user").pop();
      if (!lastMsg) throw new Error("No message.");

      const reply = await this.runAgent(lastMsg.content, history);
      
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: reply, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));

    } catch (e) {
      const newHistory = (await this.ctx.storage.get("history")) || [];
      newHistory.push({ role: "assistant", content: "Error: " + e.message, ts: Date.now() });
      await this.ctx.storage.put("history", newHistory.slice(-100));
    } finally {
      await this.ctx.storage.put("status", "idle");
      await this.ctx.storage.delete("thoughts");
    }
  }

  async runAgent(userMessage, history) {
    const system = `You are "${this.name}", an elite senior developer and the user's coworker. 
You are working directly on the user's GitHub.

CRITICAL RULES:
1. DO NOT create a new repository unless the user explicitly says "create a new repo". If they just say "make X", assume you should edit an existing repo or ask which one.
2. ALWAYS inspect a repository before editing it. Use "github_list_files" to see the structure, and "github_read_file" to read the code.
3. When updating a file, you MUST provide the ENTIRE updated code, not just the changed lines. Use "github_push_file" to commit.
4. You have "github_delete_file" to remove old files if you are restructuring.
5. Act like a human. Talk to the user. Explain what you are about to do, then do it.
6. Output ONLY ONE raw JSON object per message when using a tool. Do not chain multiple JSONs together.
7. If a tool fails, analyze the error, fix your logic, and try again.

Tools (reply with raw JSON):
- {"tool":"github_list_files","repo":"repo-name"}
- {"tool":"github_read_file","repo":"repo-name","path":"file-path"}
- {"tool":"github_push_file","repo":"repo-name","path":"file-path","content":"entire file content","message":"commit msg"}
- {"tool":"github_delete_file","repo":"repo-name","path":"file-path","message":"commit msg"}
- {"tool":"github_create_repo","name":"repo-name","description":"desc"}

Do NOT wrap JSON in markdown. Just raw JSON.`;

    // Give it maximum context so it remembers what it read
    const messages = [
      { role: "system", content: system },
      ...history.slice(-20) 
    ];

    let raw = await this.askBrain(messages);
    let steps = 0;
    let thoughts = ["Analyzing..."];

    const addThought = async (txt) => {
      thoughts.push(txt);
      await this.ctx.storage.put("thoughts", thoughts);
    };

    // If the AI outputs plain text, the loop breaks and it talks to the user.
    // If it outputs a tool call, it executes it and continues.
    while (steps < 15) {
      const toolCall = this.parseTool(raw);
      if (!toolCall) break; // It's talking to the user

      steps++;
      await addThought(`Executing: ${toolCall.tool}...`);
      
      const result = await this.runTool(toolCall);
      
      // Don't truncate the result! Let it read the whole file/error.
      await addThought(`Result: ${result}`);

      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Tool result: ${result}` });

      raw = await this.askBrain(messages);
    }

    return raw;
  }

  // Bulletproof parser: grabs ONLY the first valid JSON object.
  parseTool(text) {
    if (typeof text !== 'string') return null;
    try {
      let clean = text.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-zA-Z]*\n/, '').replace(/```$/, '').trim();
      }
      
      const firstBrace = clean.indexOf('{');
      if (firstBrace === -1) return null;
      
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endBrace = -1;

      for (let i = firstBrace; i < clean.length; i++) {
        const char = clean[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (char === '\\') { escapeNext = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) { endBrace = i; break; }
          }
        }
      }

      if (endBrace === -1) return null;
      const jsonStr = clean.substring(firstBrace, endBrace + 1);
      const obj = JSON.parse(jsonStr);
      
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
    if (tool.includes("github_")) {
      const token = await this.getGithubToken();
      if (!token) return "Error: GITHUB_TOKEN is not set. Ask the user to paste it in settings.";
      
      const userRes = await fetch("https://api.github.com/user", { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
      const user = await userRes.json();
      if (!user.login) return "Error: Invalid GitHub token.";

      if (tool === "github_list_files") {
        try {
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/git/trees/main?recursive=1`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) return "GitHub error: " + (await res.text());
          const files = (await res.json()).tree.filter(item => item.type === "blob").map(item => item.path);
          return `Files in ${args.repo}:\n` + files.join("\n");
        } catch (e) { return "Failed to list files."; }
      }

      if (tool === "github_read_file") {
        try {
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `Contents of ${args.path}:\n\n${decodeURIComponent(escape(atob((await res.json()).content)))}`;
        } catch (e) { return "Failed to read file."; }
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
            headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, 
            body: JSON.stringify(body) 
          });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File ${args.path} updated successfully.`;
        } catch (e) { return "Failed to push file."; }
      }

      if (tool === "github_delete_file") {
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet" } });
          if (!checkRes.ok) return "File not found.";
          const sha = (await checkRes.json()).sha;
          
          const body = { message: args.message || "Delete", sha: sha };
          
          const res = await fetch(`https://api.github.com/repos/${user.login}/${args.repo}/contents/${args.path}`, { 
            method: "DELETE", 
            headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, 
            body: JSON.stringify(body) 
          });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `File ${args.path} deleted successfully.`;
        } catch (e) { return "Failed to delete file."; }
      }

      if (tool === "github_create_repo") {
        try {
          const res = await fetch("https://api.github.com/user/repos", { 
            method: "POST", 
            headers: { "authorization": "Bearer " + token, "user-agent": "BotFleet", "content-type": "application/json" }, 
            body: JSON.stringify({ name: args.name, description: args.description || "", private: false, auto_init: true }) 
          });
          if (!res.ok) return "GitHub error: " + (await res.text());
          return `Repo created: ${(await res.json()).html_url}`;
        } catch (e) { return "Failed to create repo."; }
      }
    }
    return "Unknown tool.";
  }

  async askBrain(messages) {
    try {
      const res = await this.env.AI.run("@cf/qwen/qwen2.5-coder-32b-instruct", { messages, max_tokens: 2500 }); // Increased tokens for bigger files
      if (res?.choices?.[0]?.message?.content) return res.choices[0].message.content;
      if (typeof res === 'string') return res;
      if (res?.response) return res.response;
      return JSON.stringify(res);
    } catch (e) { return "Brain Error: " + e.message; }
  }
}
