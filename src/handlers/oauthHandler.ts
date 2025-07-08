import { Durable } from "../utils/durable";
import { Utils } from "../utils/utils";
import QRCode from "qrcode-svg";

async function handleCodeLogin(
  request: Request,
  durable: DurableObjectStub<Durable>,
  allow: string
): Promise<Response> {
  if (request.method === "GET") {
    return Utils.rest_response({
      code: 405,
      msg: "Method Not Allowed"
    }, allow);
  }
  const code = (await request.text()).trim();
  if (code.length !== 6) {
    return Utils.rest_response({
      code: 410,
      msg: "code error"
    }, allow);
  }
  const uid = await durable.handleGetUidByCode(code);
  if (uid === undefined) {
    return Utils.rest_response({
      code: 411,
      msg: "验证码错误或已过期"
    }, allow);
  }
  return Utils.rest_response({
    code: 200,
    msg: "登录成功",
    data: uid
  }, allow);
}

async function handleQrcode(
  request: Request,
  allow: string
) {
  if (request.method !== "GET") {
    return Utils.rest_response({
      code: 405,
      msg: "Method Not Allowed"
    }, allow);
  }
  const args = Object.fromEntries(new URL(request.url).searchParams);
  if (args.ticket === undefined) {
    return Utils.rest_response({
      code: 400,
      msg: "Param Error"
    }, allow);
  }
  const qr = new QRCode({
    content: args.ticket,
    join: true,
    pretty: false,
    padding: 1
  });
  return new Response(qr.svg(), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Access-Control-Allow-Origin": allow
    }
  });
}

export async function oauthHandler(
  request: Request,
  env: Env,
  path: string[],
  durable: DurableObjectStub<Durable>
): Promise<Response> {
  if (path.length === 0) {
    if (request.method !== "GET") {
      return Utils.rest_response({
        code: 405,
        msg: "Method Not Allowed"
      }, env.AllowOrigin);
    }
    const url = new URL(request.url);
    return env.Assets.fetch(`${url.origin}/oauth.html`);
  } else if (path[0] === "sse") {
    return durable.handleAcceptSSE(request);
  } else if (path[0] === "qrcode") {
    return handleQrcode(request, env.AllowOrigin);
  } else if (path[0] === "login") {
    return handleCodeLogin(request, durable, env.AllowOrigin);
  }
  return Utils.rest_response({
    code: 404,
    msg: "Page Not Found"
  }, env.AllowOrigin);
}