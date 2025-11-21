import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// Note: React, ReactDOM, and Phaser are assumed to be globally available or injected by the environment.

const { useEffect, useState, useCallback, useRef, createElement: E } = React;

// --- Global Variables & Constants (MUST be used) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

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
    appPhase: 'welcome', // welcome | game
    conductorComment: '',
};

let llmInference = null; // Global variable for the WebLLM engine

// --- Core App Component ---

const App = () => {
    const [uiState, setUiState] = useState(initialUIState);
    const phaserRef = useRef(null);
    const dbRef = useRef(null);
    const authRef = useRef(null);

    // Dynamic Script Loader for Phaser and WebLLM (required as they are not standard imports)
    useEffect(() => {
        // Load Phaser
        if (!window.Phaser && !document.querySelector('script[src*="phaser.min.js"]')) {
            const phaserScript = document.createElement('script');
            phaserScript.src = 'https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js';
            phaserScript.onload = () => console.log('Phaser loaded.');
            document.head.appendChild(phaserScript);
        }
    }, []);

    // Effect for Firebase initialization and Auth
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            setUiState(prev => ({ ...prev, message: "Firebase config missing. Cannot initialize.", loading: false }));
            return;
        }

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        dbRef.current = db;
        authRef.current = auth;

        const handleAuth = async () => {
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (e) {
                console.error("Auth failed:", e);
                await signInAnonymously(auth); // Fallback
            }
        };

        let unsubscribe = () => {};

        handleAuth().then(() => {
            unsubscribe = onAuthStateChanged(auth, (user) => {
                const currentUserId = user?.uid || crypto.randomUUID();
                setUiState(prev => ({
                    ...prev,
                    userId: currentUserId,
                    isAuthReady: true,
                    message: "Authentication complete. Starting game...",
                }));
                console.log(`User authenticated: ${currentUserId}`);
            });
        });

        return () => unsubscribe();
    }, []);


    // Effect for handling events from Phaser to React
    useEffect(() => {
        if (!window.phaserGameInstance) return;

        const gameEvents = window.phaserGameInstance.events;

        const updateStateListener = (data) => {
            setUiState(prev => ({ ...prev, ...data }));
        };

        const questionReadyListener = (data) => {
            setUiState(prev => ({
                ...prev,
                question: data.question,
                options: data.options,
                correctAnswer: data.correct_answer,
                message: data.comment,
                phase: 'quiz',
                loading: false,
                lastGuess: null,
                isCorrect: null,
                scoreAdjustment: 0,
                conductorComment: '',
            }));
        };

        const topicsReadyListener = (data) => {
            setUiState(prev => ({
                ...prev,
                topics: data.topics,
                message: "Conductor: Select your genre for the next round!",
                phase: 'topic_select',
                loading: false,
                lastGuess: null,
                isCorrect: null,
                scoreAdjustment: 0,
                conductorComment: '',
            }));
        };

        // This listener is crucial for updating the state after a guess and commentary is ready
        const finalUpdateListener = (data) => {
            setUiState(prev => ({ 
                ...prev, 
                score: data.score,
                difficulty: data.difficulty,
                tone: data.conversation_tone,
                message: data.conductorComment,
                phase: data.phase, // 'quiz_result'
                isCorrect: data.isCorrect,
                scoreAdjustment: data.scoreAdjustment,
                loading: false,
            }));
        };

        gameEvents.on('GAME_STATE_UPDATE', finalUpdateListener);
        gameEvents.on('QUESTION_READY', questionReadyListener);
        gameEvents.on('TOPICS_READY', topicsReadyListener);

        return () => {
            gameEvents.off('GAME_STATE_UPDATE', finalUpdateListener);
            gameEvents.off('QUESTION_READY', questionReadyListener);
            gameEvents.off('TOPICS_READY', topicsReadyListener);
        };
    }, [uiState.isAuthReady]); // Re-run effect when auth status changes

    // --- Public Handlers for UI to talk to Phaser/Game Scene ---

    const handleTopicClick = useCallback((topic) => {
        if (!phaserRef.current || uiState.phase !== 'topic_select') return;
        setUiState(prev => ({ ...prev, loading: true, message: `Starting round on ${topic}...` }));
        
        // Call the public method exposed by the Phaser scene
        const scene = phaserRef.current.scene.getScene('MusicTriviaScene');
        if (scene && scene.handleTopicSelection) {
            scene.handleTopicSelection(topic);
        }
    }, [uiState.phase]);

    const handleAnswerClick = useCallback((answer) => {
        if (!phaserRef.current || uiState.phase !== 'quiz') return;
        setUiState(prev => ({ ...prev, loading: true, message: "Processing your answer..." }));
        
        // Call the public method exposed by the Phaser scene
        const scene = phaserRef.current.scene.getScene('MusicTriviaScene');
        if (scene && scene.processPlayerGuess) {
            scene.processPlayerGuess(answer);
        }
    }, [uiState.phase]);

    const handleContinueClick = useCallback(() => {
        if (!phaserRef.current || uiState.phase !== 'quiz_result') return;
        setUiState(prev => ({ ...prev, loading: true, message: "Preparing next round..." }));
        
        // Call the public method exposed by the Phaser scene
        const scene = phaserRef.current.scene.getScene('MusicTriviaScene');
        if (scene && scene.startNextRound) {
            scene.startNextRound();
        }
    }, [uiState.phase]);

    // --- LLM Logic (Kept outside Scene class for cleaner separation) ---

    const initializeLLM = useCallback(async () => {
        setUiState(prev => ({ ...prev, loading: true, message: "Initializing LLM (WebLLM)..." }));
        
        try {
            // Check if WebLLM is already loaded
            if (!llmInference) {
                const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

                const initProgressCallback = (initProgress) => {
                    console.log(initProgress);
                    setUiState(prev => ({ ...prev, message: `LLM Loading: ${initProgress.text}` }));
                };

                const MODEL_NAME = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC"
                
                llmInference = await CreateMLCEngine(
                    MODEL_NAME,
                    { initProgressCallback: initProgressCallback },
                );
            }

            console.log(`WebLLM Model Loaded and ready for client-side inference.`);
            return true;
        } catch (e) {
            console.error("Failed to initialize WebLLM or load model weights. Check WebGPU support.", e);
            setUiState(prev => ({ ...prev, message: "LLM Initialization failed. See console.", loading: false }));
            return false;
        }
    }, [setUiState]);

    const runLLM_API_Call = async (prompt, schemaName = "UNKNOWN_SCHEMA") => {
        if (!llmInference) {
            throw new Error("LLM not initialized.");
        }

        const messages = [{ role: "user", content: prompt}];

        let fullResponseText = "";
        
        // Call the chat.completions.create method with stream: true
        const stream = await llmInference.chat.completions.create({
            messages: messages,
            stream: true,
            temperature: 0.3
        });

        // Process the streaming output
        for await (const chunk of stream) {
            const content = chunk.choices[0].delta.content;
            if (content) {
                fullResponseText += content;
            }
        }
        
        // --- Start Robust JSON Cleaning & Parsing (Essential for WebLLM) ---
        let jsonString = fullResponseText.trim();
        
        // 1. Find the first opening curly brace '{'
        const firstBracketIndex = jsonString.indexOf('{');
        if (firstBracketIndex > -1) {
            jsonString = jsonString.substring(firstBracketIndex);
        } else {
            // If no JSON object is found, return the raw text (used for commentary)
            if (schemaName === '') return fullResponseText;
            throw new Error(`LLM Output for ${schemaName} did not contain a JSON start bracket '{'.`);
        }

        // 2. Find the last closing curly brace '}'
        let lastBracketIndex = jsonString.lastIndexOf('}');
        if (lastBracketIndex > -1) {
            jsonString = jsonString.substring(0, lastBracketIndex + 1);
        }
        
        // 3. Remove trailing markdown fences (e.g., ```)
        if (jsonString.endsWith('```')) {
            jsonString = jsonString.substring(0, jsonString.lastIndexOf('```')).trim();
        }
        
        // 4. Final check for non-JSON characters
        while (jsonString.endsWith('.') || jsonString.endsWith('\n')) {
            jsonString = jsonString.slice(0, -1).trim();
        }
        
        try {
            const result = JSON.parse(jsonString);
            return result;

        } catch (e) {
            console.error(`Failed to parse cleaned JSON string for ${schemaName}:`, jsonString, e); 
            throw new Error(`Failed to parse LLM output for ${schemaName}. Raw string was: ${fullResponseText}`);
        }
    }

    // --- Phaser Game Component (The core game logic runner) ---

    const PhaserGame = ({ db, auth, userId, setUiState, initializeLLM, runLLM_API_Call, phaserRef }) => {
        // Use a ref to ensure we only initialize Phaser once
        const gameInitialized = useRef(false); 

        // Function to handle the full initialization sequence
        const initGameSequence = useCallback(async (userId, scene) => {
            if (!scene || !userId) return;

            // 1. Load/Create Game State
            await scene.loadOrCreateGameState(userId);

            // 2. Initialize LLM
            const llmReady = await initializeLLM();

            if (llmReady) {
                // 3. Get Topics
                scene.getTopics();
            }

        }, [initializeLLM]); // Dependency on memoized initializeLLM


        useEffect(() => {
            if (!window.Phaser || !userId || !db || !auth || gameInitialized.current) {
                // Wait for Phaser to load and Auth/DB to be ready
                if (window.Phaser && userId && db && auth) {
                    console.log("Phaser loaded and Auth ready. Starting init sequence...");
                }
                return;
            }
            
            // --- Scene Definition (The core game logic) ---
            class MusicTriviaScene extends window.Phaser.Scene {
                constructor() {
                    super('MusicTriviaScene');
                    this.conversationTone = 'Normal';
                    this.currentScore = 0;
                    this.difficultyLevel = 'Very Easy';
                    this.gameDataRef = null;
                    this.currentQuestionData = null;
                    this.selectedTopic = '';

                    // Expose utility functions for the scene to use
                    this.db = db;
                    this.setUiState = setUiState;
                    this.runLLM_API_Call = runLLM_API_Call;
                }

                preload() {
                    // No assets for this simple trivia app
                }

                create() {
                    this.cameras.main.setBackgroundColor('#1f2937');
                    
                    // Expose the scene instance publicly via the phaserRef for React to access methods
                    phaserRef.current = this.game; 

                    // Ensure the initial sequence runs after the scene is created
                    initGameSequence(userId, this);
                }
                
                // --- FIREBASE AND STATE MANAGEMENT (Internal to Scene) ---
                async loadOrCreateGameState(currentUserId) {
                    const userDocRef = doc(this.db, 'artifacts', appId, 'users', currentUserId, 'gameState', 'trivia');
                    this.gameDataRef = userDocRef;

                    try {
                        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
                            if (docSnap.exists()) {
                                const data = docSnap.data();
                                this.currentScore = data.score || 0;
                                this.difficultyLevel = data.difficulty || 'Very Easy';
                                this.conversationTone = data.tone || 'Normal';
                                
                                // Update React's UI state immediately on change
                                this.updateReactState({ 
                                    score: this.currentScore,
                                    difficulty: this.difficultyLevel,
                                    tone: this.conversationTone,
                                });
                            } else {
                                // Create initial state if document doesn't exist
                                setDoc(userDocRef, {
                                    score: 0,
                                    difficulty: 'Very Easy',
                                    tone: 'Normal',
                                    questionsAnswered: 0,
                                    lastUpdated: new Date().toISOString()
                                });
                            }
                        }, (error) => {
                            console.error("Error listening to game state:", error);
                        });
                        
                        // Store the unsubscribe function if needed for cleanup, though this is a long-lived component
                        this.unsubscribeSnapshot = unsubscribe;
                        this.updateReactState({ message: "Game state loaded." });

                    } catch (error) {
                        console.error("Error setting up game state listener:", error);
                    }
                }

                async saveGameState() {
                    if (!this.gameDataRef) return;
                    await updateDoc(this.gameDataRef, {
                        score: this.currentScore,
                        difficulty: this.difficultyLevel,
                        tone: this.conversationTone,
                        lastUpdated: new Date().toISOString()
                    }).catch(e => console.error("Error saving game state:", e));
                }
                
                updateReactState(additionalState = {}) {
                    this.setUiState(prev => ({ ...prev, ...additionalState }));
                }

                // --- LLM GAME FLOW ---
                
                async getTopics() {
                    // LLM call to get topics is omitted here to reduce load time/cost on the simple WebLLM model
                    const arr = [
                    "80s Music", "90s Music", "Heavy Rock", "Punk Rock", "Pop Music", "Music (anything goes)", "International Cuisine", 
                    "Travel", "Famous Capitals", "Sports in San Francisco", "U2", "Gay Pop Culture", "Metallica", "Cinema Entertainment",
                    "Email Marketting", "Wresting", "Geography", "Science", "Arabic language", "Iraq", "Spain", "Granada", "Liverpool", 
                    "Big Bear California", "New York City", "Diversity and Justice", "Salesforce", "Living in the Bay Area", "Gay Lifestyle", 
                    "Living in Spain", "California Lifestyle", "Karl the Fog", "Travel Culture", "International Destinations", 
                    "Wrestling Icons", "Happiness", "Hardly Strictly Bluegrass", "Beenies", "Black Color", "Music Venues", 
                    "Music Venues in San Francisco", "Classic Rock", "Hip-Hop", "World Music", "Indie Music", "Alternative Music", 
                    "Habibi", "Softball", "FIFA videogame", "Gummies", "Inner Sunset San Francisco", "San Jose California", 
                    "Famous Concerts", "California", "Boardgames", "Guitars", "Bay Area", "Liverpool FC", "History", 
                    "Modern Comedians", "San Francisco culture"
                    ];
                    
                    const length = arr.length;
                    let index1 = Math.floor(Math.random() * length);
                    let index2;

                    do {
                        index2 = Math.floor(Math.random() * length);
                    } while (index1 === index2);

                    const topics = [arr[index1], arr[index2]];
                    
                    this.game.events.emit('TOPICS_READY', { topics: topics });
                }

                async handleTopicSelection(topic) {
                    this.selectedTopic = topic;
                    this.getNewQuestion(topic);
                }

                async getNewQuestion(topic) {
                    const difficultyMap = {
                        'Very Easy': 'a simple, 1-point question',
                        'Easy': 'a slightly harder, 2-point question',
                        'Normal': 'a moderate, 3-point question',
                        'Hard': 'a difficult, 5-point question',
                        'Impossible': 'an extremely obscure, 10-point question'
                    };

                    const systemPrompt = `You are the conductor of a music trivia quiz. The player's current difficulty is ${this.difficultyLevel} (Score: ${this.currentScore}). Your conversation tone is currently ${this.conversationTone}. 
                    Generate one multiple-choice question about the topic: "${topic}". The question should be ${difficultyMap[this.difficultyLevel]}.
                    
                    The response MUST be a JSON object with the following structure:
                    {
                        "question": "The trivia question text.",
                        "options": ["Option A", "Option B", "Option C", "Option D"],
                        "correct_answer": "The text of the correct option (must match one of the options).",
                        "comment": "A brief, encouraging comment from the conductor about starting the quiz."
                    }
                    
                    DO NOT include any commentary outside the JSON object.`;

                    try {
                        this.updateReactState({ loading: true, message: `Generating question on ${topic}...` });
                        const parsedJson = await this.runLLM_API_Call(systemPrompt, 'QuestionSchema');
                        
                        if (parsedJson.question && parsedJson.options && parsedJson.correct_answer) {
                            this.game.events.emit('QUESTION_READY', parsedJson);
                            this.currentQuestionData = parsedJson;
                        } else {
                            throw new Error("LLM question response was malformed.");
                        }
                    } catch (e) {
                        console.error("Failed to generate or parse question:", e);
                        this.game.events.emit('GAME_STATE_UPDATE', { 
                            message: "Apologies, I hit a snag getting the question. Let's try again.",
                            phase: 'topic_select'
                        });
                        this.getTopics(); // Revert to topic selection
                    }
                }

                async processPlayerGuess(guess) {
                    if (!this.currentQuestionData) return;
                    
                    const correctAnswer = this.currentQuestionData.correct_answer;
                    const isCorrect = guess === correctAnswer;
                    
                    let points = 0;
                    switch (this.difficultyLevel) {
                        case 'Very Easy': points = isCorrect ? 50 : -25; break;
                        case 'Easy': points = isCorrect ? 100 : -50; break;
                        case 'Normal': points = isCorrect ? 200 : -100; break;
                        case 'Hard': points = isCorrect ? 400 : -200; break;
                        case 'Impossible': points = isCorrect ? 800 : -400; break;
                    }
                    
                    // Update internal score and difficulty/tone (logic to change difficulty/tone omitted for simplicity)
                    this.currentScore += points;
                    
                    await this.saveGameState();
                    
                    // Get commentary from LLM (using simple string output, schemaName='')
                    await this.getConductorCommentary(isCorrect, guess, this.currentQuestionData, points);
                }
                
                async getConductorCommentary(isCorrect, playerGuess, questionData, scoreAdjustment) {
                    const resultText = isCorrect ? "correct" : "incorrect";
                    const nextAction = this.currentScore >= 1000 ? "congratulate the player on winning the game" : "ask the player to continue to the next question";
                    
                    const systemPrompt = `You are the conductor of a music trivia quiz with a ${this.conversationTone} tone. The player just guessed the answer and was ${resultText}. Their score changed by ${scoreAdjustment}. The question was: "${questionData.question}". The correct answer was "${questionData.correct_answer}".
                    
                    Your response MUST be a single paragraph of text (under 50 words) that:
                    1. Acknowledges the result.
                    2. Matches your current tone (${this.conversationTone}).
                    3. Performs the next action: ${nextAction}.`;
                    
                    try {
                        // Use runLLM_API_Call with empty schemaName to get raw text
                        const conductorComment = await this.runLLM_API_Call(systemPrompt, '');
                        
                        this.game.events.emit('GAME_STATE_UPDATE', { 
                            score: this.currentScore, 
                            difficulty: this.difficultyLevel,
                            tone: this.conversationTone,
                            phase: 'quiz_result',
                            isCorrect: isCorrect,
                            scoreAdjustment: scoreAdjustment,
                            conductorComment: conductorComment || (isCorrect ? "Excellent! Ready for the next one?" : "Unlucky! Let's try again."),
                        });
                    } catch (e) {
                        console.error("Failed to get commentary:", e);
                         this.game.events.emit('GAME_STATE_UPDATE', { 
                            score: this.currentScore, 
                            difficulty: this.difficultyLevel,
                            tone: this.conversationTone,
                            phase: 'quiz_result',
                            isCorrect: isCorrect,
                            scoreAdjustment: scoreAdjustment,
                            conductorComment: isCorrect ? "Excellent! Ready for the next one?" : "Unlucky! Let's try again.",
                        });
                    }
                }
                
                startNextRound() {
                    if (this.currentScore >= 1000) {
                        this.updateReactState({ 
                            message: "Congratulations! You have mastered the Music Trivia Challenge!",
                            phase: 'loading' // Game end state
                        });
                        return; 
                    }
                    
                    this.getTopics(); // Back to topic selection
                }

                // Clean up listener when scene is shut down (Phaser handles this, but good practice)
                shutdown() {
                    if (this.unsubscribeSnapshot) {
                        this.unsubscribeSnapshot();
                    }
                }

            } // End of MusicTriviaScene

            // --- Phaser Game Initialization ---
            gameInitialized.current = true;
            const config = {
                type: window.Phaser.AUTO,
                width: 800, // Adjusted for better screen layout
                height: 500, // Adjusted for better screen layout
                parent: 'phaser-container',
                scene: MusicTriviaScene,
                backgroundColor: '#1f2937',
            };

            const game = new window.Phaser.Game(config);
            phaserRef.current = game;
            window.phaserGameInstance = game; // Make it globally accessible for event listeners
            
            return () => {
                // Cleanup Phaser instance on component unmount (if necessary, though in this environment it often persists)
                // if (game) game.destroy(true);
            };

        }, [uiState.isAuthReady, userId, dbRef.current, authRef.current, initGameSequence]); // Dependencies on auth status and Firebase instances


        return (
            // The container where the Phaser canvas will be injected
            <div 
                id="phaser-container" 
                className="w-full max-w-2xl aspect-[8/5] border-4 border-red-500 rounded-xl shadow-inner shadow-red-500/50 overflow-hidden bg-black flex items-center justify-center"
            >
                {/* The canvas renders here */}
                {(!window.Phaser || !userId || !db || !auth) && (
                     <div className="text-white text-center p-8">
                        <svg className="animate-spin h-10 w-10 text-red-500 mx-auto mb-3" xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-lg">Initializing Game...</p>
                    </div>
                )}
            </div>
        );
    };

    // --- Welcome Screen Component ---
    const WelcomeScreen = ({ onStartGame }) => (
        <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-black bg-opacity-95 z-50 p-4 transition-opacity duration-500 ease-out">
            <div className="bg-gray-900 p-8 rounded-xl shadow-2xl max-w-4xl w-full text-center border-4 border-red-500">
                <h1 className="text-4xl md:text-6xl font-extrabold text-red-400 mb-8 music-font">
                    Hassansational Trivia Challenge!
                </h1>
                
                {/* Placeholder Image Section */}
                <div className="mx-auto w-11/12 md:w-2/3 mb-10 border-4 border-yellow-500 rounded-lg overflow-hidden shadow-xl">
                    <img 
                        src="[https://placehold.co/1200x600/dc2626/f8fafc?text=HASSANSATIONAL+MUSIC](https://placehold.co/1200x600/dc2626/f8fafc?text=HASSANSATIONAL+MUSIC)"
                        alt="Music Hall Stage" 
                        className="w-full h-auto object-cover"
                    />
                </div>

                {/* New Game Button */}
                <button 
                    onClick={onStartGame}
                    className="music-font text-4xl md:text-5xl px-12 py-4 bg-gradient-to-r from-teal-500 to-green-600 text-white rounded-full shadow-2xl 
                            hover:from-teal-600 hover:to-green-700 transform hover:scale-105 transition-all duration-300 
                            ring-4 ring-red-500 ring-offset-4 ring-offset-gray-900"
                >
                    Start Challenge
                </button>
            </div>
        </div>
    );

    // --- Image and Style Logic ---

    const getConductorImageProps = (state) => {
        let style = "border-4 shadow-xl p-2 rounded-full transform transition-all duration-300";
        let messageStyle = "text-xl font-bold text-center p-3 rounded-lg";
        let conductorTitle = "The Conductor";
        let imageSrc = "[https://placehold.co/150x150/1e293b/f8fafc?text=Host](https://placehold.co/150x150/1e293b/f8fafc?text=Host)"; // Default host image

        switch (state.tone) {
            case 'Excited':
                style += " border-green-500 scale-105";
                messageStyle += " bg-green-900/50 text-green-300";
                conductorTitle = "The Conductor (Thrilled!)";
                imageSrc = "[https://placehold.co/150x150/16a34a/f8fafc?text=EXCITED](https://placehold.co/150x150/16a34a/f8fafc?text=EXCITED)";
                break;
            case 'Sassy':
                style += " border-pink-500 rotate-1 ";
                messageStyle += " bg-pink-900/50 text-pink-300";
                conductorTitle = "The Conductor (Sassy)";
                imageSrc = "[https://placehold.co/150x150/db2777/f8fafc?text=SASSY](https://placehold.co/150x150/db2777/f8fafc?text=SASSY)";
                break;
            case 'Challenging':
                style += " border-red-500 scale-95";
                messageStyle += " bg-red-900/50 text-red-300";
                conductorTitle = "The Conductor (Challenging!)";
                imageSrc = "[https://placehold.co/150x150/dc2626/f8fafc?text=CHALLENGE](https://placehold.co/150x150/dc2626/f8fafc?text=CHALLENGE)";
                break;
            case 'Normal':
            default:
                style += " border-teal-500";
                messageStyle += " bg-teal-900/50 text-teal-300";
                imageSrc = "[https://placehold.co/150x150/0f766e/f8fafc?text=HOST](https://placehold.co/150x150/0f766e/f8fafc?text=HOST)";
                break;
        }
        
        return { style, messageStyle, conductorTitle, imageSrc };
    };

    const getCharacterImageProps = (state) => {
        let style = "border-4 shadow-xl p-2 rounded-full transform transition-all duration-300";
        let imageSrc = "[https://placehold.co/150x150/374151/f8fafc?text=Player](https://placehold.co/150x150/374151/f8fafc?text=Player)";

        if (state.phase === 'quiz_result') {
            if (state.isCorrect) {
                style += " border-green-500 scale-110 shadow-green-500/50";
                imageSrc = "[https://placehold.co/150x150/10b981/f8fafc?text=CORRECT](https://placehold.co/150x150/10b981/f8fafc?text=CORRECT)!";
            } else {
                style += " border-red-500 scale-90 shadow-red-500/50";
                imageSrc = "[https://placehold.co/150x150/ef4444/f8fafc?text=WRONG](https://placehold.co/150x150/ef4444/f8fafc?text=WRONG)!";
            }
        } else {
            style += " border-blue-500";
            imageSrc = `https://placehold.co/150x150/3b82f6/f8fafc?text=LVL%20${state.difficulty.substring(0,1).toUpperCase()}`;
        }

        return { style, imageSrc };
    };
    
    // --- Game UI Component ---
    const GameUI = ({ uiState, handleTopicClick, handleAnswerClick, handleContinueClick }) => {
        const conductorProps = getConductorImageProps(uiState);
        const playerProps = getCharacterImageProps(uiState);

        const StatusBar = () => (
            <div className="bg-gray-800 p-4 rounded-xl mb-4 flex flex-wrap justify-between items-center text-sm font-mono shadow-lg border-b-2 border-red-500 w-full">
                <div className="flex space-x-6">
                    <p className="text-yellow-400">Score: <span className="text-white font-bold text-lg">{uiState.score}</span></p>
                    <p className="text-red-400">Difficulty: <span className="text-white font-bold">{uiState.difficulty}</span></p>
                    <p className="text-teal-400">Tone: <span className="text-white font-bold">{uiState.tone}</span></p>
                </div>
                <p className="text-gray-500 truncate max-w-[200px] mt-2 md:mt-0" title={`User ID: ${uiState.userId}`}>User: {uiState.userId || 'Connecting...'}</p>
            </div>
        );

        const CommentaryBox = () => (
            <div className={`p-4 rounded-lg mb-4 text-center shadow-inner ${uiState.loading ? 'bg-blue-900/50' : 'bg-gray-700/70'} w-full`}>
                <p className="text-xl font-semibold text-white">{uiState.message}</p>
                {uiState.scoreAdjustment !== 0 && uiState.phase === 'quiz_result' && (
                    <p className={`text-2xl mt-2 font-extrabold transition-all duration-300 ${uiState.scoreAdjustment > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {uiState.scoreAdjustment > 0 ? `+${uiState.scoreAdjustment}` : uiState.scoreAdjustment} Points!
                    </p>
                )}
            </div>
        );

        const ContentArea = () => {
            switch (uiState.phase) {
                case 'loading':
                    return (
                        <div className="text-center text-white p-8">
                            <svg className="animate-spin h-10 w-10 text-red-500 mx-auto mb-3" xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="text-lg">{uiState.message}</p>
                        </div>
                    );

                case 'topic_select':
                    return (
                        <div className="p-6">
                            <h2 className="text-3xl font-bold text-yellow-400 mb-6 text-center">Choose Your Genre!</h2>
                            <div className="flex justify-center space-x-6">
                                {uiState.topics.map(topic => (
                                    <button
                                        key={topic}
                                        onClick={() => handleTopicClick(topic)}
                                        className="music-font text-2xl px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg transform hover:scale-105 transition duration-200 border-b-4 border-purple-800"
                                    >
                                        {topic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );

                case 'quiz':
                    return (
                        <div className="p-6">
                            <h2 className="text-2xl font-semibold text-white mb-6 text-center">{uiState.question}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {uiState.options.map((option, index) => (
                                    <button
                                        key={index}
                                        onClick={() => handleAnswerClick(option)}
                                        className="px-4 py-3 text-lg font-medium bg-gray-600 hover:bg-gray-500 text-white rounded-lg shadow-md transition duration-150 border-b-2 border-gray-400"
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );

                case 'quiz_result':
                    const isCorrect = uiState.isCorrect;
                    const resultStyle = isCorrect ? 'bg-green-900/70 border-green-500' : 'bg-red-900/70 border-red-500';
                    const resultText = isCorrect ? 'CORRECT!' : 'INCORRECT!';

                    return (
                        <div className={`p-6 rounded-xl border-4 shadow-2xl transition-all duration-300 ${resultStyle}`}>
                            <h2 className={`text-4xl font-extrabold text-center mb-4 ${isCorrect ? 'text-green-400' : 'text-red-400'} music-font`}>{resultText}</h2>
                            <p className="text-lg text-white mb-4">
                                The correct answer was: <span className="font-bold text-yellow-300">{uiState.correctAnswer}</span>
                            </p>
                            <button
                                onClick={handleContinueClick}
                                className="music-font w-full mt-4 text-2xl px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-full shadow-lg transform hover:scale-105 transition duration-200 border-b-4 border-teal-700"
                            >
                                Continue Challenge
                            </button>
                        </div>
                    );

                default:
                    return null;
            }
        };

        return (
            <div className="p-8 max-w-4xl w-full mx-auto bg-gray-900/90 rounded-2xl shadow-2xl border-4 border-red-500 my-8">
                <StatusBar />
                <div className="flex flex-col md:flex-row items-start justify-between mb-4 space-y-4 md:space-y-0 md:space-x-4">
                    
                    {/* Conductor Panel */}
                    <div className="w-full md:w-1/4 text-center p-3 bg-gray-800 rounded-xl border-2 border-teal-500/50">
                        <h3 className="text-xl font-bold mb-2 text-teal-400">{conductorProps.conductorTitle}</h3>
                        <img 
                            src={conductorProps.imageSrc} 
                            alt="Conductor Host" 
                            className={`mx-auto ${conductorProps.style}`} 
                            style={{ width: '100px', height: '100px' }}
                        />
                    </div>
                    
                    {/* Message Box */}
                    <div className="w-full md:w-1/2 p-0">
                        <CommentaryBox />
                    </div>

                    {/* Player Panel */}
                    <div className="w-full md:w-1/4 text-center p-3 bg-gray-800 rounded-xl border-2 border-blue-500/50">
                        <h3 className="text-xl font-bold mb-2 text-blue-400">The Player (You)</h3>
                        <img 
                            src={playerProps.imageSrc} 
                            alt="Player Icon" 
                            className={`mx-auto ${playerProps.style}`} 
                            style={{ width: '100px', height: '100px' }}
                        />
                    </div>
                </div>

                <div className="bg-gray-800 p-4 rounded-xl shadow-inner border-2 border-gray-700 w-full">
                    <PhaserGame 
                        db={dbRef.current} 
                        auth={authRef.current} 
                        userId={uiState.userId} 
                        setUiState={setUiState} 
                        initializeLLM={initializeLLM}
                        runLLM_API_Call={runLLM_API_Call}
                        phaserRef={phaserRef}
                    />
                    <div className="mt-4 bg-gray-900 p-4 rounded-lg">
                        <ContentArea />
                    </div>
                </div>
            </div>
        );
    };

    // --- Main App Logic ---

    const handleStartGame = () => {
        setUiState(prev => ({ 
            ...prev, 
            appPhase: 'game',
            message: "Awaiting game state and LLM initialization...",
            loading: true
        }));
    };

    return (
        <div className="music-app min-h-screen w-full flex items-center justify-center">
            <style>{`
                /* Injecting custom styles from the original index.html */
                .music-font {
                    font-family: 'Bangers', cursive;
                    letter-spacing: 2px;
                    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.4);
                }
                body {
                    /* Using a darker overlay background image for drama */
                    background: url('[https://placehold.co/1920x1080/000000/ffffff?text=STAGE+LIGHTS+BACKGROUND](https://placehold.co/1920x1080/000000/ffffff?text=STAGE+LIGHTS+BACKGROUND)') no-repeat center center fixed;
                    background-size: cover;
                    font-family: 'Inter', sans-serif;
                    color: #fff;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                }
                /* Use custom scrollbar for better visual integration */
                ::-webkit-scrollbar {
                    width: 8px;
                }
                ::-webkit-scrollbar-track {
                    background: #1f2937;
                }
                ::-webkit-scrollbar-thumb {
                    background: #dc2626;
                    border-radius: 4px;
                }
                ::-webkit-scrollbar-thumb:hover {
                    background: #f87171;
                }
            `}</style>
            
            {uiState.appPhase === 'welcome' && <WelcomeScreen onStartGame={handleStartGame} />}
            
            {uiState.appPhase === 'game' && uiState.isAuthReady && (
                <GameUI 
                    uiState={uiState} 
                    handleTopicClick={handleTopicClick} 
                    handleAnswerClick={handleAnswerClick} 
                    handleContinueClick={handleContinueClick}
                />
            )}
            
            {uiState.appPhase === 'game' && !uiState.isAuthReady && (
                <div className="text-center text-white p-8 bg-gray-900/90 rounded-xl shadow-2xl">
                    <p className="text-xl">Initializing services...</p>
                </div>
            )}
        </div>
    );
};

export default App;