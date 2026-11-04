/**
 * Agenda de Atendimentos: dados e regras, rodando no navegador, sem servidor.
 *
 * Cada pessoa entra com a própria conta Google. O navegador fala direto com o Google:
 * os dados ficam numa planilha no Drive da pessoa e os lembretes na Agenda dela.
 * O controle de quem pagou é simples (roda no aparelho): lista pública de e-mails em hash.
 */

const CLIENTE_ID = '208261430716-j7lpjm0beh0m7shofbhl788eh86v0oie.apps.googleusercontent.com';
const PROJETO_GOOGLE = '208261430716';
const ESCOPOS = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];
const DONO = 'wercely@gmail.com';
const ACESSOS_ID = ''; // planilha pública só com os hashes dos e-mails liberados

const NOME_PLANILHA = 'Agenda de Atendimentos (dados)';
const MARCA_PLANILHA = 'agendaAtendimentos'; // marca no Drive para achar a planilha em qualquer aparelho

const ABAS = {
  config: { nome: 'Config', colunas: ['chave', 'valor'] },
  pacientes: {
    nome: 'Pacientes',
    colunas: ['id', 'nome', 'telefone', 'endereco', 'observacoes', 'sessoesContratadas', 'valorSessao', 'ativo', 'criadoEm'],
  },
  sessoes: {
    nome: 'Sessoes',
    colunas: ['id', 'pacienteId', 'data', 'hora', 'duracao', 'local', 'tarefa', 'status', 'anotacao', 'pago', 'valor', 'eventoId', 'criadoEm', 'serieId'],
  },
  acessos: { nome: 'Acessos', colunas: ['id'] }, // só na planilha do administrador
};

const CONFIG_PADRAO = {
  nomeProfissional: '',
  registroProfissional: '',
  nomeCliente: 'Paciente',
  nomeSessao: 'Sessão',
  lembreteMinutos: '60, 15',
  duracaoPadrao: '60',
  valorPadrao: '',
  controlarPagamentos: 'sim',
  controlarPacotes: 'sim',
};

const STATUS_VALIDOS = ['agendada', 'realizada', 'falta', 'cancelada'];
const PREFIXO_EVENTO = { agendada: '', realizada: '✔ ', falta: '✖ Faltou · ' };

const PENDENTE = 'pendente:';
const AVISO_LOTE = 'Não deu para fazer tudo de uma vez no Google Agenda.';

// Trocados nos testes e pela tela.
let esperar = ms => new Promise(ok => setTimeout(ok, ms));
let aoProgredir = () => {};

// ---------- Login ----------
// O Google dá um acesso de 1 hora. Fica guardado neste aparelho para não pedir de novo a cada abertura.

const CHAVE_SESSAO = 'agenda.sessao';
const SESSAO = { token: '', expira: 0, email: '' };

function guardado_(chave) {
  try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
}

function guardar_(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento: só pede login de novo */ }
}

Object.assign(SESSAO, guardado_(CHAVE_SESSAO));

function tokenValido(margemMs) {
  return !!SESSAO.token && Date.now() + (margemMs === undefined ? 5 * 60000 : margemMs) < SESSAO.expira;
}

/** Precisa ser chamado direto de um toque na tela; senão o aparelho bloqueia a janela do Google. */
function entrar(trocarConta) {
  return new Promise((ok, falha) => {
    if (!window.google || !google.accounts) return falha(new Error('O login do Google ainda está carregando. Tente de novo em alguns segundos.'));
    google.accounts.oauth2.initTokenClient({
      client_id: CLIENTE_ID,
      scope: ESCOPOS.join(' '),
      login_hint: trocarConta ? undefined : SESSAO.email || undefined,
      callback: r => {
        if (r.error) return falha(new Error('O Google não autorizou o acesso (' + r.error + ').'));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...ESCOPOS)) {
          return falha(new Error('Para funcionar, o app precisa de todas as permissões. Entre de novo e deixe todas marcadas.'));
        }
        SESSAO.token = r.access_token;
        SESSAO.expira = Date.now() + r.expires_in * 1000;
        google_('https://www.googleapis.com/oauth2/v3/userinfo').then(eu => {
          SESSAO.email = String(eu.email || '').trim().toLowerCase();
          guardar_(CHAVE_SESSAO, SESSAO);
          ok(SESSAO.email);
        }, falha);
      },
      error_callback: e => falha(new Error(e.type === 'popup_closed' ? 'A janela do Google foi fechada antes de terminar.' : 'Não foi possível abrir o login do Google. Tente de novo.')),
    }).requestAccessToken({ prompt: trocarConta ? 'select_account' : '' });
  });
}

