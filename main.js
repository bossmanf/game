// main.js

import { 
    gameState, 
    initializeLLM, 
    getNextChallenge,
    getNewTopics,
    updateStatus
} from './llm_service.js';

// Define the styles used by Phaser for the IN-GAME TEXT ONLY
const FONT_STYLE = {
    TITLE: { fontSize: '18px', fill: '#FFFFFF', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true } },
    SCORE: { fontSize: '20px', fill: '#00FFC0', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true } },
    QUESTION: { 
        fontSize: '24px', 
        fill: '#F5D547', 
        fontStyle: 'bold',
        wordWrap: { width: 550 }, // Adjusted width for smaller canvas
        align: 'center',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 4, fill: true }
    },
};

export class MusicTriviaScene extends Phaser.Scene {
    constructor() {
        super('MusicTriviaScene');
        this.currentAudio = null;
        this.currentQuestionData = null; 
        this.llmInitializedPromise = null;
        
        this.conductorText = null; 
    }

    async preload() {
        console.log("Starting LLM initialization...");
        this.llmInitializedPromise = initializeLLM(); 
        console.log("LLM initialization started.");
    }

    async create() {
        // Wait for LLM init
        await this.llmInitializedPromise;
        console.log("LLM successfully initialized. Game starting.");
        
        this.game.events.emit('LLM_READY');
        
        // Only keep the text elements that draw *on the canvas*
        this.add.text(10, 10, 'LLM Quiz Master', FONT_STYLE.TITLE);
        
        // Score is still here, but also duplicated in React UI
        this.scoreText = this.add.text(590, 10, `Score: ${gameState.score}`, FONT_STYLE.SCORE).setOrigin(1, 0);
        
        // Challenge text is the main question display on the canvas
        this.challengeText = this.add.text(300, 200, 'Loading Game...', FONT_STYLE.QUESTION).setOrigin(0.5);
        
        // The conductor text is now primarily handled by the React UI to be next to the image.
        
        // Start the Topic Selection Phase
        this.showTopicSelection();
    }

    // --- PHASE 1: TOPIC SELECTION ---

    async showTopicSelection() {
        this.hideChallengeElements();
        
        this.challengeText.setText('Selecting Topics...'); 
        this.game.events.emit('CONVERSATION_UPDATE', { message: 'Hold on, the Game Conductor is warming up the trivia engine...' });

        let topics = ['80s Pop Music', 'Travel Trivia', 'SF Sports History'];
        let comment = "Welcome to the game! I'm your Conductor. Let's start with a topic!";

        try {
            const topicData = await getNewTopics(); 
            console.log('New topics received...')
            topics = topicData.topics;
            this.challengeText.setText('Choose one of these Topics:');
        } catch (error) {
            this.challengeText.setText('Topic Generator failed. Using default topics.');
            console.error("Topic generation error:", error);
        }
        console.log('Topics ready:', topics)
        
        // Emit update for React to show topic buttons
        this.game.events.emit('TOPICS_READY', { topics});
    }


    async handleTopicSelection(topic) {
        gameState.last_topic = topic;
        
        this.game.events.emit('GAME_STATE_UPDATE', { ...gameState, phase: 'loading' });
        this.game.events.emit('CONVERSATION_UPDATE', { message: `Topic ${topic} selected. Generating first question...` });


        // 2. Call the LLM to get the next question
        try {

            console.log('Calling Next Challenge for first question on topic:', topic)
            const data = await getNextChallenge(topic);
            
            this.currentQuestionData = {
                question_text: data.question,
                options: data.options,
                correct_answer: data.correct_answer,
                conductor_comment: data.conductor_comment
            };

            this.game.events.emit('QUESTION_READY', {
                question: data.question,
                options: data.options,
                correct_answer: data.correct_answer,
                comment: data.conductor_comment
            });
            
            this.challengeText.setText(data.question);

        } catch (error) {
            console.error("Error generating question:", error);
            // Handle error: emit a message back to React
            this.game.events.emit('QUESTION_READY', {
                question: "Error loading question. Please try again.",
                options: ["Restart"],
                comment: "Something went wrong in the LLM service. Check console.",
                correct_answer: "Restart" // Provide a fallback answer
            });
            this.challengeText.setText("Error loading question. Please try again.");
        }
    }
    
