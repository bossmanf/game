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
* Note: Model weights must be downloaded to the client's device.
*/
async function initializeLLM() {
   const LlmInference = window.LlmInference || self.LlmInference; 
    
    if (typeof LlmInference === 'undefined') {
        // This suggests the module bundle was not loaded correctly
        throw new Error("MediaPipe LlmInference class not found. Check if 'genai_bundle.cjs' loaded correctly.");
    }
    
    // Use a small, optimized model like Gemma 2B or Phi-3 for on-device performance [4, 1]
    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/llm_inference/gemma-2b/model.bin';
    
    // Set up LlmInference (MediaPipe's LLM engine)
    llmInference = await LlmInference.create(modelUrl, {
        gpu: 'false', // Prioritize WebGPU for acceleration [8]
        // Other configuration specific to the chosen model
    });
    console.log("LLM Model Loaded and ready for client-side inference.");
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
