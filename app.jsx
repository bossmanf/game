const { useEffect, useState, useRef, useCallback } = React;

// Initial state for the UI
const initialUIState = {
    score: 0,
    difficulty: "Very Easy",
    tone: "Normal",
    loading: true,
    message: "Initializing LLM...",
    topics: [],
    question: null,
    options: [],
    correctAnswer: null,
    lastGuess: null,
    phase: 'loading', // loading | topic_select | quiz | quiz_result
    scoreAdjustment: 0,
    isCorrect: null,
};

// --- Image and Style Logic ---

const getConductorImageProps = (state) => {
    let style = "border-4 shadow-xl p-2 rounded-full transform transition-all duration-300";
    let messageStyle = "text-xl font-bold text-center p-3 rounded-lg";
    let conductorTitle = "The Conductor";
    let imageSrc = "https://placehold.co/150x150/1e293b/f8fafc?text=Host"; // Default host image

    switch (state.tone) {
        case 'Excited':
            style += " border-green-500 scale-105";
            messageStyle += " bg-green-900/50 text-green-300";
            conductorTitle = "The Conductor (Thrilled!)";
            imageSrc = "https://placehold.co/150x150/16a34a/f8fafc?text=EXCITED";
            break;
        case 'Sassy':
            style += " border-pink-500 rotate-1 ";
            messageStyle += " bg-pink-900/50 text-pink-300";
            conductorTitle = "The Conductor (Sassy)";
            imageSrc = "https://placehold.co/150x150/db2777/f8fafc?text=SASSY";
            break;
        case 'Challenging':
            style += " border-red-500 scale-95";
            messageStyle += " bg-red-900/50 text-red-300";
            conductorTitle = "The Conductor (Challenging!)";
            imageSrc = "https://placehold.co/150x150/dc2626/f8fafc?text=CHALLENGE";
            break;
        case 'Normal':
        default:
            style += " border-teal-500";
            messageStyle += " bg-teal-900/50 text-teal-300";
            imageSrc = "https://placehold.co/150x150/0f766e/f8fafc?text=HOST";
            break;
    }
    
    return { style, messageStyle, conductorTitle, imageSrc };
};

