import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import './Progress.css';

interface Question {
    id: string;
    text: string;
    category: string;
    answer: string | null;
}

interface ProgressProps {
    questions: Question[];
}

export const Progress: React.FC<ProgressProps> = ({ questions }) => {
    if (questions.length === 0) return null;

    const answeredCount = questions.filter(q => q.answer !== null).length;
    const totalCount = questions.length;
    const progress = (answeredCount / totalCount) * 100;

    return (
        <div className="progress">
            <div className="progress-card">
                <div className="progress-header">
                    <div className="progress-header-left">
                        <h2>Interview Progress</h2>
                        <p>Building your architecture profile</p>
                    </div>
                    <div className="progress-header-right">
                        <span className="progress-percentage">{Math.round(progress)}%</span>
                    </div>
                </div>

                <div className="progress-bar-container">
                    <div
                        className="progress-bar"
                        style={{ width: `${progress}%` }}
                    >
                        <div className="progress-bar-shimmer"></div>
                    </div>
                </div>

                <div className="progress-questions">
                    {questions.map((q) => (
                        <div
                            key={q.id}
                            className={`progress-question ${q.answer ? 'answered' : 'pending'}`}
                        >
                            <div className="progress-question-icon">
                                {q.answer ? (
                                    <CheckCircle2 />
                                ) : (
                                    <Circle />
                                )}
                            </div>
                            <div className="progress-question-content">
                                <div className="progress-question-category">{q.category}</div>
                                <div className="progress-question-text">{q.text}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
