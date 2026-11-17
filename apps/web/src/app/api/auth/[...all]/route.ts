import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/context";

const handler = (req: Request) => toNextJsHandler(getAuth()).POST(req);
const getHandler = (req: Request) => toNextJsHandler(getAuth()).GET(req);

export { getHandler as GET, handler as POST };
