/**
 * wsQueue.test.js — тесты FIFO-очереди.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFifoQueue } from './wsQueue'

describe('createFifoQueue', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('вызывает worker строго в порядке push', async () => {
    const order = []
    const queue = createFifoQueue(async (item) => {
      order.push(item)
    })
    queue.push('a')
    queue.push('b')
    queue.push('c')
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('сохраняет порядок при асинхронных worker', async () => {
    const order = []
    const queue = createFifoQueue(async (item) => {
      // разная задержка для разных элементов
      const delay = item === 'fast' ? 1 : item === 'slow' ? 30 : 10
      await new Promise((r) => setTimeout(r, delay))
      order.push(item)
    })
    queue.push('slow')
    queue.push('fast')
    queue.push('medium')
    // ждём достаточно: slow(30) + fast(1) + medium(10) + buffer
    await new Promise((r) => setTimeout(r, 100))
    expect(order).toEqual(['slow', 'fast', 'medium'])
  })

  it('size() возвращает длину очереди (всё ещё не обработанное)', async () => {
    // Используем очередь с очень медленным worker чтобы очередь не успевала обработаться
    const queue = createFifoQueue(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    queue.push('a')
    queue.push('b')
    queue.push('c')
    // drain() стартует синхронно и достаёт первый элемент
    // поэтому размер = количество ещё не обработанных = 2
    expect(queue.size()).toBe(2)
    // ждём пока обработается всё
    await new Promise((r) => setTimeout(r, 200))
    expect(queue.size()).toBe(0)
  })

  it('clear() опустошает очередь', async () => {
    const queue = createFifoQueue(async () => {})
    queue.push('a')
    queue.push('b')
    queue.clear()
    expect(queue.size()).toBe(0)
  })

  it('onError вызывается при ошибке в worker', async () => {
    const errors = []
    const queue = createFifoQueue(
      async () => {
        throw new Error('boom')
      },
      { onError: (err) => errors.push(err) },
    )
    queue.push('a')
    queue.push('b')
    await new Promise((r) => setTimeout(r, 10))
    expect(errors).toHaveLength(2)
  })

  it('stop() останавливает обработку', async () => {
    const order = []
    const queue = createFifoQueue(async (item) => {
      order.push(item)
    })
    queue.push('a')
    await queue.stop()
    queue.push('b')
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['a'])
  })
})
