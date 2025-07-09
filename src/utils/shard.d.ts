export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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

