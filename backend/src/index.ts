import { DurableObject } from "cloudflare:workers";

export { DecisionLogAgent } from "./agent";

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Route to Durable Object based on a session ID
        // For simplicity, we can use a hardcoded ID or generate one if not present
        // But usually for a chat, we want a unique session.
        // Let's assume the client sends a session ID in the query param or header.
        // If not, we create a new one.

        let sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
            sessionId = crypto.randomUUID();
            // If we just generated it, we might want to redirect or just use it.
            // But for a simple API, let's just require it or return it.
            // Actually, let's just use a default one for testing if missing, or better, error out.
            // Or better yet, if it's a new session, we return the ID to the client.
        }

        const id = env.DECISION_LOG_AGENT.idFromName(sessionId);
        const stub = env.DECISION_LOG_AGENT.get(id);

        return stub.fetch(request);
    },
};

export interface Env {
    DECISION_LOG_AGENT: DurableObjectNamespace;
    AI: any;
}
