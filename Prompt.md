I want to build a Cloudflare application called **DecisionLog**.

The purpose is to help a developer brainstorm a new system design. The user chats with the agent about their idea. The agent should guide an interview to gather essential architectural details. The end result is a structured architecture document that reflects the user's decisions.

Here is the desired workflow behavior:

1. A user writes a message describing what they want to build.
2. The system should detect the intent and scope of the project. The project can be frontend only, backend only, full stack, data pipeline, cloud infrastructure, or something else.
3. Based on the intent, the system should generate a set of essential architecture questions. These questions should be stored in a JSON object in memory for the entire session.
4. During the conversation, the agent should:
   - Ask the next missing question
   - Parse the user’s response and fill answers inside the JSON
   - If the user gives additional information, save it under extraNotes inside the same JSON
5. After each message:
   - Check for unanswered questions
   - If some remain, keep interviewing and fill them
   - If all are answered, ask if the user wants to add anything else
   - When the user says the architecture is complete, generate a final architecture document using the JSON

For now, the memory is session only. No need to store it in a database or durable storage. The JSON state can be kept in memory for the duration of one chat session and cleared after the user finishes.

---

## Implementation model

Use a single Cloudflare Agent as the orchestrator. Inside it, use different prompt styles as sub agent roles. The user never sees the sub agents.

Sub agents:
- Intent Agent for figuring out scope and goals
- Question Planner Agent for generating the JSON question list
- Interview Agent for mapping answers to JSON and selecting the next question
- Synthesizer Agent for converting final JSON to an architecture document

Phases in the session:
- intent
- question_planning
- interview
- synthesis

The orchestrator decides which sub agent to call based on the current phase and JSON content.

---

## JSON structure to keep in memory during chat

```ts
{
  phase: "intent" | "question_planning" | "interview" | "synthesis",
  intent: any | null,
  questions: [
    {
      id: string,
      text: string,
      category: string,
      answer: string | null
    }
  ],
  extraNotes: string[],
  finalDoc: string | null
}

```
---

## Technical requirements

### Backend
A Cloudflare Agent that:
- Handles chat messages
- Maintains the JSON object as session memory
- Calls Workers AI to:
    - runIntentAgent
    - runQuestionPlanner
    - runInterviewTurn
    - runSynthesizer
- Clears memory at the end of session or when user refreshes

### Frontend
- Minimal React based chat UI deployed on Cloudflare Pages
- Streaming chat replies from the Agent
- Display which questions are answered and which are not


## Build steps
Please generate code step by step. Wait for me to confirm before proceeding:

- Scaffold the Cloudflare Agent with a streaming echo reply
- Add in memory JSON state that lives for one connection
- Implement runIntentAgent to set scope and goals in JSON
- Implement runQuestionPlanner to produce initial question set
- Implement runInterviewTurn to apply user answers and select the next unanswered question
- Move to synthesis phase when all questions are answered
- Implement runSynthesizer to generate the final architecture document as markdown
- Create a simple React chat UI that streams messages and shows question progress
- Light UI polish and final checks

## Final deliverable

A complete Cloudflare application that:
- Uses Workers AI (LLM)
- Stores session memory for the interview in memory only
- Provides chat based user input
- Produces a structured architecture document at the end
