const demoCards = [
  { name: 'Рыцарь сладостей', card_type: 'creature', cost: 1, attack: 2, health: 3, description: 'Быстрый стартовый боец.' },
  { name: 'Ледяной маг', card_type: 'creature', cost: 1, attack: 1, health: 4, has_flip: true, flip_description: 'Замораживает цель.' },
  { name: 'Башня принцессы', card_type: 'building', cost: 2, attack: 0, health: 6, description: 'Держит линию обороны.' },
  { name: 'Огненный шар', card_type: 'spell', cost: 1, attack: 3, health: 1, description: 'Ударное заклинание.' },
  { name: 'Кукурузный страж', card_type: 'creature', cost: 2, attack: 4, health: 4, description: 'Сильная карта зоны.' },
]

const demoLands = [
  { name: 'Кукурузное поле', land_type: 'corn' },
  { name: 'Ледяная равнина', land_type: 'ice' },
  { name: 'Пустыня', land_type: 'desert' },
  { name: 'Добрые земли', land_type: 'good' },
]

function expandCards(cards = []) {
  if (Array.isArray(cards) && cards.length > 0) {
    return cards.flatMap((card) => Array.from({ length: Number(card.quantity || 1) }, () => ({ ...card })))
  }

  return Array.from({ length: 4 }).flatMap(() => demoCards.map((card) => ({ ...card })))
}

export function createGameFromLobbyPlayers(players = []) {
  const orderedPlayers = [...players].slice(0, 2)

  while (orderedPlayers.length < 2) {
    orderedPlayers.push({
      player_id: `bot-${orderedPlayers.length + 1}`,
      nickname: `Бот ${orderedPlayers.length + 1}`,
      deck: null,
    })
  }

  return {
    players: orderedPlayers.map((player) => ({
      id: player.player_id,
      nickname: player.nickname || 'Игрок',
      deck: expandCards(player.deck?.cards),
      lands: player.deck?.lands?.length ? player.deck.lands : demoLands,
    })),
  }
}
