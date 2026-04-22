"use client";
import { useState, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebase"; 
import { doc, setDoc, getDoc } from "firebase/firestore";

const SYSTEM_PROMPT = `
Eres GenioLingo, el tutor políglota inteligente de la familia de Giovanni. Tu misión es enseñar el idioma que el usuario elija con lógica de ingeniería, no repetición mecánica.

REGLA DE ORO DE FLUJO DE CONVERSACIÓN: NO intentes hacer todo a la vez. Responde estrictamente según la etapa en la que se encuentre la conversación:
REGLA GLOBAL DE CAMBIO DE IDIOMA (SWITCH): En cualquier momento de la conversación, si el usuario pide cambiar de idioma o añadir uno nuevo, aborta la etapa actual, confirma el cambio con entusiasmo y salta directamente a la ETAPA 2 (Diagnóstico) para el nuevo idioma.

ETAPA 1: EL VUELO DE BIENVENIDA (Solo si el usuario dice "Hola" o inicia la charla)
- Tu objetivo es recolectar 5 datos clave para crear el perfil: Nombre, Idioma, Edad y Nivel de Energía (1 al 5).
- ES OBLIGATORIO RECOLECTAR ESTOS DATOS HACIENDO UNA SOLA PREGUNTA POR MENSAJE.
- Paso 1: Saluda amigablemente, pregunta su nombre o apodo y DETENTE. Espera la respuesta.
- Paso 2: Cuando responda, usa su nombre y pregúntale qué idioma quiere aprender hoy. (Si menciona varios idiomas, felicítalo y pregúntale con cuál de ellos quiere empezar la sesión actual) y DETENTE.
- Paso 3: Cuando responda, pregúntale su edad (explícale brevemente que es para adaptar tu pedagogía) y DETENTE.
- Paso 4: Cuando responda, pregúntale por algunas de sus aficiones o intereses y DETENTE.
- Paso 5: Cuando responda, pregúntale su nivel de energía hoy (del 1 al 5) y DETENTE.
- NO avances a la Etapa 2 de diagnóstico hasta que tengas estos 5 datos completos.

ETAPA 2: EL DIAGNÓSTICO (Cuando el usuario te responda sus datos)
- Ajusta tu tono según su edad (Infantil: lúdico; Senior: pausado; Adulto: lógico).
- Tu objetivo es evaluar su nivel con 3 preguntas situacionales y conversacionales, PERO ES OBLIGATORIO HACER UNA SOLA PREGUNTA POR MENSAJE.
- Haz la Pregunta 1 y DETENTE. Espera la respuesta.
- Cuando el usuario responda, dale un breve comentario, haz la Pregunta 2 y DETENTE.
- Cuando responda, haz la Pregunta 3 y DETENTE.
- NO ofrezcas el menú de tiempo (Etapa 3) hasta que el usuario haya respondido a tu tercera pregunta.

ETAPA 3: EL MENÚ DE TIEMPO (Cuando el usuario responda el diagnóstico)
- Felicítalo por su nivel.
- Según su nivel de energía (1-2: suave, 3: normal, 4-5: modo desafío), adapta tu entusiasmo.
- Ofrécele el menú: Misión Relámpago (5 min), Lección Maestra (15-30 min) o Consulta al Genio. Pregúntale qué prefiere.

ETAPA 4: LA LECCIÓN (Cuando el usuario elija el tiempo)
- Ejecuta la lección. Nunca des traducciones simples; explica la "ingeniería" gramatical detrás.
- Usa fonética evolutiva en corchetes: Niños [u-den-parts], Adultos [ai-am-che-kin].
- Integra sus intereses (ej. si es ingeniero, usa ejemplos de circuitos; si es diseño, analogías de color; si es niño, cuentos o juegos; si es senior, historias o sus intereses).

ETAPA 5: CIERRE Y MURO FAMILIAR (Al terminar la lección)
- Otorga "GenioGemas" simbólicas.
- Genera un bloque de texto para el "Muro Familiar" con esta estructura exacta:
  [MURO FAMILIAR]
  Título en Español: "¡Victoria! [Nombre] completó un reto de [Idioma] 🌍"
  Original: [Frase aprendida]
  Traducción: [Traducción al español]
  Fonética: [Pronunciación]
  Contexto: [Breve elogio]
- Pregunta si desea aprender algo más o cambiar de idioma. Si pide cambiar de idioma, reinicia tu comportamiento a la ETAPA 1 para el nuevo idioma.
`;

export default function GenioLingoApp() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isListening, setIsListening] = useState(false); // Estado para el micrófono

  useEffect(() => {
    setIsMounted(true);
    const cargarSesion = async () => {
      const nombreGuardado = localStorage.getItem("genio_user");
      if (nombreGuardado) {
        setUserName(nombreGuardado);
        const userRef = doc(db, "usuarios", nombreGuardado.toLowerCase().trim());
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
          const datos = docSnap.data();
          setMessages(datos.historial || []);
        }
      }
    };
    cargarSesion();
  }, []);

  const guardarEnFirebase = async (nombre: string, nuevosMensajes: any[]) => {
    const userRef = doc(db, "usuarios", nombre.toLowerCase().trim());
    try {
      await setDoc(userRef, {
        nombre: nombre,
        ultimaActualizacion: new Date(),
        historial: nuevosMensajes
      }, { merge: true });
      localStorage.setItem("genio_user", nombre);
    } catch (e) {
      console.error("Error guardando en BD:", e);
    }
  };

  // --- MOTOR DE VOZ A TEXTO (MICRÓFONO) ---
  const escucharVoz = () => {
    // Verificamos compatibilidad con el navegador
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("Tu navegador actual no soporta el dictado por voz. Intenta desde Chrome o Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "es-ES"; // Escucha en español por defecto
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => prev + (prev ? " " : "") + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Error de micrófono:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  // --- MOTOR DE TEXTO A VOZ (ALTAVOZ) ---
  const leerTexto = (texto: string) => {
    if (!("speechSynthesis" in window)) {
      alert("Tu navegador no soporta la lectura en voz alta.");
      return;
    }
    
    window.speechSynthesis.cancel(); // Apaga cualquier voz que esté sonando
    const utterance = new SpeechSynthesisUtterance(texto);
    
    // Le decimos al navegador que hable
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", text: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setLoading(true);
    setInput("");

    try {
      const apiKey = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();
      const ai = new GoogleGenAI({ apiKey: apiKey });

      const historialContexto = updatedMessages.map((msg) => ({
        role: msg.role === "genio" ? "model" : "user", 
        parts: [{ text: msg.text }],
      }));

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: historialContexto,
        config: { systemInstruction: SYSTEM_PROMPT }
      });

      const genioResponse = { role: "genio", text: response.text || "Hubo un pequeño cortocircuito en mi memoria, ¿puedes repetirlo?" };
      const finalMessages = [...updatedMessages, genioResponse];
      setMessages(finalMessages);

      if (!userName && input.toLowerCase() !== "hola") {
        setUserName(input); 
        await guardarEnFirebase(input, finalMessages);
      } else if (userName) {
        await guardarEnFirebase(userName, finalMessages);
      }

    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [...prev, { role: "error", text: "Error de conexión." }]);
    } finally {
      setLoading(false);
    }
  };

  const resetApp = () => {
    localStorage.removeItem("genio_user");
    setUserName(null);
    setMessages([]);
  };

  if (!isMounted) {
    return <main className="h-screen bg-slate-900"></main>;
  }

  return (
    <main className="flex flex-col h-screen bg-slate-900 text-white p-4 font-sans">
      <header className="py-4 border-b border-slate-700 flex justify-between items-center">
        <div className="flex-1"></div>
        <div className="text-center flex-1">
          <h1 className="text-2xl font-bold text-cyan-400">🧞‍♂️ GenioLingo</h1>
          <p className="text-xs text-slate-400">Tutor Familiar</p>
        </div>
        <div className="flex-1 text-right">
          {userName && (
            <button onClick={resetApp} className="text-[10px] bg-slate-800 px-2 py-1 rounded hover:bg-red-900 transition">
              Cambiar Usuario
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto my-4 space-y-4 p-2">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-10 italic">
            Escribe "Hola" o usa el micrófono para despertar al Genio...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`p-3 rounded-lg max-w-[80%] flex flex-col ${msg.role === 'user' ? 'bg-blue-600 ml-auto' : 'bg-slate-800'}`}>
            <p className="whitespace-pre-wrap">{msg.text}</p>
            {/* Botón de altavoz solo para los mensajes del Genio */}
            {msg.role === 'genio' && (
              <button 
                onClick={() => leerTexto(msg.text)} 
                className="self-end mt-2 text-sm text-cyan-400 hover:text-cyan-200 flex items-center gap-1 transition"
                title="Escuchar pronunciación"
              >
                🔊 Escuchar
              </button>
            )}
          </div>
        ))}
        {loading && <div className="text-cyan-500 animate-pulse">El Genio está pensando...</div>}
      </div>

      <div className="flex gap-2 items-center">
        {/* Nuevo botón de micrófono */}
        <button
          suppressHydrationWarning
          onClick={escucharVoz}
          className={`p-3 rounded-lg text-xl transition-all ${isListening ? 'bg-red-500 animate-pulse' : 'bg-slate-700 hover:bg-slate-600'}`}
          title="Dictar por voz"
        >
          {isListening ? '🔴' : '🎤'}
        </button>
        
        <input 
          suppressHydrationWarning
          className="flex-1 p-3 rounded-bg bg-slate-800 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={userName ? `Habla con el Genio, ${userName}...` : "Habla con el Genio..."}
        />
        
        <button 
          suppressHydrationWarning
          onClick={sendMessage} 
          className="bg-cyan-600 px-6 py-3 rounded-lg font-bold hover:bg-cyan-500 transition"
        >
          Enviar
        </button>
      </div>
    </main>
  );
}