function sair() {
  SESSAO.token = '';
  SESSAO.expira = 0;
  guardar_(CHAVE_SESSAO, SESSAO);
}

// ---------- Falar com o Google ----------

function limiteGoogle_(e) {
  return e.status === 429 || (e.status === 403 && /rate|quota|limit/i.test(e.motivo || ''));
}

async function google_(url, opcoes) {
  opcoes = opcoes || {};
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await chamar_(url, opcoes);
    } catch (e) {
      const passageiro = limiteGoogle_(e) || e.status === 500 || e.status === 503;
      if (!passageiro || tentativa >= 2) throw e;
      await esperar(3000 * (tentativa + 1));
    }
  }
}

async function chamar_(url, opcoes) {
  const pedido = { method: opcoes.method || 'GET', headers: { Authorization: 'Bearer ' + SESSAO.token } };
  if (opcoes.corpo) {
    pedido.headers['Content-Type'] = 'application/json';
    pedido.body = JSON.stringify(opcoes.corpo);
  }
  let r;
  try {
    r = await fetch(url, pedido);
  } catch (e) {
    throw Object.assign(new Error('Sem conexão com a internet. Confira a conexão e tente de novo.'), { semRede: true });
  }
  const texto = await r.text();
  if (r.ok) return texto ? JSON.parse(texto) : {};
  let detalhe = {};
  try { detalhe = JSON.parse(texto).error || {}; } catch (e) { /* resposta sem JSON */ }
  const motivo = (detalhe.errors && detalhe.errors[0] && detalhe.errors[0].reason) || detalhe.status || '';
  throw Object.assign(new Error(detalhe.message || 'O Google recusou o pedido (' + r.status + ').'), { status: r.status, motivo });
}

// ---------- Acesso ----------

function dono_() {
  return SESSAO.email === DONO;
}

function exigeDono_() {
  if (!dono_()) throw new Error('Somente o administrador pode fazer isso.');
}

async function hashEmail_(email) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Lista pública de hashes, lida sem login. O Google só permite isso por script (JSONP). */
let listaPublica_ = () => new Promise((ok, falha) => {
  const nome = 'acessos' + Date.now();
  const script = document.createElement('script');
  const limpar = () => { clearTimeout(tempo); delete window[nome]; script.remove(); };
  const tempo = setTimeout(() => { limpar(); falha(new Error('tempo esgotado')); }, 15000);
  window[nome] = r => {
    limpar();
    if (!r.table) return falha(new Error('lista indisponível'));
    ok(r.table.rows.map(l => l.c[0] && l.c[0].v).filter(Boolean));
  };
  script.onerror = () => { limpar(); falha(new Error('lista indisponível')); };
  script.src = 'https://docs.google.com/spreadsheets/d/' + ACESSOS_ID + '/gviz/tq?headers=0&tqx=out:json;responseHandler:' + nome;
  document.head.appendChild(script);
});

/** Se a lista não puder ser lida agora, vale a última resposta guardada neste aparelho. */
async function temAcesso_() {
  if (dono_()) return true;
  if (!SESSAO.email) return false;
  const chave = 'agenda.liberado.' + SESSAO.email;
  try {
    const liberado = (await listaPublica_()).includes(await hashEmail_(SESSAO.email));
    guardar_(chave, liberado);
    return liberado;
  } catch (e) {
    return guardado_(chave) === true;
  }
}

// ---------- Abrir a planilha ----------

const PLANILHA = { id: '', abas: {} };

const urlPlanilha_ = caminho => 'https://sheets.googleapis.com/v4/spreadsheets/' + PLANILHA.id + (caminho || '');
const urlIntervalo_ = intervalo => urlPlanilha_('/values/' + encodeURIComponent(intervalo));
const ultimaColuna_ = chave => String.fromCharCode(64 + ABAS[chave].colunas.length);
const abasUsadas_ = () => ['config', 'pacientes', 'sessoes'].concat(dono_() ? ['acessos'] : []);

/** Devolve os dados, ou diz que a pessoa não tem acesso ou que é o primeiro uso. */
async function abrirSessao() {
  if (!(await temAcesso_())) return { bloqueado: true, email: SESSAO.email };
  const q = encodeURIComponent("appProperties has { key='" + MARCA_PLANILHA + "' and value='1' } and trashed=false");
  const achadas = await google_('https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=1&fields=files(id)&q=' + q);
  if (!achadas.files || !achadas.files.length) return { primeiroUso: true, email: SESSAO.email };
  await prepararPlanilha_(achadas.files[0].id);
  return carregar();
}

