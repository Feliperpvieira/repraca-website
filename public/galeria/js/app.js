// ==========================================
// 1. CONFIGURAÇÃO SUPABASE
// ==========================================

const supabaseUrl = 'https://ldynpvhqbmrcrlcabnuf.supabase.co';
const supabaseKey = 'sb_publishable_qtshAGmadXj9SbNhrgJOXg_lFROY3Yb';

const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 1b. CATÁLOGO DE ITENS
// ==========================================
// Os dados dos itens ficam em dados/itens.json, ex:
// { "Banco de madeira": { "categoria": "Mobiliário", "icone": "banco-madeira.png" } }

let catalogoItens = {};

// Carrega o catálogo UMA VEZ quando o site inicia.
async function carregarCatalogoItens() {
    try {
        const resposta = await fetch("/galeria/dados/itens.json");
        if (!resposta.ok) throw new Error("Não foi possível carregar dados/itens.json");
        catalogoItens = await resposta.json();
    } catch (erro) {
        console.error("Erro ao carregar catálogo de itens:", erro);
    }
}

function iconeParaItem(nome) {
    return "/galeria/icones/" + (catalogoItens[nome]?.icone || "generico.png");
}

function categoriaDoItem(nome) {
    return catalogoItens[nome]?.categoria || "Sem categoria";
}

// Preenche o <select id="filtroEspecifico"> a partir do catálogo carregado.
function preencherFiltroDeItens() {
    const select = document.getElementById("filtroEspecifico");
    if (!select) return; // página sem grade de galeria (ex.: hub /galeria/)

    // Mantém a opção "todos" e limpa as demais caso seja chamada de novo.
    select.querySelectorAll("option:not([value='todos'])").forEach(opt => opt.remove());

    Object.keys(catalogoItens).sort().forEach(nome => {
        const opt = document.createElement("option");
        opt.value = nome;

        const img = document.createElement("img");
        img.src = iconeParaItem(nome);
        img.alt = "";
        img.className = "opcao-icone";

        opt.appendChild(img);
        opt.appendChild(document.createTextNode(nome));
        select.appendChild(opt);
    });
}

// Preenche o <select id="filtroCategoria"> com as categorias únicas do
// catálogo (mesma fonte de dados do filtro "Contém o item" acima).
function preencherFiltroDeCategorias() {
    const select = document.getElementById("filtroCategoria");
    if (!select) return; // página sem grade de galeria (ex.: hub /galeria/)

    select.querySelectorAll("option:not([value='todas'])").forEach(opt => opt.remove());

    const categorias = [...new Set(Object.values(catalogoItens).map(item => item.categoria))]
        .filter(Boolean)
        .sort();

    categorias.forEach(categoria => {
        const opt = document.createElement("option");
        opt.value = categoria;
        opt.textContent = categoria;
        select.appendChild(opt);
    });
}

// ==========================================
// 1c. DADOS DAS PRAÇAS ORIGINAIS
// ==========================================
// Cada praça-base tem seu próprio JSON em dados/pracas/<slug>.json, ex:
// { "nome": "Estacionamento", "itens": { "Vaga de Carro": 4, "Árvore": 1 } }
// O nome do arquivo é obtido automaticamente a partir do nome da praça.

