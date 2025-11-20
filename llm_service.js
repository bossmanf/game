/**
 * The strict JSON schema required by the game engine.
 * The LLM will be constrained to output an object matching this structure.
 */
const QUESTION_SCHEMA= {
    "type": "object",
    "properties": {
        "question_text": {
            "type": "string",
            "description": "The trivia question text for the player to answer."
        },
        "options": {
            "type": "array",
            "description": "An array containing exactly 4 string elements: the correct answer and 3 incorrect distractors.",
            "items": { "type": "string" },
            "minItems": 4,
            "maxItems": 4
        },
        "correct_answer": {
            "type": "string",
            "description": "The exact text of the correct answer (must match one of the options)."
        },
        "conductor_comment": {
            "type": "string",
            "description": "A witty short comment about this question using the current conversation_tone."
        }
    },
    "required": [ "question_text", "correct_answer", "options", "conductor_comment"]
};


const GAME_STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "challenge_difficulty": { 
            "type": "string", 
            "description": "The current difficulty level: Easy, Medium, or Hard.",
            "enum": ["Easy", "Medium", "Hard", "Game_Over"]
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
    // FIX: Corrected the required fields to only include state update data
    "required": ["challenge_difficulty", "score_adjustment", "context_summary", "conversation_tone", "conductor_comment"]
};


const TOPIC_SCHEMA = {
    "type": "object",
        "conductor_comment": { 
            "type": "string",
            "description": "The comment for the player, matching the required conversation tone."
    }
};


// Global object to store game state (score, difficulty, etc.)
export let gameState = {
    score: 0,
    difficulty: "Easy",
    last_topic: "None", 
    conversation_tone: "Normal",
    game_history: "Game started. Player is new."
};


let llmInference = null;

// Helper function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function getRandomTwoElements() {

    const arr = [
    "80s Music",
    "90s Music",
    "Heavy Rock",
    "Punk Rock",
    "Pop Music",
    "Music (anything goes)",
    "International Cuisine",
    "Travel",
    "Famous Capitals",
    "Sports in San Francisco",
    "U2",
    "Gay Pop Culture",
    "Metallica",
    "Cinema Entertainment",
    "Email Marketting",
    "Wresting",
    "Geography",
    "Science",
    "Arabic language",
    "Iraq",
    "Spain",
    "Granada",
    "Liverpool",
    "Big Bear California",
    "New York City",
    "Hardly Strictly Bluegrass",
    "Beenies",
    "Black Color",
    "Music Venues",
    "Music Venues in San Francisco",
    "Classic Rock",
    "Hip-Hop",
    "World Music",
    "Indie Music",
    "Alternative Music",
    "Habibi",
    "Softball",
    "FIFA videogame",
    "Gummies",
    "Inner Sunset San Francisco",
    "San Jose California",
    "Famous Concerts",
    "California",
    "Boardgames",
    "Guitars",
    "Bay Area",
    "Liverpool FC",
    "History",
    "Modern Comedians",
    "San Francisco culture"
    ];

    // Check if the array is valid and has at least two elements
    if (!Array.isArray(arr) || arr.length < 2) {
        return null;
    }

    const length = arr.length;
    let index1 = Math.floor(Math.random() * length);
    let index2;

    // Generate a second random index, ensuring it is unique (not the same as index1)
    do {
        index2 = Math.floor(Math.random() * length);
    } while (index1 === index2);

    // Return the elements at the two unique random indices
    return [arr[index1], arr[index2]];
}

// The initialization function
export async function initializeLLM() {
    console.log("Initializing WebLLM...");
    try {
        const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

        // Callback function to update model loading progress
        const initProgressCallback = (initProgress) => {
            console.log(initProgress);
        }

        const MODEL_NAME = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC"
        
        llmInference = await CreateMLCEngine(
            MODEL_NAME,
            { initProgressCallback: initProgressCallback }, // engineConfig
        );

        console.log('Model loaded!');
        console.log(`WebLLM Model (${MODEL_NAME}) Loaded and ready for client-side inference.`);

    } catch (e) {
        console.error("Failed to initialize WebLLM or load model weights. Check WebGPU support.", e);
        throw new Error("Initialization failed: Could not load WebLLM AI system.");
    }
}


/**
 * Core LLM command function used for state updates (GAME_STATE_SCHEMA).
 * @param {string} prompt - The prompt containing the player's last guess and game context.
 */
