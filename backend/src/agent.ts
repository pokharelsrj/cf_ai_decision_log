import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";

interface SessionState {
    phase: "intent" | "question_planning" | "interview" | "confirmation" | "synthesis";
    intent: any | null;
    questions: {
        id: string;
        text: string;
        category: string;
        answer: string | null;
    }[];
    extraNotes: string[];
    finalDoc: string | null;
    awaitingConfirmation: boolean;
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
            awaitingConfirmation: false,
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
                    } else if (this.session.phase === "confirmation") {
                        await this.handleConfirmation(userMessage, writer, encoder);
                    } else if (this.session.phase === "synthesis") {
                        // User wants to edit after document is generated
                        await this.handlePostGenerationEdit(userMessage, writer, encoder);
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
          You are an expert software architect. Based on the project intent, generate a comprehensive list of 8-12 detailed and elaborate architecture questions to ask the user.
          These questions should be specific, detailed, and help deeply clarify the system design. Each question should be well-thought-out and probe into important architectural decisions.
          
          Project: ${intent.projectName}
          Scope: ${intent.scope}
          Goals: ${intent.goals.join(", ")}
          
          Generate questions that cover:
          - Technical stack and technology choices
          - Scalability and performance requirements
          - Data storage and management
          - Security and authentication
          - Integration requirements
          - Deployment and infrastructure
          - User experience and frontend considerations
          - API design and backend architecture
          
          Make each question detailed and specific. Here are examples of good elaborate questions:
          
          Example 1:
          "What are your data storage requirements? Do you need relational data for structured information, document storage for flexible schemas, or both? What are your expected data volumes, read/write patterns, and query requirements? Will you need real-time analytics or batch processing?"
          
          Example 2:
          "How do you plan to handle scalability? What is your expected user base and growth trajectory? Do you need horizontal scaling, vertical scaling, or both? What are your performance requirements in terms of response time, throughput, and concurrent users?"
          
          Example 3:
          "What security and authentication mechanisms do you need? Will you support multiple authentication methods (email/password, OAuth, SSO)? What are your data privacy requirements? Do you need role-based access control, encryption at rest, or compliance with specific standards (GDPR, HIPAA, etc.)?"
          
          Example 4:
          "What is your deployment and infrastructure strategy? Will you deploy on cloud (AWS, GCP, Azure), on-premises, or hybrid? Do you need containerization (Docker, Kubernetes)? What are your CI/CD requirements and disaster recovery needs?"
          
          Example 5:
          "What are your frontend and user experience requirements? Do you need a web app, mobile app, or both? What frameworks and libraries are you considering? What are your accessibility, internationalization, and browser compatibility requirements?"
          
          Return a JSON object with a "questions" array containing 8-12 questions. Each item should have:
          - id: string (unique, like "q1", "q2", etc.)
          - text: string (the detailed, elaborate question to ask, similar to the examples above)
          - category: string (e.g., "Frontend", "Backend", "Data", "Infrastructure", "Security", "Scalability", "Deployment", "Integration")
          
          IMPORTANT: Generate at least 8 questions. Do not return markdown, just the JSON.
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

        if (questions.length === 0 || questions.length < 8) {
            // Fallback questions - ensure we have at least 8
            const fallbackQuestions = [
                { id: "q1", text: "What are your data storage requirements? Do you need relational data for structured information, document storage for flexible schemas, or both? What are your expected data volumes, read/write patterns, and query requirements?", category: "Data" },
                { id: "q2", text: "How do you plan to handle scalability? What is your expected user base and growth trajectory? Do you need horizontal scaling, vertical scaling, or both? What are your performance requirements?", category: "Scalability" },
                { id: "q3", text: "What security and authentication mechanisms do you need? Will you support multiple authentication methods? What are your data privacy and compliance requirements?", category: "Security" },
                { id: "q4", text: "What is your deployment and infrastructure strategy? Will you deploy on cloud, on-premises, or hybrid? Do you need containerization? What are your CI/CD requirements?", category: "Infrastructure" },
                { id: "q5", text: "What are your frontend and user experience requirements? Do you need a web app, mobile app, or both? What frameworks are you considering? What are your accessibility requirements?", category: "Frontend" },
                { id: "q6", text: "What backend architecture and API design do you need? Will you use REST, GraphQL, or both? What are your API versioning, rate limiting, and documentation requirements?", category: "Backend" },
                { id: "q7", text: "What third-party integrations do you need? Will you integrate with payment processors, messaging services, analytics tools, or other external APIs? What are your integration patterns?", category: "Integration" },
                { id: "q8", text: "What are your monitoring, logging, and observability requirements? Do you need real-time monitoring, error tracking, performance metrics, or distributed tracing?", category: "Observability" }
            ];
            
            // Use fallback if no questions, or merge if we have some but not enough
            if (questions.length === 0) {
                questions = fallbackQuestions;
            } else {
                // Add fallback questions to reach at least 8
                const existingIds = new Set(questions.map(q => q.id));
                for (const fallback of fallbackQuestions) {
                    if (questions.length >= 8) break;
                    if (!existingIds.has(fallback.id)) {
                        questions.push(fallback);
                    }
                }
            }
        }

        // Initialize answers as null
        this.session.questions = questions.map((q: any) => ({ ...q, answer: null }));
        this.session.phase = "interview";
    }

    async runInterviewTurn(userMessage: string | null, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // Find unanswered questions
        const unansweredQuestions = this.session.questions.filter(q => q.answer === null);

        if (unansweredQuestions.length === 0) {
            // All answered - move to confirmation phase
            this.session.phase = "confirmation";
            await this.requestConfirmation(writer, encoder);
            return;
        }

        // If userMessage is present, use an agent to map the response to the correct question(s)
        if (userMessage !== null) {
            await this.mapAnswerToQuestions(userMessage, writer, encoder);
            
            // Check if all questions are answered
            const stillUnanswered = this.session.questions.filter(q => q.answer === null);
            if (stillUnanswered.length === 0) {
                // All answered - move to confirmation phase
                this.session.phase = "confirmation";
                await this.requestConfirmation(writer, encoder);
                return;
            }

            // Ask the next unanswered question
            const nextQuestion = stillUnanswered[0];
            await writer.write(encoder.encode(`\n\n**${nextQuestion.category}**: ${nextQuestion.text}`));
        } else {
            // Just starting interview, ask the first question
            const firstQuestion = unansweredQuestions[0];
            await writer.write(encoder.encode(`\n\n**${firstQuestion.category}**: ${firstQuestion.text}`));
        }
    }

    async requestConfirmation(writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        this.session.awaitingConfirmation = true;
        await writer.write(encoder.encode("\n\n**All questions have been answered!**\n\n"));
        await writer.write(encoder.encode("Before I generate the architecture document, is there anything else you'd like to add or clarify?\n\n"));
        await writer.write(encoder.encode("Please let me know if you want to:\n"));
        await writer.write(encoder.encode("- Add any additional information\n"));
        await writer.write(encoder.encode("- Clarify any of your previous answers\n"));
        await writer.write(encoder.encode("- Or type 'yes', 'proceed', or 'generate' to proceed with document generation\n"));
    }

    async mapAnswerToQuestions(userMessage: string, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // Use an AI agent to determine which question(s) the user's response answers
        // In confirmation or synthesis phase, allow updating any question
        const questionsToCheck = (this.session.phase === "confirmation" || this.session.phase === "synthesis")
            ? this.session.questions
            : this.session.questions.filter(q => q.answer === null);
            
        const questionsList = questionsToCheck.map(q => ({ 
            id: q.id, 
            text: q.text, 
            category: q.category,
            currentAnswer: q.answer 
        }));

        const systemPrompt = `
          You are an expert at analyzing user responses and mapping them to specific questions.
          
          You have the following questions:
          ${questionsList.map((q, i) => `${i + 1}. [${q.id}] ${q.category}: ${q.text}${q.currentAnswer ? ` (Current answer: ${q.currentAnswer})` : ''}`).join("\n")}
          
          User's response: "${userMessage}"
          
          Analyze the user's response and determine which question(s) it answers or updates. The user might:
          - Answer the current question
          - Answer multiple questions at once
          - Answer a different question than the one currently being asked
          - Update or clarify a previous answer
          - Provide additional information that partially answers a question
          
          Return a JSON object with an "answers" array. Each item should have:
          - questionId: string (the id of the question being answered)
          - answer: string (the relevant part of the user's response that answers this question, or the full response if it's a direct answer)
          - confidence: number (0-1, how confident you are this answer matches the question)
          
          Only include questions where confidence >= 0.5. If the response doesn't clearly answer any question, return an empty array.
          
          Do not return markdown, just the JSON.
        `;

        try {
            const response = await this.env.AI.run("@cf/meta/llama-3-8b-instruct", {
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Map the user's response to the appropriate questions." }
                ]
            });

            let mappedAnswers = [];
            try {
                const text = response.response.trim();
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const data = JSON.parse(jsonMatch[0]);
                    mappedAnswers = data.answers || [];
                }
            } catch (e) {
                console.error("Failed to parse mapped answers", e);
            }

            // Update the questions with the mapped answers
            let answeredCount = 0;
            for (const mapped of mappedAnswers) {
                if (mapped.questionId && mapped.answer && mapped.confidence >= 0.5) {
                    const questionIndex = this.session.questions.findIndex(q => q.id === mapped.questionId);
                    if (questionIndex >= 0) {
                        // Allow updating even if already answered (for confirmation/synthesis phase)
                        this.session.questions[questionIndex].answer = mapped.answer;
                        answeredCount++;
                    }
                }
            }

            // If no questions were mapped and we're in interview phase, assume it answers the first unanswered question
            if (answeredCount === 0 && this.session.phase === "interview") {
                const unansweredQuestions = this.session.questions.filter(q => q.answer === null);
                if (unansweredQuestions.length > 0) {
                    const firstUnansweredIndex = this.session.questions.findIndex(q => q.id === unansweredQuestions[0].id);
                    if (firstUnansweredIndex >= 0) {
                        this.session.questions[firstUnansweredIndex].answer = userMessage;
                    }
                }
            }
        } catch (error) {
            console.error("Error mapping answer to questions:", error);
            // Fallback: just assign to the first unanswered question
            const firstUnansweredIndex = this.session.questions.findIndex(q => q.answer === null);
            if (firstUnansweredIndex >= 0) {
                this.session.questions[firstUnansweredIndex].answer = userMessage;
            }
        }
    }

    async handleConfirmation(userMessage: string, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        const lowerMessage = userMessage.toLowerCase().trim();
        const proceedKeywords = ['yes', 'proceed', 'generate', 'go ahead', 'continue', 'ready'];
        const shouldProceed = proceedKeywords.some(keyword => lowerMessage.includes(keyword));

        if (shouldProceed) {
            this.session.phase = "synthesis";
            this.session.awaitingConfirmation = false;
            await this.runSynthesizer(writer, encoder);
        } else {
            // User wants to add something - treat it as additional information
            await this.mapAnswerToQuestions(userMessage, writer, encoder);
            
            // Check if they answered any new questions or provided extra info
            // Then ask for confirmation again
            await writer.write(encoder.encode("\n\nThank you for the additional information. "));
            await this.requestConfirmation(writer, encoder);
        }
    }

    async handlePostGenerationEdit(userMessage: string, writer: WritableStreamDefaultWriter, encoder: TextEncoder) {
        // User is editing after document generation
        await writer.write(encoder.encode("\n\nI see you'd like to make changes. "));
        
        // Map the edit to relevant questions
        await this.mapAnswerToQuestions(userMessage, writer, encoder);
        
        // Ask for confirmation before regenerating
        this.session.phase = "confirmation";
        await this.requestConfirmation(writer, encoder);
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
