import { askAgent, isAgentConnected } from './n8n-connector.js';
import { logEvent } from './audit-log.js';
import { getCurrentUser, checkPermission } from './auth.js';

let chatHistory = [];

export function initChatWidget() {
  const btnOpen = document.getElementById('btn-open-chat');
  const btnClose = document.getElementById('btn-toggle-chat');
  const chatWidget = document.getElementById('ai-chat-widget');
  const btnSend = document.getElementById('btn-send-chat');
  const input = document.getElementById('chat-input');
  
  if (!btnOpen || !chatWidget) return;
  
  // Mostrar el botón de abrir si tiene permisos
  setInterval(() => {
    const hasPerm = checkPermission('USE_AI_ASSISTANT');
    if (hasPerm && chatWidget.classList.contains('hidden')) {
      btnOpen.classList.remove('hidden');
    } else {
      btnOpen.classList.add('hidden');
      if (!hasPerm && !chatWidget.classList.contains('hidden')) {
        chatWidget.classList.add('hidden');
      }
    }
  }, 1000);
  
  btnOpen.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    btnOpen.classList.add('hidden');
    input.focus();
  });
  
  btnClose.addEventListener('click', () => {
    chatWidget.classList.add('hidden');
    btnOpen.classList.remove('hidden');
  });
  
  btnSend.addEventListener('click', handleSend);
  
  // Quick replies
  const quickReplies = document.querySelectorAll('.btn-quick-reply');
  quickReplies.forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.innerText;
      btnSend.click();
    });
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
  
  // Polling para el estado de conexión del led
  setInterval(() => {
    const led = document.getElementById('chat-status-led');
    if (led) {
      if (isAgentConnected()) {
        led.className = 'status-led led-green';
        led.title = 'Agente N8N Conectado';
      } else {
        led.className = 'status-led led-orange';
        led.title = 'Modo Local / Degradado (Sin conexión)';
      }
    }
  }, 2000);
}

async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  addMessage(text, 'user');
  
  // Guardar en auditoría
  const currentUser = getCurrentUser();
  logEvent('AI_INTERACTION', `Consulta al Asistente IA: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, currentUser ? currentUser.name : 'Unknown');
  
  // Mostrar indicador de "escribiendo..."
  const thinkingId = addMessage('...', 'bot-thinking');
  
  const historyContext = chatHistory.slice(-6); // últimos 6 mensajes
  
  try {
    const response = await askAgent(text, historyContext);
    
    // Remover thinking
    const el = document.getElementById(thinkingId);
    if (el) el.remove();
    
    addMessage(response.text, 'bot');
    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: response.text });
    
  } catch (err) {
    const el = document.getElementById(thinkingId);
    if (el) el.remove();
    addMessage('Error interno al consultar al agente.', 'bot');
  }
}

function addMessage(text, type) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const id = 'msg-' + Date.now() + '-' + Math.floor(Math.random()*1000);
  div.id = id;
  
  if (type === 'user') {
    div.className = 'msg user';
  } else if (type === 'bot' || type === 'bot-thinking') {
    div.className = 'msg bot';
  }
  
  div.textContent = text; // Previene XSS
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}
