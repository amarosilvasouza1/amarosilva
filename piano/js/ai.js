/* Pianeon — assistente de IA (traga sua própria chave: Claude ou qualquer API compatível com OpenAI) */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus } = PN;

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';

  const PROVIDERS = {
    anthropic: { name: 'Claude (Anthropic)', type: 'anthropic', model: 'claude-opus-5-5', needsKey: true, keyHelp: 'Crie uma chave em console.anthropic.com → API Keys' },
    openai: { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', needsKey: true, keyHelp: 'platform.openai.com → API keys' },
    openrouter: { name: 'OpenRouter (vários modelos)', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true, keyHelp: 'openrouter.ai → Keys' },
    groq: { name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', needsKey: true, keyHelp: 'console.groq.com → API Keys' },
    gemini: { name: 'Google Gemini', type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', needsKey: true, keyHelp: 'aistudio.google.com → Get API key' },
    ollama: { name: 'Ollama (no seu PC, grátis)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', needsKey: false, keyHelp: 'Rode o Ollama com OLLAMA_ORIGINS=* para o navegador poder acessar.' },
    lmstudio: { name: 'LM Studio (no seu PC)', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false, keyHelp: 'Ative "Enable CORS" no servidor local do LM Studio.' },
    custom: { name: 'Outra API compatível com OpenAI', type: 'openai', baseUrl: '', model: '', needsKey: false, keyHelp: 'Informe a URL base (terminando em /v1) e o modelo.' },
  };
  const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  // Modelos que aceitam o fallback automático do servidor quando um pedido é recusado.
  const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5']);
  const supportsEffort = (m) => /^claude-(opus|sonnet|fable|haiku)-(5|4-[6-9])/.test(m);
  const supportsWebSearch = (m) => /^claude-(opus-(5|4-[6-9])|sonnet-(5|4-6)|fable)/.test(m);

  const NOTATION_HELP = `Notação Pianeon (texto, tokens separados por espaço):
- Nota = letra + acidente opcional (# ou b) + oitava. C4 é o Dó central. Ex.: C4, F#3, Bb4.
- Acorde = notas unidas por "+": C3+E3+G3.
- Duração em tempos depois de ":" (1 = semínima, 0.5 = colcheia, 2 = mínima, 0.25 = semicolcheia, 1/3 = tercina). A duração vale para as próximas notas até ser trocada.
- Pausa = R:duração. A barra "|" é só para separar compassos (é ignorada).
Exemplo (Ode à Alegria): right_hand "E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2", left_hand "C3:4 | G2:4 | C3:4 | G2:4".
As duas mãos começam juntas no tempo 0; mantenha o mesmo total de tempos nas duas.`;

  const TOOLS = [
    {
      name: 'add_song',
      eager: true,
      description:
        'Adiciona uma música à biblioteca do Pianeon a partir da notação de texto, para o usuário assistir, praticar ou jogar. Use para compor, arranjar ou transcrever melodias. Mão direita normalmente entre C4 e C6; mão esquerda (baixo/acordes simples) entre C2 e C4.\n' +
        NOTATION_HELP,
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título da música' },
          composer: { type: 'string', description: 'Compositor/artista (opcional)' },
          bpm: { type: 'number', description: 'Andamento em batidas por minuto (semínima), ex.: 90' },
          time_signature: { type: 'integer', description: 'Tempos por compasso: 2, 3, 4 ou 6' },
          difficulty: { type: 'integer', description: 'Dificuldade de 1 (muito fácil) a 5' },
          right_hand: { type: 'string', description: 'Notas da mão direita na notação Pianeon' },
          left_hand: { type: 'string', description: 'Notas da mão esquerda na notação Pianeon (opcional)' },
          open_mode: { type: 'string', enum: ['none', 'watch', 'practice', 'challenge'], description: 'Abrir a música logo depois de adicionar (padrão: none)' },
        },
        required: ['title', 'bpm', 'right_hand'],
      },
    },
    {
      name: 'download_midi',
      description:
        'Baixa um arquivo MIDI (.mid) de uma URL direta e o adiciona à biblioteca. Só funciona com links diretos para o arquivo e quando o site permite acesso do navegador (CORS); se falhar, escreva um arranjo com add_song.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL http(s) direta do arquivo .mid' },
          title: { type: 'string', description: 'Título para mostrar na biblioteca (opcional)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'list_songs',
      description: 'Lista as músicas da biblioteca (id, título, compositor, dificuldade, origem, duração).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'start_song',
      description: 'Abre uma música da biblioteca. Modos: watch (assistir, toca sozinha), practice (praticar: espera o usuário acertar cada nota), challenge (desafio com pontos e combo).',
      input_schema: {
        type: 'object',
        properties: {
          song: { type: 'string', description: 'id ou título da música' },
          mode: { type: 'string', enum: ['watch', 'practice', 'challenge'] },
          hands: { type: 'string', enum: ['right', 'left', 'both'], description: 'Qual mão o usuário vai tocar (padrão: both)' },
          speed_percent: { type: 'number', description: 'Velocidade de 25 a 200 (padrão: atual)' },
        },
        required: ['song', 'mode'],
      },
    },
    {
      name: 'get_status',
      description: 'Mostra o estado do app: música/modo atuais, placar, último resultado, mapa do teclado e as últimas notas que o usuário tocou (com tempos), para você dar dicas sobre a execução.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'set_options',
      description: 'Muda configurações do app.',
      input_schema: {
        type: 'object',
        properties: {
          instrument: { type: 'string', enum: ['grand', 'epiano', 'synth', 'pad', 'organ', 'musicbox', 'softpiano'] },
          speed_percent: { type: 'number', description: '25 a 200' },
          volume_percent: { type: 'number', description: '0 a 100' },
          reverb_percent: { type: 'number', description: '0 a 100' },
          metronome: { type: 'boolean' },
          theme: { type: 'string', enum: ['claro', 'escuro'] },
          keyboard_preset: { type: 'string', enum: ['tracker', 'vp', 'garage'], description: 'tracker = profissional (2 fileiras), vp = Virtual Piano/Roblox, garage = uma fileira' },
        },
      },
    },
  ];

  function systemPrompt(name) {
    return `Você é "${name}", o professor e parceiro musical dentro do Pianeon, um app onde a pessoa toca piano usando o teclado do computador (ou um teclado MIDI).

Converse no idioma da pessoa (normalmente português do Brasil), com calor humano e de forma BREVE: 1 a 4 frases. Ela provavelmente está com as mãos no teclado e pode estar ouvindo sua resposta em voz alta, então evite listas longas, tabelas e markdown pesado.

Com as ferramentas você pode:
- adicionar músicas à biblioteca escrevendo as notas (add_song) — composições, arranjos e exercícios;
- baixar um arquivo MIDI de um link direto (download_midi);
- listar e abrir músicas nos modos assistir, praticar ou desafio (list_songs, start_song);
- ver o desempenho e as notas que a pessoa acabou de tocar (get_status) para dar dicas concretas;
- mudar instrumento, velocidade, volume, metrônomo, tema e mapa do teclado (set_options).

${NOTATION_HELP}

Boas práticas:
- Para iniciantes, prefira arranjos simples (melodia na direita, notas longas de baixo na esquerda) e velocidades de 60–80%.
- Antes de chamar add_song, confira a soma dos tempos de cada compasso. Se a ferramenta devolver erros, corrija e tente de novo.
- Quando pedirem uma música: se você tiver um link direto de .mid (por exemplo, achado com a busca na web), tente download_midi; se falhar ou não houver link, escreva um arranjo com add_song. Depois ofereça abrir no modo praticar.
- Quando a pessoa perguntar como foi, use get_status e comente algo específico (notas erradas, ritmo, mão esquerda…), com incentivo.
- Cada mensagem do usuário vem com um bloco <contexto_app> gerado automaticamente com o estado atual do app; use-o, mas não o repita.`;
  }

  /** Validação simples dos argumentos vindos do modelo. */
  function validate(schema, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Os argumentos precisam ser um objeto JSON.';
    for (const r of schema.required || []) if (input[r] === undefined || input[r] === null || input[r] === '') return 'Campo obrigatório ausente: ' + r;
    for (const [k, v] of Object.entries(input)) {
      const p = (schema.properties || {})[k];
      if (!p) continue;
      if (p.type === 'string' && typeof v !== 'string') return 'Campo ' + k + ' deve ser texto.';
      if ((p.type === 'number' || p.type === 'integer') && (typeof v !== 'number' || !isFinite(v))) return 'Campo ' + k + ' deve ser número.';
      if (p.type === 'boolean' && typeof v !== 'boolean') return 'Campo ' + k + ' deve ser verdadeiro/falso.';
      if (p.enum && !p.enum.includes(v)) return 'Campo ' + k + ' deve ser um destes: ' + p.enum.join(', ');
    }
    return null;
  }

  const defaultCfg = () => ({
    provider: 'anthropic',
    name: 'Maestro',
    effort: 'medium',
    webSearch: false,
    speak: false,
    p: {},
  });

  const ai = {
    PROVIDERS,
    CLAUDE_MODELS,
    TOOLS,
    handlers: {},
    cfg: Object.assign(defaultCfg(), store.get('ai', {})),
    msgs: [], // histórico no formato do provedor atual
    histProvider: null,
    busy: false,
    _sdk: null,

    save() {
      store.set('ai', this.cfg);
      bus.emit('ai:config');
    },
    prov() {
      return PROVIDERS[this.cfg.provider] || PROVIDERS.anthropic;
    },
    pcfg(id) {
      id = id || this.cfg.provider;
      const base = PROVIDERS[id] || PROVIDERS.anthropic;
      const c = (this.cfg.p[id] = this.cfg.p[id] || {});
      return {
        key: c.key || '',
        model: c.model || base.model || '',
        baseUrl: (c.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
      };
    },
    setP(id, patch) {
      this.cfg.p[id] = Object.assign(this.cfg.p[id] || {}, patch);
      this.save();
    },
    isReady() {
      const pc = this.pcfg();
      const pr = this.prov();
      if (pr.needsKey && !pc.key) return false;
      if (pr.type === 'openai' && (!pc.baseUrl || !pc.model)) return false;
      return true;
    },
    label() {
      const pc = this.pcfg();
      return (this.prov().name.split(' (')[0] + (pc.model ? ' · ' + pc.model : '')).toUpperCase();
    },
    reset() {
      this.msgs = [];
      this.histProvider = null;
      bus.emit('ai:reset');
    },
    registerTools(h) {
      Object.assign(this.handlers, h);
    },

    async runTool(name, input, cb) {
      const def = TOOLS.find((t) => t.name === name);
      if (!def) return { error: true, content: 'Ferramenta desconhecida: ' + name };
      const err = validate(def.input_schema, input);
      if (err) return { error: true, content: err };
      cb.tool && cb.tool(name, input);
      try {
        const out = await this.handlers[name](input);
        const failed = out && out.ok === false;
        cb.toolDone && cb.toolDone(name, input, out);
        return { error: failed, content: JSON.stringify(out) };
      } catch (e) {
        cb.toolDone && cb.toolDone(name, input, { ok: false, error: String(e.message || e) });
        return { error: true, content: 'Erro: ' + (e.message || e) };
      }
    },

    /** Envia uma mensagem do usuário. cb: {text(delta), tool(name,input), toolDone(name,input,out), done(fullText), error(msg)} */
    async send(text, context, cb) {
      if (this.busy) return;
      if (!this.isReady()) {
        cb.error && cb.error('Configure sua IA primeiro (provedor, chave e modelo) em ⚙ AJUSTES → IA.');
        return;
      }
      if (this.histProvider && this.histProvider !== this.cfg.provider) this.msgs = [];
      this.histProvider = this.cfg.provider;
      this.busy = true;
      bus.emit('ai:busy', true);
      let full = '';
      const wrapped = Object.assign({}, cb, {
        text: (d) => {
          full += d;
          cb.text && cb.text(d);
        },
      });
      try {
        if (this.prov().type === 'anthropic') await this._claude(text, context, wrapped);
        else await this._openai(text, context, wrapped);
        cb.done && cb.done(full);
      } catch (e) {
        console.error(e);
        cb.error && cb.error(this._explain(e));
      } finally {
        this.busy = false;
        bus.emit('ai:busy', false);
      }
    },

    _explain(e) {
      const st = e && (e.status || (e.response && e.response.status));
      const msg = String((e && e.message) || e);
      if (st === 401 || /401|invalid x-api-key|authentication/i.test(msg)) return 'A chave da API foi recusada (401). Confira a chave em ⚙ AJUSTES → IA.';
      if (st === 403) return 'Acesso negado (403). Sua chave pode não ter permissão para esse modelo.';
      if (st === 404) return 'Modelo ou endereço não encontrado (404). Confira o nome do modelo e a URL.';
      if (st === 429) return 'Limite de uso atingido (429). Espere um pouco e tente de novo.';
      if (st === 529 || st === 503) return 'O serviço está sobrecarregado agora. Tente de novo em instantes.';
      if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) return 'Não consegui conectar à IA. Verifique a internet, a URL e, se for local (Ollama/LM Studio), se o CORS está liberado.';
      return 'Erro da IA: ' + msg.slice(0, 300);
    },

    async _loadSdk() {
      if (!this._sdk) this._sdk = await import(SDK_URL);
      return this._sdk;
    },

    async _claude(text, context, cb) {
      const mod = await this._loadSdk();
      const Anthropic = mod.default || mod.Anthropic;
      const pc = this.pcfg();
      const model = pc.model || 'claude-opus-5-5';
      // A chave fica só neste navegador e vai direto para a Anthropic.
      const opts = { apiKey: pc.key, dangerouslyAllowBrowser: true, maxRetries: 2 };
      if (pc.baseUrl) opts.baseURL = pc.baseUrl; // opcional (proxy próprio)
      const client = new Anthropic(opts);
      const tools = TOOLS.map((t) => {
        const o = { name: t.name, description: t.description, input_schema: t.input_schema };
        if (t.eager) o.eager_input_streaming = true;
        return o;
      });
      if (this.cfg.webSearch && supportsWebSearch(model)) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });

      const turnStart = this.msgs.length;
      this.msgs.push({
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'text', text: '<contexto_app>' + JSON.stringify(context) + '</contexto_app>' },
        ],
      });

      for (let iter = 0; iter < 10; iter++) {
        const params = {
          model,
          max_tokens: 16000,
          system: systemPrompt(this.cfg.name || 'Maestro'),
          tools,
          messages: this.msgs,
          cache_control: { type: 'ephemeral' },
        };
        if (supportsEffort(model)) params.output_config = { effort: this.cfg.effort || 'medium' };
        const stream = FALLBACK_MODELS.has(model)
          ? client.beta.messages.stream(Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }))
          : client.messages.stream(params);
        stream.on('text', (d) => cb.text(d));
        const msg = await stream.finalMessage();

        if (msg.stop_reason === 'refusal') {
          this.msgs.length = turnStart; // descarta o turno recusado inteiro
          cb.text('\n(A IA não quis responder a esse pedido. Tente reformular.)');
          return;
        }
        const toolUses = msg.content.filter((b) => b.type === 'tool_use');
        if (msg.stop_reason === 'max_tokens' && toolUses.length) {
          this.msgs.length = turnStart;
          throw new Error('A resposta ficou grande demais e foi cortada. Peça um trecho menor da música.');
        }
        this.msgs.push({ role: 'assistant', content: msg.content });
        if (msg.stop_reason === 'pause_turn') continue;
        if (msg.stop_reason !== 'tool_use' || !toolUses.length) return;

        const results = [];
        for (const tu of toolUses) {
          const r = await this.runTool(tu.name, tu.input, cb);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, is_error: r.error || undefined });
        }
        this.msgs.push({ role: 'user', content: results });
      }
    },

    async _openai(text, context, cb) {
      const pc = this.pcfg();
      const headers = { 'Content-Type': 'application/json' };
      if (pc.key) headers.Authorization = 'Bearer ' + pc.key;
      this.msgs.push({ role: 'user', content: text + '\n\n<contexto_app>' + JSON.stringify(context) + '</contexto_app>' });
      let useTools = true;
      for (let iter = 0; iter < 10; iter++) {
        const body = {
          model: pc.model,
          messages: [{ role: 'system', content: systemPrompt(this.cfg.name || 'Maestro') }, ...this.msgs],
        };
        if (useTools) body.tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
        const res = await fetch(pc.baseUrl + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          if (useTools && res.status === 400 && /tool|function/i.test(errText)) {
            useTools = false;
            cb.text('(Este modelo não aceita ferramentas; vou só conversar.)\n');
            continue;
          }
          const e = new Error(errText.slice(0, 300) || 'HTTP ' + res.status);
          e.status = res.status;
          throw e;
        }
        const data = await res.json();
        const m = data.choices && data.choices[0] && data.choices[0].message;
        if (!m) throw new Error('Resposta vazia do provedor.');
        const calls = m.tool_calls || [];
        this.msgs.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
        if (m.content) cb.text(m.content);
        if (!calls.length) return;
        for (const tc of calls) {
          let args = {};
          try {
            args = JSON.parse((tc.function && tc.function.arguments) || '{}');
          } catch (e) {
            this.msgs.push({ role: 'tool', tool_call_id: tc.id, content: 'Erro: argumentos não são JSON válido.' });
            continue;
          }
          const r = await this.runTool(tc.function.name, args, cb);
          this.msgs.push({ role: 'tool', tool_call_id: tc.id, content: r.content });
        }
      }
    },
  };

  // ------------------------------------------------------------------ voz
  const voice = {
    rec: null,
    listening: false,
    supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    start(onFinal, onState) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return false;
      if (this.listening) {
        this.stop();
        return true;
      }
      const rec = new SR();
      rec.lang = navigator.language || 'pt-BR';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const t = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : '';
        if (t) onFinal(t);
      };
      rec.onend = () => {
        this.listening = false;
        onState && onState(false);
      };
      rec.onerror = () => {
        this.listening = false;
        onState && onState(false);
      };
      this.rec = rec;
      this.listening = true;
      onState && onState(true);
      rec.start();
      return true;
    },
    stop() {
      if (this.rec) this.rec.stop();
      this.listening = false;
    },
    speak(text) {
      if (!window.speechSynthesis || !text) return;
      const clean = text.replace(/[*_`#>]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').slice(0, 600);
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = navigator.language || 'pt-BR';
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(u.lang.toLowerCase().slice(0, 2)));
      if (v) u.voice = v;
      u.rate = 1.05;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    },
  };

  PN.ai = ai;
  PN.voice = voice;
})();
