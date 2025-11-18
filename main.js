// main.js

import { 
    gameState, 
    initializeLLM, 
    getNextChallenge,
    getNewTopics
} from './llm_service.js';

// Define the styles used by Phaser for a professional look
const FONT_STYLE = {
    TITLE: { fontSize: '28px', fill: '#FFFFFF', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 4, fill: true } },
    SCORE: { fontSize: '22px', fill: '#00FFC0', fontStyle: 'bold', shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true } },
    // Conductor text is gold/yellow for emphasis
    CONDUCTOR: { fontSize: '18px', fill: '#F5D547', wordWrap: { width: 780 } },
    QUESTION: { 
        fontSize: '36px', 
        fill: '#FFFFFF', 
        fontStyle: 'bold',
        wordWrap: { width: 780 },
        align: 'center',
        shadow: { offsetX: 2, offsetY: 2, color: '#000', blur: 6, fill: true }
    },
    // Default professional button style
    BUTTON_DEFAULT: { 
        fontSize: '20px', 
        fill: '#111', 
        backgroundColor: '#EEEEEE', 
        padding: { x: 20, y: 15 },
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: false }
    },
    BUTTON_HOVER: { backgroundColor: '#FFFFFF' },
    BUTTON_CORRECT: { backgroundColor: '#2ecc71', fill: '#FFF' },
    BUTTON_WRONG: { backgroundColor: '#e74c3c', fill: '#FFF' }
};

class MusicTriviaScene extends Phaser.Scene {
    constructor() {
        super('MusicTriviaScene');
        this.currentAudio = null;
        this.currentQuestionData = null; 
        this.answerButtons = [];
        this.topicButtons = [];
        this.conductorText = null; 
    }

    async preload() {
        console.log("Starting LLM initialization...");
        await initializeLLM(); 
        console.log("LLM successfully initialized. Game starting.");
    }

    create() {
        // UI Elements
        this.add.text(10, 10, 'LLM Quiz Master', FONT_STYLE.TITLE);
        this.scoreText = this.add.text(10, 50, `Score: ${gameState.score} | Difficulty: ${gameState.difficulty}`, FONT_STYLE.SCORE);
        
        // Conductor Comment Text (Permanent)
        this.conductorText = this.add.text(10, 560, 'Initializing the Game Conductor...', FONT_STYLE.CONDUCTOR);

        this.challengeText = this.add.text(400, 200, 'Loading Game...', FONT_STYLE.QUESTION).setOrigin(0.5);

        // Start the Topic Selection Phase
        this.showTopicSelection();
    }

    // --- PHASE 1: TOPIC SELECTION (Now async) ---

    async showTopicSelection() {
        this.hideChallengeElements();
        this.hideTopicSelection();
        
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

        const buttonY = 350;
        const buttonGap = 200;

        topics.forEach((topic, index) => {
            const x = 400 - buttonGap + (index * buttonGap);
            // Use the professional button style
            const button = this.add.text(x, buttonY, topic, FONT_STYLE.BUTTON_DEFAULT)
            .setInteractive()
            .setOrigin(0.5)
            // Add hover effect 
            .on('pointerover', () => button.setBackgroundColor(FONT_STYLE.BUTTON_HOVER.backgroundColor))
            .on('pointerout', () => button.setBackgroundColor(FONT_STYLE.BUTTON_DEFAULT.backgroundColor))
            .on('pointerdown', () => this.handleTopicSelection(topic));

            this.topicButtons.push(button);
        });
    }

    handleTopicSelection(topic) {
        this.challengeText.setText(`Topic selected: ${topic}`);
        gameState.last_topic = topic;
        this.hideTopicSelection();
        this.startChallenge(topic, true);
    }

    hideTopicSelection() {
        this.topicButtons.forEach(button => button.destroy());
        this.topicButtons = [];
    }
    
    // --- PHASE 2: LLM CHALLENGE ---

    async startChallenge(playerInput, isTopic = false) {
        this.hideChallengeElements();
        this.challengeText.setText('LLM thinking...');
        this.conductorText.setText('Awaiting the next move from the Quiz Master...'); 

        try {
            const challengeData = await getNextChallenge(playerInput, isTopic);
            this.currentQuestionData = challengeData;

            gameState.score += challengeData.score_adjustment;
            gameState.difficulty = challengeData.challenge_difficulty;
            gameState.history = challengeData.context_summary;
            
            this.scoreText.setText(`Score: ${gameState.score} | Difficulty: ${gameState.difficulty}`);
            this.conductorText.setText(`Conductor: ${challengeData.conductor_comment}`); 
            this.challengeText.setText(challengeData.question_text);

            this.showAnswerButtons(challengeData.options);

        } catch (error) {
            this.challengeText.setText(`Error: Game Master failed. Check console.`);
            this.conductorText.setText(`Conductor: An error occurred in the quantum logic stream!`);
            console.error(error);
            this.time.delayedCall(3000, this.showTopicSelection, [], this);
        }
    }

    showAnswerButtons(options) {
        Phaser.Utils.Array.Shuffle(options); 
        
        const buttonY = 350;
        const xPositions = [200, 600];
        const yPositions = [buttonY, buttonY + 80];

        options.forEach((option, index) => {
            const x = xPositions[index % 2];
            const y = yPositions[Math.floor(index / 2)];

            // Use the professional button style
            const button = this.add.text(x, y, option, FONT_STYLE.BUTTON_DEFAULT)
            .setInteractive()
            .setOrigin(0.5)
            // Add hover effect
            .on('pointerover', () => button.setBackgroundColor(FONT_STYLE.BUTTON_HOVER.backgroundColor))
            .on('pointerout', () => button.setBackgroundColor(FONT_STYLE.BUTTON_DEFAULT.backgroundColor))
            .on('pointerdown', () => this.processPlayerGuess(button, option));

            this.answerButtons.push(button);
        });
    }

    // --- PHASE 3: GUESS AND TRANSITION ---

    processPlayerGuess(selectedButton, guess) {
        // Disable all buttons to prevent multiple clicks
        this.answerButtons.forEach(b => b.disableInteractive());

        const isCorrect = (guess === this.currentQuestionData.correct_answer);
        
        if (isCorrect) {
            selectedButton.setBackgroundColor(FONT_STYLE.BUTTON_CORRECT.backgroundColor); 
            selectedButton.setFill(FONT_STYLE.BUTTON_CORRECT.fill);
            this.challengeText.setText('CORRECT!');
        } else {
            selectedButton.setBackgroundColor(FONT_STYLE.BUTTON_WRONG.backgroundColor); 
            selectedButton.setFill(FONT_STYLE.BUTTON_WRONG.fill);
            this.challengeText.setText(`WRONG! Correct answer was: ${this.currentQuestionData.correct_answer}`);
        }
        
        this.conductorText.setText(`Conductor: ${isCorrect ? 'That was a sharp guess!' : 'Better luck next time!'}`); 

        // Wait 2 seconds, then transition to the next phase
        this.time.delayedCall(2000, () => {
            this.startChallenge(guess, false);
        }, [], this);
    }

    hideChallengeElements() {
        this.challengeText.setText('');
        this.answerButtons.forEach(button => button.destroy());
        this.answerButtons = [];
    }
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