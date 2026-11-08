# pianeon

Piano no teclado do computador. Dá para aprender músicas como num jogo, importar arquivos MIDI e conversar com a sua própria IA enquanto toca.
Visual de "painel de estúdio": lista de músicas, pista 3D com notas e partículas, piano desenhado, teclado do computador desenhado, piano roll, mostrador de compasso e medidores de áudio (waveform, scope, spectrum, vector, espectrograma), tudo reagindo ao que você toca. Tem tema claro e escuro.

## Como abrir

**Online (recomendado):** no GitHub, vá em *Settings → Pages → Build and deployment*, escolha **Deploy from a branch**, branch `main` e pasta `/ (root)`. Em 1–2 minutos o app fica em
`https://amarosilvasouza1.github.io/amarosilva/` (a raiz redireciona para `piano/`).

**No seu computador:** dentro da pasta `piano`, rode `python -m http.server 8000` e abra `http://localhost:8000`.
(Dá para abrir o `index.html` com dois cliques também, mas a voz e a IA funcionam melhor por um servidor ou pelo GitHub Pages.)

Não precisa instalar nada: é HTML, CSS e JavaScript puros.

## Teclado (cada pessoa tem um diferente)

O padrão é o **Teclado inteiro**: **todas as teclas tocam**.

| Fileira | Notas |
|---|---|
| Números (`1 2 3 … - =`) | Dó5 até Si5 (agudo) |
| `Q W E R T …` | Dó4 até Si4 — **`Q` é o Dó central** |
| `A S D F G …` | Dó3 até Si3 |
| `Z X C V B …` | Dó2 até Si2 (grave) |

Cada fileira é uma oitava: começa em Dó na esquerda e vai até Si na direita. Segure **Shift** para tocar uma oitava acima.
No teclado ABNT2 isso dá 48 notas, 4 oitavas completas, sem nenhuma tecla sobrando.

O teclado desenhado na tela mostra a nota de cada tecla. As teclas escuras são os sustenidos (as "teclas pretas") e as teclas de comando também aparecem identificadas.

Em **⌨ TECLADO → TROCAR MAPA** dá para escolher outros estilos:

| Mapa | Como funciona |
|---|---|
| **Teclado inteiro** (padrão) | Uma oitava por fileira, todas as teclas tocam. |
| **Estilo piano** | Como no FL Studio/Ableton: `Z X C V B N M` = brancas, `S D G H J` = pretas; `Q W E R T Y U` = oitava de cima. |
| **Virtual Piano / Roblox** | `1 2 3… Q W E… A S D… Z X C…` = teclas brancas (5 oitavas). **Shift** = sustenido. Funciona com partituras de letras. |
| **Uma fileira** | `A S D F G H J K L` = brancas, `W E T Y U O P` = pretas. `Z`/`X` trocam a oitava. Bom para notebook. |
| **Personalizado** | Clique numa nota e aperte qualquer tecla. Dá para exportar/importar o mapa (`.json`). |

- **Formato**: ABNT2 (com Ç), ANSI (EUA) ou ISO (Europa). O desenho e as teclas extras mudam conforme o seu teclado, e o app tenta detectar sozinho.
- Teclados completos: opção para o **teclado numérico** tocar notas graves.
- **Teclado MIDI** USB/Bluetooth funciona direto (Chrome/Edge).
- Celular/tablet: toque no piano desenhado ou nos círculos da pista.

**Atalhos:** `← →` oitava · `↑ ↓` velocidade · `Espaço` pedal · `Enter` tocar/pausar · `Backspace` recomeçar · `Tab` falar com a IA · tecla ao lado do `1` = metrônomo · `Esc` fechar/pausar.

## Como aprender

1. Escolha uma música na lista **MÚSICAS** (lado esquerdo).
2. No cartão que aparece, escolha o modo, as mãos e a velocidade, e aperte **▶ COMEÇAR** (ou `Enter`).

- **Ouvir**: a música toca sozinha e mostra as teclas.
- **Aprender**: a música para e **espera você acertar** a tecla que pisca.
- **Jogar**: tempo real com **PERFEITO / ÓTIMO / BOM**, combo até ×4, estrelas e recordes.
- **Livre**: toque à vontade; o que você toca sobe pela pista.

A outra mão toca sozinha. Se a música tiver notas fora do alcance do seu teclado, o app ajusta a oitava (dá para desligar em Ajustes).

**Música com nota demais para o teclado?** No cartão de começar:
- **Nível**: *Fácil* deixa só uma nota por vez em cada mão (melodia e baixo), *Médio* até duas, *Completo* tudo. As notas tiradas não somem: o app toca junto, então a música continua cheia. Também ajuda com teclados de computador que não registram muitas teclas apertadas ao mesmo tempo.
- **Escolher faixas** (MIDI com vários instrumentos): diga qual faixa é a sua mão direita, qual é a esquerda, quais o app só acompanha e quais ficam mudas.
- O cartão mostra quantas notas você vai tocar antes de começar.

## Músicas

