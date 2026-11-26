import { handleSubManMcp } from "$lib/server/mcp/handler";
import type { RequestHandler } from "./$types";

export const fallback: RequestHandler = ({ request, platform }) =>
	handleSubManMcp(request, platform?.env);
