# WxApi

本项目使用cloudflare的 `workers` + `durable objects` + `AI` 来充当微信服务号的后台，实现微信第三方登录和简易聊天机器人，适用于个人开发者。

# 主要功能

说明：需要先关注对应的服务号。

## 第三方登录

**注**：假设开发者将本服务部署到 `https://wx.cf.com/` 处。

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

const wxApiLogin = new WxApiLogin("https://wx.cf.com");
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
