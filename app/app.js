// Agenda de Atendimentos: telas. As regras e os dados ficam em dados.js.
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const STATUS = { agendada: 'Agendada', realizada: 'Feita', falta: 'Faltou', cancelada: 'Cancelada' };

  let dados = null;
  const tela = { nome: 'agenda', data: null, pacienteId: null, busca: '', arquivados: false };

  // ---------- utilitários ----------
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sim = v => v === 'sim';
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const moeda = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ordem = (a, b) => (a.data + a.hora).localeCompare(b.data + b.hora);
  const cfg = () => dados.config;
  const plural = t => /ão$/.test(t) ? t.replace(/ão$/, 'ões') : /[aeiouáéíóú]$/i.test(t) ? t + 's' : t + 'es';
  const termo = () => cfg().nomeCliente || 'Paciente';
  const termos = () => plural(termo());
  const sessaoT = () => cfg().nomeSessao || 'Sessão';
  const sessao1 = () => sessaoT().toLowerCase();
  const MODELOS = {
    'Fisioterapia / saúde': ['Paciente', 'Sessão'],
    'Consultório': ['Paciente', 'Consulta'],
    'Cuidador / acompanhante': ['Paciente', 'Visita'],
    'Consertos e manutenção': ['Cliente', 'Serviço'],
    'Beleza e estética': ['Cliente', 'Atendimento'],
    'Aulas particulares': ['Aluno', 'Aula'],
  };
  const pagamentos = () => sim(cfg().controlarPagamentos);
  const pacotes = () => sim(cfg().controlarPacotes);
  const paciente = id => dados.pacientes.find(p => p.id === id);
  const sessao = id => dados.sessoes.find(s => s.id === id);

  function parseData(s) { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function somaDias(s, n) { const d = parseData(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtData(s) { const d = parseData(s); return DIAS[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

  const mapa = e => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e);
  const waze = e => 'https://waze.com/ul?q=' + encodeURIComponent(e) + '&navigate=yes';
  function whats(tel) { let d = tel.replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return 'https://wa.me/' + d; }

  function ocupado(ligado, texto) {
    $('#ocupado div').textContent = texto || 'Salvando…';
    $('#ocupado').classList.toggle('on', ligado);
  }
  const estaOcupado = () => $('#ocupado').classList.contains('on');
  aoProgredir = (feitos, total) => { if (total > 3) ocupado(true, 'Salvando… ' + feitos + ' de ' + total + '. Deixe o app aberto.'); };

  /** Mantém a tela ligada nas alterações longas, onde o aparelho permitir. */
  async function telaLigada() {
    try { return await navigator.wakeLock.request('screen'); } catch (e) { return null; }
  }

  async function api(fn, ...args) {
    if (!tokenValido() && !(await renovarLogin())) return false;
    ocupado(true);
    const ligada = await telaLigada();
    try {
      const d = await window[fn](...args);
      dados = d; render();
      if (d.aviso) aviso(d.aviso);
      return true;
    } catch (e) {
      if (e.status === 401) {
        sair();
        aviso('Sua conexão com o Google terminou. Toque de novo para concluir: o que já foi feito está guardado.');
      } else {
        aviso(traduzErro(e.message || String(e)));
        recarregar();
      }
      return false;
    } finally {
      ocupado(false);
      if (ligada) ligada.release().catch(() => {});
    }
  }

  /** Busca os dados de novo sem bloquear a tela (ex.: depois de um erro, parte pode ter sido salva). */
  function recarregar() {
    if (!tokenValido(0)) return;
    carregar().then(d => { dados = d; render(); }).catch(() => {});
  }

  /** O acesso do Google dura 1 hora: pede um toque e renova, sem perder o que estava na tela. */
  async function renovarLogin() {
    const continuar = await dialogo('Sua conexão com o Google terminou. Toque em Continuar para renovar.', [{ t: 'Voltar', v: false }, { t: 'Continuar', v: true, classe: 'pri' }]);
    if (!continuar) return false;
    const antes = SESSAO.email;
    try {
      await entrar();
    } catch (e) {
      aviso(e.message);
      return false;
    }
    if (SESSAO.email !== antes) { location.reload(); return false; } // outra conta: outros dados
    return true;
  }

  // ---------- entrada no app ----------
  function semMenu(html) {
    $('nav').style.display = 'none';
    $('.mais').style.display = 'none';
    $('#atualizar').style.display = 'none';
    $('#titulo').textContent = 'Agenda de Atendimentos';
    $('main').innerHTML = html;
  }

  function telaEntrar(erro, trocarConta) {
    dados = null;
    semMenu(`<div class="card" style="margin-top:24px">
      <h2>Sua agenda de atendimentos</h2>
      <p>Entre com a sua conta Google. Os dados ficam numa planilha no seu Drive e os lembretes, na sua Agenda do Google.</p>
      ${erro ? `<p class="perigo">${esc(erro)}</p>` : ''}
      <div class="acoes"><button class="pri" id="botaoEntrar">Entrar com o Google</button></div>
      <p class="pequeno mut"><a href="../privacidade.html">Política de Privacidade</a></p></div>`);
    $('#botaoEntrar').onclick = () => entrar(trocarConta).then(iniciar, e => telaEntrar(e.message, trocarConta));
  }

  function telaPrimeiroUso() {
    semMenu(`<div class="card" style="margin-top:24px">
      <h2>Vamos começar</h2>
      <p>Você entrou com <strong>${esc(dados.email)}</strong>.</p>
      <div class="acoes" style="flex-direction:column;align-items:stretch">
        <button class="pri" id="comecar">É a minha primeira vez: criar minha planilha</button>
        <button id="usarAntiga">Já uso a Agenda: escolher minha planilha</button>
      </div>
      <p class="pequeno mut">Se você já usava a Agenda, escolha a planilha "Agenda de Atendimentos (dados)" no seu Drive. Tudo continua como estava.</p>
      <p><button class="link" id="trocarConta">Entrar com outra conta</button></p></div>`);
    $('#comecar').onclick = () => api('criarPlanilha');
    $('#usarAntiga').onclick = () => escolherPlanilha().then(id => id && api('adotarPlanilha', id), e => aviso(e.message));
    $('#trocarConta').onclick = () => { sair(); telaEntrar('', true); };
  }

  /** Só a planilha que a pessoa escolher aqui fica visível para o app. */
  function escolherPlanilha() {
    return new Promise((ok, falha) => {
      const abrir = () => window.gapi.load('picker', () => {
        new google.picker.PickerBuilder()
          .addView(new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMode(google.picker.DocsViewMode.LIST))
          .setOAuthToken(SESSAO.token)
          .setAppId(PROJETO_GOOGLE)
          .setCallback(r => {
            if (r.action === google.picker.Action.PICKED) ok(r.docs[0].id);
            else if (r.action === google.picker.Action.CANCEL) ok('');
          })
          .build().setVisible(true);
      });
      if (window.gapi) return abrir();
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = abrir;
      script.onerror = () => falha(new Error('Não foi possível abrir o seu Drive agora. Confira a internet e tente de novo.'));
      document.head.appendChild(script);
    });
  }

  async function iniciar() {
    if (!tokenValido(60000)) return telaEntrar();
    ocupado(true, 'Carregando…');
    try {
      dados = await abrirSessao();
      render();
    } catch (e) {
      if (e.status === 401) sair();
      telaEntrar(e.status === 401 ? '' : traduzErro(e.message || String(e)));
    } finally {
      ocupado(false);
    }
  }

  /** Agendamentos futuros que ficaram sem lembrete na Agenda do Google (mesma regra de dados.js). */
  const pendentes = () => dados.sessoes.filter(s => s.status === 'agendada' && s.data >= dados.hoje
    && (!s.eventoId || s.eventoId.indexOf('pendente:') === 0));

  function lerForm() {
    const f = $('#form'), o = {};
    f.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'checkbox') {
        if (el.name === 'dias') { (o.dias = o.dias || []); if (el.checked) o.dias.push(Number(el.value)); }
        else o[el.name] = el.checked ? 'sim' : 'nao';
      } else o[el.name] = el.value;
    });
    return o;
  }

  /** Janela de aviso/confirmação do próprio app (no lugar do alert/confirm do navegador). */
  function dialogo(texto, botoes) {
    return new Promise(resolver => {
      $('#dialogo > div').innerHTML = `<p style="white-space:pre-wrap;margin:0 0 4px">${esc(texto)}</p>
        <div class="acoes" style="justify-content:flex-end">${botoes.map((b, i) => `<button type="button" data-i="${i}" class="${b.classe || ''}">${esc(b.t)}</button>`).join('')}</div>`;
      $('#dialogo').classList.add('aberto');
      $('#dialogo').onclick = e => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        $('#dialogo').classList.remove('aberto');
        resolver(botoes[b.dataset.i].v);
      };
    });
  }
  const aviso = texto => dialogo(texto, [{ t: 'OK', v: true, classe: 'pri' }]);
  const confirmar = (texto, rotulo, perigo) => dialogo(texto, [{ t: 'Voltar', v: false }, { t: rotulo || 'Confirmar', v: true, classe: perigo ? 'pri perigo-pri' : 'pri' }]);
  function traduzErro(m) {
    m = m.replace(/^(Exception|Error|Erro):\s*/i, '');
    if (/rate limit|quota|too many/i.test(m)) return 'O Google limitou as alterações seguidas. Tente de novo em alguns minutos.';
    return m;
  }

  function abrirModal(html) { $('#modal > div').innerHTML = html; $('#modal').classList.add('aberto'); }
  function fecharModal() { $('#modal').classList.remove('aberto'); }

  // ---------- cálculos ----------
  function resumo(p) {
    const ss = dados.sessoes.filter(s => s.pacienteId === p.id);
    const feitas = ss.filter(s => s.status === 'realizada');
    const aReceber = feitas.filter(s => !sim(s.pago));
    return {
      ss,
      feitas: feitas.length,
      agendadas: ss.filter(s => s.status === 'agendada').length,
      faltas: ss.filter(s => s.status === 'falta').length,
      contratadas: num(p.sessoesContratadas),
      aReceber: aReceber.length,
      valorReceber: aReceber.reduce((t, s) => t + num(s.valor), 0),
    };
  }

  /** Número da sessão na sequência do paciente (feitas + agendadas, em ordem de data). */
  function numeroSessao(s) {
    return dados.sessoes
      .filter(x => x.pacienteId === s.pacienteId && (x.status === 'realizada' || x.status === 'agendada'))
      .sort(ordem).indexOf(s) + 1;
  }

  /** Próximas sessões ainda agendadas da mesma repetição (mesma regra de dados.js). */
  function seguintes(s) {
    return dados.sessoes.filter(x => x.id !== s.id && x.status === 'agendada' && x.data + x.hora > s.data + s.hora
      && (s.serieId ? x.serieId === s.serieId : x.pacienteId === s.pacienteId && x.hora === s.hora));
  }

  // ---------- telas ----------
  function render() {
    if (dados.primeiroUso) return telaPrimeiroUso();
    if (dados.bloqueado) {
      semMenu(`<div class="card" style="margin-top:24px">
        <h2>Acesso ainda não liberado</h2>
        <p>Você entrou com <strong>${esc(dados.email || 'uma conta não identificada')}</strong>.</p>
        <p class="mut">Envie este e-mail para quem te passou o app e peça a liberação. Depois, é só abrir o app de novo.</p>
        <p><button class="link" id="trocarConta">Entrar com outra conta</button></p></div>`);
      $('#trocarConta').onclick = () => { sair(); telaEntrar('', true); };
      return;
    }
    $('nav').style.display = '';
    $('#atualizar').style.display = '';
    $('#titulo').textContent = cfg().nomeProfissional || 'Agenda de Atendimentos';
    $('#navClientes').textContent = termos();
    const aba = tela.nome === 'paciente' ? 'pacientes' : tela.nome;
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('ativo', b.dataset.id === aba));
    $('main').innerHTML = { agenda: telaAgenda, pacientes: telaPacientes, paciente: telaPaciente, ajustes: telaAjustes }[tela.nome]();
    $('.mais').style.display = tela.nome === 'ajustes' ? 'none' : '';
  }

  function telaAgenda() {
    const d = tela.data || dados.hoje;
    const lista = dados.sessoes.filter(s => s.data === d).sort(ordem);
    const rotulo = { [dados.hoje]: 'Hoje', [somaDias(dados.hoje, 1)]: 'Amanhã', [somaDias(dados.hoje, -1)]: 'Ontem' }[d]
      || DIAS_LONGOS[parseData(d).getDay()];
    const ativas = lista.filter(s => s.status !== 'cancelada').length;
    return `
      <div class="navdata">
        <button data-acao="dia" data-id="-1" aria-label="Dia anterior">‹</button>
        <div><strong>${rotulo}</strong><br><input type="date" id="escolheData" value="${d}"></div>
        <button data-acao="dia" data-id="1" aria-label="Próximo dia">›</button>
      </div>
      ${d !== dados.hoje ? '<p><button class="link" data-acao="dia" data-id="0">← Voltar para hoje</button></p>' : ''}
      ${lista.length
        ? `<p class="mut pequeno">${ativas} atendimento(s)</p>` + lista.map(s => cartaoSessao(s, false)).join('')
        : '<p class="vazio">Nenhum atendimento neste dia.</p>'}`;
  }

  /** Sessões do paciente no mês da sessão mostrada: muda sozinho quando a agenda passa para outro mês. */
  function sessoesDoMes(s) {
    const doMes = dados.sessoes.filter(x => x.pacienteId === s.pacienteId && x.data.slice(0, 7) === s.data.slice(0, 7));
    const feitas = doMes.filter(x => x.status === 'realizada').length;
    const agendadas = doMes.filter(x => x.status === 'agendada').length;
    return plural(sessaoT()) + ' de ' + MESES[Number(s.data.slice(5, 7)) - 1] + ': ' + feitas + ' feita(s) · ' + agendadas + ' agendada(s)';
  }

  function cartaoSessao(s, naFicha) {
    const p = paciente(s.pacienteId) || { id: '', nome: '(cadastro removido)' };
    const n = s.status === 'realizada' || s.status === 'agendada' ? numeroSessao(s) : 0;
    const contratadas = num(p.sessoesContratadas);
    const info = [
      n ? sessaoT() + ' ' + n + (pacotes() && contratadas ? ' de ' + contratadas : '') : '',
      pagamentos() && s.valor ? moeda(s.valor) : '',
    ].filter(Boolean).join(' · ');
    const tagPago = pagamentos() && s.status === 'realizada'
      ? (sim(s.pago) ? ' <span class="tag ok">Pago</span>' : ' <span class="tag warn">A receber</span>') : '';
    const titulo = naFicha
      ? `${fmtData(s.data)} · ${esc(s.hora)}`
      : `${esc(s.hora)} · <button class="link" data-acao="abrirPaciente" data-id="${esc(p.id)}">${esc(p.nome)}</button>`;
    return `
      <div class="card sessao ${s.status}">
        <div class="linha"><strong>${titulo}</strong><span class="tag ${s.status}">${STATUS[s.status]}</span></div>
        ${s.local ? `<div class="pequeno">📍 ${esc(s.local)} · <a href="${mapa(s.local)}">Maps</a> · <a href="${waze(s.local)}">Waze</a></div>` : ''}
        ${s.tarefa ? `<div class="pequeno">📝 ${esc(s.tarefa)}</div>` : ''}
        ${s.anotacao ? `<div class="pequeno mut">💬 ${esc(s.anotacao)}</div>` : ''}
        ${info || tagPago ? `<div class="pequeno mut">${info}${tagPago}</div>` : ''}
        ${naFicha ? '' : `<div class="pequeno"><strong>${esc(sessoesDoMes(s))}</strong></div>`}
        <div class="acoes">
          ${s.status === 'agendada' ? `<button class="pri" data-acao="concluir" data-id="${s.id}">✔ Feita</button>
            <button data-acao="faltou" data-id="${s.id}">Faltou</button>` : ''}
          ${pagamentos() && s.status === 'realizada' ? `<button data-acao="alternarPago" data-id="${s.id}">${sim(s.pago) ? 'Desmarcar pago' : 'Marcar como pago'}</button>` : ''}
          <button data-acao="editarSessao" data-id="${s.id}">Editar</button>
          ${!naFicha && p.id ? `<button data-acao="relatorioSessao" data-id="${s.id}">Relatório</button>` : ''}
        </div>
      </div>`;
  }

  function telaPacientes() {
    return `
      <div class="linha"><h2>${esc(termos())}</h2><button class="btn" data-acao="novoPaciente">+ Novo</button></div>
      <input type="search" id="busca" placeholder="Buscar pelo nome" value="${esc(tela.busca)}">
      <div id="listaPacientes" style="margin-top:12px">${listaPacientes()}</div>
      <p><button class="link" data-acao="verArquivados">${tela.arquivados ? '← Ver ativos' : 'Ver arquivados'}</button></p>`;
  }

  function listaPacientes() {
    const q = tela.busca.trim().toLowerCase();
    const lista = dados.pacientes
      .filter(p => sim(p.ativo) !== tela.arquivados && p.nome.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!lista.length) return `<p class="vazio">${q ? 'Ninguém encontrado.' : tela.arquivados ? 'Nenhum arquivado.' : 'Nenhum cadastro ainda. Toque em "+ Novo".'}</p>`;
    return lista.map(p => {
      const r = resumo(p);
      const linhaInfo = [
        r.feitas + (pacotes() && r.contratadas ? ' de ' + r.contratadas : '') + ' feita(s)',
        r.agendadas ? r.agendadas + ' agendada(s)' : '',
        pagamentos() && r.aReceber ? `<span style="color:var(--warn)">${r.aReceber} a receber</span>` : '',
      ].filter(Boolean).join(' · ');
      return `<div class="card" data-acao="abrirPaciente" data-id="${p.id}" style="cursor:pointer">
        <strong>${esc(p.nome)}</strong>
        ${p.endereco ? `<div class="pequeno mut">📍 ${esc(p.endereco)}</div>` : ''}
        <div class="pequeno mut">${linhaInfo}</div></div>`;
    }).join('');
  }

  function telaPaciente() {
    const p = paciente(tela.pacienteId);
    if (!p) { tela.nome = 'pacientes'; return telaPacientes(); }
    const r = resumo(p);
    const restantes = Math.max(r.contratadas - r.feitas, 0);
    const caixas = [
      [r.feitas, 'Feitas'],
      pacotes() && r.contratadas ? [restantes, 'Faltam (de ' + r.contratadas + ')'] : null,
      [r.agendadas, 'Agendadas'],
      [r.faltas, 'Faltas'],
      pagamentos() ? [r.aReceber, 'A receber' + (r.valorReceber ? ' · ' + moeda(r.valorReceber) : '')] : null,
    ].filter(Boolean);
    return `
      <p><button class="link" data-acao="ir" data-id="pacientes">← ${esc(termos())}</button></p>
      <div class="linha"><h2>${esc(p.nome)}</h2>${sim(p.ativo) ? '' : '<span class="tag cancelada">Arquivado</span>'}</div>
      <div class="card">
        ${p.telefone ? `<div>📞 ${esc(p.telefone)} · <a href="tel:${esc(p.telefone.replace(/[^\d+]/g, ''))}">Ligar</a> · <a href="${whats(p.telefone)}">WhatsApp</a></div>` : ''}
        ${p.endereco ? `<div>📍 ${esc(p.endereco)} · <a href="${mapa(p.endereco)}">Maps</a> · <a href="${waze(p.endereco)}">Waze</a></div>` : ''}
        ${p.observacoes ? `<div class="mut" style="white-space:pre-wrap">${esc(p.observacoes)}</div>` : ''}
        ${pagamentos() && p.valorSessao ? `<div class="pequeno mut">Valor por ${esc(sessao1())}: ${moeda(p.valorSessao)}</div>` : ''}
        <div class="acoes">
          ${sim(p.ativo) ? `<button class="pri" data-acao="novaSessao" data-id="${p.id}">+ Agendar ${esc(sessao1())}</button>` : `<button data-acao="reativar" data-id="${p.id}">Reativar</button>`}
          <button data-acao="editarPaciente" data-id="${p.id}">Editar</button>
          ${pagamentos() && r.aReceber ? `<button data-acao="marcarPagas" data-id="${p.id}">Marcar todas como pagas</button>` : ''}
          <button data-acao="resumoMes" data-id="${p.id}">Relatório</button>
        </div>
        <div class="acoes">
          ${sim(p.ativo) ? `<button data-acao="arquivar" data-id="${p.id}">Parou de atender (arquivar)</button>` : ''}
          <button class="perigo" data-acao="excluirPaciente" data-id="${p.id}">Excluir</button>
        </div>
      </div>
      <div class="resumo">${caixas.map(([v, t]) => `<div><strong>${v}</strong><span>${t}</span></div>`).join('')}</div>
      <h2>Histórico</h2>
      ${r.ss.length ? r.ss.slice().sort(ordem).reverse().map(s => cartaoSessao(s, true)).join('') : '<p class="vazio">Nada agendado ainda.</p>'}`;
  }

  function telaAjustes() {
    const c = cfg();
    return `
      <h2>Ajustes</h2>
      <form id="form" class="card">
        <label>Seu nome (aparece no topo)<input name="nomeProfissional" value="${esc(c.nomeProfissional)}" placeholder="Ex.: Ana Souza — Fisioterapia"></label>
        <label>Registro profissional (opcional, sai no relatório)<input name="registroProfissional" value="${esc(c.registroProfissional)}" placeholder="Ex.: CREFITO 123456-F"></label>
        <label>Tipo de trabalho (preenche os nomes abaixo)<select id="modelo">
          <option value="">Escolha um modelo…</option>
          ${Object.keys(MODELOS).map(m => `<option>${esc(m)}</option>`).join('')}
        </select></label>
        <div class="lado">
          <label>Quem você atende<input name="nomeCliente" value="${esc(c.nomeCliente)}" placeholder="Paciente, Cliente…"></label>
          <label>Cada atendimento<input name="nomeSessao" value="${esc(c.nomeSessao)}" placeholder="Sessão, Serviço…"></label>
        </div>
        <label>Avisos antes do atendimento (minutos, separados por vírgula)<input name="lembreteMinutos" value="${esc(c.lembreteMinutos)}" inputmode="numeric" placeholder="60, 15"></label>
        <label>Duração padrão (minutos)<input name="duracaoPadrao" type="number" min="5" value="${esc(c.duracaoPadrao)}"></label>
        <label class="check"><input type="checkbox" name="controlarPacotes" ${sim(c.controlarPacotes) ? 'checked' : ''}> Controlar pacotes (quantidade contratada)</label>
        <label class="check"><input type="checkbox" name="controlarPagamentos" ${sim(c.controlarPagamentos) ? 'checked' : ''}> Controlar pagamentos</label>
        ${sim(c.controlarPagamentos) ? `<label>Valor padrão (R$)<input name="valorPadrao" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(c.valorPadrao)}"></label>` : ''}
        <div class="acoes"><button type="submit" class="pri">Salvar ajustes</button></div>
      </form>
      <p class="pequeno mut">Conectado como ${esc(dados.email)}. Os dados ficam numa planilha no seu Google Drive e os avisos chegam pelo app Google Agenda do celular.
        <a href="${esc(dados.planilhaUrl)}">Abrir planilha</a> · <button class="link" data-acao="sairConta">Sair desta conta</button></p>
      ${pendentes().length ? `<div class="card"><b>${pendentes().length} agendamento(s) sem lembrete</b>
        <p class="pequeno mut">O Google Agenda limitou alterações seguidas. Tente refazer daqui a alguns minutos.</p>
        <div class="acoes"><button class="pri" data-acao="sincronizar">Refazer lembretes que faltaram</button></div></div>` : ''}
      ${dados.admin ? telaAcessos() : ''}`;
  }

  function telaAcessos() {
    return `
      <h2 style="margin-top:24px">Acessos liberados</h2>
      <div class="card">
        <p class="pequeno mut">Só estes e-mails conseguem usar o app (cada um com os próprios dados). Você, como administrador, sempre tem acesso.</p>
        ${dados.liberados.length ? dados.liberados.map(e => `<div class="linha"><span>${esc(e)}</span>
          <button class="link perigo" data-acao="removerEmail" data-id="${esc(e)}">Remover</button></div>`).join('')
          : '<p class="mut">Nenhum e-mail liberado ainda.</p>'}
        <label style="margin:12px 0 0">Liberar novo e-mail<input id="novoEmail" type="email" inputmode="email" autocapitalize="off" placeholder="nome@gmail.com"></label>
        <div class="acoes"><button class="pri" data-acao="liberarEmail">Liberar acesso</button></div>
      </div>`;
  }

  // ---------- formulários ----------
  function formPaciente(p) {
    p = p || {};
    abrirModal(`
      <h2>${p.id ? 'Editar' : 'Novo(a)'} ${esc(termo().toLowerCase())}</h2>
      <form id="form">
        <input type="hidden" name="id" value="${esc(p.id)}">
        <label>Nome *<input name="nome" required value="${esc(p.nome)}"></label>
        <label>Telefone<input name="telefone" type="tel" value="${esc(p.telefone)}" placeholder="(11) 91234-5678"></label>
        <label>Endereço do atendimento<input name="endereco" value="${esc(p.endereco)}" placeholder="Rua, número, bairro, cidade"></label>
        <label>Observações<textarea name="observacoes" placeholder="Ex.: tratamento de joelho, portão azul…">${esc(p.observacoes)}</textarea></label>
        ${pacotes() ? `<label>Quantidade contratada (pacote)<input name="sessoesContratadas" type="number" min="0" inputmode="numeric" value="${esc(p.sessoesContratadas)}"></label>` : ''}
        ${pagamentos() ? `<label>Valor por ${esc(sessao1())} (R$)<input name="valorSessao" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(p.valorSessao)}" placeholder="${esc(cfg().valorPadrao)}"></label>` : ''}
        <div class="acoes"><button type="submit" class="pri">Salvar</button><button type="button" data-acao="fechar">Cancelar</button></div>
      </form>`);
    $('#form').onsubmit = e => {
      e.preventDefault();
      const antes = new Set(dados.pacientes.map(x => x.id));
      api('salvarPaciente', lerForm()).then(ok => {
        if (!ok) return;
        fecharModal();
        const criado = dados.pacientes.find(x => !antes.has(x.id)); // abre a ficha do cadastro novo
        if (criado) { tela.nome = 'paciente'; tela.pacienteId = criado.id; render(); }
      });
    };
  }

  function formSessao(s, pacienteId) {
    const novo = !s;
    const ativos = dados.pacientes.filter(p => sim(p.ativo) || (s && p.id === s.pacienteId))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!ativos.length) return formPaciente(); // sem cadastros: começa pelo cadastro
    const p0 = paciente(s ? s.pacienteId : pacienteId);
    const v = Object.assign({
      pacienteId: p0 ? p0.id : '', data: tela.nome === 'agenda' && tela.data ? tela.data : dados.hoje, hora: '08:00',
      duracao: cfg().duracaoPadrao, local: p0 ? p0.endereco : '', tarefa: '',
      valor: p0 ? p0.valorSessao || cfg().valorPadrao : cfg().valorPadrao,
    }, s);
    abrirModal(`
      <h2>${novo ? 'Agendar' : 'Editar'} ${esc(sessao1())}</h2>
      <form id="form">
        <input type="hidden" name="id" value="${esc(v.id)}">
        <label>${esc(termo())} *<select name="pacienteId" id="selPaciente" required>
          <option value="">Escolha…</option>
          ${ativos.map(p => `<option value="${p.id}" ${p.id === v.pacienteId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
        </select></label>
        <div class="lado">
          <label>${novo ? 'Data de início' : 'Data'} *<input name="data" type="date" required value="${esc(v.data)}"></label>
          <label id="rotuloHora">Hora *<input name="hora" id="campoHora" type="time" required value="${esc(v.hora)}"></label>
        </div>
        <label>Duração (minutos)<input name="duracao" type="number" min="5" value="${esc(v.duracao)}"></label>
        <label>Local<input name="local" id="campoLocal" value="${esc(v.local)}"></label>
        <label>O que fazer<textarea name="tarefa" placeholder="Ex.: exercícios de fortalecimento, reavaliação…">${esc(v.tarefa)}</textarea></label>
        ${pagamentos() ? `<label>Valor (R$)<input name="valor" id="campoValor" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(v.valor)}"></label>` : ''}
        ${novo ? `<fieldset><legend>Dias e repetição (opcional)</legend>
          <div class="dias">${DIAS.map((d, i) => `<label><input type="checkbox" name="dias" value="${i}"><span>${d}</span></label>`).join('')}</div>
          ${DIAS.map((d, i) => `<label class="horaDia" data-dia="${i}" style="display:none">Hora de ${DIAS_LONGOS[i].toLowerCase()}<input type="time"></label>`).join('')}
          <label style="margin:0">Repetir<select name="periodo" id="campoPeriodo">
            <option value="semanal">Semanal: uma vez em cada dia marcado</option>
            <option value="mensal">Mensal: os dias marcados até o fim do mês</option>
            <option value="anual">Anual: os dias marcados até o fim do ano</option>
          </select></label>
          <p class="pequeno mut" id="dicaRepeticao" style="margin:6px 0 0"></p>
        </fieldset>` : ''}
        ${!novo && seguintes(s).length ? `<label class="check"><input type="checkbox" name="aplicarSeguintes">
          Aplicar também às próximas ${seguintes(s).length} desta repetição (o horário muda só nas do mesmo dia da semana)</label>` : ''}
        <div class="acoes"><button type="submit" class="pri">Salvar</button><button type="button" data-acao="fechar">Fechar</button></div>
        ${novo ? '' : `<div class="acoes">
          ${s.status !== 'agendada' ? `<button type="button" data-acao="reabrir" data-id="${s.id}">Voltar para agendada</button>` : ''}
          ${s.status !== 'cancelada' ? `<button type="button" data-acao="cancelar" data-id="${s.id}">Cancelar atendimento</button>` : ''}
          <button type="button" class="perigo" data-acao="apagar" data-id="${s.id}">Apagar</button>
        </div>`}
      </form>`);
    $('#selPaciente').onchange = e => {
      const p = paciente(e.target.value);
      if (!p) return;
      $('#campoLocal').value = p.endereco;
      if ($('#campoValor')) $('#campoValor').value = p.valorSessao || cfg().valorPadrao;
    };
    if (novo) {
      const atualizarRepeticao = () => {
        const marcados = document.querySelectorAll('[name=dias]:checked').length;
        $('#rotuloHora').style.display = marcados ? 'none' : '';
        document.querySelectorAll('[name=dias]').forEach(c => {
          const linha = $(`.horaDia[data-dia="${c.value}"]`), campo = linha.querySelector('input');
          if (c.checked && !campo.value) campo.value = $('#campoHora').value; // começa com a hora já escolhida
          linha.style.display = c.checked ? '' : 'none';
        });
        $('#dicaRepeticao').textContent = marcados ? 'A data de início só entra na agenda se cair em um dia marcado.' : 'Sem dias marcados, vale o dia da semana da data de início.';
      };
      $('#form').addEventListener('change', atualizarRepeticao);
      atualizarRepeticao();
    }
    $('#form').onsubmit = e => {
      e.preventDefault();
      const f = lerForm();
      const horarios = {};
      document.querySelectorAll('[name=dias]:checked').forEach(c => { horarios[c.value] = $(`.horaDia[data-dia="${c.value}"] input`).value; });
      const rep = { dias: f.dias || [], horarios, periodo: f.periodo };
      const opcoes = { aplicarSeguintes: f.aplicarSeguintes === 'sim' };
      delete f.dias; delete f.periodo; delete f.aplicarSeguintes;
      const salvar = extra => api('salvarSessao', f, rep, Object.assign(opcoes, extra)).then(ok => {
        if (!ok) return;
        fecharModal();
        if (novo) { // mostra o primeiro dia agendado, que pode ser depois da data de início
          const proximas = dados.sessoes.filter(x => x.pacienteId === f.pacienteId && x.status === 'agendada' && x.data >= f.data).map(x => x.data).sort();
          tela.nome = 'agenda'; tela.data = proximas[0] || f.data; render(); window.scrollTo(0, 0);
        }
      });
      // Agendando de novo para quem já tem agendamentos futuros: substituir ou adicionar?
      const existentes = novo ? dados.sessoes.filter(x => x.pacienteId === f.pacienteId && x.status === 'agendada' && x.data >= f.data).length : 0;
      if (!existentes) return salvar({});
      abrirModal(`<h2>Já existe agendamento</h2>
        <p>${esc(paciente(f.pacienteId).nome)} já tem ${existentes} agendamento(s) a partir de ${fmtData(f.data)}. O que você quer fazer?</p>
        <div class="acoes" style="flex-direction:column;align-items:stretch">
          <button class="pri" id="opSubstituir">Substituir os ${existentes} existentes pelos novos</button>
          <button id="opAdicionar">Adicionar junto com os existentes</button>
          <button id="opCancelar">Cancelar</button>
        </div>`);
      $('#opSubstituir').onclick = () => salvar({ substituirFuturas: true });
      $('#opAdicionar').onclick = () => salvar({});
      $('#opCancelar').onclick = () => fecharModal();
    };
  }

  function formExcluir(id) {
    const p = paciente(id);
    abrirModal(`<h2>Excluir ${esc(p.nome)}</h2>
      <p>Apaga de vez o cadastro e todo o histórico do app. Não dá para desfazer.</p>
      <p class="mut">Se só parou de atender, prefira "Parou de atender (arquivar)".</p>
      <label class="check"><input type="checkbox" id="apagarEventos" checked> Apagar também todos os eventos na Agenda do Google</label>
      <p class="pequeno mut">Se desmarcar, os eventos continuam na agenda, e depois só dá para apagá-los direto no Google Agenda.</p>
      <div class="acoes"><button type="button" class="pri perigo-pri" id="confirmarExcluir">Excluir</button><button type="button" data-acao="fechar">Voltar</button></div>`);
    $('#confirmarExcluir').onclick = () => {
      const manterEventos = !$('#apagarEventos').checked;
      confirmar('Tem certeza? Essa exclusão é definitiva.' + (manterEventos ? ' Os eventos vão continuar na agenda.' : ' Os eventos também serão apagados da agenda.'), 'Excluir de vez', true)
        .then(ok => ok && api('excluirPaciente', id, manterEventos).then(ok => ok && fecharModal()));
    };
  }

  /** Escolhe quantos apagar: só este, até o fim da semana, do mês ou do ano, uma quantidade ou todos os próximos. */
  function formApagar(id) {
    const s = sessao(id);
    const prox = seguintes(s), total = prox.length;
    const fimSemana = somaDias(s.data, 6 - parseData(s.data).getDay());
    const periodos = [
      ['Até o fim da semana', prox.filter(x => x.data <= fimSemana).length],
      ['Até o fim do mês', prox.filter(x => x.data.slice(0, 7) === s.data.slice(0, 7)).length],
      ['Até o fim do ano', prox.filter(x => x.data.slice(0, 4) === s.data.slice(0, 4)).length],
    ].filter(([, n], i, l) => n > 0 && n < total && (!i || n !== l[i - 1][1])); // sem opções que dariam no mesmo
    const opcoes = [['Só este', 0], ...periodos].concat(total ? [['Todos os próximos', total]] : []);
    abrirModal(`<h2>Apagar agendamento</h2>
      <p class="mut">${fmtData(s.data)} às ${esc(s.hora)}. Os apagados saem também da Agenda do Google. Nas próximas datas, os já feitos ou com falta ficam guardados.</p>
      <div class="acoes" style="flex-direction:column;align-items:stretch">
        ${opcoes.map(([t, n]) => `<button type="button" class="perigo" data-mais="${n}">${t} (${n + 1})</button>`).join('')}
      </div>
      ${total ? `<label style="margin-top:12px">Este e mais quantos?<input type="number" id="apagarMais" min="1" max="${total}" value="${Math.min(10, total)}"></label>
        <div class="acoes"><button type="button" class="perigo" data-mais="campo">Apagar essa quantidade</button></div>` : ''}
      <div class="acoes"><button type="button" id="apagarVoltar">Voltar</button></div>`);
    $('#apagarVoltar').onclick = () => formSessao(s);
    document.querySelectorAll('#modal [data-mais]').forEach(b => {
      b.onclick = () => {
        const mais = b.dataset.mais === 'campo' ? Math.min(Math.max(parseInt($('#apagarMais').value, 10) || 0, 0), total) : Number(b.dataset.mais);
        confirmar('Apagar ' + (mais + 1) + ' agendamento(s) de vez?', 'Apagar', true)
          .then(ok => ok && api('apagarSessao', id, mais).then(ok => ok && fecharModal()));
      };
    });
  }

  /** Texto do mês (aaaa-mm) de um paciente: feitas e faltas com as datas, para mandar ao responsável. */
  function textoResumoMes(p, mes, comAnotacoes) {
    const ss = dados.sessoes.filter(s => s.pacienteId === p.id && s.data.slice(0, 7) === mes).sort(ordem);
    const feitas = ss.filter(s => s.status === 'realizada'), faltas = ss.filter(s => s.status === 'falta');
    const dia = s => fmtData(s.data).replace(/\/\d{4}$/, '');
    const nome = MESES[Number(mes.slice(5)) - 1] + '/' + mes.slice(0, 4);
    const linhas = [
      `Relatório de ${nome} — ${p.nome}`,
      cfg().nomeProfissional || cfg().registroProfissional
        ? 'Profissional: ' + [cfg().nomeProfissional, cfg().registroProfissional].filter(Boolean).join(' · ') : '',
      '',
      `${plural(sessaoT())} feitas: ${feitas.length}`,
      ...feitas.map(s => '• ' + dia(s) + (comAnotacoes && s.anotacao ? ' — ' + s.anotacao : '')),
    ];
    if (faltas.length) linhas.push('', 'Faltas (não contadas): ' + faltas.length, ...faltas.map(s => '• ' + dia(s)));
    const contratadas = num(p.sessoesContratadas);
    if (pacotes() && contratadas) linhas.push('', `Pacote: ${resumo(p).feitas} de ${contratadas} feitas no total`);
    if (pagamentos() && feitas.length) {
      const total = feitas.reduce((t, s) => t + num(s.valor), 0);
      const aReceber = feitas.filter(s => !sim(s.pago)).reduce((t, s) => t + num(s.valor), 0);
      linhas.push('', 'Valor do mês: ' + moeda(total) + (aReceber ? ' (a receber: ' + moeda(aReceber) + ')' : ''));
    }
    return linhas.filter((l, i) => l || linhas[i - 1]).join('\n').trim();
  }

  /** Monta um PDF simples com o texto (1ª linha como título). Sem a biblioteca (ex.: sem internet), avisa e devolve null. */
  function montarPdf(texto, arquivo) {
    if (!window.jspdf) { aviso('Não foi possível montar o PDF agora (sem internet?). Use "Compartilhar texto" ou "Copiar texto".'); return null; }
    const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const [titulo, ...resto] = texto.split('\n');
    let y = 20;
    doc.setFont('helvetica', 'bold').setFontSize(15);
    doc.splitTextToSize(titulo, 180).forEach(l => { doc.text(l, 15, y); y += 7; });
    doc.setFont('helvetica', 'normal').setFontSize(11);
    y += 2;
    resto.forEach(linha => doc.splitTextToSize(linha || ' ', 180).forEach(l => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(l, 15, y); y += 6;
    }));
    return new File([doc.output('blob')], arquivo, { type: 'application/pdf' });
  }

  /** Abre o "Compartilhar" do celular com o PDF; onde isso não existir, salva o arquivo. */
  function compartilharPdf(texto, arquivo) {
    const pdf = montarPdf(texto, arquivo);
    if (!pdf) return;
    if (!navigator.canShare || !navigator.canShare({ files: [pdf] })) return baixar(pdf);
    navigator.share({ files: [pdf], title: texto.split('\n')[0] }).catch(e => { if (e.name !== 'AbortError') baixar(pdf); });
  }

  /** Abre o "Compartilhar" do celular com o texto; onde isso não existir, abre o WhatsApp. */
  function compartilharTexto(texto) {
    const whatsapp = () => window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    if (!navigator.share) return whatsapp();
    navigator.share({ text: texto }).catch(e => { if (e.name !== 'AbortError') whatsapp(); });
  }

  function baixar(arquivo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(arquivo);
    a.download = arquivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  function formResumoMes(id, mesInicial) {
    const p = paciente(id);
    abrirModal(`
      <h2>Relatório do mês</h2>
      <form id="form">
        <label>Mês<input type="month" id="mesResumo" value="${mesInicial || dados.hoje.slice(0, 7)}"></label>
        <label class="check"><input type="checkbox" id="comAnotacoes"> Incluir as anotações de cada ${esc(sessao1())}</label>
        <textarea id="textoResumo" rows="12" readonly></textarea>
        <div class="acoes">
          <button type="button" class="pri" id="resumoPdf">📎 Compartilhar PDF</button>
          <button type="button" id="resumoTexto">Compartilhar texto</button>
          <button type="button" id="resumoSalvar">Salvar PDF</button>
          <button type="button" id="resumoCopiar">Copiar texto</button>
          <button type="button" data-acao="fechar">Fechar</button>
        </div>
      </form>`);
    const mes = () => $('#mesResumo').value || dados.hoje.slice(0, 7);
    const atualizar = () => {
      const t = textoResumoMes(p, mes(), $('#comAnotacoes').checked);
      $('#textoResumo').value = t;
    };
    $('#mesResumo').onchange = $('#comAnotacoes').onchange = atualizar;
    const nomeArquivo = () => 'Relatorio ' + p.nome.replace(/[\\/:*?"<>|]/g, '') + ' ' + mes() + '.pdf';
    $('#resumoPdf').onclick = () => compartilharPdf($('#textoResumo').value, nomeArquivo());
    $('#resumoTexto').onclick = () => compartilharTexto($('#textoResumo').value);
    $('#resumoSalvar').onclick = () => { const pdf = montarPdf($('#textoResumo').value, nomeArquivo()); if (pdf) baixar(pdf); };
    $('#resumoCopiar').onclick = () => {
      const t = $('#textoResumo');
      t.select();
      const copiou = () => { $('#resumoCopiar').textContent = 'Copiado ✔'; };
      navigator.clipboard ? navigator.clipboard.writeText(t.value).then(copiou, () => document.execCommand('copy') && copiou())
        : document.execCommand('copy') && copiou();
    };
    atualizar();
  }

  function formConcluir(id) {
    const s = sessao(id);
    abrirModal(`
      <h2>Atendimento feito ✔</h2>
      <form id="form">
        <label>Como foi? (opcional)<textarea name="anotacao" placeholder="Evolução, o que foi feito, próximos passos…">${esc(s.anotacao)}</textarea></label>
        ${pagamentos() ? `<label class="check"><input type="checkbox" name="pago" ${sim(s.pago) ? 'checked' : ''}> Já foi pago</label>` : ''}
        <div class="acoes"><button type="submit" class="pri">Confirmar</button><button type="button" data-acao="fechar">Cancelar</button></div>
      </form>`);
    $('#form').onsubmit = e => {
      e.preventDefault();
      api('alterarSessao', id, Object.assign({ status: 'realizada' }, lerForm())).then(ok => ok && fecharModal());
    };
  }

  // ---------- ações (cliques) ----------
  const ACOES = {
    ir: id => { tela.nome = id; render(); window.scrollTo(0, 0); },
    dia: n => { tela.data = Number(n) ? somaDias(tela.data || dados.hoje, Number(n)) : null; render(); },
    abrirPaciente: id => { if (!id) return; tela.nome = 'paciente'; tela.pacienteId = id; render(); window.scrollTo(0, 0); },
    verArquivados: () => { tela.arquivados = !tela.arquivados; render(); },
    novoPaciente: () => formPaciente(),
    editarPaciente: id => formPaciente(paciente(id)),
    arquivar: id => confirmar('Parou de atender ' + paciente(id).nome + '?\n\nO cadastro sai da lista e os agendamentos futuros são cancelados (saem da Agenda do Google). '
      + 'O histórico fica guardado em "Ver arquivados" e dá para reativar depois.', 'Arquivar')
      .then(ok => ok && api('definirAtivo', id, false)),
    excluirPaciente: id => formExcluir(id),
    reativar: id => api('definirAtivo', id, true),
    resumoMes: id => formResumoMes(id),
    relatorioSessao: id => formResumoMes(sessao(id).pacienteId, sessao(id).data.slice(0, 7)),
    marcarPagas: id => confirmar('Marcar tudo o que já foi feito como pago?', 'Marcar como pago').then(ok => ok && api('marcarPagas', id)),
    novaSessao: id => formSessao(null, id || (tela.nome === 'paciente' ? tela.pacienteId : '')),
    editarSessao: id => formSessao(sessao(id)),
    concluir: id => formConcluir(id),
    faltou: id => confirmar('Marcar que faltou?', 'Faltou').then(ok => ok && api('alterarSessao', id, { status: 'falta' })),
    alternarPago: id => api('alterarSessao', id, { pago: sim(sessao(id).pago) ? 'nao' : 'sim' }),
    reabrir: id => api('alterarSessao', id, { status: 'agendada' }).then(ok => ok && fecharModal()),
    cancelar: id => confirmar('Cancelar este atendimento? Ele sai da Agenda do Google, mas fica no histórico.', 'Cancelar atendimento')
      .then(ok => ok && api('alterarSessao', id, { status: 'cancelada' }).then(ok => ok && fecharModal())),
    apagar: id => formApagar(id),
    fechar: () => fecharModal(),
    liberarEmail: () => api('liberarEmail', $('#novoEmail').value),
    removerEmail: email => confirmar('Remover o acesso de ' + email + '? Os dados dessa pessoa continuam no Google Drive dela.', 'Remover', true)
      .then(ok => ok && api('removerEmail', email)),
    sincronizar: () => api('sincronizarPendentes'),
    atualizar: () => api('carregar'),
    sairConta: () => confirmar('Sair da conta ' + dados.email + ' neste aparelho? Seus dados continuam guardados no seu Google Drive.', 'Sair')
      .then(ok => { if (ok) { sair(); telaEntrar('', true); } }),
  };

  document.addEventListener('click', e => {
    if (e.target.id === 'modal') return fecharModal();
    const el = e.target.closest('[data-acao]');
    if (!el || !dados) return;
    e.preventDefault();
    ACOES[el.dataset.acao](el.dataset.id || '');
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'escolheData' && e.target.value) { tela.data = e.target.value; render(); }
    if (e.target.id === 'modelo' && MODELOS[e.target.value]) {
      [$('#form').nomeCliente.value, $('#form').nomeSessao.value] = MODELOS[e.target.value];
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'busca') { tela.busca = e.target.value; $('#listaPacientes').innerHTML = listaPacientes(); }
  });
  document.addEventListener('submit', e => {
    if (tela.nome !== 'ajustes' || e.target.closest('#modal')) return;
    e.preventDefault();
    api('salvarConfig', lerForm()).then(ok => ok && aviso('Ajustes salvos.'));
  });

  // Ao voltar para o app (ex.: depois de usar outro aplicativo), atualiza os dados.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !dados || dados.bloqueado || dados.primeiroUso) return;
    if ($('#modal').classList.contains('aberto') || $('#dialogo').classList.contains('aberto') || estaOcupado()) return;
    if (tokenValido(0)) recarregar(); else telaEntrar();
  });

  iniciar();
