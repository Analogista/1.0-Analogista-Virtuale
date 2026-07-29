import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export class MotionDetectionService {
    public id: string = Math.random().toString(36).substring(2, 9);
    private video: HTMLVideoElement | null = null;
    private poseLandmarker: PoseLandmarker | null = null;
    private isDetecting = false;
    private animationFrameId: number | null = null;

    // Parametri Pro V2 (INDEROGABILI)
    private smoothingFactor = 0.8; // EMA
    private currentSmoothedDepth: number | null = null;
    private neutralDepth = 0;
    private hysteresisFactor = 0.4; // 40%
    private audioDebounce = 600; // ms
    private lastAudioTrigger = 0;
    private sensitivity = 0.015; // Default Pro V2 sensitivity (scostamento necessario)
    
    // Last detection to handle hysteresis
    private lastResult: 'forward' | 'backward' | 'none' = 'none';

    async initialize(videoElement: HTMLVideoElement) {
        this.video = videoElement;
        
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
            );
            this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numPoses: 1
            });
            console.log(`✅ MediaPipe PoseLandmarker Pro V2 Inizializzato (ID: ${this.id})`);
        } catch (error) {
            console.error("❌ Errore inizializzazione MediaPipe:", error);
        }
    }

    setSensitivity(value: number) {
        // Mappiamo 0-100 a un range di sensibilità Pro V2 (0.005 - 0.05)
        // Più alto (100) -> Più sensibile (numero piccolo)
        this.sensitivity = 0.05 - (value / 100) * 0.045;
        console.log(`Sensibilità Pro V2: ${value}% (Valore: ${this.sensitivity.toFixed(4)})`);
    }

    calibrate() {
        if (this.currentSmoothedDepth !== null) {
            this.neutralDepth = this.currentSmoothedDepth;
            console.log("✅ Calibrazione Pro V2 completata. Neutral:", this.neutralDepth);
        }
    }

    startDetection() {
        if (!this.poseLandmarker || this.isDetecting) return;
        this.isDetecting = true;
        this.lastResult = 'none'; // Reset state
        this.currentSmoothedDepth = null; // Reset smoothing
        this.detect();
    }

    stopDetection() {
        this.isDetecting = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    private calculateDepth(landmarks: any): number {
        // Punti Chiave: Naso (0), Spalla Sinistra (11), Spalla Destra (12)
        const nose = landmarks[0];
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];

        if (!nose || !leftShoulder || !rightShoulder) return 0;

        // Formula della Profondità Pesata Pro V2
        const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
        const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;

        const shoulderWidth = Math.sqrt(
            Math.pow(leftShoulder.x - rightShoulder.x, 2) + 
            Math.pow(leftShoulder.y - rightShoulder.y, 2)
        );
        
        const noseToSpineDist = Math.sqrt(
            Math.pow(nose.x - midShoulderX, 2) + 
            Math.pow(nose.y - midShoulderY, 2)
        );

        // Formula Finale Distanza: (spalle * 0.7) + (naso-centro * 0.3)
        return (shoulderWidth * 0.7) + (noseToSpineDist * 0.3);
    }

    private detect = () => {
        if (!this.isDetecting || !this.video || !this.poseLandmarker) return;

        const startTimeMs = performance.now();
        const results = this.poseLandmarker.detectForVideo(this.video, startTimeMs);

        if (results.landmarks && results.landmarks.length > 0) {
            const rawDepth = this.calculateDepth(results.landmarks[0]);
            
            // EMA Smoothing Pro V2 (0.8)
            if (this.currentSmoothedDepth === null) {
                this.currentSmoothedDepth = rawDepth;
            } else {
                this.currentSmoothedDepth = (this.currentSmoothedDepth * this.smoothingFactor) + (rawDepth * (1 - this.smoothingFactor));
            }

            // Scostamento rispetto al neutro
            const offset = this.currentSmoothedDepth - this.neutralDepth;
            const threshold = this.sensitivity;
            const returnThreshold = threshold * this.hysteresisFactor;

            const currentResult: 'forward' | 'backward' | 'none' = 
                offset > threshold ? 'forward' :
                offset < -threshold ? 'backward' :
                Math.abs(offset) < returnThreshold ? 'none' :
                this.lastResult;

            // Dispatch Eventi
            const now = Date.now();
            if (currentResult !== 'none' && currentResult !== this.lastResult && now - this.lastAudioTrigger > this.audioDebounce) {
                this.lastAudioTrigger = now;
                window.dispatchEvent(new CustomEvent('movementDetected', {
                    detail: { serviceId: this.id, direction: currentResult, intensity: Math.abs(offset) }
                }));
            }

            this.lastResult = currentResult;

            // Monitor real-time (per la barra)
            window.dispatchEvent(new CustomEvent('depthUpdate', {
                detail: { 
                    serviceId: this.id,
                    depth: this.currentSmoothedDepth, 
                    delta: offset, 
                    neutral: this.neutralDepth,
                    threshold
                }
            }));

            // Dispatch landmarks for rendering
            window.dispatchEvent(new CustomEvent('landmarksProcessed', {
                detail: { serviceId: this.id, landmarks: results.landmarks[0] }
            }));
            
            // Update Center
            const nose = results.landmarks[0][0];
            if (nose) {
                window.dispatchEvent(new CustomEvent('movementCenterUpdate', {
                    detail: { serviceId: this.id, center: { x: nose.x * 100, y: nose.y * 100 } }
                }));
            }
        } else {
            // Se non ci sono landmarks, invia array vuoto per pulire il canvas
            window.dispatchEvent(new CustomEvent('landmarksProcessed', {
                detail: { serviceId: this.id, landmarks: [] }
            }));
        }

        this.animationFrameId = requestAnimationFrame(this.detect);
    }
}
