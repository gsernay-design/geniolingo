"use client";
import { useState, useEffect, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import { db } from "../lib/firebase"; 
import { doc, setDoc, getDoc, collection, addDoc } from "firebase/firestore"; // <-- NUEVOS IMPORT DE FIREBASE

const SYSTEM_PROMPT = `
Eres GenioLingo, el tutor políglota inteligente de la familia de Giovanni. Tu misión es enseñar el idioma que el usuario elija con lógica de ingeniería.
 
REGLA ESTRICTA DE MODALIDAD (TEXTO VS AUDIO):
- Si el usuario te responde por ESCRITO (texto puro), corrige su gramática y vocabulario, pero TIENES PROHIBIDO hacer análisis vocal de su pronunciación (porque no hay voz).
- Evalúa la pronunciación fonética EXCLUSIVAMENTE si el mensaje incluye un archivo de AUDIO adjunto (nota de voz) en el idioma extranjero.

REGLA GLOBAL DE CAMBIO DE IDIOMA: En cualquier momento, si pide cambiar de idioma, aborta la etapa actual y salta a la ETAPA 2.
 
ETAPA 1: EL VUELO DE BIENVENIDA (Solo la primera sesión)
1. Inicia un "Vuelo de Bienvenida" amigable para recolectar: Idioma nativo, Nombre/apodo, Género/Pronombres (ej. masculino, femenino, él/ella), Idioma Objetivo, Edad, Intereses/Profesión y Nivel de experiencia.
2. EXTREMADAMENTE IMPORTANTE: Haz UNA SOLA PREGUNTA por mensaje. Si te da varios datos, acéptalos y pregunta el siguiente.
 
ETAPA 2: EL DIAGNÓSTICO
- Ajusta tu tono según la edad. Realiza 3 preguntas rápidas situacionales. UNA SOLA PREGUNTA por mensaje.
- CANDADO DE ETAPA: Durante este diagnóstico está ESTRICTAMENTE PROHIBIDO dar explicaciones de fonética, pronunciación o mecánicas vocales. Limítate a hacer las preguntas y evaluar solo la gramática y el vocabulario.
 
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
- APLICA ESTO ÚNICAMENTE DURANTE LA LECCIÓN (ETAPA 8). NUNCA en el diagnóstico.
 
ETAPA 6: MENÚ DE INICIO Y GESTIÓN DE TIEMPO
- Saluda por nombre, detecta idiomas previos y ofrece: 🚀 Misión Relámpago, 📚 Lección Maestra (preguntar tiempo: 5, 15, 30 min) o 🧞 Consulta al Genio.
 
ETAPA 7: SENSOR DE ENERGÍA Y ÁNIMO (MINDFUL CHECK)
- Pregunta la energía (1-5). Ajusta la intensidad de la lección según el resultado.
 
ETAPA 8: LA LECCIÓN
- Ejecuta la lección con la ingeniería gramatical.
- AQUÍ ES DONDE SÍ DEBES aplicar la fonética evolutiva (Etapa 5) y explicar cómo se pronuncian las palabras que estás enseñando.
 
ETAPA 9: CIERRE
- Resumen corto, otorga "GenioGemas" y despedida cálida.
- MUY IMPORTANTE: Genera un bloque exacto con este formato para guardar el progreso:
  [MURO FAMILIAR]
  Título: "¡Victoria! [Nombre] completó un reto de [Idioma] 🌍"
  Original: [Frase aprendida]
  Traducción: [Traducción al español]
  Fonética: [Pronunciación]
  Contexto: [Breve elogio]
`;

export default function GenioLingoApp() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("El Genio te escucha...");
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
      shouldAutoSend.current = true;
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
    setLoadingText("El Genio está pensando...");
    
    const textoUsuario = currentInput || "🎤 [Nota de voz]";
    const userMessage = { role: "user", text: textoUsuario };
    
    const mensajesLimpios = messages.filter(m => m.role !== "error");
    const updatedMessages = [...mensajesLimpios, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setAudioBlob(null);

    try {
      const apiKey = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();
      const ai = new GoogleGenAI({ apiKey: apiKey });

      let currentParts: any[] = [{ text: textoUsuario }];

      if (currentAudio) {
        const base64Audio = await blobToBase64(currentAudio);
        currentParts.push({ 
          inlineData: { mimeType: currentAudio.type.split(';')[0] || 'audio/webm', data: base64Audio } 
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

      let result;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        try {
          result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: historialContexto,
            config: { systemInstruction: SYSTEM_PROMPT }
          });
          break; 
        } catch (apiError: any) {
          const errorMsg = apiError.message?.toLowerCase() || "";
          const isRetryable = errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("high demand") || errorMsg.includes("quota");
          
          if (isRetryable && retries < maxRetries - 1) {
            retries++;
            setLoadingText(`Servidores ocupados. El Genio busca otra ruta mágica... (Intento ${retries})`);
            await new Promise(resolve => setTimeout(resolve, 3000 * retries));
          } else {
            throw apiError;
          }
        }
      }

      let genioText = result?.text || "¿Podrías repetirlo?";

      // --- 🕵️‍♂️ INTERCEPTOR DEL MURO FAMILIAR ---
      if (genioText.includes("[MURO FAMILIAR]")) {
        try {
          // 1. Dividimos el mensaje para separar la charla normal de los datos del muro
          const partes = genioText.split("[MURO FAMILIAR]");
          const charlaGenio = partes[0].trim();
          const datosMuro = partes[1]; // Aquí está todo lo que sigue a la etiqueta

          // 2. Extraemos la información usando expresiones regulares (Regex)
          const titulo = datosMuro.match(/Título:\s*(.*)/i)?.[1] || "Nuevo Logro Desbloqueado";
          const original = datosMuro.match(/Original:\s*(.*)/i)?.[1] || "";
          const traduccion = datosMuro.match(/Traducción:\s*(.*)/i)?.[1] || "";
          const fonetica = datosMuro.match(/Fonética:\s*(.*)/i)?.[1] || "";
          const contexto = datosMuro.match(/Contexto:\s*(.*)/i)?.[1] || "";

          // 3. Enviamos el paquete a Firebase (Colección: muro_publico)
          await addDoc(collection(db, "muro_publico"), {
            usuario: userName || "Familia",
            fecha: new Date(),
            timestamp: Date.now(), // Para ordenar del más nuevo al más viejo
            titulo,
            original,
            traduccion,
            fonetica,
            contexto
          });

          // 4. Modificamos el texto que verá el usuario para que sea bonito
          genioText = charlaGenio + "\n\n🌟 *¡Tu logro ha sido publicado en el Muro Familiar!*";
        } catch (error) {
          console.error("Error procesando el Muro Familiar:", error);
        }
      }
      // --- FIN DEL INTERCEPTOR ---

      const genioResponse = { role: "genio", text: genioText };
      const finalHistory = [...updatedMessages, genioResponse];
      
      setMessages(finalHistory);
      leerTexto(genioText);

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
      console.error("Error Real de API:", error);
      setMessages(prev => [...prev, { role: "error", text: "El portal mágico está inestable. ¡Intenta enviar tu mensaje otra vez!" }]);
    } finally { 
      setLoading(false); 
      setLoadingText("El Genio te escucha..."); 
    }
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
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            {msg.role === 'genio' && (
              <button onClick={() => leerTexto(msg.text)} className="mt-2 text-lg hover:scale-110 transition-transform" title="Volver a escuchar">🔊</button>
            )}
          </div>
        ))}
        {loading && <div className="text-cyan-500 text-[10px] font-mono animate-pulse">{loadingText}</div>}
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
        
        <button 
          onClick={sendMessage} 
          disabled={loading}
          className="bg-cyan-600 px-4 py-3 rounded-2xl font-bold hover:bg-cyan-500 transition active:scale-95 text-xs"
        >
          {loading ? '...' : 'ENVIAR'}
        </button>
      </div>
      <p className="text-[8px] text-center text-slate-700 mt-2">Mantén presionado para hablar. Suelta para enviar.</p>
    </main>
  );
}