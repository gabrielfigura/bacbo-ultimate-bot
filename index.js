import axios from 'axios';
import cheerio from 'cheerio';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const URL = 'https://casinoscores.com/es/bac-bo/';

let historyArr = [];
let placar = { SG: 0, IG: 0, LS: 0 };
let pendingSignal = null;
let coldMsgId = null;

// Envia mensagens ao Telegram
async function sendTelegram(text) {
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'Markdown'
  };
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload)
    .then(res => res.data)
    .catch(err => console.error('Telegram send error:', err.message));
}

// Busca dados do site
async function fetchHistory() {
  const { data } = await axios.get(URL);
  const $ = cheerio.load(data);
  const arr = [];
  $('.last-result-item').each((i, el) => {
    const txt = $(el).text().trim().toUpperCase();
    if (txt.includes('AZUL')) arr.push('AZUL');
    else if (txt.includes('ROJO') || txt.includes('VERMELHO')) arr.push('VERMELHO');
    else if (txt.includes('TIE')) arr.push('TIE');
  });
  return arr.slice(0, 20).reverse();
}

// Confiança baseada no padrão (exemplo heurístico simplificado)
function calcConfidence(patternName, seq) {
  const base = {
    'surf': 95,
    'alternancia': 85,
    'quebra': 80,
    '2x2': 78,
    '3x2': 82,
    '3x1': 80,
    '2x1': 75,
    'v': 88,
    'torres': 90,
    'perninhas': 83,
    'parzinho': 84,
    'rampaCurta': 80,
    'rampaAlongada': 92,
    'rampaInvertida': 92
  };
  return base[patternName] || 75;
}

// Identifica um padrão e retorna o tipo, cor e confiança
function detectPattern(arr) {
  const n = arr.length;
  if (n < 4) return null;
  const last4 = arr.slice(-4), last5 = arr.slice(-5);

  // exemplos de padrões
  if (new Set(last5).size === 1) return { type: 'surf', color: last5[0], len: 5 };
  if (last4.every((v,i) => v === last4[0] && i<4)) return { type: 'quebra', color: last4[0], len: 4 };
  // alternância
  if (last4[0] !== last4[1] && last4[0] === last4[2] && last4[1] === last4[3]) {
    return { type: 'alternancia', color: last4[0], len: 4 };
  }
  // V
  if (n>=3 && arr.slice(-3).join(',') === 'AZUL,VERMELHO,AZUL') return { type: 'v', color: 'AZUL', len: 3 };
  if (n>=3 && arr.slice(-3).join(',') === 'VERMELHO,AZUL,VERMELHO') return { type: 'v', color: 'VERMELHO', len: 3 };
  // 3x2 e 2x3
  if (n>=5 && new Set(arr.slice(-5, -2)).size===1 && new Set(arr.slice(-2)).size===1) {
    return { type: '3x2', color: arr.slice(-5, -2)[0], len: 5 };
  }
  if (n>=3 && arr.slice(-3, -1).every(v => v===arr[n-1])) return { type: '2x1', color: arr[n-1], len: 3 };
  // perninhas / parzinho
  // (Exemplo: implementações similares...)
  // Rampa curta / invertida / alongada, torres gêmeas...
  // (Aqui você mesmo pode ajustar conforme preferir)

  return null;
}

// Processar um sinal detectado
async function processSignal(pattern) {
  const conf = calcConfidence(pattern.type, historyArr);
  pendingSignal = {
    entryColor: pattern.color,
    confidence: conf
  };
  // Mensagem inicial de sinal
  await sendTelegram(`🎲 Novo sinal Bac Bo ao vivo:\nEntrada: ${pattern.color.repeat(3 === 3 ? 3 : 3)}\nProtege o TIE🟡\nFazer apenas 1 gale🎯\nConfiança: ${conf}%`);
}

// Validar resultado após sinal
async function validateSignal() {
  const last = historyArr[historyArr.length-1];
  const first = pendingSignal.entryColor;
  if (!pendingSignal) return;

  if (last === first) {
    // acerto direto
    await sendTelegram(`QUEM NÃO ARRISCA, NÃO PETISCA DENTRO(${first === 'AZUL' ? '🔵' : '🔴'})✅`);
    placar.SG++;
  } else {
    // gale
    // esperar próxima, simplificação: gale assume inverso
    const galeWin = last !== first && last !== 'TIE';
    if (galeWin) {
      await sendTelegram(`QUEM NÃO ARRISCA, NÃO PETISCA DENTRO(${first === 'AZUL' ? '🔵' : '🔴'} ➡️ ${last === 'AZUL' ? '🔵' : '🔴'})✅`);
      placar.IG++;
    } else {
      await sendTelegram(`ESSA NÃO FOI NOSSA😔`);
      placar.LS++;
    }
  }
  // Imprime placar
  await sendTelegram(`PLACAR ACTUAL🎯\nSG: ${placar.SG}🔥\nIG: ${placar.IG}✅\nLS: ${placar.LS}❌`);
  pendingSignal = null;
}

// Mensagem FRIA a cada 30s
async function sendColdMsg() {
  if (pendingSignal) return;
  const msg = await sendTelegram('PREVENDO O GRÁFICO FICA FRIO 🥶');
  coldMsgId = msg?.result?.message_id;
}

// Loop principal
async function mainLoop() {
  const arr = await fetchHistory();
  if (!historyArr.length || arr[arr.length-1] !== historyArr[historyArr.length-1]) {
    historyArr = arr;
    if (pendingSignal) {
      await validateSignal();
    }
    const p = detectPattern(historyArr);
    if (p) await processSignal(p);
  }
}

// Inicialização
(async () => {
  await sendTelegram('🟡 Bot iniciado!\n⏳ Analisando padrões do *Bac Bo* ao vivo...');
  setInterval(mainLoop, 6000);
  setInterval(sendColdMsg, 30000);
})();
