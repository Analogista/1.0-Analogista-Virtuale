
import { MotionDetectionService } from './MotionDetectionService';
import { playFeedbackSound } from '../utils/sound';

export type AutomatedResponse = 'SI' | 'NO' | 'NON_RILEVATO';

// Chiave rimossa. Se l'utente non fornisce una chiave, si userà la sintesi vocale del browser (gratuita/offline).
const INTERNAL_FALLBACK_KEY = "";

export class AdvancedVoiceService {
    private synthesis: SpeechSynthesis;
    private motionDetector: MotionDetectionService;
    private isWaitingForResponse = false;
    private responseTimeout: number | null = null;
    private movementHandler: ((event: any) => void) | null = null;
    
    // Cloud TTS Audio Management
    private currentAudio: HTMLAudioElement | null = null;
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private isPaused = false;
    
    // Riconoscimento Vocale (Speech Recognition)
    private recognition: any = null;
    
    // Chiave dinamica iniettabile
    private dynamicApiKey: string | null = null;

    constructor() {
        this.synthesis = window.speechSynthesis;
        this.motionDetector = new MotionDetectionService();
        
        // Inizializza SpeechRecognition (se supportato)
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'it-IT';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
        }
    }

    public setApiKey(key: string) {
        this.dynamicApiKey = key;
    }

    async initializeDetector(videoElement: HTMLVideoElement) {
        await this.motionDetector.initialize(videoElement);
    }

    public startManualDetection() {
        if (this.isPaused) return;
        this.motionDetector.startDetection();
        this.dispatchStatus('listening', 'Rilevamento manuale attivo');
    }

    public stopManualDetection() {
        this.motionDetector.stopDetection();
        this.dispatchStatus('idle', '');
    }
    
    public updateSensitivity(value: number) {
        this.motionDetector.setSensitivity(value);
    }

    // --- PAUSE / RESUME LOGIC ---

    public pause() {
        this.isPaused = true;
        
        // 1. Pause Audio (Cloud TTS)
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
        }
        // Fallback: Pause Browser Synthesis
        if (this.synthesis.speaking) {
            this.synthesis.pause();
        }

        // 2. Stop Motion Detection (to prevent accidental triggers)
        if (this.isWaitingForResponse || this.motionDetector['isDetecting']) {
            this.motionDetector.stopDetection();
        }

        // 3. Pause Speech Recognition
        if (this.recognition) {
            try { this.recognition.stop(); } catch(e) {
                // Ignore stop errors if already stopped
            }
        }

        if (this.responseTimeout) {
            clearTimeout(this.responseTimeout);
            this.responseTimeout = null;
        }

        this.dispatchStatus('idle', '⏸️ TEST IN PAUSA');
    }

    public resume(currentPromptForRedetection?: string) {
        this.isPaused = false;
        this.dispatchStatus('idle', 'Ripresa in corso...');

        // 1. Resume Audio
        if (this.currentAudio && this.currentAudio.paused) {
            this.currentAudio.play().catch(e => console.error("Resume audio failed", e));
            this.dispatchStatus('speaking', 'Ripresa audio...');
        } else if (this.synthesis.paused) {
            this.synthesis.resume();
            this.dispatchStatus('speaking', 'Ripresa audio...');
        }

        // 2. Resume Motion Detection if we were waiting
        if (this.isWaitingForResponse) {
             this.dispatchStatus('listening', 'Attendo una risposta (Oscilla SI/NO)...');
             this.motionDetector.startDetection();
             
             // Re-set the timeout for safety
             this.responseTimeout = window.setTimeout(async () => {
                if (this.isWaitingForResponse && !this.isPaused) {
                    this.stopResponseDetection();
                    await this.speak("Tempo scaduto. Non ho rilevato nessun movimento.");
                }
            }, 12000);
        }
    }

    public cancel() {
        this.activeRejects.forEach(reject => reject(new Error("CANCELLED")));
        this.activeRejects = [];
        this.isPaused = false;
        this.isWaitingForResponse = false;
        
        // Stop Cloud TTS
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        // Stop Browser TTS
        this.synthesis.cancel();
        this.currentUtterance = null;
        
        this.motionDetector.stopDetection();
        this.stopListening();
        if (this.responseTimeout) clearTimeout(this.responseTimeout);
        if (this.movementHandler) window.removeEventListener('movementDetected', this.movementHandler);
        this.dispatchStatus('idle', '');
    }

    // ----------------------------
    
    public listenForCommand(command: string, callback: () => void) {
        if (!this.recognition || this.isPaused) return;

        this.dispatchStatus('listening', `Dì "${command}" per iniziare...`);
        
        setTimeout(() => {
            try {
                if(!this.isPaused) this.recognition.start();
            } catch (e) {
                // Ignore start errors
            }
        }, 500);
        
        this.recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            
            if (transcript.includes(command.toLowerCase()) || 
                transcript.includes('via') || 
                transcript.includes('parti') || 
                transcript.includes('start')) {
                this.dispatchStatus('speaking', `Comando ricevuto.`);
                playFeedbackSound('positive');
                callback();
            } else {
                 setTimeout(() => {
                    try { if(!this.isPaused) this.recognition.start(); } catch(e) {
                        // Ignore restart errors
                    }
                 }, 500);
            }
        };

        this.recognition.onerror = (event: any) => {
            if (event.error !== 'aborted' && !this.isPaused) {
                 setTimeout(() => {
                    try { if(!this.isPaused) this.recognition.start(); } catch(e) {
                        // Ignore restart errors
                    }
                 }, 1000);
            }
        };
    }
    
    public stopListening() {
        if (this.recognition) {
            this.recognition.stop();
        }
    }

    private dispatchStatus(status: 'speaking' | 'listening' | 'idle', text: string) {
        window.dispatchEvent(new CustomEvent('voiceStatusUpdate', {
            detail: { status, text }
        }));
    }

    askQuestion(question: string, userName = ''): Promise<AutomatedResponse> {
        return new Promise((resolve, reject) => {
            this.activeRejects.push(reject);
            const execute = async () => {
                if (this.isPaused) return; 
                
                this.isWaitingForResponse = true;
                const questionText = question.replace(/\(nome\)/g, userName);

                await this.speak(questionText);

                if (this.isPaused) {
                    return; 
                }

                setTimeout(() => {
                    if (!this.isPaused) {
                        this.startResponseDetection(resolve);
                    }
                }, 500);
            };
            execute();
        });
    }

    private startResponseDetection(resolve: (value: AutomatedResponse) => void) {
        this.motionDetector.startDetection();
        this.dispatchStatus('listening', 'Attendo una risposta (Oscilla SI/NO)...');

        if (this.movementHandler) {
             window.removeEventListener('movementDetected', this.movementHandler);
        }

        this.movementHandler = async (event: CustomEvent) => {
            if (this.isWaitingForResponse && !this.isPaused) {
                // Rimuoviamo il filtro per serviceId per permettere a questa istanza di 
                // ascoltare eventi provenienti anche da altri detector (es. quello di CameraView)
                // in modo da massimizzare le probabilità di catturare il movimento.
                
                const direction = event.detail.direction;
                
                this.stopResponseDetection();

                let response: AutomatedResponse;

                if (direction === 'forward') {
                    response = 'SI';
                } else if (direction === 'backward') {
                    response = 'NO';
                } else {
                    response = 'NON_RILEVATO';
                }
                
                const feedbackText = response === 'SI' ? "Ho rilevato un SÌ." : response === 'NO' ? "Ho rilevato un NO." : "Non ho capito.";
                await this.speak(feedbackText);
                resolve(response);
                this.activeRejects = this.activeRejects.filter(r => r !== reject);
            }
        };

        window.addEventListener('movementDetected', this.movementHandler);

        if (this.responseTimeout) clearTimeout(this.responseTimeout);

        this.responseTimeout = window.setTimeout(async () => {
            if (this.isWaitingForResponse && !this.isPaused) {
                this.stopResponseDetection();
                await this.speak("Non ho rilevato nessun movimento.");
                resolve('NON_RILEVATO');
                this.activeRejects = this.activeRejects.filter(r => r !== reject);
            }
        }, 12000); 
    }

    private stopResponseDetection() {
        this.isWaitingForResponse = false;
        this.motionDetector.stopDetection();
        this.dispatchStatus('idle', '');

        if (this.movementHandler) {
            window.removeEventListener('movementDetected', this.movementHandler);
            this.movementHandler = null;
        }

        if (this.responseTimeout) {
            clearTimeout(this.responseTimeout);
            this.responseTimeout = null;
        }
    }

    public stopSpeaking() {
        this.cancel();
    }

    // --- GOOGLE CLOUD TTS IMPLEMENTATION ---
    public calibrateDetector() {
        this.motionDetector.calibrate();
    }

    public startDetection() {
        this.motionDetector.startDetection();
    }

    public stopDetection() {
        this.motionDetector.stopDetection();
    }

    async speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.activeRejects.push(reject);
            const execute = async () => {
                if (this.isPaused) return;

                // Stop existing audio
                if (this.currentAudio) {
                    this.currentAudio.pause();
                    this.currentAudio = null;
                }
                if (this.synthesis.speaking) {
                    this.synthesis.cancel();
                }

                this.dispatchStatus('speaking', text);

                // 1. Try Google Cloud TTS first
                // PRIORITÀ: 1. Chiave settata dinamicamente 2. LocalStorage 3. Fallback interno (ora vuoto)
                const apiKey = this.dynamicApiKey || localStorage.getItem('GOOGLE_API_KEY') || INTERNAL_FALLBACK_KEY;
                
                if (apiKey) {
                    try {
                        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                input: { text },
                                // Voice Selection: Italian, Neural2 (High Quality)
                                voice: { languageCode: 'it-IT', name: 'it-IT-Neural2-A' }, 
                                audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 }
                            })
                        });
                        
                        if (!response.ok) {
                            const err = await response.json();
                            throw new Error(err.error?.message || response.statusText);
                        }

                        const data = await response.json();

                        if (data.audioContent) {
                            const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
                            this.currentAudio = audio;
                            
                            audio.onended = () => {
                                this.currentAudio = null;
                                if (!this.isPaused) {
                                    resolve();
                                    this.activeRejects = this.activeRejects.filter(r => r !== reject);
                                }
                            };
                            
                            audio.onerror = (e) => {
                                console.error("Audio playback error", e);
                                this.currentAudio = null;
                                resolve(); // Resolve to not block flow
                            };

                            await audio.play();
                            return; // Successfully played Cloud TTS
                        }
                    } catch (error) {
                        console.warn("Cloud TTS failed (Using Browser Fallback). Reason:", error);
                        // Continua per usare il fallback sotto
                    }
                }

                // 2. Fallback to Browser SpeechSynthesis
                setTimeout(() => {
                    const utterance = new SpeechSynthesisUtterance(text);
                    this.currentUtterance = utterance;
                    
                    utterance.lang = 'it-IT';
                    utterance.rate = 0.95; 
                    
                    const voices = this.synthesis.getVoices();
                    // Fallback voice selection logic
                    const selectedVoice = voices.find(v => v.name.includes("Microsoft Elsa") && v.lang.includes('it')) || 
                                        voices.find(v => v.name.includes("Google italiano")) ||
                                        voices.find(voice => voice.lang.includes('it'));
                                        
                    if (selectedVoice) utterance.voice = selectedVoice;

                    utterance.onend = () => {
                        this.currentUtterance = null;
                        if (!this.isPaused) {
                                    resolve();
                                    this.activeRejects = this.activeRejects.filter(r => r !== reject);
                                }
                    };
                    utterance.onerror = () => {
                        this.currentUtterance = null;
                        resolve();
                    };
                    
                    this.synthesis.speak(utterance);
                }, 100);
            };
            execute();
        });
    }
}
