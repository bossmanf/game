import React, { useState, useEffect, useMemo } from 'react';
import { Volume2, VolumeX, Play, Pause, RefreshCcw, Loader2 } from 'lucide-react';

// Mock API Call and Data Structure
const useTriviaData = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Simulate fetching complex music trivia questions
    const mockFetch = () => {
      setLoading(true);
      setError(null);
      setTimeout(() => {
        try {
          const mockQuestions = [
            {
              id: 1,
              question: "Which band released the iconic 1971 album 'Led Zeppelin IV'?",
              options: ["Deep Purple", "Black Sabbath", "Led Zeppelin", "The Who"],
              answer: "Led Zeppelin",
              genre: "Rock",
            },
            {
              id: 2,
              question: "Who is known as the 'Queen of Pop' and released the album 'Like a Prayer'?",
              options: ["Janet Jackson", "Cher", "Madonna", "Britney Spears"],
              answer: "Madonna",
              genre: "Pop",
            },
            {
              id: 3,
              question: "What is the primary instrument played by jazz legend Miles Davis?",
              options: ["Saxophone", "Piano", "Trumpet", "Drums"],
              answer: "Trumpet",
              genre: "Jazz",
            },
            {
              id: 4,
              question: "Which country did the band ABBA originate from?",
              options: ["Norway", "Sweden", "Finland", "Denmark"],
              answer: "Sweden",
              genre: "Pop",
            },
            {
              id: 5,
              question: "Which rapper is famous for the line: 'I got 99 problems but a ______ ain't one'?",
              options: ["Kanye West", "Eminem", "Jay-Z", "Nas"],
              answer: "Jay-Z",
              genre: "Hip-Hop",
            },
            {
              id: 6,
              question: "In what year was the first Woodstock festival held?",
              options: ["1967", "1969", "1971", "1973"],
              answer: "1969",
              genre: "Rock",
            },
            {
              id: 7,
              question: "Which classical composer wrote 'Für Elise'?",
              options: ["Mozart", "Bach", "Beethoven", "Chopin"],
              answer: "Beethoven",
              genre: "Classical",
            },
            {
              id: 8,
              question: "What is the name of Taylor Swift's 2020 surprise album, released during quarantine?",
              options: ["Lover", "Evermore", "Folklore", "Midnights"],
              answer: "Folklore",
              genre: "Pop",
            },
          ];
          setData(mockQuestions);
          setLoading(false);
        } catch (e) {
          setError("Failed to load trivia data.");
          setLoading(false);
        }
      }, 1000);
    };

    mockFetch();
  }, []);

  return { data, loading, error, refetch: () => mockFetch() };
};

// Tone.js utility functions (must be defined before use in the component)

