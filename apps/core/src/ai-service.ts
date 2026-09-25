import type { ModelSelection } from "../../../packages/protocol/src";
import type { BookTools } from "./tools";
import type { ChatService } from "./chat";
import type { CodexAdapter } from "./codex";
import type { IndexService } from "./indexer";
import type { Library } from "./library";
import type { RuntimeManager } from "./runtime";

/** Global AI account, runtime and model policy. Book-scoped turns remain in ChatService. */
export class AiService {
  private closed = false;
  constructor(
    private readonly library: Library,
    readonly codex: CodexAdapter,
    readonly runtime: RuntimeManager,
    private readonly chat: ChatService,
    private readonly indexer: IndexService,
    private readonly tools: BookTools,
  ) {}
  close() {
    this.closed = true;
  }
  private assertOpen() {
    if (this.closed) throw new Error("Core 正在关闭");
  }
  selectedModel() {
    return this.library.store.get<ModelSelection>("setting", "model") ?? null;
  }
  async selectModel(value?: ModelSelection): Promise<ModelSelection> {
    this.assertOpen();
    await this.codex.connect();
    this.assertOpen();
    if (!this.codex.info.account) throw new Error("请先登录 ChatGPT");
    const chosen = value ?? this.selectedModel();
    if (!chosen) throw new Error("请先选择模型和思考强度");
    const models = await this.codex.models();
    this.assertOpen();
    const model = models.find((item) => item.model === chosen.model);
    if (
      !model?.supportedReasoningEfforts.some(
        (item) => item.reasoningEffort === chosen.effort,
      )
    )
      throw new Error("所选模型或思考强度已不可用，请重新选择");
    return chosen;
  }
  async saveModel(value: ModelSelection) {
    const selected = await this.selectModel(value);
    this.assertOpen();
    this.library.store.put("setting", "model", "", selected);
    return selected;
  }
  private stopBookTasks() {
    this.chat.cancelAll();
    this.indexer.pauseAll();
    this.tools.stopAll();
  }
  async prepareRuntime() {
    this.assertOpen();
    this.stopBookTasks();
    await this.codex.disconnect();
    this.assertOpen();
    void this.runtime.prepare();
    return this.runtime.state;
  }
  async cancelRuntime() {
    this.assertOpen();
    await this.runtime.cancel();
    return this.runtime.state;
  }
  async disconnect() {
    this.assertOpen();
    this.stopBookTasks();
    await this.codex.disconnect();
    return this.codex.info;
  }
  async logout() {
    this.assertOpen();
    this.stopBookTasks();
    await this.codex.logout();
    this.assertOpen();
    this.library.store.remove("setting", "model");
    return this.codex.info;
  }
}
