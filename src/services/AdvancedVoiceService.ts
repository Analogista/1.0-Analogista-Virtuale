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
    private currentAudio: HTMLAudioElement | null = null;
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private isPaused = false;
    private recognition: any = null;
    private dynamicApiKey: string | null = null;
    private activeRejects: ((reason?: any) => void)[] = [];

    constructor() {
        this.synthesis = window.speechSynthesis;
        this.motionDetector = new MotionDetectionService();
        try { this.synthesis.getVoices(); } catch (e) {}
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'it-IT';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
        }
    }

    private isPackaged() { return !!(window as any).Capacitor; }

    public setApiKey(key: string) { this.dynamicApiKey = key; }
    async initializeDetector(videoElement: HTMLVideoElement) { await this.motionDetector.initialize(videoElement); }
    public startManualDetection() { if (this.isPaused) return; this.motionDetector.startDetection(); this.dispatchStatus('listening', 'Rilevamento manuale attivo'); }
    public stopManualDetection() { this.motionDetector.stopDetection(); this.dispatchStatus('idle', ''); }
    public updateSensitivity(value: number) { this.motionDetector.setSensitivity(value); }

    public pause() {
        this.isPaused = true;
        if (this.currentAudio && !this.currentAudio.paused) this.currentAudio.pause();
        if (this.synthesis.speaking) this.synthesis.pause();
        if (this.isWaitingForResponse || this.motionDetector['isDetecting']) this.motionDetector.stopDetection();
        if (this.recognition) { try { this.recognition.stop(); } catch (e) {} }
        if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
        this.dispatchStatus('idle', '⏸️ TEST IN PAUSA');
    }

    public resume(currentPromptForRedetection?: string) {
        this.isPaused = false;
        this.dispatchStatus('idle', 'Ripresa in corso...');
        if (this.currentAudio && this.currentAudio.paused) {
            this.currentAudio.play().catch(e => console.error("Resume audio failed", e));
            this.dispatchStatus('speaking', 'Ripresa audio...');
        } else if (this.synthesis.paused) {
            this.synthesis.resume();
            this.dispatchStatus('speaking', 'Ripresa audio...');
        }
        if (this.isWaitingForResponse) {
            this.dispatchStatus('listening', 'Attendo una risposta (Oscilla SI/NO)...');
            this.motionDetector.startDetection();
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
        if (this.currentAudio) { this.currentAudio.pause(); this.currentAudio = null; }
        this.synthesis.cancel();
        this.currentUtterance = null;
        this.motionDetector.stopDetection();
        this.stopListening();
        if (this.responseTimeout) clearTimeout(this.responseTimeout);
        if (this.movementHandler) window.removeEventListener('movementDetected', this.movementHandler);
        this.dispatchStatus('idle', '');
    }

    public listenForCommand(command: string, callback: () => void) {
        if (!this.recognition || this.isPaused) return;
        this.dispatchStatus('listening', `Dì "${command}" per iniziare...`);
        setTimeout(() => { try { if (!this.isPaused) this.recognition.start(); } catch (e) {} }, 500);
        this.recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript.toLowerCase().trim();
            if (transcript.includes(command.toLowerCase()) || transcript.includes('via') || transcript.includes('parti') || transcript.includes('start')) {
                this.dispatchStatus('speaking', 'Comando ricevuto.');
                playFeedbackSound('positive');
                callback();
            } else {
                setTimeout(() => { try { if (!this.isPaused) this.recognition.start(); } catch (e) {} }, 500);
            }
        };
        this.recognition.onerror = (event: any) => {
            if (event.error !== 'aborted' && !this.isPaused) {
                setTimeout(() => { try { if (!this.isPaused) this.recognition.start(); } catch (e) {} }, 1000);
            }
        };
    }

    public stopListening() { if (this.recognition) this.recognition.stop(); }

    private dispatchStatus(status: 'speaking' | 'listening' | 'idle', text: string) {
        window.dispatchEvent(new CustomEvent('voiceStatusUpdate', { detail: { status, text } }));
    }

    askQuestion(question: string, userName = ''): Promise<AutomatedResponse> {
        return new Promise((resolve, reject) => {
            this.activeRejects.push(reject);
            const execute = async () => {
                if (this.isPaused) return;
                this.isWaitingForResponse = true;
                const questionText = question.replace(/\(nome\)/g, userName);
                await this.speak(questionText);
                if (this.isPaused) return;
                setTimeout(() => { if (!this.isPaused) this.startResponseDetection(resolve, reject); }, 500);
            };
            execute();
        });
    }

    private startResponseDetection(resolve: (value: AutomatedResponse) => void, reject: (reason?: any) => void) {
        this.motionDetector.startDetection();
        this.dispatchStatus('listening', 'Attendo una risposta (Oscilla SI/NO)...');
        if (this.movementHandler) window.removeEventListener('movementDetected', this.movementHandler);
        this.movementHandler = async (event: CustomEvent) => {
            if (this.isWaitingForResponse && !this.isPaused) {
                const direction = event.detail.direction;
                this.stopResponseDetection();
                let response: AutomatedResponse;
                if (direction === 'forward') response = 'SI';
                else if (direction === 'backward') response = 'NO';
                else response = 'NON_RILEVATO';
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
        if (this.movementHandler) { window.removeEventListener('movementDetected', this.movementHandler); this.movementHandler = null; }
        if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
    }

    public stopSpeaking() { this.cancel(); }
    public calibrateDetector() { this.motionDetector.calibrate(); }
    public startDetection() { this.motionDetector.startDetection(); }
    public stopDetection() { this.motionDetector.stopDetection(); }

    // VOCE NATIVA del dispositivo (app installata Android): motore TTS di sistema, offline, sempre affidabile
    private async nativeSpeak(text: string): Promise<boolean> {
        if (!this.isPackaged()) return false;
        try {
            const mod: any = await import('@capacitor-community/text-to-speech');
            await mod.TextToSpeech.speak({ text, lang: 'it-IT', rate: 0.95, pitch: 1.0, volume: 1.0, category: 'playback' });
            return true;
        } catch (e) {
            console.warn('Native TTS failed, uso fallback:', e);
            return false;
        }
    }

    async speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.activeRejects.push(reject);
            const execute = async () => {
                if (this.isPaused) { resolve(); return; }
                if (this.currentAudio) { this.currentAudio.pause(); this.currentAudio = null; }
                if (this.synthesis.speaking) this.synthesis.cancel();
                this.dispatchStatus('speaking', text);

                // 0. Nell'app installata parla subito il motore vocale del telefono
                if (await this.nativeSpeak(text)) {
                    if (!this.isPaused) { resolve(); this.activeRejects = this.activeRejects.filter(r => r !== reject); }
                    return;
                }

                // 1. Google Cloud TTS (solo online e solo con chiave)
                const apiKey = navigator.onLine ? (this.dynamicApiKey || localStorage.getItem('GOOGLE_API_KEY') || INTERNAL_FALLBACK_KEY) : '';
                if (apiKey) {
                    try {
                        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                input: { text },
                                voice: { languageCode: 'it-IT', name: 'it-IT-Neural2-A' },
                                audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 }
                            })
                        });
                        if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || response.statusText); }
                        const data = await response.json();
                        if (data.audioContent) {
                            const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
                            this.currentAudio = audio;
                            audio.onended = () => { this.currentAudio = null; if (!this.isPaused) { resolve(); this.activeRejects = this.activeRejects.filter(r => r !== reject); } };
                            audio.onerror = () => { this.currentAudio = null; resolve(); };
                            await audio.play();
                            return;
                        }
                    } catch (error) { console.warn("Cloud TTS failed (Using Browser Fallback). Reason:", error); }
                }

                // 2. Fallback browser RINFORZATO (sblocco Android + rete di sicurezza anti-blocco)
                setTimeout(() => {
                    let settled = false;
                    let safety: number | undefined, kick: number | undefined, retryT: number | undefined;
                    const done = () => {
                        if (settled) return;
                        settled = true;
                        if (safety) clearTimeout(safety);
                        if (kick) clearTimeout(kick);
                        if (retryT) clearTimeout(retryT);
                        this.currentUtterance = null;
                        if (!this.isPaused) { resolve(); this.activeRejects = this.activeRejects.filter(r => r !== reject); }
                    };
                    safety = window.setTimeout(done, Math.max(20000, text.length * 150));
                    kick = window.setTimeout(() => { try { this.synthesis.resume(); } catch (e) {} }, 250);
                    const buildAndSpeak = () => {
                        try { this.synthesis.cancel(); this.synthesis.resume(); } catch (e) {}
                        const utterance = new SpeechSynthesisUtterance(text);
                        this.currentUtterance = utterance;
                        utterance.lang = 'it-IT';
                        utterance.rate = 0.95;
                        utterance.volume = 1.0;
                        const voices = this.synthesis.getVoices();
                        const selectedVoice = voices.find(v => v.name.includes("Microsoft Elsa") && v.lang.includes('it')) ||
                            voices.find(v => v.name.includes("Google italiano")) ||
                            voices.find(voice => voice.lang.includes('it'));
                        if (selectedVoice) utterance.voice = selectedVoice;
                        utterance.onend = done;
                        utterance.onerror = done;
                        this.synthesis.speak(utterance);
                    };
                    buildAndSpeak();
                    retryT = window.setTimeout(() => { if (!settled && !this.synthesis.speaking) buildAndSpeak(); }, 1200);
                }, 100);
            };
            execute();
        });
    }
}
