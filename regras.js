/* CRM Sistemi Dalessi — regras de negócio.
   Funções puras, sem DOM e sem banco: rodam no navegador (window.CRMRegras)
   e no Node (require), onde ficam os testes (crm/testes/). */
(function (raiz) {
  'use strict';

  // ------------------------------------------------------------ listas fixas
  const TIPOS_ATIVIDADE = [
    ['tarefa', 'Tarefa'], ['ligacao', 'Ligação'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'],
    ['reuniao', 'Reunião'], ['visita', 'Visita'], ['proposta', 'Proposta'], ['nota', 'Anotação'],
    ['ocorrencia', 'Ocorrência'], ['sistema', 'Movimentação']
  ];
  // Os que o vendedor escolhe (sistema é gerado pelo CRM).
  const TIPOS_MANUAIS = TIPOS_ATIVIDADE.filter(t => t[0] !== 'sistema');

  const SITUACOES = [['lead', 'Lead'], ['prospect', 'Prospect'], ['cliente', 'Cliente'], ['inativo', 'Inativo']];
  const STATUS_NEGOCIO = [['aberto', 'Em andamento'], ['ganho', 'Ganho'], ['perdido', 'Perdido']];
  const STATUS_PROPOSTA = [['rascunho', 'Rascunho'], ['enviada', 'Enviada'], ['aprovada', 'Aprovada'], ['recusada', 'Recusada']];
  const RECORRENCIAS = [['', 'Não repete'], ['diaria', 'Todo dia'], ['semanal', 'Toda semana'], ['quinzenal', 'A cada 15 dias'], ['mensal', 'Todo mês']];
  const PAPEIS = [['vendedor', 'Vendedor'], ['gestor', 'Gestor'], ['admin', 'Administrador']];
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

  // Mesmos valores iniciais do schema.sql (instalação nova e modo local).
  const ETAPAS_PADRAO = [
    ['Prospecção', 10], ['Contato feito', 20], ['Qualificação', 40], ['Proposta enviada', 60], ['Negociação', 80]
  ];
  const OPCOES_PADRAO = {
    origem: ['Indicação', 'Site', 'Google', 'Instagram', 'WhatsApp', 'Prospecção ativa', 'Feira/Evento', 'Cliente antigo'],
    segmento: [],
    motivo_perda: ['Preço', 'Comprou do concorrente', 'Prazo de entrega', 'Sem orçamento', 'Sem retorno do cliente',
      'Produto não atende', 'Não era o momento']
  };

  const CONFIG_PADRAO = {
    nome_empresa: '',
    dias_sem_contato: 30,       // cliente sem contato há mais que isso = alerta
    dias_parado: 15,            // negócio aberto sem mudar de etapa nem ter contato = parado
    dias_inativo: 90,           // cliente sem compra há mais que isso = inativo
    ciclo_recompra_padrao: 30,  // dias até lembrar de recompra (a empresa pode ter o seu)
    rodizio: true,              // lead sem responsável vai para o próximo vendedor
    auto_tarefa_lead: true,     // lead novo ganha tarefa "primeiro contato" para hoje
    auto_pos_venda: true,       // venda ganha tarefa de pós-venda
    dias_pos_venda: 7,
    auto_recompra: true,        // venda ganha tarefa de recompra no ciclo
    auto_retomar_perda: false,  // negócio perdido ganha tarefa para retomar
    dias_retomar_perda: 90,
    etapa_ao_enviar_proposta: '', // id da etapa para onde o negócio vai ao enviar proposta
    proposta_validade_dias: 15,
    proposta_condicoes: '',
    exigir_contato_cadastro: true // cadastro novo só com telefone e e-mail (base da trava de duplicado)
  };

  function config(dados) { return Object.assign({}, CONFIG_PADRAO, dados || {}); }

  function rotulo(lista, valor) {
    for (const [v, r] of lista) if (v === valor) return r;
    return valor || '';
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  function moeda(v) { return fmtMoeda.format(num(v)); }
  function numero(v) { return fmtNum.format(num(v)); }
  function pct(v) { return v == null ? '—' : Math.round(v) + '%'; }

  // ------------------------------------------------------------ datas
  // Datas "de calendário" trafegam como 'AAAA-MM-DD'; momentos (data_hora)
  // como ISO com fuso. O "dia" de um momento é o dia no fuso do navegador.
  function dois(n) { return (n < 10 ? '0' : '') + n; }

  function hojeISO(agora) {
    const d = agora || new Date();
    return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
  }

  function diaLocal(momento) {
    if (!momento) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(momento)) return momento;
    const d = new Date(momento);
    return isNaN(d) ? null : hojeISO(d);
  }

  function horaLocal(momento) {
    const d = new Date(momento);
    return isNaN(d) ? '' : dois(d.getHours()) + ':' + dois(d.getMinutes());
  }

  // Dia + hora locais -> ISO. Sem hora = 09:00 (tarefa "do dia").
  function momento(dia, hora) {
    const [a, m, d] = dia.split('-').map(Number);
    const [h, mi] = (hora || '09:00').split(':').map(Number);
    return new Date(a, m - 1, d, h || 0, mi || 0).toISOString();
  }

  function somaDias(iso, dias) {
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    const x = new Date(Date.UTC(a, m - 1, d + dias));
    return x.getUTCFullYear() + '-' + dois(x.getUTCMonth() + 1) + '-' + dois(x.getUTCDate());
  }

  function somaMeses(iso, meses) {
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    return alvo.getUTCFullYear() + '-' + dois(alvo.getUTCMonth() + 1) + '-' + dois(Math.min(d, ultimo));
  }

  function diasEntre(de, ate) {
    const a = de.slice(0, 10).split('-').map(Number), b = ate.slice(0, 10).split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  function dataBR(iso) {
    if (!iso) return '';
    const dia = diaLocal(iso) || String(iso).slice(0, 10);
    const p = dia.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  function dataHoraBR(iso) { return iso ? dataBR(iso) + ' ' + horaLocal(iso) : ''; }

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function mesCurto(iso) { const [a, m] = iso.split('-'); return MESES[+m - 1] + '/' + a.slice(2); }

  function inicioSemana(dia) { // segunda-feira
    const [a, m, d] = dia.split('-').map(Number);
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    return somaDias(dia, -((dow + 6) % 7));
  }

  // Período pré-definido -> {de, ate} (inclusive), em dias de calendário.
  function periodo(chave, hoje, de, ate) {
    const mes = hoje.slice(0, 8) + '01';
    switch (chave) {
      case 'hoje': return { de: hoje, ate: hoje };
      case 'semana': return { de: inicioSemana(hoje), ate: somaDias(inicioSemana(hoje), 6) };
      case 'mes': return { de: mes, ate: somaDias(somaMeses(mes, 1), -1) };
      case 'mes_passado': return { de: somaMeses(mes, -1), ate: somaDias(mes, -1) };
      case 'trimestre': return { de: somaMeses(mes, -2), ate: somaDias(somaMeses(mes, 1), -1) };
      case 'ano': return { de: hoje.slice(0, 4) + '-01-01', ate: hoje.slice(0, 4) + '-12-31' };
      case '12meses': return { de: somaMeses(mes, -11), ate: somaDias(somaMeses(mes, 1), -1) };
      case 'personalizado': return { de: de || '0000-01-01', ate: ate || '9999-12-31' };
      default: return { de: '0000-01-01', ate: '9999-12-31' };
    }
  }

  function noPeriodo(dia, p) { return !!dia && dia >= p.de && dia <= p.ate; }

  function proximaRecorrencia(momentoISO, rec) {
    const d = new Date(momentoISO);
    if (rec === 'diaria') d.setDate(d.getDate() + 1);
    else if (rec === 'semanal') d.setDate(d.getDate() + 7);
    else if (rec === 'quinzenal') d.setDate(d.getDate() + 15);
    else if (rec === 'mensal') d.setMonth(d.getMonth() + 1);
    else return null;
    return d.toISOString();
  }

  // ------------------------------------------------------------ texto, telefone, documentos
  function normaliza(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function digitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  // Nome de empresa para comparar duplicados: sem acento, sem pontuação, sem "ltda/me/eireli".
  function chaveNome(s) {
    return normaliza(s).replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\b(ltda|me|epp|eireli|s ?a|sa|cia|comercio|com|de|da|do|e)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Telefone -> link do WhatsApp. Sem DDD não dá para montar: devolve ''.
  function linkWhatsApp(tel, texto) {
    let d = digitos(tel);
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.length < 12 || d.length > 13) return '';
    return 'https://wa.me/' + d + (texto ? '?text=' + encodeURIComponent(texto) : '');
  }

  function linkTelefone(tel) { const d = digitos(tel); return d.length >= 8 ? 'tel:' + d : ''; }

  function formataCNPJ(v) {
    const d = digitos(v);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return v || '';
  }

  function cnpjValido(v) {
    const d = digitos(v);
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const calc = (base) => {
      let pos = base.length - 7, soma = 0;
      for (let i = base.length; i >= 1; i--) { soma += +base[base.length - i] * pos--; if (pos < 2) pos = 9; }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(d.slice(0, 12)) === +d[12] && calc(d.slice(0, 13)) === +d[13];
  }

  function casaBusca(termo, campos) {
    const t = normaliza(termo);
    if (!t) return true;
    const td = digitos(termo);
    return campos.some(c => {
      if (c == null) return false;
      if (normaliza(c).indexOf(t) !== -1) return true;
      return td.length >= 4 && digitos(c).indexOf(td) !== -1;
    });
  }

  function iniciais(nome) {
    const p = String(nome || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  function primeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }

  // {contato} {primeiro_nome} {empresa} {vendedor} {data}
  function aplicaModelo(texto, v) {
    return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
  }

  // Google Agenda por link (sem API): abre a tela de evento já preenchida.
  function linkGoogleAgenda(titulo, inicioISO, minutos, detalhes) {
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ini = new Date(inicioISO);
    const fim = new Date(ini.getTime() + (minutos || 30) * 60000);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(titulo) + '&dates=' + f(ini) + '/' + f(fim) +
      (detalhes ? '&details=' + encodeURIComponent(detalhes) : '');
  }

  // ------------------------------------------------------------ valores
  function totalItem(it) {
    return num(it.quantidade) * num(it.preco) * (1 - Math.min(100, Math.max(0, num(it.desconto))) / 100);
  }
  function totalItens(itens) { return Math.round(itens.reduce((s, it) => s + totalItem(it), 0) * 100) / 100; }

  // ------------------------------------------------------------ índices
  // Monta mapas por id e por empresa uma vez por carga; o resto usa isso.
  function indexa(D) {
    const porId = {}, porEmpresa = {}, porNegocio = {};
    const tabelas = ['usuarios', 'etapas', 'produtos', 'empresas', 'contatos', 'negocios', 'negocio_itens', 'propostas', 'atividades', 'notas'];
    tabelas.forEach(t => {
      const m = porId[t] = new Map();
      (D[t] || []).forEach(r => m.set(t === 'usuarios' ? r.user_id : r.id, r));
    });
    ['contatos', 'negocios', 'atividades', 'notas'].forEach(t => {
      const m = porEmpresa[t] = new Map();
      (D[t] || []).forEach(r => { if (!m.has(r.empresa_id)) m.set(r.empresa_id, []); m.get(r.empresa_id).push(r); });
    });
    ['negocio_itens', 'propostas'].forEach(t => {
      const m = porNegocio[t] = new Map();
      (D[t] || []).forEach(r => { if (!m.has(r.negocio_id)) m.set(r.negocio_id, []); m.get(r.negocio_id).push(r); });
    });
    const ativNeg = new Map();
    (D.atividades || []).forEach(a => { if (a.negocio_id) { if (!ativNeg.has(a.negocio_id)) ativNeg.set(a.negocio_id, []); ativNeg.get(a.negocio_id).push(a); } });
    porNegocio.atividades = ativNeg;

    // Resumo por empresa: último contato, próxima tarefa, última compra, total comprado.
    const resumo = new Map();
    (D.empresas || []).forEach(e => resumo.set(e.id, { ultimoContato: null, proxima: null, pendentes: 0, ultimaCompra: null, totalComprado: 0, compras: 0, abertos: 0, valorAberto: 0, primeiraCompra: null }));
    (D.atividades || []).forEach(a => {
      const r = resumo.get(a.empresa_id); if (!r) return;
      if (a.concluida) {
        if (a.tipo !== 'sistema') {
          const d = a.concluida_em || a.data_hora;
          if (d && (!r.ultimoContato || d > r.ultimoContato)) r.ultimoContato = d;
        }
      } else {
        r.pendentes++;
        if (!r.proxima || a.data_hora < r.proxima.data_hora) r.proxima = a;
      }
    });
    (D.negocios || []).forEach(n => {
      const r = resumo.get(n.empresa_id); if (!r) return;
      if (n.status === 'ganho') {
        r.compras++; r.totalComprado += num(n.valor);
        if (n.fechado_em && (!r.ultimaCompra || n.fechado_em > r.ultimaCompra)) r.ultimaCompra = n.fechado_em;
        if (n.fechado_em && (!r.primeiraCompra || n.fechado_em < r.primeiraCompra)) r.primeiraCompra = n.fechado_em;
      } else if (n.status === 'aberto') { r.abertos++; r.valorAberto += num(n.valor); }
    });
    // Itens por nota; e quem tem nota fiscal de venda passa a ter as compras contadas pelas notas
    // (mais fiel que o negócio ganho: cada pedido faturado é uma compra, com a data da nota).
    const porNota = new Map();
    (D.nota_itens || []).forEach(it => { if (!porNota.has(it.nota_id)) porNota.set(it.nota_id, []); porNota.get(it.nota_id).push(it); });
    porEmpresa.notas.forEach((lista, empresaId) => {
      const r = resumo.get(empresaId); if (!r) return;
      const vendas = lista.filter(n => notaDeVenda(n, porNota.get(n.id)));
      if (!vendas.length) return;
      const datas = vendas.map(n => diaLocal(n.emitida_em)).filter(Boolean).sort();
      Object.assign(r, { fonteCompras: 'notas', compras: vendas.length, totalComprado: vendas.reduce((s2, n) => s2 + num(n.valor_total), 0),
        primeiraCompra: datas[0] || null, ultimaCompra: datas[datas.length - 1] || null, datasCompras: datas });
    });
    return { porId, porEmpresa, porNegocio, porNota, resumo };
  }

  function probabilidade(n, etapa) {
    if (n.status === 'ganho') return 100;
    if (n.status === 'perdido') return 0;
    if (n.probabilidade != null && n.probabilidade !== '') return num(n.probabilidade);
    return etapa ? num(etapa.probabilidade) : 0;
  }

  // Situação exibida: cliente que não compra há dias_inativo vira "inativo" na tela.
  function situacaoEfetiva(e, resumoEmpresa, cfg, hoje) {
    if (e.situacao === 'cliente' && resumoEmpresa && resumoEmpresa.ultimaCompra &&
        diasEntre(resumoEmpresa.ultimaCompra, hoje) > cfg.dias_inativo) return 'inativo';
    return e.situacao;
  }

  function situacaoTarefa(a, hoje) {
    if (a.concluida) return 'feita';
    const d = diaLocal(a.data_hora);
    if (d < hoje) return 'atrasada';
    if (d === hoje) return 'hoje';
    return 'proxima';
  }

  // ------------------------------------------------------------ alertas (tela Início)
  // "resp": filtra pela carteira de um vendedor (null = todos).
  function alertas(D, ix, cfg, hoje, resp) {
    const meu = r => !resp || r.responsavel_id === resp;
    const tarefas = D.atividades.filter(a => !a.concluida && meu(a));
    const atrasadas = tarefas.filter(a => diaLocal(a.data_hora) < hoje);
    const deHoje = tarefas.filter(a => diaLocal(a.data_hora) === hoje);

    const empresas = D.empresas.filter(meu);
    const leadsSemAtendimento = empresas.filter(e => e.situacao === 'lead' && !ix.resumo.get(e.id).ultimoContato);

    const limiteParado = somaDias(hoje, -cfg.dias_parado);
    const negociosParados = D.negocios.filter(n => {
      if (n.status !== 'aberto' || !meu(n)) return false;
      if (diaLocal(n.etapa_desde || n.criado_em) > limiteParado) return false;
      const ats = ix.porNegocio.atividades.get(n.id) || [];
      if (ats.some(a => !a.concluida)) return false;
      const r = ix.resumo.get(n.empresa_id);
      if (r && r.proxima) return false;
      const ult = r && r.ultimoContato;
      return !ult || diaLocal(ult) <= limiteParado;
    });

    const clientesSemContato = empresas.filter(e => {
      if (e.situacao !== 'cliente') return false;
      const r = ix.resumo.get(e.id);
      if (r.proxima) return false;
      const ult = r.ultimoContato || r.ultimaCompra;
      return !ult || diasEntre(diaLocal(ult), hoje) > cfg.dias_sem_contato;
    });

    // Recompra: cliente cujo ciclo venceu (ou vence em 3 dias), sem negócio aberto nem tarefa.
    const recompra = empresas.filter(e => {
      if (e.situacao !== 'cliente') return false;
      const r = ix.resumo.get(e.id);
      if (!r.ultimaCompra || r.abertos || r.proxima) return false;
      const ciclo = num(e.ciclo_recompra_dias) || cfg.ciclo_recompra_padrao;
      return diasEntre(r.ultimaCompra, hoje) >= ciclo - 3;
    });

    const inativos = empresas.filter(e => situacaoEfetiva(e, ix.resumo.get(e.id), cfg, hoje) === 'inativo');

    return { atrasadas, deHoje, leadsSemAtendimento, negociosParados, clientesSemContato, recompra, inativos };
  }

  // ------------------------------------------------------------ notas fiscais
  // CFOP de venda: saída (5, 6, 7) com grupo 1 (venda) ou 4 (venda com substituição tributária).
  // Remessa, bonificação, devolução e "outras saídas" (5.9xx etc.) não contam como venda.
  const cfopDeVenda = cfop => !cfop || /^[567][14]/.test(String(cfop).replace(/\D/g, ''));
  function notaDeVenda(n, itens) {
    if (!n || n.cancelada) return false;
    return !itens || !itens.length || itens.some(it => cfopDeVenda(it.cfop));
  }

  // Segmento sugerido pelo nome (a base do Agendor veio sem segmento). A ordem importa:
  // "Casa de repouso" antes de "residencial", "Indústria de alimentos" antes de "alimentos".
  const SEGMENTOS_PELO_NOME = [
    ['Saúde', /\b(hospital\w*|clinica\w*|saude|odonto\w*|laborator\w*|casa de repouso|geriatr\w*|residencial senior|senior|medic\w*|farmac\w*|veterinar\w*|terapia\w*)\b/],
    ['Escola', /\b(escola\w*|colegio\w*|educaciona\w*|educacao|ensino|bercario|creche\w*|kumon|infantil|faculdade\w*|universidade\w*|pedagog\w*|idiomas)\b/],
    ['Hotelaria', /\b(hote(l|is)|pousada\w*|inn|hostel|resort)\b/],
    ['Indústria', /\b(industria\w*|ind|metalurg\w*|quimic\w*|fabrica\w*|embalage\w*|plastic\w*|usinage\w*|fundica\w*|fundic|textil\w*|manufatur\w*|grafica\w*|siderurg\w*|moveis|colchoes)\b/],
    ['Alimentação', /\b(restaurante\w*|lanchonete\w*|padaria\w*|panificadora|buffet|pizzaria|churrascaria|cozinha\w*|refeicoes|alimentos|alimenticios|food|bar|cafeteria)\b/],
    ['Condomínio', /\b(condominio\w*|edificio\w*|residencial|conjunto habitacional)\b/],
    ['Igreja / associação', /\b(igreja\w*|paroquia\w*|templo|associacao|sindicato|fundacao|ong|clube|instituto)\b/],
    ['Serviços', /\b(facilities|servicos?|terceiriza\w*|limpeza|conservacao|seguranca|consultoria|tecnologia|software|engenharia|logistica|transporte\w*|contabil\w*|advocacia|advogados|imobiliaria)\b/],
    ['Comércio', /\b(comercio|comercial|distribuidora\w*|loja\w*|atacad\w*|varej\w*|supermercado\w*|mercado\w*|magazine|pecas|pneus|autopecas|materiais|eletric\w*|hidraulic\w*|ferrage\w*|madeireira|papelaria)\b/]
  ];
  const NOMES_SEGMENTO = SEGMENTOS_PELO_NOME.map(x => x[0]);
  function sugereSegmento() {
    const texto = [].slice.call(arguments).filter(Boolean).map(normaliza).join(' ').replace(/[^a-z0-9 ]/g, ' ');
    if (!texto.trim()) return null;
    const achou = SEGMENTOS_PELO_NOME.find(x => x[1].test(texto));
    return achou ? achou[0] : null;
  }

  // Relatório de faturamento pelas notas: total, clientes, top clientes, segmentos, produtos, por mês e vendedor.
  function faturamento(D, ix, hoje, filtro) {
    const p = filtro.periodo;
    const resp = filtro.responsavel_id || null;
    const empresa = id => (id && ix.porId.empresas.get(id)) || null;
    const itensDe = n => ix.porNota.get(n.id) || [];
    const dono = n => { const e = empresa(n.empresa_id); return e ? e.responsavel_id || null : null; };
    const chaveCliente = n => n.empresa_id || (n.cliente_doc ? 'doc:' + digitos(n.cliente_doc) : 'nome:' + normaliza(n.cliente_nome));
    const nomeCliente = n => { const e = empresa(n.empresa_id); return e ? e.nome : n.cliente_nome || '(sem nome)'; };
    const todas = (D.notas || []).filter(n => notaDeVenda(n, itensDe(n)) && (!resp || dono(n) === resp));
    const doPeriodo = todas.filter(n => noPeriodo(diaLocal(n.emitida_em), p));
    const soma = l => l.reduce((s2, n) => s2 + num(n.valor_total), 0);
    const total = soma(doPeriodo);

    const primeira = new Map();
    todas.forEach(n => { const k = chaveCliente(n), d = diaLocal(n.emitida_em); if (!primeira.has(k) || d < primeira.get(k)) primeira.set(k, d); });

    const clientes = new Map();
    doPeriodo.forEach(n => {
      const k = chaveCliente(n);
      const c = clientes.get(k) || { chave: k, nome: nomeCliente(n), empresa_id: n.empresa_id || null, notas: 0, valor: 0, ultima: null, novo: false };
      c.notas++; c.valor += num(n.valor_total);
      const d = diaLocal(n.emitida_em); if (!c.ultima || d > c.ultima) c.ultima = d;
      c.novo = noPeriodo(primeira.get(k), p);
      clientes.set(k, c);
    });
    const listaClientes = [...clientes.values()].sort((a, b) => b.valor - a.valor);

    const agrupa = (chave) => {
      const m = new Map();
      doPeriodo.forEach(n => {
        const k = chave(n) || '(não informado)';
        const g = m.get(k) || { nome: k, notas: 0, valor: 0, clientes: new Set() };
        g.notas++; g.valor += num(n.valor_total); g.clientes.add(chaveCliente(n));
        m.set(k, g);
      });
      return [...m.values()].map(g => Object.assign(g, { clientes: g.clientes.size })).sort((a, b) => b.valor - a.valor);
    };
    const porSegmento = agrupa(n => (empresa(n.empresa_id) || {}).segmento || '(sem segmento)');
    const porVendedor = agrupa(n => { const u = dono(n); const us = u && ix.porId.usuarios.get(u); return us ? us.nome : '(sem responsável)'; });
    const porCidade = agrupa(n => n.cidade ? n.cidade + (n.uf ? '/' + n.uf : '') : null);

    const produtos = new Map();
    doPeriodo.forEach(n => itensDe(n).filter(it => cfopDeVenda(it.cfop)).forEach(it => {
      const k = it.produto_id || (it.codigo ? 'c:' + normaliza(it.codigo) : 'd:' + normaliza(it.descricao));
      const g = produtos.get(k) || { descricao: it.descricao, codigo: it.codigo || '', unidade: it.unidade || '', quantidade: 0, valor: 0, notas: new Set(), clientes: new Set() };
      g.quantidade += num(it.quantidade); g.valor += num(it.valor_total); g.notas.add(n.id); g.clientes.add(chaveCliente(n));
      produtos.set(k, g);
    }));
    const listaProdutos = [...produtos.values()].map(g => Object.assign(g, { notas: g.notas.size, clientes: g.clientes.size }));

    const fimMes = (p.ate < '9999' ? p.ate : hoje).slice(0, 8) + '01';
    const porMes = [];
    for (let i = 11; i >= 0; i--) {
      const m = somaMeses(fimMes, -i).slice(0, 7);
      const l = todas.filter(n => (diaLocal(n.emitida_em) || '').slice(0, 7) === m);
      porMes.push({ mes: m + '-01', qtd: l.length, valor: soma(l) });
    }
    const novos = listaClientes.filter(c => c.novo);
    return {
      existe: (D.notas || []).length > 0,
      total, notas: doPeriodo.length, ticket: doPeriodo.length ? total / doPeriodo.length : 0,
      clientes: listaClientes.length, clientesNovos: novos.length, valorClientesNovos: novos.reduce((s2, c) => s2 + c.valor, 0),
      topClientes: listaClientes, porSegmento, porVendedor, porCidade, porMes,
      topProdutosValor: listaProdutos.slice().sort((a, b) => b.valor - a.valor),
      topProdutosQtd: listaProdutos.slice().sort((a, b) => b.quantidade - a.quantidade),
      canceladas: (D.notas || []).filter(n => n.cancelada && noPeriodo(diaLocal(n.emitida_em), p)).length
    };
  }

  // ------------------------------------------------------------ dashboard / relatórios
  function dashboard(D, ix, cfg, hoje, filtro) {
    const p = filtro.periodo;
    const resp = filtro.responsavel_id || null;
    const meu = r => !resp || r.responsavel_id === resp;
    const etapa = id => ix.porId.etapas.get(id);
    // Funil escolhido (como no Agendor, o painel é por funil; vazio = todos).
    const doFunil = n => !filtro.funil || ((etapa(n.etapa_id) || {}).funil || 'Vendas') === filtro.funil;
    const negs = D.negocios.filter(n => meu(n) && doFunil(n));

    const ganhos = negs.filter(n => n.status === 'ganho' && noPeriodo(n.fechado_em, p));
    const perdidos = negs.filter(n => n.status === 'perdido' && noPeriodo(n.fechado_em, p));
    const abertos = negs.filter(n => n.status === 'aberto');
    const previstos = abertos.filter(n => noPeriodo(n.previsao_fechamento, p));
    const soma = l => l.reduce((s, n) => s + num(n.valor), 0);
    const ponderado = l => l.reduce((s, n) => s + num(n.valor) * probabilidade(n, etapa(n.etapa_id)) / 100, 0);

    const ciclos = ganhos.filter(n => n.criado_em && n.fechado_em).map(n => Math.max(0, diasEntre(diaLocal(n.criado_em), n.fechado_em)));

    const usuarios = D.usuarios.filter(u => u.ativo !== false || negs.some(n => n.responsavel_id === u.user_id));
    const mesDe = p.de.slice(0, 7), mesAte = p.ate.slice(0, 7);
    const porVendedor = usuarios.filter(u => !resp || u.user_id === resp).map(u => {
      const g = ganhos.filter(n => n.responsavel_id === u.user_id);
      const pe = perdidos.filter(n => n.responsavel_id === u.user_id);
      const ab = abertos.filter(n => n.responsavel_id === u.user_id);
      const meta = (D.metas || []).filter(m => m.usuario_id === u.user_id && m.mes.slice(0, 7) >= mesDe && m.mes.slice(0, 7) <= mesAte)
        .reduce((s, m) => s + num(m.valor), 0);
      const ativ = D.atividades.filter(a => a.responsavel_id === u.user_id && a.concluida && a.tipo !== 'sistema' && noPeriodo(diaLocal(a.concluida_em || a.data_hora), p)).length;
      const carteira = D.empresas.filter(e => e.responsavel_id === u.user_id).length;
      return {
        usuario: u, ganhos: g.length, valor: soma(g), perdidos: pe.length, abertos: ab.length, valorAberto: soma(ab),
        meta, atingido: meta ? soma(g) / meta * 100 : null, atividades: ativ, carteira,
        conversao: g.length + pe.length ? g.length / (g.length + pe.length) * 100 : null
      };
    }).filter(v => v.ganhos || v.perdidos || v.abertos || v.meta || v.atividades || v.carteira);

    // Vendas por mês: os 12 meses que terminam no fim do período (ou hoje).
    const fimMes = (p.ate < '9999' ? p.ate : hoje).slice(0, 8) + '01';
    const porMes = [];
    for (let i = 11; i >= 0; i--) {
      const m = somaMeses(fimMes, -i).slice(0, 7);
      const g = negs.filter(n => n.status === 'ganho' && n.fechado_em && n.fechado_em.slice(0, 7) === m);
      porMes.push({ mes: m + '-01', qtd: g.length, valor: soma(g) });
    }

    // Previsão: abertos por mês de previsão, 6 meses à frente.
    const previsao = [];
    for (let i = 0; i < 6; i++) {
      const m = somaMeses(hoje.slice(0, 8) + '01', i).slice(0, 7);
      const l = abertos.filter(n => n.previsao_fechamento && n.previsao_fechamento.slice(0, 7) === m);
      previsao.push({ mes: m + '-01', qtd: l.length, valor: soma(l), ponderado: ponderado(l) });
    }

    const empresasDoPeriodo = D.empresas.filter(e => meu(e) && noPeriodo(diaLocal(e.criado_em), p));
    const agrupa = (lista, chave, valor) => {
      const m = new Map();
      lista.forEach(x => {
        const k = chave(x) || '(não informado)';
        const r = m.get(k) || { nome: k, qtd: 0, valor: 0 };
        r.qtd++; r.valor += valor ? valor(x) : 0;
        m.set(k, r);
      });
      return [...m.values()].sort((a, b) => b.valor - a.valor || b.qtd - a.qtd);
    };

    const porOrigem = agrupa(empresasDoPeriodo, e => e.origem).map(o => {
      const ids = new Set(empresasDoPeriodo.filter(e => (e.origem || '(não informado)') === o.nome).map(e => e.id));
      const g = negs.filter(n => n.status === 'ganho' && ids.has(n.empresa_id));
      return { nome: o.nome, leads: o.qtd, clientes: new Set(g.map(n => n.empresa_id)).size, valor: soma(g) };
    });
    const vendasPorOrigem = agrupa(ganhos, n => n.origem || (ix.porId.empresas.get(n.empresa_id) || {}).origem, n => num(n.valor));
    const motivosPerda = agrupa(perdidos, n => n.motivo_perda, n => num(n.valor));

    const porProduto = new Map();
    ganhos.forEach(n => (ix.porNegocio.negocio_itens.get(n.id) || []).forEach(it => {
      const prod = it.produto_id && ix.porId.produtos.get(it.produto_id);
      const k = prod ? prod.nome : it.descricao;
      const r = porProduto.get(k) || { nome: k, quantidade: 0, valor: 0, negocios: 0 };
      r.quantidade += num(it.quantidade); r.valor += totalItem(it); r.negocios++;
      porProduto.set(k, r);
    }));

    const porEtapa = D.etapas.filter(e => !filtro.funil || (e.funil || 'Vendas') === filtro.funil).sort((a, b) => a.ordem - b.ordem).map(e => {
      const l = abertos.filter(n => n.etapa_id === e.id);
      return { etapa: e, qtd: l.length, valor: soma(l), ponderado: ponderado(l) };
    });

    const ativs = D.atividades.filter(meu);
    const realizadas = ativs.filter(a => a.concluida && a.tipo !== 'sistema' && noPeriodo(diaLocal(a.concluida_em || a.data_hora), p));
    const atividadesPorTipo = agrupa(realizadas, a => rotulo(TIPOS_ATIVIDADE, a.tipo));

    // Clientes novos (1ª compra no período) x recorrentes (já tinham comprado antes).
    const empresasCompraram = new Set(ganhos.map(n => n.empresa_id));
    let novos = 0, recorrentes = 0;
    empresasCompraram.forEach(id => {
      const r = ix.resumo.get(id);
      if (r && r.primeiraCompra && r.primeiraCompra < p.de) recorrentes++; else novos++;
    });

    const decididos = ganhos.length + perdidos.length;
    const iniciados = negs.filter(n => noPeriodo(diaLocal(n.criado_em), p));
    const valorDecidido = soma(ganhos) + soma(perdidos);
    return {
      iniciados: { qtd: iniciados.length, valor: soma(iniciados) },
      conversaoValor: valorDecidido ? soma(ganhos) / valorDecidido * 100 : null,
      realizadas: { qtd: ganhos.length, valor: soma(ganhos) },
      perdidas: { qtd: perdidos.length, valor: soma(perdidos) },
      abertas: { qtd: abertos.length, valor: soma(abertos), ponderado: ponderado(abertos) },
      previstas: { qtd: previstos.length, valor: soma(previstos), ponderado: ponderado(previstos) },
      ticket: ganhos.length ? soma(ganhos) / ganhos.length : 0,
      conversao: decididos ? ganhos.length / decididos * 100 : null,
      ciclo: ciclos.length ? ciclos.reduce((s, c) => s + c, 0) / ciclos.length : null,
      leadsNovos: empresasDoPeriodo.length,
      clientesNovos: novos, clientesRecorrentes: recorrentes,
      atividadesRealizadas: realizadas.length,
      atividadesPendentes: ativs.filter(a => !a.concluida).length,
      atividadesAtrasadas: ativs.filter(a => !a.concluida && diaLocal(a.data_hora) < hoje).length,
      porVendedor, porMes, previsao, porOrigem, vendasPorOrigem, motivosPerda,
      porProduto: [...porProduto.values()].sort((a, b) => b.valor - a.valor),
      porEtapa, atividadesPorTipo
    };
  }

  // ------------------------------------------------------------ duplicados
  // Chaves do "mesmo cadastro" — as mesmas da trava do banco (crm_doc / crm_tel / crm_mail no
  // schema.sql): documento só com dígitos (CPF ou CNPJ), telefone pelos 8 últimos dígitos (com
  // ou sem DDD, com ou sem o 9 do celular), e-mail em minúsculas.
  function chaveDoc(v) { const d = digitos(v); return d.length === 11 || d.length === 14 ? d : ''; }
  function chaveTelefone(v) { const d = digitos(v); return d.length >= 8 ? d.slice(-8) : ''; }
  function chaveEmail(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return /.@./.test(s) ? s : ''; }

  // Empresas que já usam o documento, telefone ou e-mail. deEmpresa = o dado é da própria
  // empresa (trava); falso = de uma pessoa de contato dela (só aviso). Mesmo formato do
  // crm_duplicado_empresa() do banco.
  function achaDuplicados(D, q, ignorarId) {
    const doc = chaveDoc(q.cnpj);
    const tels = new Set((q.telefones || []).map(chaveTelefone).filter(Boolean));
    const mails = new Set((q.emails || []).map(chaveEmail).filter(Boolean));
    const achados = new Map();
    const marca = (empresaId, campo, deEmpresa) => {
      if (!empresaId || empresaId === ignorarId) return;
      const a = achados.get(empresaId) || { empresa_id: empresaId, campos: new Set(), de_empresa: false };
      a.campos.add(campo); a.de_empresa = a.de_empresa || deEmpresa; achados.set(empresaId, a);
    };
    (D.empresas || []).forEach(e => {
      if (doc && chaveDoc(e.cnpj) === doc) marca(e.id, 'CNPJ/CPF', true);
      if ([e.telefone, e.whatsapp].some(t => tels.has(chaveTelefone(t)))) marca(e.id, 'telefone', true);
      if (mails.has(chaveEmail(e.email))) marca(e.id, 'e-mail', true);
    });
    (D.contatos || []).forEach(c => {
      if ([c.telefone, c.celular, c.whatsapp].some(t => tels.has(chaveTelefone(t)))) marca(c.empresa_id, 'telefone de uma pessoa', false);
      if (mails.has(chaveEmail(c.email))) marca(c.empresa_id, 'e-mail de uma pessoa', false);
    });
    const porId = new Map((D.empresas || []).map(e => [e.id, e]));
    const usu = new Map((D.usuarios || []).map(u => [u.user_id, u.nome]));
    return [...achados.values()].filter(a => porId.has(a.empresa_id)).map(a => {
      const e = porId.get(a.empresa_id);
      return { empresa_id: e.id, nome: e.nome, responsavel: usu.get(e.responsavel_id) || 'sem responsável', campo: [...a.campos].join(', '), de_empresa: a.de_empresa };
    }).sort((a, b) => (b.de_empresa - a.de_empresa) || a.nome.localeCompare(b.nome)).slice(0, 5);
  }

  function duplicadosEmpresas(empresas) {
    const grupos = new Map();
    const junta = (k, e) => { if (!k) return; if (!grupos.has(k)) grupos.set(k, new Set()); grupos.get(k).add(e); };
    empresas.forEach(e => {
      const c = chaveDoc(e.cnpj);
      if (c) junta('doc:' + c, e);
      const n = chaveNome(e.nome);
      if (n.length >= 3) junta('nome:' + n, e);
      [e.telefone, e.whatsapp].forEach(t => { const k = chaveTelefone(t); if (k) junta('tel:' + k, e); });
      const m = chaveEmail(e.email); if (m) junta('mail:' + m, e);
    });
    return unirGrupos([...grupos.values()].filter(s => s.size > 1));
  }

  function duplicadosContatos(contatos) {
    const grupos = new Map();
    const junta = (k, c) => { if (!k) return; if (!grupos.has(k)) grupos.set(k, new Set()); grupos.get(k).add(c); };
    contatos.forEach(c => {
      if (c.email) junta('e:' + normaliza(c.email), c);
      [c.telefone, c.celular, c.whatsapp].forEach(t => { const d = digitos(t).slice(-9); if (d.length >= 8) junta('t:' + d, c); });
      junta('n:' + c.empresa_id + ':' + normaliza(c.nome), c);
    });
    return unirGrupos([...grupos.values()].filter(s => s.size > 1));
  }

  // Grupos que compartilham registros viram um só.
  function unirGrupos(conjuntos) {
    const pai = new Map();
    const acha = x => { while (pai.get(x) !== x) x = pai.get(x); return x; };
    conjuntos.forEach(s => {
      const l = [...s];
      l.forEach(x => { if (!pai.has(x)) pai.set(x, x); });
      for (let i = 1; i < l.length; i++) pai.set(acha(l[i]), acha(l[0]));
    });
    const res = new Map();
    pai.forEach((_, x) => { const r = acha(x); if (!res.has(r)) res.set(r, []); res.get(r).push(x); });
    return [...res.values()];
  }

  // Campos vazios do principal preenchidos com os dos duplicados; tags somadas.
  function mesclaCampos(principal, outros, ignorar) {
    const patch = {};
    const pula = new Set(['id', 'criado_em', 'atualizado_em', 'criado_por', 'externo_id'].concat(ignorar || []));
    outros.forEach(o => Object.keys(o).forEach(k => {
      if (pula.has(k)) return;
      const atual = k in patch ? patch[k] : principal[k];
      if (k === 'tags') {
        const t = new Set([].concat(atual || [], o.tags || []));
        if (t.size !== (principal.tags || []).length) patch.tags = [...t];
      } else if ((atual == null || atual === '') && o[k] != null && o[k] !== '') patch[k] = o[k];
    }));
    return patch;
  }

  // ------------------------------------------------------------ busca global
  function buscaGlobal(D, ix, termo, limite) {
    const t = normaliza(termo);
    if (t.length < 2 && digitos(termo).length < 3) return [];
    const res = [];
    const lim = limite || 8;
    const numProp = /^#?\d+$/.test(termo.trim()) ? Number(termo.replace('#', '')) : null;
    for (const e of D.empresas) {
      if (casaBusca(termo, [e.nome, e.razao_social, e.cnpj, e.telefone, e.whatsapp, e.email, e.cidade])) {
        res.push({ tipo: 'empresa', id: e.id, titulo: e.nome, sub: [e.cidade, e.uf].filter(Boolean).join('/') || e.razao_social || '' });
        if (res.filter(r => r.tipo === 'empresa').length >= lim) break;
      }
    }
    let n = 0;
    for (const c of D.contatos) {
      if (casaBusca(termo, [c.nome, c.email, c.telefone, c.celular, c.whatsapp])) {
        const e = ix.porId.empresas.get(c.empresa_id);
        res.push({ tipo: 'contato', id: c.id, empresa_id: c.empresa_id, titulo: c.nome, sub: (e ? e.nome : '') + (c.cargo ? ' · ' + c.cargo : '') });
        if (++n >= lim) break;
      }
    }
    n = 0;
    for (const x of D.negocios) {
      if (casaBusca(termo, [x.titulo])) {
        const e = ix.porId.empresas.get(x.empresa_id);
        res.push({ tipo: 'negocio', id: x.id, titulo: x.titulo, sub: (e ? e.nome : '') + ' · ' + moeda(x.valor) });
        if (++n >= lim) break;
      }
    }
    if (numProp != null) {
      (D.propostas || []).filter(p => Number(p.numero) === numProp).slice(0, 3).forEach(p => {
        const ng = ix.porId.negocios.get(p.negocio_id);
        res.push({ tipo: 'proposta', id: p.id, negocio_id: p.negocio_id, titulo: 'Proposta #' + p.numero, sub: ng ? ng.titulo : '' });
      });
    }
    return res;
  }

  // ------------------------------------------------------------ CSV
  function csvParse(texto) {
    let s = String(texto || '');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const primeira = s.split(/\r?\n/, 1)[0] || '';
    const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';'
      : (primeira.match(/\t/g) || []).length > (primeira.match(/,/g) || []).length ? '\t' : ',';
    const linhas = [];
    let linha = [], campo = '', aspas = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (aspas) {
        if (ch === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
        else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some(c => c !== '')) linhas.push(linha);
        linha = [];
      } else campo += ch;
    }
    linha.push(campo);
    if (linha.some(c => c !== '')) linhas.push(linha);
    return linhas;
  }

  // CSV para o Excel brasileiro: ";" e BOM.
  function csvGera(cabecalho, linhas) {
    const q = v => {
      const t = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
      return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    return '﻿' + [cabecalho].concat(linhas).map(l => l.map(q).join(';')).join('\r\n');
  }

  // "R$ 1.234,56" -> 1234.56 ; "1234.56" -> 1234.56
  function numeroBR(v) {
    if (typeof v === 'number') return v;
    let s = String(v == null ? '' : v).replace(/[R$\s]/g, '');
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else if (/,\d{1,3}$/.test(s) || (s.indexOf(',') !== -1 && s.indexOf('.') !== -1 && s.lastIndexOf(',') > s.lastIndexOf('.'))) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  // "31/12/2025", "31/12/2025 14:30", "2025-12-31", "2025-12-31T14:30:00Z", número de série do Excel.
  function dataPlanilha(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      // Série do Excel é data "de parede": monta no fuso local (meio-dia se não tiver hora).
      const u = new Date(Math.round((v - 25569) * 86400000));
      const temHora = v % 1 !== 0;
      return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), temHora ? u.getUTCHours() : 12, temHora ? u.getUTCMinutes() : 0).toISOString();
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return new Date(ano, +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0).toISOString();
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0).toISOString();
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString();
  }

  const api = {
    TIPOS_ATIVIDADE, TIPOS_MANUAIS, SITUACOES, STATUS_NEGOCIO, STATUS_PROPOSTA, RECORRENCIAS, PAPEIS, UFS,
    ETAPAS_PADRAO, OPCOES_PADRAO, CONFIG_PADRAO, config, rotulo, num, moeda, numero, pct,
    hojeISO, diaLocal, horaLocal, momento, somaDias, somaMeses, diasEntre, dataBR, dataHoraBR, mesCurto,
    inicioSemana, periodo, noPeriodo, proximaRecorrencia,
    normaliza, digitos, chaveNome, linkWhatsApp, linkTelefone, formataCNPJ, cnpjValido, casaBusca, iniciais,
    primeiroNome, aplicaModelo, linkGoogleAgenda, totalItem, totalItens, indexa, probabilidade,
    situacaoEfetiva, situacaoTarefa, alertas, dashboard, duplicadosEmpresas, duplicadosContatos, mesclaCampos,
    buscaGlobal, csvParse, csvGera, numeroBR, dataPlanilha,
    cfopDeVenda, notaDeVenda, sugereSegmento, NOMES_SEGMENTO, faturamento, chaveDoc, chaveTelefone, chaveEmail, achaDuplicados
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.CRMRegras = api;
})(this);