const getCharacterImageProps = (state) => {
    let style = "border-4 shadow-xl p-2 rounded-full transform transition-all duration-300";
    let imageSrc = "https://placehold.co/150x150/374151/f8fafc?text=Player";

    if (state.phase === 'quiz_result') {
        if (state.isCorrect) {
            style += " border-green-500 scale-110 shadow-green-500/50";
            imageSrc = "https://placehold.co/150x150/10b981/f8fafc?text=CORRECT!";
        } else {
            style += " border-red-500 scale-90 shadow-red-500/50";
            imageSrc = "https://placehold.co/150x150/ef4444/f8fafc?text=WRONG!";
        }
    } else {
        style += " border-blue-500";
        imageSrc = `https://placehold.co/150x150/3b82f6/f8fafc?text=LVL%20${state.difficulty.substring(0,1).toUpperCase()}`;
    }

    return { style, imageSrc };
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
        
        // New event to update conductor's message without changing phase
        game.events.on('CONVERSATION_UPDATE', ({ message }) => {
            setUiState(prev => ({ ...prev, message: message }));
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
                lastGuess: null,
                isCorrect: null, // Reset result
                scoreAdjustment: 0
            }));
        });
        
        // C. Handle game state updates (after guessing)
        game.events.on('GAME_STATE_UPDATE', (newGameState) => {
            setUiState(prev => ({ 
                ...prev, 
                score: newGameState.score, 
                difficulty: newGameState.difficulty,
                tone: newGameState.conversation_tone,
                phase: newGameState.phase,
                isCorrect: newGameState.isCorrect,
                scoreAdjustment: newGameState.scoreAdjustment,
                message: newGameState.conductorComment // Use the new comment for display
            }));
        });
        
        // D. Handle guess result from Phaser (for highlighting buttons)
        game.events.on('GUESS_PROCESSED', ({ correctAnswer }) => {
            setUiState(prev => ({ 
                ...prev, 
                correctAnswer: correctAnswer,
                // lastGuess is set in handleAnswerClick
            }));
        });

        // Cleanup event listeners when component unmounts
        return () => {
            game.events.off('LLM_READY');
            game.events.off('CONVERSATION_UPDATE');
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
            setUiState(prev => ({ 
                ...prev, 
                phase: 'loading', 
                message: `Topic ${topic} selected. Loading challenge...` 
            })); 
            sceneRef.current.handleTopicSelection(topic);
        }
    };

    const handleAnswerClick = (guess) => {
        if (sceneRef.current && uiState.phase === 'quiz' && uiState.correctAnswer === null) {
              // Disable further interaction visually by setting lastGuess immediately
              setUiState(prev => ({ ...prev, lastGuess: guess })); 
              // Call the exposed method on the Phaser scene instance
              sceneRef.current.processPlayerGuess(guess);
        }
    };
    
    // Get image props based on current state
    const conductorProps = getConductorImageProps(uiState);
    const characterProps = getCharacterImageProps(uiState);

    return (
        <div className="flex flex-col md:flex-row items-stretch justify-center p-4 w-full h-full text-white">
            
            {/* 1. Conductor Panel (Left) */}
            <div className="md:w-1/5 w-full bg-gray-900/80 p-6 rounded-l-xl shadow-2xl border-r border-gray-700 flex flex-col items-center justify-start space-y-6">
                <h3 className="text-2xl font-bold text-red-400 mb-2">Host</h3>
                <img 
                    src={conductorProps.imageSrc} 
                    alt="The Conductor" 
                    className={conductorProps.style + " w-36 h-36"}
                />
                <h4 className="text-lg font-semibold text-red-300">{conductorProps.conductorTitle}</h4>
                <p className={conductorProps.messageStyle + " w-full h-24 overflow-hidden"}>
                    {uiState.message}
                </p>
                
                <div className="text-center mt-auto">
                    <p className="text-lg text-gray-400">Difficulty:</p>
                    <p className="text-xl font-extrabold text-yellow-400">{uiState.difficulty}</p>
                </div>
            </div>

            {/* 2. Game Center (Phaser Canvas + Buttons) */}
            <div className="md:w-3/5 w-full bg-gray-800/90 p-6 shadow-2xl flex flex-col items-center space-y-4">
                <h1 className="text-4xl font-extrabold text-teal-400 music-font mb-4">
                    Trivia Challenge
                </h1>

                {/* The Phaser Canvas Container */}
                <div 
                    id="phaser-container" 
                    className="w-[600px] h-[400px] border-4 border-red-500 rounded-xl shadow-inner shadow-red-500/50 overflow-hidden bg-black"
                    style={{ 
                        width: '600px', 
                        height: '400px',
                        // Center the canvas if its container is larger
                        margin: '0 auto' 
                    }}
                >
                    {/* Phaser Canvas renders here (600x400) */}
                </div>

                {/* Status/Score Area */}
                <div className="flex justify-between w-full max-w-[600px] p-2 text-xl font-bold rounded-lg bg-gray-900/70 border border-gray-700">
                    <span className="text-green-400">Score: {uiState.score}</span>
                    {uiState.phase === 'quiz_result' && (
                        <span className={uiState.isCorrect ? "text-green-500" : "text-red-500"}>
                            {uiState.isCorrect ? `+${uiState.scoreAdjustment} Points!` : `${uiState.scoreAdjustment} Points!`}
                        </span>
                    )}
                    <span className="text-purple-400">Tone: {uiState.tone}</span>
                </div>
                
                {/* Interaction Area (Topics/Answers) */}
                <div className="mt-4 p-4 rounded-lg w-full max-w-[600px]">
                    
                    {/* LOADING PHASE */}
                    {uiState.phase === 'loading' && (
                        <p className="text-center text-xl text-yellow-500 animate-pulse">
                            {uiState.loading ? "Initializing LLM..." : "Loading Challenge..."}
                        </p>
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
                                        className="px-6 py-4 bg-purple-500 text-white text-xl font-extrabold rounded-xl shadow-2xl
                                                   hover:bg-purple-600 transition-all duration-200 transform hover:scale-105"
                                    >
                                        {topic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* QUIZ PHASE (Answer Buttons) */}
                    {['quiz', 'quiz_result'].includes(uiState.phase) && uiState.options.length > 0 && (
                        <div className="grid grid-cols-2 gap-4 w-full">
                            {uiState.options.map(option => {
                                let buttonClasses = "px-4 py-3 text-lg font-medium rounded-xl transition-all duration-300 shadow-lg music-font";
                                
                                const isAnswered = uiState.correctAnswer !== null;
                                const isCorrectAnswer = isAnswered && (option === uiState.correctAnswer);
                                const isPlayerGuess = isAnswered && (option === uiState.lastGuess);
                                
                                if (isAnswered) {
                                    if (isCorrectAnswer) {
                                        // Correct answer highlight (Green)
                                        buttonClasses += " bg-green-600 border-2 border-green-300 transform scale-105";
                                    } else if (isPlayerGuess) {
                                        // Player's incorrect guess highlight (Red)
                                        buttonClasses += " bg-red-600 border-2 border-red-300 opacity-80";
                                    } else {
                                        // Other options dim (preventing further interaction)
                                        buttonClasses += " bg-gray-600 opacity-50 cursor-default";
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
                    )}

                </div>
            </div>
            
            {/* 3. Character Panel (Right) */}
            <div className="md:w-1/5 w-full bg-gray-900/80 p-6 rounded-r-xl shadow-2xl border-l border-gray-700 flex flex-col items-center justify-start space-y-6">
                <h3 className="text-2xl font-bold text-blue-400 mb-2">You (The Player)</h3>
                <img 
                    src={characterProps.imageSrc} 
                    alt="Player Character" 
                    className={characterProps.style + " w-36 h-36"}
                />
                
                <div className="text-center mt-auto">
                    <p className="text-lg text-gray-400">Progress to 1000:</p>
                    <div className="w-full h-6 bg-gray-700 rounded-full mt-2 overflow-hidden">
                        <div 
                            className="h-full bg-yellow-500 transition-all duration-500" 
                            style={{ width: `${Math.min(100, (uiState.score / 1000) * 100)}%` }}
                        ></div>
                    </div>
                    <p className="text-xl font-extrabold text-yellow-300 mt-1">{uiState.score}/1000</p>
                </div>
            </div>
        </div>
    );
}

// Make sure the React application is rendered into the root element
ReactDOM.createRoot(document.getElementById('root')).render(<App />);