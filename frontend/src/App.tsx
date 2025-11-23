import React, { useState, useEffect } from 'react';
import { Chat } from './components/Chat';
import { Progress } from './components/Progress';
import { Sparkles } from 'lucide-react';
import './App.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionState {
  phase: string;
  questions: any[];
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! I am **DecisionLog**. \n\nTell me about the system you want to build, and I will help you design the architecture.' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>({ phase: 'intent', questions: [] });
  const [sessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8787/state?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          setSessionState(data);
        }
      } catch (e) {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const sendMessage = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsLoading(true);

    try {
      const response = await fetch(`http://localhost:8787/chat?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      // For architecture document generation, wait for complete response
      const responseText = await response.text();
      
      // Add the complete response as a new message
      setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="app-background">
        <div className="app-background-noise"></div>
        <div className="app-background-gradient"></div>
        <div className="app-orb app-orb-1"></div>
        <div className="app-orb app-orb-2"></div>
      </div>

      <header className="app-header">
        <div className="app-header-box">
          <div className="app-header-icon">
            <Sparkles />
          </div>
          <h1 className="app-header-title">DecisionLog</h1>
        </div>
        <p className="app-header-subtitle">AI-Powered System Design Interviewer</p>
      </header>

      <div className="app-content">
        <Progress questions={sessionState.questions} />

        <div className="app-chat-container">
          <Chat
            messages={messages}
            onSendMessage={sendMessage}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
