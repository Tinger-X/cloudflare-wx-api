const StrBase: string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const Encoder = new TextEncoder()

export class Utils {
  static random_string(size: number = 16, rules: string | undefined = undefined): string {
    if (!rules) {
      rules = StrBase;
    }
    let result: string = "";
    for (let i = 0; i < size; i++) {
      result += rules.charAt(Math.floor(Math.random() * rules.length));
    }
    return result;
  }

  static async sha1(...args: any[]): Promise<string> {
    const params: string[] = args.map(arg => String(arg)).sort();
    const data: string = params.join("");
    const dataBytes: Uint8Array<ArrayBufferLike> = new TextEncoder().encode(data);
    const hashBuffer: ArrayBuffer = await crypto.subtle.digest("SHA-1", dataBytes);
    const hashArray: number[] = Array.from(new Uint8Array(hashBuffer));
    const hashHex: string = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  }

  static time_now(str: boolean = true): number | string {
    const time = Math.floor(Date.now() / 1000);
    return str ? time.toString() : time;
  }

  static rest_response(data: any, origins: string): Response {
    const resp = Response.json(data);
    resp.headers.set("Access-Control-Allow-Origin", origins);
    return resp;
  }
}