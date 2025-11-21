import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, where, getDocs, updateDoc, onSnapshot } from 'firebase/firestore';

const { useEffect, useState, useRef, useCallback } = React;

// --- Global Variables & Constants (MUST be used) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The LLM Model to use
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';
const LLM_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=`;

// --- Game State & Utility ---

const initialUIState = {
    score: 0,
    difficulty: "Very Easy",
    tone: "Normal",
    loading: true,
    message: "Initializing Firebase & LLM...",
    topics: [],
    question: null,
    options: [],
    correctAnswer: null,
    lastGuess: null,
    phase: 'loading', // loading | topic_select | quiz | quiz_result
    scoreAdjustment: 0,
    isCorrect: null,
    isAuthReady: false,
    userId: null,
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

// --- Phaser Game Component ---
// This component manages the lifecycle of the Phaser game and handles the LLM logic
const PhaserGame = ({ initialAuthState, setUiState }) => {
    useEffect(() => {
        if (!window.Phaser) {
            console.error("Phaser library not loaded.");
            return;
        }

        // --- Firebase/LLM Setup ---
        const firebaseApp = initializeApp(firebaseConfig);
        const auth = getAuth(firebaseApp);
        const db = getFirestore(firebaseApp);
        
        let currentUserId = null;
        let dbReady = false;

        // 1. Scene Definition (The core game logic)
        class MusicTriviaScene extends window.Phaser.Scene {
            constructor() {
                super('MusicTriviaScene');
                this.conversationTone = 'Normal';
                this.currentScore = 0;
                this.difficultyLevel = 'Very Easy';
                this.gameDataRef = null; // Firestore document reference
            }

            preload() {
                // Preload any assets if needed (e.g., audio, images)
            }

            create() {
                // Set the game background color (visually hidden by React container)
                this.cameras.main.setBackgroundColor('#1f2937');
                
                // Expose a public method to React to handle topic selection
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').handleTopicSelection = this.handleTopicSelection.bind(this);
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').processPlayerGuess = this.processPlayerGuess.bind(this);

                // Wait for the Firebase Auth to be ready before calling LLM
                if (dbReady) {
                    this.initializeLLMAndGetTopics();
                } else {
                    console.log("Waiting for Firebase to be ready...");
                }
                
                // Inform React that the scene is ready
                this.game.events.emit('ready');
            }
            
            // --- FIREBASE AND STATE MANAGEMENT ---

            // Gets the user's current game state from Firestore
            async loadOrCreateGameState(userId) {
                const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'gameState', 'trivia');
                this.gameDataRef = userDocRef;

                try {
                    const docSnap = await getDoc(userDocRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        this.currentScore = data.score || 0;
                        this.difficultyLevel = data.difficulty || 'Very Easy';
                        this.conversationTone = data.tone || 'Normal';
                    } else {
                        // Create initial state
                        await setDoc(userDocRef, {
                            score: 0,
                            difficulty: 'Very Easy',
                            tone: 'Normal',
                            questionsAnswered: 0,
                            lastUpdated: new Date()
                        });
                    }
                    this.updateReactState({ phase: 'loading', isCorrect: null, scoreAdjustment: 0 });
                } catch (error) {
                    console.error("Error loading/creating game state:", error);
                }
            }

            // Saves the current score, difficulty, and tone
            async saveGameState() {
                if (!this.gameDataRef) return;
                await updateDoc(this.gameDataRef, {
                    score: this.currentScore,
                    difficulty: this.difficultyLevel,
                    tone: this.conversationTone,
                    lastUpdated: new Date()
                }).catch(e => console.error("Error saving game state:", e));
            }
            
            // Updates React's UI state (wrapper for setUiState)
            updateReactState(additionalState = {}) {
                setUiState(prev => ({ 
                    ...prev, 
                    score: this.currentScore, 
                    difficulty: this.difficultyLevel,
                    tone: this.conversationTone,
                    ...additionalState 
                }));
            }

            // --- LLM API CALLER ---

            async callGeminiAPI(systemPrompt, userQuery, responseSchema = null) {
                // Exponential backoff logic
                const MAX_RETRIES = 5;
                let delay = 1000;

                const apiKey = ""; // Canvas will provide this
                const url = `${LLM_API_URL}${apiKey}`;

                const payload = {
                    contents: [{ parts: [{ text: userQuery }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    tools: [{ "google_search": {} }],
                };

                if (responseSchema) {
                    payload.generationConfig = {
                        responseMimeType: "application/json",
                        responseSchema: responseSchema
                    };
                }

                for (let i = 0; i < MAX_RETRIES; i++) {
                    try {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });

                        if (response.ok) {
                            return await response.json();
                        } else {
                            console.warn(`LLM API request failed (attempt ${i + 1}):`, response.status, await response.text());
                        }
                    } catch (e) {
                        console.error(`LLM API fetch error (attempt ${i + 1}):`, e);
                    }

                    if (i < MAX_RETRIES - 1) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                        delay *= 2; // Exponential backoff
                    }
                }
                throw new Error("Failed to get response from LLM after multiple retries.");
            }

            // --- GAME FLOW LOGIC ---
            
            async initializeLLMAndGetTopics() {
                this.updateReactState({ loading: false, message: "LLM ready. Generating topics..." });
                this.getTopics();
            }

            async getTopics() {
                const systemPrompt = "You are a musical trivia host. Generate 2 diverse and engaging music trivia topics suitable for a quiz game. The response MUST be a JSON array of strings, where each string is a topic name (e.g., ['Classical Music', '1980s Pop Hits']). DO NOT include any commentary outside the JSON array.";

                const responseSchema = {
                    type: "ARRAY",
                    items: { "type": "STRING" }
                };

                try {
                    const result = await this.callGeminiAPI(systemPrompt, "Generate 2 music trivia topics.", responseSchema);
                    const jsonText = result.candidates[0].content.parts[0].text;
                    
                    // Robust JSON Parsing and validation for the topics fix
                    const parsedJson = JSON.parse(jsonText);
                    
                    if (Array.isArray(parsedJson) && parsedJson.length > 0 && parsedJson.every(item => typeof item === 'string')) {
                        console.log("Topics successfully parsed and ready:", parsedJson);
                        this.game.events.emit('TOPICS_READY', { topics: parsedJson });
                    } else {
                        throw new Error("LLM response not in expected array format for topics.");
                    }
                } catch (e) {
                    console.error("Failed to generate or parse topics:", e);
                    this.game.events.emit('CONVERSATION_UPDATE', { message: "Error: Could not retrieve topics. Please refresh." });
                }
            }

            async handleTopicSelection(topic) {
                // Game logic to transition to quiz phase
                this.selectedTopic = topic;
                this.getNewQuestion(topic);
            }

            async getNewQuestion(topic) {
                const systemPrompt = `You are the conductor of a music trivia quiz. The player's current difficulty is ${this.difficultyLevel} (Score: ${this.currentScore}). Your conversation tone is currently ${this.conversationTone}. 
                Generate one multiple-choice question about the topic: "${topic}".
                
                The response MUST be a JSON object with the following structure:
                {
                    "question": "The trivia question text.",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correct_answer": "The text of the correct option (must match one of the options).",
                    "comment": "A brief, encouraging comment from the conductor about starting the quiz."
                }
                
                DO NOT include any commentary outside the JSON object.`;

                const responseSchema = {
                    type: "OBJECT",
                    properties: {
                        "question": { "type": "STRING" },
                        "options": {
                            "type": "ARRAY",
                            "items": { "type": "STRING" }
                        },
                        "correct_answer": { "type": "STRING" },
                        "comment": { "type": "STRING" }
                    },
                    required: ["question", "options", "correct_answer", "comment"]
                };

                try {
                    this.updateReactState({ message: `Generating question on ${topic}...` });
                    const result = await this.callGeminiAPI(systemPrompt, `Generate a question for the topic: ${topic}.`, responseSchema);
                    const jsonText = result.candidates[0].content.parts[0].text;
                    const parsedJson = JSON.parse(jsonText);

                    if (parsedJson.question && Array.isArray(parsedJson.options) && parsedJson.options.length === 4) {
                        this.game.events.emit('QUESTION_READY', parsedJson);
                        this.currentQuestionData = parsedJson;
                    } else {
                        throw new Error("LLM question response was malformed.");
                    }
                } catch (e) {
                    console.error("Failed to generate or parse question:", e);
                    this.game.events.emit('CONVERSATION_UPDATE', { message: "Apologies, I hit a snag getting the question. Let's try another topic." });
                    this.game.events.emit('TOPICS_READY', { topics: this.game.events.contextTopics || [] }); // Go back to topics
                }
            }

            async processPlayerGuess(guess) {
                if (!this.currentQuestionData) return;
                
                const correctAnswer = this.currentQuestionData.correct_answer;
                const isCorrect = guess === correctAnswer;
                
                // Inform React of the correct answer for highlighting buttons
                this.game.events.emit('GUESS_PROCESSED', { correctAnswer });

                // Determine points and update difficulty/tone
                let points = 0;
                let scoreAdjustment = 0;
                if (isCorrect) {
                    points = 100; // Base points
                    scoreAdjustment = points;
                } else {
                    points = -50;
                    scoreAdjustment = points;
                }
                
                // Update internal score and difficulty/tone
                this.currentScore += points;
                
                // Simple difficulty adjustment logic
                if (this.currentScore >= 500) {
                    this.difficultyLevel = 'Difficult';
                    this.conversationTone = 'Challenging';
                } else if (this.currentScore >= 200) {
                    this.difficultyLevel = 'Medium';
                    this.conversationTone = 'Excited';
                } else if (this.currentScore >= 0) {
                    this.difficultyLevel = 'Easy';
                    this.conversationTone = 'Normal';
                } else {
                     this.difficultyLevel = 'Very Easy';
                    this.conversationTone = 'Sassy';
                }
                
                await this.saveGameState();
                
                // Get commentary from LLM
                await this.getConductorCommentary(isCorrect, guess, this.currentQuestionData, scoreAdjustment);
            }
            
            async getConductorCommentary(isCorrect, playerGuess, questionData, scoreAdjustment) {
                const resultText = isCorrect ? "correct" : "incorrect";
                const sentiment = isCorrect ? "positive and encouraging" : "sympathetic but firm";
                const nextAction = this.currentScore >= 1000 ? "congratulate the player on winning" : "ask the player to continue to the next question";
                
                const systemPrompt = `You are the conductor of a music trivia quiz with a ${this.conversationTone} tone. The player just guessed the answer and was ${resultText}. Their score changed by ${scoreAdjustment}. 
                
                The question was: "${questionData.question}". The correct answer was "${questionData.correct_answer}". The player guessed: "${playerGuess}".
                
                Your response MUST be a single paragraph of text (under 50 words) that:
                1. Acknowledges the result (correct or incorrect).
                2. Matches your current tone (${this.conversationTone}).
                3. Performs the next action: ${nextAction}.`;
                
                try {
                    const result = await this.callGeminiAPI(systemPrompt, "Give commentary on the player's answer and move to the next step.");
                    const conductorComment = result.candidates[0].content.parts[0].text;
                    
                    // Update React state for result phase
                    this.game.events.emit('GAME_STATE_UPDATE', { 
                        score: this.currentScore, 
                        difficulty: this.difficultyLevel,
                        conversation_tone: this.conversationTone,
                        phase: 'quiz_result',
                        isCorrect: isCorrect,
                        scoreAdjustment: scoreAdjustment,
                        conductorComment: conductorComment 
                    });
                } catch (e) {
                    console.error("Failed to get commentary:", e);
                    // Fallback comment
                     this.game.events.emit('GAME_STATE_UPDATE', { 
                        score: this.currentScore, 
                        difficulty: this.difficultyLevel,
                        conversation_tone: this.conversationTone,
                        phase: 'quiz_result',
                        isCorrect: isCorrect,
                        scoreAdjustment: scoreAdjustment,
                        conductorComment: isCorrect ? "Excellent! You earned points. Ready for the next one?" : "That's not quite right. Better luck on the next question!"
                    });
                }
            }
            
            // Called by React button click to proceed
            startNextRound() {
                if (this.currentScore >= 1000) {
                    this.game.events.emit('CONVERSATION_UPDATE', { message: "Congratulations! You have mastered the Music Trivia Challenge!" });
                    // Optionally reset or offer a new game
                    return; 
                }
                
                // Back to topic selection
                this.getTopics();
            }

        } // End of MusicTriviaScene

        // 2. Auth Listener and Initialization
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUserId = user.uid;
                dbReady = true;
                setUiState(prev => ({ ...prev, userId: currentUserId, isAuthReady: true, message: "Authentication complete. Loading game state..." }));
                
                // Now initialize Phaser and call LLM once ready
                if (!window.phaserGameInstance) {
                    const config = {
                        type: window.Phaser.AUTO,
                        width: 600,
                        height: 400,
                        parent: 'phaser-container',
                        scene: MusicTriviaScene,
                        backgroundColor: '#1f2937',
                    };

                    const game = new window.Phaser.Game(config);
                    window.phaserGameInstance = game;
                }
                
                // If the scene exists, load state and initialize LLM
                const scene = window.phaserGameInstance.scene.getScene('MusicTriviaScene');
                if (scene) {
                    await scene.loadOrCreateGameState(currentUserId);
                    scene.initializeLLMAndGetTopics();
                }

            } else {
                // Should only happen if initialAuthToken is null (safety fallback)
                console.log("Signing in anonymously...");
                signInAnonymously(auth).catch(e => console.error("Anonymous sign in failed:", e));
            }
        });

        // Initial sign-in attempt
        if (initialAuthToken) {
            signInWithCustomToken(auth, initialAuthToken).catch(e => {
                console.error("Custom token sign in failed. Falling back to anonymous:", e);
                signInAnonymously(auth);
            });
        } else {
            signInAnonymously(auth);
        }

        return () => {
            // Cleanup on unmount (Phaser is usually kept alive but good practice)
            // if (window.phaserGameInstance) {
            //     window.phaserGameInstance.destroy(true);
            //     delete window.phaserGameInstance;
            // }
        };
    }, []);

    return (
        // The container where the Phaser canvas will be injected
        <div 
            id="phaser-container" 
            className="w-[600px] h-[400px] border-4 border-red-500 rounded-xl shadow-inner shadow-red-500/50 overflow-hidden bg-black"
            style={{ width: '600px', height: '400px', margin: '0 auto' }}
        >
            {/* The canvas renders here */}
        </div>
    );
};


// --- Main React Component ---

function App() {
    const [uiState, setUiState] = useState(initialUIState);
    const sceneRef = useRef(null); // Reference to the Phaser scene for direct method calls

    // 1. Setup Communication from Phaser -> React
    useEffect(() => {
        // This useEffect runs once the global phaserGameInstance is available
        const game = window.phaserGameInstance; 
        if (!game) return;

        const handleReady = () => {
            sceneRef.current = game.scene.getScene('MusicTriviaScene');
            console.log("Phaser scene reference obtained.");
        };
        
        const handleConversationUpdate = ({ message }) => {
            setUiState(prev => ({ ...prev, message: message }));
        };

        const handleTopicsReady = ({ topics }) => {
            console.log("Topics received:", topics);
            setUiState(prev => ({ 
                ...prev, 
                topics: topics, 
                phase: 'topic_select',
                message: "Choose Your Topic from the options below:"
            }));
        };

        const handleQuestionReady = ({ question, options, comment }) => {
            setUiState(prev => ({ 
                ...prev, 
                question: question,
                options: options, 
                message: comment,
                phase: 'quiz',
                correctAnswer: null, 
                lastGuess: null,
                isCorrect: null, 
                scoreAdjustment: 0
            }));
        };
        
        const handleGameStateUpdate = (newGameState) => {
            setUiState(prev => ({ 
                ...prev, 
                score: newGameState.score, 
                difficulty: newGameState.difficulty,
                tone: newGameState.conversation_tone,
                phase: newGameState.phase,
                isCorrect: newGameState.isCorrect,
                scoreAdjustment: newGameState.scoreAdjustment,
                message: newGameState.conductorComment
            }));
        };
        
        const handleGuessProcessed = ({ correctAnswer }) => {
            setUiState(prev => ({ 
                ...prev, 
                correctAnswer: correctAnswer,
            }));
        };

        game.events.on('ready', handleReady);
        game.events.on('CONVERSATION_UPDATE', handleConversationUpdate);
        game.events.on('TOPICS_READY', handleTopicsReady);
        game.events.on('QUESTION_READY', handleQuestionReady);
        game.events.on('GAME_STATE_UPDATE', handleGameStateUpdate);
        game.events.on('GUESS_PROCESSED', handleGuessProcessed);

        return () => {
            game.events.off('ready', handleReady);
            game.events.off('CONVERSATION_UPDATE', handleConversationUpdate);
            game.events.off('TOPICS_READY', handleTopicsReady);
            game.events.off('QUESTION_READY', handleQuestionReady);
            game.events.off('GAME_STATE_UPDATE', handleGameStateUpdate);
            game.events.off('GUESS_PROCESSED', handleGuessProcessed);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 2. Communication React -> Phaser (Calling methods on the Scene)
    const handleTopicClick = (topic) => {
        if (sceneRef.current && uiState.phase === 'topic_select') {
            setUiState(prev => ({ 
                ...prev, 
                phase: 'loading', 
                message: `Topic ${topic} selected. Loading challenge...` 
            })); 
            // Call the exposed method on the Phaser scene instance
            sceneRef.current.handleTopicSelection(topic);
        }
    };

    const handleAnswerClick = (guess) => {
        if (sceneRef.current && uiState.phase === 'quiz' && uiState.correctAnswer === null) {
              setUiState(prev => ({ ...prev, lastGuess: guess })); 
              sceneRef.current.processPlayerGuess(guess);
        }
    };
    
    const handleContinueClick = () => {
        if (sceneRef.current && uiState.phase === 'quiz_result') {
            setUiState(prev => ({ 
                ...prev, 
                phase: 'loading', 
                message: 'Conductor is preparing the next round...' 
            })); 
            sceneRef.current.startNextRound();
        }
    }

    // Get image props based on current state
    const conductorProps = getConductorImageProps(uiState);
    const characterProps = getCharacterImageProps(uiState);

    return (
        <div className="flex flex-col md:flex-row items-stretch justify-center p-4 w-full min-h-screen bg-gray-900 font-sans text-white">
            
            {/* 1. Conductor Panel (Left) */}
            <div className="md:w-1/5 w-full bg-gray-800/80 p-6 rounded-l-xl shadow-2xl border-r border-gray-700 flex flex-col items-center justify-start space-y-6 z-10">
                <h3 className="text-2xl font-bold text-red-400 mb-2">Host</h3>
                <img 
                    src={conductorProps.imageSrc} 
                    alt="The Conductor" 
                    className={conductorProps.style + " w-36 h-36 bg-gray-900"}
                    onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/150x150/1e293b/f8fafc?text=Host" }}
                />
                <h4 className="text-lg font-semibold text-red-300">{conductorProps.conductorTitle}</h4>
                <p className={conductorProps.messageStyle + " w-full h-24 overflow-y-auto text-sm md:text-base"}>
                    {uiState.message}
                </p>
                
                <div className="text-center mt-auto">
                    <p className="text-lg text-gray-400">Difficulty:</p>
                    <p className="text-xl font-extrabold text-yellow-400">{uiState.difficulty}</p>
                    <p className="text-sm text-gray-500 mt-2">
                        User ID: <span className="text-xs break-all">{uiState.userId || '...'}</span>
                    </p>
                </div>
            </div>

            {/* 2. Game Center (Phaser Canvas + Buttons) */}
            <div className="md:w-3/5 w-full bg-gray-700/90 p-6 shadow-2xl flex flex-col items-center space-y-4 z-10">
                <h1 className="text-4xl font-extrabold text-teal-400 mb-4">
                    Music Trivia Challenge
                </h1>

                {/* The Phaser Canvas Component */}
                <PhaserGame setUiState={setUiState} />

                {/* Status/Score Area */}
                <div className="flex justify-between w-full max-w-[600px] p-3 text-xl font-bold rounded-lg bg-gray-900/70 border border-gray-700">
                    <span className="text-green-400">Score: {uiState.score}</span>
                    {uiState.phase === 'quiz_result' && (
                        <span className={uiState.isCorrect ? "text-green-500" : "text-red-500"}>
                            {uiState.scoreAdjustment > 0 ? `+${uiState.scoreAdjustment} Points!` : `${uiState.scoreAdjustment} Points!`}
                        </span>
                    )}
                    <span className="text-purple-400">Tone: {uiState.tone}</span>
                </div>
                
                {/* Interaction Area (Topics/Answers/Continue) */}
                <div className="mt-4 p-4 rounded-lg w-full max-w-[600px] z-20">
                    
                    {/* LOADING PHASE */}
                    {uiState.phase === 'loading' && (
                        <p className="text-center text-xl text-yellow-500 animate-pulse">
                            {uiState.message}
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
                    {uiState.phase === 'quiz' && uiState.options.length > 0 && (
                        <>
                            <p className="text-xl mb-4 p-3 bg-gray-900/70 rounded-lg text-center font-semibold">{uiState.question}</p>
                            <div className="grid grid-cols-2 gap-4 w-full">
                                {uiState.options.map(option => {
                                    let buttonClasses = "px-4 py-3 text-lg font-medium rounded-xl transition-all duration-300 shadow-lg text-white";
                                    
                                    const isPlayerGuess = uiState.lastGuess === option;
                                    
                                    if (uiState.lastGuess !== null) {
                                        // Once a guess is made, disable and highlight
                                        buttonClasses += isPlayerGuess ? " bg-yellow-500/80 scale-95 cursor-default" : " bg-gray-600/50 cursor-default";
                                    } else {
                                        // Default quiz button style
                                        buttonClasses += " bg-blue-500 hover:bg-blue-600";
                                    }

                                    return (
                                        <button
                                            key={option}
                                            onClick={() => uiState.lastGuess === null && handleAnswerClick(option)}
                                            disabled={uiState.lastGuess !== null}
                                            className={buttonClasses}
                                        >
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    
                    {/* QUIZ RESULT PHASE (Highlight + Continue) */}
                    {uiState.phase === 'quiz_result' && uiState.options.length > 0 && (
                        <>
                            <p className="text-xl mb-4 p-3 bg-gray-900/70 rounded-lg text-center font-semibold">{uiState.question}</p>
                            <div className="grid grid-cols-2 gap-4 w-full">
                                {uiState.options.map(option => {
                                    let buttonClasses = "px-4 py-3 text-lg font-medium rounded-xl transition-all duration-300 shadow-lg cursor-default";
                                    
                                    const isCorrectAnswer = option === uiState.correctAnswer;
                                    const isPlayerGuess = option === uiState.lastGuess;
                                    
                                    if (isCorrectAnswer) {
                                        buttonClasses += " bg-green-600 text-white border-2 border-green-300 transform scale-105";
                                    } else if (isPlayerGuess) {
                                        buttonClasses += " bg-red-600 text-white border-2 border-red-300 opacity-80";
                                    } else {
                                        buttonClasses += " bg-gray-600 text-gray-300 opacity-50";
                                    }

                                    return (
                                        <button
                                            key={option}
                                            disabled={true}
                                            className={buttonClasses}
                                        >
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="text-center mt-6">
                                <button
                                    onClick={handleContinueClick}
                                    className="px-8 py-3 bg-teal-500 text-white text-xl font-extrabold rounded-xl shadow-2xl
                                               hover:bg-teal-600 transition-all duration-200 transform hover:scale-105"
                                >
                                    Continue to Next Round
                                </button>
                            </div>
                        </>
                    )}

                </div>
            </div>
            
            {/* 3. Character Panel (Right) */}
            <div className="md:w-1/5 w-full bg-gray-800/80 p-6 rounded-r-xl shadow-2xl border-l border-gray-700 flex flex-col items-center justify-start space-y-6 z-10">
                <h3 className="text-2xl font-bold text-blue-400 mb-2">You (The Player)</h3>
                <img 
                    src={characterProps.imageSrc} 
                    alt="Player Character" 
                    className={characterProps.style + " w-36 h-36 bg-gray-900"}
                    onError={(e) => { e.target.onerror = null; e.target.src = "https://placehold.co/150x150/374151/f8fafc?text=Player" }}
                />
                
                <div className="text-center mt-auto">
                    <p className="text-lg text-gray-400">Progress to 1000:</p>
                    <div className="w-full h-6 bg-gray-900 rounded-full mt-2 overflow-hidden border-2 border-gray-600">
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

// Global script block for loading external libraries
// Note: In a real environment, these imports would be handled by the build system.
// Here, we load them dynamically for the single-file immersive.
if (typeof window.Phaser === 'undefined' || typeof window.ReactDOM === 'undefined') {
    const phaserScript = document.createElement('script');
    phaserScript.src = 'https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js';
    document.head.appendChild(phaserScript);

    const reactScript = document.createElement('script');
    reactScript.src = 'https://unpkg.com/react@18/umd/react.development.js';
    document.head.appendChild(reactScript);

    const reactDomScript = document.createElement('script');
    reactDomScript.src = 'https://unpkg.com/react-dom@18/umd/react-dom.development.js';
    document.head.appendChild(reactDomScript);

    phaserScript.onload = () => {
        reactDomScript.onload = () => {
            const root = document.getElementById('root');
            if (root) {
                ReactDOM.createRoot(root).render(<App />);
            } else {
                console.error("Root element not found.");
            }
        };
    };
} else {
    // If libraries are already loaded (e.g., in a development environment)
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}