function slugificar(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

// Cache em memória: várias criações costumam partilhar a mesma praça-base,
// então evitamos rebuscar o mesmo JSON a cada popup aberto.
const cachePracasOriginais = {};

async function carregarDadosDaPraca(nomeBase) {
    const arquivo = slugificar(nomeBase) + ".json";

    if (cachePracasOriginais[arquivo]) {
        return cachePracasOriginais[arquivo];
    }

    try {
        const resposta = await fetch("/galeria/dados/pracas/" + arquivo);

        if (!resposta.ok) {
            console.warn("Não existe JSON para a praça:", nomeBase);
            const vazio = { nome: nomeBase, itens: {} };
            cachePracasOriginais[arquivo] = vazio;
            return vazio;
        }

        const dados = await resposta.json();
        cachePracasOriginais[arquivo] = dados;
        return dados;
    } catch (erro) {
        console.error("Erro ao carregar dados da praça:", erro);
        return { nome: nomeBase, itens: {} };
    }
}

// ==========================================
// 1d. GRÁFICO RADAR
// ==========================================
// Compara a DISTRIBUIÇÃO percentual das categorias (não a contagem bruta),
// então uma praça com 5 itens e uma com 200 ficam em escalas comparáveis
// (0% a 100%). Praça original em terracota, praça imaginada em verde.
// As categorias vêm do itens.json.

// Um Chart.js por canvas — o popup já não usa radar (passou a barras),
// mas a página de uma praça-base tem um segundo radar (#radarComparativoPraca)
// comparando original vs. média de todas as reimaginações, então precisa
// de mais de uma instância viva ao mesmo tempo.
const graficosRadar = {};

// Fonte e padding do radar dependem do breakpoint mobile, mas só eram lidos na
// hora de desenhar: redimensionar a janela (ou girar o celular) mantinha o
// tamanho antigo. Por isso cada radar registra como se redesenha, e o
// redesenho roda quando o breakpoint (mesmo do CSS) é cruzado.
const redesenhosRadar = {};
const mediaMobileRadar = window.matchMedia("(max-width: 768px)");
mediaMobileRadar.addEventListener("change", () => {
    Object.values(redesenhosRadar).forEach(redesenhar => redesenhar());
});

// Cores lidas do CSS uma única vez (o valor não muda em runtime).
const coresGrafico = (() => {
    const estilo = getComputedStyle(document.documentElement);
    return {
        verde: estilo.getPropertyValue("--verde").trim(),
        terracota: estilo.getPropertyValue("--marrom").trim(),
        bege: estilo.getPropertyValue("--bege").trim(),
        azulMarinho: estilo.getPropertyValue("--azul-marinho").trim(),
    };
})();

// "#B76F51" + 0.5 → "rgba(183, 111, 81, 0.5)". Deriva as cores translúcidas
// (preenchimento, grade) das variáveis do :root em vez de repetir rgba() à mão.
function comAlpha(hex, alpha) {
    const limpo = hex.replace("#", "");
    const completo = limpo.length === 3 ? limpo.split("").map(c => c + c).join("") : limpo;
    const n = parseInt(completo, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Traça (sem preencher) um polígono com cantos arredondados de raio "raio".
// Em cada vértice usa arcTo entre os pontos médios das duas arestas. O raio
// é reduzido automaticamente onde a aresta é curta ou o ângulo é muito agudo
// (ex.: uma categoria em 100% e as vizinhas em 0%), senão o arco deformaria a forma.
function tracarPoligonoArredondado(ctx, pontos, raio) {
    const n = pontos.length;
    const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const partida = meio(pontos[n - 1], pontos[0]);
    ctx.moveTo(partida.x, partida.y);

    for (let i = 0; i < n; i++) {
        const anterior = pontos[(i - 1 + n) % n];
        const atual = pontos[i];
        const seguinte = pontos[(i + 1) % n];
        const m1 = meio(anterior, atual);
        const m2 = meio(atual, seguinte);

        const ux = m1.x - atual.x, uy = m1.y - atual.y;
        const vx = m2.x - atual.x, vy = m2.y - atual.y;
        const lu = Math.hypot(ux, uy);
        const lv = Math.hypot(vx, vy);

        let r = 0;
        if (lu > 0.001 && lv > 0.001) {
            const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
            const angulo = Math.acos(cos);
            r = Math.min(raio, Math.min(lu, lv) * Math.tan(angulo / 2));
        }

        if (r > 0.01) ctx.arcTo(atual.x, atual.y, m2.x, m2.y, r);
        else ctx.lineTo(atual.x, atual.y);
    }
    ctx.closePath();
}

function totalDeItens(dados) {
    return Object.values(dados).reduce((total, itens) => {
        return total + Object.values(itens).reduce((soma, qtd) => soma + qtd, 0);
    }, 0);
}

// Converte quantidade por categoria em porcentagem do total.
// Ex: { Infraestrutura: 4, Natureza: 1 } com total 5 → { Infraestrutura: 80, Natureza: 20 }
function percentualPorCategoria(dados) {
    const total = totalDeItens(dados);
    if (total === 0) return {};

    const resultado = {};
    for (const categoria in dados) {
        const quantidade = Object.values(dados[categoria]).reduce((soma, v) => soma + v, 0);
        resultado[categoria] = (quantidade / total) * 100;
    }
    return resultado;
}

// Transforma { "Banco de madeira": 2, "Palmeira": 3 } (formato simples do
// JSON da praça original) em { "Mobiliário": { "Banco de madeira": 2 }, ... }
// usando a categoria cadastrada em itens.json.
function organizarItensOriginais(itens) {
    const resultado = {};
    for (const [nome, quantidade] of Object.entries(itens)) {
        const categoria = categoriaDoItem(nome);
        if (!resultado[categoria]) resultado[categoria] = {};
        resultado[categoria][nome] = quantidade;
    }
    return resultado;
}

// Conta os itens da praça imaginada (layout_data) por categoria.
// itens.json é a fonte oficial da categoria; se um item ainda não estiver
// cadastrado lá, cai para a categoria salva no próprio layout_data.
function contarItensImaginados(itens) {
    const resultado = {};

    itens.forEach(item => {
        const nome = item.nome || "Item sem nome";
        const categoria = catalogoItens[nome]?.categoria || item.categoria || "Sem categoria";

        if (!resultado[categoria]) resultado[categoria] = {};
        resultado[categoria][nome] = (resultado[categoria][nome] || 0) + 1;
    });

    return resultado;
}

// Acha a categoria com mais itens dentro de uma lista de itens posicionados
// (mesmo formato de layoutDaPraca). Usada tanto no "Foco" do popup quanto
// no filtro "Foco principal" da galeria — antes essa conta só existia
// dentro de preencherModal(), agora fica num só lugar pros dois usarem.
function categoriaPredominante(itens) {
    const itensPorCategoria = contarItensImaginados(itens);

    let categoria = "Mista";
    let max = 0;
    for (const cat in itensPorCategoria) {
        const totalNaCategoria = Object.values(itensPorCategoria[cat]).reduce((a, b) => a + b, 0);
        if (totalNaCategoria > max) {
            max = totalNaCategoria;
            categoria = cat;
        }
    }
    return categoria;
}

function desenharRadar(dadosOriginais, dadosImaginados, opcoes = {}) {
    const {
        canvasId = "radarPraca",
        labelOriginal = "Praça original",
        labelComparacao = "Esta rePraça",
    } = opcoes;

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn(`Canvas #${canvasId} não encontrado.`);
        return;
    }
    if (typeof Chart === "undefined") {
        console.error("Chart.js não foi carregado.");
        return;
    }

    if (graficosRadar[canvasId]) {
        graficosRadar[canvasId].destroy();
        delete graficosRadar[canvasId];
    }

    // Eixos fixos: todas as categorias do catálogo (itens.json), não só as
    // presentes nesta praça. Garante >= 3 eixos e deixa os radares comparáveis.
    // O spread no final mantém qualquer categoria inesperada (ex.: "Sem categoria")
    // que apareça nos dados mas não esteja no catálogo.
    const categoriasDoCatalogo = Object.values(catalogoItens)
        .map(item => item.categoria)
        .filter(Boolean);

    const categorias = [...new Set([
        ...categoriasDoCatalogo,
        ...Object.keys(dadosOriginais),
        ...Object.keys(dadosImaginados),
    ])].sort();

    const percentuaisOriginais = percentualPorCategoria(dadosOriginais);
    const percentuaisImaginados = percentualPorCategoria(dadosImaginados);

    const {
        verde: corVerde,
        terracota: corTerracota,
        bege: corBege,
        azulMarinho: corAzulMarinho,
    } = coresGrafico;
    const fonteBase = { family: "Cabin" };

    // O cartão (bege + borda azul-marinho) vem do CSS em .radar-container.
    // Aqui só entra o que é desenhado dentro do canvas.
    //const TAMANHO_FONTE = 16;           // nomes das categorias e valores "0% / 20%"
    // Mesmo breakpoint do CSS. Menor no mobile para o radar ter mais espaço.
    const mobile = mediaMobileRadar.matches;
    const TAMANHO_FONTE = mobile ? 13 : 16;            // nomes das categorias e valores "0% / 20%"
    const PADDING_LATERAL_GRAFICO = mobile ? 12 : 36;  // folga dos lados do canvas

    const TAMANHO_FONTE_LEGENDA = 14;   // texto da legenda (fica menor que o do radar)
    const ALTURA_BARRA_LEGENDA = 36;    // altura da pílula azul-marinho da legenda
    const MARGEM_INFERIOR_LEGENDA = -4;  // distância da pílula até o fundo do cartão
    const PADDING_LATERAL_LEGENDA = 24; // folga da barra além do texto, de cada lado

    // Cinza claro da grade, derivado do azul-marinho (não cria cor nova no :root)
    const corGrade = comAlpha(corAzulMarinho, 0.1);

    // Plugin próprio: hexágono branco por trás da grade (o "100%" do radar) e
    // o pontinho no centro. O anel do 100% é coberto por um traço branco por
    // cima da grade, para o hexágono ficar sem contorno cinza.
    const fundoRadarPlugin = {
        id: "fundoRadar",
        beforeDraw(chart) {
            const escala = chart.scales.r;
            if (!escala) return;

            const { ctx } = chart;
            ctx.save();
            ctx.beginPath();
            categorias.forEach((_, i) => {
                const p = escala.getPointPosition(i, escala.drawingArea);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.restore();
        },
        beforeDatasetsDraw(chart) {
            const escala = chart.scales.r;
            if (!escala) return;

            const { ctx } = chart;
            ctx.save();

            // cobre o anel do 100% (desenhado pela grade) com branco
            ctx.beginPath();
            categorias.forEach((_, i) => {
                const p = escala.getPointPosition(i, escala.drawingArea);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 3;
            ctx.stroke();

            // pontinho no centro
            ctx.beginPath();
            ctx.arc(escala.xCenter, escala.yCenter, 3, 0, Math.PI * 2);
            ctx.fillStyle = corGrade;
            ctx.fill();

            ctx.restore();
        },
    };

    // Raio (px) dos cantos das manchas terracota e verde
    const RAIO_CANTOS_MANCHA = 2;
    const estilosManchas = [
        { borda: corTerracota, fundo: comAlpha(corTerracota, 0.5) },
        { borda: corVerde, fundo: comAlpha(corVerde, 0.5) },
    ];

    // Plugin próprio: desenha as duas manchas com cantos arredondados. O radar
    // nativo do Chart.js só faz vértices retos, então os datasets ficam
    // transparentes (mantêm pontos, hover e tooltip) e o preenchimento e o
    // contorno são desenhados aqui. Ordem invertida = mesma ordem do Chart.js
    // (o primeiro dataset fica por cima).
    const manchasPlugin = {
        id: "manchasArredondadas",
        beforeDatasetsDraw(chart) {
            const { ctx } = chart;

            for (let i = chart.data.datasets.length - 1; i >= 0; i--) {
                if (!chart.isDatasetVisible(i)) continue;

                const pontos = chart.getDatasetMeta(i).data;
                if (pontos.length < 3) continue;

                ctx.save();
                ctx.beginPath();
                tracarPoligonoArredondado(ctx, pontos, RAIO_CANTOS_MANCHA);
                ctx.fillStyle = estilosManchas[i].fundo;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.lineJoin = "round";
                ctx.strokeStyle = estilosManchas[i].borda;
                ctx.stroke();
                ctx.restore();
            }
        },
    };

    // Plugin próprio: desenha "original% / sua praça%" em cores separadas
    // (terracota / azul-marinho / verde) logo abaixo do nome de cada categoria —
    // o Chart.js não suporta cor por trecho dentro de um rótulo, então
    // isto é desenhado manualmente por cima do gráfico já pronto.
    // O rótulo nativo tem 2 linhas (nome + linha em branco, ver pointLabels.callback
    // mais abaixo): a linha em branco reserva o espaço onde estes valores entram.
    const valoresColoridosPlugin = {
        id: "valoresColoridos",
        afterDatasetsDraw(chart) {
            const escala = chart.scales.r;
            if (!escala) return;

            const { ctx } = chart;

            ctx.save();
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.font = `500 ${TAMANHO_FONTE}px Cabin`;

            categorias.forEach((_, index) => {
                const original = Math.round(percentuaisOriginais[categorias[index]] || 0);
                const imaginada = Math.round(percentuaisImaginados[categorias[index]] || 0);

                const textoOriginal = `${original}%`;
                const textoBarra = " / ";
                const textoImaginada = `${imaginada}%`;

                const larguraOriginal = ctx.measureText(textoOriginal).width;
                const larguraBarra = ctx.measureText(textoBarra).width;
                const larguraImaginada = ctx.measureText(textoImaginada).width;
                const larguraTotal = larguraOriginal + larguraBarra + larguraImaginada;

                // Coordenadas do rótulo da categoria desenhado pelo Chart.js (2 linhas)
                const labelItem = escala._pointLabelItems?.[index];

                let posX, posY;
                if (labelItem) {
                    // Centraliza com o nome e usa a 2ª linha do rótulo (a que está em branco)
                    const alturaLinha = (labelItem.bottom - labelItem.top) / 2;
                    posX = (labelItem.left + labelItem.right) / 2;
                    posY = labelItem.bottom - alturaLinha / 2;
                } else {
                    // Fallback caso a propriedade interna não esteja disponível
                    const pos = escala.getPointPosition(index, escala.drawingArea + 36);
                    posX = pos.x;
                    posY = pos.y + 14;
                }

                let cursorX = posX - larguraTotal / 2;

                ctx.fillStyle = corTerracota;
                ctx.fillText(textoOriginal, cursorX, posY);
                cursorX += larguraOriginal;

                ctx.fillStyle = corAzulMarinho;
                ctx.fillText(textoBarra, cursorX, posY);
                cursorX += larguraBarra;

                ctx.fillStyle = corVerde;
                ctx.fillText(textoImaginada, cursorX, posY);
            });

            ctx.restore();
        },
    };

    // Plugin próprio: pílula azul-marinho no fundo do cartão com a legenda
    // (quadradinho colorido + nome). Só é um pouco mais larga que o texto e fica
    // centralizada. Substitui a legenda nativa do Chart.js, que não permite
    // desenhar a pílula nem controlar a altura dela.
    const legendaBarraPlugin = {
        id: "legendaBarra",
        afterDatasetsDraw(chart) {
            const { ctx, width, height } = chart;
            const topo = height - MARGEM_INFERIOR_LEGENDA - ALTURA_BARRA_LEGENDA;
            const raio = ALTURA_BARRA_LEGENDA / 2;

            const itens = [
                { texto: labelOriginal, cor: corTerracota },
                { texto: labelComparacao, cor: corVerde },
            ];
            const lado = 14;
            const espacoIcone = 8;
            const espacoItens = 32;

            ctx.save();

            // se os nomes não couberem na largura, diminui a fonte até caberem
            let fonte = TAMANHO_FONTE_LEGENDA;
            const medirTudo = () => {
                ctx.font = `400 ${fonte}px Cabin`;
                return itens.reduce((soma, item) => soma + lado + espacoIcone + ctx.measureText(item.texto).width, 0)
                    + espacoItens * (itens.length - 1);
            };
            let larguraConteudo = medirTudo();
            while (larguraConteudo + PADDING_LATERAL_LEGENDA * 2 > width - 16 && fonte > 10) {
                fonte--;
                larguraConteudo = medirTudo();
            }

            const larguraBarra = larguraConteudo + PADDING_LATERAL_LEGENDA * 2;
            const esquerda = (width - larguraBarra) / 2;
            const direita = esquerda + larguraBarra;

            // pílula: cantos totalmente arredondados (raio = metade da altura)
            ctx.beginPath();
            ctx.moveTo(esquerda + raio, topo);
            ctx.lineTo(direita - raio, topo);
            ctx.arc(direita - raio, topo + raio, raio, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(esquerda + raio, topo + ALTURA_BARRA_LEGENDA);
            ctx.arc(esquerda + raio, topo + raio, raio, Math.PI / 2, Math.PI * 1.5);
            ctx.closePath();
            ctx.fillStyle = corAzulMarinho;
            ctx.fill();

            const centroY = topo + ALTURA_BARRA_LEGENDA / 2;
            let cursorX = esquerda + PADDING_LATERAL_LEGENDA;

            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            itens.forEach(item => {
                ctx.fillStyle = item.cor;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(cursorX, centroY - lado / 2, lado, lado, 3);
                else ctx.rect(cursorX, centroY - lado / 2, lado, lado);
                ctx.fill();
                cursorX += lado + espacoIcone;

                ctx.fillStyle = corBege;
                ctx.fillText(item.texto, cursorX, centroY);
                cursorX += ctx.measureText(item.texto).width + espacoItens;
            });

            ctx.restore();
        },
    };

    graficosRadar[canvasId] = new Chart(canvas, {
        plugins: [fundoRadarPlugin, manchasPlugin, valoresColoridosPlugin, legendaBarraPlugin],
        type: "radar",
        data: {
            labels: categorias,
            datasets: [
                {
                    label: labelOriginal,
                    data: categorias.map(c => percentuaisOriginais[c] || 0),
                    borderColor: "transparent", // desenhado pelo manchasPlugin
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: corTerracota,
                    pointHoverBorderColor: corBege,
                },
                {
                    label: labelComparacao,
                    data: categorias.map(c => percentuaisImaginados[c] || 0),
                    borderColor: "transparent", // desenhado pelo manchasPlugin
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: corVerde,
                    pointHoverBorderColor: corBege,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // padding interna do canvas do grafico — margem ao redor de radar + textos.
            // O de baixo também reserva o espaço da pílula da legenda.
                        layout: { padding: { top: 16, right: PADDING_LATERAL_GRAFICO, bottom: ALTURA_BARRA_LEGENDA + MARGEM_INFERIOR_LEGENDA + 14, left: PADDING_LATERAL_GRAFICO } },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    beginAtZero: true,
                    // Os números da escala ficam escondidos; a grade mostra 25/50/75%
                    // (o anel do 100% é o hexágono branco).
                    ticks: {
                        display: false,
                        stepSize: 25,
                        backdropColor: "transparent",
                        showLabelBackdrop: false,
                    },
                    grid: { color: corGrade, lineWidth: 1.5 },
                    angleLines: { display: false },
                    pointLabels: {
                        color: corAzulMarinho,
                        padding: 14, // distância hexágono ↔ rótulo (quanto maior, menor o hexágono)
                        font: { ...fonteBase, size: TAMANHO_FONTE, weight: "500" },
                        // 2ª linha em branco: reserva o espaço dos valores "0% / 20%"
                        callback: nome => [nome, " "],
                    },
                },
            },
            plugins: {
                legend: { display: false }, // a legenda é desenhada pelo legendaBarraPlugin
                tooltip: {
                    backgroundColor: "rgba(19, 28, 59, 0.96)",
                    titleColor: corBege,
                    bodyColor: corBege,
                    borderColor: "rgba(249, 239, 231, 0.25)",
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { ...fonteBase, weight: "400" },
                    bodyFont: { ...fonteBase, size: 14 },
                    callbacks: {
                        label: context => `${context.dataset.label}: ${Number(context.raw || 0).toFixed(0)}%`,
                    },
                },
            },
        },
    });

    redesenhosRadar[canvasId] = () => desenharRadar(dadosOriginais, dadosImaginados, opcoes);
}

// Lista comparativa por item, ex:
// "Banco de Madeira — Na sua praça: 5, Original: 2, +3"
// Reaproveitada tanto no popup (comparando 1 criação com o original) quanto
// no cabeçalho da página de uma praça-base (comparando a MÉDIA com o original).
function criarListaComparativa(dadosImaginados, dadosOriginais, opcoes = {}) {
    // emColunas: layout da página da praça-base — cabeçalho "Original: / Média:"
    // uma vez por categoria e só os números em cada linha. O popup continua com
    // o layout antigo (rótulo pequeno dentro de cada linha).
    const { containerId = "modalListaItens", rotuloComparacao = "Nesta praça", emColunas = false } = opcoes;

    const lista = document.getElementById(containerId);
    if (!lista) return;

    lista.innerHTML = "";
    lista.classList.toggle("lista-colunas", emColunas);

    const categorias = [...new Set([
        ...Object.keys(dadosImaginados),
        ...Object.keys(dadosOriginais),
    ])];

    categorias.forEach(categoria => {
        const grupo = document.createElement("div");
        grupo.className = "grupo-categoria";

        const titulo = document.createElement("div");
        titulo.className = "grupo-categoria-titulo";
        titulo.innerText = categoria;

        if (emColunas) {
            const cabecalho = document.createElement("div");
            cabecalho.className = "grupo-categoria-cabecalho";
            cabecalho.appendChild(titulo);

            const rotulos = document.createElement("div");
            rotulos.className = "item-comparativo-dados";
            rotulos.innerHTML = `<span>Original:</span><span>${rotuloComparacao}:</span><span></span>`;
            cabecalho.appendChild(rotulos);

            grupo.appendChild(cabecalho);
        } else {
            grupo.appendChild(titulo);
        }

        const itensContainer = document.createElement("div");
        itensContainer.className = "lista-comparativa";

        const itensImaginados = dadosImaginados[categoria] || {};
        const itensOriginais = dadosOriginais[categoria] || {};
        const nomesItens = [...new Set([
            ...Object.keys(itensImaginados),
            ...Object.keys(itensOriginais),
        ])];

        nomesItens.forEach(nome => {
            const quantidadeAtual = itensImaginados[nome] || 0;
            const quantidadeOriginal = itensOriginais[nome] || 0;
            const diferenca = quantidadeAtual - quantidadeOriginal;

            let classe = "igual";
            let sinal = "";
            if (diferenca > 0) { classe = "aumentou"; sinal = "+"; }
            if (diferenca < 0) { classe = "diminuiu"; }

            const linha = document.createElement("div");
            linha.className = "item-comparativo";
            linha.innerHTML = `
                <div class="item-comparativo-nome">
                    <img src="${iconeParaItem(nome)}" alt="">
                    <span>${nome}</span>
                </div>
                <div class="item-comparativo-dados">
                    ${emColunas
                        ? `<span class="num-original">${quantidadeOriginal}</span>
                           <span class="num-comparacao">${quantidadeAtual}</span>`
                        : `<span><small>${rotuloComparacao}</small><strong>${quantidadeAtual}</strong></span>
                           <span><small>Original</small><strong>${quantidadeOriginal}</strong></span>`}
                    <span class="badge-diferenca ${classe}">${sinal}${diferenca}</span>
                </div>
            `;
            itensContainer.appendChild(linha);
        });

        grupo.appendChild(itensContainer);
        lista.appendChild(grupo);
    });
}

// ==========================================
// 1e. ESTATÍSTICAS AGREGADAS DA PÁGINA DE UMA PRAÇA-BASE
// ==========================================
// Título, descrição e "itens na praça original" agora são renderizados
// direto pelo Astro em build-time (src/pages/galeria/praca/[slug].astro)
// — funcionam até com JS desligado. O que sobra pra fazer aqui é só o que
// depende de dado vivo no Supabase: média de itens de todas as
// reimaginações, o radar comparativo, e a lista de itens da galeria
// filtrada por essa praça (isso carregarPracas() já cuida via
// nomeDaPracaAtual, lá embaixo).
//
// slug e nome vêm como data-attributes no <body>, escritos pelo Astro
// (ver GaleriaLayout.astro). O slug é o que importa pra filtrar dados
// (bate com mapa_id no Supabase); o nome é só informativo por aqui, já
// que título/descrição na tela já vêm prontos do Astro.

const slugPracaAtual = document.body.dataset.pracaSlug || null;
const nomeDaPracaAtual = document.body.dataset.pracaNome || null; // não usado pra filtrar nada

function itensOriginaisEmbutidos() {
    const el = document.getElementById("dados-itens-originais");
    if (!el) return {};
    try {
        return JSON.parse(el.textContent);
    } catch (erro) {
        console.warn("JSON de itens originais embutido na página é inválido:", erro);
        return {};
    }
}

async function carregarEstatisticasDaPraca(slugDaPraca, itensOriginais) {
    const { data, error } = await db
        .from('city_creations')
        .select('layout_data')
        .eq('mapa_id', slugDaPraca);

    if (error) {
        console.error("Erro ao buscar reimaginações da praça:", error);
        return;
    }

    const totalReimaginacoes = data.length;
    const itensOriginaisPorCategoria = organizarItensOriginais(itensOriginais || {});

    // Soma os itens de TODAS as reimaginações por categoria/item. A % de
    // cada categoria calculada em cima da SOMA é idêntica à calculada em
    // cima da MÉDIA (dividir tudo pelo mesmo número não muda a proporção
    // entre categorias) — então o radar usa a soma direto, sem precisar
    // dividir por totalReimaginacoes.
    const somaItensPorCategoria = {};
    let somaTotalItens = 0;

    data.forEach(linha => {
        let itens = [];
        try {
            itens = JSON.parse(linha.layout_data)?.layoutDaPraca || [];
        } catch (erro) {
            console.warn("layout_data inválido numa criação, ignorando:", erro);
        }

        const porCategoria = contarItensImaginados(itens);
        for (const categoria in porCategoria) {
            if (!somaItensPorCategoria[categoria]) somaItensPorCategoria[categoria] = {};
            for (const nome in porCategoria[categoria]) {
                somaItensPorCategoria[categoria][nome] =
                    (somaItensPorCategoria[categoria][nome] || 0) + porCategoria[categoria][nome];
                somaTotalItens += porCategoria[categoria][nome];
            }
        }
    });

    const mediaTotalItens = totalReimaginacoes > 0 ? somaTotalItens / totalReimaginacoes : 0;

    // --- Os dois números que dependem de dado vivo ---
    const statMedia = document.getElementById("statMedia");
    const statTotal = document.getElementById("statTotal");
    if (statMedia) statMedia.innerText = mediaTotalItens.toFixed(1);
    if (statTotal) statTotal.innerText = totalReimaginacoes;

    // --- Radar: praça original vs. média de todas as reimaginações ---
    desenharRadar(itensOriginaisPorCategoria, somaItensPorCategoria, {
        canvasId: "radarComparativoPraca",
        labelOriginal: "Praça original",
        labelComparacao: "rePraça média",
    });

    // --- Lista por item: original vs. média (arredondada pra 1 casa) ---
    const mediaItensPorCategoria = {};
    for (const categoria in somaItensPorCategoria) {
        mediaItensPorCategoria[categoria] = {};
        for (const nome in somaItensPorCategoria[categoria]) {
            mediaItensPorCategoria[categoria][nome] = totalReimaginacoes > 0
                ? Math.round((somaItensPorCategoria[categoria][nome] / totalReimaginacoes) * 10) / 10
                : 0;
        }
    }

    criarListaComparativa(mediaItensPorCategoria, itensOriginaisPorCategoria, {
        containerId: "pracaListaItens",
        rotuloComparacao: "Média",
        emColunas: true,
    });
}

// ==========================================
// 2. BUSCA DE DADOS E SCROLL INFINITO
// ==========================================

let paginaAtual = 0;
const itensPorPagina = 12;
let carregando = false;
let chegouAoFim = false;
// Conta quantas praças já apareceram na tela DESDE o último reset de
// filtro (ver aplicarFiltros()). É o que diferencia "zero resultados com
// esses filtros" de "chegou ao fim de verdade, depois de mostrar algo".
let totalCardsRenderados = 0;
// Cada reexportação cria uma linha nova com o mesmo praca_id (Histórico).
// A grelha mostra um só card por praça: o primeiro que chega (na ordem
// "recentes", a versão mais recente).
const pracasNaGrelha = new Set();

const gallery = document.getElementById("gallery");
const popup = document.getElementById("popup");
const loader = document.getElementById("fim-da-pagina");

async function carregarPracas() {
    if (carregando || chegouAoFim) return false;

    const elOrdem = document.getElementById("filtroOrdem");
    if (!elOrdem) return false; // página sem grade de galeria (ex.: hub /galeria/)

    carregando = true;

    const ordem = elOrdem.value;
    const minItens = parseInt(document.getElementById("filtroItens").value);
    const itemEspecifico = document.getElementById("filtroEspecifico").value;
    // Filtros novos são opcionais no DOM (?. e || de segurança) pra não
    // quebrar caso esse arquivo seja usado numa página sem eles.
    const categoriaSelecionada = document.getElementById("filtroCategoria")?.value || "todas";
    const soRemixes = document.getElementById("filtroSoRemixes")?.checked || false;
    const comDescricao = document.getElementById("filtroComDescricao")?.checked || false;

    const inicio = paginaAtual * itensPorPagina;
    const fim = inicio + itensPorPagina - 1;

    // "layout_data" só é pedido ao banco quando o filtro de categoria está
    // ativo — é o único filtro que depende dele, e o campo é relativamente
    // pesado (guarda a posição de cada objeto da praça inteira), então
    // evitamos baixá-lo à toa nas consultas normais.
    let colunas = 'praca_id, image_topo_url, created_at, likes, total_objects, praca_pai_id, comentario';
    if (categoriaSelecionada !== "todas") colunas += ', layout_data';

    // Quando filtra por item específico, chamamos uma função SQL (RPC) em
    // vez de montar o filtro com .ilike() direto no client — o Postgres
    // exige um cast (layout_data::text) pra comparar jsonb com ilike, e
    // esse cast não é repassado corretamente pelos filtros do PostgREST
    // client-side. A função SQL já faz esse cast por dentro (veja
    // filtrar_pracas_por_item.sql).
    let query = itemEspecifico !== "todos"
        ? db.rpc('filtrar_pracas_por_item', { item_nome: itemEspecifico }).select(colunas)
        : db.from('city_creations').select(colunas);

    query = query.gte('total_objects', minItens);
    if (slugPracaAtual) query = query.eq('mapa_id', slugPracaAtual);

    // "Só remixes": praca_pai_id vem vazio ("") nas criações do zero e
    // preenchido nas que nasceram de um remix (ver BuildingManager.cs,
    // idDaPracaPai). Por isso o filtro exclui null E string vazia.
    if (soRemixes) query = query.not('praca_pai_id', 'is', null).neq('praca_pai_id', '');

    // "Só com descrição": mesma lógica, agora pro campo de comentário.
    if (comDescricao) query = query.not('comentario', 'is', null).neq('comentario', '');

    if (ordem === "recentes") query = query.order('created_at', { ascending: false });
    if (ordem === "antigas") query = query.order('created_at', { ascending: true });
    if (ordem === "likes") query = query.order('likes', { ascending: false });

    const { data, error } = await query.range(inicio, fim);

    if (error) {
        console.error("Erro ao buscar:", error);
        loader.innerText = "Não foi possível carregar a galeria. Tenta novamente mais tarde.";
        carregando = false;
        return false;
    }

    // Só marca "chegou ao fim" pelo tamanho BRUTO devolvido pelo banco —
    // a decisão de qual AVISO mostrar (sem resultados vs. fim de verdade)
    // vem depois, e sim depende do que sobra após o filtro de categoria.
    if (data.length < itensPorPagina) {
        chegouAoFim = true;
    }

    // Filtro de categoria: não existe uma coluna pronta pra "foco
    // principal" no banco (ela depende do catálogo de itens, que só vive
    // no front-end), então filtramos no cliente depois de buscar a página.
    // Trade-off aceito: uma "página" pode renderizar poucos cards ou
    // nenhum quando o filtro é muito específico — o scroll infinito
    // compensa isso, buscando a página seguinte sozinho enquanto o loader
    // continuar visível na tela (ver o IntersectionObserver logo abaixo).
    const pracasParaMostrar = categoriaSelecionada === "todas"
        ? data
        : data.filter(praca => {
            const jsonConvertido = JSON.parse(praca.layout_data);
            return categoriaPredominante(jsonConvertido.layoutDaPraca || []) === categoriaSelecionada;
        });

    totalCardsRenderados += desenharCards(pracasParaMostrar);
    paginaAtual++;
    carregando = false;

    // Só decide o aviso final quando realmente não há mais nada a buscar.
    // Duas situações possíveis nesse ponto:
    // - Nenhuma praça apareceu em NENHUMA página desde o último reset de
    //   filtro → os filtros escolhidos não batem com nada no banco.
    // - Pelo menos uma praça já apareceu → é o fim natural da galeria.
    if (chegouAoFim) {
        if (totalCardsRenderados === 0) mostrarAvisoSemResultados();
        else mostrarAvisoFimDaGaleria();
    }

    return true;
}

function desenharCards(pracas) {
    const novas = pracas.filter(praca => {
        if (pracasNaGrelha.has(praca.praca_id)) return false;
        pracasNaGrelha.add(praca.praca_id);
        return true;
    });

    novas.forEach(praca => {
        const dataFormatada = new Date(praca.created_at).toLocaleDateString('pt-PT');

        // Selo de "remix" só aparece quando a praça nasceu de outra —
        // mesma coluna usada pelo filtro "Só remixes" acima.
        const ehRemix = praca.praca_pai_id && praca.praca_pai_id.trim() !== "";
        const seloRemix = ehRemix ? '<span class="card-remix-badge" data-tooltip="Esta praça é um remix" aria-label="Esta praça é um remix">↻ remix</span>' : '';
        const temDescricao = praca.comentario && praca.comentario.trim() !== "";
        const seloDescricao = temDescricao ? `
            <span class="card-descricao-badge" data-tooltip="Esta praça tem descrição" aria-label="Esta praça tem descrição">
                <span class="card-descricao-icone" aria-hidden="true"><i></i><i></i><i></i></span>
            </span>
        ` : '';

        const card = document.createElement("div");
        card.className = "card-praca";
        card.dataset.pracaId = praca.praca_id;
        card.innerHTML = `
            ${(seloRemix || seloDescricao) ? `<div class="card-badges">${seloRemix}${seloDescricao}</div>` : ''}
            <img src="${praca.image_topo_url}" class="card-img" loading="lazy" alt="Praça">
            <div class="card-info">
                <span class="card-likes">
                    <img src="/img/icone-coracao.svg" height="20"> 
                    ${praca.likes || 0}
                </span>
                <span class="card-data">${dataFormatada}</span>
            </div>
        `;

        card.addEventListener("click", () => abrirPraca(praca.praca_id));
        gallery.appendChild(card);
    });

    // Um link direto pode abrir a pasta antes de a grelha carregar.
    if (pracaAbertaId) atualizarSetas();
    return novas.length;
}

// Aviso de "filtros não bateram com nada" — só acontece quando a busca
// chega ao fim SEM ter mostrado nenhum card desde o último reset. Dá um
// jeito fácil de sair dessa situação (limpar tudo) em vez de deixar a
// pessoa mexendo filtro por filtro tentando adivinhar qual está travando.
function mostrarAvisoSemResultados() {
    loader.innerHTML = `
        Ainda não há praças com esta combinação. Que tal seres o primeiro a criar uma?
        <br>
        <a href="#" id="linkLimparFiltros">Limpar todos os filtros</a>
    `;

    document.getElementById("linkLimparFiltros")?.addEventListener("click", (evento) => {
        evento.preventDefault();
        limparFiltros();
    });
}

// Aviso do fim "de verdade" da galeria — chegou ao fim tendo mostrado pelo
// menos uma praça na página atual de filtros.
function mostrarAvisoFimDaGaleria() {
    loader.innerHTML = `
        Chegaste ao fim das rePraças!
        <br>
        <a href="#" id="linkVoltarAoTopo">Voltar ao topo</a>
    `;

    document.getElementById("linkVoltarAoTopo")?.addEventListener("click", (evento) => {
        evento.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

// Dispara carregarPracas() quando o loader entra na tela (scroll infinito)
// — só existe em páginas com grade de galeria (a hub /galeria/ não tem).
if (loader) {
    const observer = new IntersectionObserver(entradas => {
        if (entradas[0].isIntersecting) carregarPracas();
    });
    observer.observe(loader);
}

// ==========================================
// 3. RECARREGAR AO MUDAR OS FILTROS
// ==========================================

function aplicarFiltros() {
    gallery.innerHTML = "";
    paginaAtual = 0;
    chegouAoFim = false;
    pracasNaGrelha.clear();
    totalCardsRenderados = 0; // recomeça a contagem pro novo conjunto de filtros
    loader.innerHTML = "A carregar mais praças...";
    carregarPracas();
}

// Volta todos os filtros pro estado padrão da página e recarrega a
// galeria. Chamado pelo link "Limpar todos os filtros" do aviso de zero
// resultados (mostrarAvisoSemResultados, acima).
function limparFiltros() {
    const elOrdem = document.getElementById("filtroOrdem");
    if (elOrdem) elOrdem.value = "recentes";

    if (inputFiltroItens) inputFiltroItens.value = "3";
    atualizarLabelFiltroItens();
    atualizarPreenchimentoSlider();

    const elEspecifico = document.getElementById("filtroEspecifico");
    if (elEspecifico) elEspecifico.value = "todos";

    const elCategoria = document.getElementById("filtroCategoria");
    if (elCategoria) elCategoria.value = "todas";

    const elSoRemixes = document.getElementById("filtroSoRemixes");
    if (elSoRemixes) elSoRemixes.checked = false;

    const elComDescricao = document.getElementById("filtroComDescricao");
    if (elComDescricao) elComDescricao.checked = false;

    aplicarFiltros();
}

// Atualiza o texto do rótulo (ex: "8+") e o preenchimento visual da trilha
// enquanto o slider é arrastado — nenhuma das duas coisas busca dados, são
// só feedback imediato pro usuário ver o que está selecionando (sem isso
// ele arrasta às cegas até soltar).
const inputFiltroItens = document.getElementById("filtroItens");
const labelFiltroItens = document.getElementById("filtroItensValor");

function atualizarLabelFiltroItens() {
    if (!inputFiltroItens || !labelFiltroItens) return;
    const valor = parseInt(inputFiltroItens.value);
    labelFiltroItens.textContent = valor >= 30 ? "30+" : valor + "+";
}

// A trilha do slider é pintada com um gradiente CSS que muda de cor
// exatamente na posição do thumb (ver .filtro-grupo--slider input[type="range"]
// em style.css). Como CSS puro não sabe "onde" o thumb está, calculamos a
// posição em % aqui e escrevemos numa custom property que o gradiente lê.
function atualizarPreenchimentoSlider() {
    if (!inputFiltroItens) return;
    const min = parseFloat(inputFiltroItens.min);
    const max = parseFloat(inputFiltroItens.max);
    const valor = parseFloat(inputFiltroItens.value);
    const percentual = ((valor - min) / (max - min)) * 100;
    inputFiltroItens.style.setProperty("--posicao-slider", percentual + "%");
}

inputFiltroItens?.addEventListener("input", () => {
    atualizarLabelFiltroItens();
    atualizarPreenchimentoSlider();
});

// Roda uma vez no carregamento pra refletir o valor inicial (3+) tanto no
// texto quanto na trilha, antes de qualquer interação do usuário.
atualizarLabelFiltroItens();
atualizarPreenchimentoSlider();

document.getElementById("filtroOrdem")?.addEventListener("change", aplicarFiltros);
// O slider só dispara a busca no "change" (ao soltar o dedo/mouse), igual
// os selects — evita rodar uma query a cada pixel arrastado.
document.getElementById("filtroItens")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroEspecifico")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroCategoria")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroSoRemixes")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroComDescricao")?.addEventListener("change", aplicarFiltros);

// ==========================================
// 4. SISTEMA DE ROTEAMENTO POR QUERY STRING (?id=)
// ==========================================
// Trocado de #hash pra ?id= porque o #hash nunca chega ao servidor numa
// requisição HTTP — a Cloudflare Function que gera a preview certa pro
// WhatsApp/Instagram só consegue ler ?id=. O pushState/popstate abaixo
// mantém a MESMA experiência de antes (popup abre/fecha na hora, sem
// recarregar a página); só a forma de guardar o id na URL muda.

function pegarIdDaUrl() {
    return new URLSearchParams(window.location.search).get("id");
}

// Usado sempre que algo no site abre uma praça (clique num card, num
// remix, etc.) — troca a URL sem recarregar e chama o handler na mão,
// porque pushState (diferente do hash) não dispara evento sozinho.
function abrirPraca(id, direcao = null) {
    history.pushState({}, "", "?id=" + id);
    return lidarComNavegacao(direcao);
}

// Usado sempre que o popup fecha (botão X, clique fora, erro ao carregar).
function fecharPraca() {
    history.pushState({}, "", window.location.pathname);
    lidarComNavegacao();
}

// popstate cobre o botão voltar/avançar do navegador (pushState não
// dispara isso sozinho, só a navegação por histórico dispara).
window.addEventListener("popstate", () => lidarComNavegacao());

// Busca TODAS as versões da praça (mesmo praca_id), da mais recente para a
// mais antiga. A primeira é a atual; as restantes alimentam o separador
// Histórico sem precisar de uma segunda consulta.
async function buscarPraca(id) {
    const { data, error } = await db
        .from('city_creations')
        .select('*')
        .eq('praca_id', id)
        .order('created_at', { ascending: false });

    if (error) return { data: null, versoes: [], error };
    return { data: data && data.length ? data[0] : null, versoes: data || [], error: null };
}

// O popup é uma "pasta": separadores em cima (desktop) ou em baixo (mobile)
// e uma folha com o conteúdo. Ao trocar de praça só os separadores e a
// folha saem e entram; as setas, o Partilhar e o reMixar ficam no lugar.
const pasta = document.querySelector(".pasta");
const partesAnimadasDaPasta = [pasta.querySelector(".pasta-abas"), pasta.querySelector(".pasta-corpo")];
let transicaoDePracaEmCurso = false;

function classeDeSaida(direcao) {
    return direcao > 0 ? "pasta-sair-esq" : "pasta-sair-dir";
}

function classeDeEntrada(direcao) {
    return direcao > 0 ? "pasta-entrar-dir" : "pasta-entrar-esq";
}

function semAnimacoes() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function aguardarAnimacao(elemento) {
    if (semAnimacoes()) return Promise.resolve();

    return new Promise(resolve => {
        const aoTerminar = evento => {
            // animationend também sobe dos elementos internos (como os
            // pontinhos do loading); só a animação do próprio elemento conta.
            if (evento.target !== elemento) return;
            elemento.removeEventListener("animationend", aoTerminar);
            resolve();
        };
        elemento.addEventListener("animationend", aoTerminar);
    });
}

async function animarSaidaDaPraca(direcao) {
    const classe = classeDeSaida(direcao);
    partesAnimadasDaPasta.forEach(parte => parte.classList.add(classe));
    await aguardarAnimacao(partesAnimadasDaPasta[1]);
    partesAnimadasDaPasta.forEach(parte => {
        parte.classList.remove(classe);
        parte.classList.add("pasta-escondida");
    });
}

async function animarEntradaDaPraca(direcao) {
    const classe = classeDeEntrada(direcao);
    partesAnimadasDaPasta.forEach(parte => {
        parte.classList.remove("pasta-escondida");
        parte.classList.add(classe);
    });
    await aguardarAnimacao(partesAnimadasDaPasta[1]);
    partesAnimadasDaPasta.forEach(parte => parte.classList.remove(classe));
}

async function lidarComNavegacao(direcao = null) {
    const id = pegarIdDaUrl();

    if (!id) {
        fecharDenuncia({ devolverFoco: false, animar: false });
        popup.classList.add("escondido");
        partesAnimadasDaPasta.forEach(parte => parte.classList.remove(
            "pasta-escondida", "pasta-sair-esq", "pasta-sair-dir", "pasta-entrar-esq", "pasta-entrar-dir"
        ));
        document.documentElement.classList.remove("popup-aberto");
        if (elementoComFocoAntesDoModal) {
            elementoComFocoAntesDoModal.focus();
            elementoComFocoAntesDoModal = null;
        }
        return;
    }

    if (popup.classList.contains("escondido")) {
        elementoComFocoAntesDoModal = document.activeElement;
    }
    popup.classList.remove("escondido");
    // Trava o scroll da página por trás (o scroll do site é o do <html>,
    // por causa do overflow-x no index.css, por isso não basta o <body>).
    document.documentElement.classList.add("popup-aberto");
    requestAnimationFrame(() => document.getElementById("btnFecharModal").focus());

    const deveAnimar = Boolean(direcao && pracaAbertaId && !transicaoDePracaEmCurso);
    if (deveAnimar) transicaoDePracaEmCurso = true;
    else document.getElementById("modalTitulo").textContent = "A carregar…";

    // A consulta e a saída correm ao mesmo tempo. Assim, numa ligação
    // normal, a nova praça já está pronta quando a antiga termina de sair.
    const [{ data, versoes, error }] = await Promise.all([
        buscarPraca(id),
        deveAnimar ? animarSaidaDaPraca(direcao) : Promise.resolve(),
    ]);

    // A praça pode ter sido fechada durante a espera.
    if (pegarIdDaUrl() !== id) {
        transicaoDePracaEmCurso = false;
        return;
    }

    if (error) {
        console.error("Erro ao carregar praça:", error);
        if (deveAnimar) await animarEntradaDaPraca(-direcao);
        else fecharPraca();
        alert("Erro ao carregar a praça.");
        transicaoDePracaEmCurso = false;
        return;
    }

    if (data) {
        await preencherModal(data, versoes);
        if (deveAnimar) await animarEntradaDaPraca(direcao);
    } else {
        alert("Praça não encontrada!");
        fecharPraca();
    }

    transicaoDePracaEmCurso = false;
}

document.getElementById("btnFecharModal").addEventListener("click", fecharPraca);
popup.addEventListener("click", e => {
    if (e.target === popup) fecharPraca();
});

let elementoComFocoAntesDoModal = null;

document.addEventListener("keydown", evento => {
    if (popup.classList.contains("escondido")) return;

    if (evento.key === "Escape") {
        evento.preventDefault();
        if (denunciaAberta()) fecharDenuncia();
        else fecharPraca();
        return;
    }

    if (evento.key !== "Tab") return;

    // Com o painel Denunciar aberto, o Tab fica dentro dele.
    const contentor = denunciaAberta() ? document.getElementById("painelDenuncia") : popup;
    const focaveis = [...contentor.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(elemento => elemento.getClientRects().length > 0);
    if (!focaveis.length) return;

    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
    }
});

async function compartilharPraca() {
    if (!pracaAbertaId) return;

    const botao = document.getElementById("btnCompartilhar");
    const texto = document.getElementById("textoCompartilhar");
    const url = new URL(window.location.href);
    url.searchParams.set("id", pracaAbertaId);
    const dados = {
        title: document.getElementById("modalTitulo").innerText,
        text: document.getElementById("modalNumero").innerText,
        url: url.toString(),
    };

    try {
        if (navigator.share) {
            await navigator.share(dados);
            texto.innerText = "Partilhado";
        } else {
            await navigator.clipboard.writeText(dados.url);
            texto.innerText = "Link copiado";
        }
    } catch (erro) {
        if (erro.name === "AbortError") return;
        texto.innerText = "Não foi possível partilhar";
    }

    window.setTimeout(() => { texto.innerText = "Partilhar"; }, 2000);
    botao.focus();
}

document.getElementById("btnCompartilhar").addEventListener("click", compartilharPraca);

// Percorre os cards na mesma ordem em que aparecem na grelha, portanto
// respeita os filtros e a ordenação selecionados. Se a pessoa chegar ao
// último card já carregado, busca mais uma página antes de decidir que não
// há para onde avançar.
// Cada reexportação pode aparecer como um card à parte; para as setas conta
// só o primeiro card de cada praca_id, senão "seguinte" abria a mesma praça.
function cardsDaGrelha() {
    if (!gallery) return [];
    const vistos = new Set();
    return [...gallery.querySelectorAll(".card-praca")].filter(card => {
        if (vistos.has(card.dataset.pracaId)) return false;
        vistos.add(card.dataset.pracaId);
        return true;
    });
}

async function navegarPelaGrelha(direcao) {
    if (!gallery || !pracaAbertaId) return;

    let cards = cardsDaGrelha();
    let indiceAtual = cards.findIndex(card => card.dataset.pracaId === pracaAbertaId);
    if (indiceAtual === -1) return;

    let indiceDestino = indiceAtual + direcao;

    while (indiceDestino >= cards.length && !chegouAoFim) {
        const carregou = await carregarPracas();
        cards = cardsDaGrelha();

        // Pode haver uma página inteira que não sobreviva a um filtro
        // aplicado no cliente. Nesse caso tenta a página seguinte; só para
        // se já não houver uma consulta nova em curso.
        if (!carregou) break;
    }

    const destino = cards[indiceDestino];
    if (destino) return abrirPraca(destino.dataset.pracaId, direcao);
    atualizarSetas();
}

// Teclado (← →) e as setas da pasta partilham a mesma trava, para dois
// pedidos seguidos não trocarem de praça duas vezes ao mesmo tempo.
let navegandoEntrePracas = false;

async function irParaPracaVizinha(direcao) {
    if (navegandoEntrePracas) return;
    navegandoEntrePracas = true;
    try {
        await navegarPelaGrelha(direcao);
    } finally {
        navegandoEntrePracas = false;
    }
}

document.addEventListener("keydown", evento => {
    if (popup.classList.contains("escondido") || evento.altKey || evento.ctrlKey || evento.metaKey) return;
    if (evento.target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;

    evento.preventDefault();
    irParaPracaVizinha(evento.key === "ArrowRight" ? 1 : -1);
});

const btnPracaAnterior = document.getElementById("btnPracaAnterior");
const btnPracaSeguinte = document.getElementById("btnPracaSeguinte");
btnPracaAnterior.addEventListener("click", () => irParaPracaVizinha(-1));
btnPracaSeguinte.addEventListener("click", () => irParaPracaVizinha(1));

// As setas só aparecem quando a praça aberta está na grelha desta página
// (a hub /galeria/ não tem grelha, e um link direto pode abrir uma praça
// que ainda não carregou).
function atualizarSetas() {
    const cards = cardsDaGrelha();
    const indice = cards.findIndex(card => card.dataset.pracaId === pracaAbertaId);
    const temGrelha = indice !== -1;

    btnPracaAnterior.hidden = !temGrelha;
    btnPracaSeguinte.hidden = !temGrelha;
    if (!temGrelha) return;

    btnPracaAnterior.disabled = indice === 0;
    btnPracaSeguinte.disabled = indice === cards.length - 1 && chegouAoFim;
}

// ==========================================
// 5. PREENCHER A PASTA
// ==========================================

let pracaAbertaId = null;

const LINK_REMIX = "https://feliperpv.com/repraca/galeria/abrir-app/?id=";
const EMAIL_DENUNCIA = "repraca@feliperpv.com";

// Pergunta no balão por cima do reMixar, conforme o separador aberto.
const PERGUNTAS_REMIX = {
    capa: "Tens outra ideia para esta praça?",
    comparacao: "O que acrescentavas ou tiravas?",
    remixes: "Leva esta ideia noutra direção.",
    historico: "Pega na última versão e faz a tua.",
};

// Tudo o que a pasta precisa de lembrar sobre a praça aberta.
const estadoPasta = {
    aba: "capa",
    vista: "proposta",          // "hoje" (foto da praça real) ou "proposta"
    vistaProposta: "topo",      // "topo" ou "angulo"
    atual: null,                // linha mais recente da praça
    aVer: null,                 // linha mostrada (a atual ou uma versão antiga)
    versoes: [],                // todas as linhas, da mais recente para a mais antiga
    base: { itens: {} },        // JSON da praça-base
    itensOriginais: {},         // itens da praça-base por categoria
};

function escaparHtml(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function formatarData(dataIso) {
    return dataIso ? dataIso.substring(0, 10).split("-").reverse().join("/") : "";
}

function textoItens(n) {
    return n === 1 ? "1 item" : n + " itens";
}

// layout_data pode chegar como texto JSON ou já como objeto.
function lerLayout(linha) {
    if (!linha || !linha.layout_data) return {};
    if (typeof linha.layout_data === "object") return linha.layout_data;
    try {
        return JSON.parse(linha.layout_data);
    } catch (erro) {
        console.warn("layout_data inválido na linha", linha.id, erro);
        return {};
    }
}

function itensDaLinha(linha) {
    return lerLayout(linha).layoutDaPraca || [];
}

// { "Banco de madeira": 2, "Palmeira": 3 } a partir dos itens posicionados.
function contagemPorNome(itens) {
    const contagem = {};
    itens.forEach(item => {
        const nome = item.nome || "Item sem nome";
        contagem[nome] = (contagem[nome] || 0) + 1;
    });
    return contagem;
}

function somaDeContagem(contagem) {
    return Object.values(contagem).reduce((soma, qtd) => soma + qtd, 0);
}

// Diferenças de item a item entre duas contagens, das maiores para as menores.
function diferencasEntre(contagemNova, contagemAntiga) {
    const nomes = new Set([...Object.keys(contagemNova), ...Object.keys(contagemAntiga)]);
    return [...nomes]
        .map(nome => ({ nome, dif: (contagemNova[nome] || 0) - (contagemAntiga[nome] || 0) }))
        .filter(d => d.dif !== 0)
        .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || a.nome.localeCompare(b.nome, "pt"));
}

function sinalDe(n) {
    return n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0";
}

// Etiquetas "+8 Cereja-do-mato" / "−1 Mesa de xadrez".
function etiquetasDeMudanca(diferencas, { comIcone = false, maximo = 4 } = {}) {
    if (!diferencas.length) {
        return `<span class="chip chip--neutro">Sem mudanças nos itens</span>`;
    }
    const mostradas = diferencas.slice(0, maximo);
    const resto = diferencas.length - mostradas.length;
    return mostradas.map(d => `
        <span class="chip ${d.dif > 0 ? "chip--mais" : "chip--menos"}">${comIcone ? `<img src="${escaparHtml(iconeParaItem(d.nome))}" alt="">` : ""}${sinalDe(d.dif)} ${escaparHtml(d.nome)}</span>
    `).join("") + (resto > 0 ? `<span class="chip chip--neutro">+${resto} ${resto === 1 ? "mudança" : "mudanças"}</span>` : "");
}

function reanimar(elemento, classe) {
    elemento.classList.remove(classe);
    void elemento.offsetWidth; // força o reflow para a animação recomeçar
    elemento.classList.add(classe);
}

function eVersaoAntiga() {
    return Boolean(estadoPasta.aVer && estadoPasta.atual && estadoPasta.aVer.id !== estadoPasta.atual.id);
}

function numeroDaVersao(linha) {
    return estadoPasta.versoes.length - estadoPasta.versoes.indexOf(linha);
}

// --- Imagens da capa ---

function carregarVista(url, descricao) {
    const imgEl = document.getElementById("selectedImage");
    const caixa = imgEl.closest(".capa-foto");
    const loading = document.getElementById("imagemLoading");

    if (!url) {
        caixa.classList.add("a-carregar", "com-erro");
        loading.setAttribute("aria-label", "Não foi possível carregar esta imagem");
        return;
    }

    // Mesma imagem já carregada: nada a fazer (o onload não voltaria a correr).
    if (imgEl.getAttribute("src") === url && imgEl.complete && imgEl.naturalWidth) {
        caixa.classList.remove("a-carregar", "com-erro");
        return;
    }

    // Cada troca recebe uma identidade própria: se a pessoa clicar
    // rapidamente nas duas vistas, o evento atrasado da imagem anterior
    // não pode remover o estado de loading da imagem atual.
    const pedido = Symbol("vista");
    imgEl._pedidoDeVista = pedido;
    caixa.classList.add("a-carregar");
    caixa.classList.remove("com-erro");
    loading.setAttribute("aria-label", `A carregar a ${descricao}`);

    imgEl.onload = () => {
        if (imgEl._pedidoDeVista !== pedido) return;
        caixa.classList.remove("a-carregar");
    };

    imgEl.onerror = () => {
        if (imgEl._pedidoDeVista !== pedido) return;
        caixa.classList.add("com-erro");
        loading.setAttribute("aria-label", "Não foi possível carregar esta imagem");
    };

    imgEl.alt = "Planta da praça reimaginada, " + descricao;
    imgEl.src = url;
}

// Aplica "Hoje / Proposta" e "topo / ângulo" à foto da capa.
function aplicarVista() {
    const linha = estadoPasta.aVer;
    const caixa = document.querySelector(".capa-foto");
    const imagemHoje = document.getElementById("imagemHoje");
    const hoje = estadoPasta.vista === "hoje";
    const angulo = estadoPasta.vistaProposta === "angulo";

    caixa.classList.toggle("vista-hoje", hoje);
    imagemHoje.setAttribute("aria-hidden", hoje ? "false" : "true");
    document.getElementById("btnVerHoje").setAttribute("aria-pressed", hoje);
    document.getElementById("btnVerProposta").setAttribute("aria-pressed", !hoje);

    const btnTopo = document.getElementById("btnVistaTopo");
    const btnAngulo = document.getElementById("btnVistaAngulo");
    btnTopo.classList.toggle("ativo", !angulo);
    btnAngulo.classList.toggle("ativo", angulo);
    btnTopo.setAttribute("aria-pressed", !angulo);
    btnAngulo.setAttribute("aria-pressed", angulo);

    if (linha) {
        carregarVista(angulo ? linha.image_url : linha.image_topo_url, angulo ? "vista de ângulo" : "vista de topo");
    }

}

document.getElementById("btnVerHoje").addEventListener("click", () => {
    estadoPasta.vista = "hoje";
    aplicarVista();
});
document.getElementById("btnVerProposta").addEventListener("click", () => {
    estadoPasta.vista = "proposta";
    aplicarVista();
});
document.getElementById("btnVistaTopo").addEventListener("click", () => {
    estadoPasta.vistaProposta = "topo";
    aplicarVista();
});
document.getElementById("btnVistaAngulo").addEventListener("click", () => {
    estadoPasta.vistaProposta = "angulo";
    aplicarVista();
});

// --- Abertura de uma praça ---

async function preencherModal(praca, versoes) {
    pracaAbertaId = praca.praca_id;
    fecharDenuncia({ devolverFoco: false, animar: false });

    estadoPasta.atual = praca;
    estadoPasta.versoes = versoes && versoes.length ? versoes : [praca];
    estadoPasta.vista = "proposta";
    estadoPasta.vistaProposta = "topo";
    ramosDaArvore = { mae: null, filhos: [], netos: [] };
    document.getElementById("arvoreRemixes").innerHTML = "";

    // "mapaId" (ex: "barao-de-corumba") é o identificador estável que liga
    // essa criação à praça-base certa — bate com o nome do arquivo em
    // dados/pracas/*.json. "nomeDaCena" é só o nome de exibição.
    const layout = lerLayout(praca);
    estadoPasta.base = await carregarDadosDaPraca(layout.mapaId || "");
    estadoPasta.itensOriginais = organizarItensOriginais(estadoPasta.base.itens || {});

    // Foto da praça como está hoje: a primeira imagem do JSON da praça-base.
    const fotoReal = (estadoPasta.base.imagens || [])[0];
    const imagemHoje = document.getElementById("imagemHoje");
    document.getElementById("grupoHojeProposta").hidden = !fotoReal;
    if (fotoReal) {
        imagemHoje.src = fotoReal.src;
        imagemHoje.alt = fotoReal.alt || "A praça como está hoje";
    } else {
        imagemHoje.removeAttribute("src");
    }

    document.getElementById("btnRemix").href = LINK_REMIX + praca.praca_id;

    mostrarVersao(praca);
    verificarStatusDoLike(praca.praca_id, praca.likes || 0);
    trocarAba("capa"); // abre sempre na capa
    desenharHistorico();
    atualizarSetas();
    carregarRemixes(praca);
}

// Mostra uma versão (a atual ou uma antiga) na capa, na comparação e na ficha.
function mostrarVersao(linha) {
    estadoPasta.aVer = linha;
    const antiga = eVersaoAntiga();
    const layout = lerLayout(linha);
    const itens = layout.layoutDaPraca || [];
    const nomeBase = layout.nomeDaCena || estadoPasta.base.nome || "";
    const numero = numeroDaVersao(linha);
    const data = formatarData(linha.created_at);

    pasta.classList.toggle("versao-antiga", antiga);

    // Capa
    estadoPasta.vista = "proposta";
    aplicarVista();

    // Título = o nome que o criador deu à própria criação; se não tiver
    // (linhas antigas sem esse campo), cai pro nome da praça-base.
    const titulo = (linha.titulo && linha.titulo.trim()) ? linha.titulo.trim() : (nomeBase || "Praça personalizada");
    document.getElementById("modalTitulo").textContent = titulo;

    const nota = document.getElementById("modalNotaAutor");
    const comentario = (linha.comentario || "").trim();
    nota.hidden = !comentario;
    document.getElementById("modalComentario").textContent = comentario;

    // Ficha do projeto. "rePraça {numero}" = id da linha mais recente
    // (não o praca_id, que é o UUID), igual para todas as versões.
    document.getElementById("modalNumero").textContent = "rePraça " + estadoPasta.atual.id;
    document.getElementById("fichaBase").textContent = nomeBase || "—";
    const local = [estadoPasta.base.bairro, estadoPasta.base.cidade].filter(Boolean).join(", ");
    document.getElementById("fichaLocal").textContent = local;
    document.getElementById("fichaLocalCelula").hidden = !local;
    document.getElementById("fichaDataRotulo").textContent = antiga ? "Data desta versão" : "Última edição";
    document.getElementById("modalData").textContent = antiga ? `${data} · versão ${numero}` : data;

    // Aviso de versão antiga
    const banner = document.getElementById("bannerVersao");
    banner.hidden = !antiga;
    if (antiga) {
        document.getElementById("bannerVersaoTexto").innerHTML =
            `<b>Estás a ver a versão ${numero}</b>, de ${escaparHtml(data)}. Há uma versão mais recente desta proposta.`;
    }

    // Comparação e resumo no índice
    const itensPorCategoria = contarItensImaginados(itens);
    desenharComparacao(itensPorCategoria, estadoPasta.itensOriginais);
    document.getElementById("resumoComparacao").textContent =
        resumoDaComparacao(itensPorCategoria, estadoPasta.itensOriginais);

    atualizarDenuncia(linha, titulo, nomeBase, local);
    atualizarRemix();
    marcarVersaoAVer();
}

document.querySelectorAll("[data-voltar-atual]").forEach(botao => {
    botao.addEventListener("click", () => {
        if (estadoPasta.atual) mostrarVersao(estadoPasta.atual);
    });
});

// --- Separadores ---

document.querySelectorAll(".pasta-aba").forEach(botao => {
    botao.addEventListener("click", () => trocarAba(botao.dataset.tab));
});

document.querySelectorAll(".indice-linha").forEach(botao => {
    botao.addEventListener("click", () => trocarAba(botao.dataset.ir));
});

function trocarAba(nomeAba) {
    estadoPasta.aba = nomeAba;
    pasta.dataset.aba = nomeAba;

    document.querySelectorAll(".pasta-aba").forEach(botao => {
        botao.setAttribute("aria-pressed", botao.dataset.tab === nomeAba);
    });

    const idPainel = "painel" + nomeAba.charAt(0).toUpperCase() + nomeAba.slice(1);
    document.querySelectorAll(".pasta-painel").forEach(painel => {
        painel.classList.toggle("ativo", painel.id === idPainel);
    });

    pasta.querySelector(".pasta-scroll").scrollTop = 0;

    // No mobile os separadores têm scroll horizontal: mantém o ativo à vista.
    pasta.querySelector(`.pasta-aba[data-tab="${nomeAba}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: semAnimacoes() ? "auto" : "smooth" });

    atualizarRemix();
}

// --- reMixar e Denunciar ---

function atualizarRemix() {
    const antiga = eVersaoAntiga();
    document.getElementById("btnRemix").hidden = antiga;
    document.getElementById("btnRemixVoltar").hidden = !antiga;

    const balao = document.getElementById("balaoRemix");
    const texto = antiga ? "Só a versão atual pode ser remixada." : PERGUNTAS_REMIX[estadoPasta.aba];
    if (balao.textContent !== texto) {
        balao.textContent = texto;
        reanimar(balao, "anim-balao");
    }
}

// Prepara a mensagem de denúncia com os dados da proposta. O painel oferece
// três caminhos, porque o mailto não faz nada em browsers sem app de email:
// app de email, Gmail na web, ou copiar o texto.
let mensagemDeDenuncia = { assunto: "", corpo: "" };

function atualizarDenuncia(linha, titulo, nomeBase, local) {
    const total = estadoPasta.versoes.length;
    const link = window.location.origin + window.location.pathname + "?id=" + linha.praca_id;
    const assunto = `Denúncia: rePraça ${estadoPasta.atual.id} (${titulo})`;
    const corpo = [
        "Quero denunciar esta proposta da galeria rePraça.",
        "",
        `Proposta: rePraça ${estadoPasta.atual.id}${titulo !== nomeBase ? " — " + titulo : ""}`,
        `Praça-base: ${nomeBase || "—"}${local ? ", " + local : ""}`,
        `Versão: ${numeroDaVersao(linha)} de ${total} (linha ${linha.id}, ${formatarData(linha.created_at)})`,
        `ID: ${linha.praca_id}`,
        `Link: ${link}`,
        "",
        "Detalhes (opcional):",
        "",
        "",
    ].join("\r\n");
    mensagemDeDenuncia = { assunto, corpo };
    document.getElementById("denunciaEmail").href =
        `mailto:${EMAIL_DENUNCIA}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
    document.getElementById("denunciaGmail").href =
        `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(EMAIL_DENUNCIA)}&su=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

// ---------- Painel Denunciar ----------
// No desktop é um balão por baixo do botão; no mobile, uma folha que sobe
// de baixo (CSS). O fundo apanha os cliques fora para fechar só o painel.
let temporizadorDenuncia = null;

function denunciaAberta() {
    const painel = document.getElementById("painelDenuncia");
    return !painel.hidden && !painel.classList.contains("saindo");
}

function abrirDenuncia(botao) {
    const painel = document.getElementById("painelDenuncia");
    const pasta = painel.closest(".pasta");
    // Alinha a margem direita do balão com a do botão que o abriu.
    const caixaPasta = pasta.getBoundingClientRect();
    const caixaBotao = botao.getBoundingClientRect();
    const direita = Math.max(0, caixaPasta.right - caixaBotao.right);
    painel.style.setProperty("--denuncia-direita", direita + "px");
    painel.style.setProperty("--denuncia-topo", (caixaBotao.bottom - caixaPasta.top + 6) + "px");

    limparAvisoDenuncia();
    window.clearTimeout(temporizadorDenuncia);
    const fundo = document.getElementById("denunciaFundo");
    fundo.classList.remove("saindo");
    painel.classList.remove("saindo");
    fundo.hidden = false;
    painel.hidden = false;
    document.querySelectorAll("[data-denunciar]").forEach(b => b.setAttribute("aria-expanded", "true"));
    painel.dataset.origem = botao.classList.contains("pasta-denunciar--ficha") ? "ficha" : "topo";
    document.getElementById("denunciaEmail").focus();
}

// Fecha com a animação do abrir ao contrário. Ao mudar de praça ou fechar a
// pasta (animar: false) fecha logo.
function fecharDenuncia({ devolverFoco = true, animar = true } = {}) {
    const painel = document.getElementById("painelDenuncia");
    if (!painel || painel.hidden) return;
    const fundo = document.getElementById("denunciaFundo");
    const esconder = () => {
        window.clearTimeout(temporizadorDenuncia);
        painel.hidden = true;
        fundo.hidden = true;
        painel.classList.remove("saindo");
        fundo.classList.remove("saindo");
    };
    const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animar && !semMovimento) {
        if (painel.classList.contains("saindo")) return;
        painel.classList.add("saindo");
        fundo.classList.add("saindo");
        temporizadorDenuncia = window.setTimeout(esconder, 230);
    } else {
        esconder();
    }
    document.querySelectorAll("[data-denunciar]").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (devolverFoco) {
        const origem = document.querySelector(`.pasta-denunciar--${painel.dataset.origem || "topo"}`);
        const visivel = origem && origem.getClientRects().length ? origem
            : [...document.querySelectorAll("[data-denunciar]")].find(b => b.getClientRects().length);
        if (visivel) visivel.focus();
    }
}

function limparAvisoDenuncia() {
    const aviso = document.getElementById("denunciaAviso");
    aviso.textContent = "";
    aviso.classList.remove("erro");
    document.getElementById("denunciaCopiarTexto").textContent = "Copiar para a área de transferência";
}

// navigator.clipboard só existe em páginas seguras (https ou localhost);
// fora disso, usa-se o método antigo com uma textarea escondida.
async function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return;
    }
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copiar falhou");
}

document.querySelectorAll("[data-denunciar]").forEach(botao => {
    botao.addEventListener("click", evento => {
        evento.stopPropagation();
        if (denunciaAberta()) fecharDenuncia();
        else abrirDenuncia(botao);
    });
});

document.getElementById("denunciaFechar").addEventListener("click", () => fecharDenuncia());
document.getElementById("denunciaFundo").addEventListener("click", () => fecharDenuncia());

document.getElementById("denunciaCopiar").addEventListener("click", async () => {
    const { assunto, corpo } = mensagemDeDenuncia;
    const texto = `Para: ${EMAIL_DENUNCIA}\r\nAssunto: ${assunto}\r\n\r\n${corpo}`;
    const aviso = document.getElementById("denunciaAviso");
    try {
        await copiarTexto(texto);
        document.getElementById("denunciaCopiarTexto").textContent = "Mensagem copiada ✓";
        aviso.classList.remove("erro");
        aviso.textContent = `Agora cola-a no teu email e envia para ${EMAIL_DENUNCIA}.`;
    } catch (erro) {
        aviso.classList.add("erro");
        aviso.textContent = `Não foi possível copiar. Escreve-nos para ${EMAIL_DENUNCIA}.`;
    }
});

// ==========================================
// 5b. SEPARADOR "COMPARAÇÃO" — proposta face à praça real
// ==========================================

function categoriasDoCatalogo() {
    return [...new Set(Object.values(catalogoItens).map(item => item.categoria).filter(Boolean))];
}

function desenharComparacao(imaginados, originais) {
    const pctReal = percentualPorCategoria(originais);
    const pctProposta = percentualPorCategoria(imaginados);

    // Todas as categorias do catálogo aparecem nas barras, mesmo a 0%:
    // o que falta também é informação. Ordem: o que a proposta mais tem.
    const categorias = [...new Set([
        ...categoriasDoCatalogo(),
        ...Object.keys(originais),
        ...Object.keys(imaginados),
    ])].sort((a, b) =>
        (pctProposta[b] || 0) - (pctProposta[a] || 0) || (pctReal[b] || 0) - (pctReal[a] || 0)
    );

    document.getElementById("compBarras").innerHTML = categorias.map(categoria => {
        const real = Math.round(pctReal[categoria] || 0);
        const proposta = Math.round(pctProposta[categoria] || 0);
        return `
            <div class="comp-barra-linha">
                <span class="comp-barra-nome">${escaparHtml(categoria)}</span>
                <span class="comp-barra-par" aria-hidden="true">
                    <span class="comp-barra comp-barra--real" style="width:${Math.max(real, 1)}%"></span>
                    <span class="comp-barra comp-barra--prop" style="width:${Math.max(proposta, 1)}%"></span>
                </span>
                <span class="comp-barra-txt"><span class="sr-pasta">Praça real </span>${real}% → <span class="sr-pasta">esta proposta </span>${proposta}%</span>
            </div>
        `;
    }).join("");

    const totalReal = totalDeItens(originais);
    const totalProposta = totalDeItens(imaginados);
    const dif = totalProposta - totalReal;
    document.getElementById("compTotal").textContent = `${totalReal} → ${textoItens(totalProposta)}`;
    const difEl = document.getElementById("compTotalDif");
    difEl.textContent = sinalDe(dif);
    difEl.className = "comp-total-dif " + (dif > 0 ? "mais" : dif < 0 ? "menos" : "");

    // Inventário item a item, só com as categorias que têm alguma coisa.
    const comItens = categorias.filter(c => imaginados[c] || originais[c]);
    document.getElementById("modalListaItens").innerHTML = comItens.map(categoria => {
        const daProposta = imaginados[categoria] || {};
        const doReal = originais[categoria] || {};
        const nomes = [...new Set([...Object.keys(daProposta), ...Object.keys(doReal)])]
            .sort((a, b) => (daProposta[b] || 0) - (daProposta[a] || 0) || a.localeCompare(b, "pt"));

        const linhas = nomes.map(nome => {
            const atual = daProposta[nome] || 0;
            const original = doReal[nome] || 0;
            const d = atual - original;
            return `
                <div class="comp-linha">
                    <span class="comp-item"><img src="${escaparHtml(iconeParaItem(nome))}" alt="" width="30" height="30"><span>${escaparHtml(nome)}</span></span>
                    <span class="comp-num"><span class="sr-pasta">Real: </span>${original}</span>
                    <span class="comp-num comp-num--forte"><span class="sr-pasta">Proposta: </span>${atual}</span>
                    <span class="comp-num comp-dif ${d > 0 ? "mais" : d < 0 ? "menos" : ""}"><span class="sr-pasta">Diferença: </span>${sinalDe(d)}</span>
                </div>
            `;
        }).join("");

        return `
            <div class="comp-grupo">
                <div class="comp-grupo-titulo">
                    <span class="comp-grupo-texto">
                        <span class="comp-grupo-nome">${escaparHtml(categoria)}</span>
                        <span class="comp-grupo-pct">real ${Math.round(pctReal[categoria] || 0)}% · proposta ${Math.round(pctProposta[categoria] || 0)}%</span>
                    </span>
                    <span class="comp-colunas" aria-hidden="true"><span>Real</span><span><span class="so-desktop">Proposta</span><span class="so-mobile">Prop.</span></span><span><span class="so-desktop">Diferença</span><span class="so-mobile">Dif.</span></span></span>
                </div>
                ${linhas}
            </div>
        `;
    }).join("") || `<p class="pasta-sub">Nem a praça real nem esta proposta têm itens registados.</p>`;
}

// Resumo no índice da capa: a diferença em si, ex. "+9 itens · mais Paisagem"
// (quantos itens a mais ou a menos e a categoria cujo peso mais cresceu).
function resumoDaComparacao(imaginados, originais) {
    const totalProposta = totalDeItens(imaginados);
    const totalReal = totalDeItens(originais);
    if (!totalProposta && !totalReal) return "Sem itens";

    const dif = totalProposta - totalReal;
    const parteItens = dif === 0
        ? "Mesmo n.º de itens"
        : `${sinalDe(dif)} ${Math.abs(dif) === 1 ? "item" : "itens"}`;

    const pctReal = percentualPorCategoria(originais);
    const pctProposta = percentualPorCategoria(imaginados);
    let maisCresceu = null;
    let maiorSubida = 0;
    Object.keys(pctProposta).forEach(categoria => {
        if (categoria === "Sem categoria") return;
        const subida = pctProposta[categoria] - (pctReal[categoria] || 0);
        if (subida > maiorSubida) {
            maiorSubida = subida;
            maisCresceu = categoria;
        }
    });

    return maisCresceu ? `${parteItens} · mais ${maisCresceu}` : parteItens;
}

// No mobile a ficha do projeto vai para o fim do conteúdo, dentro do scroll,
// para o ecrã não ficar cheio. No desktop volta a ser o rodapé fixo da folha.
(function () {
    const ficha = document.querySelector(".pasta-ficha");
    const scroll = document.querySelector(".pasta-scroll");
    const folha = document.querySelector(".pasta-folha");
    if (!ficha || !scroll || !folha) return;
    const mobile = window.matchMedia("(max-width: 768px)");
    const colocar = () => {
        if (mobile.matches) scroll.appendChild(ficha);
        else folha.appendChild(ficha);
    };
    colocar();
    mobile.addEventListener("change", colocar);
})();

// ==========================================
// 5c. SEPARADOR "REMIXES" — árvore: praça-mãe → esta → remixes → remixes dos remixes
// ==========================================
// Três consultas no máximo (mãe, filhos, netos), feitas uma vez por praça
// aberta. As diferenças entre praças são calculadas aqui no navegador a
// partir do layout_data, sem pedidos extra ao Supabase.

const CAMPOS_DO_RAMO = "id, praca_id, praca_pai_id, titulo, image_topo_url, created_at, layout_data";
let pedidoDeRemixes = 0;
let ramosDaArvore = { mae: null, filhos: [], netos: [] };

// Cada reexportação cria uma linha nova com o mesmo praca_id: fica só a mais recente.
function soAsMaisRecentes(linhas) {
    const vistas = new Set();
    return linhas.filter(linha => {
        if (vistas.has(linha.praca_id)) return false;
        vistas.add(linha.praca_id);
        return true;
    });
}

async function carregarRemixes(praca) {
    const pedido = ++pedidoDeRemixes;
    const arvore = document.getElementById("arvoreRemixes");
    const resumo = document.getElementById("resumoRemixes");
    arvore.innerHTML = "<p class='pasta-sub'>A carregar…</p>";
    resumo.textContent = "…";

    const consultaMae = praca.praca_pai_id && praca.praca_pai_id.trim()
        ? db.from('city_creations').select(CAMPOS_DO_RAMO)
            .eq('praca_id', praca.praca_pai_id)
            .order('created_at', { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [] });

    const consultaFilhos = db.from('city_creations').select(CAMPOS_DO_RAMO)
        .eq('praca_pai_id', praca.praca_id)
        .order('created_at', { ascending: false });

    const [mae, filhos] = await Promise.all([consultaMae, consultaFilhos]);
    if (pedido !== pedidoDeRemixes) return;

    if (filhos.error) {
        console.error("Erro ao carregar remixes:", filhos.error);
        arvore.innerHTML = "<p class='pasta-sub'>Não foi possível carregar os remixes.</p>";
        resumo.textContent = "";
        return;
    }

    const listaFilhos = soAsMaisRecentes((filhos.data || []).filter(f => f.praca_id !== praca.praca_id));

    let netos = [];
    if (listaFilhos.length) {
        const resposta = await db.from('city_creations').select(CAMPOS_DO_RAMO)
            .in('praca_pai_id', listaFilhos.map(f => f.praca_id))
            .order('created_at', { ascending: false });
        if (pedido !== pedidoDeRemixes) return;
        netos = soAsMaisRecentes(resposta.data || []);
    }

    ramosDaArvore = { mae: (mae.data || [])[0] || null, filhos: listaFilhos, netos };

    // Resumo no índice da capa: de onde veio (se for remix) e quantos ramos
    // saíram dela. A praça-mãe não conta como "1 remix" para não confundir.
    const n = listaFilhos.length;
    const doMae = ramosDaArvore.mae ? "rePraça " + ramosDaArvore.mae.id : "";
    if (doMae && n === 0) resumo.textContent = "Remix da " + doMae;
    else if (doMae) resumo.textContent = `Remix da ${ramosDaArvore.mae.id} · ${n === 1 ? "1 remix" : n + " remixes"}`;
    else resumo.textContent = n === 0 ? "Ainda ninguém remixou" : n === 1 ? "1 remix" : n + " remixes";
    desenharArvore();
}

function noDaArvore(linha, { rotulo, tipo, meta = "", comparacao = "", etiquetas = "", abrir = true }) {
    const itens = itensDaLinha(linha);
    const titulo = linha.titulo && linha.titulo.trim() ? " · " + linha.titulo.trim() : "";
    return `
        <div class="arvore-no arvore-no--${tipo}">
            <img src="${escaparHtml(linha.image_topo_url || "")}" alt="" loading="lazy">
            <span class="arvore-textos">
                <span class="arvore-rotulo">${rotulo}</span>
                <span class="arvore-nome">rePraça ${escaparHtml(linha.id)}${escaparHtml(titulo)}</span>
                <span class="arvore-meta">${meta || `${formatarData(linha.created_at)} · ${textoItens(itens.length)}`}</span>
                ${comparacao ? `<span class="arvore-meta">${comparacao}</span>` : ""}
                ${etiquetas ? `<span class="arvore-chips">${etiquetas}</span>` : ""}
            </span>
            ${abrir ? `<a class="arvore-abrir" href="?id=${encodeURIComponent(linha.praca_id)}" data-abrir="${escaparHtml(linha.praca_id)}">Abrir →</a>` : ""}
        </div>
    `;
}

function desenharArvore() {
    const arvore = document.getElementById("arvoreRemixes");
    const atual = estadoPasta.aVer || estadoPasta.atual;
    if (!atual) return;

    const { mae, filhos, netos } = ramosDaArvore;
    const contagemAtual = contagemPorNome(itensDaLinha(atual));
    const antiga = eVersaoAntiga();

    // Esta praça: comparada com a praça-mãe ou, se não for remix, com a praça real.
    const referencia = mae ? contagemPorNome(itensDaLinha(mae)) : (estadoPasta.base.itens || {});
    const itensAtual = itensDaLinha(atual);
    const noAtual = noDaArvore(atual, {
        tipo: "atual",
        rotulo: antiga ? `Estás aqui · versão ${numeroDaVersao(atual)}` : "Estás aqui · versão mais recente",
        meta: `${formatarData(atual.created_at)} · ${textoItens(itensAtual.length)}${itensAtual.length ? " · foco " + escaparHtml(categoriaPredominante(itensAtual)) : ""}`,
        comparacao: mae ? "Face à praça-mãe:" : "Face à praça real:",
        etiquetas: etiquetasDeMudanca(diferencasEntre(contagemAtual, referencia)),
        abrir: false,
    });

    const contagemMaisRecente = contagemPorNome(itensDaLinha(estadoPasta.atual));
    const ramosDosFilhos = filhos.map(filho => {
        const contagemFilho = contagemPorNome(itensDaLinha(filho));
        const seusNetos = netos.filter(neto => neto.praca_pai_id === filho.praca_id);
        const ramosDosNetos = seusNetos.length ? `
            <ul class="arvore-filhos">
                ${seusNetos.map(neto => `
                    <li class="arvore-item">${noDaArvore(neto, {
                        tipo: "remix",
                        rotulo: "Remix de um remix",
                        etiquetas: etiquetasDeMudanca(diferencasEntre(contagemPorNome(itensDaLinha(neto)), contagemFilho), { maximo: 3 }),
                    })}</li>
                `).join("")}
            </ul>` : "";
        return `
            <li class="arvore-item">${noDaArvore(filho, {
                tipo: "remix",
                rotulo: "Remix",
                etiquetas: etiquetasDeMudanca(diferencasEntre(contagemFilho, contagemMaisRecente), { maximo: 3 }),
            })}${ramosDosNetos}</li>
        `;
    }).join("");

    // Convite a abrir um ramo novo (só na versão atual, a única remixável).
    const ramoNovo = antiga ? "" : `
        <li class="arvore-item">
            <a class="arvore-no arvore-novo" href="${LINK_REMIX + encodeURIComponent(estadoPasta.atual.praca_id)}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                <span class="arvore-textos">
                    <span class="arvore-nome">Faz o teu remix</span>
                    <span class="arvore-meta">${filhos.length ? "Cria um novo ramo a partir desta praça" : "Ainda ninguém reimaginou esta praça. Sê a primeira pessoa!"}</span>
                </span>
            </a>
        </li>`;

    const ramosDaAtual = (ramosDosFilhos || ramoNovo) ? `<ul class="arvore-filhos">${ramosDosFilhos}${ramoNovo}</ul>` : "";
    const itemAtual = `<li class="arvore-item">${noAtual}${ramosDaAtual}</li>`;

    arvore.innerHTML = mae
        ? `<ul class="arvore-raiz"><li class="arvore-item">${noDaArvore(mae, { tipo: "mae", rotulo: "Praça-mãe" })}<ul class="arvore-filhos">${itemAtual}</ul></li></ul>`
        : `<ul class="arvore-raiz">${itemAtual}</ul>`;
}

document.getElementById("arvoreRemixes").addEventListener("click", evento => {
    const link = evento.target.closest("[data-abrir]");
    if (!link) return;
    evento.preventDefault();
    abrirPraca(link.dataset.abrir);
});

// ==========================================
// 5d. SEPARADOR "HISTÓRICO" — versões do mesmo praca_id
// ==========================================
// Cada versão abre na própria pasta (com um aviso azul em cima). O reMixar
// fica desligado nas versões antigas porque a app só sabe abrir o praca_id,
// que leva sempre à versão mais recente.

function desenharHistorico() {
    const versoes = estadoPasta.versoes;
    const total = versoes.length;
    document.getElementById("resumoHistorico").textContent = total === 1 ? "Versão única" : total + " versões";

    document.getElementById("listaHistorico").innerHTML = versoes.map((linha, indice) => {
        const anterior = versoes[indice + 1];
        const itens = itensDaLinha(linha);
        const data = formatarData(linha.created_at);
        let variacao = "(início)";
        let mudancas = `<span class="hist-primeira">Primeira exportação desta proposta.</span>`;
        if (anterior) {
            const dif = itens.length - itensDaLinha(anterior).length;
            variacao = dif === 0 ? "(igual)" : `(${sinalDe(dif)})`;
            mudancas = etiquetasDeMudanca(
                diferencasEntre(contagemPorNome(itens), contagemPorNome(itensDaLinha(anterior))),
                { comIcone: true, maximo: 5 }
            );
        }
        return `
            <li class="hist-item${indice === 0 ? " hist-item--atual" : ""}">
                <button type="button" class="hist-cartao" data-versao="${indice}" aria-pressed="false">
                    <img src="${escaparHtml(linha.image_topo_url || "")}" alt="Planta da versão de ${escaparHtml(data)}" loading="lazy">
                    <span class="hist-textos">
                        <span class="hist-topo">
                            <span class="hist-data">${escaparHtml(data)}</span>
                            ${indice === 0 ? `<span class="hist-tag">Atual</span>` : ""}
                            <span class="hist-num">Versão ${total - indice}</span>
                            <span class="hist-tag hist-tag--aver">A ver</span>
                            <span class="hist-itens">${textoItens(itens.length)} <span>${variacao}</span></span>
                        </span>
                        <span class="hist-chips">${mudancas}</span>
                    </span>
                </button>
            </li>
        `;
    }).join("");

    marcarVersaoAVer();
}

function marcarVersaoAVer() {
    document.querySelectorAll("#listaHistorico .hist-cartao").forEach(botao => {
        const aVer = estadoPasta.versoes[Number(botao.dataset.versao)] === estadoPasta.aVer;
        botao.classList.toggle("a-ver", aVer);
        botao.setAttribute("aria-pressed", aVer);
    });
    // A árvore mostra a versão que está aberta.
    if (document.querySelector("#arvoreRemixes .arvore-raiz")) desenharArvore();
}

document.getElementById("listaHistorico").addEventListener("click", evento => {
    const botao = evento.target.closest(".hist-cartao");
    if (!botao) return;
    const linha = estadoPasta.versoes[Number(botao.dataset.versao)];
    if (!linha) return;
    mostrarVersao(linha);
    trocarAba("capa");
});


// ==========================================
// 6. SISTEMA DE LIKES
// ==========================================

const btnLike = document.getElementById("btnLikeModal");

function verificarStatusDoLike(id, totalLikes) {
    document.getElementById("modalLikesCount").innerText = totalLikes;
    btnLike.classList.remove("animar"); // 1. Reseta a animação ao abrir qualquer praça

    if (localStorage.getItem("liked_" + id)) {
        btnLike.classList.add("curtido");
        btnLike.setAttribute("aria-pressed", "true");
        btnLike.disabled = true;
    } else {
        btnLike.classList.remove("curtido");
        btnLike.setAttribute("aria-pressed", "false");
        btnLike.disabled = false;
        btnLike.onclick = () => enviarLikeParaSupabase(id);
    }
}

async function enviarLikeParaSupabase(id) {
    const contador = document.getElementById("modalLikesCount");
    const totalAntes = parseInt(contador.innerText) || 0;

    // O botão muda logo para "gostado" (cor, número e dancinha) e só volta
    // atrás se o pedido falhar — assim não fica um estado intermédio esbatido.
    btnLike.disabled = true;
    btnLike.classList.add("animar", "curtido");
    btnLike.setAttribute("aria-pressed", "true");
    contador.innerText = totalAntes + 1;

    const { error } = await db.rpc('dar_like', { id_praca: id });

    if (!error) {
        localStorage.setItem("liked_" + id, "true");
    } else {
        btnLike.classList.remove("animar", "curtido");
        btnLike.setAttribute("aria-pressed", "false");
        contador.innerText = totalAntes;
        btnLike.disabled = false;
        alert("Erro ao registar o gosto!");
    }
}

// ==========================================
// 7. INICIALIZAÇÃO
// ==========================================
// Primeiro carrega itens.json, depois monta o filtro, só então abre a
// galeria — assim itens.json é baixado UMA VEZ por carregamento da página.

async function iniciarGaleria() {
    await carregarCatalogoItens();
    preencherFiltroDeItens();
    preencherFiltroDeCategorias();

    if (slugPracaAtual) {
        await carregarEstatisticasDaPraca(slugPracaAtual, itensOriginaisEmbutidos());
    }

    lidarComNavegacao();
    carregarPracas();
}

iniciarGaleria();
