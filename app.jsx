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
    appPhase: 'welcome',
};

let llmInference = null;


// --- Welcome Screen Component ---
const WelcomeScreen = ({ onStartGame }) => (
    // This div simulates the fixed welcome-screen overlay from the original HTML
    <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center bg-black bg-opacity-95 z-50 p-4 transition-opacity duration-500 ease-out">
        <div className="bg-gray-900 p-8 rounded-xl shadow-2xl max-w-4xl w-full text-center border-4 border-red-500">
            <h1 className="text-4xl md:text-6xl font-extrabold text-red-400 mb-8 music-font">
                Hassansational Trivia Challenge!
            </h1>
            
            {/* Placeholder Image Section */}
            <div className="mx-auto w-11/12 md:w-2/3 mb-10 border-4 border-yellow-500 rounded-lg overflow-hidden shadow-xl">
                <img 
                    src="https://media.gettyimages.com/id/1363411424/photo/smiling-young-man-playing-an-acoustic-guitar.jpg?s=2048x2048&w=gi&k=20&c=z8m_ZT1x5gFEstoTfBIulNKpBzp6D-XAbbfA7b7e2B8="
                    alt="Habibi is the best" 
                    className="w-full h-auto object-cover"
                    onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/1200x800/dc2626/f8fafc?text=Image+Failed+to+Load'; }}
                />
            </div>

            {/* New Game Button */}
            <button 
                onClick={onStartGame}
                className="music-font text-4xl md:text-5xl px-12 py-4 bg-gradient-to-r from-teal-500 to-green-600 text-white rounded-full shadow-2xl 
                           hover:from-teal-600 hover:to-green-700 transform hover:scale-105 transition-all duration-300 
                           ring-4 ring-red-500 ring-offset-4 ring-offset-gray-900"
            >
                New Game
            </button>
        </div>
    </div>
);
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
const PhaserGame = ({  setUiState }) => {

   const initializeLLM = async () => {
        setUiState(prev => ({ ...prev, loading: true, message: "Initializing LLM..." }));
    
        try {
            const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

            const initProgressCallback = (initProgress) => {
                console.log(initProgress);
                setUiState(prev => ({ ...prev, message: `Loading Model: ${initProgress.text}` }));
            }

            const MODEL_NAME = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC"
            
            llmInference = await CreateMLCEngine(
                MODEL_NAME,
                { initProgressCallback: initProgressCallback }, // engineConfig
            );

            console.log(`WebLLM Model (${MODEL_NAME}) Loaded and ready for client-side inference.`);
            return true;
        } catch (e) {
            console.error("Failed to initialize WebLLM or load model weights. Check WebGPU support.", e);
            setUiState(prev => ({ ...prev, message: "LLM Initialization failed. See console for details.", loading: false }));
            return false;
        }
    }


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

    }, [setUiState]); // Dependency on setUiState


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
        let authIsReady = false;
        let gameInitialized = false; // Flag to prevent re-init of Phaser instance

        // 1. Scene Definition (The core game logic)
        class MusicTriviaScene extends window.Phaser.Scene {
            constructor() {
                super('MusicTriviaScene');
                this.conversationTone = 'Normal';
                this.currentScore = 0;
                this.difficultyLevel = 'Very Easy';
                this.gameDataRef = null; // Firestore document reference
                this.llmInitializedPromise = initializeLLM(); 

            }

            preload() {

            }

            create() {
                this.cameras.main.setBackgroundColor('#1f2937');
                
                // Expose a public method to React to handle topic selection
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').handleTopicSelection = this.handleTopicSelection.bind(this);
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').processPlayerGuess = this.processPlayerGuess.bind(this);
                window.phaserGameInstance.scene.getScene('MusicTriviaScene').startNextRound = this.startNextRound.bind(this);
                
                // Inform React that the scene is ready
                this.game.events.emit('ready');
                
                if (authIsReady) {
                    initGameSequence(currentUserId, this);
                }

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


            async function runLLM_API_Call(prompt, schemaName = "UNKNOWN_SCHEMA") {

                if (!llmInference) {
                    throw new Error("LLM not initialized.");
                }

                // Append the mandatory instruction for strict JSON output

                const messages = [{ role: "user", content: prompt}];

                let fullResponseText = "";
                
                // 2. Call the chat.completions.create method with stream: true
                const stream = await llmInference.chat.completions.create({
                    messages: messages,
                    stream: true, // Enable streaming
                    temperature: 0.3
                });

                // Process the streaming output
                for await (const chunk of stream) {
                    const content = chunk.choices[0].delta.content;
                    if (content) {
                        fullResponseText += content;
                    }
                }
                
                // --- Start Robust JSON Cleaning & Parsing ---
                let jsonString = fullResponseText.trim();
                
                // 1. Find the first opening curly brace '{' (where JSON must begin)
                const firstBracketIndex = jsonString.indexOf('{');
                if (firstBracketIndex > -1) {
                    jsonString = jsonString.substring(firstBracketIndex);
                } else {
                    throw new Error(`LLM Output for ${schemaName} did not contain a JSON start bracket '{'.`);
                }

                // 2. Find the last closing curly brace '}' and aggressively truncate everything after it.
                let lastBracketIndex = jsonString.lastIndexOf('}');
                if (lastBracketIndex > -1) {
                    // Keep everything up to and including the last '}'
                    jsonString = jsonString.substring(0, lastBracketIndex + 1);
                }
                
                // 3. Remove trailing markdown fences (e.g., ```) if they exist
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

            async getTopics() {
                const defaultTopics = ['Default Topic 1', 'Default Topic 2', 'Default Topic 3'];
                let arr = defaultTopics; // Start with default topics

                try {
                    console.log("Fetching topics from ./topics.txt...");
                    const res = await fetch('./topics.txt');
                    
                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                    
                    // Fetch, split, trim, and filter in one chain
                    arr = (await res.text())
                        .split('\n')
                        .map(t => t.trim())
                        .filter(t => t.length > 0);

                    if (arr.length < 2) throw new Error("File contains less than 2 valid topics.");

                    console.log(`Successfully loaded ${arr.length} topics.`);

                } catch (error) {
                    console.error("Failed to load topics. Using defaults.", error);
                    // 'arr' remains 'defaultTopics' if the try block fails
                }

                // --- Topic Selection (Always runs, guaranteeing unique topics since arr.length >= 2) ---
                const length = arr.length;
                let index1 = Math.floor(Math.random() * length);
                let index2 = index1;
                
                while (index1 === index2) index2 = Math.floor(Math.random() * length);

                this.topics = [arr[index1], arr[index2]];
                
                console.log("Topics successfully parsed and ready:", this.topics);
                this.game.events.emit('TOPICS_READY', { topics: this.topics });
                
                return this.topics;
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
                    this.updateReactState({ phase: 'loading', message: `Generating question on ${topic}...` });

                    const parsedJson = await this.runLLM_API_Call(systemPrompt, responseSchema);
                
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
                const scoreAdjustment = isCorrect ? 50 : 0;

                
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
                
                await this.saveGameState();
                
                // Inform React of the outcome for displaying results
                this.updateReactState({
                    phase: 'quiz_result',
                    isCorrect: isCorrect,
                    scoreAdjustment: scoreAdjustment,
                    correctAnswer: correctAnswer,
                    lastGuess: guess,
                    message: isCorrect ? 
                        `Correct! You earned ${scoreAdjustment} points. The Conductor is pleased.` : 
                        `Incorrect. The correct answer was ${correctAnswer}. The Conductor shows mercy.`
                });

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
                    const conductorComment = await this.runLLM_API_Call(systemPrompt, '');
                    
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
            
            startNextRound() {
                if (this.currentScore >= 1000) {
                    this.updateReactState({ 
                        message: "Congratulations! You have mastered the Music Trivia Challenge!",
                        phase: 'loading' // Or another end state
                    });
                    return; 
                }
                
                // Back to topic selection
                this.getTopics();
            }

        } // End of MusicTriviaScene

         // 2. Auth Listener and Initialization
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUserId = user.uid;
                authIsReady = true;
                setUiState(prev => ({ ...prev, userId: currentUserId, isAuthReady: true, message: "Authentication complete. Loading game state..." }));
                
                // Initialize Phaser instance once auth is ready AND the game hasn't been initialized yet
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
                    gameInitialized = true;
                }
                
                // If the scene exists (which it should if gameInitialized is true)
                const scene = window.phaserGameInstance.scene.getScene('MusicTriviaScene');
                if (scene && gameInitialized) {
                    // Trigger the full game initialization sequence only after Phaser is created
                    await initGameSequence(currentUserId, scene);
                }

            } else {
                // Should only happen if initialAuthToken is null (safety fallback)
                console.log("Signing in anonymously...");
                signInAnonymously(auth).catch(e => console.error("Anonymous sign in failed:", e));
            }
        });

        // Initial sign-in attempt (outside of listener for immediate start)
        if (initialAuthToken) {
            signInWithCustomToken(auth, initialAuthToken).catch(e => {
                console.error("Custom token sign in failed. Falling back to anonymous:", e);
                signInAnonymously(auth);
            });
        } else {
            signInAnonymously(auth);
        }

        return () => {
             // Cleanup auth listener
             unsubscribe();
        };
    }, [initGameSequence]); // Dependency on the memoized initGameSequence

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