async function runLLM_Command(prompt) {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

    const fullPrompt = prompt + "\n\nOutput must be STRICTLY VALID JSON matching the required schema.";

    const messages = [{ role: "user", content: fullPrompt }];

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
    
    // --- Start Robust JSON Cleaning & Parsing (IMPROVED TRIMMING) ---
    let jsonString = fullResponseText.trim();
    
    // 1. Find the first opening curly brace '{'
    const firstBracketIndex = jsonString.indexOf('{');
    if (firstBracketIndex > -1) {
        jsonString = jsonString.substring(firstBracketIndex);
    } else {
        throw new Error("LLM Output did not contain a JSON start bracket '{'.");
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
    
    // 4. Final check for non-JSON characters (mostly redundant now, but safer)
    while (jsonString.endsWith('.') || jsonString.endsWith('\n')) {
        jsonString = jsonString.slice(0, -1).trim();
    }

    try {
        const result = JSON.parse(jsonString);
        
        // 5. Validate the result against GAME_STATE_SCHEMA requirements
        if (!result.challenge_difficulty || result.score_adjustment === undefined || !result.context_summary) {
            throw new Error("Parsed JSON is missing required GAME_STATE schema fields.");
        }
        
        return result;

    } catch (e) {
        console.error("Failed to parse cleaned JSON string:", jsonString, e); 
        throw new Error(`Failed to parse LLM output. Raw string was: ${fullResponseText}`);
    }
}


/**
 * LLM command function used for topic generation (TOPIC_SCHEMA).
 */
async function runLLM_Topic_Command(prompt) {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

    const fullPrompt = prompt + "\n\nOutput must be STRICTLY VALID JSON matching the required schema.";

    const messages = [
        { 
            role: "user", 
            content: fullPrompt 
        }
    ];

    let fullResponseText = "";
    
    // 2. Call the chat.completions.create method with stream: true
    const stream = await llmInference.chat.completions.create({
        messages: messages,
        stream: true, // Enable streaming
        temperature: 0.3
    });

    // 3. Process the streaming output
    for await (const chunk of stream) {
        const content = chunk.choices[0].delta.content;
        
        if (content) {
            fullResponseText += content;
        }
    }
    
    let jsonString = fullResponseText.trim();

    // 1. Find the first opening curly brace '{'
    const firstBracketIndex = jsonString.indexOf('{');
    if (firstBracketIndex > -1) {
        // Discard everything before the first '{'
        jsonString = jsonString.substring(firstBracketIndex);
    } else {
        // If no bracket found, something is critically wrong
        throw new Error("LLM Output did not contain a JSON start bracket '{'.");
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

    // Now, attempt to parse the cleaned string
    try {
        const result = JSON.parse(jsonString);
        
        // 5. Verification: Check if the required fields are present
        if (!result.topics || !result.conductor_comment) {
            console.error("Parsed JSON is missing required fields (topics or conductor_comment):", result);
            throw new Error("LLM output parsed, but schema validation failed.");
        }
        
        return result; // Returns { topics: [...], conductor_comment: "..." }

    } catch (e) {
        console.error("Failed to parse cleaned JSON string:", jsonString, e);
        throw new Error(`Failed to parse LLM output. Raw string was: ${fullResponseText}`);
    }
}


/**
 * Generates three random topics from the LLM.
 * The LLM will be constrained to output an object matching TOPIC_SCHEMA.
 */
export async function getNewTopics() {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

   // FIX: Made the prompt extremely explicit about the required fields and what to exclude.
    const systemPrompt = `You are the Game Conductor. Your first task is to interact with the player using an ${gameState.conversation_tone} tone and announce that these are the 2 categories to choose.
    Place your greeting into the 'conductor_comment' field. Your response MUST be a STRICTLY VALID JSON object matching the TOPIC_SCHEMA. DO NOT include questions, answers, or any other fields.`


    const data = await runLLM_Topic_Command(systemPrompt);

    return { topics: data.topics || ['Default Topic 1', 'Default Topic 2', 'Default Topic 3'], conductor_comment: data.conductor_comment || "Welcome!" };

}


/**
 * LLM command function used for question generation (QUESTION_SCHEMA).
 */
async function runLLM_Question_Command(prompt) {
    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

    const messages = [{
        role: "user",
        content: prompt
    }];

    let fullResponseText = "";

    // 2. Call the chat.completions.create method with stream: true
    const stream = await llmInference.chat.completions.create({
        messages: messages,
        stream: true, // Enable streaming
        temperature: 0.1
    });

    for await (const chunk of stream) {
        const content = chunk.choices[0].delta.content;

        if (content) {
            fullResponseText += content;
        }
    }
    
    // --- Start Robust JSON Cleaning & Parsing (IMPROVED TRIMMING) ---
    let jsonString = fullResponseText.trim();
    
    // 1. Find the first opening curly brace '{' (where JSON must begin)
    const firstBracketIndex = jsonString.indexOf('{');
    if (firstBracketIndex > -1) {
        jsonString = jsonString.substring(firstBracketIndex);
    } else {
        throw new Error("LLM Output did not contain a JSON start bracket '{'.");
    }

    // 2. Find the last closing curly brace '}' and aggressively truncate everything after it.
    let lastBracketIndex = jsonString.lastIndexOf('}');
    if (lastBracketIndex > -1) {
        // Keep everything up to and including the last '}'
        jsonString = jsonString.substring(0, lastBracketIndex + 1);
    }
    
    // 3. Remove trailing markdown fences (e.g., ```)
    if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.lastIndexOf('```')).trim();
    }
    
    // 4. Final check for non-JSON characters
    while (jsonString.endsWith('.') || jsonString.endsWith('\n')) {
        jsonString = jsonString.slice(0, -1).trim();
    }


    try {
        const result = JSON.parse(jsonString);
        
        // 5. Validate the result against the schema requirements
        if (!result.question_text || !result.options || !result.correct_answer || !result.conductor_comment ) {
             throw new Error("Parsed JSON is missing required question schema fields.");
        }
        
        return result; // Returns the parsed object matching QUESTION_SCHEMA

    } catch (e) {
        console.error("Failed to parse cleaned JSON string:", jsonString, e);
        throw new Error(`Failed to parse LLM output. Raw string was: ${fullResponseText}`);
    }
}


