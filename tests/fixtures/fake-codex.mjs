import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
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
            displayName: p.cursor ? "Fixture B" : "Fixture A",
            supportedReasoningEfforts: p.cursor
              ? [{ reasoningEffort: "high" }]
              : [
                  { reasoningEffort: "low" },
                  { reasoningEffort: "medium" },
                  { reasoningEffort: "high" },
                ],
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
    const question = prompt.match(/(?:^|\n)问题：([^\n]*)/)?.[1] ?? prompt;
    const pictures = p.input
      .filter((item) => item.type === "localImage")
      .map((item) => {
        const decoded = PNG.sync.read(readFileSync(item.path));
        return `${decoded.width}x${decoded.height}:${[...decoded.data.subarray(0, 4)].join(",")}`;
      });
    const summaryParams = {
      threadId: p.threadId,
      turnId,
      itemId: "reasoning-1",
    };
    if (p.summary === "auto" && !question.includes("NO_SUMMARY")) {
      notify("item/reasoning/summaryTextDelta", {
        ...summaryParams,
        summaryIndex: 0,
        delta: "核对",
      });
      notify("item/reasoning/summaryTextDelta", {
        ...summaryParams,
        summaryIndex: 0,
        delta: "原文。",
      });
      notify("item/reasoning/summaryPartAdded", {
        ...summaryParams,
        summaryIndex: 1,
      });
      notify("item/reasoning/summaryTextDelta", {
        ...summaryParams,
        summaryIndex: 1,
        delta: "区分事实与解释。",
      });
      notify("item/reasoning/summaryTextDelta", {
        ...summaryParams,
        threadId: "unrelated-thread",
        summaryIndex: 0,
        delta: "FOREIGN_THREAD",
      });
      notify("item/reasoning/summaryTextDelta", {
        ...summaryParams,
        turnId: "unrelated-turn",
        summaryIndex: 0,
        delta: "FOREIGN_TURN",
      });
      notify("item/reasoning/textDelta", {
        ...summaryParams,
        contentIndex: 0,
        delta: "PRIVATE_TRACE_DO_NOT_STORE",
      });
    }
    const timer = setTimeout(
      () => {
        if (p.summary === "auto" && !question.includes("NO_SUMMARY")) {
          notify("item/completed", {
            ...summaryParams,
            item: {
              type: "reasoning",
              id: "reasoning-1",
              summary: ["已核对原文。", "补充说明与书中观点分开。"],
              content: ["PRIVATE_TRACE_DO_NOT_STORE"],
            },
          });
          notify("item/completed", {
            ...summaryParams,
            item: {
              type: "reasoning",
              id: "reasoning-2",
              summary: ["保留可核验引用。"],
              content: ["PRIVATE_TRACE_DO_NOT_STORE"],
            },
          });
        }
        const cite = prompt.match(/\[\[([^\]]+:\d+:\d+)\]\]/)?.[1];
        const text = question.includes("NOTES_MARKDOWN")
          ? `# Capacity\n\n**Bold** and *emphasis* with [safe](https://example.com) and [unsafe](javascript:alert(1)).\n\n- First item\n- Second item\n\n1. Step one\n2. Step two\n\n> Quote explanation\n\n\`\`\`ts\nconst capacity = 42;\n\`\`\`\n\nInline $n^2$ and block:\n\n$$\nE=mc^2\n$$\n\n| Input | Output |\n| --- | --- |\n| 2 | 4 |\n\n<img src=x onerror=alert(1)>\n\n![remote](https://example.invalid/private.png)\n\n${cite ? "[[" + cite + "]]" : ""}`
          : question.includes("NOTES_NO_SOURCE")
            ? "General explanation without a book citation."
            : question.includes("CHECK_IMAGE")
              ? `Images received: ${pictures.length}; ${pictures.join("; ")}`
              : prompt === "CONFIG"
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
      question.includes("WAIT") ? 30000 : 40,
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
