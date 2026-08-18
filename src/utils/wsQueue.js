/**
 * wsQueue.js — реальная FIFO-очередь для WS-сообщений.
 *
 * Заменяет анти-паттерн "цепочка промисов":
 *   queue = queue.then(...)
 * который не гарантирует порядок при быстрых push'ах.
 *
 * Использование:
 *   const queue = createFifoQueue(async (msg) => {
 *     store.getState().applyServerState(msg.payload, 'ws:push')
 *   })
 *   ws.addEventListener('message', (e) => queue.push(JSON.parse(e.data)))
 */
export function createFifoQueue(worker, opts = {}) {
  const { onError = () => {} } = opts
  const items = []
  let running = false
  let stopped = false

  const drain = async () => {
    if (running || stopped) return
    running = true
    try {
      while (items.length > 0 && !stopped) {
        const item = items.shift()
        try {
          await worker(item)
        } catch (err) {
          onError(err, item)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    push(item) {
      if (stopped) return
      items.push(item)
      drain()
    },
    size() {
      return items.length
    },
    async stop() {
      stopped = true
      // ждём пока текущий worker закончит
      while (running) {
        await new Promise((r) => setTimeout(r, 0))
      }
    },
    clear() {
      items.length = 0
    },
  }
}
