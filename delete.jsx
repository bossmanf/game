import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, where, getDocs, updateDoc, onSnapshot } from 'firebase/firestore';

const { useEffect, useState, useRef, useCallback } = React;

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
};

let llmInference = null;


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
                console.log("Starting LLM initialization...");
                this.llmInitializedPromise = initializeLLM(); 
                console.log("LLM initialization started.");
            }

            create() {
                // Set the game background color (visually hidden by React container)
                this.cameras.main.setBackgroundColor('#1f2937');
                
                // Expose a public method to React to handle topic selection
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').handleTopicSelection = this.handleTopicSelection.bind(this);
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').processPlayerGuess = this.processPlayerGuess.bind(this);

                // Wait for the Firebase Auth to be ready before calling LLM
                if (dbReady) {
                    await this.llmInitializedPromise;
                    console.log("LLM successfully initialized. Game starting.");
                    this.getTopics();

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


            // --- GAME FLOW LOGIC ---
            
            async initializeLLM() {
                this.updateReactState({ loading: false, message: "Initializing LLM..." });
               
                try {
                    const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

                    // Callback function to update model loading progress
                    const initProgressCallback = (initProgress) => {
                        console.log(initProgress);
                    }

                    const MODEL_NAME = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC"
                    
                    llmInference = await CreateMLCEngine(
                        MODEL_NAME,
                        { initProgressCallback: initProgressCallback }, // engineConfig
                    );

                    console.log('Model loaded!');
                    console.log(`WebLLM Model (${MODEL_NAME}) Loaded and ready for client-side inference.`);

                } catch (e) {
                    console.error("Failed to initialize WebLLM or load model weights. Check WebGPU support.", e);
                    throw new Error("Initialization failed: Could not load WebLLM AI system.");
                }
                
            }


            

            async getTopics() {
                

                topics = ['a', 'b'];
                console.log("Topics successfully parsed and ready:", topics);
                this.game.events.emit('TOPICS_READY', { topics: topics });
                    

            }

            async handleTopicSelection(topic) {
                // Game logic to transition to quiz phase
                this.selectedTopic = topic;
                this.getNewQuestion(topic);
            }


            async getNewQuestion(topic) {
                
                try {
                    this.updateReactState({ message: `Generating question on ${topic}...` });
        
                    this.game.events.emit('QUESTION_READY', 'question');
                    this.currentQuestionData = 'question ready'
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

                
                await this.saveGameState();
                
                // Get commentary from LLM
                await this.getConductorCommentary(isCorrect, guess, this.currentQuestionData, scoreAdjustment);
            }
            
            async getConductorCommentary(isCorrect, playerGuess, questionData, scoreAdjustment) {
                const resultText = isCorrect ? "correct" : "incorrect";
                const sentiment = isCorrect ? "positive and encouraging" : "sympathetic but firm";
                const nextAction = this.currentScore >= 1000 ? "congratulate the player on winning" : "ask the player to continue to the next question";
                
                
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