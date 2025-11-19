// main.js

import { 
    gameState, 
    initializeLLM, 
    getNextChallenge,
    getNewTopics
} from './llm_service.js';

// Define the styles used by Phaser for the IN-GAME TEXT ONLY
const FONT_STYLE = {
    TITLE: { fontSize: '28px', fill: '#FFFFFF', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 4, fill: true } },
    SCORE: { fontSize: '22px', fill: '#00FFC0', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true } },
    CONDUCTOR: { fontSize: '18px', fill: '#F5D547', wordWrap: { width: 780 } },
    QUESTION: { 
        fontSize: '36px', 
        fill: '#FFFFFF', 
        fontStyle: 'bold',
        wordWrap: { width: 780 },
        align: 'center',
        shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 6, fill: true }
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
        await this.llmInitializedPromise;
        console.log("LLM successfully initialized. Game starting.");
        
        //  NEW: Emit event to React to confirm LLM is ready
        this.game.events.emit('LLM_READY');
        
        // Only keep the text elements that draw *on the canvas*
        this.add.text(10, 10, 'LLM Quiz Master', FONT_STYLE.TITLE);
                
        this.conductorText = this.add.text(10, 560, 'Initializing the Game Conductor...', FONT_STYLE.CONDUCTOR);
        this.challengeText = this.add.text(400, 200, 'Loading Game...', FONT_STYLE.QUESTION).setOrigin(0.5);

        // Start the Topic Selection Phase
        this.showTopicSelection();
    }

    // --- PHASE 1: TOPIC SELECTION ---

    async showTopicSelection() {
        this.hideChallengeElements();
        
        this.challengeText.setText('LLM generating 3 random topics...'); 
        this.conductorText.setText('Hold on, the Game Conductor is warming up the trivia engine...'); 

        let topics = ['80s Pop Music', 'Travel Trivia', 'SF Sports History'];
        let comment = "Welcome to the game! I'm your Conductor. Let's start with a topic!";

        try {
            const topicData = await getNewTopics(); 
            topics = topicData.topics;
            comment = topicData.comment;
            this.challengeText.setText('Choose Your Topic:');
        } catch (error) {
            this.challengeText.setText('Topic Generator failed. Using default topics.');
            console.error("Topic generation error:", error);
        }
        
        this.conductorText.setText(comment);

        this.game.events.emit('TOPICS_READY', { topics, comment });

    }

    // NEW: Function exposed to React to handle the topic selection click
    handleTopicSelection(topic) {
        this.challengeText.setText(`Topic selected: ${topic}`);
        gameState.last_topic = topic;
        this.startChallenge(topic, true);
    }
    
    // NEW: Function exposed to React to handle the answer click
    processPlayerGuess(guess) {
        // Find the correct button/answer logic is now handled in React, 
        // but we still process the guess here
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
        
        this.conductorText.setText(`Conductor: ${isCorrect ? 'That was a sharp guess!' : 'Better luck next time!'}`); 

        // Wait 2 seconds, then transition to the next phase
        this.time.delayedCall(2000, () => {
            this.startChallenge(guess, false);
        }, [], this);
    }
    
    // --- PHASE 2: LLM CHALLENGE ---

    async startChallenge(playerInput, isTopic = false) {
        this.hideChallengeElements();
        this.challengeText.setText('LLM thinking...');
        this.conductorText.setText('Awaiting the next move from the Quiz Master...'); 

        try {
            const challengeData = await getNextChallenge(playerInput, isTopic);
            this.currentQuestionData = challengeData;

            // Update global state
            gameState.score += challengeData.score_adjustment;
            gameState.difficulty = challengeData.challenge_difficulty;
            gameState.game_history = challengeData.context_summary; // Updated history property
            
            // 🛑 NEW: Emit the updated score/difficulty and the new question data
            this.game.events.emit('GAME_STATE_UPDATE', gameState);
            this.game.events.emit('QUESTION_READY', {
                question: challengeData.question_text,
                options: challengeData.options,
                comment: challengeData.conductor_comment
            });
            
            this.conductorText.setText(`Conductor: ${challengeData.conductor_comment}`); 
            this.challengeText.setText(challengeData.question_text);

        } catch (error) {
            this.challengeText.setText(`Error: Game Master failed. Check console.`);
            this.conductorText.setText(`Conductor: An error occurred in the quantum logic stream!`);
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
    width: 800,
    height: 600,
    parent: 'phaser-container', // 🛑 UPDATED to match React div ID
    dom: {
        createContainer: true
    },
    scene: [MusicTriviaScene]
};

// 🛑 EXPORT the game instance so React can access it
window.phaserGameInstance = new Phaser.Game(config);