- **18 músicas de exemplo** (domínio público), separadas em:
  - **Fáceis**: Escala de Dó, Dó Ré Mi Fá, Maria Tinha um Carneirinho, Brilha Brilha Estrelinha, Frei Martinho, Seu Lobato Tinha um Sítio.
  - **Festas**: Parabéns pra Você, Jingle Bells, Noite Feliz, When the Saints Go Marching In.
  - **Clássicas**: Ode à Alegria, Minueto em Sol, Cânone em Ré, Na Gruta do Rei da Montanha, Gymnopédie nº 1, Pequena Serenata Noturna, Für Elise, Prelúdio em Dó.
- **Arquivos MIDI** (`.mid`), **MusicXML** (`.musicxml`, `.mxl`) ou um `.zip` com MIDI dentro: arraste em qualquer lugar da tela ou use **Importar**. Também dá para colar um link direto de `.mid`. O app olha o conteúdo do arquivo, então avisa quando o "MIDI" baixado na verdade é uma página da internet ou um áudio.
- **Partituras de letras** (Virtual Piano / Roblox): cole algo como `[tu] y t r e | [qe] w q 0`.
- **Gravar**: aperte **● GRAVAR**, toque, e a gravação vira uma música (dá para baixar em `.mid`).
- **Peça para a IA** criar, arranjar ou baixar músicas.

> Arquivos de áudio (mp3/wav) não viram notas automaticamente. Use a versão MIDI da música ou peça para a IA.

## Temas: troque o visual arrastando um .css

Arraste um arquivo **.css** em qualquer lugar da tela e o visual muda na hora: cores, fontes e até a posição dos painéis. O tema fica salvo no navegador.

- Em **Ajustes → Tela e jogo → Tema personalizado** dá para trocar entre os temas salvos, voltar ao visual padrão, remover e baixar o **modelo**.
- O modelo (`themes/modelo.css`) explica cada variável (`--bg`, `--panel`, `--ink`, `--teal` = mão direita, `--blue` = mão esquerda, `--accent` = o que você toca, cores do piano e do teclado, `--sans`/`--mono` para as fontes) e traz exemplos de layout: esconder a lista, piano mais alto, lista do lado direito…
- Exemplos prontos na pasta `themes/`: **neon.css** (escuro roxo/ciano), **papel.css** (claro com serifa) e **palco.css** (só pista, piano e teclado).
- Se um tema deixar a tela ilegível, abra o endereço com `?semtema` no final (ex.: `.../piano/?semtema`) e remova o tema em Ajustes.

## Desempenho

Se o computador for mais fraco, o app entra sozinho no **modo leve** (menos resolução nos desenhos e medidores mais calmos). Dá para escolher em **Ajustes → Tela e jogo → Desempenho**: Automático, Alta qualidade, Equilibrado ou Leve. Os painéis só são redesenhados quando algo neles muda.

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

Piano de cauda com samples reais (**Salamander Grand Piano**, CC-BY 3.0, Alexander Holm — carregados do CDN do Tone.js), reverb de sala e posição estéreo por altura da nota. Também tem **violão**, guitarra, harpa, violino, flauta e xilofone com gravações reais (projeto tonejs-instruments, de fontes livres: VSCO 2 Community Edition, Karoryfer e Freesound), além de piano elétrico, órgão, caixinha de música, synth, pad e um piano sintetizado que funciona sem internet. Troque o instrumento no seletor do rodapé; cada um é baixado na primeira vez que você escolhe.

## Ferramentas usadas

Ficam dentro da pasta `vendor/`, então o site funciona sem depender delas na internet:

| Ferramenta | Para quê | Licença |
|---|---|---|
| [Lucide](https://lucide.dev) | ícones | ISC |
| [Archivo](https://fonts.google.com/specimen/Archivo) e [IBM Plex Mono](https://www.ibm.com/plex/) | fontes | SIL OFL 1.1 |
| [@tonejs/midi](https://github.com/Tonejs/Midi) | leitura de arquivos MIDI | MIT |

Pela internet: os samples do piano de cauda (Salamander, CC-BY 3.0) e, só quando o assistente é usado com Claude, o SDK oficial da Anthropic (`@anthropic-ai/sdk`).

## Arquivos

```
piano/
  index.html        interface (inclui os ícones)
  css/fonts.css     fontes embutidas
  css/style.css     visual (tema claro e escuro)
  themes/           modelo de tema e temas de exemplo (.css)
  vendor/           ícones, fontes e @tonejs/midi (com as licenças)
  js/util.js        utilidades
  js/themes.js      temas personalizados (.css arrastado na tela)
  js/audio.js       motor de som (samples + sintetizadores)
  js/midi.js        leitura/gravação de MIDI e teclado MIDI
  js/songs.js       biblioteca, notação e partituras de letras
  js/importers.js   reconhece e importa MIDI, MusicXML, .zip e .txt
  js/keymap.js      mapas de teclado e formatos (ABNT2/ANSI/ISO)
  js/game.js        modos ouvir / aprender / jogar
  js/visuals.js     pista 3D, piano, piano roll e medidores
  js/ai.js          assistente (Claude + APIs compatíveis com OpenAI)
  js/app.js         liga tudo
```
