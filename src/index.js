export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Só nos interessa reescrever meta tags dentro de /galeria/ com ?id=
    if (!url.pathname.startsWith("/galeria")) {
      return env.ASSETS.fetch(request);
    }

    const id = url.searchParams.get("id");
    const resposta = await env.ASSETS.fetch(request);
    if (!id) return resposta;

    // Só vale reescrever pra bots conhecidos — humano não precisa
    const ua = request.headers.get("user-agent") || "";
    const ehCrawler = /facebookexternalhit|WhatsApp|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot/i.test(ua);
    if (!ehCrawler) return resposta;

    // Tudo que depende do Supabase fica protegido — se der qualquer erro
    // aqui dentro (coluna renomeada de novo, banco fora do ar, etc.), a
    // página continua funcionando normalmente em vez de derrubar tudo com
    // um 500. Foi exatamente a falta disso que causou o erro anterior.
    try {
      const SUPABASE_URL = "https://ldynpvhqbmrcrlcabnuf.supabase.co";
      const SUPABASE_KEY = "sb_publishable_qtshAGmadXj9SbNhrgJOXg_lFROY3Yb";

      // "nome_da_cena" foi renomeada pra "mapa_id" — atualizado aqui também.
      // "titulo" é o nome que o próprio jogador deu à criação (melhor pra
      // preview do que o nome da praça-base, que já aparece na página).
      const busca = await fetch(
        `${SUPABASE_URL}/rest/v1/city_creations?praca_id=eq.${id}&select=titulo,image_topo_url,total_objects&order=created_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );

      const linhas = await busca.json();
      if (!Array.isArray(linhas) || linhas.length === 0) return resposta;

      const praca = linhas[0];
      const titulo = `${praca.titulo || "Praça Personalizada"} — rePraça`;
      const descricao = `Uma criação com ${praca.total_objects} itens no rePraça. Vem ver!`;

      return new HTMLRewriter()
        .on('title', { element(el) { el.setInnerContent(titulo); } })
        .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", titulo); } })
        .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", descricao); } })
        .on('meta[property="og:image"]', { element(el) { el.setAttribute("content", praca.image_topo_url); } })
        .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", url.toString()); } })
        .transform(resposta);
    } catch (erro) {
      console.error("Erro ao montar preview OG:", erro);
      return resposta;
    }
  }
};