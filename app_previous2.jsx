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
        if (sceneRef.current && uiState.phase === 'quiz' && uiState.correctAnswer === null) {
              // Disable further interaction visually and show it's processing
              setUiState(prev => ({ ...prev, lastGuess: guess })); 
              // Call the exposed method on the Phaser scene instance
              sceneRef.current.processPlayerGuess(guess);
        }
    };
    
    // The main render block was missing, which is why the topics didn't show up!
    return (
        <div className="flex flex-col items-center justify-center p-4 min-h-screen text-white">
            
            {/* The Phaser Canvas Container */}
            <div id="phaser-container" className="mb-4 w-[800px] h-[600px] border-2 border-red-500 rounded-lg shadow-xl overflow-hidden">
                {/* Phaser Canvas renders here */}
            </div>

            {/* UI Control Panel */}
            <div className="bg-gray-800/90 p-6 rounded-lg shadow-2xl w-[800px] border border-gray-700">
                <h2 className="text-xl font-bold mb-3 text-red-400">Game Status</h2>
                <div className="flex justify-between text-lg mb-4">
                    <span>Score: <span className="text-green-400 font-extrabold">{uiState.score}</span></span>
                    <span>Difficulty: <span className="text-yellow-400">{uiState.difficulty}</span></span>
                    <span>Tone: <span className="text-teal-400">{uiState.tone}</span></span>
                </div>
                
                {/* Main Interaction Area */}
                <div className="mt-4 p-4 bg-gray-900/90 rounded-lg border-2 border-gray-700">
                    
                    {/* LOADING PHASE */}
                    {uiState.phase === 'loading' && (
                        <p className="text-center text-xl text-yellow-500 animate-pulse">{uiState.message}</p>
                    )}

                    {/* TOPIC SELECTION PHASE */}
                    {uiState.phase === 'topic_select' && uiState.topics.length > 0 && (
                        <div className="text-center">
                            <p className="text-2xl font-semibold mb-6 text-red-300">Choose Your Topic:</p>
                            <div className="flex flex-col md:flex-row gap-4 justify-center">
                                {uiState.topics.map(topic => (
                                    <button
                                        key={topic}
                                        onClick={() => handleTopicClick(topic)}
                                        className="px-6 py-4 bg-purple-600 text-white text-xl font-bold rounded-xl shadow-lg
                                                   hover:bg-purple-700 transition-all duration-200 transform hover:scale-105"
                                    >
                                        {topic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* QUIZ PHASE */}
                    {uiState.phase === 'quiz' && uiState.options.length > 0 && (
                        <div className="flex flex-col items-center">
                            {/* The Conductor's comment is displayed here from the UI state message */}
                            <p className="text-lg italic text-gray-400 mb-4 text-center">{`Conductor: ${uiState.message}`}</p>
                            
                            <div className="grid grid-cols-2 gap-4 w-full">
                                {uiState.options.map(option => {
                                    let buttonClasses = "px-4 py-3 text-lg font-medium rounded-lg transition-all duration-300 shadow-md";
                                    
                                    const isAnswered = uiState.correctAnswer !== null;
                                    const isCorrectAnswer = isAnswered && (option === uiState.correctAnswer);
                                    const isPlayerGuess = isAnswered && (option === uiState.lastGuess);
                                    
                                    if (isAnswered) {
                                        if (isCorrectAnswer) {
                                            // Correct answer highlight (Green)
                                            buttonClasses += " bg-green-600 hover:bg-green-700 opacity-100";
                                        } else if (isPlayerGuess && !isCorrectAnswer) {
                                            // Player's incorrect guess highlight (Red)
                                            buttonClasses += " bg-red-600 hover:bg-red-700 opacity-70";
                                        } else {
                                            // Other options dim (preventing further interaction)
                                            buttonClasses += " bg-gray-600 hover:bg-gray-600 opacity-50 cursor-default";
                                        }
                                    } else {
                                        // Default quiz button style
                                        buttonClasses += " bg-blue-500 hover:bg-blue-600";
                                    }

                                    return (
                                        <button
                                            key={option}
                                            onClick={() => !isAnswered && handleAnswerClick(option)}
                                            disabled={isAnswered}
                                            className={buttonClasses}
                                        >
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}

// Make sure the React application is rendered into the root element
ReactDOM.createRoot(document.getElementById('root')).render(<App />);