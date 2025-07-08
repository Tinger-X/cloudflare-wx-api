(() => {
  class Alert {
    #timer = null;
    #then = this.#default;
    #leave = false;
    #click = false;
    #$box = document.querySelector("#alert");
    #$title = this.#$box.querySelector(".alert-title");
    #$msg = this.#$box.querySelector(".alert-msg");
    #$close = this.#$box.querySelector(".alert-close");
    #default() { }
    #init() {
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      this.#leave = false;
      this.#click = false;
    }
    #handleClose() {
      this.#init();
      this.#$box.classList.remove("show");
      this.#then();
    }
    #common(msg, sec) {
      this.#init();
      this.#$msg.textContent = msg;
      this.#timer = setTimeout(() => {
        this.#handleClose();
      }, sec * 1000);
    }
    constructor() {
      this.#$close.addEventListener("click", () => {
        this.#click = true;
        this.#handleClose();
      });
      this.#$box.addEventListener("mouseenter", () => {
        this.#init();
      });
      this.#$box.addEventListener("mouseleave", () => {
        if (!this.#click) {
          this.#leave = true;
          setTimeout(() => {
            this.#leave && this.#handleClose();
          }, 1000);
        }
      });
    }
    info(msg, sec = 3) {
      this.#common(msg, sec);
      this.#$title.textContent = "提 示";
      this.#$box.classList.remove("error");
      this.#$box.classList.add("show");
      return this;
    }
    warn(msg, sec = 3) {
      this.#common(msg, sec);
      this.#$title.textContent = "错 误";
      this.#$box.classList.add("error", "show");
      return this;
    }
    then(fn) {
      this.#then = fn || this.#default;
    }
  };

  const alert = new Alert();
  if (window.opener === null) {
    return setTimeout(() => {
      alert.warn("无效打开方式，3秒后自动关闭该标签页...").then(() => window.close());
    }, 0);
  }
  const target = new URLSearchParams(window.location.search).get("target");
  if (target === null) {
    return setTimeout(() => {
      alert.warn("回调地址不可为空，3秒后自动关闭该标签页...").then(() => window.close());
    }, 0);
  }

  let success = false;
  const loginFailed = msg => {
    success = false;
    window.opener.postMessage(JSON.stringify({ code: 400, data: msg }), target);
    alert.warn(msg);
  };
  const loginSuccess = uid => {
    success = true;
    window.opener.postMessage(JSON.stringify({ code: 200, data: uid }), target);
    alert.info("登录成功，3秒后自动关闭该标签页...").then(() => window.close());
  };

  /* 登录选项切换 */
  (() => {
    const $byScan = document.querySelector("#by-scan"),
      $scanContent = document.querySelector("#scan-content"),
      $byCode = document.querySelector("#by-code"),
      $codeContent = document.querySelector("#code-content");
    $byScan.addEventListener("click", () => {
      if ($byScan.classList.contains("active")) return;
      $byCode.classList.remove("active");
      $codeContent.style.display = "none";
      $byScan.classList.add("active");
      $scanContent.style.display = "flex";
    });
    $byCode.addEventListener("click", () => {
      if ($byCode.classList.contains("active")) return;
      $byScan.classList.remove("active");
      $scanContent.style.display = "none";
      $byCode.classList.add("active");
      $codeContent.style.display = "flex";
    });
  })();

  /* 二维码 */
  (() => {
    const $qrcode = document.querySelector("#scan-qrcode");
    const sse = new EventSource("/oauth/sse");
    sse.addEventListener("SSE", event => {
      const msg = JSON.parse(event.data);
      switch (msg.code) {
        case -1:  // server close
          sse.close();
          success || loginFailed(msg.data);
          break;
        case 100:  // qrcode init
          $qrcode.setAttribute("src", `/oauth/qrcode?ticket=${msg.data}`);
          break;
        case 200:  // qrcode scaned
          loginSuccess(msg.data);
          break;
        case 300:  // waiting
          console.log(msg);
          break;
        case 400:  // timeout
          loginFailed("登录超时");
          break;
      }
    });
    window.addEventListener("beforeunload", () => {
      sse.close();
      success || loginFailed("用户取消登录");
    });
  })();

  /* 验证码 */
  (() => {
    let index = 0, last = "";
    const $input = document.querySelector("#code-hidden"),
      $boxs = document.querySelectorAll(".code-item"),
      $login = document.querySelector("#login");
    $input.addEventListener("input", () => {
      const value = $input.value;
      if (!/^[0-9]{0,6}$/.test(value)) {
        return $input.value = last;
      }
      last = value;
      $boxs.forEach($box => {
        $box.textContent = "";
        $box.classList.remove("active");
        $box.classList.remove("focus");
      });
      for (let i = 0; i < value.length; i++) {
        $boxs[i].textContent = value[i];
        $boxs[i].classList.add("active");
      }
      index = value.length < 6 ? value.length : 5;
      $boxs[index].classList.add("focus");
    });
    $input.addEventListener("blur", function () {
      $boxs.forEach($box => {
        $box.classList.remove("focus");
      });
    });
    $input.addEventListener("focus", () => {
      $boxs[index].classList.add("focus");
    });
    $login.addEventListener("click", () => {
      if (!/^[0-9]{6}$/.test(last)) {
        return alert.warn("请输入6位数字验证码");
      }
      fetch(
        "/oauth/login",
        { method: "POST", body: last }
      ).then(res => res.json()).then(res => {
        if (res.code !== 200) {
          return alert.warn(res.msg);
        }
        loginSuccess(res.data);
      }).catch(e => {
        loginFailed(e.message);
      });
    });
  })();
})();