async function criarPlanilha() {
  const nova = await google_('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', corpo: {
    properties: { title: NOME_PLANILHA },
    sheets: abasUsadas_().map(c => ({ properties: { title: ABAS[c].nome, gridProperties: { frozenRowCount: 1 } } })),
  } });
  await marcarPlanilha_(nova.spreadsheetId);
  await prepararPlanilha_(nova.spreadsheetId);
  return carregar();
}

/** Passa a usar uma planilha que a pessoa escolheu, a da versão anterior do app. */
async function adotarPlanilha(id) {
  await prepararPlanilha_(id, true);
  await marcarPlanilha_(id);
  return carregar();
}

function marcarPlanilha_(id) {
  return google_('https://www.googleapis.com/drive/v3/files/' + id, { method: 'PATCH', corpo: { appProperties: { [MARCA_PLANILHA]: '1' } } });
}

/** Cria as abas que faltam e completa cabeçalhos de planilhas criadas por versões antigas. */
async function prepararPlanilha_(id, exigirDados) {
  PLANILHA.id = id;
  const info = await google_(urlPlanilha_('?fields=sheets.properties(sheetId,title)'));
  const abas = () => Object.fromEntries(info.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  PLANILHA.abas = abas();
  if (exigirDados && !(ABAS.pacientes.nome in PLANILHA.abas && ABAS.sessoes.nome in PLANILHA.abas)) {
    PLANILHA.id = '';
    throw new Error('Essa planilha não é da Agenda. Escolha a "' + NOME_PLANILHA + '".');
  }
  const faltam = abasUsadas_().filter(c => !(ABAS[c].nome in PLANILHA.abas));
  if (faltam.length) {
    const r = await google_(urlPlanilha_(':batchUpdate'), { method: 'POST', corpo: {
      requests: faltam.map(c => ({ addSheet: { properties: { title: ABAS[c].nome, gridProperties: { frozenRowCount: 1 } } } })),
    } });
    r.replies.forEach(x => info.sheets.push({ properties: x.addSheet.properties }));
    PLANILHA.abas = abas();
  }
  const chaves = abasUsadas_();
  const lidos = await lerIntervalos_(chaves.map(c => ABAS[c].nome + '!A1:' + ultimaColuna_(c) + '1'));
  const data = chaves.filter((c, i) => (lidos[i][0] || []).join() !== ABAS[c].colunas.join())
    .map(c => ({ range: ABAS[c].nome + '!A1:' + ultimaColuna_(c) + '1', values: [ABAS[c].colunas] }));
  if (data.length) await escreverIntervalos_(data);
}

// ---------- Ler e gravar na planilha ----------

let BD = { config: {}, pacientes: [], sessoes: [], acessos: [] };

async function lerIntervalos_(intervalos) {
  const r = await google_(urlPlanilha_('/values:batchGet?' + intervalos.map(i => 'ranges=' + encodeURIComponent(i)).join('&')));
  return r.valueRanges.map(v => v.values || []);
}

function escreverIntervalos_(data) {
  return google_(urlPlanilha_('/values:batchUpdate'), { method: 'POST', corpo: { valueInputOption: 'RAW', data } });
}

async function lerTudo_() {
  const chaves = abasUsadas_();
  const lidos = await lerIntervalos_(chaves.map(c => ABAS[c].nome + '!A2:' + ultimaColuna_(c)));
  chaves.forEach((c, i) => {
    if (c === 'config') {
      BD.config = Object.assign({}, CONFIG_PADRAO);
      lidos[i].forEach(([k, v]) => { if (k in CONFIG_PADRAO) BD.config[k] = v || ''; });
    } else {
      BD[c] = lidos[i].filter(l => l[0]).map(l => Object.fromEntries(ABAS[c].colunas.map((col, j) => [col, l[j] || ''])));
    }
  });
}

/** Linhas atuais, lidas na hora: outro aparelho pode ter apagado linhas nesse meio-tempo. */
async function idsNaPlanilha_(chave) {
  const [linhas] = await lerIntervalos_([ABAS[chave].nome + '!A2:A']);
  return linhas.map(l => l[0] || '');
}

/** Atualiza as linhas existentes e acrescenta as novas, tudo de uma vez. */
async function gravar_(chave, objs) {
  if (!objs.length) return;
  const def = ABAS[chave];
  const ids = await idsNaPlanilha_(chave);
  const valores = o => def.colunas.map(c => (o[c] == null ? '' : String(o[c])));
  const existentes = objs.filter(o => ids.includes(o.id));
  const novas = objs.filter(o => !ids.includes(o.id));
  if (existentes.length) {
    await escreverIntervalos_(existentes.map(o => {
      const linha = ids.indexOf(o.id) + 2;
      return { range: def.nome + '!A' + linha + ':' + ultimaColuna_(chave) + linha, values: [valores(o)] };
    }));
  }
  if (novas.length) {
    await google_(urlIntervalo_(def.nome + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', corpo: { values: novas.map(valores) } });
  }
  objs.forEach(o => {
    const i = BD[chave].findIndex(x => x.id === o.id);
    if (i >= 0) BD[chave][i] = o; else BD[chave].push(o);
  });
}

/** Apaga de baixo para cima (os números das linhas não mudam no meio). */
async function apagarLinhas_(chave, lista) {
  const fora = lista.map(o => o.id);
  const linhas = (await idsNaPlanilha_(chave)).map((id, i) => (id && fora.includes(id) ? i + 1 : -1)).filter(i => i > 0).reverse();
  if (linhas.length) {
    const sheetId = PLANILHA.abas[ABAS[chave].nome];
    await google_(urlPlanilha_(':batchUpdate'), { method: 'POST', corpo: {
      requests: linhas.map(i => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } })),
    } });
  }
  BD[chave] = BD[chave].filter(o => !fora.includes(o.id));
}

