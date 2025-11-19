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

    "required": ["challenge_difficulty", "question_text", "correct_answer", "options", "score_adjustment", "context_summary"]

};


const TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "description": "An array containing exactly three distinct trivia topics.",
            "items": { "type": "string" },
            "minItems": 3,
            "maxItems": 3
        },
        "conductor_comment": { 
            "type": "string",
            "description": "The comment for the player, matching the required conversation tone."
        }
    },
    "required": ["topics", "conductor_comment"]
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

//const MODEL_NAME = "Llama-3-8B-Instruct-q4f32_1"; //"TinyLlama-1.1B-Chat-v0.4-q4f32_1";//""; // A powerful model compatible with WebLLM


// Helper function to delay execution

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}





// The initialization function

export async function initializeLLM() {

    console.log("Initializing WebLLM...");
    try {
    
        //const webllm = await import ("https://esm.run/@mlc-ai/web-llm");
        
        const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');

        // Callback function to update model loading progress
        const initProgressCallback = (initProgress) => {
          console.log(initProgress);

        }

    //    TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC
//Llama-3.1-8B-q4f32_1-MLC -
        const MODEL_NAME = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC" //"gemma-2-27b-it-q0f16-MLC"//"SmolLM2-135M-Instruct-q4f32_1" //"TinyLlama-1.1B-Chat-v0.4-q4f32\_1-1k" //"Llama-3.1-8B-Instruct-q4f32_1-MLC";
       
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

async function runLLM_Command(prompt) {

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
    try {
        const result = JSON.parse(stream.Strip());
        
        return result; // Returns { topics: [...], conductor_comment: "..." }

    } catch (e) {
        console.error("Failed to parse cleaned JSON string:", jsonString, e);
        throw new Error(`Failed to parse LLM output. Raw string was: ${fullResponseText}`);
    }
}



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

    const firstBracketIndex = jsonString.indexOf('{');
    
    if (firstBracketIndex > -1) {
        // Discard everything before the first '{'
        jsonString = jsonString.substring(firstBracketIndex);
    } else {
        // If no bracket found, something is critically wrong
        throw new Error("LLM Output did not contain a JSON start bracket '{'.");
    }

    // 2. Remove trailing markdown fences (e.g., ```) if they exist
    if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.lastIndexOf('```')).trim();
    }
    
    // 3. Remove trailing periods or newlines that often follow the closing bracket
    while (jsonString.endsWith('.') || jsonString.endsWith('\n')) {
        jsonString = jsonString.slice(0, -1).trim();
    }

    // Now, attempt to parse the cleaned string
    try {
        const result = JSON.parse(jsonString);
        
        // 4. Verification: Check if the required fields are present
        if (!result.topics || !result.conductor_comment) {
            console.error("Parsed JSON is missing required fields:", result);
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

   // Adjust system prompt to also generate the initial comment using the tone

    const systemPrompt = `You are the Game Conductor. Your first task is to interact with the player using an ${gameState.conversation_tone} tone and provide three random trivia topics.
    Topics must be chosen from a mixture of these categories: Music, Travel, Sports, U2, Gay pop culture, Metallica, Entertainment, and San Francisco culture. Keep the topics simple no more than 5 words.
    Place your greeting into the 'conductor_comment' field. Output MUST be STRICTLY VALID JSON matching the TOPIC_SCHEMA. DO NOT include any text outside of the JSON structure.`;

    const data = await runLLM_Topic_Command(systemPrompt);

    return { topics: data.topics || ['Default Topic 1', 'Default Topic 2', 'Default Topic 3'], comment: data.conductor_comment || "Welcome!" };

}



async function runLLM_Question_Command(prompt) {
    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }

    const fullPrompt = prompt + "\n\nOutput must be STRICTLY VALID JSON matching the required schema.";

    const messages = [{
        role: "user",
        content: fullPrompt
    }];

    let fullResponseText = "";

    // 2. Call the chat.completions.create method with stream: true
    const stream = await llmInference.chat.completions.create({
        messages: messages,
        stream: true, // Enable streaming
        temperature: 0.3
    });

    for await (const chunk of stream) {
        const content = chunk.choices[0].delta.content;

        if (content) {
            fullResponseText += content;
        }
    }
    
    // --- Start Robust JSON Cleaning & Parsing ---
    let jsonString = fullResponseText.trim();
    
    // 1. Find the first opening curly brace '{' (where JSON must begin)
    const firstBracketIndex = jsonString.indexOf('{');
    if (firstBracketIndex > -1) {
        jsonString = jsonString.substring(firstBracketIndex);
    } else {
        throw new Error("LLM Output did not contain a JSON start bracket '{'.");
    }

    // 2. Remove trailing markdown fences (e.g., ```)
    if (jsonString.endsWith('```')) {
        jsonString = jsonString.substring(0, jsonString.lastIndexOf('```')).trim();
    }
    
    // 3. Remove trailing characters that might follow the closing bracket
    while (jsonString.endsWith('.') || jsonString.endsWith('\n')) {
        jsonString = jsonString.slice(0, -1).trim();
    }

    try {
        const result = JSON.parse(jsonString);
        
        // 4. Validate the result against the schema requirements (optional but recommended)
        if (!result.question_text || !result.options || !result.correct_answer || !result.conductor_comment  ) {
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


    const data =  runLLM_Question_Command(systemPrompt);
    return { question: data.question_text, options: data.options, correct_answer = data.correct_answer, conductor_comment = data.conductor_comment}

}

export async function updateStatus(playerInput) {

    if (!llmInference) {
        throw new Error("LLM not initialized.");
    }
    const systemPrompt = `The player guessed: "${playerInput}". The previous topic was "${gameState.last_topic}". Evaluate if the guess was correct (match the previous correct_answer). Adjust the score and difficulty. Generate a new question, options, and correct answer based on the previous topic.;
   The player's current game state is: Score ${gameState.score}, Difficulty ${gameState.difficulty}, Conversation Tone: ${gameState.conversation_tone}. Last Summary: ${gameState.game_history}.
    RULES:
    1. If the player was CORRECT, set 'score_adjustment' to +1, use an 'Excited' tone setting conversationn tone to 'Excited', and increase 'challenge_difficulty' (Easy -> Medium -> Hard) if possible.
    2. If the player was INCORRECT, set 'score_adjustment' to -1, use a 'Normal' tone setting conversationn tone to 'Normal', and keep difficulty the same or decrease it.
    3. If the score is 3 or larger, use a 'Sassy' tone setting conversationn tone to 'Sassy'.
    4. If the score is 3 or larger, use a 'Challenging' tone setting conversationn tone to 'Challenging'.
    5. The 'conductor_comment' must be engaging and react to the player's guess, matching the required Conversation Tone.
    6. The 'options' array must contain exactly four answers, one of which must EXACTLY match the 'correct_answer' field.
    7. Output must be STRICTLY VALID JSON matching the GAME_STATE_SCHEMA.`;
 
    return await runLLMCommand(systemPrompt);

}
