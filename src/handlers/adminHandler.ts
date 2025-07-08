import { Utils } from "../utils/utils";

async function getAccessToken(appId: string, appSecret: string): Promise<any> {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      return { message: resp.statusText };
    }
    const data: any = await resp.json();
    if (data.access_token === undefined) {
      return { message: JSON.stringify(data) };
    }
    return { token: data.access_token };
  } catch (err: any) {
    return { message: err.message };
  }
}

async function setMenu(token: string, allow: string): Promise<Response> {
  const url = `https://api.weixin.qq.com/cgi-bin/menu/create?access_token=${token}`;
  const payload = {
    button: [
      {
        "type": "click",
        "name": "验证码",
        "key": "GetCode"
      },
      {
        "type": "click",
        "name": "新对话",
        "key": "NewChat"
      },
      {
        "type": "scancode_waitmsg",
        "name": "扫码",
        "key": "CallScan"
      }
    ]
  };
  const resp = await fetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  if (!resp.ok) {
    return Utils.rest_response({code: 500, msg: resp.statusText}, allow);
  }
  return Utils.rest_response({ code: 200, msg: await resp.json() }, allow);
}

export async function adminHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "GET") {
    return Utils.rest_response({
      code: 405,
      msg: "Method Not Allowed"
    }, env.AllowOrigin);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("auth") !== env.InitAuth) {
    return Utils.rest_response({
      code: 400,
      msg: "Auth Failed"
    }, env.AllowOrigin);
  }
  const access: any = await getAccessToken(env.AppID, env.AppSecret);
  if (!access.token) {
    return Utils.rest_response({
      code: 400,
      msg: access.message
    }, env.AllowOrigin);
  }
  return setMenu(access.token, env.AllowOrigin);
}