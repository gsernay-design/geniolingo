"use client";
import { useState, useEffect, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebase"; 
import { doc, setDoc, getDoc } from "firebase/firestore";

const SYSTEM_PROMPT = `
Eres GenioLingo, el tutor políglota inteligente de la familia de Giovanni. Tu misión es enseñar el idioma que el usuario elija con lógica de ingeniería.

REGLA DE ORO DE AUDIO: Si el usuario envía un AUDIO, debes escucharlo con atención extrema. Tu respuesta DEBE incluir una sección de "Análisis de Pronunciación" donde evalúes:
1. Claridad de los fonemas.
2. Acento y entonación (pitch accent si es japonés, ritmo si es francés, etc.).
3. Consejos específicos para mejorar la mecánica vocal.

REGLA GLOBAL DE CAMBIO DE IDIOMA (SWITCH): En cualquier momento, si el usuario pide cambiar de idioma, aborta la etapa actual, confirma el cambio y salta a la ETAPA 2 para el nuevo idioma.

ETAPA 1: EL VUELO DE BIENVENIDA (Solo al inicio de la charla)
- Tu objetivo es recolectar 5 datos clave: Nombre, Idioma, Edad, Aficiones y Nivel de Energía (1 al 5).
- ES OBLIGATORIO RECOLECTAR ESTOS DATOS HACIENDO UNA SOLA PREGUNTA POR MENSAJE. Espera la respuesta antes de pasar al siguiente 

ETAPA 2: EL DIAGNÓSTICO
- Ajusta tu tono según su edad (Infantil: lúdico; Senior: respetuoso, pausado; Adulto: lógico).
- Evalúa con 3 preguntas situacionales. UNA SOLA PREGUNTA por mensaje.

ETAPA 3: EL MENÚ DE TIEMPO
- Ofrécele: Misión Relámpago (5 min), Lección Maestra (15-30 min) o Consulta al Genio.

ETAPA 4: LA LECCIÓN
- Ejecuta la lección. Explica la "ingeniería" gramatical detrás.
- Usa fonética evolutiva en corchetes: Niños [u-den-parts], Adultos [ai-am-che-kin].

ETAPA 5: CIERRE Y MURO FAMILIAR
- Otorga "GenioGemas".
- Genera un bloque para el "Muro Familiar":
  [MURO FAMILIAR]
  Título: "¡Victoria! [Nombre] completó un reto de [Idioma] 🌍"
  Original: [Frase aprendida]
  Traducción: [Traducción al español]
  Fonética: [Pronunciación]
  Contexto: [Breve elogio]
- Pregunta si desea aprender algo más.
`;

export default function GenioLingoApp() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setIsMounted(true);
    const cargarSesion = async () => {
      const nombreGuardado = localStorage.getItem("genio_user");
      if (nombreGuardado) {
        setUserName(nombreGuardado);
        const userRef = doc(db, "usuarios", nombreGuardado.toLowerCase().trim());
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
          setMessages(docSnap.data().historial || []);
        }
      }
    };
    cargarSesion();
  }, []);

  const iniciarGrabacion = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
          setAudioBlob(blob);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Error micro:", err);
      alert("No se pudo acceder al micrófono.");
    }
  };

  const detenerGrabacion = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  };

  const leerTexto = (texto: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(texto);
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async () => {
    if (!input.trim() && !audioBlob) return;

    setLoading(true);
    const textoUsuario = input.trim() || "🎤 [Nota de voz enviada]";
    const userMessage = { role: "user", text: textoUsuario };
    
    // Limpiamos los errores pasados de la pantalla para no saturarla
    const mensajesLimpios = messages.filter(m => m.role !== "error");
    const updatedMessages = [...mensajesLimpios, userMessage];
    
    setMessages(updatedMessages);
    setInput("");

    try {
      const apiKey = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();
      const ai = new GoogleGenAI({ apiKey: apiKey });

      let currentParts: any[] = [{ text: textoUsuario }];

      if (audioBlob) {
        const base64Audio = await blobToBase64(audioBlob);
        // Extraemos el formato exacto sin apellidos (ej. "audio/webm" en vez de "audio/webm;codecs=opus")
        const mimeTypeLimpio = audioBlob.type.split(';')[0] || 'audio/webm';
        
        currentParts.push({
          inlineData: { mimeType: mimeTypeLimpio, data: base64Audio }
        });
      }

      const historialContexto: any[] = [];
      let ultimoRol = "";

      updatedMessages.forEach(m => {
        const roleGoogle = m.role === "genio" ? "model" : "user";
        if (roleGoogle !== ultimoRol) {
          historialContexto.push({ role: roleGoogle, parts: [{ text: m.text }] });
          ultimoRol = roleGoogle;
        }
      });

      historialContexto.pop();
      historialContexto.push({ role: "user", parts: currentParts });

      // Actualizamos a la versión más moderna y robusta del modelo
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: historialContexto,
        config: { systemInstruction: SYSTEM_PROMPT }
      });

      const genioText = response.text || "¿Puedes repetirlo?";
      const genioResponse = { role: "genio", text: genioText };
      const finalHistory = [...updatedMessages, genioResponse];
      
      setMessages(finalHistory);
      setAudioBlob(null);

      if (userName) {
        await setDoc(doc(db, "usuarios", userName.toLowerCase().trim()), {
          nombre: userName,
          ultimaActualizacion: new Date(),
          historial: finalHistory
        }, { merge: true });
      } else if (textoUsuario.length < 20 && textoUsuario.toLowerCase() !== "hola" && !audioBlob) {
        setUserName(textoUsuario);
        localStorage.setItem("genio_user", textoUsuario);
        await setDoc(doc(db, "usuarios", textoUsuario.toLowerCase().trim()), {
          nombre: textoUsuario,
          ultimaActualizacion: new Date(),
          historial: finalHistory
        });
      }

    } catch (error: any) {
      console.error("Error API:", error);
      const detalleError = error instanceof Error ? error.message : "Desconocido";
      
      // Imprimimos el error REAL de Google y vaciamos el audio para romper el bucle
      setMessages(prev => [...prev, { role: "error", text: `Error de Sistema: ${detalleError}` }]);
      setAudioBlob(null);
    } finally {
      setLoading(false);
    }
  };

  const resetApp = () => {
    localStorage.removeItem("genio_user");
    setUserName(null);
    setMessages([]);
  };

  if (!isMounted) return <main className="h-screen bg-slate-900"></main>;

  return (
    <main className="flex flex-col h-screen bg-slate-900 text-white p-4 font-sans max-w-2xl mx-auto">
      <header className="py-4 border-b border-slate-700 flex justify-between items-center">
        <div className="flex-1"></div>
        <div className="text-center flex-1">
          <h1 className="text-2xl font-bold text-cyan-400">🧞‍♂️ GenioLingo</h1>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest">Next-Gen Tutor</p>
        </div>
        <div className="flex-1 text-right">
          {userName && (
            <button onClick={resetApp} className="text-[10px] bg-slate-800 px-2 py-1 rounded hover:bg-red-900 transition">
              Reiniciar
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto my-4 space-y-4 p-2 scrollbar-hide">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-20 italic animate-pulse">
            Di "Hola" o graba un audio para comenzar...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`p-4 rounded-2xl max-w-[85%] shadow-lg ${msg.role === 'user' ? 'bg-cyan-700 ml-auto rounded-tr-none' : msg.role === 'error' ? 'bg-red-900 border border-red-500 text-red-100 mx-auto w-full text-xs font-mono' : 'bg-slate-800 rounded-tl-none'}`}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
            {msg.role === 'genio' && (
              <button onClick={() => leerTexto(msg.text)} className="mt-3 text-xs text-cyan-400 font-bold flex items-center gap-1 hover:text-white transition">
                🔊 ESCUCHAR PROXIMIDAD
              </button>
            )}
          </div>
        ))}
        {loading && <div className="text-cyan-500 text-xs font-mono animate-bounce">Genio procesando audio/texto...</div>}
      </div>

      <div className="flex gap-2 items-center bg-slate-800 p-2 rounded-2xl border border-slate-700">
        <button
          onPointerDown={iniciarGrabacion}
          onPointerUp={detenerGrabacion}
          onPointerLeave={detenerGrabacion} 
          onPointerCancel={detenerGrabacion}
          onContextMenu={(e) => e.preventDefault()} 
          style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none' }}
          className={`p-4 rounded-xl transition-all select-none ${isRecording ? 'bg-red-600 scale-110 shadow-[0_0_20px_rgba(220,38,38,0.5)]' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          {isRecording ? '🔴' : '🎤'}
        </button>
        
        <input 
          className="flex-1 bg-transparent p-2 focus:outline-none text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={userName ? `¡Practiquemos, ${userName}!` : "Dime tu nombre..."}
        />
        
        <button 
          onClick={sendMessage} 
          disabled={loading || (!input && !audioBlob)}
          className={`bg-cyan-600 px-5 py-3 rounded-xl font-bold transition ${loading ? 'opacity-50' : 'hover:bg-cyan-500 active:scale-95'}`}
        >
          {loading ? '...' : 'ENVIAR'}
        </button>
      </div>
    </main>
  );
}