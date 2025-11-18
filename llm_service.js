// llm_service.js

/**
 * The strict JSON schema required by the game engine.
 * The LLM will be constrained to output an object matching this structure.
 */
const GAME_STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "challenge_difficulty": { 
            "type": "string", 
            "description": "The current difficulty level: Easy, Medium, or Hard.",
            "enum": ["Easy", "Medium", "Hard", "Game_Over"]
        },
        "question_text": {
            "type": "string",
            "description": "The trivia question text for the player to answer."
        },
        "correct_answer": {
            "type": "string",
            "description": "The exact text of the correct answer (must match one of the options)."
        },
        "options": {
            "type": "array",
            "description": "An array containing exactly 4 string elements: the correct answer and 3 incorrect distractors.",
            "items": { "type": "string" },
            "minItems": 4,
            "maxItems": 4
        },
        "score_adjustment": { 
            "type": "integer", 
            "description": "The score to be awarded/deducted based on the player's last action (+/-). Should be +1 or -1."
        },
        "context_summary": {
            "type": "string",
            "description": "A concise, single-sentence summary of the player's recent performance."
        },
        "conversation_tone": {
            "type": "string",
            "description": "The current conversation tone",
            "enum": ["Normal", "Sassy", "Thrilled", "Challenging"]
        },
        "conductor_comment": { // NEW FIELD: Conductor's engaging comment
            "type": "string",
            "description": "A fun, engaging comment that greets the player or reacts to the previous answer, using the current conversation_tone."
        }
    },
    "required": ["challenge_difficulty", "question_text", "correct_answer", "options", "score_adjustment", "context_summary"]
};


// NEW SCHEMA for Topic Generation
const TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "description": "An array containing exactly three distinct trivia topics.",
            "items": { "type": "string" },
            "minItems": 3,
            "maxItems": 3
        }
    },
    "required": ["topics"]
};

// Global object to store game state (score, difficulty, etc.)
let gameState = {
    score: 0,
    difficulty: "Easy",
    last_topic: "None", 
    conversation_tone: "Normal",
    game_history: "Game started. Player is new."
};

let llmInference = null;

// ...
async function initializeLLM() {
    let LlmInference;
    
    try {
        const GenAI = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/genai_bundle.cjs');
        LlmInference = GenAI.LlmInference;
    } catch (e) {
        console.error("Failed to dynamically load MediaPipe GenAI bundle:", e);
        throw new Error("Initialization failed: Could not load LlmInference library.");
    }

    if (typeof LlmInference === 'undefined') {
        throw new Error("LlmInference class is undefined after import.");
    }

    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/llm_inference/gemma-2b/model.bin';
    
    llmInference = await LlmInference.create(modelUrl, {
        gpu: 'auto', 
    });
    console.log("LLM Model Loaded and ready for client-side inference.");
}



/**
 * Generates three random topics from the LLM.
 * The LLM will be constrained to output an object matching TOPIC_SCHEMA.
 */
async function getNewTopics() {
    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

   // Adjust system prompt to also generate the initial comment using the tone
    const systemPrompt = `You are the Game Conductor. Your first task is to greet the player using an ${gameState.conversation_tone} tone and provide three random trivia topics.
    Topics must be chosen from a mixture of these categories: Music, Travel, Sports, U2, Gay pop culture, Metallica, Entertainment, and San Francisco culture.
    Output must be STRICTLY VALID JSON matching the TOPIC_SCHEMA, but include the greeting/comment in the 'context_summary' field.`;
    
    
    const response = await llmInference.generateText(systemPrompt, {
        jsonSchema: {
             "type": "object",
             "properties": {
                 "topics": TOPIC_SCHEMA.properties.topics,
                 "conductor_comment": GAME_STATE_SCHEMA.properties.conductor_comment
             },
             "required": ["topics", "conductor_comment"]
        },
        maxTokens: 128
    });
    
    try {
        const data = JSON.parse(response);
        return { topics: data.topics, comment: data.conductor_comment }; // Return object with topics and comment
    } catch (e) {
        console.error("LLM produced malformed JSON for topics:", response, e);
        throw new Error("Failed to parse LLM topic output.");
    }
}

/**
* Generates the next challenge state from the LLM, enforcing JSON output.
 * @param {string} playerInput - The player's attempt OR the new topic.
 */
async function getNextChallenge(playerInput, isTopicSelection = false) {
    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }
    
    // Determine the action prompt
    let action = isTopicSelection ? 
        `The player has chosen the topic: "${playerInput}". Generate a new question, 4 options, and the correct answer based on this topic and the current difficulty.` : 
        `The player guessed: "${playerInput}". The previous topic was "${gameState.last_topic}". Evaluate if the guess was correct (match the previous correct_answer). Adjust the score and difficulty. Generate a new question, options, and correct answer based on the previous topic.`;

    const systemPrompt = `You are the Music Quiz Master and Game Conductor. Your task is to generate the NEXT trivia challenge and a comment.
    ${action}
    The player's current game state is: Score ${gameState.score}, Difficulty ${gameState.difficulty}, Conversation Tone: ${gameState.conversation_tone}. Last Summary: ${gameState.game_history}.
    
    RULES:
    1. If the player was CORRECT, set 'score_adjustment' to +1, use an 'Excited' tone, and increase 'challenge_difficulty' (Easy -> Medium -> Hard) if possible.
    2. If the player was INCORRECT, set 'score_adjustment' to -1, use a 'Normal' tone, and keep difficulty the same or decrease it.
    3. The 'conductor_comment' must be engaging and react to the player's guess, matching the required Conversation Tone.
    4. The 'options' array must contain exactly four answers, one of which must EXACTLY match the 'correct_answer' field.
    5. Output must be STRICTLY VALID JSON matching the GAME_STATE_SCHEMA.`;
    
    // 2. Enforce Structured Output using the schema
    const response = await llmInference.generateText(systemPrompt, {
        jsonSchema: GAME_STATE_SCHEMA,
        maxTokens: 512 
    });
    
    // 3. Robustness through Validation
    try {
        const challengeData = JSON.parse(response);
        return challengeData;
    } catch (e) {
        console.error("LLM produced malformed JSON.", response, e);
        throw new Error("Failed to parse LLM output.");
    }
}