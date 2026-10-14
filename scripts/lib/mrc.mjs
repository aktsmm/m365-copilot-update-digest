export const MRC_MCP_URL = "https://www.microsoft.com/releasecommunications/mcp";
const PAGE_SIZE = 50;

export class McpError extends Error {
  constructor(message, { status, retryable = false, retryAfterMs } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRpc(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (data.length === 0) throw new McpError("empty event stream");
    return JSON.parse(data[data.length - 1]);
  }
  return JSON.parse(text);
}

/** 最小の Streamable HTTP MCP クライアント。429/5xx とネットワーク断は間隔を空けて再試行する。 */
export class MrcClient {
  constructor({ url = MRC_MCP_URL, fetchImpl = fetch, minIntervalMs = 400, maxRetries = 5, sleep } = {}) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.minIntervalMs = minIntervalMs;
    this.maxRetries = maxRetries;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.sessionId = undefined;
    this.nextId = 1;
    this.lastCall = 0;
    this.initialized = false;
  }

  async post(body, expectResponse) {
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.lastCall + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCall = Date.now();
      try {
        const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
        if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
        const response = await this.fetchImpl(this.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        this.sessionId = response.headers.get("mcp-session-id") || this.sessionId;
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after"));
          throw new McpError(`HTTP ${response.status}`, {
            status: response.status,
            retryable: true,
            retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          });
        }
        if (!response.ok) throw new McpError(`HTTP ${response.status}`, { status: response.status });
        if (!expectResponse) return undefined;
        return parseRpc(await response.text(), response.headers.get("content-type") ?? "");
      } catch (error) {
        const retryable = error instanceof McpError ? error.retryable : true;
        if (!retryable || attempt >= this.maxRetries) throw error;
        await this.sleep(error.retryAfterMs ?? Math.min(30_000, 1000 * 2 ** (attempt + 1)));
      }
    }
  }

  async initialize() {
    if (this.initialized) return;
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "m365-copilot-update-digest", version: "0.1.0" } },
      },
      true,
    );
    if (response.error) throw new McpError(`initialize failed: ${response.error.message}`);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
    this.initialized = true;
  }

  async callTool(name, args) {
    await this.initialize();
    const response = await this.post(
      { jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } },
      true,
    );
    if (response.error) throw new McpError(`${name}: ${response.error.message}`);
    const text = response.result?.content?.find((part) => part.type === "text")?.text;
    if (response.result?.isError || typeof text !== "string") throw new McpError(`${name}: ${text ?? "no content"}`);
    return JSON.parse(text);
  }
}

/**
 * フィルターに合う Roadmap を全ページ走査する。totalCount とユニーク ID 数が一致したときだけ complete。
 * 走査中に totalCount が動いたら最大 2 回やり直し、それでも不一致なら partial として返す（失敗を成功に見せない）。
 */
export async function listM365Roadmaps(client, filter, { maxPages = 60, restarts = 2 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= restarts; attempt += 1) {
    const byId = new Map();
    let totalCount = null;
    let moved = false;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await client.callTool("get_recent_m365_roadmaps", {
        filter,
        skip: page * PAGE_SIZE,
      });
      if (totalCount !== null && result.totalCount !== totalCount) moved = true;
      totalCount = result.totalCount;
      for (const item of result.items ?? []) byId.set(String(item.id), item);
      if (!result.hasMore || (result.items ?? []).length === 0) break;
    }
    last = { items: [...byId.values()], totalCount, complete: !moved && byId.size === totalCount };
    if (last.complete) return last;
  }
  return last;
}

export async function getM365Roadmap(client, id) {
  return client.callTool("get_m365_roadmap_by_id", { id: String(id) });
}
