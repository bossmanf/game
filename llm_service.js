// llm_service.js - Defines the critical structure the LLM must output.

/**
 * The strict JSON schema required by the game engine.
 * The LLM will be constrained to output an object matching this structure.
 */
const GAME_STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "challenge_difficulty": { 
            "type": "string", 
            "description": "The current difficulty level, which scales every two correct answers",
            "enum": ["Easy", "Medium", "Hard", "Game_Over"] // Constrained choices [7]
        },
        "correct_answer": {
            "type": "string",
            "description": "The correct trivia answer the player must guess (e.g., 'Jazz fusion', '80s Synthwave', 'Saxophone solo')."
        },
        "conversation_tone": {
            "type": "string",
            "description": "The mood of your sentences, getting more and more excited as the player gets close to the end.",
            "enum": ["Normal", "Excited", "Over the moon"] 
        },
        "score_adjustment": { 
            "type": "integer", 
            "description": "The score to be awarded/deducted based on the player's last action (+/-)."
        },
        "context_summary": {
            "type": "string",
            "description": "A concise, single-sentence summary of the player's recent performance to maintain continuity and state."
        }
    },
    "required": ["challenge_difficulty", "conversation_tone", "correct_answer", "score_adjustment", "context_summary"]
};

// Global object to store game state (score, difficulty, etc.)
let gameState = {
    score: 0,
    difficulty: "Easy",
    conversation_tone: "Normal",
    history: "Game started. Player is new."
};






let llmInference = null;

/**
* Initializes the client-side LLM using MediaPipe.
*/
async function initializeLLM() {
    // 1. Check for the global class created by the bundle
    const LlmInference = window.LlmInference; // Should be available after the bundle loads
    
    if (typeof LlmInference === 'undefined') {
        // Fallback for safety, though the issue should be fixed by the .js bundle
        throw new Error("LlmInference class not found after loading bundle.js.");
    }

    // Use a small, optimized model like Gemma 2B
    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/llm_inference/gemma-2b/model.bin';
    
    try {
        // 2. Set up LlmInference
        llmInference = await LlmInference.create(modelUrl, {
            // Since you're on Chrome/GitHub Pages, WebGPU should be available, 
            // but setting it to 'auto' is fine.
            gpu: 'auto', 
        });
        console.log("LLM Model Loaded and ready for client-side inference.");
    } catch (error) {
        // This catch block handles errors during the ASYNC model creation/download
        console.error("Error during LlmInference.create(). Check model URL or CORS/fetch issues.", error);
        throw new Error("LLM model creation failed. Check browser console for details.");
    }
}
/**
* Generates the next challenge state from the LLM, enforcing JSON output.
* @param {string} playerInput - The player's attempt at the trivia answer.
*/
async function getNextChallenge(playerInput) {
   if (!llmInference) {
       throw new Error("LLM not initialized.");
   }

   // 1. Stateful Context Injection: Inject current state into the system prompt [9, 1]
   // This ensures the model maintains continuity and scales difficulty accurately.[10]
   const systemPrompt = `You are the Music Quiz Master. Your task is to generate the NEXT trivia question challenge based on the player's input: "${playerInput}".
   The player's current game state is: Score ${gameState.score}, Difficulty ${gameState.difficulty}, conversation mood: ${gameState.conversation_tone}, Last Summary: ${gameState.history}.
   
   RULES:
   1. If the player was CORRECT, increase 'challenge_difficulty' (Easy -> Medium -> Hard).
   2. If the player was INCORRECT, keep the difficulty the same or decrease it.
   3. Generate a new trivia question, scaling its complexity based on the new 'challenge_difficulty' (e.g., 'Hard' requires a niche style or tempo).
   4. Output must be STRICTLY VALID JSON.`;
   
   // 2. Enforce Structured Output using the schema [7, 8]
   const response = await llmInference.generateText(systemPrompt, {
       jsonSchema: GAME_STATE_SCHEMA,
       maxTokens: 512 
   });
   
   // 3. Robustness through Self-Correction/Validation (Simplified)
   try {
       const challengeData = JSON.parse(response);
       return challengeData;
   } catch (e) {
       // In a real application, implement a validation-driven retry loop (Self-Correction) [11]
       console.error("LLM produced malformed JSON. Requesting fallback data.", e);
       throw new Error("Failed to parse LLM output.");
   }
}
