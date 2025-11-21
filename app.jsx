const { useEffect, useState, useRef, useCallback } = React;


// Initial state for the UI
const initialUIState = {
    score: 0,
    difficulty: "Easy",
    tone: "Normal",
    loading: true,
    message: "Initializing LLM...",
    topics: [],
    question: null,
    options: [],
    correctAnswer: null,
    lastGuess: null,
    phase: 'loading'
};

// --- React Components ---

/**
 * Renders the main application wrapper, manages game state, and handles communication with Phaser.
 */
function App() {
    const [uiState, setUiState] = useState(initialUIState);
    const sceneRef = useRef(null); // Reference to the Phaser scene for direct method calls

    // 1. Setup Communication from Phaser -> React
    useEffect(() => {
        const game = window.phaserGameInstance; 
        if (!game) return; // Safety check

        // Once the Phaser game is created, get the scene reference
        game.events.on('ready', () => {
            sceneRef.current = game.scene.getScene('MusicTriviaScene');
            console.log("Phaser scene reference obtained.");
        });

        game.events.on('LLM_READY', () => {
            setUiState(prev => ({ ...prev, loading: false, message: "LLM Ready. Generating topics..." }));
        });

        // A. Handle new topics from Phaser
        game.events.on('TOPICS_READY', ({ topics }) => {
            setUiState(prev => ({ 
                ...prev, 
                topics: topics, 
                phase: 'topic_select'
            }));
        });

        // B. Handle new question from Phaser
        game.events.on('QUESTION_READY', ({ question, options, correct_answer, comment }) => {
            setUiState(prev => ({ 
                ...prev, 
                question: question,
                options: options, 
                message: comment,
                phase: 'quiz',
                correctAnswer: null, // Reset guess state
                lastGuess: null
            }));
        });
        
        // C. Handle game state updates
        game.events.on('GAME_STATE_UPDATE', (newGameState) => {
            setUiState(prev => ({ 
                ...prev, 
                score: newGameState.score, 
                difficulty: newGameState.difficulty,
                tone: newGameState.conversation_tone
            }));
        });
        
        // D. Handle guess result from Phaser (for highlighting buttons)
        game.events.on('GUESS_PROCESSED', ({ isCorrect, correctAnswer }) => {
            setUiState(prev => ({ 
                ...prev, 
                correctAnswer: correctAnswer,
                lastGuess: isCorrect ? 'correct' : 'wrong'
            }));
            // After showing result, wait 2s (Phaser handles the transition)
        });

        // Cleanup event listeners when component unmounts
        return () => {
            game.events.off('LLM_READY');
            game.events.off('TOPICS_READY');
            game.events.off('QUESTION_READY');
            game.events.off('GAME_STATE_UPDATE');
            game.events.off('GUESS_PROCESSED');
        };
    }, []);

    // 2. Communication React -> Phaser (Calling methods on the Scene)
    const handleTopicClick = (topic) => {
        if (sceneRef.current && uiState.phase === 'topic_select') {
            // Set phase to loading immediately to block further clicks and show status
            setUiState(prev => ({ ...prev, phase: 'loading', message: `Topic ${topic} selected. Loading challenge...` })); 
            console.log('handleTopicClick')
            // Call the exposed method on the Phaser scene instance
            sceneRef.current.handleTopicSelection(topic);
        }
    };

    const handleAnswerClick = (guess) => {
        if (sceneRef.current && uiState.phase === 'quiz' && !uiState.correctAnswer) {
             // Disable further interaction visually
            setUiState(prev => ({ ...prev, lastGuess: 'checking' }));
            // Call the exposed method on the Phaser scene instance
            sceneRef.current.processPlayerGuess(guess);
        }
    };
    
    // --- Render Logic ---

    // Simplified style mapping for the answer buttons
    const getAnswerButtonStyle = (option) => {
        if (uiState.correctAnswer) {
            if (option === uiState.correctAnswer) {
                return 'ui-button correct'; // Highlight correct answer
            } else if (option === uiState.lastGuess && uiState.lastGuess === 'wrong') {
                return 'ui-button wrong'; // Highlight user's incorrect guess
            } else {
                return 'ui-button wrong-dim'; // Dim other options
            }
        }
        return 'ui-button';
    };


    return (
        <div className="app-container">
            {/* --- Top UI: Scoreboard --- */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #444' }}>
                <h2 style={{ color: '#00FFC0' }}>Score: {uiState.score}</h2>
                <h2 style={{ color: '#F5D547' }}>Difficulty: {uiState.difficulty}</h2>
            </div>
            
            {/* --- Phaser Canvas Container --- */}
            <div id="phaser-container">
                {/* Phaser will inject its canvas here */}
            </div>

            {/* --- Bottom UI: Dynamic Buttons (Topics or Answers) --- */}
            <div style={{ textAlign: 'center', minHeight: '150px' }}>
                <p style={{ color: '#F5D547', fontSize: '18px' }}>
                    **Conductor:** {uiState.message}
                </p>

                {/* Show Topics */}
                {uiState.phase === 'topic_select' && uiState.topics.map(topic => (
                    <button 
                        key={topic} 
                        className="ui-button"
                        onClick={() => handleTopicClick(topic)}
                        disabled={uiState.loading || uiState.phase !== 'topic_select'}
                    >
                        {topic}
                    </button>
                ))}

                {/* Show Answers */}
                {uiState.phase === 'quiz' && uiState.options.map(option => (
                    <button 
                        key={option} 
                        className={getAnswerButtonStyle(option)}
                        onClick={() => handleAnswerClick(option)}
                        disabled={!!uiState.correctAnswer} // Disable once an answer is processed
                    >
                        {option}
                    </button>
                ))}

                {/* Loading Indicator */}
                {(uiState.loading || uiState.phase === 'loading') && uiState.topics.length === 0 && (
                    <div className="text-gray-400 mt-4 animate-pulse">Loading LLM assets or next challenge...</div>
                )}
            </div>
            
        </div>
    );
}
export default App;

const container = document.getElementById('root');

// Use conditional rendering to prevent the 'createRoot' warning and potential TypeErrors 
// if ReactDOM hasn't fully loaded before script execution.
if (container && typeof ReactDOM !== 'undefined' && typeof ReactDOM.createRoot === 'function') {
    const root = ReactDOM.createRoot(container);
    // Render the App component
    root.render(<App />);
} else {
    console.error("React rendering failed: Container element 'root' not found or ReactDOM not available.");
}