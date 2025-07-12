# WxApi

本项目使用cloudflare的 `workers` + `durable objects` + `AI` 来充当微信服务号的后台，实现微信第三方登录和简易聊天机器人，适用于个人开发者。

## 更新说明

`v2.0` 相较于 `v1.0`:

+ 使用了 `durable objects`，放弃了 `kv` 存储。
+ 支持消息安全模式传输，开发者可选择消息传输模式。
+ 扫码登录使用 `SSE` 推送，而不再使用前端主动轮询，同时消除了 `kv` 存储的读取缓存，大幅缩减了扫码登录的延迟（几乎无感）。
+ 抽离LLM环境变量，使得聊天更加个性化。

# 主要功能

说明：需要先关注对应的服务号。

## 第三方登录

**注**：假设开发者将本服务部署到 `https://wx-api.your-domain.com/` 处。

说明：支持公众号扫码登录、验证码登录。

任意个人网站添加以下代码即可实现微信登录，该登录可拿到唯一的用户id，用于区别用户身份：
```js
class WxApiLogin {
  static #instance = null;
  #wxApiUrl = undefined;
  #localKey = "LocalUid";
  #onLoginResult = null;

  #getLocalUid() {
    return localStorage.getItem(this.#localKey);
  }
  #setLocalUid(uid) {
    localStorage.setItem(this.#localKey, uid);
  }
  constructor(host, key = "LocalUid") {
    if (WxApiLogin.#instance !== null) return WxApiLogin.#instance;
    this.#wxApiUrl = `${host}/oauth?target=${window.location.href}`;
    this.#localKey = key;
    window.addEventListener("message", event => {
      try {
        const res = JSON.parse(event.data);
        if (res.code === 200) this.#setLocalUid(res.data);
        this.#onLoginResult && this.#onLoginResult(res);
      } catch (e) {
        console.log(e);
      }
    });
  }
  login(callback) {
    const uid = this.#getLocalUid();
    if (uid !== null) {
      return callback && callback({ code: 200, data: uid });
    }
    window.open(this.#wxApiUrl);
    this.#onLoginResult = callback;
  }
  logout() {
    localStorage.removeItem(this.#localKey);
  }
}

const wxApiLogin = new WxApiLogin("https://wx-api.your-domain.com");
// 需要时（比如点击登录按钮时），调用登录接口
wxApiLogin.login(res => {
  /*
  res: { code: 200 | 400, data: uid | error_msg }
        code=200, data=uid, 登录成功
        code=400, data=error_msg，登录失败
  */
  if (res.code === 200) {
    console.log(`登录成功, uid: ${res.data}`);
    // your code after login success
  } else {
    alert(`登录失败：${res.data}`);
  }
});
```


## 公众号聊天机器人

接入 `cloudflare` 的 `AI`，目前问题在于微信不支持流式信息回复且限制响应时间（大约5s），
超出响应时间还没答复微信服务器，则认为服务号后台失效，所以AI生成的内容需要在有限的时间内完成。
于是单独处理这种情况，在配置文件中环境变量`LLMLastMsg`可设置用于取上一次未及时回复的消息的命令


# 部署

## 微信服务号

1. 前往 [微信公众平台](https://mp.weixin.qq.com/) 注册并登录服务号。
2. 登陆后前往 `设置与开发/账号设置` 设置基础账号信息，之后点击 `下载二维码`，将二维码放置于 `/public/wx-qrcode.png`。
3. 前往 `设置与开发/开发接口管理/基本配置` 中设置 `IP白名单` 为cloudflare服务器的系列IP地址，[官方列表](https://www.cloudflare-cn.com/ips/)：
  ```text
  103.21.244.0/22
  103.22.200.0/22
  103.31.4.0/22
  104.16.0.0/13
  104.24.0.0/14
  108.162.192.0/18
  131.0.72.0/22
  141.101.64.0/18
  162.158.0.0/15
  172.64.0.0/13
  173.245.48.0/20
  188.114.96.0/20
  190.93.240.0/20
  197.234.240.0/22
  198.41.128.0/17
  ```
4. 前往 `设置与开发/开发接口管理/基本配置` 中:
  + 复制 `开发者ID(AppID)`: 填写到 [wrangler.jsonc](wrangler-expamle.jsonc) 中的 `var.AppID`
  + 设置`开发者密码(AppSecret)`: 将密钥填写到 [wrangler.jsonc](wrangler-expamle.jsonc) 中的 `vars.AppSecret`
  + 设置`服务器地址(URL)`: 与 [wrangler.jsonc](wrangler-expamle.jsonc) 中 `routes.patten` 相同
  + 设置`令牌(Token)`: 与 [wrangler.jsonc](wrangler-expamle.jsonc) 中 `var.AppToken` 相同
  + 设置`消息加解密密钥 (EncodingAESKey)`: 与 [wrangler.jsonc](wrangler-expamle.jsonc) 中 `var.AppAesKey` 相同
  + 设置`消息加解密方式`: 参考 [wrangler.jsonc](wrangler-expamle.jsonc) 中 `var.AesMode`，明文模式则 `AesMode=false`，密文模式则 `AesMode=true`（推荐）
  + **注意**：`服务器配置` 的修改需要在服务部署后进行。

## 部署本项目

1. fork或者clone本项目代码到本地
2. 将 [wrangler-expamle.jsonc](wrangler-expamle.jsonc) 重命名为 `wrangler.jsonc`
3. 修改 `wrangler.jsonc` 中的 `routes.pattern`, `vars.*`
4. 安装依赖：`npm i`
5. 部署：`npm run deploy`