const acha_ = (chave, id) => BD[chave].find(o => o.id === id) || null;

// ---------- Funções chamadas pela tela ----------

async function carregar() {
  await lerTudo_();
  return {
    config: BD.config,
    pacientes: BD.pacientes,
    sessoes: BD.sessoes,
    hoje: hoje_(),
    planilhaUrl: 'https://docs.google.com/spreadsheets/d/' + PLANILHA.id,
    email: SESSAO.email,
    admin: dono_(),
    liberados: dono_() ? BD.acessos.map(a => a.id).sort() : [],
  };
}

/** Parte sempre dos dados atuais da planilha e devolve os dados depois da mudança. */
async function operacao_(fn) {
  await lerTudo_();
  const resultado = await fn();
  const dados = await carregar();
  if (resultado && resultado.aviso) dados.aviso = resultado.aviso;
  return dados;
}

/** Reescreve de uma vez a lista pública, sem nenhum instante vazio: quem está liberado não fica de fora. */
async function publicarAcessos_() {
  const hashes = await Promise.all(BD.acessos.map(a => hashEmail_(a.id)));
  const total = 1000;
  const values = Array.from({ length: total }, (_, i) => [hashes[i] || '']);
  await google_('https://sheets.googleapis.com/v4/spreadsheets/' + ACESSOS_ID + '/values/' + encodeURIComponent('A1:A' + total) + '?valueInputOption=RAW', { method: 'PUT', corpo: { values } });
}

function liberarEmail(email) {
  return operacao_(async () => {
    exigeDono_();
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('E-mail inválido.');
    if (!acha_('acessos', e)) await gravar_('acessos', [{ id: e }]);
    await publicarAcessos_();
  });
}

function removerEmail(email) {
  return operacao_(async () => {
    exigeDono_();
    const e = String(email || '').trim().toLowerCase();
    await apagarLinhas_('acessos', [{ id: e }]);
    await publicarAcessos_();
  });
}

function salvarPaciente(entrada) {
  return operacao_(async () => {
    const nome = texto_(entrada.nome);
    if (!nome) throw new Error('Informe o nome.');
    const atual = entrada.id ? acha_('pacientes', entrada.id) : null;
    if (entrada.id && !atual) throw new Error('Cadastro não encontrado.');

    const p = Object.assign({ id: crypto.randomUUID(), ativo: 'sim', criadoEm: agora_() }, atual, { nome });
    ['telefone', 'endereco', 'observacoes'].forEach(c => { if (c in entrada) p[c] = texto_(entrada[c]); });
    ['sessoesContratadas', 'valorSessao'].forEach(c => { if (c in entrada) p[c] = numero_(entrada[c]); });
    await gravar_('pacientes', [p]);

    if (atual && atual.nome !== nome) await atualizarEventosFuturos_(s => s.pacienteId === p.id);
  });
}

