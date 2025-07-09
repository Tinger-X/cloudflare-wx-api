import { DurableObject } from "cloudflare:workers";
import { Utils } from "./utils";
import { ChatMessage, SseMessage } from "./shard.d";

export class Durable extends DurableObject {
  #ChatHistory: Map<string, ChatMessage[]>;
  #Clients: Map<string, any>;  // {ticket: writer}
  #CodeUidMap: Map<string, string>;
  #UidCodeMap: Map<string, string>;
  #Expire: number;
  #MaxTimes: number;
  #AllowOrigin: string;
  #TicketPrefix: string;
  #TicketSize: number;
  #SystemTip: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ChatHistory = new Map();
    this.#Clients = new Map();
    this.#CodeUidMap = new Map();
    this.#UidCodeMap = new Map();
    this.#Expire = env.AuthExpireSecs * 1000;
    this.#MaxTimes = Math.floor(env.AuthExpireSecs / 3);
    this.#AllowOrigin = env.AllowOrigin;
    this.#TicketPrefix = env.TicketPrefix;
    this.#TicketSize = env.TicketSize;
    this.#SystemTip = env.LLMSystemTip;
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS `messages` (`uid` CHAR(28), `role` VCHAR(9), `content` TEXT);",
    );
    const cursor = ctx.storage.sql.exec("SELECT * FROM `messages`;");
    for (const row of cursor) {
      const uid = row.uid as string;
      const role = row.role as "system" | "user" | "assistant";
      const content = row.content as string;
      if (!this.#ChatHistory.has(uid)) {
        this.#ChatHistory.set(uid, []);
      }
      this.#ChatHistory.get(uid)!.push({ role, content });
    }
  }

  #expireAuthCode(code: string, uid: string): void {
    setTimeout(() => {
      this.#CodeUidMap.delete(code);
      this.#UidCodeMap.delete(uid);
    }, this.#Expire);
  }

  handleGetCodeByUid(uid: string): string {
    let code = this.#UidCodeMap.get(uid);
    if (code !== undefined) return code;

    code = Utils.random_string(6, "1234566678888999");
    while (this.#CodeUidMap.has(code)) code = Utils.random_string(6, "1234566678888999");
    this.#CodeUidMap.set(code, uid);
    this.#UidCodeMap.set(uid, code);
    this.#expireAuthCode(code, uid);
    return code;
  }

  handleGetUidByCode(code: string): string | undefined {
    const uid = this.#CodeUidMap.get(code);
    if (uid === undefined) return undefined;
    this.#CodeUidMap.delete(code);
    this.#UidCodeMap.delete(uid);
    return uid;
  }

  async #writeSafe(ticket: string, data: SseMessage, callClose: boolean = true): Promise<boolean> {
    const writer = this.#Clients.get(ticket);
    if (!writer) {
      return false;
    }

    try {
      const message = `event: SSE\ndata: ${JSON.stringify(data)}\n\n`;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Write timeout")), 500)
      );

      await Promise.race([
        writer.write(new TextEncoder().encode(message)),
        timeoutPromise
      ]);

      return true;
    } catch (err: any) {
      callClose && this.#closeConnection(ticket, `Write to ${ticket} failed: ${err.message}`);
      return false;
    }
  }

  #setupHeartbeat(ticket: string): void {
    let count = 0;

    const next = async () => {
      try {
        count++;
        const success = await this.#writeSafe(ticket, { code: 300, data: count });
        if (!success) {
          throw new Error("Heartbeat write failed");
        }

        if (count >= this.#MaxTimes) {
          await this.#writeSafe(ticket, { code: 400, data: "timeout" });
          this.#closeConnection(ticket, null, true);
          return;
        }

        setTimeout(next, 3000);
      } catch (err: any) {
        this.#closeConnection(ticket, `Heartbeat error: ${err.message}`);
      }
    };

    setTimeout(next, 3000);
  }

  async #closeConnection(ticket: string, msg: string | null, close: boolean = false): Promise<void> {
    const writer = this.#Clients.get(ticket);
    if (!writer) return;
    msg && console.log(msg);
    close && await this.#writeSafe(ticket, { code: -1, data: "connection closed" }, false);

    try {
      const closePromise = writer.close();
      const timeout = new Promise(resolve => setTimeout(resolve, 200));
      await Promise.race([closePromise, timeout]);
    } catch (err: any) {
      console.log(`Error closing writer for ${ticket}: ${err.message}`);
    } finally {
      this.#Clients.delete(ticket);
    }
  }

  async handleAcceptSSE(request: Request): Promise<Response> {
    const ticket = Utils.random_string(this.#TicketSize);
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    request.signal.addEventListener("abort", () => {
      this.#closeConnection(ticket, `Connection ${ticket} aborted by client`);
    });
    writer.closed.catch((err) => {
      this.#closeConnection(ticket, `Writer closed for ${ticket}: ${err.message}`);
    });

    this.#Clients.set(ticket, writer);
    this.#setupHeartbeat(ticket);
    setTimeout(async () => await this.#writeSafe(ticket, { code: 100, data: this.#TicketPrefix + ticket }), 0);

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": this.#AllowOrigin
      }
    });
  }

  async handleQrcodeLogin(ticket: string, uid: string): Promise<string> {
    if (!this.#Clients.has(ticket)) return "二维码已过期，请刷新页面后再试试吧 ~";
    try {
      await this.#writeSafe(ticket, { code: 200, data: uid });
      this.#closeConnection(ticket, null, true);
      return `登录成功！\n${uid}`;
    } catch (err: any) {
      return `登录失败：\n${err.message}`;
    }
  }

  handleUpdateChatHistory(uid: string, msg: ChatMessage): ChatMessage[] {
    let history = this.#ChatHistory.get(uid);
    if (!history) history = [{ role: "system", content: this.#SystemTip }];
    history.push(msg);
    this.#ChatHistory.set(uid, history);
    this.ctx.storage.sql.exec(
      `INSERT INTO \`messages\` (\`uid\`, \`role\`, \`content\`) VALUES (?, ?, ?);`, uid, msg.role, msg.content
    )
    return history;
  }

  handleGetLastChatContent(uid: string): string {
    let history = this.#ChatHistory.get(uid);
    if (!history) {
      return "== 查无此话 ==";
    }
    for (let i = history.length - 1; i >= 0; --i) {
      if (history[i].role === "assistant") return history[i].content;
    }
    return "== 查无此话 2.0 ==";
  }

  handleClearChatHistory(uid: string): string {
    this.ctx.storage.sql.exec(`DELETE FROM \`messages\` WHERE \`uid\`='${uid}';`);
    if (!this.#ChatHistory.has(uid)) {
      return "【我已经不记得前世啦】";
    }
    this.#ChatHistory.delete(uid);
    return "对话历史已清空，咱重新开始吧~";
  }
}