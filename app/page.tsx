"use client";
import { useState, useEffect, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebase"; 
import { doc, setDoc, getDoc } from "firebase/firestore";

// --- TU PROMPT DE 9 ETAPAS INTEGRADO ---
const SYSTEM_PROMPT = `
Eres GenioLingo, el tutor políglota inteligente de la familia de Giovanni. Tu misión es enseñar el idioma que el usuario elija con lógica de ingeniería.
 
REGLA DE ORO DE AUDIO: Evalúa la pronunciación fonética SOLO cuando el usuario esté intentando hablar en el IDIOMA EXTRANJERO QUE ESTÁ APRENDIENDO. Si el usuario envía un audio hablando en SU IDIOMA NATIVO (por ejemplo, al presentarse o dar instrucciones), NO hagas análisis de pronunciación, simplemente escúchalo y responde con naturalidad.
Cuando SÍ evalúes el idioma extranjero, tu respuesta DEBE incluir:
1. Claridad de los fonemas.
2. Acento y entonación (pitch accent si es japonés, ritmo si es francés, etc.).
3. Consejos específicos para mejorar la mecánica vocal.
 
REGLA GLOBAL DE CAMBIO DE IDIOMA: En cualquier momento, si pide cambiar de idioma, aborta la etapa actual y salta a la ETAPA 2.
 
ETAPA 1: EL VUELO DE BIENVENIDA (Solo la primera sesión)
1. Si es la primera vez que interactúas con el usuario, inicia un "Vuelo de Bienvenida" amigable para recolectar: Idioma nativo, Nombre/apodo, Idioma Objetivo, Edad, Intereses/Profesión y Nivel de experiencia (sin escalas técnicas).
2. EXTREMADAMENTE IMPORTANTE: Haz UNA SOLA PREGUNTA por mensaje. Si el usuario te da varios datos, acéptalos y pregunta el siguiente.
 
ETAPA 2: EL DIAGNÓSTICO
- Ajusta tu tono según la edad. Realiza 3 preguntas rápidas situacionales. UNA SOLA PREGUNTA por mensaje.
 
ETAPA 3: ADAPTABILIDAD DE PERFILES (PERSONAS)
- Perfil Lógico/Ingeniero: Estructuras y reglas.
- Perfil Creativo/Diseño: Analogías visuales y armonía.
- Perfil Infantil (Spark-Adventure): Misiones mágicas y animales.
- Perfil Senior (Sabiduría): Tono pausado, historia y cultura.
- Perfil Libre (Campo/Cocina): Ejemplos de labor específica.
 
ETAPA 4: PILARES PEDAGÓGICOS
- No al "Traductor Simple": Explica la lógica gramatical y da ejemplos de interés.
- Mindfulness: Sugiere pausas si detectas frustración.
 
ETAPA 5: GUÍA DE PRONUNCIACIÓN EVOLUTIVA [FONÉTICA]
- Incluye siempre la pronunciación figurada entre corchetes [] adaptada al perfil de edad.
 
ETAPA 6: MENÚ DE INICIO Y GESTIÓN DE TIEMPO
- Saluda por nombre, detecta idiomas previos y ofrece: 🚀 Misión Relámpago, 📚 Lección Maestra (preguntar tiempo: 5, 15, 30 min) o 🧞 Consulta al Genio.
 
ETAPA 7: SENSOR DE ENERGÍA Y ÁNIMO (MINDFUL CHECK)
- Pregunta la energía (1-5). Ajusta la intensidad de la lección según el resultado.
 
ETAPA 8: LA LECCIÓN
- Ejecuta la lección con la ingeniería gramatical y la fonética de la etapa 5.
 
ETAPA 9: CIERRE
- Resumen corto, otorga "GenioGemas" y despedida cálida.
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
  const shouldAutoSend = useRef(false);

  useEffect(() => {
    setIsMounted(true);
    const cargarSesion = async () => {
      const nombreGuardado = localStorage.getItem("genio_user");
      if (nombreGuardado) {
        setUserName(nombreGuardado);
        const userRef = doc(db, "usuarios", nombreGuardado.toLowerCase().trim());
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) setMessages(docSnap.data().historial || []);
      }
    };
    cargarSesion();
  }, []);

  // --- AUTO-ENVÍO AL DETECTAR NUEVO AUDIO ---
  useEffect(() => {
    if (audioBlob && shouldAutoSend.current) {
      sendMessage();
      shouldAutoSend.current = false;
    }
  }, [audioBlob]);

  const iniciarGrabacion = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        setAudioBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      shouldAutoSend.current = false;
    } catch (err) { alert("Error al acceder al micrófono."); }
  };

  const detenerGrabacion = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (mediaRecorderRef.current && isRecording) {
      shouldAutoSend.current = true; // Marcamos para que se envíe solo al procesar el blob
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const leerTexto = (texto: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(texto);
    window.speechSynthesis.speak(utterance);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  };

  const sendMessage = async () => {
    const currentInput = input.trim();
    const currentAudio = audioBlob;
    if (!currentInput && !currentAudio) return;

    setLoading(true);
    const textoUsuario = currentInput || "🎤 [Nota de voz]";
    const userMessage = { role: "user", text: textoUsuario };
    
    const mensajesLimpios = messages.filter(m => m.role !== "error");
    const updatedMessages = [...mensajesLimpios, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setAudioBlob(null); // Limpiamos inmediatamente para evitar bucles

    try {
      const ai = new GoogleGenAI({ apiKey: (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim() });
      let currentParts: any[] = [{ text: textoUsuario }];

      if (currentAudio) {
        const base64Audio = await blobToBase64(currentAudio);
        currentParts.push({ inlineData: { mimeType: currentAudio.type.split(';')[0] || 'audio/webm', data: base64Audio } });
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

      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: historialContexto,
        config: { systemInstruction: SYSTEM_PROMPT }
      });

      const genioText = response.text || "¿Podrías repetirlo?";
      const genioResponse = { role: "genio", text: genioText };
      const finalHistory = [...updatedMessages, genioResponse];
      
      setMessages(finalHistory);
      leerTexto(genioText); // AUTO-PLAY: El genio habla solo

      if (userName) {
        await setDoc(doc(db, "usuarios", userName.toLowerCase().trim()), {
          nombre: userName, historial: finalHistory, ultimaActualizacion: new Date()
        }, { merge: true });
      } else if (textoUsuario.length < 20 && textoUsuario.toLowerCase() !== "hola" && !currentAudio) {
        setUserName(textoUsuario);
        localStorage.setItem("genio_user", textoUsuario);
        await setDoc(doc(db, "usuarios", textoUsuario.toLowerCase().trim()), {
          nombre: textoUsuario, historial: finalHistory, ultimaActualizacion: new Date()
        });
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: "error", text: "Error de conexión. Intenta de nuevo." }]);
    } finally { setLoading(false); }
  };

  const resetApp = () => {
    localStorage.removeItem("genio_user");
    setUserName(null);
    setMessages([]);
  };

  if (!isMounted) return <main className="h-screen bg-slate-900"></main>;

  return (
    <main className="flex flex-col h-screen bg-slate-900 text-white p-4 font-sans max-w-2xl mx-auto overflow-hidden">
      <header className="py-2 border-b border-slate-700 flex justify-between items-center">
        <div className="flex-1"></div>
        <div className="text-center flex-1">
          <h1 className="text-xl font-bold text-cyan-400">🧞‍♂️ GenioLingo</h1>
          <p className="text-[9px] text-slate-500 uppercase tracking-tighter">Family Language Tutor</p>
        </div>
        <div className="flex-1 text-right">
          {userName && <button onClick={resetApp} className="text-[10px] text-slate-500 hover:text-red-400 transition">Reiniciar</button>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto my-4 space-y-4 p-2 scrollbar-hide">
        {messages.length === 0 && <div className="text-center text-slate-600 mt-20 italic text-sm">Di "Hola" para despertar al Genio...</div>}
        {messages.map((msg, i) => (
          <div key={i} className={`p-3 rounded-2xl max-w-[85%] shadow-md ${msg.role === 'user' ? 'bg-cyan-800 ml-auto rounded-tr-none' : msg.role === 'error' ? 'bg-red-950/50 border border-red-900 text-red-200 text-[10px] mx-auto' : 'bg-slate-800 rounded-tl-none'}`}>
            <p className="text-sm leading-relaxed">{msg.text}</p>
            {msg.role === 'genio' && (
              <button onClick={() => leerTexto(msg.text)} className="mt-2 text-lg hover:scale-110 transition-transform" title="Volver a escuchar">🔊</button>
            )}
          </div>
        ))}
        {loading && <div className="text-cyan-500 text-[10px] font-mono animate-pulse">El Genio te escucha...</div>}
      </div>

      <div className="flex gap-2 items-center bg-slate-800/50 p-2 rounded-3xl border border-slate-700">
        <button
          onPointerDown={iniciarGrabacion}
          onPointerUp={detenerGrabacion}
          onPointerLeave={detenerGrabacion}
          onContextMenu={(e) => e.preventDefault()} 
          style={{ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'none' }}
          className={`p-5 rounded-2xl transition-all ${isRecording ? 'bg-red-600 scale-110 shadow-lg' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          {isRecording ? '🔴' : '🎤'}
        </button>
        
        <input 
          className="flex-1 bg-transparent p-2 focus:outline-none text-sm placeholder:text-slate-600"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Escribe o mantén presionado..."
        />
        
        {input.trim() && (
          <button onClick={sendMessage} className="bg-cyan-600 p-3 rounded-2xl font-bold hover:bg-cyan-500 transition active:scale-95">OK</button>
        )}
      </div>
      <p className="text-[8px] text-center text-slate-700 mt-2">Mantén presionado para hablar. Suelta para enviar.</p>
    </main>
  );
}