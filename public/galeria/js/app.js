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
    const DISTANCIA_EXTRA_VALORES = 34;

    const valoresColoridosPlugin = {
        id: 'valoresColoridos',
        afterDraw(chart) {
            const escala = chart.scales.r;
            if (!escala) return;

            const { ctx } = chart;
            const centroX = escala.xCenter;

            ctx.save();
            ctx.textBaseline = "middle";
            ctx.font = "bold 12px Cabin";

            categorias.forEach((_, index) => {
                const distancia = escala.drawingArea + DISTANCIA_EXTRA_VALORES;
                const { x, y } = escala.getPointPosition(index, distancia);

                const original = Math.round(percentuaisOriginais[categorias[index]] || 0);
                const imaginada = Math.round(percentuaisImaginados[categorias[index]] || 0);

                const textoOriginal = `${original}%`;
                const textoBarra = " / ";
                const textoImaginada = `${imaginada}%`;

                const larguraTotal = ctx.measureText(textoOriginal).width
                    + ctx.measureText(textoBarra).width
                    + ctx.measureText(textoImaginada).width;

                // Mesma lógica de alinhamento que o Chart.js usa pros
                // rótulos: centralizado no topo/base, alinhado à direita
                // do lado esquerdo do círculo, à esquerda do lado direito.
                let cursorX;
                if (x < centroX - 1) cursorX = x - larguraTotal;
                else if (x > centroX + 1) cursorX = x;
                else cursorX = x - larguraTotal / 2;

                ctx.textAlign = "left";

                ctx.fillStyle = corTerracota;
                ctx.fillText(textoOriginal, cursorX, y);
                cursorX += ctx.measureText(textoOriginal).width;

                ctx.fillStyle = corBege;
                ctx.fillText(textoBarra, cursorX, y);
                cursorX += ctx.measureText(textoBarra).width;

                ctx.fillStyle = corVerde;
                ctx.fillText(textoImaginada, cursorX, y);
            });

            ctx.restore();
        },
    };

    graficosRadar[canvasId] = new Chart(canvas, {
        plugins: [valoresColoridosPlugin],
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
            layout: { padding: { top: 4, right: 24, bottom: 12, left: 24 } },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    beginAtZero: true,
                    // Só mostra 25/50/75/100% — o 0% fica escondido pra não
                    // competir visualmente com o centro do gráfico.
                    ticks: {
                        stepSize: 25,
                        color: "rgba(249, 239, 231, 0.72)",
                        font: { ...fonteBase, size: 10, weight: "500" },
                        backdropColor: "transparent",
                        showLabelBackdrop: false,
                        padding: 2,
                        callback: valor => (valor === 0 ? "" : valor + "%"),
                    },
                    grid: { color: "rgba(249, 239, 231, 0.14)", lineWidth: 1 },
                    angleLines: { color: "rgba(249, 239, 231, 0.11)", lineWidth: 1 },
                    pointLabels: {
                        color: corBege,
                        padding: 14,
                        font: { ...fonteBase, size: 12, weight: "600" },
                    },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    position: "top",
                    labels: {
                        color: corBege,
                        padding: 8,
                        usePointStyle: true,
                        pointStyle: "rectRounded",
                        boxWidth: 18,
                        boxHeight: 7,
                        font: { ...fonteBase, size: 11, weight: "600" },
                    },
                },
                tooltip: {
                    backgroundColor: "rgba(19, 28, 59, 0.96)",
                    titleColor: corBege,
                    bodyColor: corBege,
                    borderColor: "rgba(249, 239, 231, 0.25)",
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { ...fonteBase, weight: "600" },
                    bodyFont: { ...fonteBase, size: 12 },
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

    const inicio = paginaAtual * itensPorPagina;
    const fim = inicio + itensPorPagina - 1;

    // Quando filtra por item específico, chamamos uma função SQL (RPC) em
    // vez de montar o filtro com .ilike() direto no client — o Postgres
    // exige um cast (layout_data::text) pra comparar jsonb com ilike, e
    // esse cast não é repassado corretamente pelos filtros do PostgREST
    // client-side. A função SQL já faz esse cast por dentro (veja
    // filtrar_pracas_por_item.sql).
    const colunas = 'praca_id, image_topo_url, created_at, likes, total_objects';
    let query = itemEspecifico !== "todos"
        ? db.rpc('filtrar_pracas_por_item', { item_nome: itemEspecifico }).select(colunas)
        : db.from('city_creations').select(colunas);

    query = query.gte('total_objects', minItens);
    if (slugPracaAtual) query = query.eq('mapa_id', slugPracaAtual);

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

    if (data.length < itensPorPagina) {
        chegouAoFim = true;
        loader.innerText = "Chegou ao fim da galeria!";
    }

    desenharCards(data);
    paginaAtual++;
    carregando = false;
}

function desenharCards(pracas) {
    pracas.forEach(praca => {
        const dataFormatada = new Date(praca.created_at).toLocaleDateString('pt-PT');

        const card = document.createElement("div");
        card.className = "card-praca";
        card.innerHTML = `
            <img src="${praca.image_topo_url}" class="card-img" loading="lazy" alt="Praça">
            <div class="card-info">
                <span class="card-data">📅 ${dataFormatada}</span>
                <span class="card-likes">❤️ ${praca.likes || 0}</span>
            </div>
        `;

        card.addEventListener("click", () => abrirPraca(praca.praca_id));
        gallery.appendChild(card);
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
    loader.innerText = "A carregar mais praças...";
    carregarPracas();
}

document.getElementById("filtroOrdem")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroItens")?.addEventListener("change", aplicarFiltros);
document.getElementById("filtroEspecifico")?.addEventListener("change", aplicarFiltros);

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

    // Foco = categoria com mais itens na praça imaginada
    let categoriaPrincipal = "Mista";
    let max = 0;
    for (let cat in itensPorCategoria) {
        const totalNaCategoria = Object.values(itensPorCategoria[cat]).reduce((a, b) => a + b, 0);
        if (totalNaCategoria > max) {
            max = totalNaCategoria;
            categoriaPrincipal = cat;
        }
    }
    document.getElementById("modalCategoria").innerText = categoriaPrincipal;

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

    const { error } = await db.rpc('dar_like', { id_praca: id });

    if (!error) {
        const contador = document.getElementById("modalLikesCount");
        contador.innerText = parseInt(contador.innerText) + 1;
        btnLike.classList.add("curtido");
        localStorage.setItem("liked_" + id, "true");
    } else {
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

    if (slugPracaAtual) {
        await carregarEstatisticasDaPraca(slugPracaAtual, itensOriginaisEmbutidos());
    }

    lidarComNavegacao();
    carregarPracas();
}

iniciarGaleria();