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

// Um Chart.js por canvas — hoje só existe #radarPraca (dentro do popup),
// mas a página de uma praça-base tem um segundo radar (#radarComparativoPraca)
// comparando original vs. média de todas as reimaginações, então precisa
// de mais de uma instância viva ao mesmo tempo.
const graficosRadar = {};

// Cores lidas do CSS uma única vez (o valor não muda em runtime).
const coresGrafico = (() => {
    const estilo = getComputedStyle(document.documentElement);
    return {
        verde: estilo.getPropertyValue("--verde").trim(),
        terracota: estilo.getPropertyValue("--terracota").trim(),
        bege: estilo.getPropertyValue("--bege").trim(),
    };
})();

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
        labelComparacao = "Sua praça",
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

    const categorias = [...new Set([
        ...Object.keys(dadosOriginais),
        ...Object.keys(dadosImaginados),
    ])];

    const percentuaisOriginais = percentualPorCategoria(dadosOriginais);
    const percentuaisImaginados = percentualPorCategoria(dadosImaginados);

    // Integra visualmente o bloco do gráfico ao painel azul-marinho
    const radarContainer = canvas.closest(".radar-container");
    if (radarContainer) {
        Object.assign(radarContainer.style, {
            background: "rgba(255, 255, 255, 0.035)",
            border: "1px solid rgba(249, 239, 231, 0.08)",
            borderRadius: "16px",
            padding: "8px",
            boxSizing: "border-box",
        });
    }

    const { verde: corVerde, terracota: corTerracota, bege: corBege } = coresGrafico;
    const fonteBase = { family: "Cabin" };

    // Plugin próprio: desenha "original% / sua praça%" em cores separadas
    // (terracota / verde) logo além do rótulo de cada categoria — o
    // Chart.js não suporta cor por trecho dentro de um rótulo, então
    // isto é desenhado manualmente por cima do gráfico já pronto.
    //
    // NOTA: 34 é uma distância estimada além do nome da categoria — não
    // dá pra testar isto sem renderizar de verdade, então é bem provável
    // que precise ajustar esse número depois de ver ao vivo no site.
    const DISTANCIA_EXTRA_VALORES = 32;

    const valoresColoridosPlugin = {
    id: 'valoresColoridos',
    afterDraw(chart) {
        const escala = chart.scales.r;
        if (!escala) return;

        const { ctx } = chart;

        ctx.save();
        ctx.textBaseline = "top";
        ctx.font = "bold 12px Cabin";

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

            // Obtém as coordenadas exatas do rótulo da categoria desenhado pelo Chart.js
            const labelItem = escala._pointLabelItems?.[index];

            let posX, posY;
            if (labelItem) {
                // Centraliza horizontalmente com o texto do título e posiciona logo abaixo dele
                posX = (labelItem.left + labelItem.right) / 2;
                posY = labelItem.bottom + 4; // Distância (em px) abaixo do título
            } else {
                // Fallback caso a propriedade interna não esteja disponível
                const pos = escala.getPointPosition(index, escala.drawingArea + 36);
                posX = pos.x;
                posY = pos.y + 14;
            }

            let cursorX = posX - larguraTotal / 2;

            ctx.textAlign = "left";

            ctx.fillStyle = corTerracota;
            ctx.fillText(textoOriginal, cursorX, posY);
            cursorX += larguraOriginal;

            ctx.fillStyle = corBege;
            ctx.fillText(textoBarra, cursorX, posY);
            cursorX += larguraBarra;

            ctx.fillStyle = corVerde;
            ctx.fillText(textoImaginada, cursorX, posY);
        });

        ctx.restore();
    },
};

//Espaço ABAIXO da legenda do radar
// const espacamentoLegendaPlugin = {
//     id: 'espacamentoLegenda',
//     beforeInit(chart) {
//         const fitOriginal = chart.legend.fit;
//         chart.legend.fit = function fit() {
//             fitOriginal.bind(chart.legend)();
//             this.height += 16; // Ajuste aqui: quanto maior o número, mais o gráfico desce
//         };
//     },
// };

