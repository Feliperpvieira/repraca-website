// Header: no mobile, o ícone de download (nuvem) vira um botão que abre/fecha
// os badges da Play Store e App Store numa linha abaixo.
// Sem JS, o <a class="links-download-mobile"> continua a funcionar como link normal.
(() => {
    const MOBILE = window.matchMedia('(max-width: 780px)');
    const menu = document.querySelector('.menu');
    const link = document.querySelector('.links-download-mobile');
    const painel = document.querySelector('.links-download');

    if (!menu || !link || !painel) return;

    const ICONE_NUVEM = link.innerHTML; // reaproveita o svg que já está no HTML
    const ICONE_FECHAR = `
        <svg xmlns="http://www.w3.org/2000/svg" width="34" height="36" viewBox="0 0 34 36" fill="none" aria-hidden="true">
            <path d="M9 10L25 26M25 10L9 26" stroke="#F9EFE7" stroke-width="5" stroke-linecap="round"/>
        </svg>`;

    // <a> -> <button>: mesma classe, então o CSS existente continua a valer.
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = link.className;
    // Os dois ícones ficam sempre no DOM; o morph é feito pelo CSS via aria-expanded.
    // (Trocar o innerHTML remove o alvo do clique e o handler de "clicar fora"
    // achava que o clique tinha sido fora do botão.)
    botao.innerHTML = ICONE_NUVEM + ICONE_FECHAR;
    const [svgNuvem, svgFechar] = botao.querySelectorAll('svg');
    svgNuvem.classList.add('icone-nuvem');
    svgFechar.classList.add('icone-fechar');
    svgNuvem.setAttribute('aria-hidden', 'true');
    menu.classList.add('menu--js'); // liga o CSS da gaveta (sem JS fica tudo como estava)
    botao.setAttribute('aria-label', 'Descarregar a app');
    botao.setAttribute('aria-expanded', 'false');

    painel.id = painel.id || 'links-download';
    botao.setAttribute('aria-controls', painel.id);

    link.replaceWith(botao);

    function definirAberto(aberto) {
        menu.classList.toggle('menu--aberto', aberto);
        botao.setAttribute('aria-expanded', String(aberto));
        botao.setAttribute('aria-label', aberto ? 'Fechar links de download' : 'Descarregar a app');
    }

    botao.addEventListener('click', () => {
        definirAberto(!menu.classList.contains('menu--aberto'));
    });

    // Clique fora do painel fecha (ele é um overlay)
    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('menu--aberto')) return;
        if (botao.contains(e.target) || painel.contains(e.target)) return;
        definirAberto(false);
    });

    // Esc fecha
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menu.classList.contains('menu--aberto')) {
            definirAberto(false);
            botao.focus();
        }
    });

    // Se a janela passar para desktop, repõe o estado fechado
    MOBILE.addEventListener('change', (e) => {
        if (!e.matches) definirAberto(false);
    });
})();