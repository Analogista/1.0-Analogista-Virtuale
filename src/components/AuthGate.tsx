import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ShieldAlert, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, loginWithGoogle, error } = useAuth();
  const [hasAcceptedNDA, setHasAcceptedNDA] = useState<boolean | null>(null);
  const [checkingNDA, setCheckingNDA] = useState(false);
  const [ndaAgreedLocal, setNdaAgreedLocal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userDocExists, setUserDocExists] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkNDA = async (uid: string) => {
      setCheckingNDA(true);
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!isMounted) return;
        
        if (userSnap.exists()) {
          setUserDocExists(true);
          if (userSnap.data().acceptedNDA === true) {
            setHasAcceptedNDA(true);
          } else {
            setHasAcceptedNDA(false);
          }
        } else {
          setUserDocExists(false);
          setHasAcceptedNDA(false);
        }
      } catch (err) {
        console.error("Error checking NDA:", err);
        if (isMounted) setHasAcceptedNDA(false);
      } finally {
        if (isMounted) setCheckingNDA(false);
      }
    };

    if (user) {
      checkNDA(user.uid);
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleAcceptNDA = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      const userEmail = user.email || 'no-email@provided.com';
      
      if (!userDocExists) {
        // Document doesn't exist, create it with required 'role' field
        await setDoc(userRef, { 
          acceptedNDA: true, 
          ndaAcceptedAt: new Date().toISOString(),
          email: userEmail,
          role: 'user', // Required by Firestore rules
          name: user.displayName || 'Anonimo',
          photoURL: user.photoURL || '',
          lastLogin: new Date().toISOString()
        });
      } else {
        // Document exists, just merge the NDA fields and update lastLogin
        await setDoc(userRef, { 
          acceptedNDA: true, 
          ndaAcceptedAt: new Date().toISOString(),
          email: userEmail, // ensure email is present
          lastLogin: new Date().toISOString()
        }, { merge: true });
      }
      
      setHasAcceptedNDA(true);
    } catch (err) {
      console.error("Error saving NDA:", err);
      toast.error("Si è verificato un errore durante il salvataggio dei dati. Riprova.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || checkingNDA) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  // 1. AuthGuard
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-indigo-400 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute bottom-[-20%] left-[20%] w-96 h-96 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDelay: '4s' }}></div>

        <div className="w-full max-w-md bg-white/80 backdrop-blur-xl p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 text-center relative z-10">
          <div className="mb-6 p-4 bg-blue-50/80 rounded-2xl border border-blue-100 text-sm text-blue-800 text-left">
            <strong>Browser Consigliati:</strong> Per un'esperienza ottimale con fotocamera e audio, si raccomanda l'uso di <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong> o <strong>Safari (su iOS/Mac)</strong> aggiornati all'ultima versione. L'app può essere installata come PWA.
          </div>
          
          <div className="w-20 h-20 bg-gradient-to-tr from-blue-100 to-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-indigo-50/50">
             <ShieldAlert className="w-10 h-10 text-indigo-600" />
          </div>
          
          <h1 className="text-3xl font-bold text-slate-800 mb-3 tracking-tight">Accesso Riservato</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">
            Benvenuto. Per utilizzare l'Analogista Virtuale è necessario autenticarsi. 
            I tuoi dati saranno trattati con la massima riservatezza.
          </p>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 text-sm border border-red-100">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-left">{error}</p>
            </div>
          )}

          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white text-slate-700 py-4 px-6 rounded-2xl hover:bg-slate-50 transition-all font-semibold shadow-sm border border-slate-200 hover:shadow-md hover:border-slate-300 active:scale-[0.98]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Accedi con Google
          </button>
        </div>
      </div>
    );
  }

  // 2. NDA / BETA AGREEMENT
  if (hasAcceptedNDA === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-lg bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6 border border-blue-100">
             <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Accordo di Riservatezza (NDA)</h2>
          <p className="text-slate-600 mb-6 leading-relaxed">
            Questo sistema è in fase Beta. I dati e le interazioni sono strettamente confidenziali. 
            Prima di procedere, è necessario accettare i termini di riservatezza e l'utilizzo per scopi di test.
          </p>

          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 mb-8">
             <label className="flex items-start gap-4 cursor-pointer group">
               <div className="relative flex items-center justify-center mt-0.5">
                 <input 
                   type="checkbox" 
                   className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer peer appearance-none checked:bg-indigo-600 checked:border-indigo-600"
                   checked={ndaAgreedLocal}
                   onChange={(e) => setNdaAgreedLocal(e.target.checked)}
                 />
                 <svg className="absolute w-3.5 h-3.5 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                   <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                 </svg>
               </div>
               <span className="text-sm text-slate-700 leading-relaxed font-medium group-hover:text-slate-900 transition-colors">
                 Dichiaro di aver letto, compreso e di accettare i termini dell'Accordo di Riservatezza (NDA) e le condizioni di utilizzo in fase Beta.
               </span>
             </label>
          </div>

          <button
            onClick={handleAcceptNDA}
            disabled={!ndaAgreedLocal || isSaving}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-4 px-6 rounded-2xl hover:bg-indigo-700 transition-all font-semibold shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            Accetta e Prosegui
          </button>
        </div>
      </div>
    );
  }

  // 3. ACCESSO ACCORDATO
  return <>{children}</>;
};