// --- UI Components ---
const GameUI = ({ uiState, handleTopicClick, handleAnswerClick, handleContinueClick }) => {
    
    // Status Bar for Score, Difficulty, and User ID
    const StatusBar = () => (
        <div className="bg-gray-800 p-4 rounded-xl mb-4 flex justify-between items-center text-sm font-mono shadow-lg border-b-2 border-red-500">
            <div className="flex space-x-6">
                <p className="text-yellow-400">Score: <span className="text-white font-bold text-lg">{uiState.score}</span></p>
                <p className="text-red-400">Difficulty: <span className="text-white font-bold">{uiState.difficulty}</span></p>
                <p className="text-teal-400">Tone: <span className="text-white font-bold">{uiState.tone}</span></p>
            </div>
            <p className="text-gray-500 truncate max-w-[200px]" title={`User ID: ${uiState.userId}`}>User: {uiState.userId || 'Connecting...'}</p>
        </div>
    );

    // Message/Conductor Commentary Box
    const CommentaryBox = () => (
        <div className={`p-4 rounded-lg mb-4 text-center shadow-inner ${uiState.loading ? 'bg-blue-900/50' : 'bg-gray-700/70'}`}>
            <p className="text-xl font-semibold text-white">{uiState.message}</p>
        </div>
    );

    // Topic Selection Phase UI
    const TopicSelection = () => (
        <div className="grid grid-cols-2 gap-4">
            {uiState.topics.map(topic => (
                <button 
                    key={topic}
                    onClick={() => handleTopicClick(topic)}
                    className="bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-lg text-xl font-bold shadow-md transition transform hover:scale-[1.02]"
                >
                    {topic}
                </button>
            ))}
        </div>
    );

    // Quiz Phase UI (Question and Answer Options)
    const QuizPhase = () => (
        <div className="space-y-4">
            <p className="text-2xl font-bold text-yellow-300 mb-6 text-center">{uiState.question}</p>
            <div className="grid grid-cols-2 gap-4">
                {uiState.options.map(option => {
                    let className = "p-4 rounded-lg text-lg font-semibold shadow-md transition transform hover:scale-[1.02] duration-200 ease-in-out";
                    let disabled = uiState.correctAnswer !== null; // Disable after first guess

                    if (uiState.correctAnswer) {
                        if (option === uiState.correctAnswer) {
                            className += ' bg-green-600'; // Correct answer
                        } else if (option === uiState.lastGuess) {
                            className += ' bg-red-600 opacity-75'; // Incorrect guess
                        } else {
                            className += ' bg-gray-500/50 opacity-50'; // Unchosen wrong option
                        }
                    } else {
                        className += ' bg-gray-600 hover:bg-gray-500'; // Default unclicked state
                    }

                    return (
                        <button 
                            key={option}
                            onClick={() => handleAnswerClick(option)}
                            className={className}
                            disabled={disabled}
                        >
                            {option}
                        </button>
                    );
                })}
            </div>
            {uiState.correctAnswer && (
                <button
                    onClick={handleContinueClick}
                    className="mt-6 w-full p-4 bg-teal-500 hover:bg-teal-600 text-white text-xl font-bold rounded-lg shadow-xl"
                >
                    Continue to Next Round
                </button>
            )}
        </div>
    );


    let content;
    if (uiState.loading && !uiState.topics.length) {
        content = <p className="text-center text-gray-400 text-2xl animate-pulse">Loading AI...</p>;
    } else if (uiState.phase === 'topic_select') {
        content = <TopicSelection />;
    } else if (uiState.phase === 'quiz' || uiState.phase === 'quiz_result') {
        content = <QuizPhase />;
    } else {
        content = <p className="text-center text-gray-400 text-2xl">Game Ready. Choose a topic to begin.</p>;
    }


    return (
        <div className="bg-gray-900/95 p-6 md:p-10 rounded-xl shadow-2xl max-w-2xl w-full mx-auto border-4 border-yellow-500">
            <StatusBar />
            <CommentaryBox />
            <div id="phaser-parent" className="mb-6">
                <PhaserGame setUiState={setUiState} />
            </div>
            <div className="min-h-[200px] flex flex-col justify-center">
                 {content}
            </div>
        </div>
    );
};



