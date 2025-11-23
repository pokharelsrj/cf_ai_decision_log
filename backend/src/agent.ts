import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";

interface SessionState {
    phase: "intent" | "question_planning" | "interview" | "synthesis";
    intent: any | null;
    questions: {
        id: string;
        text: string;
        category: string;
        answer: string | null;
    }[];
    extraNotes: string[];
    finalDoc: string | null;
}

export class DecisionLogAgent extends DurableObject {
    state: DurableObjectState;
    env: Env;
    session: SessionState;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;
        // Initialize in-memory state
        this.session = {
            phase: "intent",
            intent: null,
            questions: [],
            extraNotes: [],
            finalDoc: null,
        };
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === "/chat" && request.method === "POST") {
            const body = await request.json() as { message: string };
            const userMessage = body.message;

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();

            this.ctx.waitUntil((async () => {
                try {
                    // 1. Run the appropriate agent based on phase
                    if (this.session.phase === "intent") {
                        await this.runIntentAgent(userMessage, writer, encoder);
                    } else if (this.session.phase === "question_planning") {
                        // Should have transitioned automatically, but if we are here, run planner
                        await this.runQuestionPlanner(writer, encoder);
                        // Then immediately run interview for the first question. 
                        // Pass null to indicate we are just starting and there is no answer to process yet.
                        await this.runInterviewTurn(null, writer, encoder);
                    } else if (this.session.phase === "interview") {
                        await this.runInterviewTurn(userMessage, writer, encoder);
                    } else if (this.session.phase === "synthesis") {
                        // Should be triggered automatically, but if user chats, maybe just say "Done"
                        await writer.write(encoder.encode("The architecture document is ready."));
                    }

                } catch (e) {
                    console.error("Error in chat handler:", e);
                    try {
                        await writer.write(encoder.encode("Error processing request: " + (e instanceof Error ? e.message : String(e))));
                    } catch (writeError) {
                        console.error("Error writing error message:", writeError);
                    }
                } finally {
                    try {
                        await writer.close();
                    } catch (closeError) {
                        console.error("Error closing writer:", closeError);
                    }
                }
            })());

            return new Response(readable, {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/plain; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        if (url.pathname === "/state") {
            return new Response(JSON.stringify(this.session), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    async runIntentAgent(userMessage: string, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // ... (existing code) ...
        // Detect intent and scope
        const systemPrompt = `
      You are an expert software architect. Your goal is to understand the user's project idea and determine the scope and high-level goals.
      Analyze the user's message and extract:
      1. Project Name (suggest one if not provided)
      2. Scope (Frontend, Backend, Full Stack, Data, etc.)
      3. Key Goals
      
      Return a JSON object with these fields: { "projectName": string, "scope": string, "goals": string[] }.
      Do not return markdown, just the JSON.
    `;

        const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ]
        });

        let intentData;
        try {
            // simple parsing, assuming model returns JSON
            // In production, use structured output or better parsing
            const text = response.response.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                intentData = JSON.parse(jsonMatch[0]);
            } else {
                intentData = { projectName: "Unknown", scope: "General", goals: [userMessage] };
            }
        } catch (e) {
            intentData = { projectName: "Unknown", scope: "General", goals: [userMessage] };
        }

        this.session.intent = intentData;
        this.session.phase = "question_planning";

        await writer.write(encoder.encode(`I understand. You want to build **${intentData.projectName}** which is a **${intentData.scope}** project.\n\n`));
        await writer.write(encoder.encode(`Goals: ${intentData.goals.join(", ")}\n\n`));
        await writer.write(encoder.encode("I am now generating some architecture questions for you..."));

        // Immediately trigger question planning
        await this.runQuestionPlanner(writer, encoder);

        // Ask the first question immediately
        await this.runInterviewTurn(null, writer, encoder);
    }

    async runQuestionPlanner(writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // ... (existing code) ...
        const intent = this.session.intent;
        if (!intent) {
            await writer.write(encoder.encode("Error: Intent not found."));
            return;
        }

        const systemPrompt = `
          You are an expert software architect. Based on the project intent, generate a list of 5-7 essential architecture questions to ask the user.
          These questions should help clarify the system design.
          
          Project: ${intent.projectName}
          Scope: ${intent.scope}
          Goals: ${intent.goals.join(", ")}
          
          Return a JSON object with a "questions" array. Each item should have:
          - id: string (unique)
          - text: string (the question to ask)
          - category: string (e.g., "Frontend", "Backend", "Data", "Infrastructure")
          
          Do not return markdown, just the JSON.
        `;

        const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Generate questions." }
            ]
        });

        let questions = [];
        try {
            const text = response.response.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                questions = data.questions || [];
            }
        } catch (e) {
            console.error("Failed to parse questions", e);
        }

        if (questions.length === 0) {
            // Fallback questions
            questions = [
                { id: "q1", text: "What is your preferred programming language?", category: "General" },
                { id: "q2", text: "Do you have any specific scalability requirements?", category: "Infrastructure" }
            ];
        }

        // Initialize answers as null
        this.session.questions = questions.map((q: any) => ({ ...q, answer: null }));
        this.session.phase = "interview";
    }

    async runInterviewTurn(userMessage: string | null, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // Find the first unanswered question
        const currentQuestionIndex = this.session.questions.findIndex(q => q.answer === null);

        if (currentQuestionIndex === -1) {
            // All answered
            this.session.phase = "synthesis";
            await this.runSynthesizer(writer, encoder);
            return;
        }

        // If userMessage is present, it's the answer to the *current* question
        if (userMessage !== null) {
            // Update answer
            this.session.questions[currentQuestionIndex].answer = userMessage;

            // Check for extra notes (optional, skipping for speed/simplicity or we can do a quick check)
            // For now, just save the answer.

            // Move to next question
            const nextQuestionIndex = this.session.questions.findIndex(q => q.answer === null);

            if (nextQuestionIndex === -1) {
                // All answered
                this.session.phase = "synthesis";
                await this.runSynthesizer(writer, encoder);
                return;
            }

            // Ask next question
            const nextQuestion = this.session.questions[nextQuestionIndex];
            await writer.write(encoder.encode(`\n\n**${nextQuestion.category}**: ${nextQuestion.text}`));
        } else {
            // Just starting interview, ask the first question
            const currentQuestion = this.session.questions[currentQuestionIndex];
            await writer.write(encoder.encode(`\n\n**${currentQuestion.category}**: ${currentQuestion.text}`));
        }
    }

    async runSynthesizer(writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        await writer.write(encoder.encode("\n\n**All questions answered! Generating architecture document...**\n\n"));

        const intent = this.session.intent;
        const questions = this.session.questions;

        const systemPrompt = `
          You are an expert software architect. Create a comprehensive architecture document based on the interview results.
          
          Project: ${intent?.projectName}
          Scope: ${intent?.scope}
          Goals: ${intent?.goals.join(", ")}
          
          Q&A:
          ${questions.map(q => `- ${q.text}\n  Answer: ${q.answer}`).join("\n")}
          
          Format the output as Markdown. Include sections for:
          1. Executive Summary
          2. System Overview
          3. Key Decisions
          4. Technical Stack
          5. Next Steps
        `;

        try {
            // Get the full response (non-streaming) - wait for complete document
            const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Generate the document." }
                ]
            });

            // Extract the response text
            let documentText = "";
            if (response && response.response) {
                if (typeof response.response === "string") {
                    documentText = response.response;
                } else {
                    documentText = String(response.response);
                }
            } else if (response && typeof response === "string") {
                documentText = response;
            } else {
                documentText = JSON.stringify(response);
            }

            // Save to session
            this.session.finalDoc = documentText;

            // Send the complete document all at once
            await writer.write(encoder.encode(documentText));
        } catch (error) {
            console.error("Error in runSynthesizer:", error);
            await writer.write(encoder.encode("\n\nError generating architecture document. Please try again."));
        }

        this.session.phase = "synthesis"; // Ensure phase is set
    }
}
