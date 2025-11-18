// main.js

class MusicTriviaScene extends Phaser.Scene {
   constructor() {
       super('MusicTriviaScene');
       this.currentAudio = null;
   }

   async preload() {
       // Pre-load a fallback audio loop for when Mubert's free tier is exhausted [1]
       //this.load.audio('fallback', 'assets/local_fallback_loop.mp3');
       // Initial setup for the LLM 
        console.log("Starting LLM initialization...");
        await initializeLLM(); 
        console.log("LLM successfully initialized. Game starting.");
   }

   create() {
       this.add.text(10, 10, 'LLM Quiz Master Running Client-Side', { fontSize: '24px', fill: '#fff' });
       this.scoreText = this.add.text(10, 50, `Score: ${gameState.score}`, { fontSize: '20px', fill: '#0f0' });
       this.challengeText = this.add.text(10, 100, 'Loading first challenge...', { fontSize: '20px', fill: '#fff', wordWrap: { width: 780 } });
       


       // Input box and submit button (simplified)
       const inputElement = document.createElement('input');
       inputElement.type = 'text';
       inputElement.placeholder = 'Answer correctly the question related to ... what artist? ';
       
       // Add HTML input to the game
       this.add.dom(400, 500, inputElement, 'width: 300px; height: 30px; font-size: 18px;');

       const submitButton = this.add.text(400, 550, 'Submit Guess', { fontSize: '24px', fill: '#ff0' })
         .setInteractive()
         .setOrigin(0.5)
         .on('pointerdown', () => {
               this.processPlayerGuess(inputElement.value);
               inputElement.value = ''; // Clear input
           });

       this.startChallenge("Start Game");
   }

   /**
    * The core game loop function.
    * 2. Calls the client-side LLM for the next state.
    */
   async startChallenge(playerInput) {
       this.challengeText.setText('LLM thinking...');
       
       //if (this.currentAudio) {
       //    this.currentAudio.stop();
       //}

       try {
           //  Get Structured Command from Client-Side LLM
           // This is the fastest, zero-cost part of the loop.
           const challengeData = await getNextChallenge(playerInput);
           
           // Update Global State and UI
           gameState.score += challengeData.score_adjustment;
           gameState.difficulty = challengeData.challenge_difficulty;
           gameState.history = challengeData.context_summary;
           this.scoreText.setText(`Score: ${gameState.score} | Difficulty: ${gameState.difficulty}`);
           
           // Decouple Call to External Mubert API
           // This call is slower and asynchronous; the UI must not block.[1]
           // const musicUrl = await generateMusic(challengeData.prompt_for_mubert);
           
           //  Play Music Challenge
           // This assumes the Mubert API returns a direct URL that Phaser can load and play.
           // this.load.audio('challenge_track', musicUrl);
           // await new Promise(resolve => this.load.once('complete', resolve)); // Wait for audio to load
           
           //this.currentAudio = this.sound.add('challenge_track', { loop: true });
           //this.currentAudio.play(); 
           this.challengeText.setText(`Quiz Master: Guess the following: ${challengeData.correct_answer}`); 

       } catch (error) {
           // Media Degradation Strategy: Fallback to local asset if API fails [1]
           this.challengeText.setText(error) // `Error: Game Master failed. Playing fallback music.`);
           //this.currentAudio = this.sound.add('fallback', { loop: true });
           //this.currentAudio.play(); 
           console.error(error);
       }
   }

   /**
    * Simplified logic to process the player's attempt.
    */
   processPlayerGuess(guess) {
       // The game relies on the LLM's system prompt (Step 2) to evaluate the 
       // previous 'guess' and adjust the next challenge accordingly.
       this.startChallenge(guess); 
   }
}

// Phaser Game Configuration
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