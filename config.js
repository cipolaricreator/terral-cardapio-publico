/*
 * Configuração de pedidos e pagamento do cardápio Terral.
 * Edite apenas os valores abaixo — o restante do site lê daqui.
 *
 * Como funciona:
 * - Na mesa: o primeiro pedido abre a comanda. O cliente pode pedir novas rodadas
 *   e paga no final, em "Pedir a conta" (PIX pelo cardápio ou cartão com o garçom).
 * - Para viagem / entrega: o pagamento é feito na hora do pedido
 *   (PIX pelo cardápio antes de enviar, ou cartão no caixa antes do preparo).
 *
 * Painel da equipe (cozinha e caixa):
 * - Abra o MESMO endereço do cardápio terminando em #cozinha (tela da cozinha,
 *   mostra os pedidos chegando) ou #caixa (tela do caixa, com o PIX pronto
 *   para gerar e o botão de confirmar pagamento + imprimir comprovante).
 * - Já está ligado ao backend próprio (pasta server/, rodando na VPS via
 *   pm2 e exposto em /terral/api/ pelo "orderEndpoint" abaixo) — funciona
 *   de verdade nesta hospedagem, não só na demonstração.
 * - Senha para abrir o painel no celular/computador da equipe:
 */
window.TERRAL_CONFIG = {
  restaurant: 'Terral Maresias',
  teamPin: 'Deus2026#',

  // Número que recebe os pedidos no WhatsApp: DDI + DDD + número, só dígitos.
  // Funciona como plano de segurança: só é acionado sozinho se o painel da
  // equipe e o "orderEndpoint" (abaixo) não estiverem disponíveis.
  // ATENÇÃO: confirme o número oficial. A versão terral2 usa 5511944852667.
  whatsapp: '551238656488',

  // Backend próprio do painel (cozinha/caixa), rodando na VPS via pm2 e
  // exposto pelo nginx em /terral/api/. O cardápio envia um POST em JSON:
  // { type, text, order, sentAt } e o painel consulta o mesmo endereço.
  // Ordem de tentativa ao enviar pedido: painel (Artifact, se houver) → este endereço → WhatsApp.
  orderEndpoint: 'https://aondadigital.com.br/terral/api/orders',

  // PIX: enquanto "key" estiver vazio, o pagamento aparece em modo demonstração.
  pix: {
    key: '',                 // chave PIX: CNPJ, e-mail, telefone (+55...) ou chave aleatória
    name: 'Terral Maresias', // nome do recebedor (até 25 letras)
    city: 'Sao Sebastiao'    // cidade do recebedor (até 15 letras)
  },

  // Formas de receber o pedido
  modes: {
    mesa: true,      // comanda: paga ao final da refeição
    retirada: true,  // para viagem: paga na hora do pedido
    entrega: false   // entrega: paga na hora do pedido (PIX) ou cartão na entrega
  },

  serviceFee: 0.10,  // taxa de serviço opcional na conta da mesa (0.10 = 10%)
  deliveryFee: 12,   // taxa de entrega em reais (usada só se "entrega" estiver ativa)

  // Formas de pagamento oferecidas
  payments: {
    pix: true,
    cartao: true
  }
};
