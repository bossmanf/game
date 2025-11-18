// main.js

import { 
    gameState, 
    initializeLLM, 
    getNextChallenge,
    getNewTopics
} from './llm_service.js';

class MusicTriviaScene extends Phaser.Scene {
    constructor() {
        super('MusicTriviaScene');
        this.currentAudio = null;
        this.currentQuestionData = null; 
        this.answerButtons = [];
        this.topicButtons = [];
        this.conductorText = null; // NEW PROPERTY
    }

    async preload() {
        console.log("Starting LLM initialization...");
        await initializeLLM(); 
        console.log("LLM successfully initialized. Game starting.");
    }

    create() {
        // UI Elements
        this.add.text(10, 10, 'LLM Quiz Master Running Client-Side', { fontSize: '24px', fill: '#fff' });
        this.scoreText = this.add.text(10, 50, `Score: ${gameState.score} | Difficulty: ${gameState.difficulty}`, { fontSize: '20px', fill: '#0f0' });
        
        // Conductor Comment Text (Permanent)
        this.conductorText = this.add.text(10, 560, 'Initializing the Game Conductor...', {
             fontSize: '18px', 
             fill: '#ffa500', 
             wordWrap: { width: 780 } 
        });

        this.challengeText = this.add.text(400, 200, 'Loading Game...', { 
            fontSize: '32px', 
            fill: '#fff', 
            wordWrap: { width: 780 },
            align: 'center' 
        }).setOrigin(0.5);

        // Start the Topic Selection Phase
        this.showTopicSelection();
    }

    // --- PHASE 1: TOPIC SELECTION (Now async) ---

    async showTopicSelection() {
        // Clear previous elements if any
        this.hideChallengeElements();
        this.hideTopicSelection();
        
        this.challengeText.setText('LLM generating 3 random topics...'); 
        this.conductorText.setText('Hold on, the Game Conductor is warming up the trivia engine...'); // Conductor status

        let topics = ['80s Pop Music', 'Travel Trivia', 'SF Sports History']; // Fallback topics
        let comment = "Welcome to the game! I'm your Conductor. Let's start with a topic!";

        try {
            // AWAIT the LLM call to get the new topics and the initial comment
            const topicData = await getNewTopics(); 
            topics = topicData.topics;
            comment = topicData.comment;
            this.challengeText.setText('Choose Your Topic:');
        } catch (error) {
            this.challengeText.setText('Topic Generator failed. Using default topics.');
            console.error("Topic generation error:", error);
        }
        
        this.conductorText.setText(comment); // Display initial greeting/comment

        const buttonY = 350;
        const buttonGap = 200;

        topics.forEach((topic, index) => {
            const x = 400 - buttonGap + (index * buttonGap);
            const button = this.add.text(x, buttonY, topic, { 
                fontSize: '24px', 
                backgroundColor: '#0056b3', 
                padding: { x: 20, y: 10 } 
            })
            .setInteractive()
            .setOrigin(0.5)
            .on('pointerdown', () => this.handleTopicSelection(topic));

            this.topicButtons.push(button);
        });
    }

    // ... (handleTopicSelection and hideTopicSelection remain the same) ...
    
    // --- PHASE 2: LLM CHALLENGE ---

    async startChallenge(playerInput, isTopic = false) {
        this.hideChallengeElements();
        this.challengeText.setText('LLM thinking...');
        this.conductorText.setText('Awaiting the next move from the Quiz Master...'); // Conductor status update

        try {
            // Get Structured Command from Client-Side LLM
            const challengeData = await getNextChallenge(playerInput, isTopic);
            this.currentQuestionData = challengeData;

            // Update Global State based on LLM response
            gameState.score += challengeData.score_adjustment;
            gameState.difficulty = challengeData.challenge_difficulty;
            // gameState.conversation_tone = challengeData.conversation_tone; // Optionally update tone
            gameState.history = challengeData.context_summary;
            
            this.scoreText.setText(`Score: ${gameState.score} | Difficulty: ${gameState.difficulty}`);
            this.conductorText.setText(`Conductor: ${challengeData.conductor_comment}`); // Update Conductor Comment
            this.challengeText.setText(challengeData.question_text);

            this.showAnswerButtons(challengeData.options);

        } catch (error) {
            this.challengeText.setText(`Error: Game Master failed. Check console.`);
            this.conductorText.setText(`Conductor: An error occurred in the quantum logic stream!`);
            console.error(error);
            this.time.delayedCall(3000, this.showTopicSelection, [], this);
        }
    }

    // ... (showAnswerButtons remains the same) ...

    // --- PHASE 3: GUESS AND TRANSITION ---

    processPlayerGuess(selectedButton, guess) {
        // Disable all buttons to prevent multiple clicks
        this.answerButtons.forEach(b => b.disableInteractive());

        const isCorrect = (guess === this.currentQuestionData.correct_answer);
        
        if (isCorrect) {
            selectedButton.setBackgroundColor('#2ecc71'); // Green
            this.challengeText.setText('CORRECT!');
        } else {
            selectedButton.setBackgroundColor('#e74c3c'); // Red
            this.challengeText.setText(`WRONG! Correct answer was: ${this.currentQuestionData.correct_answer}`);
        }
        
        this.conductorText.setText(`Conductor: ${isCorrect ? 'That was a sharp guess!' : 'Better luck next time!'}`); // Simple interim feedback

        // Wait 2 seconds, then transition to the next phase
        this.time.delayedCall(2000, () => {
            // Send the guess to LLM to update state and get new question based on the last topic
            this.startChallenge(guess, false);
        }, [], this);
    }

    // ... (hideChallengeElements and Phaser config remain the same) ...
}

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    dom: {
        createContainer: true
    },
    scene:  [MusicTriviaScene]
};

const game = new Phaser.Game(config);