export class WxCipher {
  #AppID: string;
  #AppIDBytes: Uint8Array<ArrayBufferLike>;
  #AesKeyBytes: Uint8Array<ArrayBufferLike>;
  #IVBytes: Uint8Array<ArrayBufferLike>;

  constructor(appId: string, aesKey: string) {
    this.#AppID = appId;
    this.#AppIDBytes = new TextEncoder().encode(appId);

    aesKey = aesKey.trim();
    const paddedKey: string = aesKey.padEnd(aesKey.length + (4 - aesKey.length % 4) % 4, '=');
    this.#AesKeyBytes = Uint8Array.from(atob(paddedKey), c => c.charCodeAt(0));
    this.#IVBytes = this.#AesKeyBytes.slice(0, 16);
  }

  #pkcs7_pad(data: Uint8Array<ArrayBuffer>, blockSize: number = 32): Uint8Array<ArrayBuffer> {
    const padding = blockSize - (data.length % blockSize);
    const padded = new Uint8Array(data.length + padding);
    padded.set(data);
    padded.fill(padding, data.length);
    return padded;
  }

  #pkcs7_unpad(padded: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    const padding = padded[padded.length - 1];
    return padded.slice(0, padded.length - padding);
  }

  async encrypt(text: string): Promise<string> {
    const textBytes: Uint8Array<ArrayBufferLike> = new TextEncoder().encode(text);
    const appIdBytes: Uint8Array<ArrayBufferLike> = this.#AppIDBytes;
    // new TextEncoder().encode("0123456789abcdef"); // 固定随机值
    const randomBytes: Uint8Array<ArrayBufferLike> = crypto.getRandomValues(new Uint8Array(16));

    const totalLength: number = 16 + 4 + textBytes.length + appIdBytes.length;
    const toEncrypt: Uint8Array<ArrayBuffer> = new Uint8Array(totalLength);

    // 依次填入各部分数据
    toEncrypt.set(randomBytes, 0); // 0-15: 随机数
    new DataView(toEncrypt.buffer, 16, 4).setUint32(0, textBytes.length, false); // 16-19: 长度
    toEncrypt.set(textBytes, 20); // 20开始: 内容
    toEncrypt.set(appIdBytes, 20 + textBytes.length); // 内容后: AppID

    // 手动填充
    const padded: Uint8Array<ArrayBuffer> = this.#pkcs7_pad(toEncrypt, 32);
    // 加密
    const cryptoKey: CryptoKey = await crypto.subtle.importKey(
      "raw",
      this.#AesKeyBytes,
      "AES-CBC",
      false,
      ["encrypt"]
    );

    const encrypted: ArrayBuffer = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: this.#IVBytes },
      cryptoKey, padded
    );
    // 切掉多出来的最后一个 16 字节块
    const encryptedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(encrypted);
    const trimmed: Uint8Array<ArrayBuffer> = encryptedBytes.subarray(0, encryptedBytes.length - 16);

    // 标准 Base64
    return btoa(String.fromCharCode(...trimmed));
  }

  async decrypt(text: string): Promise<string> {
    // 1) Base64 → Uint8Array
    const u8txt: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(text), c => c.charCodeAt(0));
    if (u8txt.length % 16 !== 0) {
      throw new Error("Invalid ciphertext length");
    }

    // 2) 导入 CryptoKey，用于后续 encrypt（造 C3）和 decrypt
    const cryptoKey: CryptoKey = await crypto.subtle.importKey(
      "raw",
      this.#AesKeyBytes,
      "AES-CBC",
      false,
      ["encrypt", "decrypt"]
    );

    // 3) 用最后一个密文块做 IV，对空明文触发一次 WebCrypto 的自动 PKCS#7 → 得到单块 C3
    const lastCipherBlock: Uint8Array<ArrayBuffer> = u8txt.subarray(u8txt.length - 16);
    const padBlock: Uint8Array<ArrayBuffer> = new Uint8Array(0);  // 空明文
    const c3buffer: ArrayBuffer = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: lastCipherBlock },
      cryptoKey, padBlock
    );
    const c3: Uint8Array<ArrayBuffer> = new Uint8Array(c3buffer);  // → 一定是 16 字节

    // 4) 拼回完整密文（原始两块 + C3）
    const fullCipher: Uint8Array<ArrayBuffer> = new Uint8Array(u8txt.length + 16);
    fullCipher.set(u8txt, 0);
    fullCipher.set(c3, u8txt.length);

    // 5) WebCrypto 解密（会自动去掉这一块 PKCS#7 填充）
    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: this.#IVBytes },
        cryptoKey, fullCipher
      );
    } catch (e: any) {
      throw new Error(`AES decrypt error: ${e.message}`);
    }
    const decrypted: Uint8Array<ArrayBuffer> = new Uint8Array(decryptedBuffer);
    // 此时 decrypted.length 是你最初手动 pad 后的字节数（32 的倍数）

    // 6) 手动去掉 32 字节对齐的那层 PKCS#7
    const unpadded: Uint8Array<ArrayBuffer> = this.#pkcs7_unpad(decrypted);

    // 7) 按微信协议解析：随机16B | 4B length | content | AppID
    if (unpadded.length < 20) {
      throw new Error("Invalid decrypted message");
    }
    const contentLength: number = new DataView(unpadded.buffer, 16, 4).getUint32(0, false);
    const contentEnd: number = 20 + contentLength;
    if (contentEnd > unpadded.length) {
      throw new Error("Invalid content length");
    }

    const contentBytes: Uint8Array<ArrayBuffer> = unpadded.subarray(20, contentEnd);
    const appidBytes: Uint8Array<ArrayBuffer> = unpadded.subarray(contentEnd);
    const appid: string = new TextDecoder().decode(appidBytes);
    if (appid !== this.#AppID) {
      throw new Error("Invalid appid");
    }

    return new TextDecoder().decode(contentBytes);
  }
}