"use client";
import { useState, useEffect, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebase"; 
import { doc, setDoc, getDoc } from "firebase/firestore";

const SYSTEM_PROMPT = `
Eres GenioLingo, el tutor políglota inteligente de la familia de Giovanni. Tu misión es enseñar el idioma que el usuario elija con lógica de ingeniería, no repetición mecánica.

REGLA DE ORO DE AUDIO (NUEVA E IMPORTANTE): Si el usuario envía un AUDIO, debes escucharlo con atención extrema. Tu respuesta DEBE incluir una sección de "Análisis de Pronunciación" donde evalúes:
1. Claridad de los fonemas.
2. Acento y entonación (pitch accent si es japonés, ritmo si es inglés o francés, etc.).
3. Consejos específicos para mejorar la mecánica vocal (ej. "suaviza la 'u' final", "coloca la lengua detrás de los dientes superiores").

REGLA GLOBAL DE CAMBIO DE IDIOMA (SWITCH): En cualquier momento, si el usuario pide cambiar de idioma, aborta la etapa actual, confirma el cambio y salta a la ETAPA 2 para el nuevo idioma.

ETAPA 1: EL VUELO DE BIENVENIDA (Solo al inicio de la charla)
- Tu objetivo es recolectar 4 datos clave: Nombre, Idioma, Edad y Nivel de Energía (1 al 5).
- ES OBLIGATORIO RECOLECTAR ESTOS DATOS HACIENDO UNA SOLA PREGUNTA POR MENSAJE. Espera la respuesta antes de pasar al siguiente dato.

ETAPA 2: EL DIAGNÓSTICO
- OBLIGATORIO: Ajusta tu tono según su edad (Infantil: lúdico, mágico, usa emojis; Senior: muy respetuoso, pausado, claro, cálido y paciente; Adulto: lógico, directo).
- Evalúa su nivel con 3 preguntas situacionales. Haz UNA SOLA PREGUNTA por mensaje. Espera la respuesta.

ETAPA 3: EL MENÚ DE TIEMPO
- Felicítalo por su nivel.
- Ofrécele el menú: Misión Relámpago (5 min), Lección Maestra (15-30 min) o Consulta al Genio.

ETAPA 4: LA LECCIÓN
- Ejecuta la lección. Nunca des traducciones simples; explica la "ingeniería" gramatical detrás.
- Usa fonética evolutiva en corchetes: Niños [u-den-parts], Adultos [ai-am-che-kin].
- Integra sus intereses (ej. si es ingeniero, usa ejemplos de circuitos; si es niño, cuentos y magia; si es senior, historias clásicas o sus gustos).

ETAPA 5: CIERRE Y MURO FAMILIAR
- Otorga "GenioGemas" simbólicas como recompensa.
- Genera un bloque para el "Muro Familiar" con esta estructura exacta:
  [MURO FAMILIAR]
  Título en Español: "¡Victoria! [Nombre] completó un reto de [Idioma] 🌍"
  Original: [Frase aprendida]
  Traducción: [Traducción al español]
  Fonética: [Pronunciación]
  Contexto: [Breve elogio]
- Pregunta si desea aprender algo más o cambiar de idioma.
`;

export default function GenioLingoApp() {
  // --- ESTADOS DE LA APP ---
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // --- ESTADOS DE AUDIO (NUEVOS) ---
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // --- HIDRATACIÓN Y SESIÓN ---
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

  // --- LÓGICA DE GRABACIÓN (MediaRecorder) ---
  const iniciarGrabacion = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Error al acceder al micro:", err);
      alert("No se pudo acceder al micrófono. Verifica los permisos.");
    }
  };

  const detenerGrabacion = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Detener todos los tracks del stream para apagar el icono de micro del navegador
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  // Conversor de Audio a Base64 para la API
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  };

  // --- TEXT TO SPEECH (El Genio Habla) ---
  const leerTexto = (texto: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(texto);
    // Intentar detectar idioma o dejar por defecto
    window.speechSynthesis.speak(utterance);
  };

