import { Durable } from "../index";
import { WxCipher } from "../utils/cipher";
import { XmlWxMsg } from "../utils/shard.d";
import { Utils } from "../utils/utils";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

function actionSubscribe(xmlMsg: XmlWxMsg, env: Env): string {
  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Utils.time_now(),
      MsgType: "text",
      Content: `[你好呀~] 感谢关注TinAI生态\n\n限于微信的响应时长限制，对话时可能出现长内容无法及时回复的情况，此时发送：\n${env.LLMLastMsg}\n可获取上一次未及时生成的回复哦`
    }
  };
  return new XMLBuilder().build(xmlReply);
}

async function actionCode(xmlMsg: XmlWxMsg, durable: DurableObjectStub<Durable>): Promise<string> {
  const code = await durable.handleGetCodeByUid(xmlMsg.FromUserName);

  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Utils.time_now(),
      MsgType: "text",
      Content: `您的登录验证码是：${code}\n该验证码5分钟内有效`
    }
  };
  return new XMLBuilder().build(xmlReply);
}

async function actionNewChat(xmlMsg: XmlWxMsg, durable: DurableObjectStub<Durable>): Promise<string> {
  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Utils.time_now(),
      MsgType: "text",
      Content: await durable.handleClearChatHistory(xmlMsg.FromUserName)
    }
  };
  return new XMLBuilder().build(xmlReply);
}

async function actionScan(xmlMsg: XmlWxMsg, env: Env, durable: DurableObjectStub<Durable>) {
  const raw = xmlMsg.ScanCodeInfo.ScanResult, ticket = raw.substring(env.TicketPrefix.length);
  let content = `emmm~，看起来不像我认识的登录二维码：\n${raw}`;
  if (raw.startsWith(env.TicketPrefix) && ticket.length === env.TicketSize) {
    content = await durable.handleQrcodeLogin(ticket, xmlMsg.FromUserName);
  }

  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Utils.time_now(),
      MsgType: "text",
      Content: content
    }
  };
  return new XMLBuilder().build(xmlReply);
}

async function actionText(xmlMsg: XmlWxMsg, env: Env, durable: DurableObjectStub<Durable>): Promise<string> {
  let content: string;
  if (xmlMsg.Content === "[收到不支持的消息类型，暂无法显示]") {
    content = "[我读的书少] 能不能说点我听得懂的";
  } else {
    if (xmlMsg.Content === env.LLMLastMsg) {
      content = await durable.handleGetLastChatContent(xmlMsg.FromUserName);
    } else {
      try {
        const messages = await durable.handleUpdateChatHistory(xmlMsg.FromUserName, { role: "user", content: xmlMsg.Content });
        const llmRes = await env.AI.run(
          env.LLMModelId,
          { messages, max_tokens: env.LLMMaxLength },
          { returnRawResponse: false }
        ) as { [k: string]: string };
        content = llmRes.response;
        durable.handleUpdateChatHistory(xmlMsg.FromUserName, { role: "assistant", content: llmRes.response });
      } catch (e) {
        console.log(e);
        content = "啊哦，对面被你问宕机了~";
      }
    }
  }

  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Math.floor(Date.now() / 1000).toString(),
      MsgType: "text",
      Content: content
    }
  };
  return new XMLBuilder().build(xmlReply);
}

function actionTextOnly(xmlMsg: XmlWxMsg, text: string | undefined = undefined): string {
  const xmlReply = {
    xml: {
      ToUserName: xmlMsg.FromUserName,
      FromUserName: xmlMsg.ToUserName,
      CreateTime: Math.floor(Date.now() / 1000).toString(),
      MsgType: "text",
      Content: text || "[叮叮~] 当前仅支持文字消息哈"
    }
  };
  return new XMLBuilder().build(xmlReply);
}

async function action(xmlMsg: XmlWxMsg, env: Env, durable: DurableObjectStub<Durable>): Promise<string> {
  if (xmlMsg.MsgType === "event") {
    if (xmlMsg.Event === "subscribe") {
      return actionSubscribe(xmlMsg, env);
    } else if (xmlMsg.EventKey === "GetCode") {
      return actionCode(xmlMsg, durable);
    } else if (xmlMsg.EventKey === "CallScan") {
      return actionScan(xmlMsg, env, durable);
    } else if (xmlMsg.EventKey === "NewChat") {
      return actionNewChat(xmlMsg, durable);
    }
    return `unhanlded event type: ${xmlMsg.Event}`;
  } else if (xmlMsg.MsgType === "text") {
    return actionText(xmlMsg, env, durable);
  }
  return actionTextOnly(xmlMsg);
}

async function verifyAes(xmlMsg: XmlWxMsg, args: { [k: string]: string }, token: string): Promise<boolean> {
  return args.msg_signature === await Utils.sha1(args.timestamp, args.nonce, xmlMsg.Encrypt, token);
}

async function encryptAes(replyEncoded: string, token: string): Promise<string> {
  const nonce = Utils.random_string(7, "0123456789");
  const timestamp = Utils.time_now();
  const msgSignature = await Utils.sha1(timestamp, nonce, token, replyEncoded);
  const xmlReplyOuter = {
    xml: {
      Encrypt: replyEncoded,
      MsgSignature: msgSignature,
      TimeStamp: timestamp,
      Nonce: nonce
    }
  };
  return new XMLBuilder().build(xmlReplyOuter);
}

async function actionAes(request: Request, env: Env, durable: DurableObjectStub<Durable>): Promise<string> {
  const xmlParser = new XMLParser();
  try {
    const strAesMsg = await request.text();
    const xmlAesMsg = xmlParser.parse(strAesMsg).xml;
    const args = Object.fromEntries(new URL(request.url).searchParams);
    if (!await verifyAes(xmlAesMsg, args, env.AppToken)) {
      return "Signature Failed";
    }
    const cipher = new WxCipher(env.AppID, env.AppAesKey);
    const strMsg = await cipher.decrypt(xmlAesMsg.Encrypt);
    const xmlMsg = xmlParser.parse(strMsg).xml as XmlWxMsg;
    const strReply = await action(xmlMsg, env, durable);
    return encryptAes(await cipher.encrypt(strReply), env.AppToken);
  } catch (e) {
    console.log("Aes Action Error:", e);
    return "Failed";
  }
}

async function actionPlain(request: Request, env: Env, durable: DurableObjectStub<Durable>): Promise<string> {
  const xmlParser = new XMLParser();
  try {
    const args = Object.fromEntries(new URL(request.url).searchParams);
    if (!await verifyPain(args, env.AppToken)) {
      return "Signature Failed";
    }
    const strMsg = await request.text();
    const xmlMsg = xmlParser.parse(strMsg).xml as XmlWxMsg;
    return action(xmlMsg, env, durable);
  } catch (e) {
    console.log("Root Plain Action:", e);
    return "Failed";
  }
}

async function verifyPain(args: { [k: string]: string }, token: string): Promise<boolean> {
  return args.signature === await Utils.sha1(token, args.timestamp, args.nonce);
}

export async function rootHandler(
  request: Request,
  env: Env,
  durable: DurableObjectStub<Durable>
): Promise<Response> {
  let reply = "Method Not Allowed";
  if (request.method === "POST") {
    reply = await (env.AesMode ? actionAes : actionPlain)(request, env, durable);
  } else if (request.method === "GET") {
    const args = Object.fromEntries(new URL(request.url).searchParams);
    reply = (await verifyPain(args, env.AppToken)) ? args.echostr || "Success" : "Failed";
  }
  return new Response(reply);
}