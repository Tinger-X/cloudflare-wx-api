export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SysPrompt = {
  role: "system",
  content: "You are a helpful, friendly assistant. Provide concise and accurate responses."
} as ChatMessage;

export { SysPrompt }

export interface SseMessage {
  code: number;
  data: any;
}

export interface XmlWxMsg {
  FromUserName: string;
  ToUserName: string;
  MsgType: "event" | "text";
  // aes
  Encrypt: string;
  // text
  Content: string;
  // event
  Event: "subscribe" | "CLICK" | "scancode_waitmsg";
  // scan
  EventKey: "GetCode" | "NewChat" | "CallScan";
  ScanCodeInfo: {
    ScanResult: string;
  }
}

