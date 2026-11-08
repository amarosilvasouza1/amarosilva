/* pianeon — temas personalizados: arraste um arquivo .css para trocar cores, fontes e layout */
(function () {
  'use strict';
  const PN = window.PN;
  const { util, store, bus } = PN;

  const MAX_SIZE = 512 * 1024;
  const EXAMPLES = [
    { id: 'neon', name: 'Neon', file: 'themes/neon.css', desc: 'escuro, roxo e ciano' },
    { id: 'papel', name: 'Papel', file: 'themes/papel.css', desc: 'claro, tons de papel e serifa' },
    { id: 'palco', name: 'Palco', file: 'themes/palco.css', desc: 'só a pista, o piano e o teclado' },
  ];

  const themes = {
    EXAMPLES,
    list: store.get('themes', []) || [],
    active: store.get('themeActive', null),
    // escape: abrir com ?semtema no endereço desliga o tema (se ele deixar a tela ilegível)
    disabledByUrl: /[?&]semtema\b/.test(location.search),
    el: null,

    init() {
      if (this.disabledByUrl) return;
      if (this.active) this._inject(this.get(this.active));
    },
    get(id) {
      return this.list.find((t) => t.id === id) || null;
    },
    looksLikeCss(text) {
      const head = text.slice(0, 2000);
      if (/<(html|script|body|!doctype)/i.test(head)) return false;
      return /[^{}]+\{[^{}]*:[^{}]*\}/.test(text) || /--[\w-]+\s*:/.test(text);
    },
    /** Guarda e aplica um tema. Se já existir um com o mesmo nome, ele é substituído. */
    add(name, css) {
      if (css.length > MAX_SIZE) throw new Error('O arquivo de tema é grande demais (máximo 512 KB).');
      if (!this.looksLikeCss(css)) throw new Error('Esse arquivo não parece ser uma folha de estilo (.css).');
      name = String(name || 'Meu tema').trim().slice(0, 60) || 'Meu tema';
      let t = this.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (t) {
        t.css = css;
        t.updated = Date.now();
      } else {
        t = { id: 't-' + util.uid(), name, css, created: Date.now() };
        this.list.push(t);
      }
      this._save();
      this.apply(t.id);
      return t;
    },
    apply(id) {
      const t = id ? this.get(id) : null;
      this.active = t ? t.id : null;
      store.set('themeActive', this.active);
      if (this.disabledByUrl) {
        bus.emit('usertheme', t);
        return;
      }
      this._inject(t);
    },
    remove(id) {
      this.list = this.list.filter((t) => t.id !== id);
      this._save();
      if (this.active === id) this.apply(null);
      else bus.emit('usertheme', this.get(this.active));
    },
    async loadExample(exId) {
      const ex = EXAMPLES.find((e) => e.id === exId);
      if (!ex) throw new Error('Tema de exemplo não encontrado.');
      let res;
      try {
        res = await fetch(ex.file, { cache: 'no-cache' });
      } catch (e) {
        throw new Error('Não deu para abrir ' + ex.file + ' (abrindo o arquivo direto do computador o navegador bloqueia). Arraste o arquivo ' + ex.file + ' na tela.');
      }
      if (!res.ok) throw new Error('Não encontrei ' + ex.file + '.');
      return this.add(ex.name, await res.text());
    },
    _inject(t) {
      if (!this.el) {
        this.el = document.createElement('style');
        this.el.id = 'userTheme';
        document.head.appendChild(this.el); // depois do style.css: tem prioridade
      }
      // textContent: o conteúdo é tratado só como CSS, nunca como HTML
      this.el.textContent = t ? '/* tema: ' + t.name.replace(/\*\//g, '') + ' */\n' + t.css : '';
      bus.emit('theme');
      bus.emit('usertheme', t);
      // o layout pode ter mudado: deixa os painéis e o teclado se reajustarem
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    },
    _save() {
      if (!store.set('themes', this.list)) bus.emit('toast', 'Sem espaço no navegador para guardar o tema; ele vale só até fechar a página.', 'warn');
    },
  };

  themes.init();
  PN.themes = themes;
})();