/**
 * Arquiva (parou de ser atendido) ou reativa um cadastro. O histórico é preservado;
 * ao arquivar, as sessões futuras agendadas são canceladas e saem da agenda.
 */
function definirAtivo(id, ativo) {
  return operacao_(async () => {
    const p = acha_('pacientes', id);
    if (!p) throw new Error('Cadastro não encontrado.');
    p.ativo = ativo ? 'sim' : 'nao';
    await gravar_('pacientes', [p]);
    if (ativo) return;
    const hoje = hoje_();
    const faltaram = await emLote_(BD.sessoes.filter(s => s.pacienteId === id && s.status === 'agendada' && s.data >= hoje), async s => {
      await apagarEvento_(s);
      s.status = 'cancelada';
      s.eventoId = '';
    }, feitas => gravar_('sessoes', feitas));
    if (faltaram.length) return { aviso: AVISO_LOTE + ' Ainda faltam ' + faltaram.length + ' agendamento(s); toque em arquivar de novo daqui a alguns minutos.' };
  });
}

/** Exclui de vez o cadastro e todas as sessões dele; os eventos na agenda também, a menos que "manterEventos". */
function excluirPaciente(id, manterEventos) {
  return operacao_(async () => {
    const p = acha_('pacientes', id);
    if (!p) throw new Error('Cadastro não encontrado.');
    const dele = BD.sessoes.filter(s => s.pacienteId === id);
    if (manterEventos) {
      await apagarLinhas_('sessoes', dele);
    } else {
      const faltaram = await apagarSessoes_(dele);
      if (faltaram) return { aviso: AVISO_LOTE + ' Ainda faltam ' + faltaram + ' agendamento(s); toque em Excluir de novo daqui a alguns minutos.' };
    }
    await apagarLinhas_('pacientes', [p]);
  });
}

/**
 * Cria (ou edita, se entrada.id existir) uma sessão e o evento correspondente na agenda.
 * repeticao = { dias: [0..6], horarios: { dia: 'hh:mm' }, periodo } cria as sessões a partir de entrada.data.
 * opcoes.aplicarSeguintes (edição): leva horário, duração, local, tarefa e valor às próximas da repetição.
 * opcoes.substituirFuturas (criação): apaga antes os agendamentos do paciente a partir de entrada.data.
 */
