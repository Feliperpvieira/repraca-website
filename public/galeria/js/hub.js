// ==========================================
// HUB DA GALERIA (/galeria/)
// ==========================================
// Corre DEPOIS do app.js (ver a opção "scripts" do GaleriaLayout) e usa
// as funções e variáveis dele, em vez de as copiar:
//   db, catalogoItens, carregarCatalogoItens, itensDaLinha,
//   contagemPorNome, diferencasEntre, etiquetasDeMudanca, escaparHtml,
//   formatarData, abrirPraca, lerLayout.
// O HTML (cartões, linhas, faixas) é escrito pelo Astro; aqui só se
// copia <template> e se preenche. Nada de IA: todos os textos saem de
// comparar as contagens de itens.

(() => {
    const elDados = document.getElementById("dados-hub");
    if (!elDados) return;

    let pracas = [];
    try {
        pracas = JSON.parse(elDados.textContent);
    } catch (erro) {
        console.warn("dados-hub inválido:", erro);
        return;
    }
    const pracaPorSlug = Object.fromEntries(pracas.map(p => [p.slug, p]));

    const COLUNAS_RESUMO = "praca_id, mapa_id, praca_pai_id, likes, created_at, image_topo_url";
    const COLUNAS_PLANTAS = COLUNAS_RESUMO + ", layout_data";

    const NUM_IDEIAS = 7;
    const MIN_IDEIAS = 3;
    const DIAS_RECENTES = 30;
    const MIN_RECENTES = 14;      // menos do que isto nos últimos 30 dias...
    const RESERVA_RECENTES = 40;  // ...e usam-se as 40 mais recentes
    const LIMITE_MONOTEMA = 0.6;  // um só tipo de item acima de 60% do total
    const PESO_MONOTEMA = 1 / 3;
    const NUM_CONVERSAS = 6;
    const RAMOS_POR_CONVERSA = 3;

    // ------------------------------------------
    // Utilitários
    // ------------------------------------------

    const ehRemix = linha => Boolean(linha.praca_pai_id && linha.praca_pai_id.trim() !== "");

    // As reexportações repetem o praca_id: fica só a linha mais recente.
    // As linhas chegam ordenadas da mais recente para a mais antiga.
    function juntarVersoes(linhas) {
        const vistos = new Set();
        return linhas.filter(linha => {
            if (vistos.has(linha.praca_id)) return false;
            vistos.add(linha.praca_id);
            return true;
        });
    }

    function plural(n, um, varios) {
        return `${n} ${n === 1 ? um : varios}`;
    }

    // Linhas cuja planta não se leu contariam como "tiraram tudo" e
    // pareceriam muito diferentes: ficam fora das faixas.
    const temPlanta = linha => Array.isArray(lerLayout(linha).layoutDaPraca);

    function nomeNoPlural(nomeItem) {
        return catalogoItens[nomeItem]?.plural || nomeItem.toLowerCase();
    }

    function diferencasDeHoje(linha) {
        const hoje = pracaPorSlug[linha.mapa_id]?.itens || {};
        return diferencasEntre(contagemPorNome(itensDaLinha(linha)), hoje);
    }

    // Quanto a proposta se afasta da praça real: a soma das diferenças
    // item a item (+3 palmeiras e −1 banco dá 4).
    function divergencia(linha) {
        return diferencasDeHoje(linha).reduce((soma, d) => soma + Math.abs(d.dif), 0);
    }

    // A "praça meme" (um coração de cestas de basquete) é quase só um
    // tipo de item. Não sai do sorteio, só aparece menos.
    function pesoNoSorteio(linha) {
        const contagem = Object.values(contagemPorNome(itensDaLinha(linha)));
        const total = contagem.reduce((a, b) => a + b, 0);
        if (total < 5) return 1;
        return Math.max(...contagem) / total > LIMITE_MONOTEMA ? PESO_MONOTEMA : 1;
    }

    // Sorteio com pesos, sem repetir.
    function sortearComPeso(itens, quantos, peso) {
        const resto = itens.map(item => ({ item, peso: peso(item) }));
        const escolhidos = [];
        while (escolhidos.length < quantos && resto.length) {
            const total = resto.reduce((soma, r) => soma + r.peso, 0);
            let alvo = Math.random() * total;
            const i = resto.findIndex(r => (alvo -= r.peso) <= 0);
            escolhidos.push(resto.splice(i === -1 ? resto.length - 1 : i, 1)[0].item);
        }
        return escolhidos;
    }

    // "Começou com mais palmeiras e menos bancos de madeira."
    function fraseDeInicio(original) {
        const difs = diferencasDeHoje(original);
        const mais = difs.filter(d => d.dif > 0).map(d => nomeNoPlural(d.nome));
        const menos = difs.filter(d => d.dif < 0).map(d => nomeNoPlural(d.nome));
        if (mais.length && menos.length) return `Começou com mais ${mais[0]} e menos ${menos[0]}.`;
        if (mais.length > 1) return `Começou com mais ${mais[0]} e mais ${mais[1]}.`;
        if (mais.length) return `Começou com mais ${mais[0]}.`;
        if (menos.length > 1) return `Começou com menos ${menos[0]} e menos ${menos[1]}.`;
        if (menos.length) return `Começou com menos ${menos[0]}.`;
        return "Começou igual à praça de hoje.";
    }

    function textoAlternativo(linha, prefixo = "Proposta") {
        const nome = pracaPorSlug[linha.mapa_id]?.nome;
        const gostos = linha.likes || 0;
        return `${prefixo}${nome ? ` para ${nome}` : ""}, de ${formatarData(linha.created_at)}, ${plural(gostos, "gosto", "gostos")}`;
    }

    function ligarProposta(link, linha) {
        link.href = `/galeria/?id=${encodeURIComponent(linha.praca_id)}`;
        link.dataset.pracaId = linha.praca_id;
    }

    // ------------------------------------------
    // Pedidos ao Supabase
    // ------------------------------------------

    // Pedido A (leve): contagens, propostas recentes e a mais gostada.
    // Limite de 1000 linhas. Quando a tabela passar disso, trocar as
    // contagens por uma função SQL que conta na hora (como
    // filtrar_pracas_por_item). Uma tabela calculada uma vez por dia com
    // pg_cron só compensa com dezenas de milhares de propostas, e atrasa
    // a contagem até ao dia seguinte.
    async function buscarResumo() {
        const { data, error } = await db
            .from("city_creations")
            .select(COLUNAS_RESUMO)
            .order("created_at", { ascending: false })
            .limit(1000);
        if (error) throw error;
        return juntarVersoes(data || []);
    }

    // Pedido B (com plantas): as 150 mais recentes, para as faixas.
    async function buscarComPlantas() {
        const { data, error } = await db
            .from("city_creations")
            .select(COLUNAS_PLANTAS)
            .order("created_at", { ascending: false })
            .limit(150);
        if (error) throw error;
        return juntarVersoes(data || []);
    }

    // Pedido C: originais de conversas que não vieram no pedido B.
    async function buscarOriginais(ids) {
        if (!ids.length) return [];
        const { data, error } = await db
            .from("city_creations")
            .select(COLUNAS_PLANTAS)
            .in("praca_id", ids)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return juntarVersoes(data || []);
    }

    // ------------------------------------------
    // 1. Topo: hoje | proposta mais gostada de uma praça sorteada
    // ------------------------------------------

    const figura = document.getElementById("hubComparar");
    const range = document.getElementById("hubCompararRange");

    if (range) {
        range.addEventListener("input", () => {
            figura.style.setProperty("--pos", `${range.value}%`);
        });
    }

    function preencherTopo(propostas) {
        if (!figura) return;

        const candidatas = pracas.filter(p => p.hoje && propostas.some(l => l.mapa_id === p.slug));
        if (!candidatas.length) return; // fica só a foto de hoje, sem divisão

        const praca = candidatas[Math.floor(Math.random() * candidatas.length)];
        const melhor = propostas
            .filter(l => l.mapa_id === praca.slug)
            .reduce((a, b) => ((b.likes || 0) > (a.likes || 0) ? b : a));

        const imgHoje = document.getElementById("hubHojeImg");
        const imgProposta = document.getElementById("hubPropostaImg");
        imgHoje.src = praca.hoje.src;
        imgHoje.alt = `${praca.nome} como está hoje`;
        imgProposta.src = melhor.image_topo_url;
        imgProposta.alt = textoAlternativo(melhor, "rePraça com mais gostos");
        document.getElementById("hubPropostaCamada").hidden = false;

        figura.querySelector(".hub-comparar-pega").hidden = false;
        range.hidden = false;
        range.value = 50; // o browser pode repor o valor antigo ao recarregar
        figura.style.setProperty("--pos", "50%");
        figura.classList.add("tem-proposta");

        const legenda = document.getElementById("hubLegenda");
        // "rePraça com mais gostos" é o link: abre o popup (pelo clique
        // delegado mais abaixo, como os cartões) ou um separador novo.
        const link = document.createElement("a");
        ligarProposta(link, melhor);
        link.textContent = "rePraça com mais gostos";
        legenda.replaceChildren(`${praca.nome}, hoje e na `, link, ".");
    }

    // ------------------------------------------
    // 2. Linhas das praças
    // ------------------------------------------

    function preencherLinhas(propostas) {
        document.querySelectorAll(".hub-praca[data-slug]").forEach(artigo => {
            const slug = artigo.dataset.slug;
            const daPraca = propostas.filter(l => l.mapa_id === slug);
            const lista = artigo.querySelector("[data-propostas]");
            const contagens = artigo.querySelector("[data-contagens]");

            lista.replaceChildren();
            lista.removeAttribute("aria-busy");

            if (!daPraca.length) {
                artigo.classList.add("sem-propostas");
                artigo.querySelector(".hub-praca-rotulo").hidden = true;
                const vazio = document.createElement("li");
                vazio.className = "hub-praca-vazia";
                vazio.textContent = "Ainda sem propostas. A primeira pode ser a tua.";
                lista.appendChild(vazio);
                return;
            }

            const remixes = daPraca.filter(ehRemix).length;
            contagens.innerHTML = ` · <b>${plural(daPraca.length, "proposta", "propostas")}</b>`
                + (remixes ? ` · <b>${plural(remixes, "remix", "remixes")}</b>` : "");

            daPraca.slice(0, 4).forEach(linha => {
                const li = document.createElement("li");
                const a = document.createElement("a");
                ligarProposta(a, linha);
                const img = document.createElement("img");
                img.src = linha.image_topo_url;
                img.alt = textoAlternativo(linha);
                img.loading = "lazy";
                img.width = 160;
                img.height = 160;
                a.appendChild(img);
                li.appendChild(a);
                lista.appendChild(li);
            });

            // No tablet só se veem 3 propostas (o CSS esconde a 4.ª), por
            // isso o cartão leva as duas contas e o CSS mostra a certa.
            // Com 4 propostas o cartão só aparece no tablet.
            if (daPraca.length > 3) {
                const n = daPraca.length;
                const li = document.createElement("li");
                li.className = "hub-praca-todas" + (n === 4 ? " hub-praca-todas--so-tablet" : "");
                const a = document.createElement("a");
                a.href = `/galeria/praca/${slug}/`;
                a.innerHTML = `<span><span class="hub-todas-4">+${n - 4}</span><span class="hub-todas-3">+${n - 3}</span><br>ver todas`
                    + `<span class="hub-so-leitor">: as ${n} propostas de ${escaparHtml(pracaPorSlug[slug]?.nome || "esta praça")}</span></span>`;
                li.appendChild(a);
                lista.appendChild(li);
            }
        });
    }

    function linhasSemDados() {
        // O Supabase falhou: tira os lugares a pulsar, deixa o Hoje e um
        // aviso com link para a galeria da praça.
        document.querySelectorAll(".hub-praca [data-propostas]").forEach(lista => {
            const artigo = lista.closest(".hub-praca");
            const aviso = document.createElement("li");
            aviso.className = "hub-praca-vazia";
            aviso.innerHTML = `<span>Não foi possível carregar as propostas agora. `
                + `<a href="/galeria/praca/${encodeURIComponent(artigo.dataset.slug)}/">Ver a galeria desta praça</a></span>`;
            lista.replaceChildren(aviso);
            lista.removeAttribute("aria-busy");
            artigo.classList.add("sem-propostas");
            artigo.querySelector(".hub-praca-rotulo").hidden = true;
        });
    }

    // ------------------------------------------
    // 3a. Ideias muito diferentes
    // ------------------------------------------

    function escolherIdeias(linhas) {
        const conhecidas = linhas.filter(l => pracaPorSlug[l.mapa_id] && temPlanta(l));
        const limite = Date.now() - DIAS_RECENTES * 24 * 60 * 60 * 1000;
        let candidatas = conhecidas.filter(l => new Date(l.created_at).getTime() >= limite);
        if (candidatas.length < MIN_RECENTES) candidatas = conhecidas.slice(0, RESERVA_RECENTES);

        const ordenadas = candidatas
            .map(linha => ({ linha, div: divergencia(linha) }))
            .filter(x => x.div > 0)
            .sort((a, b) => b.div - a.div);
        const metade = ordenadas.slice(0, Math.ceil(ordenadas.length / 2)).map(x => x.linha);

        return sortearComPeso(metade, NUM_IDEIAS, pesoNoSorteio)
            .sort((a, b) => divergencia(b) - divergencia(a));
    }

    function desenharIdeias(ideias) {
        const seccao = document.getElementById("hub-ideias");
        const molde = document.getElementById("tpl-ideia");
        if (!seccao || !molde || ideias.length < MIN_IDEIAS) return;

        const lista = seccao.querySelector(".hub-faixa-lista");
        ideias.forEach(linha => {
            const cartao = molde.content.cloneNode(true);
            ligarProposta(cartao.querySelector(".hub-ideia-link"), linha);
            const img = cartao.querySelector(".hub-ideia-img");
            img.src = linha.image_topo_url;
            img.alt = textoAlternativo(linha);
            cartao.querySelector(".hub-ideia-etiqueta").innerHTML = etiquetasDeMudanca(diferencasDeHoje(linha), { maximo: 1 });
            cartao.querySelector(".hub-ideia-praca").textContent = pracaPorSlug[linha.mapa_id]?.nome || "";
            lista.appendChild(cartao);
        });
        seccao.hidden = false;
        ligarSetas(seccao);
    }

    // ------------------------------------------
    // 3b. Conversas de remixes
    // ------------------------------------------

    // Uma conversa é um original (sem praca_pai_id) com pelo menos um
    // remix direto. Ordenam-se pelo remix mais recente, para aparecerem
    // as que estão vivas.
    async function escolherRemixes(comPlantas, resumo) {
        const porId = new Map(comPlantas.map(l => [l.praca_id, l]));
        const filhosPorPai = new Map();
        comPlantas.filter(l => ehRemix(l) && temPlanta(l)).forEach(filho => {
            if (!filhosPorPai.has(filho.praca_pai_id)) filhosPorPai.set(filho.praca_pai_id, []);
            filhosPorPai.get(filho.praca_pai_id).push(filho);
        });

        const paisPorRecencia = [...filhosPorPai.keys()]
            .sort((a, b) => new Date(filhosPorPai.get(b)[0].created_at) - new Date(filhosPorPai.get(a)[0].created_at));

        // Só originais (não remixes de remixes) e de praças que existem.
        const faltam = paisPorRecencia.filter(id => !porId.has(id)).slice(0, NUM_CONVERSAS * 2);
        (await buscarOriginais(faltam)).forEach(l => porId.set(l.praca_id, l));

        const totalRemixes = new Map();
        resumo.filter(ehRemix).forEach(l => totalRemixes.set(l.praca_pai_id, (totalRemixes.get(l.praca_pai_id) || 0) + 1));

        return paisPorRecencia
            .map(id => porId.get(id))
            .filter(pai => pai && !ehRemix(pai) && temPlanta(pai) && pracaPorSlug[pai.mapa_id])
            .slice(0, NUM_CONVERSAS)
            .map(pai => ({
                pai,
                ramos: filhosPorPai.get(pai.praca_id).slice(0, RAMOS_POR_CONVERSA),
                total: Math.max(totalRemixes.get(pai.praca_id) || 0, filhosPorPai.get(pai.praca_id).length),
            }));
    }

    function desenharRemixes(conversas) {
        const seccao = document.getElementById("hub-remixes");
        const molde = document.getElementById("tpl-remixes");
        const moldeRamo = document.getElementById("tpl-ramo");
        if (!seccao || !molde || !moldeRamo || !conversas.length) return;

        const lista = seccao.querySelector(".hub-faixa-lista");
        conversas.forEach(({ pai, ramos, total }) => {
            const cartao = molde.content.cloneNode(true);
            ligarProposta(cartao.querySelector(".hub-conversa-original"), pai);
            const img = cartao.querySelector(".hub-conversa-img");
            img.src = pai.image_topo_url;
            img.alt = textoAlternativo(pai, "Proposta original");
            cartao.querySelector(".hub-conversa-frase").textContent = fraseDeInicio(pai);
            cartao.querySelector(".hub-conversa-n").innerHTML =
                `<span aria-hidden="true">↻</span> ${escaparHtml(plural(total, "remix", "remixes"))}`;
            cartao.querySelector(".hub-conversa-praca").textContent = pracaPorSlug[pai.mapa_id].nome;

            const contagemPai = contagemPorNome(itensDaLinha(pai));
            const listaRamos = cartao.querySelector(".hub-conversa-ramos");
            ramos.forEach(filho => {
                const ramo = moldeRamo.content.cloneNode(true);
                ligarProposta(ramo.querySelector(".hub-ramo-link"), filho);
                const imgRamo = ramo.querySelector(".hub-ramo-img");
                imgRamo.src = filho.image_topo_url;
                imgRamo.alt = textoAlternativo(filho, "Remix");
                ramo.querySelector(".hub-ramo-etiquetas").innerHTML =
                    etiquetasDeMudanca(diferencasEntre(contagemPorNome(itensDaLinha(filho)), contagemPai), { maximo: 2 });
                listaRamos.appendChild(ramo);
            });

            const resto = total - ramos.length;
            cartao.querySelector(".hub-conversa-resto").textContent =
                resto > 0 ? `e mais ${plural(resto, "remix", "remixes")}` : "sem mais remixes";
            lista.appendChild(cartao);
        });
        seccao.hidden = false;
        ligarSetas(seccao);
    }

    // ------------------------------------------
    // Setas das faixas
    // ------------------------------------------

    function ligarSetas(seccao) {
        const lista = seccao.querySelector(".hub-faixa-lista");
        const [antes, depois] = seccao.querySelectorAll(".hub-seta");
        const suave = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

        // aria-disabled em vez de disabled: um botão disabled perde o foco
        // do teclado, que voltaria ao início da página.
        const atualizar = () => {
            antes.setAttribute("aria-disabled", String(lista.scrollLeft <= 2));
            depois.setAttribute("aria-disabled", String(lista.scrollLeft + lista.clientWidth >= lista.scrollWidth - 2));
        };

        seccao.querySelectorAll(".hub-seta").forEach(botao => {
            botao.addEventListener("click", () => {
                if (botao.getAttribute("aria-disabled") === "true") return;
                const direcao = Number(botao.dataset.direcao);
                lista.scrollBy({ left: direcao * lista.clientWidth * 0.8, behavior: suave });
            });
        });
        lista.addEventListener("scroll", atualizar, { passive: true });
        window.addEventListener("resize", atualizar);
        atualizar();
    }

    // ------------------------------------------
    // Abrir a pasta por cima do hub, e setas da pasta
    // ------------------------------------------
    // Clicar num cartão abre o popup aqui mesmo (?id=). As setas
    // anterior/seguinte da pasta andam pelos cartões do grupo onde se
    // clicou (uma linha de praça ou uma faixa): o app.js chama
    // window.cardsDoHub() quando a página não tem grelha. Só contam os
    // cartões visíveis (no tablet a 4.ª proposta de cada linha fica
    // escondida).

    let grupoAtivo = null;

    window.cardsDoHub = () => (grupoAtivo
        ? [...grupoAtivo.querySelectorAll("a[data-praca-id]")].filter(a => a.getClientRects().length > 0)
        : []);

    document.querySelector(".hub")?.addEventListener("click", evento => {
        const link = evento.target.closest("a[data-praca-id]");
        if (!link || !link.dataset.pracaId) return;
        // Ctrl/Cmd+clique e clique do meio abrem noutro separador, como
        // num link normal.
        if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
        evento.preventDefault();
        grupoAtivo = link.closest("[data-hub-grupo]");
        abrirPraca(link.dataset.pracaId);
    });

    // ------------------------------------------
    // Arranque
    // ------------------------------------------

    async function iniciarHub() {
        let resumo = [];
        try {
            resumo = await buscarResumo();
        } catch (erro) {
            console.error("Hub: erro ao buscar propostas:", erro);
            linhasSemDados();
            return;
        }

        const conhecidas = resumo.filter(l => pracaPorSlug[l.mapa_id]);
        preencherTopo(conhecidas);
        preencherLinhas(conhecidas);

        // As faixas só pedem as plantas (pesadas) quando a última praça
        // está perto do ecrã. Com poucas praças isso é logo ao abrir.
        const alvo = document.querySelector(".hub-pracas > .hub-praca:last-of-type") || document.querySelector(".hub-pracas");
        const carregarFaixas = async () => {
            let comPlantas;
            try {
                comPlantas = await buscarComPlantas();
                if (!Object.keys(catalogoItens).length) await carregarCatalogoItens();
            } catch (erro) {
                console.error("Hub: erro ao buscar as plantas:", erro);
                return;
            }
            // Cada faixa à parte: um erro numa não esconde a outra.
            try {
                desenharIdeias(escolherIdeias(comPlantas));
            } catch (erro) {
                console.error("Hub: erro em Ideias muito diferentes:", erro);
            }
            try {
                desenharRemixes(await escolherRemixes(comPlantas, resumo));
            } catch (erro) {
                console.error("Hub: erro em Conversas de remixes:", erro);
            }
        };

        if ("IntersectionObserver" in window && alvo) {
            const observador = new IntersectionObserver(entradas => {
                if (entradas.some(e => e.isIntersecting)) {
                    observador.disconnect();
                    carregarFaixas();
                }
            }, { rootMargin: "600px 0px" });
            observador.observe(alvo);
        } else {
            carregarFaixas();
        }
    }

    iniciarHub();
})();
