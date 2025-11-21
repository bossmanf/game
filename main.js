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
        
        this.game.events.emit('LLM_READY');
        
        // Only keep the text elements that draw *on the canvas*
        this.add.text(10, 10, 'LLM Quiz Master', FONT_STYLE.TITLE);
        this.scoreText = this.add.text(790, 10, `Score: ${gameState.score}`, FONT_STYLE.SCORE).setOrigin(1, 0);
        this.conductorText = this.add.text(10, 560, 'Initializing the Game Conductor...', FONT_STYLE.CONDUCTOR);
        this.challengeText = this.add.text(400, 200, 'Loading Game...', FONT_STYLE.QUESTION).setOrigin(0.5);
        // Start the Topic Selection Phase
        this.showTopicSelection();
    }

    // --- PHASE 1: TOPIC SELECTION ---

    async showTopicSelection() {
        this.hideChallengeElements();
        
        this.challengeText.setText('Selecting Topics...'); 
        this.conductorText.setText('Hold on, the Game Conductor is warming up the trivia engine...'); 

        let topics = ['80s Pop Music', 'Travel Trivia', 'SF Sports History'];
        let comment = "Welcome to the game! I'm your Conductor. Let's start with a topic!";

        try {
            const topicData = await getNewTopics(); 
            console.log('New topics received...')
            topics = topicData.topics;
            comment = topicData.comment;
            this.challengeText.setText('Choose Your Topic:');
        } catch (error) {
            this.challengeText.setText('Topic Generator failed. Using default topics.');
            console.error("Topic generation error:", error);
        }
        
        this.conductorText.setText(comment);
        console.log('Topics ready:', topics, ' and the comment: ',comment)
        this.game.events.emit('TOPICS_READY', { topics, comment });
    }


    async handleTopicSelection(topic) {
        gameState.last_topic = topic;

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
            this.conductorText.setText(`Conductor: ${data.conductor_comment}`);

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
            this.conductorText.setText("Conductor: Something went wrong in the LLM service. Check console.");
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
            gameState.score += statusUpdate.score_adjustment;
            gameState.difficulty = statusUpdate.challenge_difficulty;
            gameState.game_history = statusUpdate.context_summary; 
            gameState.conversation_tone = statusUpdate.conversation_tone;
            
            // 3. Update the conductor text with the LLM's new comment
            this.conductorText.setText(`Conductor: ${statusUpdate.conductor_comment}`);
            this.scoreText.setText(`Score: ${gameState.score}`);
            
            // 4. Emit the updated score and state to React UI
            this.game.events.emit('GAME_STATE_UPDATE', gameState);

        } catch (error) {
            console.error("Error updating game status:", error);
            this.conductorText.setText(`Conductor: Score update failed due to a transmission error!`);
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
        this.conductorText.setText('Awaiting the next move from the Quiz Master...'); 

        try {
            const challengeData = await getNextChallenge(playerInput, isTopic);
            this.currentQuestionData = challengeData; 

            this.game.events.emit('QUESTION_READY', {
                question: challengeData.question_text,
                options: challengeData.options,
                correct_answer: challengeData.correct_answer,
                comment: challengeData.conductor_comment
            });
            
            this.conductorText.setText(`Conductor: ${challengeData.conductor_comment}`); 
            this.challengeText.setText(challengeData.question_text);

        } catch (error) {
            this.challengeText.setText(`Error: Game Master failed. Check console.`);
            this.conductorText.setText(`Conductor: An error occurred in the quantum logic stream!`);
            console.error(error);
            this.time.delayedCall(1000, this.showTopicSelection, [], this);
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
