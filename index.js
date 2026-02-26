const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = "mitokenhuertoia-bot";
const ACCESS_TOKEN = "IGAANQX1DjWRlBZAGJNdDRadGphREtPdXlGdkdOVGJNbXJPM3NVM3d0V0dPRjJiREpsUVhoenViRUxTWlZAERnN3dUE4WFI1UHhjNjQzTmZAIZAWZASRUs1V2pjaU5GUkpVa253bGlKYVFNcGRjUDJQbDRQd3phZAmt1MFBWMzJxclE4VQZDZD";

async function enviarMensaje(recipientId, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: texto }
      },
      {
        params: { access_token: ACCESS_TOKEN }
      }
    );
    console.log('Mensaje enviado a:', recipientId);
  } catch (error) {
    console.error('Error enviando mensaje:', error.response?.data);
  }
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('POST recibido:', JSON.stringify(body, null, 2));

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      // Formato 1: entry.messaging
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        if (event.message && !event.message.is_echo) {
          const senderId = event.sender.id;
          const texto = event.message.text;
          console.log('Mensaje de:', senderId, ':', texto);
          await enviarMensaje(senderId, `Hola! Recibí tu mensaje: "${texto}"`);
        }
      }

      // Formato 2: entry.changes
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'messages') {
          const senderId = change.value?.sender?.id;
          const texto = change.value?.message?.text;
          if (senderId && texto) {
            console.log('Mensaje de:', senderId, ':', texto);
            await enviarMensaje(senderId, `Hola! Recibí tu mensaje: "${texto}"`);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log('Servidor corriendo en puerto 3000');
});