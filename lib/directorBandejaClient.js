/**
 * Copia este archivo al proyecto del bot Instagram de Dani.
 * Conecta el bot con la bandeja del Director vía HTTP.
 *
 * .env en el bot Dani:
 *   DIRECTOR_API_URL=http://localhost:3000
 *   DIRECTOR_API_KEY=huerto-dir-8f3k2m9x7p1q4w6n
 */

const axios = require('axios');

function createDirectorClient(baseUrl, apiKey) {
  const http = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    timeout: 15000,
  });

  return {
    /**
     * Instrucciones del Director en texto natural.
     * Dani las inyecta en su prompt y actúa (no copia texto literal ciego).
     */
    async getInstruccionesPendientes({ senderId, canal = 'instagram_dm' } = {}) {
      const { data } = await http.get('/api/integracion/instrucciones-dani', {
        params: {
          referenciaCliente: senderId || undefined,
          canal,
        },
      });
      return data;
    },

    async marcarInstruccionHecha(instruccionId, { respuestaDani = '' } = {}) {
      const { data } = await http.patch(`/api/integracion/instrucciones/${instruccionId}/hecho`, {
        respuestaDani,
      });
      return data;
    },

    /** Tras cada DM: registra conversación para que el Director la lea */
    async registrarTurnoDM({ senderId, username, userMessage, botReply, conversacionId }) {
      const { data } = await http.post('/api/integracion/dm-turno', {
        senderId,
        username,
        userMessage,
        botReply,
        conversacionId,
      });
      return data;
    },

    /** Legacy — preferir getInstruccionesPendientes */
    async getTareasPendientes() {
      const { data } = await http.get('/api/integracion/tareas-dani');
      return data;
    },

    async marcarEnEjecucion(tareaId) {
      const { data } = await http.patch(`/api/integracion/tareas/${tareaId}/iniciar`);
      return data;
    },

    async reportarCompletada(tareaId, { resultado, clienteRespondio, notas }) {
      const { data } = await http.patch(`/api/integracion/tareas/${tareaId}/reporte`, {
        resultado,
        clienteRespondio,
        notas,
      });
      return data;
    },

    async health() {
      const { data } = await http.get('/api/health');
      return data;
    },
  };
}

/**
 * Integración natural en processMessage del bot Instagram:
 *
 * const director = createDirectorClient(process.env.DIRECTOR_API_URL, process.env.DIRECTOR_API_KEY);
 *
 * // Antes de generar respuesta RAG:
 * const instrucciones = await director.getInstruccionesPendientes({ senderId });
 * const contextoDirector = instrucciones.map(i => i.mensaje).join('\n');
 * // Añade contextoDirector al system prompt de GPT:
 * // "El Director te dice:\n" + contextoDirector
 *
 * const reply = await generateDMReply(..., contextoDirector);
 * await sendMessage(senderId, reply);
 *
 * for (const inst of instrucciones) {
 *   await director.marcarInstruccionHecha(inst.id, { respuestaDani: reply.slice(0, 200) });
 * }
 *
 * await director.registrarTurnoDM({ senderId, username, userMessage: text, botReply: reply, conversacionId });
 */

module.exports = { createDirectorClient };
