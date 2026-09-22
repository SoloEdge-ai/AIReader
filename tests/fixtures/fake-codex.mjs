import { createInterface } from "node:readline";
let sequence = 0;
let initialized = false;
const threads = new Map();
const timers = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params: p } = request;
  if (id === undefined) return;
  if (method === "initialize")
    setTimeout(() => {
      initialized = true;
      send({ id, result: {} });
    }, 100);
  else if (!initialized) send({ id, error: { message: "Not initialized" } });
  else if (method === "config/read")
    send({ id, result: { config: { mcp_servers: { untrusted: {} } } } });
  else if (method === "account/read")
    send({
      id,
      result: {
        account: { type: "chatgpt", email: "fixture@example.invalid" },
      },
    });
  else if (method === "model/list")
    send({
      id,
      result: {
        data: [
          {
            id: p.cursor ? "fixture-b" : "fixture-a",
            model: p.cursor ? "fixture-b" : "fixture-a",
            displayName: "Fixture",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            defaultReasoningEffort: "high",
            isDefault: !p.cursor,
          },
        ],
        nextCursor: p.cursor ? null : "next",
      },
    });
  else if (method === "thread/start") {
    const threadId = "thread-" + ++sequence;
    threads.set(threadId, p);
    send({ id, result: { thread: { id: threadId } } });
  } else if (method === "turn/start") {
    const turnId = "turn-" + sequence;
    send({ id, result: { turn: { id: turnId } } });
    notify("turn/started", { threadId: p.threadId, turn: { id: turnId } });
    const prompt = p.input[0].text;
    const timer = setTimeout(
      () => {
        const cite = prompt.match(/\[\[([^\]]+:\d+:\d+)\]\]/)?.[1];
        const text =
          prompt === "CONFIG"
            ? `${p.model}/${p.effort} isolated=${process.env.CODEX_HOME?.includes("codex-home") && !process.env.OPENAI_API_KEY}`
            : prompt.includes("严格 JSON")
              ? JSON.stringify({
                  summary: "Fixture summary",
                  concepts: ["memory"],
                })
              : `Thread ${p.threadId}: supported statement ${cite ? "[[" + cite + "]]" : ""} [[fake:999:0]]`;
        notify("item/agentMessage/delta", {
          threadId: p.threadId,
          delta: text,
        });
        notify("turn/completed", {
          threadId: p.threadId,
          turn: { id: turnId, status: "completed" },
        });
      },
      prompt.includes("WAIT") ? 30000 : 40,
    );
    timers.set(p.threadId, timer);
  } else if (method === "turn/interrupt") {
    clearTimeout(timers.get(p.threadId));
    send({ id, result: {} });
    notify("turn/completed", {
      threadId: p.threadId,
      turn: { status: "interrupted" },
    });
  } else send({ id, result: {} });
});