// --- ENVÍO DE MENSAJE (MULTIMODAL CORREGIDO) ---
  const sendMessage = async () => {
    if (!input.trim() && !audioBlob) return;

    setLoading(true);
    const textoUsuario = input.trim() || "🎤 [Nota de voz enviada]";
    const userMessage = { role: "user", text: textoUsuario };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");

    try {
      const apiKey = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();
      
      // CORRECCIÓN 1: El nuevo SDK pide un objeto con la llave, no un string suelto
      const ai = new GoogleGenAI({ apiKey: apiKey });

      // Preparamos las partes del mensaje actual (texto + posible audio)
      let currentParts: any[] = [{ text: textoUsuario }];

      if (audioBlob) {
        const base64Audio = await blobToBase64(audioBlob);
        currentParts.push({
          inlineData: {
            mimeType: "audio/webm",
            data: base64Audio
          }
        });
      }

      // Preparamos el historial completo en el formato estricto que pide Google
      const historialContexto = updatedMessages.map(m => ({
        role: m.role === "genio" ? "model" : "user",
        parts: [{ text: m.text }]
      }));

      // Reemplazamos el último mensaje (que solo era texto) por nuestro paquete completo con audio
      historialContexto.pop();
      historialContexto.push({ role: "user", parts: currentParts });

      // CORRECCIÓN 2: Usamos el método generateContent directamente desde los modelos
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash", // El modelo ideal para audio
        contents: historialContexto,
        config: { systemInstruction: SYSTEM_PROMPT }
      });

      const genioText = response.text || "Hubo un pequeño cortocircuito, ¿puedes repetirlo?";
      const genioResponse = { role: "genio", text: genioText };
      const finalHistory = [...updatedMessages, genioResponse];
      
      setMessages(finalHistory);
      setAudioBlob(null); // Limpiar el audio usado

      // Guardar en Firebase
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

    } catch (error) {
      console.error("Error API:", error);
      setMessages(prev => [...prev, { role: "error", text: "Perdona, tuve un error de conexión." }]);
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

      {/* ÁREA DE CHAT */}
      <div className="flex-1 overflow-y-auto my-4 space-y-4 p-2 scrollbar-hide">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-20 italic animate-pulse">
            Di "Hola" o graba un audio para comenzar...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`p-4 rounded-2xl max-w-[85%] shadow-lg ${msg.role === 'user' ? 'bg-cyan-700 ml-auto rounded-tr-none' : 'bg-slate-800 rounded-tl-none'}`}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
            {msg.role === 'genio' && (
              <button onClick={() => leerTexto(msg.text)} className="mt-3 text-xs text-cyan-400 font-bold flex items-center gap-1 hover:text-white transition">
                🔊 ESCUCHAR PROXIMIDAD
              </button>
            )}
          </div>
        ))}
        {loading && <div className="text-cyan-500 text-xs font-mono animate-bounce">Genio procesando audio/texto...</div>}
        {audioBlob && !loading && (
          <div className="bg-red-900/30 border border-red-500/50 p-2 rounded-lg text-xs text-center animate-pulse">
            🎤 Audio listo para enviar. Dale a "Enviar".
          </div>
        )}
      </div>

      {/* CONTROLES DE ENTRADA */}
      <div className="flex gap-2 items-center bg-slate-800 p-2 rounded-2xl border border-slate-700">
        <button
          onMouseDown={iniciarGrabacion}
          onMouseUp={detenerGrabacion}
          onTouchStart={iniciarGrabacion}
          onTouchEnd={detenerGrabacion}
          className={`p-4 rounded-xl transition-all ${isRecording ? 'bg-red-600 scale-110 shadow-[0_0_20px_rgba(220,38,38,0.5)]' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          {isRecording ? '⏹️' : '🎤'}
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
      <p className="text-[9px] text-center text-slate-600 mt-2">Mantén presionado el micro para grabar tu voz</p>
    </main>
  );
}