function salvarSessao(entrada, repeticao, opcoes) {
  opcoes = opcoes || {};
  return operacao_(async () => {
    const cfg = BD.config;
    const pac = acha_('pacientes', entrada.pacienteId);
    if (!pac) throw new Error('Escolha quem será atendido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data)) throw new Error('Data inválida.');
    if (!/^\d{2}:\d{2}$/.test(entrada.hora)) throw new Error('Horário inválido.');

    const base = {
      pacienteId: pac.id,
      hora: entrada.hora,
      duracao: numero_(entrada.duracao) || cfg.duracaoPadrao,
      local: texto_(entrada.local),
      tarefa: texto_(entrada.tarefa),
    };
    if ('valor' in entrada) base.valor = numero_(entrada.valor);

    if (entrada.id) {
      const s = acha_('sessoes', entrada.id);
      if (!s) throw new Error('Sessão não encontrada.');
      const seguintes = opcoes.aplicarSeguintes ? BD.sessoes.filter(x => seguinteDaSerie_(s, x)) : [];
      const diaDaSemana = data => dataLocal_(data, '00:00').getDay();
      const diaAntes = diaDaSemana(s.data);
      Object.assign(s, base, { data: entrada.data });
      // O horário é por dia da semana: só muda nas próximas do mesmo dia; o resto vale para toda a repetição.
      seguintes.forEach(x => Object.assign(x, base, { hora: diaDaSemana(x.data) === diaAntes ? base.hora : x.hora }));
      const faltaram = await gravarComEventos_([s].concat(seguintes));
      if (faltaram) return { aviso: avisoPendentes_(faltaram) };
      return;
    }

    const ocorrencias = datasRepeticao_(entrada.data, repeticao, entrada.hora);
    if (!ocorrencias.length) throw new Error('Nenhum dos dias escolhidos cai nesse período. Escolha outro dia ou um período maior.');

    if (opcoes.substituirFuturas) {
      const antigas = BD.sessoes.filter(x => x.pacienteId === pac.id && x.status === 'agendada' && x.data >= entrada.data);
      const faltaram = await apagarSessoes_(antigas);
      if (faltaram) return { aviso: AVISO_LOTE + ' Faltou apagar ' + faltaram + ' agendamento(s) antigo(s); os novos ainda não foram criados. Tente de novo daqui a alguns minutos.' };
    }

    const serieId = ocorrencias.length > 1 ? crypto.randomUUID() : '';
    const novas = ocorrencias.map(o => Object.assign({
      id: crypto.randomUUID(), status: 'agendada', anotacao: '', pago: 'nao',
      valor: pac.valorSessao || cfg.valorPadrao, criadoEm: agora_(), serieId, eventoId: '',
    }, base, o));
    const faltaram = await gravarComEventos_(novas);
    if (faltaram) {
      return { aviso: (novas.length - faltaram) + ' de ' + novas.length + ' agendamentos já estão na Agenda do Google. ' + avisoPendentes_(faltaram) };
    }
  });
}

/** Cria ou atualiza na agenda os lembretes que o Google não deixou fazer antes. */
function sincronizarPendentes() {
  return operacao_(async () => {
    const hoje = hoje_();
    const lista = BD.sessoes.filter(s => pendente_(s, hoje));
    if (!lista.length) return { aviso: 'Nenhum lembrete pendente.' };
    const faltaram = await gravarComEventos_(lista);
    return { aviso: faltaram
      ? (lista.length - faltaram) + ' lembrete(s) refeito(s). ' + avisoPendentes_(faltaram)
      : 'Pronto: ' + lista.length + ' lembrete(s) refeito(s) na Agenda do Google.' };
  });
}

/** Muda status, anotação e/ou pagamento de uma sessão. */
function alterarSessao(id, mudancas) {
  return operacao_(async () => {
    const s = acha_('sessoes', id);
    if (!s) throw new Error('Sessão não encontrada.');
    if ('status' in mudancas) {
      if (!STATUS_VALIDOS.includes(mudancas.status)) throw new Error('Situação inválida.');
      s.status = mudancas.status;
    }
    if ('anotacao' in mudancas) s.anotacao = texto_(mudancas.anotacao);
    if ('pago' in mudancas) s.pago = mudancas.pago === 'sim' ? 'sim' : 'nao';
    if ('status' in mudancas || 'anotacao' in mudancas) {
      s.eventoId = await sincronizarEvento_(s, acha_('pacientes', s.pacienteId), BD.config);
    }
    await gravar_('sessoes', [s]);
  });
}

/**
 * Apaga a sessão e o evento na agenda. "mais" diz quantas das próximas ainda agendadas da mesma
 * repetição apagar junto (mesma série; para sessões antigas, sem série: mesmo paciente e horário).
 */
function apagarSessao(id, mais) {
  return operacao_(async () => {
    const s = acha_('sessoes', id);
    if (!s) return;
    const proximas = BD.sessoes.filter(x => seguinteDaSerie_(s, x))
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
      .slice(0, Math.max(parseInt(mais, 10) || 0, 0));
    const faltaram = await apagarSessoes_([s].concat(proximas));
    if (faltaram) return { aviso: AVISO_LOTE + ' Faltou apagar ' + faltaram + ' agendamento(s); toque em apagar de novo daqui a alguns minutos.' };
  });
}

function seguinteDaSerie_(s, x) {
  const mesmaSerie = s.serieId ? x.serieId === s.serieId : x.pacienteId === s.pacienteId && x.hora === s.hora;
  return mesmaSerie && x.status === 'agendada' && x.data + x.hora > s.data + s.hora;
}

function marcarPagas(pacienteId) {
  return operacao_(async () => {
    const lista = BD.sessoes.filter(s => s.pacienteId === pacienteId && s.status === 'realizada' && s.pago !== 'sim');
    lista.forEach(s => { s.pago = 'sim'; });
    await gravar_('sessoes', lista);
  });
}

function salvarConfig(entrada) {
  return operacao_(async () => {
    const antes = BD.config;
    const cfg = {};
    Object.keys(CONFIG_PADRAO).forEach(k => { cfg[k] = k in entrada ? texto_(entrada[k]) : antes[k]; });
    cfg.controlarPagamentos = cfg.controlarPagamentos === 'sim' ? 'sim' : 'nao';
    cfg.controlarPacotes = cfg.controlarPacotes === 'sim' ? 'sim' : 'nao';
    cfg.nomeCliente = cfg.nomeCliente || CONFIG_PADRAO.nomeCliente;
    cfg.nomeSessao = cfg.nomeSessao || CONFIG_PADRAO.nomeSessao;
    cfg.lembreteMinutos = lembretes_(cfg).join(', ');
    cfg.duracaoPadrao = numero_(cfg.duracaoPadrao) || CONFIG_PADRAO.duracaoPadrao;
    cfg.valorPadrao = numero_(cfg.valorPadrao);

    const chaves = Object.keys(cfg);
    await escreverIntervalos_([{ range: ABAS.config.nome + '!A2:B' + (chaves.length + 1), values: chaves.map(k => [k, cfg[k]]) }]);
    BD.config = cfg;

    if (cfg.lembreteMinutos !== antes.lembreteMinutos) await atualizarEventosFuturos_(() => true);
  });
}

// ---------- Agenda do Google ----------

const URL_AGENDA = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** O id gravado pela versão anterior do app termina em @google.com; a agenda conhece só a primeira parte. */
const eventoGravado_ = s => String(s.eventoId || '').replace(PENDENTE, '').replace(/@google\.com$/, '');

/**
 * Id do evento tirado do id da sessão (só letras a-f, números e "ag" são aceitos pela agenda).
 * Assim, repetir o pedido depois de uma queda nunca cria evento duplicado.
 */
const eventoProprio_ = s => 'ag' + s.id.replace(/-/g, '').toLowerCase();

/** Cria/atualiza/remove o evento da sessão e devolve o id do evento ('' se não houver). */
async function sincronizarEvento_(s, pac, cfg) {
  if (s.status === 'cancelada') {
    await apagarEvento_(s);
    return '';
  }
  const inicio = dataLocal_(s.data, s.hora);
  const fim = new Date(inicio.getTime() + (Number(s.duracao) || 60) * 60000);
  const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const corpo = {
    summary: PREFIXO_EVENTO[s.status] + (pac ? pac.nome : 'Atendimento'),
    start: { dateTime: dataHora_(inicio), timeZone: fuso },
    end: { dateTime: dataHora_(fim), timeZone: fuso },
    location: s.local,
    description: [
      s.tarefa,
      pac && pac.telefone ? 'Telefone: ' + pac.telefone : '',
      s.anotacao ? 'Anotação: ' + s.anotacao : '',
    ].filter(Boolean).join('\n'),
    reminders: { useDefault: false, overrides: s.status === 'agendada' ? lembretes_(cfg).map(minutes => ({ method: 'popup', minutes })) : [] },
    status: 'confirmed', // traz de volta um evento que tinha sido apagado
  };
  const atualizar = id => google_(URL_AGENDA + '/' + id, { method: 'PATCH', corpo });
  const gravado = eventoGravado_(s);
  if (gravado) {
    try {
      await atualizar(gravado);
      return gravado;
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;
    }
  }
  const proprio = eventoProprio_(s);
  try {
    await google_(URL_AGENDA, { method: 'POST', corpo: Object.assign({ id: proprio }, corpo) });
  } catch (e) {
    if (e.status !== 409) throw e; // já existe: uma tentativa anterior criou, ou foi apagado antes
    await atualizar(proprio);
  }
  return proprio;
}

/** Sem id gravado, tenta o id próprio: uma queda pode ter criado o evento sem dar tempo de anotar. */
async function apagarEvento_(s) {
  try {
    await google_(URL_AGENDA + '/' + (eventoGravado_(s) || eventoProprio_(s)), { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e; // já não estava na agenda
  }
}

async function atualizarEventosFuturos_(filtro) {
  const hoje = hoje_();
  await gravarComEventos_(BD.sessoes.filter(s => s.status === 'agendada' && s.data >= hoje && filtro(s)));
}

// ---------- Muitas alterações seguidas ----------
// O Google recusa por um tempo quando há alterações demais, e o celular pode cair ou fechar o app no meio.
// Por isso, o que muda vai primeiro para a planilha, marcado como pendente, e a marca sai quando o evento fica pronto.

const emSerie = 20; // a cada quantos eventos anota o progresso na planilha

/** Motivos para parar e deixar o resto para depois, em vez de dar erro. */
function interrompe_(e) {
  return limiteGoogle_(e) || e.status === 401 || !!e.semRede;
}

/** Faz a operação item a item, devagar; se precisar parar, devolve os que faltaram. */
async function emLote_(itens, op, gravarFeitos) {
  let feitos = [];
  const anotar = async () => {
    const lista = feitos;
    feitos = [];
    if (gravarFeitos && lista.length) await gravarFeitos(lista);
  };
  for (let i = 0; i < itens.length; i++) {
    try {
      if (i) await esperar(250);
      await op(itens[i]);
    } catch (e) {
      await anotar().catch(() => {});
      if (!interrompe_(e)) throw e;
      return itens.slice(i);
    }
    feitos.push(itens[i]);
    aoProgredir(i + 1, itens.length);
    if (feitos.length >= emSerie) await anotar();
  }
  await anotar();
  return [];
}

/** Grava as sessões e faz os eventos; as que ficarem sem evento continuam como pendentes. Devolve quantas. */
async function gravarComEventos_(lista) {
  const pacientes = Object.fromEntries(BD.pacientes.map(p => [p.id, p]));
  lista.forEach(s => { s.eventoId = PENDENTE + eventoGravado_(s); });
  await gravar_('sessoes', lista);
  const faltaram = await emLote_(lista, async s => {
    s.eventoId = await sincronizarEvento_(s, pacientes[s.pacienteId], BD.config);
  }, feitas => gravar_('sessoes', feitas));
  return faltaram.length;
}

/** Apaga os eventos e as linhas das sessões; as que a Agenda não deixou apagar ficam para depois. Devolve quantas faltaram. */
async function apagarSessoes_(lista) {
  const faltaram = await emLote_(lista, apagarEvento_, feitas => apagarLinhas_('sessoes', feitas));
  return faltaram.length;
}

function pendente_(s, hoje) {
  return s.status === 'agendada' && s.data >= hoje && (!s.eventoId || s.eventoId.indexOf(PENDENTE) === 0);
}

function avisoPendentes_(n) {
  return AVISO_LOTE + ' ' + n + ' agendamento(s) estão salvos no app, mas ainda sem lembrete. '
    + 'Daqui a alguns minutos, toque em Ajustes → "Refazer lembretes que faltaram".';
}

/** Minutos de antecedência dos avisos, ex.: "60, 15". A agenda aceita no máximo 5 (até 4 semanas). */
function lembretes_(cfg) {
  return String(cfg.lembreteMinutos || '')
    .split(/[,;\s]+/)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0 && n <= 40320)
    .slice(0, 5);
}

/**
 * Dias e horários a agendar, a partir da data de início (que só conta se cair num dia escolhido).
 * rep.periodo: semanal (uma vez cada dia escolhido), mensal ou anual (todos os dias escolhidos até o fim do mês
 * ou do ano do início). Sem dias escolhidos, vale o dia da semana do início.
 */
function datasRepeticao_(inicio, rep, horaPadrao) {
  rep = rep || {};
  const d = dataLocal_(inicio, '00:00');
  const dias = (rep.dias || []).map(Number).filter(n => n >= 0 && n <= 6);
  if (!dias.length) dias.push(d.getDay());
  const horaDe = dia => {
    const hora = (rep.horarios && rep.horarios[dia]) || horaPadrao;
    if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error('Horário inválido.');
    return hora;
  };
  const ano = d.getFullYear(), mes = d.getMonth(), dia = d.getDate();
  const fim = { mensal: new Date(ano, mes + 1, 0), anual: new Date(ano, 11, 31) }[rep.periodo] || new Date(ano, mes, dia + 6);
  const lista = [];
  for (; d <= fim; d.setDate(d.getDate() + 1)) {
    if (dias.includes(d.getDay())) lista.push({ data: dataTexto_(d), hora: horaDe(d.getDay()) });
  }
  return lista;
}

// ---------- Utilitários ----------

function texto_(v) {
  return String(v == null ? '' : v).trim().slice(0, 2000);
}

function numero_(v) {
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (!t) return '';
  const n = Number(t);
  if (!isFinite(n) || n < 0) throw new Error('Número inválido: ' + v);
  return String(n);
}

const doisDigitos_ = n => String(n).padStart(2, '0');
const dataTexto_ = d => d.getFullYear() + '-' + doisDigitos_(d.getMonth() + 1) + '-' + doisDigitos_(d.getDate());
const horaTexto_ = d => doisDigitos_(d.getHours()) + ':' + doisDigitos_(d.getMinutes());
const dataHora_ = d => dataTexto_(d) + 'T' + horaTexto_(d) + ':00';
const hoje_ = () => dataTexto_(new Date());
const agora_ = () => { const d = new Date(); return dataTexto_(d) + ' ' + horaTexto_(d); };

function dataLocal_(data, hora) {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  return new Date(a, m - 1, d, h, mi);
}
