import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useUser } from '../contexts/UserContext';
import CameraView from '../components/CameraView';
import { AdvancedVoiceService } from '../services/AdvancedVoiceService';
import InfoBox from '../components/InfoBox';
import TestControls from '../components/TestControls';

const seasons = {
  Primavera: ['Marzo', 'Aprile', 'Maggio'],
  Estate: ['Giugno', 'Luglio', 'Agosto'],
  Autunno: ['Settembre', 'Ottobre', 'Novembre'],
  Inverno: ['Dicembre', 'Gennaio', 'Febbraio']
} as const;
type SeasonKey = keyof typeof seasons;
const daysInMonth: Record<string, number> = {
  Gennaio: 31, Febbraio: 28, Marzo: 31, Aprile: 30, Maggio: 31, Giugno: 30,
  Luglio: 31, Agosto: 31, Settembre: 30, Ottobre: 31, Novembre: 30, Dicembre: 31
};

interface ScreenProps { setPage: (page: number) => void; }
type Status = 'IDLE' | 'CALIBRATING' | 'TESTING' | 'SUCCESS' | 'ERROR';

const IndagineSingola: React.FC<ScreenProps> = ({ setPage }) => {
  const { userData, setUserData } = useUser();
  const [status, setStatus] = useState<Status>('IDLE');
  const [message, setMessage] = useState('Premi “Inizia” per avviare l’indagine singola 10–11–12.');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [summary, setSummary] = useState<{ age?: number; date?: string; witness?: string }>({});
  const cameraRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceService = useMemo(() => new AdvancedVoiceService(), []);

  useEffect(() => () => voiceService.cancel(), [voiceService]);

  const handleCameraReady = () => {
    if (videoRef.current) {
      voiceService.initializeDetector(videoRef.current);
      setIsCameraReady(true);
    }
  };

  const handleExit = () => {
    voiceService.cancel();
    setPage(0);
  };

  const resetTest = () => {
    voiceService.cancel();
    setStatus('IDLE');
    setIsCalibrated(false);
    setSummary({});
    setMessage('Premi “Inizia” per avviare l’indagine singola 10–11–12.');
  };

  const startCalibration = async () => {
    setStatus('CALIBRATING');
    setMessage('Rimani immobile per la calibrazione...');
    await voiceService.speak('Mettiti in piedi di fronte alla telecamera, braccia lungo il corpo. Ora calibriamo la tua posizione neutra.');
    cameraRef.current?.startCalibration();
  };

  const calculateTimeline = (age: number) => {
    const currentAge = parseInt(userData.eta, 10);
    const PU = currentAge / 2;
    const CDS = currentAge / 4;
    const isFatto = age > PU;
    const etaFatto = isFatto ? age : undefined;
    const PT = isFatto ? age - CDS : age + CDS;
    const etaAntefatto = isFatto ? PT - CDS : age;
    const computedEtaFatto = isFatto ? etaFatto : PT + CDS;
    const CDT = Math.abs(PT - PU);
    const diagnosi = PT < PU ? 'Libertà Vincolata' : PT > PU ? 'Sogno Frustrato' : 'Equilibrio';
    return {
      etaEventoCausa: String(age), PU, CDS, PT,
      etaAntefatto: Math.round(etaAntefatto * 10) / 10,
      etaFatto: Math.round(computedEtaFatto * 10) / 10,
      isFatto, CDT: Math.round(CDT * 10) / 10, diagnosi
    } as const;
  };

  const runInvestigation = async () => {
    const currentAge = parseInt(userData.eta, 10);
    if (!userData.nome || !userData.problema || Number.isNaN(currentAge) || currentAge <= 0) {
      setStatus('ERROR');
      setMessage('Completa nome, età e problema da risolvere nei dati anagrafici.');
      return;
    }

    setStatus('TESTING');
    try {
      const problem = userData.problema;
      await voiceService.speak(`Caro inconscio di ${userData.nome}, quando accadde quell'evento che, se non si fosse verificato, oggi non avresti il problema da risolvere: ${problem}?`);

      let lower = 0;
      let upper = currentAge;
      while (upper - lower > 1) {
        const midpoint = Math.floor(lower + (upper - lower) / 2);
        setMessage(`Ricerca dell'età: prima dei ${midpoint} anni?`);
        const response = await voiceService.askQuestion(`L'evento è accaduto prima dei ${midpoint} anni? Sì o no, attendo risposta.`);
        if (response === 'SI') upper = midpoint;
        else if (response === 'NO') lower = midpoint;
        else throw new Error('Risposta età non rilevata');
      }
      const foundAge = upper;
      const timeline = calculateTimeline(foundAge);
      setSummary({ age: foundAge });
      setUserData(prev => ({ ...prev, timeLine: timeline, completedTests: { ...prev.completedTests, timeLine: true } }));
      await voiceService.speak(`Caro inconscio, avevi ${foundAge} anni. Ora individuiamo precisamente in quale stagione accadde l'evento.`);

      let foundSeason: SeasonKey | null = null;
      for (const season of Object.keys(seasons) as SeasonKey[]) {
        setMessage(`Stagione: ${season}?`);
        const response = await voiceService.askQuestion(`L'evento accadde in ${season}? Sì o no, attendo risposta.`);
        if (response === 'SI') { foundSeason = season; break; }
        if (response === 'NON_RILEVATO') throw new Error('Risposta stagione non rilevata');
      }
      if (!foundSeason) throw new Error('Stagione non rilevata');

      let foundMonth: string | null = null;
      for (const month of seasons[foundSeason]) {
        setMessage(`Mese: ${month}?`);
        const response = await voiceService.askQuestion(`L'evento accadde nel mese di ${month}? Sì o no, attendo risposta.`);
        if (response === 'SI') { foundMonth = month; break; }
        if (response === 'NON_RILEVATO') throw new Error('Risposta mese non rilevata');
      }
      if (!foundMonth) throw new Error('Mese non rilevato');

      let lowerDay = 1;
      let upperDay = daysInMonth[foundMonth];
      while (upperDay > lowerDay) {
        const midpoint = Math.floor(lowerDay + (upperDay - lowerDay) / 2);
        setMessage(`Giorno: prima del ${midpoint + 1} ${foundMonth}?`);
        const response = await voiceService.askQuestion(`L'evento accadde prima del giorno ${midpoint + 1} di ${foundMonth}? Sì o no, attendo risposta.`);
        if (response === 'SI') upperDay = midpoint;
        else if (response === 'NO') lowerDay = midpoint + 1;
        else throw new Error('Risposta giorno non rilevata');
      }
      const foundDate = `${lowerDay} ${foundMonth}`;
      setSummary({ age: foundAge, date: foundDate });
      setUserData(prev => ({ ...prev, giornoEvento: foundDate, completedTests: { ...prev.completedTests, qualeGiorno: true } }));

      await voiceService.speak(`Caro inconscio, avevi ${foundAge} anni e l'evento accadde il ${foundDate}. Da chi subisti il torto?`);
      const maleResponse = await voiceService.askQuestion('Era un uomo? Sì o no, attendo risposta.');
      const maleCandidates = ['Tuo padre', 'Tuo nonno', 'Tuo zio', 'Tuo fratello', 'Tuo cugino', 'Un insegnante', 'Un amico'];
      const femaleCandidates = ['Tua madre', 'Tua nonna', 'Tua zia', 'Tua sorella', 'Tua cugina', "Un'insegnante", "Un'amica"];
      const ambiguous = ['Tuo nonno', 'Tuo zio', 'Tuo cugino', 'Tua nonna', 'Tua zia', 'Tua cugina'];
      let candidates: string[];
      if (maleResponse === 'SI') candidates = maleCandidates;
      else if (maleResponse === 'NO') {
        const femaleResponse = await voiceService.askQuestion('Era una donna? Sì o no, attendo risposta.');
        if (femaleResponse !== 'SI') throw new Error('Genere del testimone non rilevato');
        candidates = femaleCandidates;
      } else throw new Error('Genere del testimone non rilevato');

      let witness = 'Non identificato dalla lista fornita';
      for (const candidate of candidates) {
        setMessage(`Testimone: era ${candidate}?`);
        const response = await voiceService.askQuestion(`Era ${candidate}? Sì o no, attendo risposta.`);
        if (response === 'SI') {
          witness = candidate;
          if (ambiguous.includes(candidate)) {
            const side = await voiceService.askQuestion('Da parte di papà? Sì o no, attendo risposta.');
            witness += side === 'SI' ? ' (Paterno)' : side === 'NO' ? ' (Materno)' : '';
          }
          break;
        }
        if (response === 'NON_RILEVATO') throw new Error('Testimone non rilevato');
      }
      setSummary({ age: foundAge, date: foundDate, witness });
      setUserData(prev => ({
        ...prev,
        testimoneChiave: witness,
        completedTests: { ...prev.completedTests, indagineSingola: true, testimone: true }
      }));
      setStatus('SUCCESS');
      setMessage(`Indagine completata. Età: ${foundAge}; data: ${foundDate}; testimone: ${witness}.`);
      await voiceService.speak(`Indagine completata. Il testimone identificato è ${witness}. Puoi tornare alla schermata dei test singoli.`);
    } catch (error) {
      console.error(error);
      setStatus('ERROR');
      setMessage('Risposta non rilevata o indagine interrotta. Puoi ripetere il ciclo.');
    }
  };

  const handleCalibrated = () => {
    setIsCalibrated(true);
    runInvestigation();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 pb-24 relative">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">10–11–12) Indagine singola</h2>
          <h3 className="text-lg font-semibold text-gray-600">Età → Giorno → Testimone</h3>
        </div>
        <button onClick={handleExit} className="text-sm text-blue-600 hover:underline">← Torna ai test singoli</button>
      </div>
      <InfoBox>
        <p>Ricerca un unico evento partendo dal problema che vuoi risolvere e collega in sequenza età, giorno e testimone.</p>
      </InfoBox>
      <div className="my-6"><CameraView ref={cameraRef} videoRef={videoRef} onReady={handleCameraReady} onCalibrated={handleCalibrated} /></div>
      <div className="text-center p-4 bg-gray-50 rounded-lg min-h-[100px] flex flex-col justify-center">
        <p className={`font-semibold text-lg ${status === 'SUCCESS' ? 'text-green-600' : 'text-blue-800'}`}>{message}</p>
        {summary.age && <p className="text-sm mt-2">Età evento: <strong>{summary.age}</strong></p>}
        {summary.date && <p className="text-sm">Data evento: <strong>{summary.date}</strong></p>}
        {summary.witness && <p className="text-sm">Testimone: <strong>{summary.witness}</strong></p>}
      </div>
      <div className="mt-6 flex justify-center gap-3">
        {status === 'IDLE' || status === 'ERROR' ? <button onClick={startCalibration} disabled={!isCameraReady} className="bg-cyan-600 text-white font-bold py-3 px-8 rounded-lg disabled:bg-gray-400">Inizia calibrazione</button> : null}
        {status === 'CALIBRATING' || status === 'TESTING' ? <span className="text-blue-600 font-bold animate-pulse">Indagine in corso...</span> : null}
        {status === 'SUCCESS' ? <><button onClick={resetTest} className="bg-gray-500 text-white font-bold py-3 px-6 rounded-lg">Ripeti</button><button onClick={handleExit} className="bg-green-600 text-white font-bold py-3 px-6 rounded-lg">Fine</button></> : null}
      </div>
      <TestControls onRepeat={resetTest} onExit={handleExit} showControls={status === 'TESTING'} />
    </div>
  );
};
export default IndagineSingola;