//Espaço ACIMA da legenda - pra quando a legenda estiver no bottom
const espacamentoLegendaPlugin = {
    id: 'espacamentoLegenda',
    beforeInit(chart) {
        const fitOriginal = chart.legend.fit;
        chart.legend.fit = function fit() {
            fitOriginal.bind(chart.legend)();
            this.height += 32; // 1. Reserva o espaço extra no layout
        };
    },
    afterLayout(chart) {
        if (chart.legend && chart.legend.options.position === 'bottom') {
            chart.legend.top += 32; // 2. Desloca a legenda para baixo, deixando o vão no topo
        }
    }
};

    graficosRadar[canvasId] = new Chart(canvas, {
        plugins: [valoresColoridosPlugin, espacamentoLegendaPlugin],
        type: "radar",
        data: {
            labels: categorias,
            datasets: [
                {
                    label: labelOriginal,
                    data: categorias.map(c => percentuaisOriginais[c] || 0),
                    borderColor: corTerracota,
                    backgroundColor: "rgba(183, 111, 81, 0.14)",
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: corTerracota,
                    pointHoverBorderColor: corBege,
                },
                {
                    label: labelComparacao,
                    data: categorias.map(c => percentuaisImaginados[c] || 0),
                    borderColor: corVerde,
                    backgroundColor: "rgba(152, 171, 86, 0.18)",
                    borderWidth: 2.5,
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
            // padding interna do canvas do grafico
            layout: { padding: { top: 6, right: 24, bottom: 0, left: 24 } },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    beginAtZero: true,
                    // Só mostra 25/50/75/100% — o 0% fica escondido pra não
                    // competir visualmente com o centro do gráfico.
                    ticks: {
                        display: false,
                        stepSize: 25,
                        color: "rgba(249, 239, 231, 0.72)",
                        font: { ...fonteBase, size: 10, weight: "500" },
                        backdropColor: "transparent",
                        showLabelBackdrop: false,
                        padding: 2,
                        callback: valor => (valor === 0 ? "" : valor + "%"),
                    },
                    grid: { color: "rgba(249, 239, 231, 0.3)", lineWidth: 1 },
                    angleLines: { color: "rgba(249, 239, 231, 0.11)", lineWidth: 1 },
                    pointLabels: {
                        color: corBege,
                        padding: 14,
                        font: { ...fonteBase, size: 14, weight: "400" },
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: {
                        color: corBege,
                        padding: 22,
                        usePointStyle: true,
                        pointStyle: "rectRounded",
                        boxWidth: 18,
                        boxHeight: 10,
                        font: { ...fonteBase, size: 14, weight: "400" },
                    },
                },
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
}

// Lista comparativa por item, ex:
// "Banco de Madeira — Na sua praça: 5, Original: 2, +3"
// Reaproveitada tanto no popup (comparando 1 criação com o original) quanto
// no cabeçalho da página de uma praça-base (comparando a MÉDIA com o original).
function criarListaComparativa(dadosImaginados, dadosOriginais, opcoes = {}) {
    const { containerId = "modalListaItens", rotuloComparacao = "Na sua praça" } = opcoes;

    const lista = document.getElementById(containerId);
    if (!lista) return;

    lista.innerHTML = "";

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
        grupo.appendChild(titulo);

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
                    <span><small>${rotuloComparacao}</small><strong>${quantidadeAtual}</strong></span>
                    <span><small>Original</small><strong>${quantidadeOriginal}</strong></span>
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
        labelComparacao: "Média das reimaginações",
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

const gallery = document.getElementById("gallery");
const popup = document.getElementById("popup");
const loader = document.getElementById("fim-da-pagina");

async function carregarPracas() {
    if (carregando || chegouAoFim) return;

    const elOrdem = document.getElementById("filtroOrdem");
    if (!elOrdem) return; // página sem grade de galeria (ex.: hub /galeria/)

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
    let colunas = 'praca_id, image_topo_url, created_at, likes, total_objects, praca_pai_id';
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
        loader.innerText = "Não foi possível carregar a galeria. Tente novamente mais tarde.";
        carregando = false;
        return;
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

    desenharCards(pracasParaMostrar);
    totalCardsRenderados += pracasParaMostrar.length;
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
}

function desenharCards(pracas) {
    pracas.forEach(praca => {
        const dataFormatada = new Date(praca.created_at).toLocaleDateString('pt-PT');

        // Selo de "remix" só aparece quando a praça nasceu de outra —
        // mesma coluna usada pelo filtro "Só remixes" acima.
        const ehRemix = praca.praca_pai_id && praca.praca_pai_id.trim() !== "";
        const seloRemix = ehRemix ? '<span class="card-remix-badge">↻ remix</span>' : '';

        const card = document.createElement("div");
        card.className = "card-praca";
        card.innerHTML = `
            ${seloRemix}
            <img src="${praca.image_topo_url}" class="card-img" loading="lazy" alt="Praça">
            <div class="card-info">
                <span class="card-data">${dataFormatada}</span>
                
                <span class="card-likes">
                    ${praca.likes || 0}
                    <img src="/img/icone-coracao.svg" height="20"> 
                </span>
            </div>
        `;

        card.addEventListener("click", () => abrirPraca(praca.praca_id));
        gallery.appendChild(card);
    });
}

// Aviso de "filtros não bateram com nada" — só acontece quando a busca
// chega ao fim SEM ter mostrado nenhum card desde o último reset. Dá um
// jeito fácil de sair dessa situação (limpar tudo) em vez de deixar a
// pessoa mexendo filtro por filtro tentando adivinhar qual está travando.
function mostrarAvisoSemResultados() {
    loader.innerHTML = `
        Nenhuma praça com essa combinação ainda. Que tal ser o primeiro a criar?
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
        Chegou ao fim das rePraças!
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
function abrirPraca(id) {
    history.pushState({}, "", "?id=" + id);
    lidarComNavegacao();
}

// Usado sempre que o popup fecha (botão X, clique fora, erro ao carregar).
function fecharPraca() {
    history.pushState({}, "", window.location.pathname);
    lidarComNavegacao();
}

// popstate cobre o botão voltar/avançar do navegador (pushState não
// dispara isso sozinho, só a navegação por histórico dispara).
window.addEventListener("popstate", lidarComNavegacao);

async function lidarComNavegacao() {
    const id = pegarIdDaUrl();

    if (!id) {
        popup.classList.add("escondido");
        document.body.style.overflow = "auto";
        return;
    }

    document.getElementById("modalTitulo").innerText = "A carregar dados...";
    popup.classList.remove("escondido");
    document.body.style.overflow = "hidden";

    // NOTA: .eq('praca_id', id).single() quebrava assim que o mesmo
    // praca_id passasse a ter mais de uma linha (cada edição salva de
    // novo). Buscamos sempre a versão mais recente.
    const { data, error } = await db
        .from('city_creations')
        .select('*')
        .eq('praca_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error("Erro ao carregar praça:", error);
        alert("Erro ao carregar a praça.");
        fecharPraca();
        return;
    }

    if (data) {
        await preencherModal(data);
    } else {
        alert("Praça não encontrada!");
        fecharPraca();
    }
}

document.getElementById("btnFecharModal").addEventListener("click", fecharPraca);
popup.addEventListener("click", e => {
    if (e.target === popup) fecharPraca();
});

// ==========================================
// 5. PREENCHER O MODAL
// ==========================================

let pracaAbertaId = null;

async function preencherModal(praca) {
    pracaAbertaId = praca.praca_id;

    // --- Imagens: abre sempre na vista de topo ---
    const imgEl = document.getElementById("selectedImage");
    const btnTopo = document.getElementById("btnVistaTopo");
    const btnAngulo = document.getElementById("btnVistaAngulo");

    imgEl.src = praca.image_topo_url;
    btnTopo.classList.add("ativo");
    btnAngulo.classList.remove("ativo");

    btnTopo.onclick = () => {
        imgEl.src = praca.image_topo_url;
        btnTopo.classList.add("ativo");
        btnAngulo.classList.remove("ativo");
    };
    btnAngulo.onclick = () => {
        imgEl.src = praca.image_url;
        btnAngulo.classList.add("ativo");
        btnTopo.classList.remove("ativo");
    };

    document.getElementById("btnRemix").href =
        "https://feliperpv.com/repraca/galeria/abrir-app/?id=" + praca.praca_id;

    // --- Dados da praça imaginada ---
    const jsonConvertido = JSON.parse(praca.layout_data);
    const itens = jsonConvertido.layoutDaPraca || [];

    // "mapaId" (ex: "barao-de-corumba") é o identificador estável que liga
    // essa criação à praça-base certa — bate com o nome do arquivo em
    // dados/pracas/*.json. "nomeDaCena" é só o nome de exibição; não dá
    // mais pra usar a coluna nome_da_cena da linha pra isso (agora é
    // sempre "Jogo", já que todas as praças carregam a mesma cena de UI).
    const slugBase = jsonConvertido.mapaId || "";
    const nomeBase = jsonConvertido.nomeDaCena || "";

    const itensPorCategoria = contarItensImaginados(itens);
    const dadosPracaOriginal = await carregarDadosDaPraca(slugBase);
    const itensOriginais = organizarItensOriginais(dadosPracaOriginal.itens || {});

    desenharRadar(itensOriginais, itensPorCategoria);
    criarListaComparativa(itensPorCategoria, itensOriginais);

    // "rePraça {numero}" = id da LINHA na tabela (não o praca_id, que é o UUID)
    document.getElementById("modalNumero").innerText = "rePraça " + praca.id;

    // Título = o nome que o criador deu à própria criação; se não tiver
    // (linhas antigas sem esse campo), cai pro nome da praça-base.
    const titulo = (praca.titulo && praca.titulo.trim()) ? praca.titulo : (nomeBase || "Praça Personalizada");
    document.getElementById("modalTitulo").innerText = titulo;

    const baseadoEmEl = document.getElementById("modalBaseadoEm");
    if (nomeBase && nomeBase !== titulo) {
        baseadoEmEl.innerText = "baseado em: " + nomeBase;
        baseadoEmEl.style.display = "";
    } else {
        baseadoEmEl.style.display = "none";
    }

    document.getElementById("modalData").innerText =
        "Última edição: " + praca.created_at.substring(0, 10).split('-').reverse().join('/');
    document.getElementById("modalTotalItens").innerText = praca.total_objects;

    // Foco = categoria com mais itens na praça imaginada (mesma conta do filtro "Foco principal" da galeria)
    document.getElementById("modalCategoria").innerText = categoriaPredominante(itens);

    const comentarioEl = document.getElementById("modalComentario");
    if (praca.comentario && praca.comentario.trim()) {
        comentarioEl.innerText = praca.comentario;
        comentarioEl.style.display = "";
    } else {
        comentarioEl.style.display = "none";
    }

    verificarStatusDoLike(praca.praca_id, praca.likes || 0);

    trocarAba("itens"); // sempre volta pra aba "itens" ao abrir uma praça
    carregarRemixes(praca.praca_id);
    carregarHistorico(praca.praca_id, praca.id);
}

// ==========================================
// 5b. ABAS (itens / remixes / histórico)
// ==========================================

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => trocarAba(btn.dataset.tab));
});

function trocarAba(nomeAba) {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("ativo", btn.dataset.tab === nomeAba);
    });
    document.querySelectorAll(".tab-painel").forEach(painel => painel.classList.remove("ativo"));

    const painel = document.getElementById("painel" + nomeAba.charAt(0).toUpperCase() + nomeAba.slice(1));
    if (painel) painel.classList.add("ativo");

    document.querySelector(".tabs-conteudo").className = "tabs-conteudo tabs-conteudo--" + nomeAba;
}

// ==========================================
// 5c. ABA "REMIXES" — criações filhas desta praça
// ==========================================

async function carregarRemixes(pracaId) {
    const container = document.getElementById("listaRemixes");
    container.innerHTML = "<p class='texto-dica'>A carregar...</p>";

    const { data, error } = await db
        .from('city_creations')
        .select('praca_id, image_topo_url, created_at')
        .eq('praca_pai_id', pracaId)
        .order('created_at', { ascending: false });

    if (error) {
        container.innerHTML = "<p class='texto-dica'>Não foi possível carregar os remixes.</p>";
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="remix-vazio">
                Ninguém reimaginou esta praça ainda.<br/>
                <a href="https://feliperpv.com/repraca/galeria/abrir-app/?id=${pracaId}">Seja o primeiro a remixar →</a>
            </div>
        `;
        return;
    }

    container.innerHTML = "";
    data.forEach(filho => {
        const linha = document.createElement("div");
        linha.className = "remix-card";
        linha.innerHTML = `
            <span>${new Date(filho.created_at).toLocaleDateString('pt-PT')}</span>
            <img src="${filho.image_topo_url}" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">
        `;
        linha.addEventListener("click", () => abrirPraca(filho.praca_id));
        container.appendChild(linha);
    });
}

// ==========================================
// 5d. ABA "HISTÓRICO" — versões anteriores do mesmo praca_id
// ==========================================
// NOTA: listo as versões antigas só como informação (data + número da
// linha) — não abrem, porque a navegação por hash hoje é pelo praca_id
// (igual em todas as versões). Pra tornar isso navegável precisaria mudar
// como a URL identifica a praça.

async function carregarHistorico(pracaId, idAtual) {
    const abaBtn = document.getElementById("btnTabHistorico");
    const container = document.getElementById("listaHistorico");

    const { data, error } = await db
        .from('city_creations')
        .select('id, created_at')
        .eq('praca_id', pracaId)
        .order('created_at', { ascending: false });

    if (error || !data || data.length <= 1) {
        // Sem edições anteriores — some com a aba (mas "remixes" continua ali)
        abaBtn.style.display = "none";
        if (abaBtn.classList.contains("ativo")) trocarAba("itens");
        return;
    }

    abaBtn.style.display = "";
    container.innerHTML = "";
    data.forEach(versao => {
        const linha = document.createElement("div");
        linha.className = "historico-linha";
        linha.innerHTML = `
            <span>${new Date(versao.created_at).toLocaleDateString('pt-PT')}</span>
            <span>${versao.id === idAtual ? "atual" : "rePraça " + versao.id}</span>
        `;
        container.appendChild(linha);
    });
}


// ==========================================
// 6. SISTEMA DE LIKES
// ==========================================

const btnLike = document.getElementById("btnLikeModal");

function verificarStatusDoLike(id, totalLikes) {
    document.getElementById("modalLikesCount").innerText = totalLikes;
    btnLike.classList.remove("animar"); // 1. Reseta a animação ao abrir qualquer praça

    if (localStorage.getItem("liked_" + id)) {
        btnLike.classList.add("curtido");
        btnLike.disabled = true;
    } else {
        btnLike.classList.remove("curtido");
        btnLike.disabled = false;
        btnLike.onclick = () => enviarLikeParaSupabase(id);
    }
}

async function enviarLikeParaSupabase(id) {
    btnLike.disabled = true;
    btnLike.classList.add("animar"); // 2. Dispara a dancinha imediatamente ao clicar

    const { error } = await db.rpc('dar_like', { id_praca: id });

    if (!error) {
        const contador = document.getElementById("modalLikesCount");
        contador.innerText = parseInt(contador.innerText) + 1;
        btnLike.classList.add("curtido");
        localStorage.setItem("liked_" + id, "true");
    } else {
        btnLike.classList.remove("animar"); // 3. Remove a animação caso ocorra erro
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