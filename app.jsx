// App.jsx (must be loaded via <script type="text/babel" src="App.jsx"></script>)

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
    lastGuess: null
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
        game.events.on('TOPICS_READY', ({ topics, comment }) => {
            setUiState(prev => ({ 
                ...prev, 
                topics: topics, 
                message: comment,
                phase: 'topic_select'
            }));
        });

        // B. Handle new question from Phaser
        game.events.on('QUESTION_READY', ({ question, options, comment }) => {
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
            setUiState(prev => ({ ...prev, phase: 'loading', message: `Topic ${topic} selected. Loading challenge...` }));
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

    // Function to get the correct button style based on game state
    const getButtonStyle = (option) => {
        if (uiState.lastGuess === 'checking') return 'ui-button'; // Keep neutral while checking
        if (!uiState.correctAnswer) return 'ui-button'; // Default style
        
        const isCorrect = option === uiState.correctAnswer;
        const isGuessed = uiState.options.find(o => o === option && o === uiState.lastGuess); // Check if this was the one the user clicked

        if (isCorrect) {
            return 'ui-button' + (uiState.lastGuess === 'correct' ? ' correct-flash' : ' correct');
        } else if (isGuessed && uiState.lastGuess === 'wrong') {
             return 'ui-button wrong';
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
                        disabled={uiState.loading}
                    >
                        {topic}
                    </button>
                ))}

                {/* Show Answers */}
                {uiState.phase === 'quiz' && uiState.options.map(option => (
                    <button 
                        key={option} 
                        className={getButtonStyle(option)}
                        onClick={() => handleAnswerClick(option)}
                        disabled={!!uiState.correctAnswer} // Disable once an answer is processed
                    >
                        {option}
                    </button>
                ))}

                {/* Loading Indicator */}
                {uiState.loading && <p>Loading LLM assets. Please wait...</p>}
            </div>
            
        </div>
    );
}

// Render the main React application into the root DOM element
// ReactDOM.render(<App />, document.getElementById('root'));
ReactDOM..createRoot(<App />, document.getElementById('root'));