    async processPlayerGuess(guess) {

        if (!this.currentQuestionData) {
            console.error("No current question data available. Restarting topic selection.");
            this.showTopicSelection();
            return;
        }
        
        const isCorrect = (guess === this.currentQuestionData.correct_answer);
        
        // Emit the result to React so it can highlight the buttons
        this.game.events.emit('GUESS_PROCESSED', {  
            isCorrect: isCorrect,    
            correctAnswer: this.currentQuestionData.correct_answer    
        });

        // Continue processing in Phaser
        if (isCorrect) {
            this.challengeText.setText('CORRECT!');
        } else {
            this.challengeText.setText(`WRONG! Correct answer was: ${this.currentQuestionData.correct_answer}`);
        }
        
        // 1. Call LLM to update status and get new game state
        try {
            // updateStatus returns the state adjustment and new tone/difficulty
            const statusUpdate = await updateStatus(guess); 

            // 2. Update global state using the returned statusUpdate object
            const scoreAdjustment = statusUpdate.score_adjustment;
            gameState.score += scoreAdjustment;
            gameState.difficulty = statusUpdate.challenge_difficulty;
            gameState.game_history = statusUpdate.context_summary; 
            gameState.conversation_tone = statusUpdate.conversation_tone;
            
            // 3. Update the conductor text and score
            this.scoreText.setText(`Score: ${gameState.score}`);
            
            // 4. Emit the updated score and state to React UI
            this.game.events.emit('GAME_STATE_UPDATE', { 
                ...gameState, 
                phase: 'quiz_result', 
                scoreAdjustment: scoreAdjustment,
                conductorComment: statusUpdate.conductor_comment,
                isCorrect: isCorrect
            });

        } catch (error) {
            console.error("Error updating game status:", error);
            this.game.events.emit('CONVERSATION_UPDATE', { message: `Score update failed due to a transmission error!` });
        }

        // 5. Wait 3 seconds, then transition to the next question phase
        this.time.delayedCall(3000, () => {
            // Pass the ongoing topic for the next question
            this.startChallenge(gameState.last_topic); 
        }, [], this);
    }
    
    // --- PHASE 2: LLM CHALLENGE ---

    async startChallenge(playerInput, isTopic = false) {
        this.hideChallengeElements();
        this.challengeText.setText('LLM thinking...');
        this.game.events.emit('CONVERSATION_UPDATE', { message: 'Awaiting the next move from the Quiz Master...' });

        try {
            const challengeData = await getNextChallenge(playerInput, isTopic);
            this.currentQuestionData = challengeData; 

            this.game.events.emit('QUESTION_READY', {
                question: challengeData.question,
                options: challengeData.options,
                correct_answer: challengeData.correct_answer,
                comment: challengeData.conductor_comment
            });
            
            this.challengeText.setText(challengeData.question);

        } catch (error) {
            this.challengeText.setText(`Error: Game Master failed. Check console.`);
            this.game.events.emit('CONVERSATION_UPDATE', { message: `An error occurred in the quantum logic stream!` });
            console.error(error);
            this.time.delayedCall(3000, this.showTopicSelection, [], this);
        }
    }

    hideChallengeElements() {
        this.challengeText.setText('');
    }
}

const config = {
    type: Phaser.AUTO,
    width: 600, // Reduced width
    height: 400, // Reduced height
    parent: 'phaser-container', 
    dom: {
        createContainer: true
    },
    scene: [MusicTriviaScene]
};

export function initPhaserGame() {
    window.phaserGameInstance = new Phaser.Game(config);
    console.log("Phaser Game Initialized and ready to run.");
}