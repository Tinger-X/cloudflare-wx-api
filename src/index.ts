import { Durable } from "./utils/durable";
import { rootHandler } from "./handlers/rootHandler";
import { oauthHandler } from "./handlers/oauthHandler";
import { adminHandler } from "./handlers/adminHandler";

export { Durable };

async function server(request: Request, env: Env): Promise<Response | undefined> {
	const url = new URL(request.url);
	const path = url.pathname.split("/").filter(Boolean);

	const id = env.Durable.idFromName("WxApiDurable");
	const instance = env.Durable.get(id);
	if (path.length === 0) {
		return rootHandler(request, env, instance);
	} else if (path[0] === "oauth") {
		return oauthHandler(request, env, path.slice(1), instance);
	} else if (path[0] === "admin") {
		return adminHandler(request, env);
	}
	return undefined;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		return (
			(await server(request, env)) || env.Assets.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