// --- Main React Component ---

function App() {
    const [uiState, setUiState] = useState(initialUIState);
    const [isGameStarted, setGameStarted] = useState(false); // NEW: Controls the Welcome Screen
    const sceneRef = useRef(null); // Reference to the Phaser scene for direct method calls

    // 1. Setup Communication from Phaser -> React
    useEffect(() => {
        // This useEffect runs once the global phaserGameInstance is available, BUT only if the game has started.
        if (!isGameStarted || !window.phaserGameInstance) return;
        
        const game = window.phaserGameInstance; 

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
                message: "Choose Your Topic from the options below:",
                loading: false
            }));
        };

        // Note: The original handleQuestionReady from the prompt was missing its payload, 
        // using the simpler mock from the scene for now.
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
                scoreAdjustment: 0,
                loading: false
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
    }, [isGameStarted]); // Re-run effect only when game starts

    // 2. Communication React -> Phaser (Calling methods on the Scene)
    const handleTopicClick = (topic) => {
        if (sceneRef.current && uiState.phase === 'topic_select') {
            setUiState(prev => ({ 
                ...prev, 
                phase: 'loading', 
                message: `Topic ${topic} selected. Loading challenge...`,
                loading: true
            })); 
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

    const handleStartGame = () => {
        // This instantly hides the WelcomeScreen and mounts the main App/PhaserGame
        setGameStarted(true);
    };

    return (
        <div className="w-full min-h-screen flex items-center justify-center p-4">
            {!isGameStarted ? (
                // Show Welcome Screen if the game hasn't started
                <WelcomeScreen onStartGame={handleStartGame} />
            ) : (
                // Show Main Game UI once started
                <GameUI
                    uiState={uiState}
                    handleTopicClick={handleTopicClick}
                    handleAnswerClick={handleAnswerClick}
                    handleContinueClick={handleContinueClick}
                />
            )}
        </div>
    );

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


if (typeof window.Phaser === 'undefined' || typeof window.ReactDOM === 'undefined') {
    // Check for existence of script tag to prevent double-loading if user runs repeatedly
    if (!document.querySelector('script[src*="phaser.min.js"]')) {
        const phaserScript = document.createElement('script');
        phaserScript.src = 'https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js';
        document.head.appendChild(phaserScript);
    }
    
    const reactScript = document.createElement('script');
    reactScript.src = 'https://unpkg.com/react@18/umd/react.development.js';
    document.head.appendChild(reactScript);

    const reactDomScript = document.createElement('script');
    reactDomScript.src = 'https://unpkg.com/react-dom@18/umd/react-dom.development.js';
    document.head.appendChild(reactDomScript);

    const checkAndRender = () => {
        if (window.Phaser && window.ReactDOM && window.React) {
            const root = document.getElementById('root');
            if (root) {
                ReactDOM.createRoot(root).render(<App />);
            } else {
                console.error("Root element not found.");
            }
        } else {
             // Use requestAnimationFrame for slightly better loop timing than setTimeout
            requestAnimationFrame(checkAndRender);
        }
    };
    // Start checking after initial scripts are injected (assuming they'll load quickly)
    requestAnimationFrame(checkAndRender);

} else {
    // If libraries are already loaded (e.g., in a development environment)
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}