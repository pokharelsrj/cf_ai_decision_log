import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User } from 'lucide-react';
import './Chat.css';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatProps {
    messages: Message[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
}

export const Chat: React.FC<ChatProps> = ({ messages, onSendMessage, isLoading }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim() && !isLoading) {
            onSendMessage(input);
            setInput('');
        }
    };

    return (
        <div className="chat">
            <div className="chat-messages">
                {messages
                    .filter(msg => msg.content.trim().length > 0)
                    .map((msg, index) => (
                    <div
                        key={index}
                        className={`chat-message ${msg.role}`}
                    >
                        <div className={`chat-avatar ${msg.role}`}>
                            {msg.role === 'user' ? (
                                <User />
                            ) : (
                                <Bot />
                            )}
                        </div>

                        <div className={`chat-bubble ${msg.role}`}>
                            {msg.role === 'user' ? (
                                <div className="chat-bubble-content">{msg.content}</div>
                            ) : (
                                <div className="prose">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="chat-loading">
                        <div className="chat-loading-avatar">
                            <Bot />
                        </div>
                        <div className="chat-loading-bubble">
                            <div className="chat-loading-content">
                                <div className="chat-loading-dots">
                                    <div className="chat-loading-dot"></div>
                                    <div className="chat-loading-dot"></div>
                                    <div className="chat-loading-dot"></div>
                                </div>
                                <span className="chat-loading-text">Thinking...</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container">
                <form onSubmit={handleSubmit} className="chat-input-form">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your message..."
                        className="chat-input"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="chat-send-button"
                    >
                        <Send />
                    </button>
                </form>
            </div>
        </div>
    );
};