/**
* Generates the next challenge state from the LLM, enforcing JSON output.
 * @param {string} playerInput - The player's attempt OR the new topic.
 */
export async function getNextChallenge(playerInput, isTopicSelection = false) {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

    const systemPrompt = `You are the Music Quiz Master and Game Conductor. Your task is to generate the NEXT trivia challenge (question, 4 options, correct answer, and a comment. The player has chosen the topic: "${playerInput}". 
    Generate a new question, 4 options with one of them being the correct answer based on this topic and current difficulty:${gameState.difficulty}, and a short witty comment related to the question;
    Avoid extremely long questions. Keep it short.
    Output must be STRICTLY VALID JSON matching the QUESTION_SCHEMA.`;


    const data = await runLLM_Question_Command(systemPrompt);
    
    // Return structure uses correct property notation.
    return { 
        question: data.question_text, 
        options: data.options, 
        correct_answer: data.correct_answer, 
        conductor_comment: data.conductor_comment
    }

}

export async function updateStatus(playerInput) {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }
    const systemPrompt = `The player guessed: "${playerInput}". The previous topic was "${gameState.last_topic}". Evaluate if the guess was correct (match the previous correct_answer). Adjust the score and difficulty. Generate a new question, options, and correct answer based on the previous topic.;
    The player's current game state is: Score ${gameState.score}, Difficulty ${gameState.difficulty}, Conversation Tone: ${gameState.conversation_tone}. Last Summary: ${gameState.game_history}.
    RULES:
    1. If the player was CORRECT, set 'score_adjustment' to +1, set 'conversation_tone' to 'Thrilled', and increase 'challenge_difficulty' (Easy -> Medium -> Hard) if possible.
    2. If the player was INCORRECT, set 'score_adjustment' to -1, set 'conversation_tone' to 'Normal', and keep difficulty the same or decrease it.
    3. If the score is 3 or larger, consider setting 'conversation_tone' to 'Sassy' or 'Challenging' to increase engagement.
    4. The 'conductor_comment' must be engaging and react to the player's guess, matching the required Conversation Tone.
    5. The 'options' array must contain exactly four answers, one of which must EXACTLY match the 'correct_answer' field.
    6. Output must be STRICTLY VALID JSON matching the GAME_STATE_SCHEMA.`;
 
    return await runLLM_Command(systemPrompt);

}