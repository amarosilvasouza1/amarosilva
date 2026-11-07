# 🎹 Pianeon — piano no teclado do computador

Toque piano com o **teclado do PC**, aprenda músicas **como num jogo**, importe arquivos **MIDI** e converse com a **sua própria IA** enquanto toca.
Visual de "painel de estúdio": pista 3D com notas, piano roll, mostrador de compasso, waveform, scope, spectrum, vector e espectrograma — tudo reagindo ao que você toca.

## Como abrir

**Online (recomendado):** no GitHub, vá em *Settings → Pages → Build and deployment*, escolha **Deploy from a branch**, branch `main` e pasta `/ (root)`. Em 1–2 minutos o app fica em
`https://amarosilvasouza1.github.io/amarosilva/` (a raiz redireciona para `piano/`).

**No seu computador:** dentro da pasta `piano`, rode `python -m http.server 8000` e abra `http://localhost:8000`.
(Dá para abrir o `index.html` com dois cliques também, mas a voz e a IA funcionam melhor por um servidor ou pelo GitHub Pages.)

Não precisa instalar nada: é HTML, CSS e JavaScript puros.

## Teclado (cada pessoa tem um diferente)

Em **⌨ TECLADO** você escolhe:

| Mapa | Como funciona |
|---|---|
| **Profissional** (padrão) | Como no FL Studio/Ableton: `Z X C V B N M` = teclas brancas, `S D G H J` = pretas; `Q W E R T Y U` = oitava de cima, `2 3 5 6 7` = pretas. ~2,5 oitavas seguidas. |
| **Virtual Piano / Roblox** | `1 2 3… Q W E… A S D… Z X C…` = teclas brancas (5 oitavas). **Shift** = sustenido. Funciona com as partituras de letras da internet. |
| **Uma fileira** | `A S D F G H J K L` = brancas, `W E T Y U O P` = pretas. `Z`/`X` trocam a oitava. Ótimo para notebook. |
| **Personalizado** | Clique numa nota do piano e aperte qualquer tecla. Dá para exportar/importar o mapa (`.json`). |

- **Formato**: ABNT2 (com Ç), ANSI (EUA) ou ISO (Europa) — o desenho das teclas e as teclas extras mudam conforme o seu teclado. O app tenta detectar sozinho.
- Teclados completos: opção para o **teclado numérico** tocar notas graves.
- **Teclado MIDI** USB/Bluetooth funciona direto (Chrome/Edge).
- Celular/tablet: toque nas teclas desenhadas ou nos círculos da pista.

**Atalhos:** `← →` oitava · `↑ ↓` velocidade · `Espaço` pedal (sustain) · `Enter` tocar/pausar · `Backspace` recomeçar · `Tab` falar com a IA · `Esc` fechar/pausar.

## Modos de jogo

- **Assistir** — a música toca sozinha e mostra as teclas.
- **Praticar** — a música para e **espera você acertar** cada nota (ótimo para aprender).
- **Desafio** — tempo real com **PERFEITO / ÓTIMO / BOM**, combo, multiplicador até ×4, estrelas e recordes.

Escolha a mão (**ESQ / AMBAS / DIR**) e a velocidade (25%–200%). A outra mão toca automaticamente.
Se a música tiver notas fora do alcance do seu teclado, o app ajusta a oitava (dá para desligar em Ajustes).

## Músicas

- **12 músicas incluídas** (domínio público): Escala de Dó, Maria Tinha um Carneirinho, Brilha Brilha Estrelinha, Ode à Alegria, Jingle Bells, Parabéns pra Você, Minueto em Sol, Cânone em Ré, Na Gruta do Rei da Montanha, Gymnopédie nº 1, Für Elise e Prelúdio em Dó.
- **Arquivos MIDI** (`.mid`): arraste em qualquer lugar da tela ou use **♫ MÚSICAS → + IMPORTAR**. Também dá para colar um link direto de `.mid`.
- **Partituras de letras** (Virtual Piano / Roblox): cole algo como `[tu] y t r e | [qe] w q 0`.
- **Gravar**: aperte **● GRAVAR**, toque, e a gravação vira uma música (dá para baixar em `.mid`).
- **Peça para a IA** criar, arranjar ou baixar músicas.

> Arquivos de áudio (mp3/wav) não viram notas automaticamente — use a versão MIDI da música ou peça para a IA.

## IA própria (Claude, OpenAI, Gemini, Ollama…)

Em **⚙ → IA** escolha o provedor e cole a sua chave:

- **Claude (Anthropic)** — chave em console.anthropic.com. Modelo padrão `claude-opus-5-5` (também dá para usar `claude-sonnet-5-5` ou `claude-haiku-5-5`). Opcional: busca na web para achar MIDIs.
- **OpenAI, OpenRouter, Groq, Google Gemini** ou **qualquer API compatível com OpenAI**.
- **Ollama / LM Studio** — IA grátis rodando no seu PC (no Ollama, inicie com `OLLAMA_ORIGINS=*`).

O assistente (chamado "Maestro", dá para trocar o nome) pode:
adicionar músicas escrevendo as notas · baixar MIDI de um link · abrir músicas nos modos de jogo · ver como você tocou e dar dicas · mudar instrumento, velocidade, metrônomo e tema.
Fale por voz com **Tab** (🎙) e ative "ler respostas em voz alta" para conversar sem tirar as mãos do teclado.

🔒 A chave fica salva **só no seu navegador** (localStorage) e é enviada apenas para o provedor escolhido. Não salve chaves em computadores compartilhados.

### Notação Pianeon (usada pela IA e no importador avançado)

```
E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4+E4+G4:2 R:2
```
Nota = letra + `#`/`b` + oitava (C4 = Dó central) · acorde com `+` · `:duração` em tempos (1 = semínima, 0.5 = colcheia…) · `R` = pausa · `|` só organiza.

## Som

Piano de cauda com samples reais (**Salamander Grand Piano**, CC-BY 3.0, Alexander Holm — carregados do CDN do Tone.js), reverb de sala e posição estéreo por altura da nota. Também tem piano elétrico, synth, cordas, órgão, caixinha de música e um piano sintetizado que funciona sem internet.

## Arquivos

```
piano/
  index.html        interface
  css/style.css     visual (tema claro e escuro)
  js/util.js        utilidades
  js/audio.js       motor de som (samples + sintetizadores)
  js/midi.js        leitor/gravador de MIDI e teclado MIDI
  js/songs.js       biblioteca, notação e partituras de letras
  js/keymap.js      mapas de teclado e layouts (ABNT2/ANSI/ISO)
  js/game.js        modos assistir / praticar / desafio
  js/visuals.js     pista 3D, piano roll e medidores
  js/ai.js          assistente de IA (Claude + compatíveis com OpenAI)
  js/app.js         liga tudo
```