// Base64 encoding/decoding functions for audio
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Function to convert PCM audio data (Int16Array) to a WAV Blob
const pcmToWav = (pcm16, sampleRate) => {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM

    const buffer = new ArrayBuffer(44 + pcm16.length * bytesPerSample);
    const view = new DataView(buffer);

    // Write WAV file header
    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // File size (36 + data size)
    view.setUint32(4, 36 + pcm16.length * bytesPerSample, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 = PCM)
    view.setUint16(20, 1, true);
    // number of channels
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    // block align (NumChannels * BitsPerSample/8)
    view.setUint16(32, numChannels * bytesPerSample, true);
    // bits per sample
    view.setUint16(34, bytesPerSample * 8, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, pcm16.length * bytesPerSample, true);

    // Write the PCM data
    let offset = 44;
    for (let i = 0; i < pcm16.length; i++, offset += bytesPerSample) {
        view.setInt16(offset, pcm16[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
};

// Helper function for writing strings to DataView
const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

// API Key and URL for Gemini TTS
const apiKey = "";
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

// Component for fetching and playing the TTS audio
const TtsPlayer = ({ textToSpeak, isMuted }) => {
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Memoize the audio element to prevent re-creation
  const audioRef = useMemo(() => {
    if (typeof Audio !== 'undefined') {
      const audio = new Audio();
      audio.onended = () => {
        setIsPlaying(false);
      };
      return audio;
    }
    return null;
  }, []);

  const generateAndPlay = async (text) => {
    if (!audioRef) return;

    setIsLoading(true);
    setIsPlaying(false);
    audioRef.pause();

    const prompt = `Say in a clear, informative voice: "${text}"`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Charon" } // Informative voice
                }
            }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`API call failed with status: ${response.status}`);
            }

            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
                // MimeType is "audio/L16;rate=24000"
                const match = mimeType.match(/rate=(\d+)/);
                const sampleRate = match ? parseInt(match[1], 10) : 24000;

                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);

                const newAudioUrl = URL.createObjectURL(wavBlob);
                setAudioUrl(newAudioUrl);
                audioRef.src = newAudioUrl;

                if (!isMuted) {
                  audioRef.play();
                  setIsPlaying(true);
                }
                setIsLoading(false);
                return; // Success
            } else {
                throw new Error("Invalid audio data received from API.");
            }

        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed:`, error);
            attempts++;
            if (attempts < maxAttempts) {
                const delay = Math.pow(2, attempts) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                setError("Could not generate audio after multiple retries.");
                setIsLoading(false);
            }
        }
    }
  };

  useEffect(() => {
    if (textToSpeak) {
      generateAndPlay(textToSpeak);
    }
    // Cleanup old object URL when component unmounts or text changes
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [textToSpeak]);

  const togglePlay = () => {
    if (!audioRef || !audioUrl) return;

    if (isPlaying) {
      audioRef.pause();
      setIsPlaying(false);
    } else if (!isMuted) {
      audioRef.play();
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!audioRef) return;
    audioRef.muted = isMuted;

    if (isMuted) {
      audioRef.pause();
      setIsPlaying(false);
    } else if (audioUrl) {
      // If we un-mute and audio is ready, auto-play
      audioRef.play().catch(e => console.log("Play interrupted by user interaction rules.", e));
      setIsPlaying(true);
    }
  }, [isMuted, audioUrl]);


  return (
    <div className="flex items-center space-x-2">
      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
      ) : (
        <button
          onClick={togglePlay}
          disabled={!audioUrl || isMuted}
          className={`p-2 rounded-full transition-colors ${
            !audioUrl || isMuted
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-md'
          }`}
          title={isPlaying ? "Pause Question Audio" : "Play Question Audio"}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
      )}
    </div>
  );
};


// Main Application Component
const App = () => {
  const { data: questions, loading, error, refetch } = useTriviaData();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const currentQuestion = questions ? questions[currentQuestionIndex] : null;

  useEffect(() => {
    if (questions && currentQuestionIndex < questions.length) {
      // Reset state for new question
      setSelectedOption(null);
      setShowAnswer(false);
    }
  }, [currentQuestionIndex, questions]);


  const handleAnswerSelect = (option) => {
    if (showAnswer) return; // Prevent double-clicking

    setSelectedOption(option);
    setShowAnswer(true);

    if (option === currentQuestion.answer) {
      setScore(s => s + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prevIndex => prevIndex + 1);
    } else {
      setIsGameFinished(true);
    }
  };

  const handleRestartGame = () => {
    refetch(); // Refetch/Reload questions (for real API)
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowAnswer(false);
    setSelectedOption(null);
    setIsGameFinished(false);
  };

  const getOptionClasses = (option) => {
    const baseClasses = "p-3 rounded-lg text-center cursor-pointer transition-all duration-300 shadow-md transform hover:scale-[1.02]";

    if (!showAnswer) {
      return `${baseClasses} bg-white border border-gray-200 text-gray-800 hover:bg-indigo-50 hover:border-indigo-400`;
    }

    // After answer is shown
    if (option === currentQuestion.answer) {
      return `${baseClasses} bg-green-500 text-white scale-100 ring-2 ring-green-700`; // Correct answer
    } else if (option === selectedOption && option !== currentQuestion.answer) {
      return `${baseClasses} bg-red-500 text-white scale-100 ring-2 ring-red-700`; // Selected but wrong
    } else {
      return `${baseClasses} bg-gray-100 text-gray-500 opacity-70 cursor-default`; // Unselected, wrong
    }
  };

  const renderGame = () => {
    if (loading) {
      return (
        <div className="text-center p-8">
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">Loading epic music challenges...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center p-8 bg-red-100 border border-red-400 rounded-lg">
          <p className="text-red-700 font-semibold">Error: {error}</p>
          <button
            onClick={handleRestartGame}
            className="mt-4 px-4 py-2 bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors flex items-center mx-auto"
          >
            <RefreshCcw className="w-4 h-4 mr-2" /> Try Again
          </button>
        </div>
      );
    }

    if (!currentQuestion) {
      return <p className="text-center p-8 text-gray-500">No questions available.</p>;
    }

    if (isGameFinished) {
      return (
        <div className="text-center p-10 bg-white rounded-xl shadow-2xl">
          <h2 className="text-3xl font-extrabold text-indigo-600 mb-4">Quiz Complete! 🎶</h2>
          <p className="text-xl text-gray-700 mb-6">
            You scored <span className="font-bold text-4xl text-green-600">{score}</span> out of {questions.length}!
          </p>
          <p className="text-sm text-gray-500 mb-8">
            {score === questions.length ? "Perfect score! You're a true music historian!" : "Great effort! Time to brush up on those classics."}
          </p>
          <button
            onClick={handleRestartGame}
            className="px-6 py-3 bg-indigo-500 text-white text-lg font-semibold rounded-full hover:bg-indigo-600 transition-all duration-200 shadow-lg flex items-center justify-center mx-auto"
          >
            <RefreshCcw className="w-5 h-5 mr-2" /> Play Again
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Question Counter and Mute Button */}
        <div className="flex justify-between items-center text-gray-600 font-medium">
          <div className="text-lg">
            Question {currentQuestionIndex + 1} of {questions.length}
          </div>
          <button
            onClick={() => setIsMuted(prev => !prev)}
            className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            title={isMuted ? "Unmute TTS Audio" : "Mute TTS Audio"}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5 text-green-500" />}
          </button>
        </div>

        {/* Question Card */}
        <div className="bg-white p-6 md:p-8 rounded-xl shadow-xl border-t-4 border-indigo-400">
          <div className="flex items-start mb-4 space-x-3">
            <TtsPlayer textToSpeak={currentQuestion.question} isMuted={isMuted} />
            <h3 className="text-xl md:text-2xl font-semibold text-gray-900 leading-relaxed">
              {currentQuestion.question}
            </h3>
          </div>
          <span className="inline-block px-3 py-1 text-xs font-medium text-indigo-700 bg-indigo-100 rounded-full mt-2">
            Genre: {currentQuestion.genre}
          </span>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentQuestion.options.map((option, index) => (
            <div
              key={index}
              onClick={() => handleAnswerSelect(option)}
              className={getOptionClasses(option)}
            >
              <span className="font-medium">{option}</span>
            </div>
          ))}
        </div>

        {/* Feedback and Next Button */}
        <div className="mt-8 pt-4 border-t border-gray-100 flex justify-end">
          {showAnswer && (
            <button
              onClick={handleNextQuestion}
              className="px-6 py-3 bg-indigo-500 text-white font-semibold rounded-full hover:bg-indigo-600 transition-all duration-200 shadow-lg"
            >
              {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 flex items-start justify-center">
      <div className="w-full max-w-2xl mt-10">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            🎧 Music Trivia Challenge
          </h1>
          <p className="text-gray-500 mt-2">Test your knowledge across genres and decades!</p>
          <div className="mt-4 p-2 inline-block bg-green-100 text-green-700 rounded-full text-sm font-semibold shadow-inner">
            Current Score: {score}
          </div>
        </header>
        {renderGame()}
      </div>
    </div>
  );
};

export default App;